// Logika diagram yang dipakai bersama oleh tampilan di layar (SVG) dan ekspor PDF,
// supaya keduanya selalu menampilkan angka dan pengelompokan yang sama.

export interface Irisan {
  label: string;
  nilai: number;
}

/** Batas atas sumbu yang "bulat" (1, 2, 2,5, 5, atau 10 kali pangkat sepuluh), supaya garis bantu berangka rapi. */
export function batasAtasSumbu(maks: number): number {
  if (maks <= 0) return 1;
  const pangkat = 10 ** Math.floor(Math.log10(maks));
  for (const kali of [1, 2, 2.5, 5, 10]) {
    if (maks <= kali * pangkat) return kali * pangkat;
  }
  return 10 * pangkat;
}

/** Ambil kategori terbesar, gabungkan sisanya ke "Lainnya". Irisan bernilai nol dibuang. */
export function ringkasIrisan(irisan: Irisan[], maks: number): Irisan[] {
  const berisi = irisan.filter((i) => i.nilai > 0).sort((a, b) => b.nilai - a.nilai);
  if (berisi.length <= maks) return berisi;
  const atas = berisi.slice(0, maks - 1);
  const sisa = berisi.slice(maks - 1).reduce((jml, i) => jml + i.nilai, 0);
  return [...atas, { label: 'Lainnya', nilai: sisa }];
}
