import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { api, ambilSesi, unduhBukti, type BuktiServer, type Rekening, type Transaksi } from '../../lib/api';
import { db } from '../../lib/db';
import { ambilReferensi, EVENT_SINKRON, gabungkanDaftar, labelTipe, type BarisDaftar } from '../../lib/sinkron';
import { rentangBulan, rupiah } from '../../lib/format';
import { Card } from '../ui/Card';
import { IconButton } from '../ui/IconButton';
import { PillTabs } from '../ui/PillTabs';
import { Uang } from '../ui/Uang';

// Daftar transaksi per bulan. Gabungan data server dan entri yang belum terkirim.
// Pengiriman berjalan otomatis (lihat lib/auto-sync), jadi tidak ada tombol kirim di sini.

type Filter = 'semua' | 'pemasukan' | 'pengeluaran' | 'transfer';

const FILTER: { nilai: Filter; label: string }[] = [
  { nilai: 'semua', label: 'Semua' },
  { nilai: 'pemasukan', label: 'Pemasukan' },
  { nilai: 'pengeluaran', label: 'Pengeluaran' },
  { nilai: 'transfer', label: 'Transfer' },
];

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];
const NAMA_HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

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

function labelTanggal(tanggal: string): string {
  const [tahun, bln, hari] = tanggal.split('-').map(Number);
  const hariMinggu = new Date(tahun, bln - 1, hari).getDay();
  return `${NAMA_HARI[hariMinggu]}, ${hari} ${NAMA_BULAN[bln - 1]}`;
}

function cocokFilter(b: BarisDaftar, filter: Filter): boolean {
  if (filter === 'semua') return true;
  if (filter === 'transfer') return b.tipe.startsWith('transfer');
  return b.tipe === filter;
}

function bacaSebagaiDataUrl(berkas: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const pembaca = new FileReader();
    pembaca.onload = () => resolve(pembaca.result as string);
    pembaca.onerror = () => reject(pembaca.error);
    pembaca.readAsDataURL(berkas);
  });
}

interface BerkasTampil {
  bukti: BuktiServer;
  /** Data URL untuk gambar. CSP app hanya mengizinkan img-src 'self' dan data:. */
  dataUrl?: string;
  /** Object URL untuk berkas selain gambar (PDF), dibuka di tab baru. */
  objectUrl?: string;
}

