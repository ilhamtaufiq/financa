/** Menggabungkan class dan membuang nilai kosong, false, atau null. Tanpa dependensi tambahan. */
export function cn(...kelas: Array<string | false | null | undefined>): string {
  return kelas.filter(Boolean).join(' ');
}
