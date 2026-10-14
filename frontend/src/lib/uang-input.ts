// Format input uang gaya Indonesia: titik sebagai pemisah ribuan, koma sebagai desimal.
// Yang disimpan di state dan dikirim ke server adalah nilai mentah: tanpa pemisah ribuan, titik sebagai desimal.
// Contoh: pengguna melihat "1.250.000,5", state berisi "1250000.5".

export interface OpsiAngka {
  /** Izinkan tanda minus di depan (mis. saldo awal negatif). */
  negatif?: boolean;
  /** Jumlah digit desimal maksimal. Default 2, sama dengan batas di backend. */
  maksDesimal?: number;
}

/**
 * Dari teks yang diketik pengguna ke nilai mentah.
 * Titik dianggap pemisah ribuan dan dibuang. Koma pertama menjadi titik desimal, sisanya diabaikan.
 * Karakter lain dibuang. Nol di depan dibuang, kecuali satu nol sebelum desimal.
 */
export function keNilaiMentah(teks: string, { negatif = false, maksDesimal = 2 }: OpsiAngka = {}): string {
  const minus = negatif && teks.trimStart().startsWith('-') ? '-' : '';
  const koma = teks.indexOf(',');
  const bagianBulat = koma === -1 ? teks : teks.slice(0, koma);
  const bagianDesimal = koma === -1 ? null : teks.slice(koma + 1);

  let bulat = bagianBulat.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const desimal = bagianDesimal === null ? null : bagianDesimal.replace(/\D/g, '').slice(0, maksDesimal);

  // Koma diketik lebih dulu daripada angka: tampil sebagai "0,".
  if (bulat === '' && desimal !== null) bulat = '0';

  return minus + bulat + (desimal !== null ? `.${desimal}` : '');
}

/** Dari nilai mentah ke teks tampilan dengan titik ribuan (regex) dan koma desimal. */
export function keTampilan(mentah: string): string {
  if (mentah === '') return '';
  const minus = mentah.startsWith('-') ? '-' : '';
  const sisa = minus ? mentah.slice(1) : mentah;
  const [bulat, desimal] = sisa.split('.');
  const ribuan = bulat.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${minus}${ribuan}${desimal !== undefined ? `,${desimal}` : ''}`;
}
