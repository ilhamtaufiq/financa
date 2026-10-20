// Undangan anggota organisasi lewat email. Yang disimpan hanya hash token, bukan token asli.
// Dipanggil dari handler di http.rs. Owner tidak bisa diundang, jadi peran undangan hanya admin atau anggota.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::{FromRow, MySqlPool};

use crate::error::Result;

#[derive(Debug, FromRow, Serialize)]
pub struct UndanganMenunggu {
    pub id: u64,
    pub email: String,
    pub peran: String,
    pub expires_at: DateTime<Utc>,
}

/// Hasil menerima undangan. `Tidak` mencakup token salah, sudah dipakai, dan kedaluwarsa dengan alasan yang sama.
#[derive(Debug, PartialEq)]
pub enum Terima {
    Berhasil { organisasi_id: u64 },
    Tidak,
    EmailBeda,
    SudahAnggota,
}

pub async fn buat(
    pool: &MySqlPool,
    organisasi_id: u64,
    email: &str,
    peran: &str,
    token_hash: &str,
    dibuat_oleh: u64,
    kedaluwarsa: DateTime<Utc>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO fn_undangan (organisasi_id, email, peran, token_hash, dibuat_oleh, expires_at) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(organisasi_id)
    .bind(email)
    .bind(peran)
    .bind(token_hash)
    .bind(dibuat_oleh)
    .bind(kedaluwarsa)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn daftar_menunggu(pool: &MySqlPool, organisasi_id: u64) -> Result<Vec<UndanganMenunggu>> {
    let baris = sqlx::query_as::<_, UndanganMenunggu>(
        "SELECT id, email, CAST(peran AS CHAR) AS peran, expires_at FROM fn_undangan \
         WHERE organisasi_id = ? AND used_at IS NULL AND expires_at > ? \
         ORDER BY created_at DESC",
    )
    .bind(organisasi_id)
    .bind(Utc::now())
    .fetch_all(pool)
    .await?;
    Ok(baris)
}

/// Menerima undangan dalam satu transaksi. Undangan ditandai terpakai hanya jika keanggotaan berhasil dibuat.
pub async fn terima(pool: &MySqlPool, token_hash: &str, pengguna_id: u64, email_pengguna: &str) -> Result<Terima> {
    let mut tx = pool.begin().await?;

    let undangan = sqlx::query_as::<_, (u64, u64, String, String)>(
        "SELECT id, organisasi_id, email, CAST(peran AS CHAR) FROM fn_undangan \
         WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? FOR UPDATE",
    )
    .bind(token_hash)
    .bind(Utc::now())
    .fetch_optional(&mut *tx)
    .await?;

    let Some((undangan_id, organisasi_id, email, peran)) = undangan else {
        tx.rollback().await?;
        return Ok(Terima::Tidak);
    };
    if email != email_pengguna.to_lowercase() {
        tx.rollback().await?;
        return Ok(Terima::EmailBeda);
    }

    let sudah: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM fn_keanggotaan WHERE organisasi_id = ? AND pengguna_id = ?")
        .bind(organisasi_id)
        .bind(pengguna_id)
        .fetch_one(&mut *tx)
        .await?;
    if sudah > 0 {
        tx.rollback().await?;
        return Ok(Terima::SudahAnggota);
    }

    sqlx::query("INSERT INTO fn_keanggotaan (organisasi_id, pengguna_id, peran) VALUES (?, ?, ?)")
        .bind(organisasi_id)
        .bind(pengguna_id)
        .bind(&peran)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE fn_undangan SET used_at = ? WHERE id = ?")
        .bind(Utc::now())
        .bind(undangan_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(Terima::Berhasil { organisasi_id })
}
