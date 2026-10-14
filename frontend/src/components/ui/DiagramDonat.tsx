import { ringkasIrisan as ringkas, type Irisan } from '../../lib/diagram';
import { rupiah } from '../../lib/format';

// Diagram donat komposisi: tiap irisan adalah satu kategori. Kategori kecil digabung menjadi "Lainnya"
// supaya diagram tetap terbaca. Legenda di bawah memuat nama, persen, dan nominal sebagai teks biasa,
// jadi informasinya tidak bergantung pada warna dan tetap bisa dibaca pembaca layar.

interface Props {
  irisan: Irisan[];
  /** Warna per irisan, diambil bergilir. */
  warna: readonly string[];
  /** Teks kecil di tengah, mis. "Total pendapatan". */
  pusatLabel: string;
  /** Nilai di tengah, sudah terformat. */
  pusatNilai: string;
  /** Jumlah irisan maksimal termasuk "Lainnya". Default 5. */
  maks?: number;
}

const WARNA_LAINNYA = '#cfc7c5';
const JARI = 46;
const KELILING = 2 * Math.PI * JARI;
const CELAH = 2;

export function DiagramDonat({ irisan, warna, pusatLabel, pusatNilai, maks = 5 }: Props) {
  const data = ringkas(irisan, maks);
  const total = data.reduce((jml, i) => jml + i.nilai, 0);

  if (total <= 0) {
    return <p className="rounded-[20px] bg-inset p-5 text-center text-sm text-redup">Belum ada data bulan ini.</p>;
  }

  // Irisan digambar sebagai lingkaran dengan garis putus-putus: panjang garis = porsi, offset = jumlah porsi sebelumnya.
  let terpakai = 0;
  const busur = data.map((i, idx) => {
    const panjang = (i.nilai / total) * KELILING;
    const warnaIrisan = i.label === 'Lainnya' && data.length === maks ? WARNA_LAINNYA : warna[idx % warna.length];
    const hasil = { ...i, panjang, offset: -terpakai, warnaIrisan };
    terpakai += panjang;
    return hasil;
  });

  return (
    <div className="space-y-5">
      <div className="relative mx-auto aspect-square w-full max-w-[220px]">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
          <circle cx="60" cy="60" r={JARI} fill="none" stroke="#f6f3f2" strokeWidth="16" />
          {busur.map((b) => (
            <circle
              key={b.label}
              cx="60"
              cy="60"
              r={JARI}
              fill="none"
              stroke={b.warnaIrisan}
              strokeWidth="16"
              strokeDasharray={`${Math.max(0, b.panjang - (busur.length > 1 ? CELAH : 0))} ${KELILING}`}
              strokeDashoffset={b.offset}
            />
          ))}
        </svg>
        <div className="absolute inset-0 grid place-content-center px-8 text-center">
          <p className="text-xs text-redup">{pusatLabel}</p>
          <p className="text-lg font-bold leading-tight tabular-nums">{pusatNilai}</p>
        </div>
      </div>

      <ul className="space-y-3">
        {busur.map((b) => (
          <li key={b.label} className="flex items-center gap-3 text-sm">
            <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ backgroundColor: b.warnaIrisan }} />
            <span className="min-w-0 flex-1 truncate font-semibold">{b.label}</span>
            <span className="shrink-0 tabular-nums text-redup">{rupiah(b.nilai)}</span>
            <span className="w-11 shrink-0 text-right font-bold tabular-nums">{Math.round((b.nilai / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
