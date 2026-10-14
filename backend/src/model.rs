use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

// Nilai serde (snake_case) sama dengan nilai ENUM di database.

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JenisRekening {
    Kas,
    Bank,
    Lainnya,
}

impl JenisRekening {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Kas => "kas",
            Self::Bank => "bank",
            Self::Lainnya => "lainnya",
        }
    }

    pub fn parse(nilai: &str) -> Result<Self> {
        match nilai {
            "kas" => Ok(Self::Kas),
            "bank" => Ok(Self::Bank),
            "lainnya" => Ok(Self::Lainnya),
            _ => Err(Error::NilaiTidakValid {
                tipe: "jenis rekening",
                nilai: nilai.to_string(),
            }),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TipeKategori {
    Pemasukan,
    Pengeluaran,
}

impl TipeKategori {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pemasukan => "pemasukan",
            Self::Pengeluaran => "pengeluaran",
        }
    }

    pub fn parse(nilai: &str) -> Result<Self> {
        match nilai {
            "pemasukan" => Ok(Self::Pemasukan),
            "pengeluaran" => Ok(Self::Pengeluaran),
            _ => Err(Error::NilaiTidakValid {
                tipe: "tipe kategori",
                nilai: nilai.to_string(),
            }),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TipeTransaksi {
    Pemasukan,
    Pengeluaran,
    TransferKeluar,
    TransferMasuk,
}

impl TipeTransaksi {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pemasukan => "pemasukan",
            Self::Pengeluaran => "pengeluaran",
            Self::TransferKeluar => "transfer_keluar",
            Self::TransferMasuk => "transfer_masuk",
        }
    }

    pub fn parse(nilai: &str) -> Result<Self> {
        match nilai {
            "pemasukan" => Ok(Self::Pemasukan),
            "pengeluaran" => Ok(Self::Pengeluaran),
            "transfer_keluar" => Ok(Self::TransferKeluar),
            "transfer_masuk" => Ok(Self::TransferMasuk),
            _ => Err(Error::NilaiTidakValid {
                tipe: "tipe transaksi",
                nilai: nilai.to_string(),
            }),
        }
    }
}

/// Peran anggota organisasi. `Owner` dan `Admin` boleh mengelola rekening dan kategori.
/// Semua anggota boleh mencatat transaksi dan transfer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Peran {
    Owner,
    Admin,
    Anggota,
}

impl Peran {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Admin => "admin",
            Self::Anggota => "anggota",
        }
    }

    pub fn parse(nilai: &str) -> Result<Self> {
        match nilai {
            "owner" => Ok(Self::Owner),
            "admin" => Ok(Self::Admin),
            "anggota" => Ok(Self::Anggota),
            _ => Err(Error::NilaiTidakValid {
                tipe: "peran",
                nilai: nilai.to_string(),
            }),
        }
    }

    pub fn boleh_kelola(self) -> bool {
        matches!(self, Self::Owner | Self::Admin)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Organisasi {
    pub id: u64,
    pub nama: String,
    pub slug: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Rekening {
    pub id: u64,
    pub organisasi_id: u64,
    pub nama: String,
    pub jenis: JenisRekening,
    pub saldo_awal: Decimal,
    pub diarsipkan_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct NewRekening {
    pub nama: String,
    pub jenis: JenisRekening,
    #[serde(default)]
    pub saldo_awal: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Kategori {
    pub id: u64,
    /// `None` berarti kategori default global.
    pub organisasi_id: Option<u64>,
    pub tipe: TipeKategori,
    pub nama: String,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct NewKategori {
    pub tipe: TipeKategori,
    pub nama: String,
}

/// Metadata bukti transaksi. `berkas` (nama di disk) tidak dikirim ke klien.
#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
pub struct Bukti {
    pub id: u64,
    pub organisasi_id: u64,
    pub transaksi_id: u64,
    pub nama_asli: String,
    pub mime: String,
    pub ukuran: u32,
    #[serde(skip)]
    pub berkas: String,
    pub dibuat_oleh: u64,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Transaksi {
    pub id: u64,
    pub organisasi_id: u64,
    pub rekening_id: u64,
    pub kategori_id: Option<u64>,
    pub tipe: TipeTransaksi,
    pub jumlah: Decimal,
    pub tanggal: NaiveDate,
    pub catatan: Option<String>,
    /// Sama untuk dua baris dari satu transfer; `None` untuk transaksi biasa.
    pub transfer_id: Option<String>,
    pub dibuat_oleh: u64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct NewTransaksi {
    pub rekening_id: u64,
    pub kategori_id: Option<u64>,
    pub tipe: TipeTransaksi,
    pub jumlah: Decimal,
    pub tanggal: NaiveDate,
    pub catatan: Option<String>,
    pub dibuat_oleh: u64,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct NewTransfer {
    pub rekening_asal_id: u64,
    pub rekening_tujuan_id: u64,
    pub jumlah: Decimal,
    pub tanggal: NaiveDate,
    pub catatan: Option<String>,
    pub dibuat_oleh: u64,
}

/// Dua baris transaksi yang dibuat dalam satu DB transaction.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Transfer {
    pub transfer_id: String,
    pub keluar: Transaksi,
    pub masuk: Transaksi,
}
