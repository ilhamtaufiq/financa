// Uji OCR ujung-ke-ujung pada struk contoh. Butuh model di `models/`.
// Tanpa model, tes dilewati. Lihat README atau .env.example untuk cara mengunduhnya.

use std::path::Path;

use financa_api::ocr::Pembaca;
use financa_api::struk::urai;

fn folder_model() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("models")
}

fn model_tersedia() -> bool {
    folder_model().join("text-detection.rten").exists() && folder_model().join("text-recognition.rten").exists()
}

#[test]
fn struk_contoh_menghasilkan_jumlah_dan_tanggal() {
    if !model_tersedia() {
        eprintln!("lewati: model OCR belum ada di {}", folder_model().display());
        return;
    }
    let pembaca = Pembaca::muat(&folder_model()).expect("model OCR harus bisa dimuat");
    let gambar = std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/struk-contoh.png"))
        .expect("fixture struk ada");

    let teks = pembaca.baca(&gambar).expect("OCR harus berjalan");
    let usulan = urai(&teks);

    assert_eq!(usulan.jumlah.as_deref(), Some("20000"), "teks OCR: {teks:?}");
    assert_eq!(usulan.tanggal.as_deref(), Some("2026-10-13"), "teks OCR: {teks:?}");
}

#[test]
fn gambar_rusak_menjadi_error_validasi() {
    if !model_tersedia() {
        return;
    }
    let pembaca = Pembaca::muat(&folder_model()).expect("model OCR harus bisa dimuat");
    let hasil = pembaca.baca(b"bukan gambar");
    assert!(matches!(hasil, Err(financa_api::Error::Validasi(_))), "hasil: {hasil:?}");
}
