mod common;

use chrono::NaiveDate;
use financa_api::db;
use financa_api::model::{JenisRekening, NewRekening, NewTransaksi, NewTransfer, TipeTransaksi, UbahTransaksi};
use financa_api::{Error, Tenant};
use rust_decimal::Decimal;

fn tanggal(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

async fn jumlah_audit(pool: &sqlx::MySqlPool, aksi: &str, transaksi_id: u64) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM fn_audit_log WHERE aksi = ? AND entitas = 'transaksi' AND entitas_id = ?",
    )
    .bind(aksi)
    .bind(transaksi_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn ubah_transaksi_memperbarui_saldo_dan_dicatat_audit() {
    let Some(db) = common::baru().await else { return };

    let org = db::buat_organisasi(&db.pool, "Org", "org").await.unwrap();
    let pengguna = db::buat_pengguna(&db.pool, "Pencatat", "pencatat@example.test", "hash").await.unwrap();
    let t = Tenant::new(db.pool.clone(), org.id);

    let rek = t
        .buat_rekening(NewRekening {
            nama: "Kas".into(),
            jenis: JenisRekening::Kas,
            saldo_awal: Decimal::ZERO,
        })
        .await
        .unwrap();
    let transaksi = t
        .buat_transaksi(NewTransaksi {
            rekening_id: rek.id,
            kategori_id: None,
            tipe: TipeTransaksi::Pemasukan,
            jumlah: Decimal::from(10_000),
            tanggal: tanggal("2026-11-01"),
            catatan: Some("salah ketik".into()),
            dibuat_oleh: pengguna,
        })
        .await
        .unwrap();

    let diubah = t
        .ubah_transaksi_oleh(
            transaksi.id,
            UbahTransaksi {
                rekening_id: rek.id,
                kategori_id: None,
                tipe: TipeTransaksi::Pemasukan,
                jumlah: Decimal::from(25_000),
                tanggal: tanggal("2026-11-02"),
                catatan: Some("sudah benar".into()),
            },
            pengguna,
        )
        .await
        .unwrap();

    assert_eq!(diubah.jumlah, Decimal::from(25_000));
    assert_eq!(diubah.dibuat_oleh, pengguna, "pencatat asli tidak berubah");
    assert_eq!(t.saldo_rekening(rek.id).await.unwrap(), Some(Decimal::from(25_000)));
    assert_eq!(jumlah_audit(&db.pool, "update", transaksi.id).await, 1);

    db.hapus().await;
}

#[tokio::test]
async fn hapus_transaksi_keluar_dari_saldo_dan_dicatat_audit() {
    let Some(db) = common::baru().await else { return };

    let org = db::buat_organisasi(&db.pool, "Org", "org").await.unwrap();
    let pengguna = db::buat_pengguna(&db.pool, "Pencatat", "pencatat@example.test", "hash").await.unwrap();
    let t = Tenant::new(db.pool.clone(), org.id);

    let rek = t
        .buat_rekening(NewRekening {
            nama: "Kas".into(),
            jenis: JenisRekening::Kas,
            saldo_awal: Decimal::ZERO,
        })
        .await
        .unwrap();
    let transaksi = t
        .buat_transaksi(NewTransaksi {
            rekening_id: rek.id,
            kategori_id: None,
            tipe: TipeTransaksi::Pengeluaran,
            jumlah: Decimal::from(5_000),
            tanggal: tanggal("2026-11-01"),
            catatan: None,
            dibuat_oleh: pengguna,
        })
        .await
        .unwrap();
    assert_eq!(t.saldo_rekening(rek.id).await.unwrap(), Some(Decimal::from(-5_000)));

    t.hapus_transaksi_oleh(transaksi.id, pengguna).await.unwrap();

    assert_eq!(t.saldo_rekening(rek.id).await.unwrap(), Some(Decimal::ZERO));
    assert!(t.ambil_transaksi(transaksi.id).await.unwrap().is_none());
    let daftar = t.daftar_transaksi(tanggal("2026-11-01"), tanggal("2026-11-30")).await.unwrap();
    assert!(daftar.iter().all(|d| d.id != transaksi.id));
    // Baris tetap ada di database (soft delete), dan audit mencatat penghapusannya.
    assert_eq!(jumlah_audit(&db.pool, "delete", transaksi.id).await, 1);

    db.hapus().await;
}

#[tokio::test]
async fn transaksi_tenant_lain_tidak_bisa_diubah_atau_dihapus() {
    let Some(db) = common::baru().await else { return };

    let org_a = db::buat_organisasi(&db.pool, "Org A", "org-a").await.unwrap();
    let org_b = db::buat_organisasi(&db.pool, "Org B", "org-b").await.unwrap();
    let pengguna = db::buat_pengguna(&db.pool, "Pencatat", "pencatat@example.test", "hash").await.unwrap();
    let ta = Tenant::new(db.pool.clone(), org_a.id);
    let tb = Tenant::new(db.pool.clone(), org_b.id);

    let rek = ta
        .buat_rekening(NewRekening {
            nama: "Kas A".into(),
            jenis: JenisRekening::Kas,
            saldo_awal: Decimal::ZERO,
        })
        .await
        .unwrap();
    let transaksi = ta
        .buat_transaksi(NewTransaksi {
            rekening_id: rek.id,
            kategori_id: None,
            tipe: TipeTransaksi::Pemasukan,
            jumlah: Decimal::from(1_000),
            tanggal: tanggal("2026-11-01"),
            catatan: None,
            dibuat_oleh: pengguna,
        })
        .await
        .unwrap();

    let ubah = tb
        .ubah_transaksi_oleh(
            transaksi.id,
            UbahTransaksi {
                rekening_id: rek.id,
                kategori_id: None,
                tipe: TipeTransaksi::Pemasukan,
                jumlah: Decimal::from(9_999),
                tanggal: tanggal("2026-11-01"),
                catatan: None,
            },
            pengguna,
        )
        .await;
    assert!(matches!(ubah, Err(Error::NotFound { .. })));

    let hapus = tb.hapus_transaksi_oleh(transaksi.id, pengguna).await;
    assert!(matches!(hapus, Err(Error::NotFound { .. })));

    // Data organisasi A tidak berubah.
    assert_eq!(ta.saldo_rekening(rek.id).await.unwrap(), Some(Decimal::from(1_000)));

    db.hapus().await;
}

#[tokio::test]
async fn transfer_tidak_bisa_diubah_atau_dihapus_langsung() {
    let Some(db) = common::baru().await else { return };

    let org = db::buat_organisasi(&db.pool, "Org", "org").await.unwrap();
    let pengguna = db::buat_pengguna(&db.pool, "Pencatat", "pencatat@example.test", "hash").await.unwrap();
    let t = Tenant::new(db.pool.clone(), org.id);

    let asal = t
        .buat_rekening(NewRekening {
            nama: "Kas".into(),
            jenis: JenisRekening::Kas,
            saldo_awal: Decimal::from(50_000),
        })
        .await
        .unwrap();
    let tujuan = t
        .buat_rekening(NewRekening {
            nama: "Bank".into(),
            jenis: JenisRekening::Bank,
            saldo_awal: Decimal::ZERO,
        })
        .await
        .unwrap();
    t.buat_transfer(NewTransfer {
        rekening_asal_id: asal.id,
        rekening_tujuan_id: tujuan.id,
        jumlah: Decimal::from(10_000),
        tanggal: tanggal("2026-11-01"),
        catatan: None,
        dibuat_oleh: pengguna,
    })
    .await
    .unwrap();

    // Baris keluar dari transfer tidak boleh diubah atau dihapus sendirian.
    let baris_keluar = t
        .daftar_transaksi(tanggal("2026-11-01"), tanggal("2026-11-01"))
        .await
        .unwrap()
        .into_iter()
        .find(|d| d.transfer_id.is_some())
        .expect("baris transfer ada");

    let ubah = t
        .ubah_transaksi_oleh(
            baris_keluar.id,
            UbahTransaksi {
                rekening_id: asal.id,
                kategori_id: None,
                tipe: TipeTransaksi::Pengeluaran,
                jumlah: Decimal::from(1),
                tanggal: tanggal("2026-11-01"),
                catatan: None,
            },
            pengguna,
        )
        .await;
    assert!(matches!(ubah, Err(Error::Validasi(_))));

    let hapus = t.hapus_transaksi_oleh(baris_keluar.id, pengguna).await;
    assert!(matches!(hapus, Err(Error::Validasi(_))));

    assert_eq!(t.saldo_rekening(asal.id).await.unwrap(), Some(Decimal::from(40_000)));

    db.hapus().await;
}
