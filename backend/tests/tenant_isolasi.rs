mod common;

use chrono::NaiveDate;
use financa_api::db;
use financa_api::model::{JenisRekening, NewKategori, NewRekening, NewTransaksi, TipeKategori, TipeTransaksi};
use financa_api::{Error, Tenant};
use rust_decimal::Decimal;

fn rupiah(nilai: i64) -> Decimal {
    Decimal::from(nilai)
}

fn tanggal(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

#[tokio::test]
async fn rekening_tidak_bocor_antar_tenant() {
    let Some(db) = common::baru().await else { return };

    let org_a = db::buat_organisasi(&db.pool, "Org A", "org-a").await.unwrap();
    let org_b = db::buat_organisasi(&db.pool, "Org B", "org-b").await.unwrap();
    let ta = Tenant::new(db.pool.clone(), org_a.id);
    let tb = Tenant::new(db.pool.clone(), org_b.id);

    let rek = ta
        .buat_rekening(NewRekening {
            nama: "Kas Org A".into(),
            jenis: JenisRekening::Kas,
            saldo_awal: rupiah(10_000),
        })
        .await
        .unwrap();

    assert!(ta.ambil_rekening(rek.id).await.unwrap().is_some());
    assert!(tb.ambil_rekening(rek.id).await.unwrap().is_none());
    assert!(tb.daftar_rekening().await.unwrap().iter().all(|r| r.id != rek.id));
    assert!(tb.saldo_rekening(rek.id).await.unwrap().is_none());

    db.hapus().await;
}

#[tokio::test]
async fn transaksi_ditolak_jika_rekening_milik_tenant_lain() {
    let Some(db) = common::baru().await else { return };

    let org_a = db::buat_organisasi(&db.pool, "Org A", "org-a").await.unwrap();
    let org_b = db::buat_organisasi(&db.pool, "Org B", "org-b").await.unwrap();
    let user_b = db::buat_pengguna(&db.pool, "Pengguna B", "b@example.test", "hash").await.unwrap();
    let ta = Tenant::new(db.pool.clone(), org_a.id);
    let tb = Tenant::new(db.pool.clone(), org_b.id);

    let rek_a = ta
        .buat_rekening(NewRekening {
            nama: "Bank A".into(),
            jenis: JenisRekening::Bank,
            saldo_awal: rupiah(0),
        })
        .await
        .unwrap();

    let hasil = tb
        .buat_transaksi(NewTransaksi {
            rekening_id: rek_a.id,
            kategori_id: None,
            tipe: TipeTransaksi::Pemasukan,
            jumlah: rupiah(50_000),
            tanggal: tanggal("2026-10-01"),
            catatan: None,
            dibuat_oleh: user_b,
        })
        .await;

    assert!(matches!(hasil, Err(Error::NotFound { entitas: "rekening" })));
    assert!(tb.daftar_transaksi(tanggal("2026-01-01"), tanggal("2026-12-31")).await.unwrap().is_empty());

    db.hapus().await;
}

#[tokio::test]
async fn kategori_tenant_lain_ditolak_dan_default_diterima() {
    let Some(db) = common::baru().await else { return };

    let org_a = db::buat_organisasi(&db.pool, "Org A", "org-a").await.unwrap();
    let org_b = db::buat_organisasi(&db.pool, "Org B", "org-b").await.unwrap();
    let user_b = db::buat_pengguna(&db.pool, "Pengguna B", "b@example.test", "hash").await.unwrap();
    let ta = Tenant::new(db.pool.clone(), org_a.id);
    let tb = Tenant::new(db.pool.clone(), org_b.id);

    let kategori_a = ta
        .buat_kategori(NewKategori {
            tipe: TipeKategori::Pengeluaran,
            nama: "Khusus A".into(),
        })
        .await
        .unwrap();

    let kas_b = tb
        .buat_rekening(NewRekening {
            nama: "Kas B".into(),
            jenis: JenisRekening::Kas,
            saldo_awal: rupiah(0),
        })
        .await
        .unwrap();

    // Kategori milik org A tidak boleh dipakai org B.
    let dengan_kategori_a = tb
        .buat_transaksi(NewTransaksi {
            rekening_id: kas_b.id,
            kategori_id: Some(kategori_a.id),
            tipe: TipeTransaksi::Pengeluaran,
            jumlah: rupiah(1_000),
            tanggal: tanggal("2026-10-02"),
            catatan: None,
            dibuat_oleh: user_b,
        })
        .await;
    assert!(matches!(dengan_kategori_a, Err(Error::NotFound { entitas: "kategori" })));

    // Kategori default global (seed migrasi) harus diterima.
    let default_b = tb
        .daftar_kategori()
        .await
        .unwrap()
        .into_iter()
        .find(|k| k.organisasi_id.is_none() && k.tipe == TipeKategori::Pengeluaran)
        .expect("seed kategori default tidak ditemukan");

    let dengan_default = tb
        .buat_transaksi(NewTransaksi {
            rekening_id: kas_b.id,
            kategori_id: Some(default_b.id),
            tipe: TipeTransaksi::Pengeluaran,
            jumlah: rupiah(1_000),
            tanggal: tanggal("2026-10-02"),
            catatan: None,
            dibuat_oleh: user_b,
        })
        .await;
    assert!(dengan_default.is_ok());

    db.hapus().await;
}

#[tokio::test]
async fn saldo_dihitung_dari_transaksi() {
    let Some(db) = common::baru().await else { return };

    let org = db::buat_organisasi(&db.pool, "Org", "org").await.unwrap();
    let user = db::buat_pengguna(&db.pool, "Pengguna", "p@example.test", "hash").await.unwrap();
    let t = Tenant::new(db.pool.clone(), org.id);

    let kas = t
        .buat_rekening(NewRekening {
            nama: "Kas".into(),
            jenis: JenisRekening::Kas,
            saldo_awal: rupiah(100_000),
        })
        .await
        .unwrap();

    let catat = |tipe, jumlah| NewTransaksi {
        rekening_id: kas.id,
        kategori_id: None,
        tipe,
        jumlah,
        tanggal: tanggal("2026-10-03"),
        catatan: None,
        dibuat_oleh: user,
    };

    t.buat_transaksi(catat(TipeTransaksi::Pemasukan, rupiah(50_000))).await.unwrap();
    t.buat_transaksi(catat(TipeTransaksi::Pengeluaran, rupiah(20_000))).await.unwrap();

    // 100.000,00 + 50.000,00 - 20.000,00 = 130.000,00
    let saldo = t.saldo_rekening(kas.id).await.unwrap();
    assert_eq!(saldo, Some(rupiah(130_000)));

    db.hapus().await;
}

#[tokio::test]
async fn jumlah_nol_atau_negatif_ditolak() {
    let Some(db) = common::baru().await else { return };

    let org = db::buat_organisasi(&db.pool, "Org", "org").await.unwrap();
    let user = db::buat_pengguna(&db.pool, "Pengguna", "p@example.test", "hash").await.unwrap();
    let t = Tenant::new(db.pool.clone(), org.id);

    let kas = t
        .buat_rekening(NewRekening {
            nama: "Kas".into(),
            jenis: JenisRekening::Kas,
            saldo_awal: rupiah(0),
        })
        .await
        .unwrap();

    for jumlah in [rupiah(0), rupiah(-5)] {
        let hasil = t
            .buat_transaksi(NewTransaksi {
                rekening_id: kas.id,
                kategori_id: None,
                tipe: TipeTransaksi::Pemasukan,
                jumlah,
                tanggal: tanggal("2026-10-04"),
                catatan: None,
                dibuat_oleh: user,
            })
            .await;
        assert!(matches!(hasil, Err(Error::JumlahTidakValid)));
    }

    db.hapus().await;
}
