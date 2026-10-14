use serde::Serialize;

/// Usulan isian transaksi dari teks struk. Semua field opsional karena OCR bisa meleset.
/// Pengguna tetap memeriksa dan menyimpan sendiri, jadi hasil ini tidak pernah langsung tersimpan.
#[derive(Debug, Default, PartialEq, Serialize)]
pub struct UsulanStruk {
    /// Jumlah rupiah dengan titik sebagai desimal, mis. "12500" atau "12500.50".
    pub jumlah: Option<String>,
    /// Tanggal dalam format ISO, yyyy-mm-dd.
    pub tanggal: Option<String>,
    /// Nama toko dari baris pertama yang terlihat seperti nama.
    pub toko: Option<String>,
    /// Teks mentah hasil OCR, supaya pengguna bisa melihat dari mana usulan berasal.
    pub teks: String,
}

/// Mengurai teks hasil OCR menjadi usulan. Tidak ada yang gagal: field yang tidak ketemu dibiarkan kosong.
pub fn urai(teks: &str) -> UsulanStruk {
    let baris: Vec<&str> = teks.lines().map(str::trim).filter(|b| !b.is_empty()).collect();
    UsulanStruk {
        jumlah: cari_jumlah(&baris),
        tanggal: cari_tanggal(&baris),
        toko: cari_toko(&baris),
        teks: teks.to_string(),
    }
}

/// Prioritas: "total bayar" atau "grand total" dulu, lalu "bayar", lalu "total". "Subtotal" dilewati.
/// Jika angka tidak ada di baris yang sama dengan kata kunci, cek baris berikutnya.
fn cari_jumlah(baris: &[&str]) -> Option<String> {
    let kunci: [fn(&str) -> bool; 3] = [
        |b| b.contains("TOTAL BAYAR") || b.contains("GRAND TOTAL"),
        |b| b.contains("BAYAR"),
        |b| b.contains("TOTAL") && !b.contains("SUB"),
    ];
    for cocok in kunci {
        for (i, b) in baris.iter().enumerate() {
            if !cocok(&b.to_uppercase()) {
                continue;
            }
            let kandidat = std::iter::once(*b).chain(baris.get(i + 1).copied());
            for teks in kandidat {
                if let Some(j) = teks.split_whitespace().rev().find_map(parse_rupiah) {
                    return Some(j);
                }
            }
        }
    }
    None
}

/// Format Indonesia: titik sebagai pemisah ribuan, koma sebagai desimal.
/// Koma hanya dianggap desimal jika diikuti tepat dua digit (sen). "Rp 12.500" -> 12500, "12.500,50" -> 12500.50.
fn parse_rupiah(token: &str) -> Option<String> {
    let bersih: String = token
        .to_uppercase()
        .trim_start_matches("RP")
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
        .collect();
    if !bersih.chars().any(|c| c.is_ascii_digit()) {
        return None;
    }

    let (bulat, desimal) = match bersih.rfind(',') {
        Some(i) => {
            let (b, d) = bersih.split_at(i);
            let d = &d[1..];
            if d.len() == 2 && d.chars().all(|c| c.is_ascii_digit()) {
                (b.replace('.', ""), Some(d.to_string()))
            } else {
                (bersih.replace(',', "").replace('.', ""), None)
            }
        }
        None => (bersih.replace('.', ""), None),
    };

    let angka: u64 = bulat.parse().ok()?;
    if angka == 0 {
        return None;
    }
    match desimal {
        Some(d) if d != "00" => Some(format!("{angka}.{d}")),
        _ => Some(angka.to_string()),
    }
}

/// Mengenali dd/mm/yyyy, dd-mm-yy, dd.mm.yyyy, dan yyyy-mm-dd.
fn cari_tanggal(baris: &[&str]) -> Option<String> {
    baris.iter().flat_map(|b| b.split_whitespace()).find_map(parse_tanggal)
}

