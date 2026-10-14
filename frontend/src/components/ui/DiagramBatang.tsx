import { useState } from 'react';
import { batasAtasSumbu as batasAtas } from '../../lib/diagram';
import { rupiah, rupiahRingkas } from '../../lib/format';

// Diagram batang berpasangan (pemasukan dan pengeluaran per periode), digambar dengan SVG.
// Ketuk atau fokus satu periode untuk melihat angka persisnya di bawah grafik, karena angka di atas batang
// tidak muat di layar ponsel. Sumbu memakai angka ringkas ("1,5 juta", "2 M"). Tabel tersembunyi menyajikan data untuk pembaca layar.

export interface TitikBatang {
  /** Label singkat di sumbu, mis. "Okt". */
  label: string;
  /** Label lengkap untuk rincian, mis. "Oktober 2026". */
  labelPanjang: string;
  masuk: number;
  keluar: number;
}

interface Props {
  data: TitikBatang[];
}

const LEBAR = 340;
const TINGGI = 200;
const KIRI = 56; // Ruang untuk label sumbu seperti "500 juta".
const KANAN = 8;
const ATAS = 10;
const BAWAH = 26;
const WARNA_MASUK = '#8fd45f';
const WARNA_KELUAR = '#f4a6b8';

export function DiagramBatang({ data }: Props) {
  const [terpilih, setTerpilih] = useState(Math.max(0, data.length - 1));
  const lebarPlot = LEBAR - KIRI - KANAN;
  const tinggiPlot = TINGGI - ATAS - BAWAH;
  const atas = batasAtas(Math.max(0, ...data.map((d) => Math.max(d.masuk, d.keluar))));
  const slot = data.length > 0 ? lebarPlot / data.length : lebarPlot;
  const lebarBatang = Math.min(14, slot * 0.28);
  const tinggiDari = (nilai: number) => (nilai / atas) * tinggiPlot;
  const sumbuY = (nilai: number) => ATAS + tinggiPlot - tinggiDari(nilai);

  const dipilih = data[Math.min(terpilih, data.length - 1)];

  return (
    <div className="space-y-4">
      <svg viewBox={`0 0 ${LEBAR} ${TINGGI}`} className="w-full" role="group" aria-label="Diagram batang pemasukan dan pengeluaran per bulan">
        {/* Garis bantu dan label sumbu Y. */}
        {[0, 0.25, 0.5, 0.75, 1].map((bagian) => {
          const y = sumbuY(atas * bagian);
          return (
            <g key={bagian}>
              <line x1={KIRI} x2={LEBAR - KANAN} y1={y} y2={y} stroke="#e8e6e5" strokeWidth="1" strokeDasharray={bagian === 0 ? undefined : '3 4'} />
              <text x={KIRI - 8} y={y + 3.5} textAnchor="end" fontSize="10" fill="#6b7280" className="tabular-nums">
                {rupiahRingkas(atas * bagian)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const pusat = KIRI + slot * i + slot / 2;
          const aktif = i === terpilih;
          const tinggiMasuk = tinggiDari(d.masuk);
          const tinggiKeluar = tinggiDari(d.keluar);
          return (
            <g
              key={d.label + i}
              role="button"
              tabIndex={0}
              aria-pressed={aktif}
              aria-label={`${d.labelPanjang}: pemasukan ${rupiah(d.masuk)}, pengeluaran ${rupiah(d.keluar)}`}
              onClick={() => setTerpilih(i)}
              onFocus={() => setTerpilih(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setTerpilih(i);
                }
              }}
              className="cursor-pointer outline-none"
            >
              {/* Area ketuk selebar satu slot, jauh lebih besar dari batangnya. */}
              <rect x={KIRI + slot * i} y={ATAS} width={slot} height={tinggiPlot + BAWAH} fill={aktif ? '#f6f3f2' : 'transparent'} rx="10" />
              <rect
                x={pusat - lebarBatang - 2}
                y={sumbuY(d.masuk)}
                width={lebarBatang}
                height={Math.max(d.masuk > 0 ? 2 : 0, tinggiMasuk)}
                rx="4"
                fill={WARNA_MASUK}
                opacity={aktif ? 1 : 0.6}
              />
              <rect
                x={pusat + 2}
                y={sumbuY(d.keluar)}
                width={lebarBatang}
                height={Math.max(d.keluar > 0 ? 2 : 0, tinggiKeluar)}
                rx="4"
                fill={WARNA_KELUAR}
                opacity={aktif ? 1 : 0.6}
              />
              <text x={pusat} y={TINGGI - 8} textAnchor="middle" fontSize="11" fontWeight={aktif ? 700 : 500} fill={aktif ? '#1a1a1a' : '#6b7280'}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legenda dan rincian periode terpilih. */}
      <div className="flex items-center gap-4 text-xs font-semibold text-redup">
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: WARNA_MASUK }} />
          Pemasukan
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: WARNA_KELUAR }} />
          Pengeluaran
        </span>
      </div>

      {dipilih && (
        <dl className="grid grid-cols-3 gap-2 rounded-[20px] bg-inset p-4 text-sm" aria-live="polite">
          <div className="col-span-3 font-bold">{dipilih.labelPanjang}</div>
          <div>
            <dt className="text-xs text-redup">Masuk</dt>
            <dd className="font-bold tabular-nums text-[#1f6b3a]">{rupiah(dipilih.masuk)}</dd>
          </div>
          <div>
            <dt className="text-xs text-redup">Keluar</dt>
            <dd className="font-bold tabular-nums text-[#9a2c50]">{rupiah(dipilih.keluar)}</dd>
          </div>
          <div>
            <dt className="text-xs text-redup">Selisih</dt>
            <dd className={`font-bold tabular-nums ${dipilih.masuk - dipilih.keluar < 0 ? 'text-[#ba1a1a]' : ''}`}>
              {rupiah(dipilih.masuk - dipilih.keluar)}
            </dd>
          </div>
        </dl>
      )}

      {/* Data yang sama dalam bentuk tabel untuk pembaca layar. */}
      <table className="sr-only">
        <caption>Pemasukan dan pengeluaran per bulan</caption>
        <thead>
          <tr>
            <th scope="col">Bulan</th>
            <th scope="col">Pemasukan</th>
            <th scope="col">Pengeluaran</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.labelPanjang}>
              <th scope="row">{d.labelPanjang}</th>
              <td>{rupiah(d.masuk)}</td>
              <td>{rupiah(d.keluar)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
