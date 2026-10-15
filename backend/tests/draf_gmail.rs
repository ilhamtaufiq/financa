mod common;

use chrono::NaiveDate;
use financa_api::db;
use financa_api::draf::NewDraf;
use financa_api::model::{JenisRekening, NewRekening};
use financa_api::{Error, Tenant};
use rust_decimal::Decimal;

fn tanggal(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

fn draf(pesan: &str, jumlah: Option<i64>, tipe: Option<&'static str>) -> NewDraf {
    NewDraf {
        sumber_pesan_id: pesan.into(),
        pengirim: Some("notifikasi@bank.example.test".into()),
        keterangan: "Transaksi berhasil".into(),
        jumlah: jumlah.map(Decimal::from),
        tipe,
        tanggal: Some(tanggal("2026-10-12")),
    }
}

#[tokio::test]
async fn pesan_yang_sama_tidak_jadi_dua_draf() {
    let Some(db) = common::baru().await else { return };
    let org = db::buat_organisasi(&db.pool, "Org A", "org-a").await.unwrap();
    let t = Tenant::new(db.pool.clone(), org.id);

    assert!(t.simpan_draf(draf("msg-1", Some(150_000), Some("pengeluaran"))).await.unwrap());
    assert!(!t.simpan_draf(draf("msg-1", Some(150_000), Some("pengeluaran"))).await.unwrap());
    assert_eq!(t.daftar_draf_menunggu().await.unwrap().len(), 1);

    db.hapus().await;
}

#[tokio::test]
async fn setujui_membuat_transaksi_dan_draf_tidak_bisa_diproses_dua_kali() {
    let Some(db) = common::baru().await else { return };
    let org = db::buat_organisasi(&db.pool, "Org A", "org-a").await.unwrap();
    let user = db::buat_pengguna(&db.pool, "Pengguna A", "a@example.test", "hash").await.unwrap();
    let t = Tenant::new(db.pool.clone(), org.id);
    let rek = t
        .buat_rekening(NewRekening {
            nama: "Bank".into(),
            jenis: JenisRekening::Bank,
            saldo_awal: Decimal::ZERO,
        })
        .await
        .unwrap();

    t.simpan_draf(draf("msg-2", Some(150_000), Some("pengeluaran"))).await.unwrap();
    let id = t.daftar_draf_menunggu().await.unwrap()[0].id;

    let transaksi = t.setujui_draf(id, rek.id, None, user).await.unwrap();
    assert_eq!(transaksi.jumlah, Decimal::from(150_000));
    assert!(t.daftar_draf_menunggu().await.unwrap().is_empty());

    let kedua = t.setujui_draf(id, rek.id, None, user).await;
    assert!(matches!(kedua, Err(Error::Validasi(_))));

    db.hapus().await;
}

#[tokio::test]
async fn setujui_ditolak_jika_draf_belum_lengkap() {
    let Some(db) = common::baru().await else { return };
    let org = db::buat_organisasi(&db.pool, "Org A", "org-a").await.unwrap();
    let user = db::buat_pengguna(&db.pool, "Pengguna A", "a@example.test", "hash").await.unwrap();
    let t = Tenant::new(db.pool.clone(), org.id);
    let rek = t
        .buat_rekening(NewRekening {
            nama: "Kas".into(),
            jenis: JenisRekening::Kas,
            saldo_awal: Decimal::ZERO,
        })
        .await
        .unwrap();

    t.simpan_draf(draf("msg-3", None, None)).await.unwrap();
    let id = t.daftar_draf_menunggu().await.unwrap()[0].id;

    let hasil = t.setujui_draf(id, rek.id, None, user).await;
    assert!(matches!(hasil, Err(Error::Validasi(_))));
    // Draf tetap menunggu dan belum membuat transaksi.
    assert_eq!(t.daftar_draf_menunggu().await.unwrap().len(), 1);

    db.hapus().await;
}

#[tokio::test]
async fn draf_tidak_terlihat_dari_organisasi_lain() {
    let Some(db) = common::baru().await else { return };
    let org_a = db::buat_organisasi(&db.pool, "Org A", "org-a").await.unwrap();
    let org_b = db::buat_organisasi(&db.pool, "Org B", "org-b").await.unwrap();
    let ta = Tenant::new(db.pool.clone(), org_a.id);
    let tb = Tenant::new(db.pool.clone(), org_b.id);

    ta.simpan_draf(draf("msg-4", Some(10_000), Some("pemasukan"))).await.unwrap();
    let id = ta.daftar_draf_menunggu().await.unwrap()[0].id;

    assert!(tb.daftar_draf_menunggu().await.unwrap().is_empty());
    assert!(matches!(tb.buang_draf(id).await, Err(Error::NotFound { .. })));

    db.hapus().await;
}
