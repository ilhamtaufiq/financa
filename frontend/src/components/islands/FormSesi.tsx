import { useEffect, useState } from 'react';
import { akun, ambilSesi, apiUrlDefault, ApiError, simpanSesi, type OrganisasiSaya, type Sesi } from '../../lib/api';
import CampoKataSandi from '../ui/CampoKataSandi';
import { Dropdown } from '../ui/Dropdown';

// Masuk dengan email dan kata sandi, lalu pilih organisasi. Token disimpan
// di perangkat ini sampai keluar atau kedaluwarsa.

type Tahap = 'masuk' | 'pilih';

export default function FormSesi() {
  const [sesi, setSesi] = useState<Sesi | null>(null);
  const apiUrl = apiUrlDefault();
  const [email, setEmail] = useState('');
  const [nama, setNama] = useState('');
  const [kataSandi, setKataSandi] = useState('');
  const [tahap, setTahap] = useState<Tahap>('masuk');
  const [token, setToken] = useState<string | null>(null);
  const [organisasi, setOrganisasi] = useState<OrganisasiSaya[]>([]);
  const [pilihanOrg, setPilihanOrg] = useState('');
  const [namaOrgBaru, setNamaOrgBaru] = useState('');
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    const s = ambilSesi();
    setSesi(s);
    // Sudah masuk: langsung ke aplikasi. replace supaya tombol Kembali tidak menampilkan halaman masuk lagi.
    if (s) window.location.replace('/app/');
  }, []);

  function galat(e: unknown) {
    setPesan(e instanceof ApiError || e instanceof Error ? e.message : 'Terjadi masalah. Coba lagi sebentar lagi.');
  }

  async function masuk(e: React.FormEvent) {
    e.preventDefault();
    setPesan(null);
    if (!email.trim() || !kataSandi) return setPesan('Email dan kata sandi wajib diisi.');
    setSibuk(true);
    try {
      const hasil = await akun.masuk(apiUrl.trim(), email.trim(), kataSandi);
      setToken(hasil.token);
      setNama(hasil.pengguna.nama);
      setKataSandi('');
      await muatOrganisasi(apiUrl.trim(), hasil.token);
      setTahap('pilih');
    } catch (err) {
      galat(err);
    } finally {
      setSibuk(false);
    }
  }

  async function muatOrganisasi(url: string, t: string) {
    const daftar = await akun.daftarOrganisasi(url, t);
    setOrganisasi(daftar);
    if (daftar.length > 0) setPilihanOrg(String(daftar[0].id));
  }

  async function buatOrganisasi(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !namaOrgBaru.trim()) return setPesan('Nama organisasi wajib diisi.');
    setSibuk(true);
    try {
      await akun.buatOrganisasi(apiUrl.trim(), token, namaOrgBaru.trim());
      setNamaOrgBaru('');
      await muatOrganisasi(apiUrl.trim(), token);
    } catch (err) {
      galat(err);
    } finally {
      setSibuk(false);
    }
  }

  function pilihOrganisasi(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !pilihanOrg) return setPesan('Pilih organisasi terlebih dahulu.');
    const peran = organisasi.find((o) => String(o.id) === pilihanOrg)?.peran;
    const dipilih = organisasi.find((o) => String(o.id) === pilihanOrg);
    const baru: Sesi = {
      apiUrl: apiUrl.trim(),
      token,
      organisasiId: Number(pilihanOrg),
      organisasiNama: dipilih?.nama,
      email: email.trim(),
      nama,
      peran,
    };
    simpanSesi(baru);
    // Sesi sudah di localStorage, jadi halaman aplikasi langsung bisa membacanya.
    window.location.assign('/app/');
  }

  async function keluar() {
    setPesan(null);
    setSibuk(true);
    try {
      if (sesi) await akun.keluar(sesi.apiUrl, sesi.token);
    } catch {
      // Token mungkin sudah tidak valid di server. Sesi lokal tetap dihapus.
    } finally {
      simpanSesi(null);
      setSesi(null);
      setSibuk(false);
    }
  }

  if (sesi) {
    return (
      <div className="kartu space-y-4">
        <p>Masuk sebagai <strong>{sesi.email}</strong>.</p>
        <p className="text-sm text-redup">Organisasi aktif: #{sesi.organisasiId}</p>
        <button type="button" className="tombol-garis w-full" onClick={keluar} disabled={sibuk}>
          Keluar
        </button>
        {pesan && <p role="status" className="text-sm text-cendera">{pesan}</p>}
      </div>
    );
  }

  if (tahap === 'pilih' && token) {
    return (
      <div className="kartu space-y-4">
        {organisasi.length > 0 ? (
          <form onSubmit={pilihOrganisasi} className="space-y-4" noValidate>
            <div>
              <label className="label-form" htmlFor="org-pilih">Organisasi</label>
              <Dropdown
                id="org-pilih"
                nilai={pilihanOrg}
                onUbah={setPilihanOrg}
                pilihan={organisasi.map((o) => ({ nilai: String(o.id), label: `${o.nama} (${o.peran})` }))}
              />
            </div>
            <button type="submit" className="tombol-utama w-full" disabled={sibuk}>Pilih organisasi</button>
          </form>
        ) : (
          <p className="text-redup">Anda belum punya organisasi. Buat satu di bawah.</p>
        )}

        <form onSubmit={buatOrganisasi} className="space-y-3" noValidate>
          <div>
            <label className="label-form" htmlFor="org-baru">Nama organisasi baru</label>
            <input id="org-baru" className="masukan" value={namaOrgBaru} onChange={(e) => setNamaOrgBaru(e.target.value)} />
          </div>
          <button type="submit" className="tombol-garis w-full" disabled={sibuk}>Buat organisasi</button>
        </form>

        {pesan && <p role="status" className="text-sm text-bahaya">{pesan}</p>}
      </div>
    );
  }

  const emailKosong = pesan !== null && !email.trim();
  const kataSandiKosong = pesan !== null && !kataSandi;

  return (
    <form onSubmit={masuk} className="kartu space-y-6 p-6 shadow-2xl shadow-black/50 ring-1 ring-white/5 sm:p-8" noValidate>
      <div className="space-y-1">
        <h2 className="text-xl font-extrabold">Masuk ke akun Anda</h2>
        <p className="text-sm text-redup">Gunakan email dan kata sandi yang Anda daftarkan.</p>
      </div>

      <div>
        <label className="label-form" htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          inputMode="email"
          autoFocus
          className="masukan"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={emailKosong || undefined}
          aria-describedby={emailKosong ? 'galat-masuk' : undefined}
        />
      </div>

      <CampoKataSandi
        id="kata-sandi"
        label="Kata sandi"
        value={kataSandi}
        onChange={setKataSandi}
        autoComplete="current-password"
        invalid={kataSandiKosong}
        describedBy={kataSandiKosong ? 'galat-masuk' : undefined}
      />

      {pesan && (
        <p id="galat-masuk" role="status" className="rounded-xl border border-bahaya/60 bg-bahaya/10 px-3 py-2 text-sm text-bahaya">
          {pesan}
        </p>
      )}

      <button type="submit" className="tombol-utama w-full" disabled={sibuk}>
        {sibuk ? 'Memproses…' : 'Masuk'}
      </button>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-garis pt-4 text-sm">
        <a href="/reset" className="font-semibold text-cendera underline underline-offset-4">Lupa kata sandi?</a>
        <span className="text-redup">
          Belum punya akun?{' '}
          <a href="/daftar" className="font-semibold text-cendera underline underline-offset-4">Daftar</a>
        </span>
      </div>
    </form>
  );
}
