use std::io::Write;
use std::process::{Command, Stdio};

use crate::error::{Error, Result};

/// Pembaca teks dari gambar (OCR) lewat CLI Tesseract. Gambar dikirim lewat stdin, jadi tidak ada berkas sementara.
pub struct Pembaca {
    cmd: String,
    bahasa: String,
}

fn internal(e: impl std::fmt::Display) -> Error {
    Error::Internal(format!("ocr: {e}"))
}

impl Pembaca {
    /// Memastikan binary Tesseract bisa dijalankan. Gagal jika belum terpasang atau tidak ditemukan di `cmd`.
    pub fn muat(cmd: &str, bahasa: &str) -> Result<Self> {
        let keluaran = Command::new(cmd).arg("--version").output().map_err(internal)?;
        if !keluaran.status.success() {
            return Err(internal(format!("{cmd} --version gagal")));
        }
        Ok(Self {
            cmd: cmd.to_string(),
            bahasa: bahasa.to_string(),
        })
    }

    /// Dari env `TESSERACT_CMD` (default `tesseract`) dan `TESSERACT_LANG` (default `ind+eng`).
    /// Mengembalikan `None` jika Tesseract tidak bisa dijalankan. API tetap jalan, dan endpoint OCR menjawab 503.
    pub fn dari_env() -> Option<Self> {
        let cmd = std::env::var("TESSERACT_CMD").unwrap_or_else(|_| "tesseract".to_string());
        let bahasa = std::env::var("TESSERACT_LANG").unwrap_or_else(|_| "ind+eng".to_string());
        match Self::muat(&cmd, &bahasa) {
            Ok(p) => {
                eprintln!("OCR siap (Tesseract, bahasa {bahasa})");
                Some(p)
            }
            Err(e) => {
                eprintln!("OCR nonaktif: {e}. Pasang Tesseract atau atur TESSERACT_CMD.");
                None
            }
        }
    }

    /// Mengembalikan seluruh teks dari gambar, satu baris per baris teks.
    /// Input berupa bytes JPG atau PNG. Gambar yang tidak bisa didekode menjadi error validasi.
    pub fn baca(&self, gambar: &[u8]) -> Result<String> {
        image::load_from_memory(gambar)
            .map_err(|_| Error::Validasi("Gambar tidak bisa dibaca. Pakai foto JPG atau PNG.".to_string()))?;

        let mut anak = Command::new(&self.cmd)
            .args(["stdin", "stdout", "-l", &self.bahasa])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(internal)?;

        // Tesseract membaca seluruh gambar dari stdin sebelum menulis hasil, jadi menulis lalu membaca keluaran aman dari deadlock.
        anak.stdin
            .take()
            .ok_or_else(|| internal("stdin tesseract tidak tersedia"))?
            .write_all(gambar)
            .map_err(internal)?;
        let keluaran = anak.wait_with_output().map_err(internal)?;
        if !keluaran.status.success() {
            let galat = String::from_utf8_lossy(&keluaran.stderr);
            return Err(internal(format!("tesseract gagal: {}", galat.trim())));
        }
        Ok(String::from_utf8_lossy(&keluaran.stdout).into_owned())
    }
}
