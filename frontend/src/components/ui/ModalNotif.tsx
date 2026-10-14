import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';

// Modal notifikasi: hasil sebuah aksi (berhasil, info, gagal) dengan satu tombol utama dan tautan kedua opsional.
// Tidak menutup sendiri, supaya bisa dibaca pelan-pelan, termasuk lewat pembaca layar.
// Fokus pindah ke modal saat terbuka, Tab terjebak di dalamnya, Esc menutup, dan fokus kembali ke pemicu.

export type JenisNotif = 'ok' | 'info' | 'galat';

export interface DataNotif {
  jenis: JenisNotif;
  judul: string;
  pesan: string;
}

interface Props {
  notif: DataNotif | null;
  onTutup: () => void;
  /** Label tombol utama. Menutup modal. Default "Oke". */
  labelTutup?: string;
  /** Tautan kedua, mis. "Lihat transaksi". Hanya tampil jika diisi. */
  tautan?: { label: string; href: string };
}

const GAYA: Record<JenisNotif, { lingkaran: string; ikon: ReactNode }> = {
  ok: {
    lingkaran: 'bg-[#e4f5d8] text-[#2f7a1f]',
    ikon: <path d="M20 6 9 17l-5-5" />,
  },
  info: {
    lingkaran: 'bg-[#dbe8fb] text-[#2f6fdb]',
    ikon: <path d="M12 11v5M12 8h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />,
  },
  galat: {
    lingkaran: 'bg-[#fde3e3] text-[#c2410c]',
    ikon: <path d="M12 8v5M12 16h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />,
  },
};

const BISA_FOKUS = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function ModalNotif({ notif, onTutup, labelTutup = 'Oke', tautan }: Props) {
  const idJudul = useId();
  const idPesan = useId();
  const kotak = useRef<HTMLDivElement>(null);
  const tombolTutup = useRef<HTMLButtonElement>(null);

  // Saat terbuka: simpan elemen yang sedang fokus, pindahkan fokus ke tombol utama, dan kembalikan saat ditutup.
  useEffect(() => {
    if (!notif) return;
    const sebelumnya = document.activeElement as HTMLElement | null;
    tombolTutup.current?.focus();
    return () => sebelumnya?.focus?.();
  }, [notif]);

  // Esc menutup. Tab berputar di dalam modal supaya fokus tidak lari ke halaman di belakangnya.
  useEffect(() => {
    if (!notif) return;
    function tekan(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onTutup();
        return;
      }
      if (e.key !== 'Tab' || !kotak.current) return;
      const bisa = Array.from(kotak.current.querySelectorAll<HTMLElement>(BISA_FOKUS));
      if (bisa.length === 0) return;
      const awal = bisa[0];
      const akhir = bisa[bisa.length - 1];
      if (e.shiftKey && document.activeElement === awal) {
        e.preventDefault();
        akhir.focus();
      } else if (!e.shiftKey && document.activeElement === akhir) {
        e.preventDefault();
        awal.focus();
      }
    }
    document.addEventListener('keydown', tekan);
    return () => document.removeEventListener('keydown', tekan);
  }, [notif, onTutup]);

  if (!notif) return null;
  const gaya = GAYA[notif.jenis];

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-5">
      {/* Latar: klik di luar kartu menutup modal. Tidak fokusable, karena Esc dan tombol sudah ada. */}
      <div aria-hidden="true" className="absolute inset-0 bg-black/30 backdrop-blur-sm motion-safe:animate-[muncul_150ms_ease-out]" onClick={onTutup} />

      <div
        ref={kotak}
        role={notif.jenis === 'galat' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={idJudul}
        aria-describedby={idPesan}
        className="relative w-full max-w-sm space-y-5 rounded-[32px] bg-permukaan p-6 text-center shadow-[0_24px_60px_-12px_rgba(60,40,120,0.35)] motion-safe:animate-[naik_200ms_cubic-bezier(0.2,0.8,0.2,1)]"
      >
        <span aria-hidden="true" className={cn('mx-auto grid size-20 place-items-center rounded-full', gaya.lingkaran)}>
          <svg viewBox="0 0 24 24" className="size-10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            {gaya.ikon}
          </svg>
        </span>

        <div className="space-y-1.5">
          <h2 id={idJudul} className="text-2xl font-bold leading-tight tracking-tight">{notif.judul}</h2>
          <p id={idPesan} className="text-redup">{notif.pesan}</p>
        </div>

        <div className="flex flex-col gap-2">
          <button ref={tombolTutup} type="button" onClick={onTutup} className="tombol-utama min-h-14 w-full text-base">
            {labelTutup}
          </button>
          {tautan && (
            <a href={tautan.href} className="tautan-ungu inline-flex min-h-11 items-center justify-center rounded-full text-sm">
              {tautan.label}
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
