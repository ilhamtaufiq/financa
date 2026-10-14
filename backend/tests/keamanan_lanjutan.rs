mod common;

use std::sync::{Arc, Mutex};

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use axum::Router;
use financa_api::http::{router, router_dengan};
use financa_api::pengirim::{Kirim, Pengirim};
use serde_json::{json, Value};
use tower::ServiceExt;

const KATA_SANDI: &str = "rahasia-123";

/// Pengirim palsu: menyimpan (tujuan, isi) supaya tes bisa mengambil token reset.
#[derive(Default)]
struct PengirimTangkap {
    pesan: Mutex<Vec<(String, String)>>,
}

impl Pengirim for PengirimTangkap {
    fn kirim<'a>(&'a self, ke: &'a str, _subjek: &'a str, isi: &'a str) -> Kirim<'a> {
        Box::pin(async move {
            self.pesan.lock().unwrap().push((ke.to_string(), isi.to_string()));
            Ok(())
        })
    }
}

impl PengirimTangkap {
    fn token_terakhir(&self) -> Option<String> {
        let pesan = self.pesan.lock().unwrap();
        let (_, isi) = pesan.last()?;
        let awal = isi.find("?token=")? + "?token=".len();
        Some(isi[awal..].split_whitespace().next()?.to_string())
    }

    fn jumlah(&self) -> usize {
        self.pesan.lock().unwrap().len()
    }
}

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

async fn daftar_masuk(app: &Router, email: &str, kata_sandi: &str) -> (u64, String) {
    let (status, _) = kirim(app, "POST", "/api/v1/auth/daftar", None,
        Some(json!({"nama": "Pengguna", "email": email, "kata_sandi": kata_sandi}))).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let (status, sesi) = kirim(app, "POST", "/api/v1/auth/masuk", None,
        Some(json!({"email": email, "kata_sandi": kata_sandi}))).await;
    assert_eq!(status, StatusCode::OK);
    let token = sesi["token"].as_str().unwrap().to_string();
    let (_, saya) = kirim(app, "GET", "/api/v1/auth/saya", Some(&token), None).await;
    (saya["id"].as_u64().unwrap(), token)
}

/// Pemilik dengan satu organisasi dan dua rekening aktif.
async fn organisasi_dua_rekening(app: &Router) -> (u64, String, u64, u64, u64) {
    let (id, token) = daftar_masuk(app, &email_unik(), KATA_SANDI).await;
    let (_, org) = kirim(app, "POST", "/api/v1/organisasi", Some(&token), Some(json!({"nama": "Org"}))).await;
    let org_id = org["id"].as_u64().unwrap();
    let base = format!("/api/v1/organisasi/{org_id}");
    let (_, a) = kirim(app, "POST", &format!("{base}/rekening"), Some(&token),
        Some(json!({"nama": "Kas", "jenis": "kas", "saldo_awal": "100000.00"}))).await;
    let (_, b) = kirim(app, "POST", &format!("{base}/rekening"), Some(&token),
        Some(json!({"nama": "Bank", "jenis": "bank"}))).await;
    (id, token, org_id, a["id"].as_u64().unwrap(), b["id"].as_u64().unwrap())
}

