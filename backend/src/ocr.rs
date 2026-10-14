use std::path::{Path, PathBuf};

use ocrs::{ImageSource, OcrEngine, OcrEngineParams};

use crate::error::{Error, Result};

const MODEL_DETEKSI: &str = "text-detection.rten";
const MODEL_REKOGNISI: &str = "text-recognition.rten";

/// Pembaca teks dari gambar (OCR) berbasis `ocrs`. Model dimuat sekali saat server jalan.
pub struct Pembaca {
    mesin: OcrEngine,
}

fn internal(e: impl std::fmt::Display) -> Error {
    Error::Internal(format!("ocr: {e}"))
}

impl Pembaca {
    /// Memuat kedua model dari `dir`. Gagal jika berkas model tidak ada atau rusak.
    pub fn muat(dir: &Path) -> Result<Self> {
        let deteksi = rten::Model::load_file(dir.join(MODEL_DETEKSI)).map_err(internal)?;
        let rekognisi = rten::Model::load_file(dir.join(MODEL_REKOGNISI)).map_err(internal)?;
        let mesin = OcrEngine::new(OcrEngineParams {
            detection_model: Some(deteksi),
            recognition_model: Some(rekognisi),
            ..Default::default()
        })
        .map_err(internal)?;
        Ok(Self { mesin })
    }

    /// Lokasi model dari env `OCR_MODEL_DIR`, default `models` di folder kerja.
    /// Mengembalikan `None` jika model tidak bisa dimuat. API tetap jalan, dan endpoint OCR menjawab 503.
    pub fn dari_env() -> Option<Self> {
        let dir = std::env::var("OCR_MODEL_DIR").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("models"));
        match Self::muat(&dir) {
            Ok(p) => {
                eprintln!("OCR siap (model dari {})", dir.display());
                Some(p)
            }
            Err(e) => {
                eprintln!("OCR nonaktif: {e}. Letakkan model di {} atau atur OCR_MODEL_DIR.", dir.display());
                None
            }
        }
    }

    /// Mengembalikan seluruh teks dari gambar, satu baris per baris teks.
    /// Input berupa bytes JPG atau PNG. Gambar yang tidak bisa didekode menjadi error validasi.
    pub fn baca(&self, gambar: &[u8]) -> Result<String> {
        let rgb = image::load_from_memory(gambar)
            .map_err(|_| Error::Validasi("Gambar tidak bisa dibaca. Pakai foto JPG atau PNG.".to_string()))?
            .into_rgb8();
        let (lebar, tinggi) = rgb.dimensions();
        let sumber = ImageSource::from_bytes(rgb.as_raw(), (lebar, tinggi)).map_err(internal)?;
        let input = self.mesin.prepare_input(sumber).map_err(internal)?;
        self.mesin.get_text(&input).map_err(internal)
    }
}
