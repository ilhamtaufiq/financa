use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::migrate::Migrator;
use sqlx::mysql::{MySqlPool, MySqlPoolOptions};
use sqlx::FromRow;

use crate::error::Result;
use crate::model::Organisasi;

/// Migrasi di-embed saat compile dari folder `migrations/`.
pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

pub async fn connect(url: &str) -> Result<MySqlPool> {
    let pool = MySqlPoolOptions::new().max_connections(5).connect(url).await?;
    Ok(pool)
}

pub async fn migrate(pool: &MySqlPool) -> Result<()> {
    MIGRATOR.run(pool).await?;
    Ok(())
}

/// Membuat organisasi tanpa anggota. Dipakai tes dan seeding.
/// Operasi lintas tenant yang tidak lewat `Tenant`.
pub async fn buat_organisasi(pool: &MySqlPool, nama: &str, slug: &str) -> Result<Organisasi> {
    let hasil = sqlx::query("INSERT INTO fn_organisasi (nama, slug) VALUES (?, ?)")
        .bind(nama)
        .bind(slug)
        .execute(pool)
        .await?;

    Ok(Organisasi {
        id: hasil.last_insert_id(),
        nama: nama.to_string(),
        slug: slug.to_string(),
    })
}

/// Membuat organisasi dan langsung menjadikan `pemilik` sebagai owner, dalam satu transaksi.
pub async fn buat_organisasi_dengan_pemilik(
    pool: &MySqlPool,
    nama: &str,
    pemilik: u64,
) -> Result<Organisasi> {
    let slug = format!("{}-{}", slugify(nama), &uuid::Uuid::new_v4().simple().to_string()[..8]);

    let mut tx = pool.begin().await?;
    let hasil = sqlx::query("INSERT INTO fn_organisasi (nama, slug) VALUES (?, ?)")
        .bind(nama)
        .bind(&slug)
        .execute(&mut *tx)
        .await?;
    let id = hasil.last_insert_id();

    sqlx::query("INSERT INTO fn_keanggotaan (organisasi_id, pengguna_id, peran) VALUES (?, ?, 'owner')")
        .bind(id)
        .bind(pemilik)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Organisasi {
        id,
        nama: nama.to_string(),
        slug,
    })
}