#[tokio::test]
async fn kirim_ulang_transaksi_dengan_client_uuid_tidak_membuat_duplikat() {
    let Some(db) = common::baru().await else { return };
    let app = router(db.pool.clone());
    let (_, token, org_id, kas, _) = organisasi_dua_rekening(&app).await;
    let base = format!("/api/v1/organisasi/{org_id}");
    let uuid = uuid::Uuid::new_v4().to_string();
    let body = json!({"rekening_id": kas, "tipe": "pengeluaran", "jumlah": "2500.00",
                      "tanggal": "2026-10-05", "client_uuid": uuid});

    let (status1, t1) = kirim(&app, "POST", &format!("{base}/transaksi"), Some(&token), Some(body.clone())).await;
    let (status2, t2) = kirim(&app, "POST", &format!("{base}/transaksi"), Some(&token), Some(body)).await;
    assert_eq!(status1, StatusCode::CREATED);
    assert_eq!(status2, StatusCode::OK);
    assert_eq!(t1["id"], t2["id"]);

    let jumlah: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fn_transaksi WHERE organisasi_id = ? AND client_uuid = ?")
        .bind(org_id)
        .bind(&uuid)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(jumlah, 1);

    // UUID yang tidak valid ditolak.
    let (status, _) = kirim(&app, "POST", &format!("{base}/transaksi"), Some(&token),
        Some(json!({"rekening_id": kas, "tipe": "pemasukan", "jumlah": "1.00",
                    "tanggal": "2026-10-05", "client_uuid": "bukan-uuid"}))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    db.hapus().await;
}

#[tokio::test]
async fn kirim_ulang_transfer_dengan_client_uuid_mengembalikan_transfer_yang_sama() {
    let Some(db) = common::baru().await else { return };
    let app = router(db.pool.clone());
    let (_, token, org_id, kas, bank) = organisasi_dua_rekening(&app).await;
    let base = format!("/api/v1/organisasi/{org_id}");
    let uuid = uuid::Uuid::new_v4().to_string();
    let body = json!({"rekening_asal_id": kas, "rekening_tujuan_id": bank,
                      "jumlah": "3000.00", "tanggal": "2026-10-06", "client_uuid": uuid});

    let (status1, t1) = kirim(&app, "POST", &format!("{base}/transfer"), Some(&token), Some(body.clone())).await;
    let (status2, t2) = kirim(&app, "POST", &format!("{base}/transfer"), Some(&token), Some(body)).await;
    assert_eq!(status1, StatusCode::CREATED);
    assert_eq!(status2, StatusCode::OK);
    assert_eq!(t1["transfer_id"], t2["transfer_id"]);
    assert_eq!(t2["masuk"]["tipe"], "transfer_masuk");

    let baris: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fn_transaksi WHERE organisasi_id = ? AND transfer_id = ?")
        .bind(org_id)
        .bind(t1["transfer_id"].as_str().unwrap())
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(baris, 2);

    db.hapus().await;
}

#[tokio::test]
async fn audit_rekening_dan_kategori_tercatat_dengan_pelaku() {
    let Some(db) = common::baru().await else { return };
    let app = router(db.pool.clone());
    let (id_pemilik, token, org_id, kas, _) = organisasi_dua_rekening(&app).await;
    let base = format!("/api/v1/organisasi/{org_id}");

    kirim(&app, "PATCH", &format!("{base}/rekening/{kas}"), Some(&token), Some(json!({"nama": "Kas Utama"}))).await;
    kirim(&app, "POST", &format!("{base}/rekening/{kas}/arsip"), Some(&token), None).await;
    // Arsip kedua tidak mengubah apa pun, jadi tidak ada audit tambahan.
    kirim(&app, "POST", &format!("{base}/rekening/{kas}/arsip"), Some(&token), None).await;
    kirim(&app, "POST", &format!("{base}/kategori"), Some(&token), Some(json!({"tipe": "pemasukan", "nama": "Lain"}))).await;

    let aksi: Vec<(String, String)> = sqlx::query_as(
        "SELECT entitas, aksi FROM fn_audit_log WHERE organisasi_id = ? ORDER BY id",
    )
    .bind(org_id)
    .fetch_all(&db.pool)
    .await
    .unwrap();
    let daftar: Vec<(&str, &str)> = aksi.iter().map(|(e, a)| (e.as_str(), a.as_str())).collect();
    assert_eq!(
        daftar,
        vec![
            ("rekening", "create"),
            ("rekening", "create"),
            ("rekening", "update"),
            ("rekening", "archive"),
            ("kategori", "create"),
        ]
    );

    let pelaku_salah: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM fn_audit_log WHERE organisasi_id = ? AND pengguna_id IS NOT NULL AND pengguna_id <> ?",
    )
    .bind(org_id)
    .bind(id_pemilik)
    .fetch_one(&db.pool)
    .await
    .unwrap();
    assert_eq!(pelaku_salah, 0);

    db.hapus().await;
}

