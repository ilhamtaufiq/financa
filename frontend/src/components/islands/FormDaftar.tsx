import { useState } from 'react';
import { akun, apiUrlDefault, ApiError } from '../../lib/api';
import CampoKataSandi from '../ui/CampoKataSandi';

// Pendaftaran akun. Respons selalu sama, baik email baru maupun yang sudah terdaftar,
// jadi halaman ini tidak memberi tahu apakah email sudah dipakai.

export default function FormDaftar() {
  const apiUrl = apiUrlDefault();
  const [nama, setNama] = useState('');
  const [email, setEmail] = useState('');
  const [kataSandi, setKataSandi] = useState('');
  const [ulangi, setUlangi] = useState('');
  const [pesan, setPesan] = useState<string | null>(null);
  const [galat, setGalat] = useState(false);
  const [selesai, setSelesai] = useState(false);
  const [sibuk, setSibuk] = useState(false);

  function tampilGalat(teks: string) {
    setGalat(true);
    setPesan(teks);
  }

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    setPesan(null);
    if (!nama.trim()) return tampilGalat('Nama wajib diisi.');
    if (!email.trim()) return tampilGalat('Email wajib diisi.');
    if (kataSandi.length < 8) return tampilGalat('Kata sandi minimal 8 karakter.');
    if (kataSandi !== ulangi) return tampilGalat('Ulangi kata sandi tidak sama.');

    setSibuk(true);
    try {
      await akun.daftar(apiUrl.trim(), nama.trim(), email.trim(), kataSandi);
      setSelesai(true);
      setGalat(false);
      setPesan('Jika email ini belum terdaftar, akun Anda sudah dibuat. Silakan masuk.');
    } catch (err) {
      tampilGalat(err instanceof ApiError ? err.message : 'Terjadi masalah. Coba lagi sebentar lagi.');
    } finally {
      setSibuk(false);
    }
  }

  return (
    <form onSubmit={kirim} className="kartu space-y-6 p-6 shadow-2xl shadow-black/50 ring-1 ring-white/5 sm:p-8" noValidate>
      <div className="space-y-1">
        <h2 className="text-xl font-extrabold">Buat akun baru</h2>
        <p className="text-sm text-redup">Akun dipakai untuk mencatat keuangan organisasi Anda.</p>
      </div>

      <div>
        <label className="label-form" htmlFor="nama-daftar">Nama</label>
        <input id="nama-daftar" autoComplete="name" autoFocus className="masukan" value={nama} onChange={(e) => setNama(e.target.value)} />
      </div>
      <div>
        <label className="label-form" htmlFor="email-daftar">Email</label>
        <input
          id="email-daftar"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          inputMode="email"
          className="masukan"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <CampoKataSandi
        id="kata-sandi-daftar"
        label="Kata sandi (minimal 8 karakter)"
        value={kataSandi}
        onChange={setKataSandi}
        autoComplete="new-password"
      />
      <div>
        <label className="label-form" htmlFor="ulangi-daftar">Ulangi kata sandi</label>
        <input
          id="ulangi-daftar"
          type="password"
          autoComplete="new-password"
          autoCapitalize="none"
          spellCheck={false}
          className="masukan"
          value={ulangi}
          onChange={(e) => setUlangi(e.target.value)}
          aria-invalid={galat && !!ulangi && kataSandi !== ulangi ? true : undefined}
        />
      </div>

      {pesan && (
        <p
          role="status"
          className={
            galat
              ? 'rounded-xl border border-bahaya/60 bg-bahaya/10 px-3 py-2 text-sm text-bahaya'
              : 'rounded-xl border border-cendera/60 bg-cendera/10 px-3 py-2 text-sm text-cendera'
          }
        >
          {pesan}
        </p>
      )}

      <button type="submit" className="tombol-utama w-full" disabled={sibuk || selesai}>
        {sibuk ? 'Memproses…' : 'Daftar'}
      </button>
      {selesai && <a href="/masuk" className="tombol-garis w-full">Ke halaman Masuk</a>}

      <p className="border-t border-garis pt-4 text-sm text-redup">
        Sudah punya akun?{' '}
        <a href="/masuk" className="font-semibold text-cendera underline underline-offset-4">Masuk</a>
      </p>
    </form>
  );
}
