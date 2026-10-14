//! Kata sandi, token sesi, dan pembatasan percobaan masuk.
//!
//! - Kata sandi di-hash dengan argon2id. Tidak pernah disimpan atau dicatat dalam bentuk asli.
//! - Token sesi adalah 32 byte acak (hex). Database hanya menyimpan SHA-256-nya,
//!   jadi kebocoran tabel tidak langsung memberi akses.
//! - Pembatasan masuk berbasis memori per proses: 5 kegagalan per 15 menit per email.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use rand::rngs::OsRng;
use rand::RngCore;
use sha2::{Digest, Sha256};

use crate::error::{Error, Result};

pub const MASA_BERLAKU_SESI_HARI: i64 = 30;
const MAKS_KEGAGALAN: usize = 5;
const JENDELA_KEGAGALAN: Duration = Duration::from_secs(15 * 60);
const MAKS_KUNCI: usize = 10_000;

pub fn hash_kata_sandi(kata_sandi: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(kata_sandi.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| Error::Internal(format!("hash kata sandi: {e}")))
}

pub fn verifikasi_kata_sandi(kata_sandi: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(kata_sandi.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

/// Hash dummy untuk menyamakan waktu respons saat email tidak terdaftar,
/// supaya penyerang tidak bisa menebak email dari perbedaan waktu.
pub fn hash_dummy() -> &'static str {
    static DUMMY: OnceLock<String> = OnceLock::new();
    DUMMY.get_or_init(|| hash_kata_sandi("dummy-tidak-dipakai").unwrap_or_default())
}

pub struct TokenBaru {
    /// Dikirim ke klien satu kali. Tidak disimpan.
    pub token: String,
    /// Disimpan di `fn_sesi_token.token_hash`.
    pub token_hash: String,
}

pub fn buat_token() -> TokenBaru {
    let mut bytes = [0u8; 32];
    OsRng.fill_bytes(&mut bytes);
    let token = hex::encode(bytes);
    TokenBaru {
        token_hash: hash_token(&token),
        token,
    }
}

pub fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

/// Pembatas percobaan masuk. Hanya mencatat kegagalan; keberhasilan menghapus catatan.
#[derive(Default)]
pub struct PembatasMasuk {
    gagal: Mutex<HashMap<String, Vec<Instant>>>,
}

impl PembatasMasuk {
    pub fn boleh_mencoba(&self, kunci: &str) -> bool {
        let mut peta = self.gagal.lock().unwrap_or_else(|e| e.into_inner());
        let sekarang = Instant::now();
        let riwayat = peta.entry(kunci.to_string()).or_default();
        riwayat.retain(|t| sekarang.duration_since(*t) < JENDELA_KEGAGALAN);
        riwayat.len() < MAKS_KEGAGALAN
    }

    pub fn catat_gagal(&self, kunci: &str) {
        let mut peta = self.gagal.lock().unwrap_or_else(|e| e.into_inner());
        // Batasi ukuran map: buang kunci yang semua catatannya sudah lewat jendela waktu.
        if peta.len() >= MAKS_KUNCI {
            let sekarang = Instant::now();
            peta.retain(|_, riwayat| {
                riwayat.retain(|t| sekarang.duration_since(*t) < JENDELA_KEGAGALAN);
                !riwayat.is_empty()
            });
        }
        peta.entry(kunci.to_string()).or_default().push(Instant::now());
    }

    pub fn reset(&self, kunci: &str) {
        let mut peta = self.gagal.lock().unwrap_or_else(|e| e.into_inner());
        peta.remove(kunci);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_kata_sandi_bisa_diverifikasi() {
        let hash = hash_kata_sandi("rahasia-123").unwrap();
        assert!(verifikasi_kata_sandi("rahasia-123", &hash));
        assert!(!verifikasi_kata_sandi("salah-456", &hash));
        assert!(!verifikasi_kata_sandi("rahasia-123", "bukan-hash"));
    }

    #[test]
    fn token_hash_deterministik_dan_berbeda_dari_token() {
        let t = buat_token();
        assert_eq!(t.token.len(), 64);
        assert_eq!(hash_token(&t.token), t.token_hash);
        assert_ne!(t.token, t.token_hash);
    }

    #[test]
    fn pembatas_memblokir_setelah_lima_kegagalan() {
        let p = PembatasMasuk::default();
        for _ in 0..MAKS_KEGAGALAN {
            assert!(p.boleh_mencoba("a@example.test"));
            p.catat_gagal("a@example.test");
        }
        assert!(!p.boleh_mencoba("a@example.test"));
        assert!(p.boleh_mencoba("b@example.test"));
        p.reset("a@example.test");
        assert!(p.boleh_mencoba("a@example.test"));
    }
}