#[tokio::test]
async fn reset_kata_sandi_lewat_tautan_dan_mencabut_sesi() {
    let Some(db) = common::baru().await else { return };
    let tangkap = Arc::new(PengirimTangkap::default());
    let app = router_dengan(db.pool.clone(), tangkap.clone(), "http://localhost:4322/reset".to_string());
    let email = email_unik();
    let (_, token_lama) = daftar_masuk(&app, &email, KATA_SANDI).await;

    let sebelum = tangkap.jumlah();
    let (status, _) = kirim(&app, "POST", "/api/v1/auth/lupa-kata-sandi", None, Some(json!({"email": email}))).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(tangkap.jumlah(), sebelum + 1);
    let token_reset = tangkap.token_terakhir().expect("token reset tidak ada di email");

    let (status, _) = kirim(&app, "POST", "/api/v1/auth/reset-kata-sandi", None,
        Some(json!({"token": token_reset, "kata_sandi_baru": "kata-baru-456"}))).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    // Kata sandi lama tidak berlaku lagi, yang baru berlaku.
    let (status, _) = kirim(&app, "POST", "/api/v1/auth/masuk", None,
        Some(json!({"email": email, "kata_sandi": KATA_SANDI}))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = kirim(&app, "POST", "/api/v1/auth/masuk", None,
        Some(json!({"email": email, "kata_sandi": "kata-baru-456"}))).await;
    assert_eq!(status, StatusCode::OK);

    // Sesi lama ikut dicabut.
    let (status, _) = kirim(&app, "GET", "/api/v1/auth/saya", Some(&token_lama), None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Token hanya sekali pakai.
    let (status, _) = kirim(&app, "POST", "/api/v1/auth/reset-kata-sandi", None,
        Some(json!({"token": token_reset, "kata_sandi_baru": "kata-lain-789"}))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    db.hapus().await;
}

#[tokio::test]
async fn lupa_kata_sandi_untuk_email_tidak_terdaftar_tetap_202_tanpa_email() {
    let Some(db) = common::baru().await else { return };
    let tangkap = Arc::new(PengirimTangkap::default());
    let app = router_dengan(db.pool.clone(), tangkap.clone(), "http://localhost:4322/reset".to_string());

    let (status, _) = kirim(&app, "POST", "/api/v1/auth/lupa-kata-sandi", None,
        Some(json!({"email": email_unik()}))).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(tangkap.jumlah(), 0);

    db.hapus().await;
}

#[tokio::test]
async fn daftar_email_yang_sudah_ada_tetap_202_tanpa_akun_baru() {
    let Some(db) = common::baru().await else { return };
    let tangkap = Arc::new(PengirimTangkap::default());
    let app = router_dengan(db.pool.clone(), tangkap.clone(), "http://localhost:4322/reset".to_string());
    let email = email_unik();
    let body = json!({"nama": "Pengguna", "email": email, "kata_sandi": KATA_SANDI});

    let (status_baru, _) = kirim(&app, "POST", "/api/v1/auth/daftar", None, Some(body.clone())).await;
    let (status_ulang, _) = kirim(&app, "POST", "/api/v1/auth/daftar", None, Some(body)).await;

    // Respons sama untuk email baru dan email yang sudah ada.
    assert_eq!(status_baru, StatusCode::ACCEPTED);
    assert_eq!(status_ulang, StatusCode::ACCEPTED);

    let akun: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fn_pengguna WHERE email = ?")
        .bind(&email)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(akun, 1);

    // Email selamat datang untuk yang baru, pemberitahuan untuk yang sudah ada.
    assert_eq!(tangkap.jumlah(), 2);

    db.hapus().await;
}

#[tokio::test]
async fn reset_dengan_token_palsu_ditolak() {
    let Some(db) = common::baru().await else { return };
    let app = router(db.pool.clone());

    let (status, _) = kirim(&app, "POST", "/api/v1/auth/reset-kata-sandi", None,
        Some(json!({"token": "palsu", "kata_sandi_baru": "kata-baru-456"}))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    db.hapus().await;
}
