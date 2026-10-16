// Service analitik admin. Terpisah dari API aplikasi (backend/) dan hanya membaca database.
// Konfigurasi lewat env (lihat .env.example). Semua endpoint kecuali kesehatan butuh admin.

mod admin;
mod metrik;

use std::collections::HashSet;
use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::{header, HeaderValue, Method};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use sqlx::mysql::MySqlPoolOptions;
use sqlx::MySqlPool;
use tower_http::cors::CorsLayer;

use admin::Admin;
use metrik::RentangError;

#[derive(Clone)]
pub struct AppState {
    pub pool: MySqlPool,
    pub admin_emails: Arc<HashSet<String>>,
}

#[derive(Deserialize)]
struct RentangQuery {
    dari: String,
    sampai: String,
}

fn rentang_gagal(e: RentangError) -> Response {
    (axum::http::StatusCode::UNPROCESSABLE_ENTITY, Json(serde_json::json!({ "pesan": e.to_string() }))).into_response()
}

fn galat_server(e: sqlx::Error) -> Response {
    eprintln!("analitik: {e}");
    (
        axum::http::StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "pesan": "Terjadi masalah di server. Coba lagi sebentar lagi." })),
    )
        .into_response()
}

async fn kesehatan() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok" }))
}

async fn ringkasan(_: Admin, State(st): State<AppState>) -> Response {
    match metrik::ringkasan(&st.pool).await {
        Ok(r) => Json(r).into_response(),
        Err(e) => galat_server(e),
    }
}

async fn pendaftaran(_: Admin, State(st): State<AppState>, Query(q): Query<RentangQuery>) -> Response {
    let (dari, sampai) = match metrik::parse_rentang(&q.dari, &q.sampai) {
        Ok(r) => r,
        Err(e) => return rentang_gagal(e),
    };
    match metrik::pendaftaran(&st.pool, dari, sampai).await {
        Ok(data) => Json(data).into_response(),
        Err(e) => galat_server(e),
    }
}

async fn transaksi(_: Admin, State(st): State<AppState>, Query(q): Query<RentangQuery>) -> Response {
    let (dari, sampai) = match metrik::parse_rentang(&q.dari, &q.sampai) {
        Ok(r) => r,
        Err(e) => return rentang_gagal(e),
    };
    match metrik::transaksi(&st.pool, dari, sampai).await {
        Ok(data) => Json(data).into_response(),
        Err(e) => galat_server(e),
    }
}

fn router(st: AppState) -> Router {
    Router::new()
        .route("/api/v1/analitik/kesehatan", get(kesehatan))
        .route("/api/v1/analitik/ringkasan", get(ringkasan))
        .route("/api/v1/analitik/pendaftaran", get(pendaftaran))
        .route("/api/v1/analitik/transaksi", get(transaksi))
        .with_state(st)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    // Sebaiknya user MySQL yang hanya punya hak SELECT, supaya service ini tidak bisa mengubah data.
    let url = std::env::var("ANALITIK_DATABASE_URL").map_err(|_| "ANALITIK_DATABASE_URL wajib diisi")?;
    let bind = std::env::var("ANALITIK_BIND").unwrap_or_else(|_| "127.0.0.1:8100".to_string());
    let admin_emails = admin::parse_admin_emails(&std::env::var("ADMIN_EMAILS").unwrap_or_default());
    if admin_emails.is_empty() {
        eprintln!("ADMIN_EMAILS kosong: semua permintaan analitik akan ditolak.");
    }
    // Origin dashboard admin (frontend). Hanya origin ini yang boleh memanggil dari browser.
    let origin = std::env::var("ANALITIK_CORS_ORIGIN").unwrap_or_else(|_| "http://localhost:4322".to_string());
    let cors = CorsLayer::new()
        .allow_origin(HeaderValue::from_str(&origin)?)
        .allow_methods([Method::GET])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]);

    // Koneksi dibuat saat dipakai, jadi service tetap hidup (misal untuk kesehatan) walau database sedang mati.
    let pool = MySqlPoolOptions::new().max_connections(5).connect_lazy(&url)?;
    let app = router(AppState {
        pool,
        admin_emails: Arc::new(admin_emails),
    })
    .layer(cors);

    let listener = tokio::net::TcpListener::bind(&bind).await?;
    println!("analitik mendengarkan di {bind}");
    axum::serve(listener, app).await?;
    Ok(())
}
