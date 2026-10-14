// Prakiraan berbasis logika, bukan model AI. Angkanya diambil dari rata-rata bulan-bulan sebelumnya
// lalu dikalikan dengan porsi sisa bulan ini. Hasilnya perkiraan kasar dari pola catatan, bukan ramalan.

export interface AngkaBulan {
  masuk: number;
  keluar: number;
}

export interface Prakiraan {
  /** Jumlah bulan sebelumnya yang punya catatan dan dipakai sebagai dasar rata-rata. */
  sampelBulan: number;
  rataMasuk: number;
  rataKeluar: number;
  /** Nilai aktual bulan ini sampai hari ini. */
  aktualMasuk: number;
  aktualKeluar: number;
  /** Proyeksi sampai akhir bulan: aktual + rata-rata dikali sisa hari. */
  proyeksiMasuk: number;
  proyeksiKeluar: number;
  /** Saldo sekarang ditambah selisih proyeksi sisa bulan. */
  proyeksiSaldoAkhir: number;
  /** Selisih proyeksi saldo terhadap saldo sekarang. */
  proyeksiSelisih: number;
}

/**
 * Menghitung prakiraan akhir bulan.
 * - riwayat: bulan sebelumnya. Bulan tanpa catatan (masuk dan keluar nol) tidak dihitung.
 * - ini: total bulan berjalan sampai hari ini.
 * - saldoSekarang: total saldo rekening aktif saat ini.
 * - hariIni dan hariBulan: posisi dalam bulan berjalan.
 */
export function hitungPrakiraan(
  riwayat: AngkaBulan[],
  ini: AngkaBulan,
  saldoSekarang: number,
  hariIni: number,
  hariBulan: number,
): Prakiraan {
  const sampel = riwayat.filter((b) => b.masuk > 0 || b.keluar > 0);
  const n = sampel.length;
  const rataMasuk = n ? sampel.reduce((s, b) => s + b.masuk, 0) / n : 0;
  const rataKeluar = n ? sampel.reduce((s, b) => s + b.keluar, 0) / n : 0;

  // Porsi bulan yang belum lewat. Dijepit ke 0–1 supaya input aneh tidak menghasilkan angka liar.
  const sisa = hariBulan > 0 ? Math.min(1, Math.max(0, (hariBulan - hariIni) / hariBulan)) : 0;
  const proyeksiMasuk = ini.masuk + rataMasuk * sisa;
  const proyeksiKeluar = ini.keluar + rataKeluar * sisa;
  const proyeksiSelisih = (rataMasuk - rataKeluar) * sisa;

  return {
    sampelBulan: n,
    rataMasuk,
    rataKeluar,
    aktualMasuk: ini.masuk,
    aktualKeluar: ini.keluar,
    proyeksiMasuk,
    proyeksiKeluar,
    proyeksiSaldoAkhir: saldoSekarang + proyeksiSelisih,
    proyeksiSelisih,
  };
}
