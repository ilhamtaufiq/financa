import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

// Router kecil untuk SPA di /app. Rutenya hanya beberapa halaman statis, jadi tidak perlu
// dependensi router. Dengan begitu tidak ada salinan kode router kedua di bundel.

export const BASE = '/app';

function tanpaBase(path: string): string {
  const sisa = path.startsWith(BASE) ? path.slice(BASE.length) : path;
  const bersih = sisa.replace(/\/$/, '');
  return bersih === '' ? '/' : bersih;
}

/** Path aplikasi tanpa basename dan tanpa garis miring di akhir. Ikut berubah saat navigasi. */
export function usePathname(): string {
  const [path, setPath] = useState(() => tanpaBase(window.location.pathname));

  useEffect(() => {
    const perbarui = () => setPath(tanpaBase(window.location.pathname));
    window.addEventListener('popstate', perbarui);
    return () => window.removeEventListener('popstate', perbarui);
  }, []);

  return path;
}

/** Pindah ke rute lain di dalam aplikasi tanpa memuat ulang halaman. */
export function pindah(to: string): void {
  window.history.pushState(null, '', to === '/' ? BASE + '/' : BASE + to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

type PropLink = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

/** Tautan ke rute aplikasi. Klik biasa pindah tanpa reload; klik dengan modifier tetap ditangani browser. */
export function Link({ to, onClick, ...sisa }: PropLink) {
  function klik(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    pindah(to);
  }
  return <a href={to === '/' ? BASE + '/' : BASE + to} onClick={klik} {...sisa} />;
}
