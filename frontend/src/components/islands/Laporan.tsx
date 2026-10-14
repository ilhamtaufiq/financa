import { useEffect, useState } from 'react';
import { akun, api, ambilSesi, type ArusKasRekening, type BarisKategori, type LabaRugi, type RingkasanBulanan } from '../../lib/api';
import { rentangBulan, rupiah } from '../../lib/format';
import { Card } from '../ui/Card';
import { DeltaBadge } from '../ui/DeltaBadge';
import { DiagramBatang, type TitikBatang } from '../ui/DiagramBatang';
import { DiagramDonat } from '../ui/DiagramDonat';
import { IconButton } from '../ui/IconButton';
import { PillTabs } from '../ui/PillTabs';

// Laporan butuh server: dihitung di backend, tidak disimpan di perangkat.
// Urutan: laba bersih, tren enam bulan, komposisi kategori (donat), rincian kategori dengan badge perubahan,
// lalu saldo per rekening. Transfer antar rekening tidak masuk laba rugi.

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const LABEL_JENIS: Record<ArusKasRekening['jenis'], string> = {
  kas: 'Kas',
  bank: 'Bank',
  lainnya: 'Lainnya',
};

// Warna pastel per kategori (latar dan teks), diambil bergilir dari palet DESIGN.md.
const WARNA_KATEGORI = [
  { latar: '#e4f5d8', teks: '#2f7a1f', bar: '#a5dd7f' },
  { latar: '#f6e3fa', teks: '#a63fc0', bar: '#e0a7ee' },
  { latar: '#dbe8fb', teks: '#2f6fdb', bar: '#a9c6f2' },
  { latar: '#f7efc9', teks: '#b5901c', bar: '#e8d36f' },
  { latar: '#fde3e3', teks: '#c2410c', bar: '#f4b6a6' },
] as const;

const JUMLAH_BULAN_TREN = 6;

