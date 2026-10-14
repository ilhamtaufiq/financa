// Daftar halaman di bawah /app dan judulnya. Satu sumber untuk dua pemakai:
// - src/pages/app/[...ruta].astro: membuat HTML statis dan judul awal tiap rute.
// - src/app/Shell.tsx: memperbarui judul tab saat pengguna berpindah menu di dalam SPA.
// Dipisah ke modul sendiri karena getStaticPaths() di Astro hanya bisa memakai impor, bukan variabel di frontmatter.

export interface Halaman {
  /** Path di bawah /app tanpa garis miring di awal. Kosong untuk beranda. */
  ruta: string;
  judul: string;
}

export const HALAMAN: Halaman[] = [
  { ruta: '', judul: 'Beranda' },
  { ruta: 'transaksi', judul: 'Transaksi' },
  { ruta: 'transaksi/baru', judul: 'Catat transaksi' },
  { ruta: 'laporan', judul: 'Laporan' },
  { ruta: 'prakiraan', judul: 'Prakiraan' },
  { ruta: 'pengaturan', judul: 'Pengaturan' },
];

/** Judul menurut path di dalam SPA, mis. "/laporan" -> "Laporan" dan "/" -> "Beranda". */
export const JUDUL_PER_PATH: Record<string, string> = Object.fromEntries(
  HALAMAN.map((h) => [h.ruta === '' ? '/' : `/${h.ruta}`, h.judul]),
);
