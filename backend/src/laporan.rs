use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::FromRow;

use crate::error::{Error, Result};
use crate::model::{JenisRekening, TipeTransaksi};
use crate::Tenant;

// Aturan laporan:
// - Transfer antar rekening tidak masuk pemasukan/pengeluaran. Di level organisasi
//   transfer selalu netral, jadi laba rugi tidak terpengaruh.
// - Semua query memfilter `organisasi_id` dan `deleted_at IS NULL`.

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RingkasanBulanan {
    pub tahun: i32,
    pub bulan: u32,
    pub dari: NaiveDate,
    pub sampai: NaiveDate,
    pub total_pemasukan: Decimal,
    pub total_pengeluaran: Decimal,
    pub selisih: Decimal,
    pub jumlah_transaksi: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BarisKategori {
    /// `None` untuk transaksi tanpa kategori.
    pub kategori_id: Option<u64>,
    pub kategori: String,
    pub total: Decimal,
    pub jumlah_transaksi: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LabaRugi {
    pub dari: NaiveDate,
    pub sampai: NaiveDate,
    pub pendapatan: Vec<BarisKategori>,
    pub beban: Vec<BarisKategori>,
    pub total_pendapatan: Decimal,
    pub total_beban: Decimal,
    pub laba_bersih: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ArusKasRekening {
    pub rekening_id: u64,
    pub nama: String,
    pub jenis: JenisRekening,
    pub saldo_awal_periode: Decimal,
    pub masuk: Decimal,
    pub keluar: Decimal,
    pub saldo_akhir: Decimal,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BarisEkspor {
    pub id: u64,
    pub tanggal: NaiveDate,
    pub tipe: TipeTransaksi,
    pub rekening: String,
    pub kategori: Option<String>,
    pub jumlah: Decimal,
    pub catatan: Option<String>,
    pub transfer_id: Option<String>,
}

pub fn validasi_rentang(dari: NaiveDate, sampai: NaiveDate) -> Result<()> {
    if dari > sampai {
        return Err(Error::Validasi(
            "dari harus sama dengan atau sebelum sampai".to_string(),
        ));
    }
    Ok(())
}

/// Tanggal pertama dan terakhir dari bulan tertentu.
pub fn rentang_bulan(tahun: i32, bulan: u32) -> Result<(NaiveDate, NaiveDate)> {
    let dari = NaiveDate::from_ymd_opt(tahun, bulan, 1)
        .ok_or_else(|| Error::Validasi("tahun atau bulan tidak valid".to_string()))?;
    let (tahun_berikut, bulan_berikut) = if bulan == 12 {
        (tahun + 1, 1)
    } else {
        (tahun, bulan + 1)
    };
    let awal_berikut = NaiveDate::from_ymd_opt(tahun_berikut, bulan_berikut, 1)
        .ok_or_else(|| Error::Validasi("tahun tidak valid".to_string()))?;
    let sampai = awal_berikut
        .pred_opt()
        .ok_or_else(|| Error::Validasi("tahun tidak valid".to_string()))?;
    Ok((dari, sampai))
}

#[derive(FromRow)]
struct AgregatKategori {
    kategori_id: Option<u64>,
    kategori: String,
    tipe: String,
    total: Decimal,
    jumlah_transaksi: i64,
}

#[derive(FromRow)]
struct ArusKasRow {
    rekening_id: u64,
    nama: String,
    jenis: String,
    saldo_awal_periode: Decimal,
    masuk: Decimal,
    keluar: Decimal,
}

#[derive(FromRow)]
struct BarisEksporRow {
    id: u64,
    tanggal: NaiveDate,
    tipe: String,
    rekening: String,
    kategori: Option<String>,
    jumlah: Decimal,
    catatan: Option<String>,
    transfer_id: Option<String>,
}

impl Tenant {
    /// Laba rugi sederhana: pemasukan dan pengeluaran per kategori dalam rentang tanggal.
    pub async fn laba_rugi(&self, dari: NaiveDate, sampai: NaiveDate) -> Result<LabaRugi> {
        validasi_rentang(dari, sampai)?;

        let rows = sqlx::query_as::<_, AgregatKategori>(
            "SELECT k.id AS kategori_id, COALESCE(k.nama, 'Tanpa kategori') AS kategori, \
                    CAST(t.tipe AS CHAR) AS tipe, SUM(t.jumlah) AS total, COUNT(*) AS jumlah_transaksi \
             FROM fn_transaksi t \
             LEFT JOIN fn_kategori k \
               ON k.id = t.kategori_id AND (k.organisasi_id = t.organisasi_id OR k.organisasi_id IS NULL) \
             WHERE t.organisasi_id = ? AND t.deleted_at IS NULL \
               AND t.tipe IN ('pemasukan', 'pengeluaran') AND t.tanggal BETWEEN ? AND ? \
             GROUP BY k.id, k.nama, t.tipe \
             ORDER BY t.tipe, kategori",
        )
        .bind(self.organisasi_id())
        .bind(dari)
        .bind(sampai)
        .fetch_all(self.pool())
        .await?;

        let mut pendapatan = Vec::new();
        let mut beban = Vec::new();
        for row in rows {
            let baris = BarisKategori {
                kategori_id: row.kategori_id,
                kategori: row.kategori,
                total: row.total,
                jumlah_transaksi: row.jumlah_transaksi,
            };
            match TipeTransaksi::parse(&row.tipe)? {
                TipeTransaksi::Pemasukan => pendapatan.push(baris),
                TipeTransaksi::Pengeluaran => beban.push(baris),
                _ => {}
            }
        }

        let total_pendapatan: Decimal = pendapatan.iter().map(|b| b.total).sum();
        let total_beban: Decimal = beban.iter().map(|b| b.total).sum();

        Ok(LabaRugi {
            dari,
            sampai,
            pendapatan,
            beban,
            total_pendapatan,
            total_beban,
            laba_bersih: total_pendapatan - total_beban,
        })
    }

    /// Ringkasan satu bulan kalender. Dihitung dari laba rugi bulan tersebut.
    pub async fn ringkasan_bulanan(&self, tahun: i32, bulan: u32) -> Result<RingkasanBulanan> {
        let (dari, sampai) = rentang_bulan(tahun, bulan)?;
        let lr = self.laba_rugi(dari, sampai).await?;

        let jumlah_transaksi = lr
            .pendapatan
            .iter()
            .chain(lr.beban.iter())
            .map(|b| b.jumlah_transaksi)
            .sum();

        Ok(RingkasanBulanan {
            tahun,
            bulan,
            dari,
            sampai,
            total_pemasukan: lr.total_pendapatan,
            total_pengeluaran: lr.total_beban,
            selisih: lr.laba_bersih,
            jumlah_transaksi,
        })
    }

    /// Arus kas per rekening. Semua rekening organisasi ikut, termasuk yang diarsipkan.
    /// `saldo_akhir` di akhir `sampai` sama dengan `saldo_rekening` saat itu.
    pub async fn arus_kas(&self, dari: NaiveDate, sampai: NaiveDate) -> Result<Vec<ArusKasRekening>> {
        validasi_rentang(dari, sampai)?;

        let rows = sqlx::query_as::<_, ArusKasRow>(
            "SELECT r.id AS rekening_id, r.nama, CAST(r.jenis AS CHAR) AS jenis, \
                    r.saldo_awal + COALESCE(SUM(CASE WHEN t.tanggal < ? THEN \
                        CASE WHEN t.tipe IN ('pemasukan', 'transfer_masuk') THEN t.jumlah \
                             WHEN t.tipe IN ('pengeluaran', 'transfer_keluar') THEN -t.jumlah END \
                    END), 0) AS saldo_awal_periode, \
                    COALESCE(SUM(CASE WHEN t.tanggal BETWEEN ? AND ? \
                        AND t.tipe IN ('pemasukan', 'transfer_masuk') THEN t.jumlah END), 0) AS masuk, \
                    COALESCE(SUM(CASE WHEN t.tanggal BETWEEN ? AND ? \
                        AND t.tipe IN ('pengeluaran', 'transfer_keluar') THEN t.jumlah END), 0) AS keluar \
             FROM fn_rekening r \
             LEFT JOIN fn_transaksi t \
               ON t.rekening_id = r.id AND t.organisasi_id = r.organisasi_id AND t.deleted_at IS NULL \
             WHERE r.organisasi_id = ? \
             GROUP BY r.id \
             ORDER BY r.id",
        )
        .bind(dari)
        .bind(dari)
        .bind(sampai)
        .bind(dari)
        .bind(sampai)
        .bind(self.organisasi_id())
        .fetch_all(self.pool())
        .await?;

        rows.into_iter()
            .map(|r| {
                Ok(ArusKasRekening {
                    rekening_id: r.rekening_id,
                    nama: r.nama,
                    jenis: JenisRekening::parse(&r.jenis)?,
                    saldo_akhir: r.saldo_awal_periode + r.masuk - r.keluar,
                    saldo_awal_periode: r.saldo_awal_periode,
                    masuk: r.masuk,
                    keluar: r.keluar,
                })
            })
            .collect()
    }

    /// Baris transaksi untuk ekspor CSV, lengkap dengan nama rekening dan kategori.
    pub async fn baris_ekspor(&self, dari: NaiveDate, sampai: NaiveDate) -> Result<Vec<BarisEkspor>> {
        validasi_rentang(dari, sampai)?;

        let rows = sqlx::query_as::<_, BarisEksporRow>(
            "SELECT t.id, t.tanggal, CAST(t.tipe AS CHAR) AS tipe, r.nama AS rekening, \
                    k.nama AS kategori, t.jumlah, t.catatan, t.transfer_id \
             FROM fn_transaksi t \
             JOIN fn_rekening r ON r.id = t.rekening_id AND r.organisasi_id = t.organisasi_id \
             LEFT JOIN fn_kategori k \
               ON k.id = t.kategori_id AND (k.organisasi_id = t.organisasi_id OR k.organisasi_id IS NULL) \
             WHERE t.organisasi_id = ? AND t.deleted_at IS NULL AND t.tanggal BETWEEN ? AND ? \
             ORDER BY t.tanggal, t.id",
        )
        .bind(self.organisasi_id())
        .bind(dari)
        .bind(sampai)
        .fetch_all(self.pool())
        .await?;

        rows.into_iter()
            .map(|r| {
                Ok(BarisEkspor {
                    id: r.id,
                    tanggal: r.tanggal,
                    tipe: TipeTransaksi::parse(&r.tipe)?,
                    rekening: r.rekening,
                    kategori: r.kategori,
                    jumlah: r.jumlah,
                    catatan: r.catatan,
                    transfer_id: r.transfer_id,
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rentang_bulan_biasa() {
        let (dari, sampai) = rentang_bulan(2026, 2).unwrap();
        assert_eq!(dari, NaiveDate::from_ymd_opt(2026, 2, 1).unwrap());
        assert_eq!(sampai, NaiveDate::from_ymd_opt(2026, 2, 28).unwrap());
    }

    #[test]
    fn rentang_bulan_desember_melewati_tahun() {
        let (dari, sampai) = rentang_bulan(2026, 12).unwrap();
        assert_eq!(dari, NaiveDate::from_ymd_opt(2026, 12, 1).unwrap());
        assert_eq!(sampai, NaiveDate::from_ymd_opt(2026, 12, 31).unwrap());
    }

    #[test]
    fn rentang_bulan_tahun_kabisat() {
        let (_, sampai) = rentang_bulan(2028, 2).unwrap();
        assert_eq!(sampai, NaiveDate::from_ymd_opt(2028, 2, 29).unwrap());
    }

    #[test]
    fn bulan_tidak_valid_ditolak() {
        assert!(matches!(rentang_bulan(2026, 13), Err(Error::Validasi(_))));
        assert!(matches!(rentang_bulan(2026, 0), Err(Error::Validasi(_))));
    }

    #[test]
    fn dari_setelah_sampai_ditolak() {
        let a = NaiveDate::from_ymd_opt(2026, 3, 2).unwrap();
        let b = NaiveDate::from_ymd_opt(2026, 3, 1).unwrap();
        assert!(matches!(validasi_rentang(a, b), Err(Error::Validasi(_))));
    }
}
