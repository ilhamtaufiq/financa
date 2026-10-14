mod common;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use axum::Router;
use chrono::NaiveDate;
use financa_api::db;
use financa_api::http::router;
use financa_api::model::{JenisRekening, NewRekening, NewTransaksi, NewTransfer, TipeKategori, TipeTransaksi};
use financa_api::Tenant;
use rust_decimal::Decimal;
use tower::ServiceExt;

fn tgl(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

fn rp(n: i64) -> Decimal {
    Decimal::from(n)
}

const KATA_SANDI: &str = "rahasia-123";

fn uuid_pendek() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

struct Data {
    t: Tenant,
    org_id: u64,
    user: u64,
    email: String,
    kas: u64,
    bank: u64,
    kat_jual: u64,
    kat_ops: u64,
}

/// Organisasi dengan dua rekening dan transaksi untuk Oktober 2026.
/// Transaksi 2026-09-15 berada sebelum periode dan hanya masuk saldo awal.
async fn siapkan(pool: &sqlx::mysql::MySqlPool) -> Data {
    let org = db::buat_organisasi(pool, "Org", &format!("org-{}", uuid_pendek())).await.unwrap();
    let email = format!("{}@example.test", uuid_pendek());
    let hash = financa_api::auth::hash_kata_sandi(KATA_SANDI).unwrap();
    let user = db::buat_pengguna(pool, "Pengguna", &email, &hash).await.unwrap();
    db::tambah_anggota(pool, org.id, user, "owner").await.unwrap();
    let t = Tenant::new(pool.clone(), org.id);

    let kas = t
        .buat_rekening(NewRekening { nama: "Kas".into(), jenis: JenisRekening::Kas, saldo_awal: rp(100_000) })
        .await
        .unwrap();
    let bank = t
        .buat_rekening(NewRekening { nama: "Bank".into(), jenis: JenisRekening::Bank, saldo_awal: rp(0) })
        .await
        .unwrap();

    // Kategori default dari seed migrasi.
    let kategori = t.daftar_kategori().await.unwrap();
    let kat_jual = kategori
        .iter()
        .find(|k| k.organisasi_id.is_none() && k.nama == "Penjualan")
        .unwrap()
        .id;
    let kat_ops = kategori
        .iter()
        .find(|k| k.organisasi_id.is_none() && k.nama == "Operasional" && k.tipe == TipeKategori::Pengeluaran)
        .unwrap()
        .id;

    let d = Data { t, org_id: org.id, user, email, kas: kas.id, bank: bank.id, kat_jual, kat_ops };

    catat(&d, d.kas, Some(d.kat_ops), TipeTransaksi::Pengeluaran, 10_000, "2026-09-15", None).await;
    catat(&d, d.kas, Some(d.kat_jual), TipeTransaksi::Pemasukan, 50_000, "2026-10-01", Some("=cmd, \"penjualan\"")).await;
    catat(&d, d.kas, Some(d.kat_ops), TipeTransaksi::Pengeluaran, 20_000, "2026-10-02", None).await;
    catat(&d, d.kas, None, TipeTransaksi::Pemasukan, 7_000, "2026-10-03", None).await;
    d.t.buat_transfer(NewTransfer {
        rekening_asal_id: d.kas,
        rekening_tujuan_id: d.bank,
        jumlah: rp(5_000),
        tanggal: tgl("2026-10-04"),
        catatan: None,
        dibuat_oleh: d.user,
    })
    .await
    .unwrap();
    catat(&d, d.bank, Some(d.kat_ops), TipeTransaksi::Pengeluaran, 3_000, "2026-10-31", None).await;

    d
}

async fn catat(
    d: &Data,
    rekening: u64,
    kategori: Option<u64>,
    tipe: TipeTransaksi,
    jumlah: i64,
    tanggal: &str,
    catatan: Option<&str>,
) {
    d.t.buat_transaksi(NewTransaksi {
        rekening_id: rekening,
        kategori_id: kategori,
        tipe,
        jumlah: rp(jumlah),
        tanggal: tgl(tanggal),
        catatan: catatan.map(String::from),
        dibuat_oleh: d.user,
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn ringkasan_bulanan_cocok_dengan_transaksi_mentah() {
    let Some(db) = common::baru().await else { return };
    let d = siapkan(&db.pool).await;

    let ringkasan = d.t.ringkasan_bulanan(2026, 10).await.unwrap();

    // Hitung ulang dari transaksi mentah pada periode yang sama.
    let mentah = d.t.daftar_transaksi(tgl("2026-10-01"), tgl("2026-10-31")).await.unwrap();
    let pemasukan: Decimal = mentah
        .iter()
        .filter(|t| t.tipe == TipeTransaksi::Pemasukan)
        .map(|t| t.jumlah)
        .sum();
    let pengeluaran: Decimal = mentah
        .iter()
        .filter(|t| t.tipe == TipeTransaksi::Pengeluaran)
        .map(|t| t.jumlah)
        .sum();
    let jumlah_non_transfer = mentah
        .iter()
        .filter(|t| !matches!(t.tipe, TipeTransaksi::TransferKeluar | TipeTransaksi::TransferMasuk))
        .count() as i64;

    assert_eq!(ringkasan.total_pemasukan, pemasukan);
    assert_eq!(ringkasan.total_pengeluaran, pengeluaran);
    assert_eq!(ringkasan.selisih, pemasukan - pengeluaran);
    assert_eq!(ringkasan.jumlah_transaksi, jumlah_non_transfer);

    // Nilai yang diharapkan secara manual: 57.000 masuk, 23.000 keluar, transfer tidak dihitung.
    assert_eq!(ringkasan.total_pemasukan, rp(57_000));
    assert_eq!(ringkasan.total_pengeluaran, rp(23_000));
    assert_eq!(ringkasan.jumlah_transaksi, 4);

    db.hapus().await;
}

#[tokio::test]
async fn laba_rugi_per_kategori() {
    let Some(db) = common::baru().await else { return };
    let d = siapkan(&db.pool).await;

    let lr = d.t.laba_rugi(tgl("2026-10-01"), tgl("2026-10-31")).await.unwrap();

    assert_eq!(lr.pendapatan.len(), 2);
    assert_eq!(lr.beban.len(), 1);
    assert_eq!(lr.beban[0].kategori, "Operasional");
    assert_eq!(lr.beban[0].total, rp(23_000));
    assert!(lr.pendapatan.iter().any(|b| b.kategori == "Tanpa kategori" && b.total == rp(7_000)));
    assert_eq!(lr.total_pendapatan, rp(57_000));
    assert_eq!(lr.total_beban, rp(23_000));
    assert_eq!(lr.laba_bersih, rp(34_000));

    db.hapus().await;
}

#[tokio::test]
async fn arus_kas_saldo_akhir_sama_dengan_saldo_rekening() {
    let Some(db) = common::baru().await else { return };
    let d = siapkan(&db.pool).await;

    let arus = d.t.arus_kas(tgl("2026-10-01"), tgl("2026-10-31")).await.unwrap();
    let kas = arus.iter().find(|r| r.rekening_id == d.kas).unwrap();
    let bank = arus.iter().find(|r| r.rekening_id == d.bank).unwrap();

    // Kas: awal 100.000 - 10.000 (sebelum periode) = 90.000.
    // Masuk 50.000 + 7.000 = 57.000. Keluar 20.000 + 5.000 (transfer) = 25.000.
    assert_eq!(kas.saldo_awal_periode, rp(90_000));
    assert_eq!(kas.masuk, rp(57_000));
    assert_eq!(kas.keluar, rp(25_000));
    assert_eq!(kas.saldo_akhir, rp(122_000));

    // Tidak ada transaksi setelah 31 Oktober, jadi saldo akhir periode sama dengan saldo saat ini.
    assert_eq!(Some(kas.saldo_akhir), d.t.saldo_rekening(d.kas).await.unwrap());
    assert_eq!(Some(bank.saldo_akhir), d.t.saldo_rekening(d.bank).await.unwrap());
    assert_eq!(bank.saldo_akhir, rp(2_000));

    db.hapus().await;
}

#[tokio::test]
async fn ekspor_csv_dan_validasi_lewat_http() {
    let Some(db) = common::baru().await else { return };
    let d = siapkan(&db.pool).await;
    let app: Router = router(db.pool.clone());
    let base = format!("/api/v1/organisasi/{}", d.org_id);
    let token = masuk(&app, &d.email).await;

    // Ekspor transaksi: BOM, header, lalu 6 baris data (transfer dihitung dua baris).
    let (status, headers, isi) = get(&app, &token, &format!("{base}/ekspor/transaksi.csv?dari=2026-10-01&sampai=2026-10-31")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(headers["content-type"], "text/csv; charset=utf-8");
    assert!(headers["content-disposition"].contains("transaksi_2026-10-01_2026-10-31.csv"));
    assert!(isi.starts_with('\u{feff}'));
    assert!(isi.contains("id,tanggal,tipe,rekening,kategori,jumlah,catatan,transfer_id"));
    assert_eq!(isi.trim_start_matches('\u{feff}').split("\r\n").filter(|l| !l.is_empty()).count(), 1 + 6);
    // Teks berawalan "=" diberi prefix "'" dan di-quote karena ada koma dan kutip.
    assert!(isi.contains("\"'=cmd, \"\"penjualan\"\"\""));

    // Laba rugi CSV berakhir dengan baris laba bersih.
    let (status, _, isi) = get(&app, &token, &format!("{base}/ekspor/laba-rugi.csv?dari=2026-10-01&sampai=2026-10-31")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(isi.contains("laba_bersih,,,34000"));

    // Bulan di luar 1..=12 ditolak.
    let (status, _, _) = get(&app, &token, &format!("{base}/laporan/bulanan?tahun=2026&bulan=13")).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Rentang terbalik ditolak.
    let (status, _, _) = get(&app, &token, &format!("{base}/laporan/arus-kas?dari=2026-10-31&sampai=2026-10-01")).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Tanpa token ditolak.
    let (status, _, _) = get(&app, "", &format!("{base}/laporan/bulanan?tahun=2026&bulan=10")).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    db.hapus().await;
}

async fn masuk(app: &Router, email: &str) -> String {
    let req = Request::builder()
        .method("POST")
        .uri("/api/v1/auth/masuk")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::json!({"email": email, "kata_sandi": KATA_SANDI}).to_string()))
        .unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = to_bytes(res.into_body(), 1 << 20).await.unwrap();
    let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    json["token"].as_str().unwrap().to_string()
}

/// GET dengan token Bearer. Token kosong berarti tanpa header Authorization.
async fn get(app: &Router, token: &str, uri: &str) -> (StatusCode, std::collections::HashMap<String, String>, String) {
    let mut builder = Request::builder().method("GET").uri(uri);
    if !token.is_empty() {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }
    let req = builder.body(Body::empty()).unwrap();
    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let headers = res
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let bytes = to_bytes(res.into_body(), 1 << 20).await.unwrap();
    (status, headers, String::from_utf8_lossy(&bytes).to_string())
}
