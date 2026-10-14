import { cn } from '../../lib/cn';

// Bilah progres tipis. Lebar dihitung dari nilai dalam persen dan dijepit ke 0–100.
// Track memakai pola garis diagonal (kelas bar-garis di global.css) supaya terlihat seperti latar yang belum terisi.

interface Props {
  persen: number;
  label: string;
  warna?: 'hijau' | 'ungu' | 'oranye';
  className?: string;
}

// Isian berupa gradien multi-stop, sesuai DESIGN.md (XP Progress Bar).
const WARNA = {
  hijau: 'bg-gradient-to-r from-[#8fd45f] to-[#2f9e44]',
  ungu: 'bg-gradient-to-r from-[#cf7fe3] to-[#a63fc0]',
  oranye: 'bg-gradient-to-r from-[#e8c64a] to-[#ee5a24]',
} as const;

export function ProgressBar({ persen, label, warna = 'hijau', className }: Props) {
  const nilai = Math.min(100, Math.max(0, Math.round(persen)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={nilai}
      className={cn('h-3 overflow-hidden rounded-full bg-inset', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-500', WARNA[warna])} style={{ width: `${nilai}%` }} />
    </div>
  );
}
