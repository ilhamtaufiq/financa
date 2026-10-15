use serde::Serialize;

use crate::struk::{parse_rupiah, parse_tanggal};

/// Usulan transaksi dari email notifikasi bank atau e-wallet. Hanya usulan: pengguna meninjau
/// lalu menyetujuinya, tidak ada yang tersimpan langsung.
#[derive(Debug, Default, PartialEq, Serialize)]
pub struct UsulanNotifikasi {
    /// Jumlah rupiah dengan titik sebagai desimal, mis. "150000".
    pub jumlah: Option<String>,
    /// "pemasukan" atau "pengeluaran". Kosong jika arah transaksi tidak jelas dari teks.
    pub tipe: Option<&'static str>,
    /// Tanggal ISO yyyy-mm-dd. Jika email tidak menyebut tanggal, dipakai tanggal email dikirim.
    pub tanggal: Option<String>,
    /// Subjek email, dipakai sebagai keterangan awal.
    pub keterangan: String,
}

/// Kata kunci arah transaksi, dicek dalam huruf kecil. Jika keduanya cocok, arahnya dibiarkan kosong.
const KELUAR: [&str; 8] = ["dibayar", "pembayaran", "debit", "keluar", "transfer ke", "belanja", "tarik tunai", "pengeluaran"];
const MASUK: [&str; 6] = ["diterima", "kredit", "masuk", "dana masuk", "terima", "pemasukan"];

/// Mengurai email notifikasi. `subjek` dan `isi` berupa teks biasa; `tanggal_email` (yyyy-mm-dd) dipakai sebagai cadangan.
/// Mengembalikan `None` jika tidak ada nominal rupiah yang bisa dibaca.
pub fn urai(subjek: &str, isi: &str, tanggal_email: Option<&str>) -> Option<UsulanNotifikasi> {
    let teks = format!("{subjek}\n{isi}");
    let jumlah = cari_jumlah(&teks)?;

    Some(UsulanNotifikasi {
        jumlah: Some(jumlah),
        tipe: cari_tipe(&teks.to_lowercase()),
        tanggal: cari_tanggal(&teks).or_else(|| tanggal_email.map(str::to_string)),
        keterangan: subjek.trim().to_string(),
    })
}

/// Nominal yang didahului "Rp" atau "IDR". Angka tanpa penanda itu sengaja diabaikan
/// supaya nomor rekening atau referensi tidak terbaca sebagai jumlah.
fn cari_jumlah(teks: &str) -> Option<String> {
    let kapital = teks.to_uppercase();
    let bagian: Vec<&str> = kapital.split_whitespace().collect();

    for (i, token) in bagian.iter().enumerate() {
        // "Rp150.000" dalam satu token, atau "Rp" lalu "150.000" sebagai token terpisah.
        if token.starts_with("RP") || token.starts_with("IDR") {
            if let Some(j) = parse_rupiah(token) {
                return Some(j);
            }
        }
        if (*token == "RP" || *token == "IDR") && i + 1 < bagian.len() {
            if let Some(j) = parse_rupiah(bagian[i + 1]) {
                return Some(j);
            }
        }
    }
    None
}

fn cari_tipe(teks_kecil: &str) -> Option<&'static str> {
    let keluar = KELUAR.iter().any(|k| teks_kecil.contains(k));
    let masuk = MASUK.iter().any(|k| teks_kecil.contains(k));
    match (keluar, masuk) {
        (true, false) => Some("pengeluaran"),
        (false, true) => Some("pemasukan"),
        _ => None,
    }
}

fn cari_tanggal(teks: &str) -> Option<String> {
    teks.split_whitespace()
        .map(|t| t.trim_matches(|c: char| c == ',' || c == '.' || c == ';'))
        .find_map(parse_tanggal)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pengeluaran_dari_notifikasi_bank() {
        let u = urai(
            "Transaksi berhasil",
            "Pembayaran sebesar Rp 150.000 ke Tokopedia pada 12/10/2026 berhasil.",
            Some("2026-10-13"),
        )
        .unwrap();
        assert_eq!(u.jumlah.as_deref(), Some("150000"));
        assert_eq!(u.tipe, Some("pengeluaran"));
        assert_eq!(u.tanggal.as_deref(), Some("2026-10-12"));
    }

    #[test]
    fn pemasukan_dengan_desimal() {
        let u = urai("Dana masuk", "Anda menerima IDR 250.000,50 dari Budi.", None).unwrap();
        assert_eq!(u.jumlah.as_deref(), Some("250000.50"));
        assert_eq!(u.tipe, Some("pemasukan"));
    }

    #[test]
    fn tanggal_email_jadi_cadangan() {
        let u = urai("Debit Rp 20.000", "Transaksi debit Anda.", Some("2026-10-14")).unwrap();
        assert_eq!(u.tanggal.as_deref(), Some("2026-10-14"));
    }

    #[test]
    fn arah_ambigu_dibiarkan_kosong() {
        let u = urai("Notifikasi", "Saldo Rp 1.000.000 dan transfer ke rekening lain dari kredit.", None).unwrap();
        assert_eq!(u.tipe, None);
    }

    #[test]
    fn tanpa_rupiah_tidak_ada_usulan() {
        assert!(urai("Promo", "Nomor referensi 123456 untuk Anda.", None).is_none());
    }
}
