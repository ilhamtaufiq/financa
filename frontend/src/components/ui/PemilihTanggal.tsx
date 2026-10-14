import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { DayPicker } from 'react-day-picker';
import { id as localeId } from 'react-day-picker/locale';
import { tanggalLokal } from '../../lib/format';

// Pemilih tanggal: popover berisi kalender react-day-picker berbahasa Indonesia (minggu mulai Senin).
// Nilainya string "YYYY-MM-DD" dalam zona waktu lokal, sama seperti <input type="date">, jadi tidak ada konversi UTC.

interface Props {
  id: string;
  nilai: string;
  onUbah: (nilai: string) => void;
}

/** "2026-10-13" -> Date lokal. Dipecah manual karena `new Date("2026-10-13")` dibaca sebagai UTC dan bisa mundur sehari. */
function keTanggal(nilai: string): Date | undefined {
  const [t, b, h] = nilai.split('-').map(Number);
  if (!t || !b || !h) return undefined;
  return new Date(t, b - 1, h);
}

const FORMAT = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// Kelas untuk setiap bagian kalender, mengikuti bentuk dan warna aplikasi.
const KELAS_KALENDER = {
  root: 'w-full',
  months: 'relative',
  month: 'space-y-3',
  month_caption: 'flex h-11 items-center justify-center',
  caption_label: 'text-base font-bold capitalize',
  nav: 'absolute inset-x-0 top-0 flex items-center justify-between',
  button_previous: 'grid size-11 place-items-center rounded-full bg-inset text-teks transition hover:bg-garis',
  button_next: 'grid size-11 place-items-center rounded-full bg-inset text-teks transition hover:bg-garis',
  chevron: 'size-5 fill-current',
  month_grid: 'w-full border-collapse',
  weekday: 'pb-2 text-center text-xs font-bold text-redup',
  day: 'p-0.5 text-center',
  day_button:
    'grid size-10 w-full place-items-center rounded-full text-sm font-semibold transition hover:bg-inset focus-visible:outline-2',
  selected: '[&>button]:bg-cendera [&>button]:font-bold [&>button]:text-[#0a0a0a] [&>button]:shadow-[0_4px_14px_rgba(113,221,122,0.45)] [&>button:hover]:bg-cendera',
  today: '[&>button]:ring-2 [&>button]:ring-[#8a20a5]/40',
  outside: 'opacity-40',
  disabled: 'opacity-30',
  hidden: 'invisible',
} as const;

export function PemilihTanggal({ id, nilai, onUbah }: Props) {
  const [buka, setBuka] = useState(false);
  const tanggal = keTanggal(nilai);

  return (
    <Popover.Root open={buka} onOpenChange={setBuka}>
      <Popover.Trigger
        id={id}
        className="masukan flex items-center justify-between gap-3 text-left data-[state=open]:ring-2 data-[state=open]:ring-[#cf7fe3]"
      >
        <span className={tanggal ? '' : 'text-redup'}>{tanggal ? FORMAT.format(tanggal) : 'Pilih tanggal'}</span>
        <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-redup" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 5h18v16H3zM8 3v4M16 3v4M3 10h18" />
        </svg>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className="z-[60] w-[min(22rem,calc(100vw-2rem))] space-y-3 rounded-[32px] bg-permukaan p-4 shadow-[0_16px_48px_-8px_rgba(60,40,120,0.28)] motion-safe:animate-[naik_160ms_cubic-bezier(0.2,0.8,0.2,1)]"
        >
          <DayPicker
            mode="single"
            locale={localeId}
            weekStartsOn={1}
            showOutsideDays
            selected={tanggal}
            defaultMonth={tanggal}
            onSelect={(dipilih) => {
              if (!dipilih) return;
              onUbah(tanggalLokal(dipilih));
              setBuka(false);
            }}
            classNames={KELAS_KALENDER}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-full bg-inset py-2.5 text-sm font-bold transition hover:bg-garis"
              onClick={() => {
                onUbah(tanggalLokal());
                setBuka(false);
              }}
            >
              Hari ini
            </button>
            <Popover.Close className="flex-1 rounded-full bg-inset py-2.5 text-sm font-bold text-redup transition hover:bg-garis">
              Tutup
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
