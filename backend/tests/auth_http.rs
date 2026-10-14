mod common;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use axum::Router;
use financa_api::db;
use financa_api::http::router;
use serde_json::{json, Value};
use tower::ServiceExt;

const KATA_SANDI: &str = "rahasia-123";

async fn kirim(app: &Router, method: &str, uri: &str, token: Option<&str>, body: Option<Value>) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(uri).header("content-type", "application/json");
    if let Some(t) = token {
        req = req.header("authorization", format!("Bearer {t}"));
    }
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let res = app.clone().oneshot(req.body(Body::from(payload)).unwrap()).await.unwrap();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), 1 << 20).await.unwrap();
    let json = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap_or(Value::Null) };
    (status, json)
}

fn email_unik() -> String {
    format!("{}@example.test", uuid::Uuid::new_v4().simple())
}

/// Daftar akun baru lalu masuk. Mengembalikan (id pengguna, token).
async fn daftar_masuk(app: &Router, email: &str) -> (u64, String) {
    let (status, _) = kirim(app, "POST", "/api/v1/auth/daftar", None,
        Some(json!({"nama": "Pengguna", "email": email, "kata_sandi": KATA_SANDI}))).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let (status, sesi) = kirim(app, "POST", "/api/v1/auth/masuk", None,
        Some(json!({"email": email, "kata_sandi": KATA_SANDI}))).await;
    assert_eq!(status, StatusCode::OK);
    let token = sesi["token"].as_str().unwrap().to_string();
    let (_, saya) = kirim(app, "GET", "/api/v1/auth/saya", Some(&token), None).await;
    (saya["id"].as_u64().unwrap(), token)
}

