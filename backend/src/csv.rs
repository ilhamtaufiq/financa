//! Penulisan CSV (RFC 4180) untuk ekspor. Tidak memakai crate eksternal.
//!
//! - Kolom teks dilindungi dari CSV/formula injection: nilai yang diawali
//!   `=`, `+`, `-`, `@`, tab, atau CR diberi prefix `'`.
//! - Kolom angka tidak diberi prefix, supaya nilai negatif tetap terbaca sebagai angka.
//! - Setiap file diawali BOM UTF-8 agar Excel membaca karakter Indonesia dengan benar.

use rust_decimal::Decimal;

pub const BOM_UTF8: &str = "\u{feff}";

/// Kolom teks: aman dari formula injection, lalu di-quote bila perlu.
pub fn teks(nilai: &str) -> String {
    let aman = if nilai.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{nilai}")
    } else {
        nilai.to_string()
    };
    quote(&aman)
}

/// Kolom angka: tanpa prefix, tanpa quote.
pub fn angka(nilai: Decimal) -> String {
    nilai.to_string()
}

/// Satu baris CSV dengan CRLF di akhir, sesuai RFC 4180.
pub fn baris(kolom: &[String]) -> String {
    let mut out = kolom.join(",");
    out.push_str("\r\n");
    out
}

fn quote(nilai: &str) -> String {
    if nilai.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", nilai.replace('"', "\"\""))
    } else {
        nilai.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal::Decimal;

    #[test]
    fn teks_biasa_tidak_diubah() {
        assert_eq!(teks("Penjualan"), "Penjualan");
    }

    #[test]
    fn teks_dengan_koma_dan_kutip_di_quote() {
        assert_eq!(teks("Bayar, \"lunas\""), "\"Bayar, \"\"lunas\"\"\"");
    }

    #[test]
    fn teks_berawalan_formula_diberi_prefix() {
        assert_eq!(teks("=SUM(A1)"), "'=SUM(A1)");
        assert_eq!(teks("+62"), "'+62");
        assert_eq!(teks("-catatan"), "'-catatan");
        assert_eq!(teks("@user"), "'@user");
    }

    #[test]
    fn angka_negatif_tidak_diberi_prefix() {
        assert_eq!(angka(Decimal::new(-500, 2)), "-5.00");
    }

    #[test]
    fn baris_diakhiri_crlf() {
        let kolom = vec!["a".to_string(), teks("b,c")];
        assert_eq!(baris(&kolom), "a,\"b,c\"\r\n");
    }
}
