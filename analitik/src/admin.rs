use std::collections::HashSet;

use axum::extract::FromRequestParts;
use axum::http::{header, request::Parts};
use chrono::Utc;
use sha2::{Digest, Sha256};
use sqlx::MySqlPool;

use crate::AppState;

/// Admin platform yang sudah masuk. Hanya email dalam `ADMIN_EMAILS` yang lolos.
/// Sesi memakai token yang sama dengan aplikasi utama (`Authorization: Bearer <token>`).
pub struct Admin;

/// Membaca `ADMIN_EMAILS` (dipisah koma). Huruf kecil dan spasi dibersihkan.
pub fn parse_admin_emails(teks: &str) -> HashSet<String> {
    teks.split(',')
        .map(|e| e.trim().to_lowercase())
        .filter(|e| !e.is_empty())
        .collect()
}

#[derive(Debug, PartialEq)]
pub enum Tolak {
    /// Tidak ada token, sesi kedaluwarsa, atau token tidak dikenal.
    SesiTidakValid,
    /// Sesi valid, tetapi pemiliknya bukan admin.
    BukanAdmin,
}

impl axum::response::IntoResponse for Tolak {
    fn into_response(self) -> axum::response::Response {
        let (status, pesan) = match self {
            Self::SesiTidakValid => (axum::http::StatusCode::UNAUTHORIZED, "Sesi tidak valid. Masuk lagi."),
            Self::BukanAdmin => (axum::http::StatusCode::FORBIDDEN, "Hanya admin platform yang bisa membuka analitik."),
        };
        (status, axum::Json(serde_json::json!({ "pesan": pesan }))).into_response()
    }
}

fn token_dari_header(headers: &axum::http::HeaderMap) -> Option<&str> {
    headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|t| !t.is_empty())
}

/// Email pemilik sesi aktif, atau `None` jika token tidak ada, salah, atau kedaluwarsa.
pub async fn email_dari_sesi(pool: &MySqlPool, token: &str) -> Result<Option<String>, sqlx::Error> {
    let hash = hex::encode(Sha256::digest(token.as_bytes()));
    sqlx::query_scalar::<_, String>(
        "SELECT p.email FROM fn_sesi_token s \
         JOIN fn_pengguna p ON p.id = s.pengguna_id AND p.deleted_at IS NULL \
         WHERE s.token_hash = ? AND s.expires_at > ?",
    )
    .bind(hash)
    .bind(Utc::now())
    .fetch_optional(pool)
    .await
}

impl FromRequestParts<AppState> for Admin {
    type Rejection = Tolak;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = token_dari_header(&parts.headers).ok_or(Tolak::SesiTidakValid)?;
        let email = email_dari_sesi(&state.pool, token)
            .await
            .map_err(|_| Tolak::SesiTidakValid)?
            .ok_or(Tolak::SesiTidakValid)?;
        if state.admin_emails.contains(&email.to_lowercase()) {
            Ok(Admin)
        } else {
            Err(Tolak::BukanAdmin)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admin_email_dibersihkan() {
        let daftar = parse_admin_emails(" Ilham@Example.com , ,ops@financa.id ");
        assert!(daftar.contains("ilham@example.com"));
        assert!(daftar.contains("ops@financa.id"));
        assert_eq!(daftar.len(), 2);
    }

    #[test]
    fn admin_kosong_tidak_mengizinkan_siapa_pun() {
        assert!(parse_admin_emails("").is_empty());
        assert!(parse_admin_emails(" , ").is_empty());
    }
}
