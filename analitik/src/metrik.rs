use chrono::{NaiveDate, Utc};
use serde::Serialize;
use sqlx::MySqlPool;
use thiserror::Error;

/// Rentang tanggal maksimal per permintaan. Mencegah query berat di tabel besar.
pub const MAKS_RENTANG_HARI: i64 = 366;

#[derive(Debug, Error, PartialEq)]
pub enum RentangError {
    #[error("tanggal harus berformat YYYY-MM-DD")]
    Format,
    #[error("dari tidak boleh setelah sampai")]
    Terbalik,
    #[error("rentang maksimal 366 hari")]
    TerlaluPanjang,
}

/// Memeriksa `dari` dan `sampai` (YYYY-MM-DD). Keduanya inklusif.
pub fn parse_rentang(dari: &str, sampai: &str) -> Result<(NaiveDate, NaiveDate), RentangError> {
    let d = NaiveDate::parse_from_str(dari, "%Y-%m-%d").map_err(|_| RentangError::Format)?;
    let s = NaiveDate::parse_from_str(sampai, "%Y-%m-%d").map_err(|_| RentangError::Format)?;
    if d > s {
        return Err(RentangError::Terbalik);
    }
    if (s - d).num_days() + 1 > MAKS_RENTANG_HARI {
        return Err(RentangError::TerlaluPanjang);
    }
    Ok((d, s))
}

#[derive(Debug, Serialize)]
pub struct Ringkasan {
    pub pengguna_total: i64,
    pub organisasi_total: i64,
    pub transaksi_total: i64,
    /// Pengguna yang punya sesi dalam 30 hari terakhir.
    pub pengguna_aktif_30_hari: i64,
    /// Jumlah organisasi dengan langganan aktif per paket.
    pub langganan_aktif: Vec<PaketAktif>,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct PaketAktif {
    pub paket: String,
    pub organisasi: i64,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Harian {
    pub hari: String,
    pub jumlah: i64,
}

pub async fn ringkasan(pool: &MySqlPool) -> Result<Ringkasan, sqlx::Error> {
    let pengguna_total = hitung(pool, "SELECT COUNT(*) FROM fn_pengguna WHERE deleted_at IS NULL").await?;
    let organisasi_total = hitung(pool, "SELECT COUNT(*) FROM fn_organisasi WHERE deleted_at IS NULL").await?;
    let transaksi_total = hitung(pool, "SELECT COUNT(*) FROM fn_transaksi WHERE deleted_at IS NULL").await?;
    let pengguna_aktif_30_hari = hitung(
        pool,
        "SELECT COUNT(DISTINCT pengguna_id) FROM fn_sesi_token WHERE created_at >= NOW() - INTERVAL 30 DAY",
    )
    .await?;

    let hari_ini = Utc::now().date_naive();
    let langganan_aktif = sqlx::query_as::<_, PaketAktif>(
        "SELECT CAST(paket AS CHAR) AS paket, COUNT(DISTINCT organisasi_id) AS organisasi \
         FROM fn_langganan \
         WHERE mulai <= ? AND (berakhir IS NULL OR berakhir >= ?) \
         GROUP BY paket ORDER BY paket",
    )
    .bind(hari_ini)
    .bind(hari_ini)
    .fetch_all(pool)
    .await?;

    Ok(Ringkasan {
        pengguna_total,
        organisasi_total,
        transaksi_total,
        pengguna_aktif_30_hari,
        langganan_aktif,
    })
}

/// Pendaftaran pengguna baru per hari.
pub async fn pendaftaran(pool: &MySqlPool, dari: NaiveDate, sampai: NaiveDate) -> Result<Vec<Harian>, sqlx::Error> {
    sqlx::query_as::<_, Harian>(
        "SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS hari, COUNT(*) AS jumlah \
         FROM fn_pengguna \
         WHERE deleted_at IS NULL AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) \
         GROUP BY hari ORDER BY hari",
    )
    .bind(dari)
    .bind(sampai)
    .fetch_all(pool)
    .await
}

/// Jumlah transaksi yang dicatat per hari (berdasarkan tanggal transaksi).
/// Hanya jumlah, tanpa nominal, karena mata uang dan isi tiap organisasi berbeda.
pub async fn transaksi(pool: &MySqlPool, dari: NaiveDate, sampai: NaiveDate) -> Result<Vec<Harian>, sqlx::Error> {
    sqlx::query_as::<_, Harian>(
        "SELECT DATE_FORMAT(tanggal, '%Y-%m-%d') AS hari, COUNT(*) AS jumlah \
         FROM fn_transaksi \
         WHERE deleted_at IS NULL AND tanggal BETWEEN ? AND ? \
         GROUP BY hari ORDER BY hari",
    )
    .bind(dari)
    .bind(sampai)
    .fetch_all(pool)
    .await
}

async fn hitung(pool: &MySqlPool, sql: &str) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar::<_, i64>(sql).fetch_one(pool).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rentang_valid() {
        let (d, s) = parse_rentang("2026-01-01", "2026-01-31").unwrap();
        assert_eq!(d.to_string(), "2026-01-01");
        assert_eq!(s.to_string(), "2026-01-31");
    }

    #[test]
    fn rentang_format_salah() {
        assert_eq!(parse_rentang("01-01-2026", "2026-01-31"), Err(RentangError::Format));
        assert_eq!(parse_rentang("2026-02-30", "2026-03-01"), Err(RentangError::Format));
    }

    #[test]
    fn rentang_terbalik() {
        assert_eq!(parse_rentang("2026-02-01", "2026-01-01"), Err(RentangError::Terbalik));
    }

    #[test]
    fn rentang_maksimal_366_hari() {
        assert!(parse_rentang("2026-01-01", "2026-12-31").is_ok());
        assert_eq!(parse_rentang("2026-01-01", "2027-01-02"), Err(RentangError::TerlaluPanjang));
    }
}
