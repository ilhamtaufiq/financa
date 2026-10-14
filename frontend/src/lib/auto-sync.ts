import { hitungTertunda, kirimAntrean } from './sinkron';

// Sinkron otomatis: tidak ada tombol kirim. Antrean dikirim saat:
// - aplikasi dibuka,
// - koneksi kembali (event `online`),
// - tab kembali terlihat,
// - setiap 30 detik, tetapi hanya kalau memang ada antrean.
// Semua jalur lewat kirimAntrean, jadi tanpa sesi atau koneksi tidak ada yang dikirim.

const JEDA_MS = 30_000;

let sudahJalan = false;

async function sinkronJikaPerlu(): Promise<void> {
  if (!navigator.onLine) return;
  if ((await hitungTertunda()) === 0) return;
  await kirimAntrean();
}

/** Mulai sinkron otomatis. Aman dipanggil berkali-kali: hanya berjalan sekali per halaman. */
export function mulaiSinkronOtomatis(): void {
  if (sudahJalan || typeof window === 'undefined') return;
  sudahJalan = true;

  void sinkronJikaPerlu();
  window.addEventListener('online', () => void sinkronJikaPerlu());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sinkronJikaPerlu();
  });
  window.setInterval(() => void sinkronJikaPerlu(), JEDA_MS);
}
