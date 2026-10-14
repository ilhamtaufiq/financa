mod common;

use axum::body::{to_bytes, Body};
use axum::http::{Request, StatusCode};
use axum::Router;
use financa_api::http::router;
use rust_decimal::Decimal;
use serde_json::{json, Value};
use tower::ServiceExt;

const KATA_SANDI: &str = "rahasia-123";

async fn kirim(app: &Router, method: &str, uri: &str, token: Option<&str>, body: Option<Value>) -> (StatusCode, Value) {
    let mut req = Request::builder().method(method).uri(uri).header("content-type", "application/json");
    if let Some(t) = token {
        req = req.header("authorization", format!("Bearer {t}"));
    }
    let payload = body.map(|b| b.to_string()).unwrap_or_default();
    let req = req.body(Body::from(payload)).unwrap();

    let res = app.clone().oneshot(req).await.unwrap();
    let status = res.status();
    let bytes = to_bytes(res.into_body(), 1 << 20).await.unwrap();
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap_or(Value::Null)
    };
    (status, json)
}

fn email_unik() -> String {
    format!("{}@example.test", uuid::Uuid::new_v4().simple())
}

/// Daftar lalu masuk. Mengembalikan (token, id organisasi yang dibuat pengguna ini).
async fn pemilik_dengan_organisasi(app: &Router, nama_org: &str) -> (String, u64) {
    let email = email_unik();
    let (status, _) = kirim(app, "POST", "/api/v1/auth/daftar", None,
        Some(json!({"nama": "Pemilik", "email": email, "kata_sandi": KATA_SANDI}))).await;
    assert_eq!(status, StatusCode::ACCEPTED);

    let (status, sesi) = kirim(app, "POST", "/api/v1/auth/masuk", None,
        Some(json!({"email": email, "kata_sandi": KATA_SANDI}))).await;
    assert_eq!(status, StatusCode::OK);
    let token = sesi["token"].as_str().unwrap().to_string();

    let (status, org) = kirim(app, "POST", "/api/v1/organisasi", Some(&token),
        Some(json!({"nama": nama_org}))).await;
    assert_eq!(status, StatusCode::CREATED);
    (token, org["id"].as_u64().unwrap())
}

fn desimal(v: &Value) -> Decimal {
    serde_json::from_value(v.clone()).expect("nilai desimal tidak valid")
}

#[tokio::test]
async fn rekening_transaksi_dan_saldo_lewat_http() {
    let Some(db) = common::baru().await else { return };
    let app = router(db.pool.clone());
    let (token, org) = pemilik_dengan_organisasi(&app, "Org").await;
    let base = format!("/api/v1/organisasi/{org}");

    let (status, rek) = kirim(&app, "POST", &format!("{base}/rekening"), Some(&token),
        Some(json!({"nama": "Kas", "jenis": "kas", "saldo_awal": "100000.00"}))).await;
    assert_eq!(status, StatusCode::CREATED);
    let rek_id = rek["id"].as_u64().unwrap();

    for (tipe, jumlah) in [("pemasukan", "50000.00"), ("pengeluaran", "20000.00")] {
        let (status, _) = kirim(&app, "POST", &format!("{base}/transaksi"), Some(&token),
            Some(json!({"rekening_id": rek_id, "tipe": tipe, "jumlah": jumlah, "tanggal": "2026-10-01"}))).await;
        assert_eq!(status, StatusCode::CREATED);
    }

    let (status, detail) = kirim(&app, "GET", &format!("{base}/rekening/{rek_id}"), Some(&token), None).await;
    assert_eq!(status, StatusCode::OK);
    // 100.000,00 + 50.000,00 - 20.000,00
    assert_eq!(desimal(&detail["saldo"]), Decimal::new(13_000_000, 2));

    db.hapus().await;
}

