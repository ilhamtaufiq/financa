import { useEffect, type ReactNode } from 'react';
import { AvatarPengguna } from '../components/ui/AvatarPengguna';
import { JUDUL_PER_PATH as JUDUL } from './halaman';
import { Link, usePathname } from './rute';

// Kerangka aplikasi: sidebar di layar lebar, bar atas, dan bar navigasi bawah di ponsel.
// Pindahan dari layouts/App.astro. Halaman isi dikirim lewat children.

// Ikon outline 24x24. Path disalin dari set Lucide (ISC).
const MENU = [
  { to: '/', label: 'Beranda', ikon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { to: '/transaksi', label: 'Transaksi', ikon: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01' },
  { to: '/laporan', label: 'Laporan', ikon: 'M3 21h18M7 17v-4M12 17V7M17 17v-7' },
  { to: '/pengaturan', label: 'Pengaturan', ikon: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4' },
];
const AKSI_UTAMA = { to: '/transaksi/baru', label: 'Catat transaksi', ikon: 'M12 5v14M5 12h14' };

function Ikon({ path, className, stroke = 2 }: { path: string; className: string; stroke?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const judul = JUDUL[pathname] ?? 'Financa';

  // Judul tab mengikuti halaman aktif, dengan format yang sama seperti di HTML statis: "Financa - Laporan".
  useEffect(() => {
    document.title = `Financa - ${judul}`;
  }, [judul]);

  return (
    <div className="min-h-screen bg-latar text-teks md:flex">
      <aside className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-garis md:px-4 md:py-6">
        <Link to="/" className="flex items-center gap-3 rounded-xl px-2 py-1.5">
          <img src="/ikon.svg" alt="" width="36" height="36" className="size-9 rounded-xl" />
          <span className="text-lg font-extrabold tracking-tight">Financa</span>
        </Link>

        <Link to={AKSI_UTAMA.to} className="tombol-utama mt-8 w-full" aria-current={pathname === AKSI_UTAMA.to ? 'page' : undefined}>
          <Ikon path={AKSI_UTAMA.ikon} className="size-5" stroke={2.25} />
          {AKSI_UTAMA.label}
        </Link>

        <nav aria-label="Menu utama" className="mt-6">
          <ul className="space-y-1">
            {MENU.map((m) => {
              const aktif = pathname === m.to;
              return (
                <li key={m.to}>
                  <Link
                    to={m.to}
                    aria-current={aktif ? 'page' : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-full px-4 text-sm font-semibold transition duration-150 ${
                      aktif ? 'bg-cendera text-[#0a0a0a] shadow-[0_8px_20px_-4px_rgb(113_221_122/0.55)]' : 'text-redup hover:bg-permukaan/70 hover:text-teks'
                    }`}
                  >
                    <Ikon path={m.ikon} className="size-5 shrink-0" />
                    {m.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-3 bg-latar/80 px-4 shadow-[0_1px_8px_rgba(0,0,0,0.04)] backdrop-blur-xl md:px-8">
          <Link to="/" className="md:hidden" aria-label="Financa, ke beranda">
            <img src="/ikon.svg" alt="" width="28" height="28" className="size-7 rounded-lg" />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-xl font-bold tracking-tight">{judul}</h1>
          <Link to="/pengaturan" aria-label="Pengaturan akun dan avatar" className="shrink-0">
            <AvatarPengguna className="size-10" />
          </Link>
        </header>

        <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-6 md:px-8 md:pb-12 md:pt-8">{children}</main>
      </div>

      {/* Bar navigasi ponsel. Tombol Catat di tengah dibuat menonjol karena itu aksi yang paling sering. */}
      <nav
        aria-label="Menu utama ponsel"
        className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 rounded-full bg-permukaan/85 shadow-[0_8px_32px_-8px_rgb(166_63_192/0.18)] ring-1 ring-black/5 backdrop-blur-xl md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-5 items-center px-2 py-2">
          {[...MENU.slice(0, 2), null, ...MENU.slice(2)].map((m, i) =>
            m === null ? (
              <li key="aksi" className="flex justify-center">
                <Link
                  to={AKSI_UTAMA.to}
                  aria-label="Catat transaksi"
                  className="-mt-7 grid size-14 place-items-center rounded-full bg-cendera text-[#0a0a0a] shadow-[0_8px_20px_-4px_rgb(113_221_122/0.7)] transition active:scale-95"
                >
                  <Ikon path={AKSI_UTAMA.ikon} className="size-7" stroke={2.5} />
                </Link>
              </li>
            ) : (
              <li key={`${m.to}-${i}`}>
                <Link
                  to={m.to}
                  aria-current={pathname === m.to ? 'page' : undefined}
                  className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-full text-[11px] font-bold tracking-[0.06em] transition ${
                    pathname === m.to ? 'bg-cendera text-[#0a0a0a]' : 'text-redup'
                  }`}
                >
                  <Ikon path={m.ikon} className="size-5" />
                  {m.label}
                </Link>
              </li>
            ),
          )}
        </ul>
      </nav>
    </div>
  );
}
