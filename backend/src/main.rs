use std::error::Error;
use std::sync::Arc;

use axum::http::{header, Method};
use financa_api::http::router_dengan;
use financa_api::pengirim::{Pengirim, PengirimNonaktif, PengirimSmtp};
use financa_api::db;
use tower_http::cors::{AllowOrigin, CorsLayer};

// Konfigurasi lewat env:
// - DATABASE_URL (wajib): mysql://user:pass@host:port/db
// - BIND (default 127.0.0.1:8000): hanya localhost secara default
// - CORS_ORIGIN (default http://localhost:4322): origin frontend, boleh lebih dari satu dipisah koma
// - SMTP_URL (opsional): smtps://user:pass@host:465. Tanpa ini, reset kata sandi tidak terkirim.
// - SMTP_DARI (default noreply@financa.local): alamat pengirim email
// - FRONTEND_RESET_URL (default http://localhost:4322/reset): halaman reset di frontend
//
// Autentikasi: token Bearer dari /api/v1/auth/masuk. Deploy publik hanya lewat
// reverse proxy HTTPS (Coolify). Jangan bind langsung ke alamat publik tanpa TLS.

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Membaca file .env di folder kerja (jika ada). Variabel yang sudah ada di env tidak ditimpa.
    dotenvy::dotenv().ok();

    let url = std::env::var("DATABASE_URL").map_err(|_| "DATABASE_URL wajib diisi")?;
    let bind = std::env::var("BIND").unwrap_or_else(|_| "127.0.0.1:8000".to_string());
    let origin = std::env::var("CORS_ORIGIN").unwrap_or_else(|_| "http://localhost:4322".to_string());
    let origin_diizinkan = origin
        .split(',')
        .map(|o| o.trim().parse())
        .collect::<Result<Vec<axum::http::HeaderValue>, _>>()?;
    let dari = std::env::var("SMTP_DARI").unwrap_or_else(|_| "noreply@financa.local".to_string());
    let tautan_reset =
        std::env::var("FRONTEND_RESET_URL").unwrap_or_else(|_| "http://localhost:4322/reset".to_string());

    let pengirim: Arc<dyn Pengirim> = match std::env::var("SMTP_URL") {
        Ok(smtp) => Arc::new(PengirimSmtp::dari_url(&smtp, &dari)?),
        Err(_) => {
            eprintln!("SMTP_URL belum diatur: reset kata sandi tidak bisa dikirim");
            Arc::new(PengirimNonaktif)
        }
    };

    let pool = db::connect(&url).await?;
    db::migrate(&pool).await?;

    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origin_diizinkan))
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]);

    let app = router_dengan(pool, pengirim, tautan_reset).layer(cors);

    eprintln!("financa-api mendengarkan di http://{bind}");
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
