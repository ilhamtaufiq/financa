import { cn } from '../../lib/cn';

// Badge persentase perubahan. Positif = tint hijau dengan tanda +, negatif = oranye solid dengan tanda -.
// Tanda dan panah ikut ditampilkan, jadi warna bukan satu-satunya penanda (DESIGN.md dan spesifikasi aksesibilitas).

interface Props {
  nilai: number;
  className?: string;
}

export function DeltaBadge({ nilai, className }: Props) {
  const positif = nilai >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold tabular-nums',
        positif ? 'bg-[#e4f5d8] text-[#2f7a1f]' : 'bg-[#ee5a24] text-white',
        className,
      )}
    >
      {positif ? '↗' : '↘'} {positif ? '+' : ''}
      {nilai}%
    </span>
  );
}
