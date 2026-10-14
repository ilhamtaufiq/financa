use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use sqlx::mysql::{MySql, MySqlPool};
use sqlx::FromRow;
use uuid::Uuid;

use crate::error::{Error, Result};
use crate::model::{
    Bukti, JenisRekening, Kategori, NewKategori, NewRekening, NewTransaksi, NewTransfer, Rekening,
    TipeKategori, TipeTransaksi, Transaksi, Transfer,
};

/// Repository yang terikat pada satu organisasi. Setiap query memakai
/// `self.organisasi_id`, sehingga tidak ada jalur untuk membaca atau menulis
/// data tenant lain lewat repository ini.
///
/// Method `*_oleh` mencatat audit dengan pengguna pelaku. Method tanpa `_oleh`
/// tidak mencatat audit; dipakai untuk tes dan seeding.
#[derive(Clone)]
pub struct Tenant {
    pool: MySqlPool,
    organisasi_id: u64,
}

impl Tenant {
    pub fn new(pool: MySqlPool, organisasi_id: u64) -> Self {
        Self { pool, organisasi_id }
    }

    pub fn organisasi_id(&self) -> u64 {
        self.organisasi_id
    }

    /// Dipakai modul laporan di dalam crate. Query tetap wajib memfilter `organisasi_id`.
    pub(crate) fn pool(&self) -> &MySqlPool {
        &self.pool
    }

    // ---- Rekening ----

    pub async fn buat_rekening(&self, input: NewRekening) -> Result<Rekening> {
        self.buat_rekening_oleh(input, None).await
    }

    pub async fn buat_rekening_oleh(&self, input: NewRekening, oleh: Option<u64>) -> Result<Rekening> {
        let mut tx = self.pool.begin().await?;
        let id = sqlx::query(
            "INSERT INTO fn_rekening (organisasi_id, nama, jenis, saldo_awal) VALUES (?, ?, ?, ?)",
        )
        .bind(self.organisasi_id)
        .bind(&input.nama)
        .bind(input.jenis.as_str())
        .bind(input.saldo_awal)
        .execute(&mut *tx)
        .await?
        .last_insert_id();

        catat_audit(
            &mut tx,
            self.organisasi_id,
            oleh,
            "create",
            "rekening",
            id,
            serde_json::json!({"nama": input.nama, "jenis": input.jenis.as_str(), "saldo_awal": input.saldo_awal.to_string()}),
        )
        .await?;
        tx.commit().await?;

        Ok(Rekening {
            id,
            organisasi_id: self.organisasi_id,
            nama: input.nama,
            jenis: input.jenis,
            saldo_awal: input.saldo_awal,
            diarsipkan_at: None,
        })
    }