#[tokio::test]
async fn transfer_menghasilkan_dua_baris_dan_saldo_seimbang() {
    let Some(db) = common::baru().await else { return };
    let app = router(db.pool.clone());
    let (token, org) = pemilik_dengan_organisasi(&app, "Org").await;
    let base = format!("/api/v1/organisasi/{org}");

    let (_, a) = kirim(&app, "POST", &format!("{base}/rekening"), Some(&token),
        Some(json!({"nama": "Kas", "jenis": "kas", "saldo_awal": "100000.00"}))).await;
    let (_, b) = kirim(&app, "POST", &format!("{base}/rekening"), Some(&token),
        Some(json!({"nama": "Bank", "jenis": "bank"}))).await;
    let (a_id, b_id) = (a["id"].as_u64().unwrap(), b["id"].as_u64().unwrap());

    let (status, transfer) = kirim(&app, "POST", &format!("{base}/transfer"), Some(&token),
        Some(json!({"rekening_asal_id": a_id, "rekening_tujuan_id": b_id,
                    "jumlah": "30000.00", "tanggal": "2026-10-02"}))).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(transfer["keluar"]["tipe"], "transfer_keluar");
    assert_eq!(transfer["masuk"]["tipe"], "transfer_masuk");
    assert_eq!(transfer["keluar"]["transfer_id"], transfer["transfer_id"]);
    assert_eq!(transfer["masuk"]["transfer_id"], transfer["transfer_id"]);

    let (_, da) = kirim(&app, "GET", &format!("{base}/rekening/{a_id}"), Some(&token), None).await;
    let (_, db_) = kirim(&app, "GET", &format!("{base}/rekening/{b_id}"), Some(&token), None).await;
    assert_eq!(desimal(&da["saldo"]), Decimal::new(7_000_000, 2));
    assert_eq!(desimal(&db_["saldo"]), Decimal::new(3_000_000, 2));

    db.hapus().await;
}

#[tokio::test]
async fn validasi_transfer_dan_transaksi() {
    let Some(db) = common::baru().await else { return };
    let app = router(db.pool.clone());
    let (token, org) = pemilik_dengan_organisasi(&app, "Org").await;
    let base = format!("/api/v1/organisasi/{org}");

    let (_, a) = kirim(&app, "POST", &format!("{base}/rekening"), Some(&token),
        Some(json!({"nama": "Kas", "jenis": "kas"}))).await;
    let a_id = a["id"].as_u64().unwrap();

    // Rekening asal dan tujuan sama.
    let (status, _) = kirim(&app, "POST", &format!("{base}/transfer"), Some(&token),
        Some(json!({"rekening_asal_id": a_id, "rekening_tujuan_id": a_id,
                    "jumlah": "1000.00", "tanggal": "2026-10-02"}))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Tanpa token ditolak.
    let (status, _) = kirim(&app, "POST", &format!("{base}/transfer"), None,
        Some(json!({"rekening_asal_id": a_id, "rekening_tujuan_id": a_id,
                    "jumlah": "1000.00", "tanggal": "2026-10-02"}))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Tipe transfer lewat endpoint transaksi biasa ditolak.
    let (status, _) = kirim(&app, "POST", &format!("{base}/transaksi"), Some(&token),
        Some(json!({"rekening_id": a_id, "tipe": "transfer_masuk",
                    "jumlah": "1000.00", "tanggal": "2026-10-02"}))).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    db.hapus().await;
}

#[tokio::test]
async fn isolasi_tenant_dan_arsip_lewat_http() {
    let Some(db) = common::baru().await else { return };
    let app = router(db.pool.clone());
    let (token_a, org_a) = pemilik_dengan_organisasi(&app, "Org A").await;
    let (token_b, org_b) = pemilik_dengan_organisasi(&app, "Org B").await;
    let base_a = format!("/api/v1/organisasi/{org_a}");
    let base_b = format!("/api/v1/organisasi/{org_b}");

    let (_, rek) = kirim(&app, "POST", &format!("{base_a}/rekening"), Some(&token_a),
        Some(json!({"nama": "Kas A", "jenis": "kas"}))).await;
    let rek_id = rek["id"].as_u64().unwrap();

    // Pemilik org B tidak bisa melihat rekening org A (404, bukan 403).
    let (status, _) = kirim(&app, "GET", &format!("{base_b}/rekening/{rek_id}"), Some(&token_b), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Arsip: hilang dari daftar, dan tidak bisa dipakai untuk transaksi baru.
    let (status, _) = kirim(&app, "POST", &format!("{base_a}/rekening/{rek_id}/arsip"), Some(&token_a), None).await;
    assert_eq!(status, StatusCode::OK);

    let (_, daftar) = kirim(&app, "GET", &format!("{base_a}/rekening"), Some(&token_a), None).await;
    assert!(daftar.as_array().unwrap().iter().all(|r| r["id"] != rek_id));

    let (status, _) = kirim(&app, "POST", &format!("{base_a}/transaksi"), Some(&token_a),
        Some(json!({"rekening_id": rek_id, "tipe": "pemasukan",
                    "jumlah": "1000.00", "tanggal": "2026-10-02"}))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    db.hapus().await;
}