#[tokio::test]
async fn daftar_masuk_saya_dan_keluar() {
    let Some(db) = common::baru().await else { return };
    let app = router(db.pool.clone());
    let email = email_unik();

    let (_, token) = daftar_masuk(&app, &email).await;

    let (status, saya) = kirim(&app, "GET", "/api/v1/auth/saya", Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saya["email"], email);

    // Tanpa token atau token palsu ditolak.
    let (status, _) = kirim(&app, "GET", "/api/v1/auth/saya", None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = kirim(&app, "GET", "/api/v1/auth/saya", Some("token-palsu"), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Keluar mencabut token.
    let (status, _) = kirim(&app, "POST", "/api/v1/auth/keluar", Some(&token), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = kirim(&app, "GET", "/api/v1/auth/saya", Some(&token), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    db.hapus().await;
}

#[tokio::test]
async fn percobaan_masuk_dibatasi_setelah_lima_kegagalan() {
    let Some(db) = common::baru().await else { return };
    let app = router(db.pool.clone());
    let email = email_unik();
    kirim(&app, "POST", "/api/v1/auth/daftar", None,
        Some(json!({"nama": "Pengguna", "email": email, "kata_sandi": KATA_SANDI}))).await;

    for _ in 0..5 {
        let (status, _) = kirim(&app, "POST", "/api/v1/auth/masuk", None,
            Some(json!({"email": email, "kata_sandi": "salah-salah"}))).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    // Setelah lima kegagalan, kata sandi yang benar pun ditolak sampai jendela waktu lewat.
    let (status, _) = kirim(&app, "POST", "/api/v1/auth/masuk", None,
        Some(json!({"email": email, "kata_sandi": KATA_SANDI}))).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);

    db.hapus().await;
}

#[tokio::test]
async fn email_tidak_terdaftar_dan_kata_sandi_salah_sama_responsnya() {
    let Some(db) = common::baru().await else { return };
    let app = router(db.pool.clone());

    let (status, galat_tidak_ada) = kirim(&app, "POST", "/api/v1/auth/masuk", None,
        Some(json!({"email": email_unik(), "kata_sandi": KATA_SANDI}))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let email = email_unik();
    kirim(&app, "POST", "/api/v1/auth/daftar", None,
        Some(json!({"nama": "Pengguna", "email": email, "kata_sandi": KATA_SANDI}))).await;
    let (status, galat_salah) = kirim(&app, "POST", "/api/v1/auth/masuk", None,
        Some(json!({"email": email, "kata_sandi": "salah-salah"}))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    assert_eq!(galat_tidak_ada, galat_salah);

    db.hapus().await;
}

#[tokio::test]
async fn sesi_kedaluwarsa_ditolak() {
    let Some(db) = common::baru().await else { return };
    let app = router(db.pool.clone());
    let email = email_unik();
    let (id, token) = daftar_masuk(&app, &email).await;

    sqlx::query("UPDATE fn_sesi_token SET expires_at = '2020-01-01 00:00:00' WHERE pengguna_id = ?")
        .bind(id)
        .execute(&db.pool)
        .await
        .unwrap();

    let (status, _) = kirim(&app, "GET", "/api/v1/auth/saya", Some(&token), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    db.hapus().await;
}

#[tokio::test]
async fn bukan_anggota_tidak_bisa_mengakses_organisasi() {
    let Some(db) = common::baru().await else { return };
    let app = router(db.pool.clone());
    let (_, token_pemilik) = daftar_masuk(&app, &email_unik()).await;
    let (_, token_lain) = daftar_masuk(&app, &email_unik()).await;

    let (_, org) = kirim(&app, "POST", "/api/v1/organisasi", Some(&token_pemilik),
        Some(json!({"nama": "Org Pemilik"}))).await;
    let base = format!("/api/v1/organisasi/{}", org["id"]);

    let (status, _) = kirim(&app, "GET", &format!("{base}/rekening"), Some(&token_lain), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = kirim(&app, "POST", &format!("{base}/rekening"), Some(&token_lain),
        Some(json!({"nama": "Kas", "jenis": "kas"}))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Organisasi milik orang lain tidak muncul di daftar.
    let (_, daftar) = kirim(&app, "GET", "/api/v1/organisasi", Some(&token_lain), None).await;
    assert_eq!(daftar.as_array().unwrap().len(), 0);

    db.hapus().await;
}

#[tokio::test]
async fn anggota_biasa_tidak_bisa_kelola_tetapi_bisa_catat() {
    let Some(db) = common::baru().await else { return };
    let app = router(db.pool.clone());
    let (_, token_pemilik) = daftar_masuk(&app, &email_unik()).await;
    let (id_anggota, token_anggota) = daftar_masuk(&app, &email_unik()).await;

    let (_, org) = kirim(&app, "POST", "/api/v1/organisasi", Some(&token_pemilik),
        Some(json!({"nama": "Org"}))).await;
    let org_id = org["id"].as_u64().unwrap();
    let base = format!("/api/v1/organisasi/{org_id}");

    let (_, rek) = kirim(&app, "POST", &format!("{base}/rekening"), Some(&token_pemilik),
        Some(json!({"nama": "Kas", "jenis": "kas", "saldo_awal": "1000.00"}))).await;
    let rek_id = rek["id"].as_u64().unwrap();

    db::tambah_anggota(&db.pool, org_id, id_anggota, "anggota").await.unwrap();

    // Anggota boleh membaca dan mencatat transaksi.
    let (status, _) = kirim(&app, "GET", &format!("{base}/rekening"), Some(&token_anggota), None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = kirim(&app, "POST", &format!("{base}/transaksi"), Some(&token_anggota),
        Some(json!({"rekening_id": rek_id, "tipe": "pemasukan", "jumlah": "500.00", "tanggal": "2026-10-03"}))).await;
    assert_eq!(status, StatusCode::CREATED);

    // Tetapi tidak boleh mengelola rekening atau kategori.
    let (status, _) = kirim(&app, "POST", &format!("{base}/rekening"), Some(&token_anggota),
        Some(json!({"nama": "Lain", "jenis": "bank"}))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = kirim(&app, "POST", &format!("{base}/kategori"), Some(&token_anggota),
        Some(json!({"tipe": "pemasukan", "nama": "Baru"}))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    db.hapus().await;
}

#[tokio::test]
async fn audit_tercatat_untuk_transaksi_dan_transfer() {
    let Some(db) = common::baru().await else { return };
    let app = router(db.pool.clone());
    let (id_pemilik, token) = daftar_masuk(&app, &email_unik()).await;

    let (_, org) = kirim(&app, "POST", "/api/v1/organisasi", Some(&token), Some(json!({"nama": "Org"}))).await;
    let org_id = org["id"].as_u64().unwrap();
    let base = format!("/api/v1/organisasi/{org_id}");

    let (_, a) = kirim(&app, "POST", &format!("{base}/rekening"), Some(&token),
        Some(json!({"nama": "Kas", "jenis": "kas", "saldo_awal": "100.00"}))).await;
    let (_, b) = kirim(&app, "POST", &format!("{base}/rekening"), Some(&token),
        Some(json!({"nama": "Bank", "jenis": "bank"}))).await;

    let jumlah_audit = || async {
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM fn_audit_log WHERE organisasi_id = ? AND entitas = 'transaksi'")
            .bind(org_id)
            .fetch_one(&db.pool)
            .await
            .unwrap()
    };
    assert_eq!(jumlah_audit().await, 0);

    let (status, _) = kirim(&app, "POST", &format!("{base}/transaksi"), Some(&token),
        Some(json!({"rekening_id": a["id"], "tipe": "pemasukan", "jumlah": "10.00", "tanggal": "2026-10-04"}))).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(jumlah_audit().await, 1);

    // Transfer menghasilkan dua baris transaksi, jadi dua entri audit.
    let (status, _) = kirim(&app, "POST", &format!("{base}/transfer"), Some(&token),
        Some(json!({"rekening_asal_id": a["id"], "rekening_tujuan_id": b["id"],
                    "jumlah": "5.00", "tanggal": "2026-10-04"}))).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(jumlah_audit().await, 3);

    // Setiap entri mencatat siapa yang melakukannya.
    let pengguna_salah: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fn_audit_log WHERE organisasi_id = ? AND (pengguna_id IS NULL OR pengguna_id <> ?)",
    )
    .bind(org_id)
    .bind(id_pemilik)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(pengguna_salah, 0);

    db.hapus().await;
}
