import { useEffect, useState, type FormEvent } from 'react';
import {
  ambilToken,
  ApiError,
  keluar,
  masuk,
  pendaftaran,
  ringkasan,
  transaksi,
  type Harian,
  type Ringkasan,
} from './api';

// Dasbor admin: login ke backend, lalu menampilkan agregat dari service analitik.
// Akses dibatasi di sisi analitik (email harus ada di ADMIN_EMAILS). Halaman ini hanya tampilan.

const RENTANG_HARI = 30;

function tanggal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const h = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${h}`;
}

function rentangTerakhir(hari: number): { dari: string; sampai: string } {
  const sampai = new Date();
  const dari = new Date();
  dari.setDate(sampai.getDate() - (hari - 1));
  return { dari: tanggal(dari), sampai: tanggal(sampai) };
}

export default function App() {
  const [masukSudah, setMasukSudah] = useState(() => ambilToken() !== null);

  if (!masukSudah) {
    return <FormMasuk onBerhasil={() => setMasukSudah(true)} />;
  }
  return (
    <Dasbor
      onKeluar={() => {
        keluar();
        setMasukSudah(false);
      }}
    />
  );
}

function FormMasuk({ onBerhasil }: { onBerhasil: () => void }) {
  const [email, setEmail] = useState('');
  const [kataSandi, setKataSandi] = useState('');
  const [pesan, setPesan] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  async function kirim(e: FormEvent) {
    e.preventDefault();
    setPesan(null);
    setSibuk(true);
    try {
      await masuk(email, kataSandi);
      onBerhasil();
    } catch (err) {
      setPesan(err instanceof ApiError ? err.message : 'Terjadi masalah. Coba lagi.');
    } finally {
      setSibuk(false);
    }
  }

  return (
    <main className="masuk">
      <form onSubmit={kirim} className="kartu">
        <h1>Dasbor Admin</h1>
        <p className="redup">Masuk dengan akun admin platform.</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        </label>
        <label>
          Kata sandi
          <input
            type="password"
            value={kataSandi}
            onChange={(e) => setKataSandi(e.target.value)}
            required
            autoComplete="current-password"
          />
        </label>
        {pesan && <p role="alert" className="galat">{pesan}</p>}
        <button type="submit" disabled={sibuk}>
          {sibuk ? 'Memproses…' : 'Masuk'}
        </button>
      </form>
    </main>
  );
}

function Dasbor({ onKeluar }: { onKeluar: () => void }) {
  const [ringkas, setRingkas] = useState<Ringkasan | null>(null);
  const [daftar, setDaftar] = useState<Harian[]>([]);
  const [trx, setTrx] = useState<Harian[]>([]);
  const [galat, setGalat] = useState<string | null>(null);

  useEffect(() => {
    const { dari, sampai } = rentangTerakhir(RENTANG_HARI);
    Promise.all([ringkasan(), pendaftaran(dari, sampai), transaksi(dari, sampai)])
      .then(([r, p, t]) => {
        setRingkas(r);
        setDaftar(p);
        setTrx(t);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) {
          // Sesi tidak valid: keluar supaya pengguna bisa masuk ulang.
          onKeluar();
        } else {
          setGalat(e instanceof Error ? e.message : 'Data belum bisa dimuat.');
        }
      });
  }, [onKeluar]);

  return (
    <main className="dasbor">
      <header>
        <h1>Analitik platform</h1>
        <button className="garis" onClick={onKeluar}>
          Keluar
        </button>
      </header>

      {galat && <p role="alert" className="galat">{galat}</p>}

      {ringkas && (
        <section className="kartu-grid">
          <Kartu judul="Pengguna" nilai={ringkas.pengguna_total} />
          <Kartu judul="Organisasi" nilai={ringkas.organisasi_total} />
          <Kartu judul="Transaksi" nilai={ringkas.transaksi_total} />
          <Kartu judul="Aktif 30 hari" nilai={ringkas.pengguna_aktif_30_hari} />
        </section>
      )}

      {ringkas && (
        <section className="kartu">
          <h2>Langganan aktif</h2>
          {ringkas.langganan_aktif.length === 0 ? (
            <p className="redup">Belum ada langganan aktif.</p>
          ) : (
            <ul className="daftar">
              {ringkas.langganan_aktif.map((l) => (
                <li key={l.paket}>
                  <span>{l.paket}</span>
                  <strong>{l.organisasi} organisasi</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="kartu">
        <h2>Pendaftaran {RENTANG_HARI} hari terakhir</h2>
        <BatangHarian data={daftar} />
      </section>

      <section className="kartu">
        <h2>Transaksi {RENTANG_HARI} hari terakhir</h2>
        <BatangHarian data={trx} />
      </section>
    </main>
  );
}

function Kartu({ judul, nilai }: { judul: string; nilai: number }) {
  return (
    <div className="kartu-angka">
      <span className="redup">{judul}</span>
      <strong>{nilai.toLocaleString('id-ID')}</strong>
    </div>
  );
}

function BatangHarian({ data }: { data: Harian[] }) {
  if (data.length === 0) return <p className="redup">Tidak ada data pada rentang ini.</p>;
  const maks = Math.max(...data.map((d) => d.jumlah), 1);
  const total = data.reduce((a, d) => a + d.jumlah, 0);
  return (
    <>
      <p className="redup">Total {total.toLocaleString('id-ID')}</p>
      <ul className="batang">
        {data.map((d) => (
          <li key={d.hari} title={`${d.hari}: ${d.jumlah}`}>
            <span className="tanggal">{d.hari.slice(5)}</span>
            <span className="bar" style={{ width: `${(d.jumlah / maks) * 100}%` }} />
            <span className="nilai">{d.jumlah}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
