mod common;

use chrono::{Duration, Utc};
use financa_api::auth;
use financa_api::db;
use financa_api::undangan::{self, Terima};

#[tokio::test]
async fn undangan_diterima_dan_menjadi_anggota() {
    let Some(db) = common::baru().await else { return };

    let org = db::buat_organisasi(&db.pool, "Org", "org").await.unwrap();
    let pemilik = db::buat_pengguna(&db.pool, "Pemilik", "pemilik@example.test", "hash").await.unwrap();
    let tamu = db::buat_pengguna(&db.pool, "Tamu", "tamu@example.test", "hash").await.unwrap();
    db::tambah_anggota(&db.pool, org.id, pemilik, "owner").await.unwrap();

    let token = auth::buat_token();
    undangan::buat(
        &db.pool,
        org.id,
        "tamu@example.test",
        "anggota",
        &token.token_hash,
        pemilik,
        Utc::now() + Duration::days(7),
    )
    .await
    .unwrap();

    let menunggu = undangan::daftar_menunggu(&db.pool, org.id).await.unwrap();
    assert_eq!(menunggu.len(), 1);
    assert_eq!(menunggu[0].email, "tamu@example.test");

    let hasil = undangan::terima(&db.pool, &token.token_hash, tamu, "tamu@example.test").await.unwrap();
    assert_eq!(hasil, Terima::Berhasil { organisasi_id: org.id });
    assert_eq!(db::peran_anggota(&db.pool, org.id, tamu).await.unwrap().as_deref(), Some("anggota"));

    // Sudah dipakai: tidak bisa diterima dua kali, dan tidak muncul lagi sebagai menunggu.
    let ulang = undangan::terima(&db.pool, &token.token_hash, tamu, "tamu@example.test").await.unwrap();
    assert_eq!(ulang, Terima::Tidak);
    assert!(undangan::daftar_menunggu(&db.pool, org.id).await.unwrap().is_empty());

    db.hapus().await;
}

#[tokio::test]
async fn email_lain_tidak_bisa_menerima_undangan() {
    let Some(db) = common::baru().await else { return };

    let org = db::buat_organisasi(&db.pool, "Org", "org").await.unwrap();
    let pemilik = db::buat_pengguna(&db.pool, "Pemilik", "pemilik@example.test", "hash").await.unwrap();
    let lain = db::buat_pengguna(&db.pool, "Lain", "lain@example.test", "hash").await.unwrap();

    let token = auth::buat_token();
    undangan::buat(
        &db.pool,
        org.id,
        "tamu@example.test",
        "admin",
        &token.token_hash,
        pemilik,
        Utc::now() + Duration::days(7),
    )
    .await
    .unwrap();

    let hasil = undangan::terima(&db.pool, &token.token_hash, lain, "lain@example.test").await.unwrap();
    assert_eq!(hasil, Terima::EmailBeda);
    assert!(db::peran_anggota(&db.pool, org.id, lain).await.unwrap().is_none());

    // Undangan tetap menunggu, karena penerima yang salah tidak memakainya.
    assert_eq!(undangan::daftar_menunggu(&db.pool, org.id).await.unwrap().len(), 1);

    db.hapus().await;
}

#[tokio::test]
async fn token_salah_dan_kedaluwarsa_ditolak() {
    let Some(db) = common::baru().await else { return };

    let org = db::buat_organisasi(&db.pool, "Org", "org").await.unwrap();
    let pemilik = db::buat_pengguna(&db.pool, "Pemilik", "pemilik@example.test", "hash").await.unwrap();
    let tamu = db::buat_pengguna(&db.pool, "Tamu", "tamu@example.test", "hash").await.unwrap();

    let kedaluwarsa = auth::buat_token();
    undangan::buat(
        &db.pool,
        org.id,
        "tamu@example.test",
        "anggota",
        &kedaluwarsa.token_hash,
        pemilik,
        Utc::now() - Duration::minutes(1),
    )
    .await
    .unwrap();

    let salah = auth::hash_token("token-yang-tidak-ada");
    assert_eq!(undangan::terima(&db.pool, &salah, tamu, "tamu@example.test").await.unwrap(), Terima::Tidak);
    assert_eq!(
        undangan::terima(&db.pool, &kedaluwarsa.token_hash, tamu, "tamu@example.test").await.unwrap(),
        Terima::Tidak
    );
    assert!(db::peran_anggota(&db.pool, org.id, tamu).await.unwrap().is_none());

    db.hapus().await;
}

#[tokio::test]
async fn sudah_anggota_tidak_dibuatkan_keanggotaan_ganda() {
    let Some(db) = common::baru().await else { return };

    let org = db::buat_organisasi(&db.pool, "Org", "org").await.unwrap();
    let pemilik = db::buat_pengguna(&db.pool, "Pemilik", "pemilik@example.test", "hash").await.unwrap();
    let tamu = db::buat_pengguna(&db.pool, "Tamu", "tamu@example.test", "hash").await.unwrap();
    db::tambah_anggota(&db.pool, org.id, tamu, "anggota").await.unwrap();

    let token = auth::buat_token();
    undangan::buat(
        &db.pool,
        org.id,
        "tamu@example.test",
        "admin",
        &token.token_hash,
        pemilik,
        Utc::now() + Duration::days(7),
    )
    .await
    .unwrap();

    let hasil = undangan::terima(&db.pool, &token.token_hash, tamu, "tamu@example.test").await.unwrap();
    assert_eq!(hasil, Terima::SudahAnggota);
    // Peran lama tidak berubah oleh undangan baru.
    assert_eq!(db::peran_anggota(&db.pool, org.id, tamu).await.unwrap().as_deref(), Some("anggota"));

    db.hapus().await;
}
