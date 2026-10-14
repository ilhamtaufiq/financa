import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { mulaiSinkronOtomatis } from '../lib/auto-sync';
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
};

export default function Aplikasi() {
  const pathname = usePathname();

  useEffect(() => {
    mulaiSinkronOtomatis();
  }, []);

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
