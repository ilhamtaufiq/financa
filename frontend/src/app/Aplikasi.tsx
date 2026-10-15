import { lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { mulaiSinkronOtomatis } from '../lib/auto-sync';
import { ambilSesi } from '../lib/api';
import ErrorBoundary from './ErrorBoundary';
import Shell from './Shell';
import { usePathname } from './rute';

// Seluruh area aplikasi di /app berjalan sebagai satu SPA. Halaman statis untuk tiap rute
// dibuat oleh src/pages/app/[...ruta].astro. Tiap halaman dimuat saat dibutuhkan (lazy),
// dan error di satu halaman tidak menjatuhkan kerangka aplikasi.

const HALAMAN: Record<string, ComponentType> = {
  '/': lazy(() => import('../components/islands/Beranda')),
  '/transaksi': lazy(() => import('../components/islands/DaftarTransaksi')),
  '/transaksi/baru': lazy(() => import('../components/islands/FormTransaksi')),
  '/laporan': lazy(() => import('../components/islands/Laporan')),
  '/pengaturan': lazy(() => import('../components/islands/Pengaturan')),
  '/prakiraan': lazy(() => import('../components/islands/Prakiraan')),
  '/draf': lazy(() => import('../components/islands/TinjauDraf')),
};

export default function Aplikasi() {
  const pathname = usePathname();
  // Tanpa sesi, area aplikasi tidak dibuka. Pengguna dikirim ke landing page.
  const [sudahMasuk] = useState(() => ambilSesi() !== null);

  useEffect(() => {
    if (!sudahMasuk) {
      // replace supaya tombol Kembali tidak menampilkan /app yang sudah ditolak.
      window.location.replace('/');
      return;
    }
    mulaiSinkronOtomatis();
  }, [sudahMasuk]);

  if (!sudahMasuk) return null;

  const Halaman = HALAMAN[pathname] ?? HALAMAN['/'];
  return (
    <Shell>
      {/* key per rute: error di satu halaman tidak terbawa ke halaman lain. */}
      <ErrorBoundary key={pathname}>
        <Suspense fallback={<p className="text-sm text-redup">Memuat…</p>}>
          <Halaman />
        </Suspense>
      </ErrorBoundary>
    </Shell>
  );
}
