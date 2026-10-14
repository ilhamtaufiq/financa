const rupiahFormat = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

/** Tampilan Rupiah dari string desimal backend, mis. "50000.00" -> "Rp 50.000". */
export function rupiah(nilai: string | number): string {
  return rupiahFormat.format(typeof nilai === 'number' ? nilai : Number(nilai));
}

/**
 * Angka uang yang dipendekkan untuk label sumbu grafik: 1500000 -> "1,5 juta", 500000 -> "500 rb", 2500000000 -> "2,5 M".
 * Hanya untuk label. Nominal lengkap tetap memakai `rupiah`.
 */
export function rupiahRingkas(nilai: number): string {
  const mutlak = Math.abs(nilai);
  const tanda = nilai < 0 ? '-' : '';
  const satuan: [number, string][] = [
    [1e9, ' M'],
    [1e6, ' juta'],
    [1e3, ' rb'],
  ];
  for (let i = 0; i < satuan.length; i++) {
    let [batas, akhiran] = satuan[i];
    if (mutlak < batas) continue;
    // Pembulatan di batas satuan: 999.999 menjadi "1000 rb", padahal seharusnya "1 jt". Naikkan satu satuan.
    if (Number((mutlak / batas).toFixed(1)) >= 1000 && i > 0) [batas, akhiran] = satuan[i - 1];
    // Satu desimal, dan desimal ",0" dibuang: 2,0 jt -> 2 jt.
    const bagi = (mutlak / batas).toFixed(1).replace('.', ',').replace(/,0$/, '');
    return `${tanda}${bagi}${akhiran}`;
  }
  return `${tanda}${Math.round(mutlak)}`;
}

/** Tanggal lokal perangkat dalam format YYYY-MM-DD (bukan UTC). */
export function tanggalLokal(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const h = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${h}`;
}

/** Rentang tanggal satu bulan kalender, format YYYY-MM-DD. */
export function rentangBulan(tahun: number, bulan: number): { dari: string; sampai: string } {
  const dari = new Date(tahun, bulan - 1, 1);
  const sampai = new Date(tahun, bulan, 0);
  return { dari: tanggalLokal(dari), sampai: tanggalLokal(sampai) };
}
