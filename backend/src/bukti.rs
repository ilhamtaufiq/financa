use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

/// Batas ukuran bukti. Foto struk dari ponsel biasanya jauh di bawah ini.
pub const BATAS_BUKTI: usize = 5 * 1024 * 1024;

/// Folder penyimpanan bukti dari env `BUKTI_DIR`, default `storage/bukti` di folder kerja.
pub fn folder_dari_env() -> PathBuf {
    std::env::var("BUKTI_DIR").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("storage/bukti"))
}

/// Tipe berkas dari isi (magic bytes), bukan dari nama atau header `Content-Type` yang dikirim klien.
/// Mengembalikan `None` untuk tipe yang tidak didukung.
pub fn deteksi_mime(isi: &[u8]) -> Option<&'static str> {
    if isi.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if isi.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else if isi.starts_with(b"%PDF-") {
        Some("application/pdf")
    } else {
        None
    }
}

/// Nama asli dibersihkan untuk header `Content-Disposition`: hanya karakter aman, tanpa path.
pub fn nama_aman(nama: &str) -> String {
    let dasar = nama.rsplit(['/', '\\']).next().unwrap_or("").trim();
    let bersih: String = dasar
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') { c } else { '_' })
        .take(120)
        .collect();
    if bersih.trim_matches(['.', ' ']).is_empty() {
        "bukti".to_string()
    } else {
        bersih
    }
}

/// Menulis isi berkas ke `folder/berkas`. Folder dibuat jika belum ada.
pub async fn simpan(folder: &Path, berkas: &str, isi: &[u8]) -> Result<()> {
    tokio::fs::create_dir_all(folder)
        .await
        .map_err(|e| Error::Internal(format!("bukti: {e}")))?;
    tokio::fs::write(folder.join(berkas), isi)
        .await
        .map_err(|e| Error::Internal(format!("bukti: {e}")))
}

pub async fn baca(folder: &Path, berkas: &str) -> Result<Vec<u8>> {
    tokio::fs::read(folder.join(berkas))
        .await
        .map_err(|e| Error::Internal(format!("bukti: {e}")))
}

/// Menghapus berkas. Dipakai untuk membersihkan jika penyimpanan metadata gagal. Galat diabaikan.
pub async fn hapus(folder: &Path, berkas: &str) {
    let _ = tokio::fs::remove_file(folder.join(berkas)).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deteksi_dari_isi_berkas() {
        assert_eq!(deteksi_mime(&[0xFF, 0xD8, 0xFF, 0xE0, 0x00]), Some("image/jpeg"));
        assert_eq!(deteksi_mime(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00]), Some("image/png"));
        assert_eq!(deteksi_mime(b"%PDF-1.7\n"), Some("application/pdf"));
    }

    #[test]
    fn tipe_tidak_didukung_ditolak() {
        assert_eq!(deteksi_mime(b"<html>"), None);
        assert_eq!(deteksi_mime(b"GIF89a"), None);
        assert_eq!(deteksi_mime(&[]), None);
    }

    #[test]
    fn nama_aman_membuang_path_dan_karakter_berbahaya() {
        assert_eq!(nama_aman("../../etc/passwd"), "passwd");
        assert_eq!(nama_aman("C:\\foto\\struk \"x\".jpg"), "struk _x_.jpg");
        assert_eq!(nama_aman("..."), "bukti");
        assert_eq!(nama_aman(""), "bukti");
    }
}
