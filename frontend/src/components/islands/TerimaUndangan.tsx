import { useEffect, useState } from 'react';
import { ambilSesi, api, ApiError, simpanSesi } from '../../lib/api';

// Halaman tujuan tautan undangan: /app/undang?token=... Pengguna harus sudah masuk.
// Setelah diterima, organisasi aktif diganti ke organisasi yang baru diikuti.

type Keadaan = { jenis: 'memuat' } | { jenis: 'berhasil'; organisasiId: number } | { jenis: 'galat'; pesan: string };

export default function TerimaUndangan() {
  const [keadaan, setKeadaan] = useState<Keadaan>({ jenis: 'memuat' });

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setKeadaan({ jenis: 'galat', pesan: 'Tautan undangan tidak lengkap. Buka tautan dari email undangan.' });
      return;
    }
    if (!ambilSesi()) {
      setKeadaan({ jenis: 'galat', pesan: 'Masuk dulu dengan email yang diundang, lalu buka tautan ini lagi.' });
      return;
    }
    api
      .terimaUndangan(token)
      .then((r) => setKeadaan({ jenis: 'berhasil', organisasiId: r.organisasi_id }))
      .catch((e) => {
        setKeadaan({
          jenis: 'galat',
          pesan: e instanceof ApiError ? e.message : 'Undangan belum bisa diterima. Coba lagi sebentar lagi.',
        });
      });
  }, []);

  if (keadaan.jenis === 'memuat') {
    return <p className="text-sm text-redup">Memproses undangan…</p>;
  }

  if (keadaan.jenis === 'galat') {
    return (
      <section className="kartu space-y-3">
        <h1 className="text-xl font-bold">Undangan belum diterima</h1>
        <p role="alert" className="text-sm text-[#c2410c]">
          {keadaan.pesan}
        </p>
        <a href="/app" className="tombol-garis min-h-11 inline-flex items-center justify-center">
          Ke beranda
        </a>
      </section>
    );
  }

  return (
    <section className="kartu space-y-3">
      <h1 className="text-xl font-bold">Undangan diterima</h1>
      <p className="text-sm text-redup">Anda sekarang anggota organisasi ini.</p>
      <button
        type="button"
        className="tombol-utama min-h-11"
        onClick={() => {
          // Sesi lama menyimpan organisasi aktif dan peran lama. Keduanya diganti supaya halaman berikutnya memakai organisasi baru.
          const sesi = ambilSesi();
          if (sesi) simpanSesi({ ...sesi, organisasiId: keadaan.organisasiId, organisasiNama: undefined, peran: undefined });
          window.location.assign('/app');
        }}
      >
        Buka organisasi
      </button>
    </section>
  );
}
