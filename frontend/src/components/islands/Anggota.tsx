import { useEffect, useState, type FormEvent } from 'react';
import { ambilSesi, api, ApiError, type UndanganMenunggu } from '../../lib/api';

// Undang pengguna ke organisasi aktif lewat email. Hanya owner dan admin yang bisa mengirim undangan.
// Penerima harus masuk dengan email yang diundang, lalu membuka tautan di email itu.

const LABEL_PERAN: Record<UndanganMenunggu['peran'], string> = {
  admin: 'Admin',
  anggota: 'Anggota',
};

function tanggalSingkat(iso: string): string {
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Anggota() {
  const sesi = ambilSesi();
  const bolehKelola = sesi?.peran === 'owner' || sesi?.peran === 'admin';

  const [daftar, setDaftar] = useState<UndanganMenunggu[] | null>(null);
  const [email, setEmail] = useState('');
  const [peran, setPeran] = useState<'admin' | 'anggota'>('anggota');
  const [sibuk, setSibuk] = useState(false);
  const [pesan, setPesan] = useState<{ jenis: 'ok' | 'galat'; teks: string } | null>(null);

  async function muat() {
    try {
      setDaftar(await api.undanganMenunggu());
    } catch (e) {
      setPesan({ jenis: 'galat', teks: e instanceof ApiError ? e.message : 'Undangan belum bisa dimuat.' });
      setDaftar([]);
    }
  }

  useEffect(() => {
    if (bolehKelola) muat();
  }, [bolehKelola]);

  async function kirim(e: FormEvent) {
    e.preventDefault();
    setPesan(null);
    setSibuk(true);
    try {
      await api.buatUndangan({ email: email.trim(), peran });
      setEmail('');
      setPesan({ jenis: 'ok', teks: `Undangan dikirim ke ${email.trim()}.` });
      await muat();
    } catch (err) {
      setPesan({ jenis: 'galat', teks: err instanceof ApiError ? err.message : 'Undangan belum bisa dikirim.' });
    } finally {
      setSibuk(false);
    }
  }

  if (!bolehKelola) {
    return (
      <section className="kartu">
        <h1 className="text-xl font-bold">Anggota</h1>
        <p className="text-sm text-redup">Hanya owner dan admin yang bisa mengundang anggota.</p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="kartu space-y-4">
        <div>
          <h1 className="text-xl font-bold">Undang anggota</h1>
          <p className="text-sm text-redup">
            Undangan berlaku 7 hari. Penerima masuk dengan email yang diundang, lalu membuka tautan di email itu.
          </p>
        </div>

        <form onSubmit={kirim} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Email</span>
            <input
              type="email"
              className="masukan w-full"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="off"
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="font-semibold">Peran</span>
            <select className="masukan w-full" value={peran} onChange={(e) => setPeran(e.target.value as 'admin' | 'anggota')}>
              <option value="anggota">Anggota</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit" className="tombol-utama min-h-11" disabled={sibuk}>
            {sibuk ? 'Mengirim…' : 'Kirim undangan'}
          </button>
        </form>

        {pesan && (
          <p role={pesan.jenis === 'galat' ? 'alert' : 'status'} className={pesan.jenis === 'galat' ? 'text-sm text-[#c2410c]' : 'text-sm text-redup'}>
            {pesan.teks}
          </p>
        )}
      </section>

      <section className="kartu space-y-3">
        <h2 className="font-bold">Undangan menunggu</h2>
        {daftar === null && <p className="text-sm text-redup">Memuat…</p>}
        {daftar !== null && daftar.length === 0 && (
          <p className="text-sm text-redup">Tidak ada undangan yang menunggu.</p>
        )}
        {daftar !== null && daftar.length > 0 && (
          <ul className="divide-y divide-black/5">
            {daftar.map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-4 py-3">
                <span className="truncate text-sm">{u.email}</span>
                <span className="shrink-0 text-xs text-redup">
                  {LABEL_PERAN[u.peran]} · berlaku sampai {tanggalSingkat(u.expires_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