/** Detail satu transaksi beserta bukti (foto struk, PDF) yang terlampir di server. */
/// Form ubah untuk transaksi yang sudah ada di server. Data lengkap diambil dulu supaya kategori tidak hilang saat disimpan.
function FormUbah({
  transaksiId,
  rekening,
  onBatal,
  onSimpan,
}: {
  transaksiId: number;
  rekening: Rekening[];
  onBatal: () => void;
  onSimpan: () => void;
}) {
  const [asli, setAsli] = useState<Transaksi | null>(null);
  const [rekeningId, setRekeningId] = useState('');
  const [tipe, setTipe] = useState<'pemasukan' | 'pengeluaran'>('pengeluaran');
  const [jumlah, setJumlah] = useState('');
  const [tanggal, setTanggal] = useState('');
  const [catatan, setCatatan] = useState('');
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    let batal = false;
    api
      .ambilTransaksi(transaksiId)
      .then((t) => {
        if (batal) return;
        setAsli(t);
        setRekeningId(String(t.rekening_id));
        setTipe(t.tipe === 'pemasukan' ? 'pemasukan' : 'pengeluaran');
        setJumlah(t.jumlah);
        setTanggal(t.tanggal);
        setCatatan(t.catatan ?? '');
      })
      .catch((e) => {
        if (!batal) setGalat(e instanceof Error ? e.message : 'Transaksi belum bisa dimuat.');
      });
    return () => {
      batal = true;
    };
  }, [transaksiId]);

  async function simpan(e: FormEvent) {
    e.preventDefault();
    if (!asli) return;
    const angka = Number(jumlah.replace(',', '.'));
    if (!Number.isFinite(angka) || angka <= 0) return setGalat('Jumlah harus lebih dari 0.');
    if (!rekeningId) return setGalat('Pilih rekening.');
    setSibuk(true);
    setGalat(null);
    try {
      await api.ubahTransaksi(transaksiId, {
        rekening_id: Number(rekeningId),
        kategori_id: asli.kategori_id,
        tipe,
        jumlah: jumlah.replace(',', '.'),
        tanggal,
        catatan: catatan.trim() || null,
      });
      onSimpan();
    } catch (err) {
      setGalat(err instanceof Error ? err.message : 'Perubahan belum tersimpan.');
      setSibuk(false);
    }
  }

  if (!asli && !galat) return <p className="text-sm text-redup">Memuat…</p>;

  return (
    <form onSubmit={simpan} className="space-y-4">
      <label className="block space-y-1 text-sm">
        <span className="font-semibold">Rekening</span>
        <select className="masukan w-full" value={rekeningId} onChange={(e) => setRekeningId(e.target.value)}>
          {rekening.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nama}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-semibold">Tipe</span>
        <select className="masukan w-full" value={tipe} onChange={(e) => setTipe(e.target.value as 'pemasukan' | 'pengeluaran')}>
          <option value="pemasukan">Pemasukan</option>
          <option value="pengeluaran">Pengeluaran</option>
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-semibold">Jumlah</span>
        <input className="masukan w-full" inputMode="decimal" value={jumlah} onChange={(e) => setJumlah(e.target.value)} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-semibold">Tanggal</span>
        <input type="date" className="masukan w-full" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-semibold">Catatan</span>
        <input className="masukan w-full" value={catatan} maxLength={500} onChange={(e) => setCatatan(e.target.value)} />
      </label>
      {galat && <p role="alert" className="text-sm text-bahaya">{galat}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className="tombol-utama min-h-11" disabled={sibuk || !asli}>
          {sibuk ? 'Menyimpan…' : 'Simpan'}
        </button>
        <button type="button" className="tombol-garis min-h-11" onClick={onBatal} disabled={sibuk}>
          Batal
        </button>
      </div>
    </form>
  );
}