    pub async fn ambil_rekening(&self, id: u64) -> Result<Option<Rekening>> {
        let row = sqlx::query_as::<_, RekeningRow>(
            "SELECT id, organisasi_id, nama, CAST(jenis AS CHAR) AS jenis, saldo_awal, diarsipkan_at \
             FROM fn_rekening WHERE id = ? AND organisasi_id = ?",
        )
        .bind(id)
        .bind(self.organisasi_id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(Rekening::try_from).transpose()
    }

    /// Rekening aktif (belum diarsipkan), urut berdasarkan id.
    pub async fn daftar_rekening(&self) -> Result<Vec<Rekening>> {
        let rows = sqlx::query_as::<_, RekeningRow>(
            "SELECT id, organisasi_id, nama, CAST(jenis AS CHAR) AS jenis, saldo_awal, diarsipkan_at \
             FROM fn_rekening WHERE organisasi_id = ? AND diarsipkan_at IS NULL ORDER BY id",
        )
        .bind(self.organisasi_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(Rekening::try_from).collect()
    }

    pub async fn ubah_nama_rekening(&self, id: u64, nama: &str) -> Result<Rekening> {
        self.ubah_nama_rekening_oleh(id, nama, None).await
    }

    pub async fn ubah_nama_rekening_oleh(&self, id: u64, nama: &str, oleh: Option<u64>) -> Result<Rekening> {
        let mut tx = self.pool.begin().await?;
        let hasil = sqlx::query("UPDATE fn_rekening SET nama = ? WHERE id = ? AND organisasi_id = ?")
            .bind(nama)
            .bind(id)
            .bind(self.organisasi_id)
            .execute(&mut *tx)
            .await?;

        // Hanya dicatat jika baris benar-benar ada dan diubah.
        if hasil.rows_affected() > 0 {
            catat_audit(
                &mut tx,
                self.organisasi_id,
                oleh,
                "update",
                "rekening",
                id,
                serde_json::json!({"nama": nama}),
            )
            .await?;
        }
        tx.commit().await?;

        self.ambil_rekening(id)
            .await?
            .ok_or(Error::NotFound { entitas: "rekening" })
    }

    /// Arsip bersifat idempoten: rekening yang sudah diarsipkan dikembalikan apa adanya.
    pub async fn arsipkan_rekening(&self, id: u64) -> Result<Rekening> {
        self.arsipkan_rekening_oleh(id, None).await
    }

    pub async fn arsipkan_rekening_oleh(&self, id: u64, oleh: Option<u64>) -> Result<Rekening> {
        let mut tx = self.pool.begin().await?;
        let hasil = sqlx::query(
            "UPDATE fn_rekening SET diarsipkan_at = CURRENT_TIMESTAMP \
             WHERE id = ? AND organisasi_id = ? AND diarsipkan_at IS NULL",
        )
        .bind(id)
        .bind(self.organisasi_id)
        .execute(&mut *tx)
        .await?;

        if hasil.rows_affected() > 0 {
            catat_audit(&mut tx, self.organisasi_id, oleh, "archive", "rekening", id, serde_json::json!({})).await?;
        }
        tx.commit().await?;

        self.ambil_rekening(id)
            .await?
            .ok_or(Error::NotFound { entitas: "rekening" })
    }

    /// Saldo = saldo awal + masuk - keluar. Dihitung dari transaksi, tidak disimpan.
    /// `None` jika rekening tidak ada di organisasi ini.
    pub async fn saldo_rekening(&self, rekening_id: u64) -> Result<Option<Decimal>> {
        let saldo = sqlx::query_scalar::<_, Decimal>(
            "SELECT r.saldo_awal + COALESCE(SUM(CASE \
                 WHEN t.tipe IN ('pemasukan', 'transfer_masuk') THEN t.jumlah \
                 WHEN t.tipe IN ('pengeluaran', 'transfer_keluar') THEN -t.jumlah \
             END), 0) \
             FROM fn_rekening r \
             LEFT JOIN fn_transaksi t \
               ON t.rekening_id = r.id AND t.organisasi_id = r.organisasi_id AND t.deleted_at IS NULL \
             WHERE r.id = ? AND r.organisasi_id = ? \
             GROUP BY r.id, r.saldo_awal",
        )
        .bind(rekening_id)
        .bind(self.organisasi_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(saldo)
    }

    // ---- Kategori ----

    /// Kategori kustom milik organisasi ini.
    pub async fn buat_kategori(&self, input: NewKategori) -> Result<Kategori> {
        self.buat_kategori_oleh(input, None).await
    }

    pub async fn buat_kategori_oleh(&self, input: NewKategori, oleh: Option<u64>) -> Result<Kategori> {
        let mut tx = self.pool.begin().await?;
        let id = sqlx::query(
            "INSERT INTO fn_kategori (organisasi_id, tipe, nama, is_default) VALUES (?, ?, ?, 0)",
        )
        .bind(self.organisasi_id)
        .bind(input.tipe.as_str())
        .bind(&input.nama)
        .execute(&mut *tx)
        .await?
        .last_insert_id();

        catat_audit(
            &mut tx,
            self.organisasi_id,
            oleh,
            "create",
            "kategori",
            id,
            serde_json::json!({"tipe": input.tipe.as_str(), "nama": input.nama}),
        )
        .await?;
        tx.commit().await?;

        Ok(Kategori {
            id,
            organisasi_id: Some(self.organisasi_id),
            tipe: input.tipe,
            nama: input.nama,
        })
    }

    /// Kategori default global dan kategori milik organisasi ini.
    pub async fn daftar_kategori(&self) -> Result<Vec<Kategori>> {
        let rows = sqlx::query_as::<_, KategoriRow>(
            "SELECT id, organisasi_id, CAST(tipe AS CHAR) AS tipe, nama FROM fn_kategori \
             WHERE organisasi_id = ? OR organisasi_id IS NULL ORDER BY tipe, nama",
        )
        .bind(self.organisasi_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(Kategori::try_from).collect()
    }

    // ---- Transaksi ----

    /// Mencatat transaksi biasa (tanpa kunci idempotensi).
    pub async fn buat_transaksi(&self, input: NewTransaksi) -> Result<Transaksi> {
        self.buat_transaksi_dengan_uuid(input, None).await.map(|(t, _)| t)
    }

    /// Mencatat transaksi beserta entri audit, dalam satu DB transaction.
    ///
    /// Jika `client_uuid` sudah pernah dipakai di organisasi ini, transaksi yang sudah ada
    /// dikembalikan dengan `dibuat = false` dan tidak ada baris atau audit baru. Ini membuat
    /// kirim ulang dari klien aman.
    ///
    /// Rekening harus aktif dan milik organisasi ini. Kategori harus milik organisasi ini
    /// atau kategori default global. Transfer tidak lewat sini.
    pub async fn buat_transaksi_dengan_uuid(
        &self,
        input: NewTransaksi,
        client_uuid: Option<&str>,
    ) -> Result<(Transaksi, bool)> {
        if input.jumlah <= Decimal::ZERO {
            return Err(Error::JumlahTidakValid);
        }
        if matches!(input.tipe, TipeTransaksi::TransferKeluar | TipeTransaksi::TransferMasuk) {
            return Err(Error::Validasi(
                "transfer harus dibuat lewat endpoint transfer".to_string(),
            ));
        }

        if let Some(uuid) = client_uuid {
            if let Some(ada) = self.cari_transaksi_by_client_uuid(uuid).await? {
                return Ok((ada, false));
            }
        }

        let mut tx = self.pool.begin().await?;

        let rekening_aktif: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM fn_rekening \
             WHERE id = ? AND organisasi_id = ? AND diarsipkan_at IS NULL",
        )
        .bind(input.rekening_id)
        .bind(self.organisasi_id)
        .fetch_one(&mut *tx)
        .await?;

        if rekening_aktif == 0 {
            return Err(Error::NotFound { entitas: "rekening" });
        }

        if let Some(kategori_id) = input.kategori_id {
            let kategori_dapat_dipakai: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM fn_kategori \
                 WHERE id = ? AND (organisasi_id = ? OR organisasi_id IS NULL)",
            )
            .bind(kategori_id)
            .bind(self.organisasi_id)
            .fetch_one(&mut *tx)
            .await?;

            if kategori_dapat_dipakai == 0 {
                return Err(Error::NotFound { entitas: "kategori" });
            }
        }

        let id = sqlx::query(
            "INSERT INTO fn_transaksi \
             (organisasi_id, rekening_id, kategori_id, tipe, jumlah, tanggal, catatan, client_uuid, dibuat_oleh) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(self.organisasi_id)
        .bind(input.rekening_id)
        .bind(input.kategori_id)
        .bind(input.tipe.as_str())
        .bind(input.jumlah)
        .bind(input.tanggal)
        .bind(&input.catatan)
        .bind(client_uuid)
        .bind(input.dibuat_oleh)
        .execute(&mut *tx)
        .await?
        .last_insert_id();

        catat_audit(
            &mut tx,
            self.organisasi_id,
            Some(input.dibuat_oleh),
            "create",
            "transaksi",
            id,
            serde_json::json!({
                "rekening_id": input.rekening_id,
                "kategori_id": input.kategori_id,
                "tipe": input.tipe.as_str(),
                "jumlah": input.jumlah.to_string(),
                "tanggal": input.tanggal.to_string(),
            }),
        )
        .await?;

        tx.commit().await?;

        Ok((
            Transaksi {
                id,
                organisasi_id: self.organisasi_id,
                rekening_id: input.rekening_id,
                kategori_id: input.kategori_id,
                tipe: input.tipe,
                jumlah: input.jumlah,
                tanggal: input.tanggal,
                catatan: input.catatan,
                transfer_id: None,
                dibuat_oleh: input.dibuat_oleh,
            },
            true,
        ))
    }

    /// Transfer tanpa kunci idempotensi.
    pub async fn buat_transfer(&self, input: NewTransfer) -> Result<Transfer> {
        self.buat_transfer_dengan_uuid(input, None).await.map(|(t, _)| t)
    }

    /// Transfer atomik: dua baris (`transfer_keluar` dan `transfer_masuk`) dengan
    /// `transfer_id` yang sama, beserta dua entri audit, dalam satu DB transaction.
    /// `client_uuid` disimpan di baris keluar. Kirim ulang dengan UUID yang sama
    /// mengembalikan transfer yang sudah ada (`dibuat = false`).
    pub async fn buat_transfer_dengan_uuid(
        &self,
        input: NewTransfer,
        client_uuid: Option<&str>,
    ) -> Result<(Transfer, bool)> {
        if input.jumlah <= Decimal::ZERO {
            return Err(Error::JumlahTidakValid);
        }
        if input.rekening_asal_id == input.rekening_tujuan_id {
            return Err(Error::Validasi(
                "rekening asal dan tujuan harus berbeda".to_string(),
            ));
        }

        if let Some(uuid) = client_uuid {
            if let Some(ada) = self.cari_transaksi_by_client_uuid(uuid).await? {
                if let Some(transfer_id) = ada.transfer_id {
                    if let Some(transfer) = self.ambil_transfer(&transfer_id).await? {
                        return Ok((transfer, false));
                    }
                }
            }
        }

        let mut tx = self.pool.begin().await?;

        let rekening_aktif: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM fn_rekening \
             WHERE id IN (?, ?) AND organisasi_id = ? AND diarsipkan_at IS NULL",
        )
        .bind(input.rekening_asal_id)
        .bind(input.rekening_tujuan_id)
        .bind(self.organisasi_id)
        .fetch_one(&mut *tx)
        .await?;

        if rekening_aktif != 2 {
            return Err(Error::NotFound { entitas: "rekening" });
        }

        let transfer_id = Uuid::new_v4().to_string();

        let keluar_id = sqlx::query(
            "INSERT INTO fn_transaksi \
             (organisasi_id, rekening_id, kategori_id, tipe, jumlah, tanggal, catatan, transfer_id, client_uuid, dibuat_oleh) \
             VALUES (?, ?, NULL, 'transfer_keluar', ?, ?, ?, ?, ?, ?)",
        )
        .bind(self.organisasi_id)
        .bind(input.rekening_asal_id)
        .bind(input.jumlah)
        .bind(input.tanggal)
        .bind(&input.catatan)
        .bind(&transfer_id)
        .bind(client_uuid)
        .bind(input.dibuat_oleh)
        .execute(&mut *tx)
        .await?
        .last_insert_id();

        let masuk_id = sqlx::query(
            "INSERT INTO fn_transaksi \
             (organisasi_id, rekening_id, kategori_id, tipe, jumlah, tanggal, catatan, transfer_id, dibuat_oleh) \
             VALUES (?, ?, NULL, 'transfer_masuk', ?, ?, ?, ?, ?)",
        )
        .bind(self.organisasi_id)
        .bind(input.rekening_tujuan_id)
        .bind(input.jumlah)
        .bind(input.tanggal)
        .bind(&input.catatan)
        .bind(&transfer_id)
        .bind(input.dibuat_oleh)
        .execute(&mut *tx)
        .await?
        .last_insert_id();

        for (id, rekening_id, tipe) in [
            (keluar_id, input.rekening_asal_id, "transfer_keluar"),
            (masuk_id, input.rekening_tujuan_id, "transfer_masuk"),
        ] {
            catat_audit(
                &mut tx,
                self.organisasi_id,
                Some(input.dibuat_oleh),
                "create",
                "transaksi",
                id,
                serde_json::json!({
                    "rekening_id": rekening_id,
                    "tipe": tipe,
                    "jumlah": input.jumlah.to_string(),
                    "tanggal": input.tanggal.to_string(),
                    "transfer_id": transfer_id,
                }),
            )
            .await?;
        }

        tx.commit().await?;

        Ok((
            Transfer {
                transfer_id: transfer_id.clone(),
                keluar: Transaksi {
                    id: keluar_id,
                    organisasi_id: self.organisasi_id,
                    rekening_id: input.rekening_asal_id,
                    kategori_id: None,
                    tipe: TipeTransaksi::TransferKeluar,
                    jumlah: input.jumlah,
                    tanggal: input.tanggal,
                    catatan: input.catatan.clone(),
                    transfer_id: Some(transfer_id.clone()),
                    dibuat_oleh: input.dibuat_oleh,
                },
                masuk: Transaksi {
                    id: masuk_id,
                    organisasi_id: self.organisasi_id,
                    rekening_id: input.rekening_tujuan_id,
                    kategori_id: None,
                    tipe: TipeTransaksi::TransferMasuk,
                    jumlah: input.jumlah,
                    tanggal: input.tanggal,
                    catatan: input.catatan,
                    transfer_id: Some(transfer_id),
                    dibuat_oleh: input.dibuat_oleh,
                },
            },
            true,
        ))
    }

    // ---- Bukti transaksi ----

    /// Mencatat bukti. Pemanggil wajib sudah memastikan transaksi ada di organisasi ini.
    pub async fn tambah_bukti(
        &self,
        transaksi_id: u64,
        nama_asli: &str,
        mime: &str,
        ukuran: u32,
        berkas: &str,
        oleh: u64,
    ) -> Result<Bukti> {
        let hasil = sqlx::query(
            "INSERT INTO fn_bukti (organisasi_id, transaksi_id, nama_asli, mime, ukuran, berkas, dibuat_oleh) \
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(self.organisasi_id)
        .bind(transaksi_id)
        .bind(nama_asli)
        .bind(mime)
        .bind(ukuran)
        .bind(berkas)
        .bind(oleh)
        .execute(&self.pool)
        .await?;

        self.ambil_bukti(hasil.last_insert_id())
            .await?
            .ok_or(Error::NotFound { entitas: "bukti" })
    }

    pub async fn ambil_bukti(&self, id: u64) -> Result<Option<Bukti>> {
        let row = sqlx::query_as::<_, Bukti>(
            "SELECT id, organisasi_id, transaksi_id, nama_asli, mime, ukuran, berkas, dibuat_oleh, created_at \
             FROM fn_bukti WHERE id = ? AND organisasi_id = ?",
        )
        .bind(id)
        .bind(self.organisasi_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    pub async fn daftar_bukti(&self, transaksi_id: u64) -> Result<Vec<Bukti>> {
        let rows = sqlx::query_as::<_, Bukti>(
            "SELECT id, organisasi_id, transaksi_id, nama_asli, mime, ukuran, berkas, dibuat_oleh, created_at \
             FROM fn_bukti WHERE transaksi_id = ? AND organisasi_id = ? ORDER BY id",
        )
        .bind(transaksi_id)
        .bind(self.organisasi_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn ambil_transaksi(&self, id: u64) -> Result<Option<Transaksi>> {
        let row = sqlx::query_as::<_, TransaksiRow>(
            "SELECT id, organisasi_id, rekening_id, kategori_id, CAST(tipe AS CHAR) AS tipe, \
                    jumlah, tanggal, catatan, transfer_id, dibuat_oleh \
             FROM fn_transaksi WHERE id = ? AND organisasi_id = ? AND deleted_at IS NULL",
        )
        .bind(id)
        .bind(self.organisasi_id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(Transaksi::try_from).transpose()
    }

    /// Transaksi dalam rentang tanggal (inklusif), urut tanggal lalu id.
    pub async fn daftar_transaksi(&self, dari: NaiveDate, sampai: NaiveDate) -> Result<Vec<Transaksi>> {
        let rows = sqlx::query_as::<_, TransaksiRow>(
            "SELECT id, organisasi_id, rekening_id, kategori_id, CAST(tipe AS CHAR) AS tipe, \
                    jumlah, tanggal, catatan, transfer_id, dibuat_oleh \
             FROM fn_transaksi \
             WHERE organisasi_id = ? AND deleted_at IS NULL AND tanggal BETWEEN ? AND ? \
             ORDER BY tanggal, id",
        )
        .bind(self.organisasi_id)
        .bind(dari)
        .bind(sampai)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(Transaksi::try_from).collect()
    }

    async fn cari_transaksi_by_client_uuid(&self, client_uuid: &str) -> Result<Option<Transaksi>> {
        let row = sqlx::query_as::<_, TransaksiRow>(
            "SELECT id, organisasi_id, rekening_id, kategori_id, CAST(tipe AS CHAR) AS tipe, \
                    jumlah, tanggal, catatan, transfer_id, dibuat_oleh \
             FROM fn_transaksi WHERE organisasi_id = ? AND client_uuid = ?",
        )
        .bind(self.organisasi_id)
        .bind(client_uuid)
        .fetch_optional(&self.pool)
        .await?;

        row.map(Transaksi::try_from).transpose()
    }

    /// Memuat kedua baris transfer dari `transfer_id`.
    async fn ambil_transfer(&self, transfer_id: &str) -> Result<Option<Transfer>> {
        let rows = sqlx::query_as::<_, TransaksiRow>(
            "SELECT id, organisasi_id, rekening_id, kategori_id, CAST(tipe AS CHAR) AS tipe, \
                    jumlah, tanggal, catatan, transfer_id, dibuat_oleh \
             FROM fn_transaksi WHERE organisasi_id = ? AND transfer_id = ? AND deleted_at IS NULL",
        )
        .bind(self.organisasi_id)
        .bind(transfer_id)
        .fetch_all(&self.pool)
        .await?;

        let mut keluar = None;
        let mut masuk = None;
        for row in rows {
            let t = Transaksi::try_from(row)?;
            match t.tipe {
                TipeTransaksi::TransferKeluar => keluar = Some(t),
                TipeTransaksi::TransferMasuk => masuk = Some(t),
                _ => {}
            }
        }

        Ok(match (keluar, masuk) {
            (Some(keluar), Some(masuk)) => Some(Transfer {
                transfer_id: transfer_id.to_string(),
                keluar,
                masuk,
            }),
            _ => None,
        })
    }
}

/// Entri audit. Dipanggil di dalam transaksi DB yang sama dengan perubahannya,
/// sehingga perubahan tanpa jejak tidak mungkin terjadi.
async fn catat_audit(
    tx: &mut sqlx::Transaction<'_, MySql>,
    organisasi_id: u64,
    pengguna_id: Option<u64>,
    aksi: &str,
    entitas: &str,
    entitas_id: u64,
    data: serde_json::Value,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO fn_audit_log (organisasi_id, pengguna_id, aksi, entitas, entitas_id, data) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(organisasi_id)
    .bind(pengguna_id)
    .bind(aksi)
    .bind(entitas)
    .bind(entitas_id)
    .bind(data.to_string())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

// ---- Baris database ----
// Kolom ENUM di-CAST ke CHAR di setiap SELECT agar terbaca sebagai String.

#[derive(FromRow)]
struct RekeningRow {
    id: u64,
    organisasi_id: u64,
    nama: String,
    jenis: String,
    saldo_awal: Decimal,
    diarsipkan_at: Option<DateTime<Utc>>,
}

impl TryFrom<RekeningRow> for Rekening {
    type Error = Error;

    fn try_from(r: RekeningRow) -> Result<Self> {
        Ok(Rekening {
            id: r.id,
            organisasi_id: r.organisasi_id,
            nama: r.nama,
            jenis: JenisRekening::parse(&r.jenis)?,
            saldo_awal: r.saldo_awal,
            diarsipkan_at: r.diarsipkan_at,
        })
    }
}

#[derive(FromRow)]
struct KategoriRow {
    id: u64,
    organisasi_id: Option<u64>,
    tipe: String,
    nama: String,
}

impl TryFrom<KategoriRow> for Kategori {
    type Error = Error;

    fn try_from(r: KategoriRow) -> Result<Self> {
        Ok(Kategori {
            id: r.id,
            organisasi_id: r.organisasi_id,
            tipe: TipeKategori::parse(&r.tipe)?,
            nama: r.nama,
        })
    }
}

#[derive(FromRow)]
struct TransaksiRow {
    id: u64,
    organisasi_id: u64,
    rekening_id: u64,
    kategori_id: Option<u64>,
    tipe: String,
    jumlah: Decimal,
    tanggal: NaiveDate,
    catatan: Option<String>,
    transfer_id: Option<String>,
    dibuat_oleh: u64,
}

impl TryFrom<TransaksiRow> for Transaksi {
    type Error = Error;

    fn try_from(r: TransaksiRow) -> Result<Self> {
        Ok(Transaksi {
            id: r.id,
            organisasi_id: r.organisasi_id,
            rekening_id: r.rekening_id,
            kategori_id: r.kategori_id,
            tipe: TipeTransaksi::parse(&r.tipe)?,
            jumlah: r.jumlah,
            tanggal: r.tanggal,
            catatan: r.catatan,
            transfer_id: r.transfer_id,
            dibuat_oleh: r.dibuat_oleh,
        })
    }
}
