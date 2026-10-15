use chrono::NaiveDate;
use rust_decimal::Decimal;
use serde::Serialize;

use crate::error::{Error, Result};
use crate::model::{NewTransaksi, TipeTransaksi, Transaksi};
use crate::repo::Tenant;

/// Draf transaksi dari email. Belum tercatat di fn_transaksi sampai disetujui.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Draf {
    pub id: u64,
    pub sumber_pesan_id: String,
    pub pengirim: Option<String>,
    pub keterangan: String,
    pub jumlah: Option<Decimal>,
    pub tipe: Option<String>,
    pub tanggal: Option<NaiveDate>,
    pub status: String,
    pub transaksi_id: Option<u64>,
}

/// Isi draf dari hasil penguraian email. `jumlah`, `tipe`, dan `tanggal` boleh kosong
/// karena pengguna melengkapinya saat meninjau.
#[derive(Debug, Clone)]
pub struct NewDraf {
    pub sumber_pesan_id: String,
    pub pengirim: Option<String>,
    pub keterangan: String,
    pub jumlah: Option<Decimal>,
    pub tipe: Option<&'static str>,
    pub tanggal: Option<NaiveDate>,
}

const SUMBER_GMAIL: &str = "gmail";

impl Tenant {
    /// Menyimpan draf baru. Mengembalikan `false` jika pesan ini sudah pernah menjadi draf,
    /// sehingga sinkronisasi ulang tidak membuat duplikat.
    pub async fn simpan_draf(&self, input: NewDraf) -> Result<bool> {
        let hasil = sqlx::query(
            "INSERT INTO fn_draf_transaksi \
             (organisasi_id, sumber, sumber_pesan_id, pengirim, keterangan, jumlah, tipe, tanggal) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(self.organisasi_id())
        .bind(SUMBER_GMAIL)
        .bind(&input.sumber_pesan_id)
        .bind(&input.pengirim)
        .bind(&input.keterangan)
        .bind(input.jumlah)
        .bind(input.tipe)
        .bind(input.tanggal)
        .execute(self.pool())
        .await;
        match hasil {
            Ok(_) => Ok(true),
            // Unique key (organisasi_id, sumber, sumber_pesan_id): pesan ini sudah pernah masuk.
            Err(sqlx::Error::Database(e)) if e.is_unique_violation() => Ok(false),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn daftar_draf_menunggu(&self) -> Result<Vec<Draf>> {
        let baris = sqlx::query_as::<_, Draf>(
            "SELECT id, sumber_pesan_id, pengirim, keterangan, jumlah, tipe, tanggal, status, transaksi_id \
             FROM fn_draf_transaksi WHERE organisasi_id = ? AND status = 'menunggu' \
             ORDER BY id DESC LIMIT 200",
        )
        .bind(self.organisasi_id())
        .fetch_all(self.pool())
        .await?;
        Ok(baris)
    }

    /// Menyetujui draf: membuat transaksi dari isinya, dengan rekening dan kategori yang dipilih pengguna.
    ///
    /// Status diklaim lebih dulu dengan syarat `menunggu`, sehingga dua persetujuan bersamaan
    /// tidak membuat dua transaksi. Jika pembuatan transaksi gagal, status dikembalikan.
    pub async fn setujui_draf(
        &self,
        id: u64,
        rekening_id: u64,
        kategori_id: Option<u64>,
        dibuat_oleh: u64,
    ) -> Result<Transaksi> {
        let draf = self.ambil_draf(id).await?.ok_or(Error::NotFound { entitas: "draf" })?;
        if draf.status != "menunggu" {
            return Err(Error::Validasi("draf ini sudah ditinjau".to_string()));
        }
        let (Some(jumlah), Some(tipe), Some(tanggal)) = (draf.jumlah, draf.tipe.as_deref(), draf.tanggal) else {
            return Err(Error::Validasi("lengkapi jumlah, tipe, dan tanggal sebelum menyetujui".to_string()));
        };
        let tipe = match tipe {
            "pemasukan" => TipeTransaksi::Pemasukan,
            "pengeluaran" => TipeTransaksi::Pengeluaran,
            other => {
                return Err(Error::NilaiTidakValid {
                    tipe: "tipe transaksi",
                    nilai: other.to_string(),
                })
            }
        };

        self.klaim_draf(id, "menunggu", "disetujui").await?;

        let hasil = self
            .buat_transaksi_dengan_uuid(
                NewTransaksi {
                    rekening_id,
                    kategori_id,
                    tipe,
                    jumlah,
                    tanggal,
                    catatan: Some(draf.keterangan.clone()),
                    dibuat_oleh,
                },
                None,
            )
            .await;

        match hasil {
            Ok((transaksi, _)) => {
                sqlx::query(
                    "UPDATE fn_draf_transaksi SET transaksi_id = ? WHERE id = ? AND organisasi_id = ?",
                )
                .bind(transaksi.id)
                .bind(id)
                .bind(self.organisasi_id())
                .execute(self.pool())
                .await?;
                Ok(transaksi)
            }
            Err(e) => {
                self.klaim_draf(id, "disetujui", "menunggu").await.ok();
                Err(e)
            }
        }
    }

    pub async fn buang_draf(&self, id: u64) -> Result<()> {
        if self.ambil_draf(id).await?.is_none() {
            return Err(Error::NotFound { entitas: "draf" });
        }
        self.klaim_draf(id, "menunggu", "dibuang").await
    }

    async fn ambil_draf(&self, id: u64) -> Result<Option<Draf>> {
        let draf = sqlx::query_as::<_, Draf>(
            "SELECT id, sumber_pesan_id, pengirim, keterangan, jumlah, tipe, tanggal, status, transaksi_id \
             FROM fn_draf_transaksi WHERE id = ? AND organisasi_id = ?",
        )
        .bind(id)
        .bind(self.organisasi_id())
        .fetch_optional(self.pool())
        .await?;
        Ok(draf)
    }

    /// Mengubah status dari `dari` ke `ke` hanya jika status saat ini masih `dari`.
    async fn klaim_draf(&self, id: u64, dari: &str, ke: &str) -> Result<()> {
        let hasil = sqlx::query(
            "UPDATE fn_draf_transaksi SET status = ? WHERE id = ? AND organisasi_id = ? AND status = ?",
        )
        .bind(ke)
        .bind(id)
        .bind(self.organisasi_id())
        .bind(dari)
        .execute(self.pool())
        .await?;
        if hasil.rows_affected() == 0 {
            return Err(Error::Validasi("draf ini sudah ditinjau".to_string()));
        }
        Ok(())
    }
}