fn parse_tanggal(token: &str) -> Option<String> {
    let bagian: Vec<&str> = token.split(['/', '-', '.']).collect();
    if bagian.len() != 3 || bagian.iter().any(|b| b.is_empty() || !b.chars().all(|c| c.is_ascii_digit())) {
        return None;
    }
    let (tahun, bulan, hari) = if bagian[0].len() == 4 {
        (bagian[0], bagian[1], bagian[2])
    } else {
        (bagian[2], bagian[1], bagian[0])
    };
    let (tahun, bulan, hari): (u32, u32, u32) = (tahun.parse().ok()?, bulan.parse().ok()?, hari.parse().ok()?);
    let tahun = if tahun < 100 { 2000 + tahun } else { tahun };
    if !(2000..=2100).contains(&tahun) || !(1..=12).contains(&bulan) || !(1..=31).contains(&hari) {
        return None;
    }
    Some(format!("{tahun:04}-{bulan:02}-{hari:02}"))
}

/// Baris pertama yang terlihat seperti nama: sebagian besar huruf, dan bukan label struk.
fn cari_toko(baris: &[&str]) -> Option<String> {
    const LABEL: [&str; 6] = ["STRUK", "NOTA", "RECEIPT", "TANGGAL", "KASIR", "ALAMAT"];
    baris.iter().find_map(|b| {
        let huruf = b.chars().filter(|c| c.is_alphabetic()).count();
        let total = b.chars().filter(|c| !c.is_whitespace()).count();
        let mirip_nama = huruf >= 3 && huruf * 10 >= total * 6;
        let bukan_label = !LABEL.iter().any(|l| b.to_uppercase().contains(l));
        (mirip_nama && bukan_label).then(|| b.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jumlah_dari_total_bayar_format_indonesia() {
        let teks = "WARUNG MAKAN SEDERHANA\nNasi goreng 15.000\nTotal 15.000\nTunai 20.000\nTotal Bayar Rp 15.000";
        assert_eq!(urai(teks).jumlah.as_deref(), Some("15000"));
    }

    #[test]
    fn subtotal_dilewati() {
        let teks = "Kopi 8.000\nSubtotal 8.000\nTotal 8.500";
        assert_eq!(urai(teks).jumlah.as_deref(), Some("8500"));
    }

    #[test]
    fn angka_di_baris_berikutnya() {
        let teks = "Total\nRp 125.000,50";
        assert_eq!(urai(teks).jumlah.as_deref(), Some("125000.50"));
    }

    #[test]
    fn parse_rupiah_berbagai_bentuk() {
        assert_eq!(parse_rupiah("Rp"), None);
        assert_eq!(parse_rupiah("0"), None);
        assert_eq!(parse_rupiah("1.250.000"), Some("1250000".into()));
        assert_eq!(parse_rupiah("12.500,00"), Some("12500".into()));
        assert_eq!(parse_rupiah("12,500"), Some("12500".into()));
    }

    #[test]
    fn tanggal_berbagai_pemisah() {
        assert_eq!(urai("13/10/2026").tanggal.as_deref(), Some("2026-10-13"));
        assert_eq!(urai("3-7-26 10:45").tanggal.as_deref(), Some("2026-07-03"));
        assert_eq!(urai("2026-10-13").tanggal.as_deref(), Some("2026-10-13"));
    }

    #[test]
    fn tanggal_tidak_valid_diabaikan() {
        assert_eq!(urai("32/13/2026").tanggal, None);
        assert_eq!(urai("12.345.678").tanggal, None);
    }

    #[test]
    fn toko_dilewati_label() {
        let teks = "STRUK PEMBAYARAN\nToko Berkah Jaya\nTotal 9.000";
        assert_eq!(urai(teks).toko.as_deref(), Some("Toko Berkah Jaya"));
    }

    #[test]
    fn teks_kosong_tidak_menghasilkan_apa_pun() {
        assert_eq!(urai(""), UsulanStruk { teks: String::new(), ..Default::default() });
    }
}
