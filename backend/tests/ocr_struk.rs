// Uji OCR ujung-ke-ujung pada struk contoh. Butuh binary Tesseract dengan bahasa `ind` dan `eng`.
// Tanpa Tesseract, tes dilewati. Atur TESSERACT_CMD jika binary tidak ada di PATH.

use std::path::Path;

use financa_api::ocr::Pembaca;
use financa_api::struk::urai;

fn pembaca_tersedia() -> Option<Pembaca> {
    let cmd = std::env::var("TESSERACT_CMD").unwrap_or_else(|_| "tesseract".to_string());
    let bahasa = std::env::var("TESSERACT_LANG").unwrap_or_else(|_| "ind+eng".to_string());
    match Pembaca::muat(&cmd, &bahasa) {
        Ok(p) => Some(p),
        Err(e) => {
            eprintln!("lewati: Tesseract tidak tersedia ({e})");
            None
        }
    }
}

#[test]
fn struk_contoh_menghasilkan_jumlah_dan_tanggal() {
    let Some(pembaca) = pembaca_tersedia() else { return };
    let gambar = std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/struk-contoh.png"))
        .expect("fixture struk ada");

    let teks = pembaca.baca(&gambar).expect("OCR harus berjalan");
    let usulan = urai(&teks);

    assert_eq!(usulan.jumlah.as_deref(), Some("20000"), "teks OCR: {teks:?}");
    assert_eq!(usulan.tanggal.as_deref(), Some("2026-10-13"), "teks OCR: {teks:?}");
}

#[test]
fn gambar_rusak_menjadi_error_validasi() {
    let Some(pembaca) = pembaca_tersedia() else { return };
    let hasil = pembaca.baca(b"bukan gambar");
    assert!(hasil.is_err(), "gambar rusak harus ditolak");
}