/// Tambah anggota ke organisasi. `peran` harus `owner`, `admin`, atau `anggota`.
pub async fn tambah_anggota(pool: &MySqlPool, organisasi_id: u64, pengguna_id: u64, peran: &str) -> Result<()> {
    sqlx::query("INSERT INTO fn_keanggotaan (organisasi_id, pengguna_id, peran) VALUES (?, ?, ?)")
        .bind(organisasi_id)
        .bind(pengguna_id)
        .bind(peran)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn buat_pengguna(
    pool: &MySqlPool,
    nama: &str,
    email: &str,
    password_hash: &str,
) -> Result<u64> {
    let hasil = sqlx::query("INSERT INTO fn_pengguna (nama, email, password_hash) VALUES (?, ?, ?)")
        .bind(nama)
        .bind(email)
        .bind(password_hash)
        .execute(pool)
        .await?;

    Ok(hasil.last_insert_id())
}

#[derive(Debug, Clone, FromRow)]
pub struct PenggunaAkun {
    pub id: u64,
    pub nama: String,
    pub email: String,
    pub password_hash: String,
}

pub async fn cari_pengguna_by_email(pool: &MySqlPool, email: &str) -> Result<Option<PenggunaAkun>> {
    let baris = sqlx::query_as::<_, PenggunaAkun>(
        "SELECT id, nama, email, password_hash FROM fn_pengguna \
         WHERE email = ? AND deleted_at IS NULL",
    )
    .bind(email)
    .fetch_optional(pool)
    .await?;
    Ok(baris)
}

pub async fn cari_pengguna_by_id(pool: &MySqlPool, id: u64) -> Result<Option<PenggunaAkun>> {
    let baris = sqlx::query_as::<_, PenggunaAkun>(
        "SELECT id, nama, email, password_hash FROM fn_pengguna \
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(baris)
}

pub async fn buat_sesi(
    pool: &MySqlPool,
    pengguna_id: u64,
    token_hash: &str,
    kedaluwarsa: DateTime<Utc>,
) -> Result<()> {
    sqlx::query("INSERT INTO fn_sesi_token (pengguna_id, token_hash, expires_at) VALUES (?, ?, ?)")
        .bind(pengguna_id)
        .bind(token_hash)
        .bind(kedaluwarsa)
        .execute(pool)
        .await?;
    Ok(())
}

/// Pengguna pemilik sesi, jika token belum kedaluwarsa dan akun belum dihapus.
pub async fn cari_sesi(pool: &MySqlPool, token_hash: &str) -> Result<Option<u64>> {
    let id = sqlx::query_scalar::<_, u64>(
        "SELECT s.pengguna_id FROM fn_sesi_token s \
         JOIN fn_pengguna p ON p.id = s.pengguna_id AND p.deleted_at IS NULL \
         WHERE s.token_hash = ? AND s.expires_at > ?",
    )
    .bind(token_hash)
    .bind(Utc::now())
    .fetch_optional(pool)
    .await?;
    Ok(id)
}

pub async fn hapus_sesi(pool: &MySqlPool, token_hash: &str) -> Result<()> {
    sqlx::query("DELETE FROM fn_sesi_token WHERE token_hash = ?")
        .bind(token_hash)
        .execute(pool)
        .await?;
    Ok(())
}

/// Peran pengguna di organisasi, atau `None` jika bukan anggota.
pub async fn peran_anggota(pool: &MySqlPool, organisasi_id: u64, pengguna_id: u64) -> Result<Option<String>> {
    let peran = sqlx::query_scalar::<_, String>(
        "SELECT CAST(k.peran AS CHAR) FROM fn_keanggotaan k \
         JOIN fn_organisasi o ON o.id = k.organisasi_id AND o.deleted_at IS NULL \
         WHERE k.organisasi_id = ? AND k.pengguna_id = ?",
    )
    .bind(organisasi_id)
    .bind(pengguna_id)
    .fetch_optional(pool)
    .await?;
    Ok(peran)
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct OrganisasiSaya {
    pub id: u64,
    pub nama: String,
    pub slug: String,
    pub peran: String,
}

pub async fn daftar_organisasi_pengguna(pool: &MySqlPool, pengguna_id: u64) -> Result<Vec<OrganisasiSaya>> {
    let daftar = sqlx::query_as::<_, OrganisasiSaya>(
        "SELECT o.id, o.nama, o.slug, CAST(k.peran AS CHAR) AS peran \
         FROM fn_keanggotaan k \
         JOIN fn_organisasi o ON o.id = k.organisasi_id AND o.deleted_at IS NULL \
         WHERE k.pengguna_id = ? ORDER BY o.id",
    )
    .bind(pengguna_id)
    .fetch_all(pool)
    .await?;
    Ok(daftar)
}

pub async fn buat_reset_password(
    pool: &MySqlPool,
    pengguna_id: u64,
    token_hash: &str,
    kedaluwarsa: DateTime<Utc>,
) -> Result<()> {
    sqlx::query("INSERT INTO fn_reset_password (pengguna_id, token_hash, expires_at) VALUES (?, ?, ?)")
        .bind(pengguna_id)
        .bind(token_hash)
        .bind(kedaluwarsa)
        .execute(pool)
        .await?;
    Ok(())
}

/// Mengganti kata sandi memakai token reset. Dalam satu transaksi: token ditandai terpakai,
/// kata sandi diganti, dan semua sesi pengguna dicabut. `false` jika token tidak valid,
/// sudah dipakai, atau kedaluwarsa.
pub async fn pakai_reset_password(pool: &MySqlPool, token_hash: &str, hash_baru: &str) -> Result<bool> {
    let mut tx = pool.begin().await?;
    let baris = sqlx::query_as::<_, (u64, u64)>(
        "SELECT id, pengguna_id FROM fn_reset_password \
         WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? FOR UPDATE",
    )
    .bind(token_hash)
    .bind(Utc::now())
    .fetch_optional(&mut *tx)
    .await?;

    let Some((reset_id, pengguna_id)) = baris else {
        tx.rollback().await?;
        return Ok(false);
    };

    sqlx::query("UPDATE fn_reset_password SET used_at = ? WHERE id = ?")
        .bind(Utc::now())
        .bind(reset_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE fn_pengguna SET password_hash = ? WHERE id = ?")
        .bind(hash_baru)
        .bind(pengguna_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM fn_sesi_token WHERE pengguna_id = ?")
        .bind(pengguna_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(true)
}

/// Huruf kecil, a-z dan 0-9 saja, tanda hubung sebagai pemisah. Minimal "org".
fn slugify(nama: &str) -> String {
    let mut out = String::new();
    for c in nama.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let out: String = out.trim_matches('-').chars().take(50).collect();
    if out.is_empty() {
        "org".to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::slugify;

    #[test]
    fn slugify_membersihkan_nama() {
        assert_eq!(slugify("Toko Maju Jaya!"), "toko-maju-jaya");
        assert_eq!(slugify("  --  "), "org");
        assert_eq!(slugify("Warung 24 Jam"), "warung-24-jam");
    }
}
