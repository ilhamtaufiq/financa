import { useEffect, useState } from 'react';
import { ambilSesi, api, type RingkasanBulanan } from '../../lib/api';
import { ambilReferensi } from '../../lib/sinkron';
import { hitungPrakiraan, type AngkaBulan, type Prakiraan } from '../../lib/prakiraan';
import { rupiah } from '../../lib/format';
import { InsetCard } from '../ui/Card';
import { DeltaBadge } from '../ui/DeltaBadge';
import { PillTabs } from '../ui/PillTabs';
import { Pill } from '../ui/Pill';
import { Uang } from '../ui/Uang';

// Prakiraan akhir bulan berbasis logika. Bukan model AI: rata-rata tiga bulan sebelumnya dikalikan sisa hari.
// Semua angka berasal dari catatan server. Tidak ada data yang dikarang.

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

type Mode = 'pertumbuhan' | 'pemasukan' | 'pengeluaran';

const IKON_PROPS = {
  viewBox: '0 0 24 24',
  className: 'size-[18px]',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

// Tab dengan ikon dan warna pastel untuk keadaan tidak aktif, seperti tab Growth, Income, Outcome pada contoh.
const MODE = [
  {
    nilai: 'pertumbuhan' as Mode,
    label: 'Pertumbuhan',
    tint: 'bg-[#f6e3fa] text-[#8a20a5]',
    ikon: (
      <svg {...IKON_PROPS}>
        <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
      </svg>
    ),
  },
  {
    nilai: 'pemasukan' as Mode,
    label: 'Pemasukan',
    tint: 'bg-[#dbe8fb] text-[#2f6fdb]',
    ikon: (
      <svg {...IKON_PROPS}>
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    ),
  },
  {
    nilai: 'pengeluaran' as Mode,
    label: 'Pengeluaran',
    tint: 'bg-[#e4f5d8] text-[#2f7a1f]',
    ikon: (
      <svg {...IKON_PROPS}>
        <path d="M12 5v14M5 12l7 7 7-7" />
      </svg>
    ),
  },
];

interface Data {
  prakiraan: Prakiraan;
  saldoSekarang: number;
  batang: { label: string; nilai: number; proyeksi: boolean }[];
}

function angka(r: RingkasanBulanan): AngkaBulan {
  return { masuk: Number(r.total_pemasukan), keluar: Number(r.total_pengeluaran) };
}

/** Perubahan persen dari pembanding ke nilai. Nol jika pembanding nol, supaya tidak dibagi nol. */
function persen(nilai: number, pembanding: number): number {
  return pembanding > 0 ? Math.round(((nilai - pembanding) / pembanding) * 100) : 0;
}

export default function Prakiraan() {
  const [mode, setMode] = useState<Mode>('pertumbuhan');
  const [data, setData] = useState<Data | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);

  async function muat() {
    setPesan(null);
    if (!navigator.onLine) return setPesan('Prakiraan butuh koneksi ke server.');
    if (!ambilSesi()) return setPesan('Sesi Anda belum aktif. Masuk dengan email dan kata sandi untuk melanjutkan.');

    setMemuat(true);
    try {
      const sekarang = new Date();
      const tahun = sekarang.getFullYear();
      const bulan = sekarang.getMonth() + 1;
      // Tiga bulan sebelumnya, urut dari yang terlama.
      const bulanLalu = [3, 2, 1].map((selisih) => {
        const d = new Date(tahun, bulan - 1 - selisih, 1);
        return { tahun: d.getFullYear(), bulan: d.getMonth() + 1 };
      });

      const [ini, ...riwayatServer] = await Promise.all([
        api.ringkasanBulanan(tahun, bulan),
        ...bulanLalu.map((b) => api.ringkasanBulanan(b.tahun, b.bulan)),
      ]);

      const { rekening } = await ambilReferensi();
      const aktif = rekening.filter((r) => !r.diarsipkan_at);
      const saldo = await Promise.all(aktif.map((r) => api.detailRekening(r.id).then((d) => Number(d.saldo)).catch(() => 0)));
      const saldoSekarang = saldo.reduce((s, v) => s + v, 0);

      const hariBulan = new Date(tahun, bulan, 0).getDate();
      const prakiraan = hitungPrakiraan(riwayatServer.map(angka), angka(ini), saldoSekarang, sekarang.getDate(), hariBulan);

      const batang = [
        ...riwayatServer.map((r, i) => ({
          label: NAMA_BULAN[bulanLalu[i].bulan - 1],
          nilai: angka(r).masuk - angka(r).keluar,
          proyeksi: false,
        })),
        { label: NAMA_BULAN[bulan - 1], nilai: prakiraan.aktualMasuk - prakiraan.aktualKeluar, proyeksi: false },
        { label: 'Akhir', nilai: prakiraan.proyeksiMasuk - prakiraan.proyeksiKeluar, proyeksi: true },
      ];

      setData({ prakiraan, saldoSekarang, batang });
    } catch (err) {
      setData(null);
      setPesan(err instanceof Error ? err.message : 'Prakiraan belum bisa dihitung.');
    } finally {
      setMemuat(false);
    }
  }

  useEffect(() => {
    muat();
  }, []);

  if (pesan) {
    return <p role="status" className="rounded-[20px] bg-inset px-4 py-3 text-sm text-redup">{pesan}</p>;
  }
  if (memuat || !data) {
    return <p className="text-sm text-redup">Menghitung…</p>;
  }

  const p = data.prakiraan;
  const cukupData = p.sampelBulan > 0;

  // Nilai utama dan perubahan persen untuk tiap mode. Pengeluaran dibalik: naik = buruk = negatif.
  const utama =
    mode === 'pertumbuhan'
      ? {
          nilai: p.proyeksiSaldoAkhir,
          teks: 'Perkiraan saldo akhir bulan',
          delta: persen(p.proyeksiSaldoAkhir, data.saldoSekarang),
          pembanding: 'dibanding saldo sekarang',
        }
      : mode === 'pemasukan'
        ? {
            nilai: p.proyeksiMasuk,
            teks: 'Perkiraan pemasukan bulan ini',
            delta: persen(p.proyeksiMasuk, p.rataMasuk),
            pembanding: `dibanding rata-rata ${p.sampelBulan} bulan`,
          }
        : {
            nilai: p.proyeksiKeluar,
            teks: 'Perkiraan pengeluaran bulan ini',
            delta: persen(p.rataKeluar, p.proyeksiKeluar),
            pembanding: `dibanding rata-rata ${p.sampelBulan} bulan`,
          };

  const maks = Math.max(1, ...data.batang.map((b) => Math.abs(b.nilai)));

  return (
    <section className="space-y-6" aria-label="Prakiraan">
      <PillTabs label="Jenis prakiraan" pilihan={MODE} aktif={mode} onPilih={setMode} />

      {/* Dua kartu proyeksi berdampingan: kartu abu untuk rata-rata, kartu mint besar untuk angka utama. */}
      <section className="space-y-3" aria-labelledby="judul-proyeksi">
        <h3 id="judul-proyeksi" className="text-[22px] font-bold">Proyeksi</h3>
        <div className="grid grid-cols-5 gap-3">
          <div className="col-span-2 flex flex-col justify-between gap-6 rounded-[32px] bg-inset p-5">
            <span aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-permukaan text-[#2f6fdb] shadow-sm">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
              </svg>
            </span>
            <div>
              <p className="text-sm text-redup">Rata-rata keluar</p>
              <p className="text-lg font-bold tabular-nums">{rupiah(p.rataKeluar)}</p>
              <p className="text-xs text-redup">per bulan</p>
            </div>
          </div>

          <div className="col-span-3 flex flex-col justify-between gap-6 rounded-[32px] bg-[#8df78f] p-5 text-[#002106]">
            <div className="flex items-start justify-between gap-2">
              <span aria-hidden="true" className="grid size-11 place-items-center rounded-full bg-white/80 text-[#2f7a1f]">
                <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" />
                </svg>
              </span>
              {cukupData && (
                <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-[#005319]">
                  {utama.delta >= 0 ? 'Aman' : 'Perhatian'}
                </span>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold">{utama.teks}</p>
              <p className="mt-1 text-3xl leading-tight tabular-nums" aria-live="polite">
                <Uang nilai={utama.nilai} />
              </p>
              {cukupData && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <DeltaBadge nilai={utama.delta} />
                  <span>{utama.pembanding}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <InsetCard className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold">Selisih per bulan</h3>
          <Pill>Bergaris = perkiraan</Pill>
        </div>
        <div className="flex h-40 items-end gap-3" role="img" aria-label="Grafik selisih per bulan dan perkiraan akhir bulan">
          {data.batang.map((b) => {
            const tinggi = Math.max(4, (Math.abs(b.nilai) / maks) * 100);
            return (
              <div key={b.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                <div
                  className={`w-full rounded-xl ${b.nilai < 0 ? 'bg-[#ee5a24]' : b.proyeksi ? '' : 'bg-[#8fd45f]'}`}
                  style={{
                    height: `${tinggi}%`,
                    ...(b.proyeksi
                      ? {
                          backgroundImage: 'repeating-linear-gradient(135deg, rgba(166,63,192,0.5) 0 4px, transparent 4px 8px)',
                          backgroundColor: 'rgba(166,63,192,0.1)',
                        }
                      : {}),
                  }}
                />
                <span className="text-xs text-redup">{b.label}</span>
              </div>
            );
          })}
        </div>
        <p className="text-sm text-redup">
          {cukupData
            ? `Batang solid adalah catatan yang sudah terjadi. Batang bergaris adalah perkiraan sampai akhir bulan, dari rata-rata ${p.sampelBulan} bulan terakhir.`
            : 'Belum ada catatan bulan sebelumnya. Perkiraan akan tampil setelah ada catatan minimal satu bulan.'}
        </p>
      </InsetCard>

      <InsetCard className="space-y-3">
        <h3 className="font-bold">Dasar perhitungan</h3>
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="text-redup">Rata-rata masuk per bulan</dt><dd className="font-bold tabular-nums">{rupiah(p.rataMasuk)}</dd></div>
          <div><dt className="text-redup">Rata-rata keluar per bulan</dt><dd className="font-bold tabular-nums">{rupiah(p.rataKeluar)}</dd></div>
          <div><dt className="text-redup">Saldo sekarang</dt><dd className="font-bold tabular-nums">{rupiah(data.saldoSekarang)}</dd></div>
          <div><dt className="text-redup">Aktual bulan ini</dt><dd className="font-bold tabular-nums">{rupiah(p.aktualMasuk - p.aktualKeluar)}</dd></div>
        </dl>
        <p className="text-xs text-redup">Ini perkiraan dari pola catatan, bukan ramalan. Transfer antar rekening tidak dihitung.</p>
      </InsetCard>
    </section>
  );
}
