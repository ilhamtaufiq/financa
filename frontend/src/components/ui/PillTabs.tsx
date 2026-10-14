import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

// Tab berbentuk pill. Tab aktif hijau Financa; tab tidak aktif boleh berwarna pastel sendiri (contoh Spending Analysis).
// Memakai role tablist/tab dan aria-selected supaya bisa dibaca pembaca layar.

interface Pilihan<T extends string> {
  nilai: T;
  label: string;
  /** Ikon kecil di kiri label. Dekoratif, jadi disembunyikan dari pembaca layar. */
  ikon?: ReactNode;
  /** Kelas warna untuk keadaan tidak aktif, misalnya 'bg-[#dbe8fb] text-[#2f6fdb]'. */
  tint?: string;
}

interface Props<T extends string> {
  label: string;
  pilihan: Pilihan<T>[];
  aktif: T;
  onPilih: (nilai: T) => void;
}

export function PillTabs<T extends string>({ label, pilihan, aktif, onPilih }: Props<T>) {
  return (
    <div role="tablist" aria-label={label} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
      {pilihan.map((p) => (
        <button
          key={p.nilai}
          type="button"
          role="tab"
          aria-selected={aktif === p.nilai}
          onClick={() => onPilih(p.nilai)}
          className={cn(
            'flex shrink-0 items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold transition duration-150 active:scale-95',
            aktif === p.nilai
              ? 'bg-cendera text-[#0a0a0a] shadow-[0_4px_14px_rgba(113,221,122,0.45)]'
              : (p.tint ?? 'bg-inset text-redup hover:text-teks'),
          )}
        >
          {p.ikon && <span aria-hidden="true" className="grid size-[18px] place-items-center">{p.ikon}</span>}
          {p.label}
        </button>
      ))}
    </div>
  );
}