function bulanIni(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function geserBulan(bulan: string, selisih: number): string {
  const [tahun, bln] = bulan.split('-').map(Number);
  const d = new Date(tahun, bln - 1 + selisih, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function labelBulan(bulan: string): string {
  const [tahun, bln] = bulan.split('-').map(Number);
  return `${NAMA_BULAN[bln - 1]} ${tahun}`;
}

/** Kunci kategori untuk mencocokkan bulan ini dengan bulan lalu. */
function kunci(b: BarisKategori): string {
  return `${b.kategori_id ?? 'x'}-${b.kategori}`;
}

/** Perubahan persen terhadap bulan lalu, atau null jika bulan lalu tidak punya data pembanding. */
function perubahan(sekarang: string, lalu: string | undefined): number | null {
  const l = Number(lalu);
  return lalu !== undefined && l > 0 ? Math.round(((Number(sekarang) - l) / l) * 100) : null;
}

interface PropRincian {
  baris: BarisKategori[];
  bulanLalu: BarisKategori[];
  /** Untuk beban, kenaikan itu buruk, jadi tandanya dibalik pada badge. */
  balikTanda: boolean;
}

/** Daftar rincian: kotak ikon berwarna, nama, jumlah transaksi, nominal, dan badge perubahan bulan ke bulan. */
function DaftarRincian({ baris, bulanLalu, balikTanda }: PropRincian) {
  const lalu = new Map(bulanLalu.map((b) => [kunci(b), b.total]));
  return (
    <section className="space-y-3" aria-labelledby="judul-rincian">
      <h3 id="judul-rincian" className="text-lg font-bold">Rincian kategori</h3>
      {baris.length === 0 && <p className="text-sm text-redup">Belum ada data bulan ini.</p>}
      <ul className="flex flex-col gap-2">
        {baris.map((b, i) => {
          const warna = WARNA_KATEGORI[i % WARNA_KATEGORI.length];
          const ubah = perubahan(b.total, lalu.get(kunci(b)));
          return (
            <li key={kunci(b)} className="flex items-center justify-between gap-3 rounded-3xl bg-permukaan p-3.5 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.03)]">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-12 shrink-0 place-items-center rounded-2xl text-lg font-bold"
                  style={{ backgroundColor: warna.latar, color: warna.teks }}
                >
                  {b.kategori.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold leading-tight">{b.kategori}</p>
                  <p className="text-sm text-redup">{b.jumlah_transaksi} transaksi</p>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <p className="text-lg font-bold tabular-nums">{rupiah(b.total)}</p>
                {ubah !== null && <DeltaBadge nilai={balikTanda ? -ubah : ubah} />}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function Laporan() {
  const [bulan, setBulan] = useState(bulanIni());
  const [ringkasan, setRingkasan] = useState<RingkasanBulanan | null>(null);
  const [labaRugi, setLabaRugi] = useState<LabaRugi | null>(null);
  const [labaRugiLalu, setLabaRugiLalu] = useState<LabaRugi | null>(null);
  const [arusKas, setArusKas] = useState<ArusKasRekening[]>([]);
  const [tren, setTren] = useState<TitikBatang[]>([]);
  const [pesan, setPesan] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [mengunduh, setMengunduh] = useState(false);
  const [sisi, setSisi] = useState<'pendapatan' | 'beban'>('pendapatan');

  async function muat() {
    setPesan(null);
    if (!navigator.onLine) {
      setPesan('Laporan butuh koneksi ke server.');
      return;
    }
    if (!ambilSesi()) {
      setPesan('Sesi Anda belum aktif. Masuk dengan email dan kata sandi untuk melanjutkan.');
      return;
    }
    setMemuat(true);
    try {
      const [tahun, bln] = bulan.split('-').map(Number);
      const { dari, sampai } = rentangBulan(tahun, bln);
      const [tahunLalu, blnLalu] = geserBulan(bulan, -1).split('-').map(Number);
      const lalu = rentangBulan(tahunLalu, blnLalu);

      // Enam bulan berakhir di bulan yang dipilih. Bulan terakhir wajib berhasil, bulan lain boleh gagal (dianggap kosong).
      const daftarBulan = Array.from({ length: JUMLAH_BULAN_TREN }, (_, i) => geserBulan(bulan, i - (JUMLAH_BULAN_TREN - 1)));
      const [semuaRingkasan, lr, ak, lrLalu] = await Promise.all([
        Promise.all(
          daftarBulan.map((b, i) => {
            const [t, m] = b.split('-').map(Number);
            return api.ringkasanBulanan(t, m).catch((err) => {
              if (i === daftarBulan.length - 1) throw err;
              return null;
            });
          }),
        ),
        api.labaRugi(dari, sampai),
        api.arusKas(dari, sampai),
        // Bulan lalu hanya untuk badge perubahan. Kalau gagal, laporan utama tetap tampil.
        api.labaRugi(lalu.dari, lalu.sampai).catch(() => null),
      ]);

      setRingkasan(semuaRingkasan[semuaRingkasan.length - 1]);
      setTren(
        daftarBulan.map((b, i) => {
          const [t, m] = b.split('-').map(Number);
          const r = semuaRingkasan[i];
          return {
            label: NAMA_BULAN[m - 1].slice(0, 3),
            labelPanjang: `${NAMA_BULAN[m - 1]} ${t}`,
            masuk: r ? Number(r.total_pemasukan) : 0,
            keluar: r ? Number(r.total_pengeluaran) : 0,
          };
        }),
      );
      setLabaRugi(lr);
      setArusKas(ak);
      setLabaRugiLalu(lrLalu);
    } catch (err) {
      setRingkasan(null);
      setLabaRugi(null);
      setLabaRugiLalu(null);
      setArusKas([]);
      setTren([]);
      setPesan(err instanceof Error ? err.message : 'Laporan belum bisa dimuat.');
    } finally {
      setMemuat(false);
    }
  }

  useEffect(() => {
    muat();
  }, [bulan]);

  // PDF dibuat di browser. Pustakanya baru dimuat di sini, supaya halaman Laporan tidak ikut membengkak.
  async function unduhPdf() {
    if (!labaRugi || !ringkasan) return;
    setMengunduh(true);
    setPesan(null);
    try {
      const sesi = ambilSesi();
      // Nama tersimpan di sesi sejak memilih organisasi. Sesi lama belum punya, jadi ambil dari server sebagai cadangan.
      let namaOrganisasi = sesi?.organisasiNama || (sesi ? `Organisasi #${sesi.organisasiId}` : 'Organisasi');
      if (sesi && !sesi.organisasiNama) {
        try {
          const daftar = await akun.daftarOrganisasi(sesi.apiUrl, sesi.token);
          namaOrganisasi = daftar.find((o) => o.id === sesi.organisasiId)?.nama ?? namaOrganisasi;
        } catch {
          // Nama organisasi hanya untuk kepala dokumen. Tanpa itu, PDF tetap dibuat.
        }
      }
      const { unduhPdfLaporan } = await import('../../lib/laporan-pdf');
      await unduhPdfLaporan({
        organisasi: namaOrganisasi,
        periode: labelBulan(bulan),
        kunciPeriode: bulan,
        dicetak: new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }),
        labaRugi,
        jumlahTransaksi: ringkasan.jumlah_transaksi,
        tren: tren.map(({ labelPanjang, masuk, keluar }) => ({ labelPanjang, masuk, keluar })),
        arusKas,
      });
    } catch (err) {
      setPesan(err instanceof Error ? `PDF belum bisa dibuat: ${err.message}` : 'PDF belum bisa dibuat.');
    } finally {
      setMengunduh(false);
    }
  }

  const labaNegatif = labaRugi ? Number(labaRugi.laba_bersih) < 0 : false;
  const barisAktif = sisi === 'pendapatan' ? labaRugi?.pendapatan ?? [] : labaRugi?.beban ?? [];
  const totalAktif = sisi === 'pendapatan' ? labaRugi?.total_pendapatan ?? '0' : labaRugi?.total_beban ?? '0';
  const barisLalu = sisi === 'pendapatan' ? labaRugiLalu?.pendapatan ?? [] : labaRugiLalu?.beban ?? [];

  return (
    <section className="space-y-6" aria-labelledby="judul-laporan">
      <div className="space-y-1">
        <h2 id="judul-laporan" className="judul-ungu text-4xl font-bold leading-tight tracking-tight">Analisis laporan</h2>
        <p className="text-sm text-redup">Pendapatan, beban, dan saldo rekening per bulan</p>
      </div>

      <div className="flex items-center justify-between gap-3">
        <IconButton onClick={() => setBulan(geserBulan(bulan, -1))} label="Bulan sebelumnya">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </IconButton>
        <p className="text-lg font-bold tabular-nums">{labelBulan(bulan)}</p>
        <IconButton onClick={() => setBulan(geserBulan(bulan, 1))} disabled={bulan >= bulanIni()} label="Bulan berikutnya">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </IconButton>
      </div>

      <button
        type="button"
        onClick={unduhPdf}
        disabled={!labaRugi || mengunduh}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-inset px-5 py-3.5 font-bold text-teks transition hover:bg-garis disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
        </svg>
        {mengunduh ? 'Membuat PDF…' : 'Unduh laporan PDF'}
      </button>

      {pesan && <p role="status" className="rounded-[20px] bg-inset px-4 py-3 text-sm text-redup">{pesan}</p>}
      {memuat && <p className="text-sm text-redup">Memuat…</p>}

      {labaRugi && ringkasan && (
        <>
          <Card>
            <p className="text-sm text-redup">Laba bersih</p>
            <p className={`mt-1 text-4xl font-extrabold tracking-tight tabular-nums ${labaNegatif ? 'text-[#ee5a24]' : 'text-teks'}`}>
              {rupiah(labaRugi.laba_bersih)}
            </p>
            <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-garis pt-4 sm:grid-cols-3">
              <div>
                <dt className="text-sm text-redup">Pendapatan</dt>
                <dd className="font-bold tabular-nums">{rupiah(labaRugi.total_pendapatan)}</dd>
              </div>
              <div>
                <dt className="text-sm text-redup">Beban</dt>
                <dd className="font-bold tabular-nums">{rupiah(labaRugi.total_beban)}</dd>
              </div>
              <div>
                <dt className="text-sm text-redup">Transaksi</dt>
                <dd className="font-bold tabular-nums">{ringkasan.jumlah_transaksi}</dd>
              </div>
            </dl>
          </Card>

          {/* Prakiraan dipindah dari header halaman ke isi, sebagai tautan yang jelas. */}
          <a
            href="/app/prakiraan"
            className="flex items-center justify-between gap-3 rounded-[28px] bg-inset p-4 transition hover:bg-garis active:scale-[0.99]"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-permukaan text-[#8a20a5] shadow-sm">
                <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
                </svg>
              </span>
              <span className="min-w-0">
                <span className="block font-bold leading-tight">Prakiraan akhir bulan</span>
                <span className="block truncate text-sm text-redup">Perkiraan saldo dari rata-rata tiga bulan terakhir</span>
              </span>
            </span>
            <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-redup" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </a>

          <Card className="space-y-4">
            <h3 className="text-lg font-bold">Tren {JUMLAH_BULAN_TREN} bulan</h3>
            <DiagramBatang data={tren} />
          </Card>

          <PillTabs
            label="Jenis kategori"
            aktif={sisi}
            onPilih={setSisi}
            pilihan={[
              {
                nilai: 'pendapatan',
                label: 'Pendapatan',
                tint: 'bg-[#e4f5d8] text-[#2f7a1f]',
                ikon: (
                  <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                ),
              },
              {
                nilai: 'beban',
                label: 'Beban',
                tint: 'bg-[#fde3e3] text-[#c2410c]',
                ikon: (
                  <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                ),
              },
            ]}
          />

          <Card className="space-y-4">
            <h3 className="text-lg font-bold">Komposisi {sisi === 'pendapatan' ? 'pendapatan' : 'beban'}</h3>
            <DiagramDonat
              irisan={barisAktif.map((b) => ({ label: b.kategori, nilai: Number(b.total) }))}
              warna={WARNA_KATEGORI.map((w) => w.bar)}
              pusatLabel={sisi === 'pendapatan' ? 'Total pendapatan' : 'Total beban'}
              pusatNilai={rupiah(totalAktif)}
            />
          </Card>

          <DaftarRincian baris={barisAktif} bulanLalu={barisLalu} balikTanda={sisi === 'beban'} />
        </>
      )}

      {arusKas.length > 0 && (
        <section className="space-y-3" aria-labelledby="judul-saldo-rekening">
          <h3 id="judul-saldo-rekening" className="text-lg font-bold">Saldo per rekening</h3>
          <Card className="p-4">
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[32rem] text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-garis text-left text-redup">
                    <th scope="col" className="py-2 pr-3 font-semibold">Rekening</th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">Awal</th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">Masuk</th>
                    <th scope="col" className="py-2 pr-3 text-right font-semibold">Keluar</th>
                    <th scope="col" className="py-2 text-right font-semibold">Akhir</th>
                  </tr>
                </thead>
                <tbody>
                  {arusKas.map((a) => (
                    <tr key={a.rekening_id} className="border-b border-garis last:border-0">
                      <td className="py-3 pr-3">
                        <p className="font-semibold">{a.nama}</p>
                        <p className="text-xs text-redup">{LABEL_JENIS[a.jenis]}</p>
                      </td>
                      <td className="py-3 pr-3 text-right text-redup">{rupiah(a.saldo_awal_periode)}</td>
                      <td className="py-3 pr-3 text-right text-[#2f7a1f]">{rupiah(a.masuk)}</td>
                      <td className="py-3 pr-3 text-right">{rupiah(a.keluar)}</td>
                      <td className="py-3 text-right font-bold">{rupiah(a.saldo_akhir)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}
    </section>
  );
}
