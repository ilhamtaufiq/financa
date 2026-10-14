import { useEffect, useState } from 'react';
import {
  akun,
  api,
  ambilSesi,
  ApiError,
  simpanSesi,
  type Kategori,
  type OrganisasiSaya,
  type Rekening,
  type Sesi,
} from '../../lib/api';
import { labelTipe } from '../../lib/sinkron';
import { rupiah } from '../../lib/format';
import { PillTabs } from '../ui/PillTabs';
import { Dropdown } from '../ui/Dropdown';
import { InputRupiah } from '../ui/InputRupiah';
import { PemilihAvatar } from '../ui/PemilihAvatar';

// Pengaturan akun, organisasi, rekening, dan kategori.
// Owner dan admin bisa mengubah rekening dan kategori. Anggota hanya melihat. Server tetap memeriksa peran.

const POLA_SALDO = /^-?\d+(\.\d{1,2})?$/;

type Bagian = 'akun' | 'organisasi' | 'rekening' | 'kategori';

const BAGIAN: { nilai: Bagian; label: string }[] = [
  { nilai: 'akun', label: 'Akun' },
  { nilai: 'organisasi', label: 'Organisasi' },
  { nilai: 'rekening', label: 'Rekening' },
  { nilai: 'kategori', label: 'Kategori' },
];

const LABEL_PERAN: Record<NonNullable<Sesi['peran']>, string> = {
  owner: 'Owner',
  admin: 'Admin',
  anggota: 'Anggota',
};

