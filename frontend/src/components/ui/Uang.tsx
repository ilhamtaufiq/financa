import { rupiah } from '../../lib/format';
import { cn } from '../../lib/cn';

// Angka uang dengan simbol mata uang lebih kecil dan pudar, angka tetap tebal (DESIGN.md "Financial Number Hierarchies").
// Menerima nilai desimal dari server dan memakai format rupiah yang sama dengan bagian lain aplikasi.

interface Props {
  nilai: string | number;
  className?: string;
}

export function Uang({ nilai, className }: Props) {
  const teks = rupiah(nilai);
  // Pisah awalan mata uang (misalnya "Rp" atau "-Rp") dari angkanya.
  const cocok = teks.match(/^(-?\D*?)\s*(\d.*)$/);
  if (!cocok) return <span className={className}>{teks}</span>;

  const [, simbol, angka] = cocok;
  return (
    <span className={cn('tabular-nums', className)}>
      <span className="mr-1 align-top text-[0.6em] font-semibold text-redup">{simbol.trim()}</span>
      <span className="font-bold">{angka}</span>
    </span>
  );
}
