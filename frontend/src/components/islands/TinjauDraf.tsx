import { useEffect, useState } from 'react';
import { api, ApiError, type Draf, type Kategori, type Rekening } from '../../lib/api';
import { rupiah } from '../../lib/format';

// Daftar draf transaksi yang ditangkap dari email. Pengguna memilih rekening (dan kategori),
// lalu menyetujui atau membuang. Tidak ada yang tercatat sebelum disetujui.

const TIPE_LABEL: Record<NonNullable<Draf['tipe']>, string> = {
  pemasukan: 'Pemasukan',
  pengeluaran: 'Pengeluaran',
};

export default function TinjauDraf() {
  const [draf, setDraf] = useState<Draf[] | null>(null);
  const [rekening, setRekening] = useState<Rekening[]>([]);
  const [kategori, setKategori] = useState<Kategori[]>([]);
  const [pilihanRek, setPilihanRek] = useState<Record<number, string>>({});
  const [pilihanKat, setPilihanKat] = useState<Record<number, string>>({});
  const [sibuk, setSibuk] = useState<number | null>(null);
  const [pesan, setPesan] = useState<string | null>(null);
  const [sinkron, setSinkron] = useState(false);

  // Setelah callback Google, server mengarahkan kembali ke sini dengan ?gmail=terhubung atau ?gmail=gagal.
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get('gmail');
    if (status === 'terhubung') setPesan('Gmail terhubung. Tekan Sinkron untuk mengambil email.');
    if (status === 'gagal') setPesan('Gmail belum terhubung. Coba lagi.');
  }, []);

  async function hubungkan() {
    setPesan(null);
    try {
      const { url } = await api.gmailMulai();
      window.location.assign(url);
    } catch (e) {
      galat(e);
    }
  }

  async function jalankanSinkron() {
    setPesan(null);
    setSinkron(true);
    try {
      const hasil = await api.gmailSinkron();
      setPesan(`Diperiksa ${hasil.diperiksa} email, ${hasil.draf_baru} draf baru.`);
      setDraf(await api.draf());
    } catch (e) {
      galat(e);
    } finally {
      setSinkron(false);
    }
  }

  async function muat() {
    try {
      const [d, r, k] = await Promise.all([api.draf(), api.rekening(), api.kategori()]);
      setDraf(d);
      setRekening(r.filter((x) => !x.diarsipkan_at));
      setKategori(k);
    } catch (e) {
      setPesan(e instanceof ApiError || e instanceof Error ? e.message : 'Draf belum bisa dimuat.');
      setDraf([]);
    }
  }

  useEffect(() => {
    muat();
  }, []);

  function galat(e: unknown) {
    setPesan(e instanceof ApiError || e instanceof Error ? e.message : 'Terjadi masalah. Coba lagi sebentar lagi.');
  }

  async function setujui(d: Draf) {
    const rekId = Number(pilihanRek[d.id]);
    if (!rekId) return setPesan('Pilih rekening dulu.');
    setPesan(null);
    setSibuk(d.id);
    try {
      const katId = pilihanKat[d.id] ? Number(pilihanKat[d.id]) : null;
      await api.setujuiDraf(d.id, rekId, katId);
      setDraf((list) => (list ?? []).filter((x) => x.id !== d.id));
    } catch (e) {
      galat(e);
    } finally {
      setSibuk(null);
    }
  }

  async function buang(d: Draf) {
    setPesan(null);
    setSibuk(d.id);
    try {
      await api.buangDraf(d.id);
      setDraf((list) => (list ?? []).filter((x) => x.id !== d.id));
    } catch (e) {
      galat(e);
    } finally {
      setSibuk(null);
    }
  }

  if (draf === null) return <p className="text-sm text-redup">Memuat…</p>;

  return (
    <div className="space-y-6">
      <p className="text-sm text-redup">
        Transaksi dari email notifikasi. Periksa dulu, lalu setujui atau buang. Yang disetujui baru tercatat.
      </p>

      <div className="flex flex-wrap gap-3">
        <button type="button" className="tombol-garis min-h-11" onClick={hubungkan}>
          Hubungkan Gmail
        </button>
        <button type="button" className="tombol-utama min-h-11" disabled={sinkron} onClick={jalankanSinkron}>
          {sinkron ? 'Mengambil email…' : 'Sinkron sekarang'}
        </button>
      </div>

      {pesan && (
        <p role="alert" className="rounded-2xl bg-[#fde3e3] px-4 py-3 text-sm text-[#c2410c]">
          {pesan}
        </p>
      )}

      {draf.length === 0 ? (
        <p className="rounded-3xl bg-inset p-6 text-sm text-redup">Tidak ada draf yang menunggu ditinjau.</p>
      ) : (
        <ul className="space-y-3">
          {draf.map((d) => {
            const lengkap = d.jumlah !== null && d.tipe !== null && d.tanggal !== null;
            const katTipe = d.tipe ?? 'pengeluaran';
            return (
              <li key={d.id} className="space-y-4 rounded-3xl bg-permukaan p-5 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.04)]">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate font-bold">{d.keterangan || 'Tanpa judul'}</p>
                    {d.pengirim && <p className="truncate text-xs text-redup">{d.pengirim}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-bold tabular-nums">{d.jumlah ? rupiah(d.jumlah) : 'Jumlah tidak terbaca'}</p>
                    <p className="text-xs text-redup">
                      {d.tipe ? TIPE_LABEL[d.tipe] : 'Arah tidak jelas'}
                      {d.tanggal ? ` · ${d.tanggal}` : ''}
                    </p>
                  </div>
                </div>

                {!lengkap && (
                  <p className="text-xs text-[#b5901c]">
                    Data belum lengkap. Draf ini hanya bisa dibuang, karena belum ada cara untuk melengkapinya dari sini.
                  </p>
                )}

                {lengkap && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-sm">
                      <span className="font-semibold">Rekening</span>
                      <select
                        className="masukan w-full"
                        value={pilihanRek[d.id] ?? ''}
                        onChange={(e) => setPilihanRek((p) => ({ ...p, [d.id]: e.target.value }))}
                      >
                        <option value="">Pilih rekening</option>
                        {rekening.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.nama}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="font-semibold">Kategori (opsional)</span>
                      <select
                        className="masukan w-full"
                        value={pilihanKat[d.id] ?? ''}
                        onChange={(e) => setPilihanKat((p) => ({ ...p, [d.id]: e.target.value }))}
                      >
                        <option value="">Tanpa kategori</option>
                        {kategori
                          .filter((k) => k.tipe === katTipe)
                          .map((k) => (
                            <option key={k.id} value={k.id}>
                              {k.nama}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  {lengkap && (
                    <button
                      type="button"
                      className="tombol-utama min-h-11"
                      disabled={sibuk === d.id}
                      onClick={() => setujui(d)}
                    >
                      Setujui
                    </button>
                  )}
                  <button
                    type="button"
                    className="tombol-garis min-h-11"
                    disabled={sibuk === d.id}
                    onClick={() => buang(d)}
                  >
                    Buang
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
