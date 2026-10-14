import { useEffect, useState } from 'react';
import { akun, apiUrlDefault, ApiError } from '../../lib/api';
import CampoKataSandi from '../ui/CampoKataSandi';

// Dua mode dalam satu halaman:
// - Tanpa ?token= : minta tautan reset lewat email.
// - Dengan ?token= : buat kata sandi baru.
// Pesan untuk minta tautan selalu sama, supaya tidak membocorkan email yang terdaftar.

export default function ResetSandi() {
  const [token, setToken] = useState<string | null>(null);
  const apiUrl = apiUrlDefault();
  const [email, setEmail] = useState('');
  const [kataSandi, setKataSandi] = useState('');
  const [ulangi, setUlangi] = useState('');
  const [pesan, setPesan] = useState<string | null>(null);
  const [selesai, setSelesai] = useState(false);
  const [sibuk, setSibuk] = useState(false);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('token');
    setToken(t && t.length > 0 ? t : null);
  }, []);

  async function minta(e: React.FormEvent) {
    e.preventDefault();
    setPesan(null);
    if (!email.trim()) return setPesan('Email wajib diisi.');
    setSibuk(true);
    try {
      await akun.lupaKataSandi(apiUrl.trim(), email.trim());
      setSelesai(true);
      setPesan('Jika email terdaftar, tautan reset sudah dikirim. Periksa kotak masuk Anda.');
    } catch (err) {
      setPesan(err instanceof ApiError ? err.message : 'Terjadi masalah. Coba lagi sebentar lagi.');
    } finally {
      setSibuk(false);
    }
  }

  async function ganti(e: React.FormEvent) {
    e.preventDefault();
    setPesan(null);
    if (kataSandi.length < 8) return setPesan('Kata sandi minimal 8 karakter.');
    if (kataSandi !== ulangi) return setPesan('Ulangi kata sandi tidak sama.');
    if (!token) return;
    setSibuk(true);
    try {
      await akun.resetKataSandi(apiUrl.trim(), token, kataSandi);
      setSelesai(true);
      setPesan('Kata sandi sudah diganti. Silakan masuk dengan kata sandi baru.');
    } catch (err) {
      setPesan(err instanceof ApiError ? err.message : 'Terjadi masalah. Coba lagi sebentar lagi.');
    } finally {
      setSibuk(false);
    }
  }

  if (token) {
    return (
      <form onSubmit={ganti} className="kartu space-y-6 p-6 shadow-2xl shadow-black/50 ring-1 ring-white/5 sm:p-8" noValidate>
        <div className="space-y-1">
          <h2 className="text-xl font-extrabold">Buat kata sandi baru</h2>
          <p className="text-sm text-redup">Minimal 8 karakter. Gunakan kata sandi yang belum pernah Anda pakai.</p>
        </div>
        <CampoKataSandi
          id="kata-baru"
          label="Kata sandi baru"
          value={kataSandi}
          onChange={setKataSandi}
          autoComplete="new-password"
          autoFocus
        />
        <div>
          <label className="label-form" htmlFor="ulangi">Ulangi kata sandi baru</label>
          <input
            id="ulangi"
            type="password"
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            className="masukan"
            value={ulangi}
            onChange={(e) => setUlangi(e.target.value)}
          />
        </div>

        {pesan && (
          <p
            role="status"
            className={
              selesai
                ? 'rounded-xl border border-cendera/60 bg-cendera/10 px-3 py-2 text-sm text-cendera'
                : 'rounded-xl border border-bahaya/60 bg-bahaya/10 px-3 py-2 text-sm text-bahaya'
            }
          >
            {pesan}
          </p>
        )}

        <button type="submit" className="tombol-utama w-full" disabled={sibuk || selesai}>
          {sibuk ? 'Memproses…' : 'Simpan kata sandi baru'}
        </button>
        {selesai && <a href="/masuk" className="tombol-garis w-full">Ke halaman Masuk</a>}
      </form>
    );
  }

  return (
    <form onSubmit={minta} className="kartu space-y-6 p-6 shadow-2xl shadow-black/50 ring-1 ring-white/5 sm:p-8" noValidate>
      <div className="space-y-1">
        <h2 className="text-xl font-extrabold">Lupa kata sandi?</h2>
        <p className="text-sm text-redup">Masukkan email akun Anda. Kami kirim tautan untuk membuat kata sandi baru.</p>
      </div>
      <div>
        <label className="label-form" htmlFor="email-reset">Email akun</label>
        <input
          id="email-reset"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          inputMode="email"
          autoFocus
          className="masukan"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {pesan && (
        <p role="status" className="rounded-xl border border-garis px-3 py-2 text-sm text-redup">
          {pesan}
        </p>
      )}

      <button type="submit" className="tombol-utama w-full" disabled={sibuk || selesai}>
        {sibuk ? 'Memproses…' : 'Kirim tautan reset'}
      </button>
      <p className="border-t border-garis pt-4 text-sm text-redup">
        Ingat kata sandi?{' '}
        <a href="/masuk" className="font-semibold text-cendera underline underline-offset-4">Masuk</a>
      </p>
    </form>
  );
}