function DetailTransaksi({
  baris,
  namaRekening,
  rekening,
  onTutup,
  onBerubah,
}: {
  baris: BarisDaftar;
  namaRekening: string;
  rekening: Rekening[];
  onTutup: () => void;
  onBerubah: () => void;
}) {
  const idJudul = useId();
  const [berkas, setBerkas] = useState<BerkasTampil[]>([]);
  const [memuatBukti, setMemuatBukti] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const masuk = baris.tipe === 'pemasukan';
  const keluar = baris.tipe === 'pengeluaran';
  // Hanya transaksi biasa yang sudah di server. Transfer dan entri yang belum terkirim tidak bisa diubah dari sini.
  const idServer = baris.server_id;
  const bisaDiubah = idServer !== null && (baris.tipe === 'pemasukan' || baris.tipe === 'pengeluaran');
  const [mode, setMode] = useState<'lihat' | 'ubah'>('lihat');
  const [hapusTanya, setHapusTanya] = useState(false);
  const [sibukAksi, setSibukAksi] = useState(false);
  const [galatAksi, setGalatAksi] = useState<string | null>(null);

  async function hapus() {
    if (idServer === null) return;
    setSibukAksi(true);
    setGalatAksi(null);
    try {
      await api.hapusTransaksi(idServer);
      onBerubah();
    } catch (err) {
      setGalatAksi(err instanceof Error ? err.message : 'Transaksi belum bisa dihapus.');
      setSibukAksi(false);
    }
  }

  useEffect(() => {
    if (baris.server_id === null) return;
    const idTransaksi = baris.server_id;
    let batal = false;
    const dibuat: string[] = [];

    (async () => {
      setMemuatBukti(true);
      try {
        const daftar = await api.daftarBukti(idTransaksi);
        for (const bukti of daftar) {
          if (batal) return;
          const blob = await unduhBukti(bukti.id);
          if (batal) return;
          const tampil: BerkasTampil = { bukti };
          if (bukti.mime.startsWith('image/')) {
            tampil.dataUrl = await bacaSebagaiDataUrl(blob);
          } else {
            tampil.objectUrl = URL.createObjectURL(blob);
            dibuat.push(tampil.objectUrl);
          }
          setBerkas((lama) => [...lama, tampil]);
        }
      } catch (err) {
        if (!batal) setGalat(err instanceof Error ? err.message : 'Bukti belum bisa dimuat.');
      } finally {
        if (!batal) setMemuatBukti(false);
      }
    })();

    return () => {
      batal = true;
      dibuat.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [baris.server_id]);

  useEffect(() => {
    function tekan(e: KeyboardEvent) {
      if (e.key === 'Escape') onTutup();
    }
    document.addEventListener('keydown', tekan);
    return () => document.removeEventListener('keydown', tekan);
  }, [onTutup]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-end justify-items-center p-0 sm:place-items-center sm:p-5">
      <div aria-hidden="true" className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onTutup} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={idJudul}
        className="relative max-h-[90vh] w-full max-w-md space-y-5 overflow-y-auto rounded-t-[32px] bg-permukaan p-6 shadow-[0_24px_60px_-12px_rgba(60,40,120,0.35)] sm:rounded-[32px]"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 id={idJudul} className="text-xl font-bold leading-tight">{labelTipe(baris.tipe)}</h2>
            <p className="text-sm text-redup">{labelTanggal(baris.tanggal)}</p>
          </div>
          <button type="button" onClick={onTutup} className="tombol-garis min-h-11 shrink-0 px-4 text-sm">
            Tutup
          </button>
        </div>

        <p className={`text-3xl font-bold tabular-nums ${masuk ? 'text-[#1f6b3a]' : ''} ${!masuk && !keluar ? 'text-redup' : ''}`}>
          {masuk ? '+' : keluar ? '−' : ''}
          {rupiah(baris.jumlah)}
        </p>

        <dl className="space-y-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-redup">Rekening</dt>
            <dd className="text-right font-semibold">{namaRekening || '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-redup">Catatan</dt>
            <dd className="text-right font-semibold break-words">{baris.catatan || '—'}</dd>
          </div>
        </dl>

        {bisaDiubah && idServer !== null && mode === 'ubah' && (
          <FormUbah transaksiId={idServer} rekening={rekening} onBatal={() => setMode('lihat')} onSimpan={onBerubah} />
        )}

        {bisaDiubah && mode === 'lihat' && (
          <div className="space-y-3">
            {galatAksi && <p role="alert" className="text-sm text-bahaya">{galatAksi}</p>}
            <div className="flex flex-wrap gap-3">
              <button type="button" className="tombol-garis min-h-11" onClick={() => setMode('ubah')}>
                Ubah
              </button>
              {!hapusTanya ? (
                <button type="button" className="tombol-garis min-h-11 text-bahaya" onClick={() => setHapusTanya(true)}>
                  Hapus
                </button>
              ) : (
                <>
                  <button type="button" className="tombol-utama min-h-11" disabled={sibukAksi} onClick={hapus}>
                    {sibukAksi ? 'Menghapus…' : 'Ya, hapus transaksi'}
                  </button>
                  <button type="button" className="tombol-garis min-h-11" onClick={() => setHapusTanya(false)} disabled={sibukAksi}>
                    Batal
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {baris.status !== 'server' && (
          <p className="rounded-[20px] bg-inset px-4 py-3 text-sm text-redup">
            Transaksi ini belum terkirim. Bukti bisa dilihat setelah transaksi tersimpan di server.
          </p>
        )}

        {baris.server_id !== null && (
          <section className="space-y-3" aria-labelledby={`${idJudul}-bukti`}>
            <h3 id={`${idJudul}-bukti`} className="text-sm font-bold text-redup">Bukti</h3>
            {memuatBukti && berkas.length === 0 && <p className="text-sm text-redup">Memuat bukti…</p>}
            {!memuatBukti && berkas.length === 0 && !galat && <p className="text-sm text-redup">Tidak ada bukti terlampir.</p>}
            {galat && <p role="status" className="text-sm text-bahaya">{galat}</p>}
            {berkas.map(({ bukti, dataUrl, objectUrl }) =>
              dataUrl ? (
                <img
                  key={bukti.id}
                  src={dataUrl}
                  alt={`Bukti: ${bukti.nama_asli}`}
                  className="max-h-96 w-full rounded-[20px] bg-inset object-contain"
                />
              ) : (
                <a
                  key={bukti.id}
                  href={objectUrl}
                  target="_blank"
                  rel="noopener"
                  className="tautan-ungu flex min-h-11 items-center rounded-[20px] bg-inset px-4 text-sm"
                >
                  {bukti.nama_asli}
                </a>
              ),
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export default function DaftarTransaksi() {
  const [bulan, setBulan] = useState(bulanIni());
  const [baris, setBaris] = useState<BarisDaftar[]>([]);
  const [rekening, setRekening] = useState<Rekening[]>([]);
  const [filter, setFilter] = useState<Filter>('semua');
  const [pesan, setPesan] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [dipilih, setDipilih] = useState<BarisDaftar | null>(null);

  async function muat() {
    setMemuat(true);
    setPesan(null);
    try {
      const [ref, lokal] = await Promise.all([ambilReferensi(), db().entri.toArray()]);
      setRekening(ref.rekening);

      const [tahun, bln] = bulan.split('-').map(Number);
      const { dari, sampai } = rentangBulan(tahun, bln);

      let server: Transaksi[] = [];
      if (navigator.onLine && ambilSesi()) {
        try {
          server = await api.daftarTransaksi(dari, sampai);
        } catch (err) {
          setPesan(err instanceof Error ? `Data server belum bisa dimuat: ${err.message}` : 'Data server belum bisa dimuat.');
        }
      } else {
        setPesan('Offline. Hanya transaksi yang dicatat di perangkat ini yang tampil.');
      }

      const lokalBulan = lokal.filter((e) => e.tanggal.slice(0, 7) === bulan);
      setBaris(gabungkanDaftar(server, lokalBulan));
    } finally {
      setMemuat(false);
    }
  }

  useEffect(() => {
    muat();
  }, [bulan]);

  // Sinkron berjalan otomatis di latar belakang. Daftar dimuat ulang saat ada yang terkirim.
  useEffect(() => {
    window.addEventListener(EVENT_SINKRON, muat);
    return () => window.removeEventListener(EVENT_SINKRON, muat);
  }, [bulan]);

  // Ringkasan hanya dari pemasukan dan pengeluaran, sama dengan laporan (transfer tidak dihitung).
  const ringkasan = useMemo(() => {
    let masuk = 0;
    let keluar = 0;
    for (const b of baris) {
      if (b.tipe === 'pemasukan') masuk += Number(b.jumlah);
      if (b.tipe === 'pengeluaran') keluar += Number(b.jumlah);
    }
    return { masuk, keluar, selisih: masuk - keluar };
  }, [baris]);

  const tampil = useMemo(() => baris.filter((b) => cocokFilter(b, filter)), [baris, filter]);

  // Kelompokkan per tanggal. Data sudah urut dari yang terbaru.
  const perTanggal = useMemo(() => {
    const grup: { tanggal: string; isi: BarisDaftar[] }[] = [];
    for (const b of tampil) {
      const akhir = grup[grup.length - 1];
      if (akhir && akhir.tanggal === b.tanggal) akhir.isi.push(b);
      else grup.push({ tanggal: b.tanggal, isi: [b] });
    }
    return grup;
  }, [tampil]);

  function namaRekening(id: number | null): string {
    if (id === null) return '';
    return rekening.find((r) => r.id === id)?.nama ?? `Rekening #${id}`;
  }

  return (
    <section className="space-y-6" aria-labelledby="judul-daftar">
      <div className="flex items-center justify-between gap-3">
        <IconButton onClick={() => setBulan(geserBulan(bulan, -1))} label="Bulan sebelumnya">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </IconButton>
        <h2 id="judul-daftar" className="judul-ungu text-2xl font-bold tabular-nums">{labelBulan(bulan)}</h2>
        <IconButton onClick={() => setBulan(geserBulan(bulan, 1))} disabled={bulan >= bulanIni()} label="Bulan berikutnya">
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </IconButton>
      </div>

      {/* Kartu hero: selisih bulan ini sebagai angka utama, pemasukan dan pengeluaran sebagai chip pastel. */}
      <Card className="space-y-4 rounded-[32px] p-5">
        <p className="text-sm text-redup">Selisih bulan ini</p>
        <p className={`text-4xl leading-tight ${ringkasan.selisih < 0 ? 'text-[#ba1a1a]' : ''}`}>
          <Uang nilai={ringkasan.selisih} />
        </p>
        <dl className="grid grid-cols-2 gap-3">
          <div className="min-w-0 rounded-3xl bg-[#dff7e6] p-4">
            <dt className="text-xs font-semibold text-[#1f6b3a]">Masuk</dt>
            <dd className="mt-1 truncate font-bold tabular-nums text-[#1f6b3a]">{rupiah(ringkasan.masuk)}</dd>
          </div>
          <div className="min-w-0 rounded-3xl bg-[#ffe6ee] p-4">
            <dt className="text-xs font-semibold text-[#9a2c50]">Keluar</dt>
            <dd className="mt-1 truncate font-bold tabular-nums text-[#9a2c50]">{rupiah(ringkasan.keluar)}</dd>
          </div>
        </dl>
      </Card>

      <PillTabs label="Filter jenis transaksi" pilihan={FILTER} aktif={filter} onPilih={setFilter} />

      {pesan && <p role="status" className="rounded-[20px] bg-inset px-4 py-3 text-sm text-redup">{pesan}</p>}
      {memuat && <p className="text-sm text-redup">Memuat…</p>}

      {!memuat && tampil.length === 0 && (
        <div className="rounded-[20px] border border-dashed border-garis bg-inset p-5 text-center text-redup">
          {baris.length === 0 ? 'Belum ada transaksi di bulan ini.' : 'Tidak ada transaksi untuk filter ini.'}{' '}
          <a href="/app/transaksi/baru" className="tautan-ungu">Catat transaksi</a>.
        </div>
      )}

      <div className="space-y-6">
        {perTanggal.map((grup) => (
          <div key={grup.tanggal} className="space-y-2">
            <h3 className="text-sm font-bold text-redup">{labelTanggal(grup.tanggal)}</h3>
            <ul className="flex flex-col gap-2">
              {grup.isi.map((b) => {
                const masuk = b.tipe === 'pemasukan';
                const keluar = b.tipe === 'pengeluaran';
                return (
                  <li key={b.kunci}>
                  <button
                    type="button"
                    onClick={() => setDipilih(b)}
                    aria-haspopup="dialog"
                    className="flex min-h-16 w-full items-center gap-3 rounded-3xl bg-permukaan p-3.5 text-left shadow-[0_4px_20px_-2px_rgba(0,0,0,0.04)]"
                  >
                    <span
                      aria-hidden="true"
                      className={`grid size-12 shrink-0 place-items-center rounded-2xl ${
                        masuk ? 'bg-[#e4f5d8] text-[#2f7a1f]' : keluar ? 'bg-[#fde3e3] text-[#c2410c]' : 'bg-[#dbe8fb] text-[#2f6fdb]'
                      }`}
                    >
                      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        {masuk ? <path d="M12 19V5M5 12l7-7 7 7" /> : keluar ? <path d="M12 5v14M5 12l7 7 7-7" /> : <path d="M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4" />}
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate font-bold">{labelTipe(b.tipe)}</p>
                      <p className="truncate text-sm text-redup">
                        {[namaRekening(b.rekening_id), b.catatan].filter(Boolean).join(' · ') || '—'}
                      </p>
                      {b.status !== 'server' && (
                        <p className={`text-xs font-bold ${b.status === 'gagal' ? 'text-bahaya' : 'text-[#8a20a5]'}`}>
                          {b.status === 'gagal' ? 'Gagal dikirim' : 'Menunggu dikirim'}
                        </p>
                      )}
                      {b.galat && <p className="text-xs text-bahaya">{b.galat}</p>}
                    </div>
                    <p className={`shrink-0 text-lg font-bold tabular-nums ${masuk ? 'text-[#1f6b3a]' : ''} ${!masuk && !keluar ? 'text-redup' : ''}`}>
                      {masuk ? '+' : keluar ? '−' : ''}
                      {rupiah(b.jumlah)}
                    </p>
                  </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {dipilih && (
        <DetailTransaksi
          baris={dipilih}
          namaRekening={namaRekening(dipilih.rekening_id)}
          rekening={rekening}
          onTutup={() => setDipilih(null)}
          onBerubah={() => {
            setDipilih(null);
            void muat();
          }}
        />
      )}
    </section>
  );
}