export default function Pengaturan() {
  const [sesi, setSesi] = useState<Sesi | null>(null);
  const [bagian, setBagian] = useState<Bagian>('akun');
  const [rekening, setRekening] = useState<Rekening[]>([]);
  const [kategori, setKategori] = useState<Kategori[]>([]);
  const [organisasi, setOrganisasi] = useState<OrganisasiSaya[]>([]);
  const [pesan, setPesan] = useState<{ teks: string; galat: boolean } | null>(null);
  const [namaBaru, setNamaBaru] = useState<Record<number, string>>({});
  const [arsipId, setArsipId] = useState<number | null>(null);
  const [sibuk, setSibuk] = useState(false);

  const [rNama, setRNama] = useState('');
  const [rJenis, setRJenis] = useState<Rekening['jenis']>('kas');
  const [rSaldo, setRSaldo] = useState('0');

  const [kTipe, setKTipe] = useState<Kategori['tipe']>('pengeluaran');
  const [kNama, setKNama] = useState('');

  const [orgBaru, setOrgBaru] = useState('');

  // Sesi lama tidak punya peran. Dalam kasus itu tombol tetap tampil, dan server yang menolak.
  const bisaKelola = sesi?.peran !== 'anggota';

  function info(teks: string) {
    setPesan({ teks, galat: false });
  }

  function galat(err: unknown) {
    setPesan({
      teks: err instanceof ApiError || err instanceof Error ? err.message : 'Terjadi masalah. Coba lagi sebentar lagi.',
      galat: true,
    });
  }

  async function muat() {
    try {
      const [r, k] = await Promise.all([api.rekening(), api.kategori()]);
      setRekening(r);
      setKategori(k);
    } catch (err) {
      galat(err);
    }
  }

  async function muatOrganisasi(s: Sesi) {
    try {
      setOrganisasi(await akun.daftarOrganisasi(s.apiUrl, s.token));
    } catch (err) {
      galat(err);
    }
  }

  useEffect(() => {
    const s = ambilSesi();
    setSesi(s);
    if (s) {
      muat();
      muatOrganisasi(s);
    }
  }, []);

  async function keluar() {
    if (!sesi) return;
    setSibuk(true);
    try {
      await akun.keluar(sesi.apiUrl, sesi.token);
    } catch {
      // Token mungkin sudah tidak valid di server. Sesi lokal tetap dihapus.
    } finally {
      simpanSesi(null);
      window.location.assign('/masuk');
    }
  }

  // Pindah organisasi: sesi lokal diperbarui, lalu halaman dimuat ulang supaya semua data ikut berganti.
  function pilihOrganisasi(o: OrganisasiSaya) {
    if (!sesi || o.id === sesi.organisasiId) return;
    simpanSesi({ ...sesi, organisasiId: o.id, organisasiNama: o.nama, peran: o.peran });
    window.location.reload();
  }

  async function buatOrganisasi(e: React.FormEvent) {
    e.preventDefault();
    if (!sesi) return;
    if (!orgBaru.trim()) return setPesan({ teks: 'Nama organisasi wajib diisi.', galat: true });
    setSibuk(true);
    try {
      await akun.buatOrganisasi(sesi.apiUrl, sesi.token, orgBaru.trim());
      setOrgBaru('');
      info('Organisasi dibuat. Pilih untuk berpindah ke sana.');
      await muatOrganisasi(sesi);
    } catch (err) {
      galat(err);
    } finally {
      setSibuk(false);
    }
  }

  async function tambahRekening(e: React.FormEvent) {
    e.preventDefault();
    if (!rNama.trim()) return setPesan({ teks: 'Nama rekening wajib diisi.', galat: true });
    if (!POLA_SALDO.test(rSaldo.trim())) return setPesan({ teks: 'Saldo awal harus angka, maksimal dua desimal.', galat: true });
    try {
      await api.buatRekening({ nama: rNama.trim(), jenis: rJenis, saldo_awal: rSaldo.trim() });
      setRNama('');
      setRSaldo('0');
      info('Rekening ditambahkan.');
      await muat();
    } catch (err) {
      galat(err);
    }
  }

  async function simpanNama(r: Rekening) {
    const nama = (namaBaru[r.id] ?? r.nama).trim();
    if (!nama) return setPesan({ teks: 'Nama rekening tidak boleh kosong.', galat: true });
    try {
      await api.ubahRekening(r.id, nama);
      setNamaBaru((m) => ({ ...m, [r.id]: '' }));
      info('Nama rekening diperbarui.');
      await muat();
    } catch (err) {
      galat(err);
    }
  }

  async function arsipkan(r: Rekening) {
    setArsipId(null);
    try {
      await api.arsipRekening(r.id);
      info(`Rekening "${r.nama}" sudah diarsipkan.`);
      await muat();
    } catch (err) {
      galat(err);
    }
  }

  async function tambahKategori(e: React.FormEvent) {
    e.preventDefault();
    if (!kNama.trim()) return setPesan({ teks: 'Nama kategori wajib diisi.', galat: true });
    try {
      await api.buatKategori({ tipe: kTipe, nama: kNama.trim() });
      setKNama('');
      info('Kategori ditambahkan.');
      await muat();
    } catch (err) {
      galat(err);
    }
  }

  if (!sesi) {
    return (
      <div className="kartu space-y-3">
        <p>Sesi Anda belum aktif. Masuk dengan email dan kata sandi untuk melanjutkan.</p>
        <a href="/masuk" className="tombol-utama w-full">Buka halaman Masuk</a>
      </div>
    );
  }

  const organisasiAktif = organisasi.find((o) => o.id === sesi.organisasiId);

  return (
    <section className="space-y-6" aria-label="Pengaturan">
      <div className="space-y-1">
        <h2 className="judul-ungu text-4xl font-bold leading-tight tracking-tight">Pengaturan</h2>
        <p className="text-sm text-redup">Akun, organisasi, rekening, dan kategori</p>
      </div>

      <PillTabs
        label="Bagian pengaturan"
        pilihan={BAGIAN}
        aktif={bagian}
        onPilih={(b) => {
          setBagian(b);
          setPesan(null);
        }}
      />

      {pesan && (
        <p role="status" className={`rounded-xl border px-3 py-2 text-sm ${pesan.galat ? 'border-bahaya/60 text-bahaya' : 'border-cendera/60 text-cendera'}`}>
          {pesan.teks}
        </p>
      )}

      {bagian === 'akun' && (
        <div className="space-y-6">
          <PemilihAvatar />
          <dl className="divide-y divide-garis overflow-hidden rounded-3xl bg-permukaan shadow-[0_4px_20px_-2px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-sm text-redup">Email</dt>
              <dd className="min-w-0 truncate font-semibold">{sesi.email}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 px-4 py-3">
              <dt className="text-sm text-redup">Peran di organisasi ini</dt>
              <dd className="font-semibold">{sesi.peran ? LABEL_PERAN[sesi.peran] : 'Belum diketahui'}</dd>
            </div>
          </dl>
          <button type="button" className="tombol-garis w-full" onClick={keluar} disabled={sibuk}>
            Keluar dari perangkat ini
          </button>
        </div>
      )}

      {bagian === 'organisasi' && (
        <div className="space-y-4">
          <p className="text-sm text-redup">
            Aktif sekarang: <strong className="text-teks">{organisasiAktif?.nama ?? `Organisasi #${sesi.organisasiId}`}</strong>
          </p>
          <ul className="divide-y divide-garis overflow-hidden rounded-3xl bg-permukaan shadow-[0_4px_20px_-2px_rgba(0,0,0,0.04)]">
            {organisasi.map((o) => {
              const aktif = o.id === sesi.organisasiId;
              return (
                <li key={o.id} className="flex min-h-14 items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{o.nama}</p>
                    <p className="text-sm text-redup">{LABEL_PERAN[o.peran]}</p>
                  </div>
                  {aktif ? (
                    <span className="shrink-0 text-sm font-semibold text-cendera">Aktif</span>
                  ) : (
                    <button type="button" className="tombol-garis min-h-9 px-3 text-sm" onClick={() => pilihOrganisasi(o)}>
                      Pilih
                    </button>
                  )}
                </li>
              );
            })}
            {organisasi.length === 0 && <li className="px-4 py-3 text-redup">Belum ada organisasi.</li>}
          </ul>

          <form onSubmit={buatOrganisasi} className="kartu space-y-3" noValidate>
            <p className="font-bold">Buat organisasi baru</p>
            <div>
              <label className="label-form" htmlFor="org-baru">Nama organisasi</label>
              <input id="org-baru" className="masukan" value={orgBaru} onChange={(e) => setOrgBaru(e.target.value)} />
            </div>
            <button type="submit" className="tombol-utama w-full" disabled={sibuk}>Buat organisasi</button>
          </form>
        </div>
      )}

      {bagian === 'rekening' && (
        <div className="space-y-6">
          {!bisaKelola && <p className="text-sm text-redup">Anda anggota biasa. Hanya owner dan admin yang bisa mengubah rekening.</p>}

          {rekening.length === 0 && (
            <p className="rounded-[20px] border border-dashed border-garis bg-inset p-5 text-center text-redup">
              Belum ada rekening. Tambahkan rekening pertama di bawah.
            </p>
          )}

          <ul className="space-y-3">
            {rekening.map((r) => (
              <li key={r.id} className="space-y-3 rounded-3xl bg-permukaan p-5 shadow-[0_4px_20px_-2px_rgba(0,0,0,0.04)]">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate font-bold">{r.nama}</p>
                  <span className="shrink-0 text-sm capitalize text-redup">{r.jenis}</span>
                </div>
                <p className="text-sm text-redup">
                  Saldo awal <span className="tabular-nums text-teks">{rupiah(r.saldo_awal)}</span>
                </p>

                {bisaKelola && (
                  <>
                    <div className="flex gap-2">
                      <input
                        aria-label={`Nama baru untuk ${r.nama}`}
                        className="masukan"
                        placeholder={r.nama}
                        value={namaBaru[r.id] ?? ''}
                        onChange={(e) => setNamaBaru((m) => ({ ...m, [r.id]: e.target.value }))}
                      />
                      <button type="button" className="tombol-garis shrink-0" onClick={() => simpanNama(r)}>Simpan</button>
                    </div>

                    {arsipId === r.id ? (
                      <div className="space-y-3 rounded-xl border border-bahaya/60 p-3">
                        <p className="text-sm">
                          Arsipkan rekening "{r.nama}"? Rekening yang diarsipkan tidak bisa dipakai untuk transaksi baru.
                          Saldo dan riwayatnya tetap tersimpan.
                        </p>
                        <div className="flex gap-2">
                          <button type="button" className="tombol-utama flex-1" onClick={() => arsipkan(r)}>Arsipkan</button>
                          <button type="button" className="tombol-garis flex-1" onClick={() => setArsipId(null)}>Batal</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="text-sm font-semibold text-bahaya underline underline-offset-4" onClick={() => setArsipId(r.id)}>
                        Arsipkan rekening
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>

          {bisaKelola && (
            <form onSubmit={tambahRekening} className="kartu space-y-4" noValidate>
              <p className="font-bold">Tambah rekening</p>
              <div>
                <label className="label-form" htmlFor="r-nama">Nama</label>
                <input id="r-nama" className="masukan" value={rNama} onChange={(e) => setRNama(e.target.value)} />
              </div>
              <div>
                <label className="label-form" htmlFor="r-jenis">Jenis</label>
                <Dropdown
                  id="r-jenis"
                  nilai={rJenis}
                  onUbah={(v) => setRJenis(v as Rekening['jenis'])}
                  pilihan={[
                    { nilai: 'kas', label: 'Kas' },
                    { nilai: 'bank', label: 'Bank' },
                    { nilai: 'lainnya', label: 'Lainnya' },
                  ]}
                />
              </div>
              <div>
                <label className="label-form" htmlFor="r-saldo">Saldo awal</label>
                <InputRupiah id="r-saldo" nilai={rSaldo} onUbah={setRSaldo} negatif placeholder="0" />
              </div>
              <button type="submit" className="tombol-utama w-full">Tambah rekening</button>
            </form>
          )}
        </div>
      )}

      {bagian === 'kategori' && (
        <div className="space-y-6">
          {!bisaKelola && <p className="text-sm text-redup">Anda anggota biasa. Hanya owner dan admin yang bisa menambah kategori.</p>}

          {(['pemasukan', 'pengeluaran'] as Kategori['tipe'][]).map((tipe) => (
            <div key={tipe} className="space-y-2">
              <h3 className="text-sm font-semibold text-redup">{labelTipe(tipe)}</h3>
              <ul className="divide-y divide-garis overflow-hidden rounded-3xl bg-permukaan shadow-[0_4px_20px_-2px_rgba(0,0,0,0.04)]">
                {kategori.filter((k) => k.tipe === tipe).map((k) => (
                  <li key={k.id} className="flex min-h-12 items-center justify-between gap-3 px-4 py-3">
                    <span className="font-semibold">{k.nama}</span>
                    {k.organisasi_id === null && <span className="text-xs text-redup">Bawaan</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {bisaKelola && (
            <form onSubmit={tambahKategori} className="kartu space-y-4" noValidate>
              <p className="font-bold">Tambah kategori</p>
              <div>
                <label className="label-form" htmlFor="k-tipe">Tipe</label>
                <Dropdown
                  id="k-tipe"
                  nilai={kTipe}
                  onUbah={(v) => setKTipe(v as Kategori['tipe'])}
                  pilihan={[
                    { nilai: 'pemasukan', label: 'Pemasukan' },
                    { nilai: 'pengeluaran', label: 'Pengeluaran' },
                  ]}
                />
              </div>
              <div>
                <label className="label-form" htmlFor="k-nama">Nama</label>
                <input id="k-nama" className="masukan" value={kNama} onChange={(e) => setKNama(e.target.value)} />
              </div>
              <button type="submit" className="tombol-utama w-full">Tambah kategori</button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
