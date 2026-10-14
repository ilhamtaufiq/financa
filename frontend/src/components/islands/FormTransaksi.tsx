import { useEffect, useRef, useState } from 'react';
import type { Kategori, Rekening } from '../../lib/api';
import { ambilSesi, bacaStruk } from '../../lib/api';
import { db } from '../../lib/db';
import { ambilReferensi, kirimAntrean, segarkanReferensi, simpanEntri, validasiJumlah } from '../../lib/sinkron';
import { tanggalLokal } from '../../lib/format';
import { PillTabs } from '../ui/PillTabs';
import { InsetCard } from '../ui/Card';
import { Dropdown } from '../ui/Dropdown';
import { InputRupiah } from '../ui/InputRupiah';
import { PemilihTanggal } from '../ui/PemilihTanggal';
import { ModalNotif, type DataNotif } from '../ui/ModalNotif';

type Mode = 'pemasukan' | 'pengeluaran' | 'transfer';

const MAKS_BUKTI = 5 * 1024 * 1024;
const TIPE_BUKTI = ['image/jpeg', 'image/png', 'application/pdf'];

/** Pesan galat untuk bukti yang tidak sesuai, atau `null` jika valid. */
function galatBukti(berkas: File): string | null {
  if (!TIPE_BUKTI.includes(berkas.type)) return 'Bukti harus JPG, PNG, atau PDF.';
  if (berkas.size > MAKS_BUKTI) return 'Bukti terlalu besar. Maksimal 5 MB.';
  return null;
}

// Form catat cepat. Data disimpan ke perangkat dulu, lalu dikirim jika online.
// Tidak butuh koneksi untuk mencatat.

export default function FormTransaksi() {
  const [rekening, setRekening] = useState<Rekening[]>([]);
  const [kategori, setKategori] = useState<Kategori[]>([]);
  const [mode, setMode] = useState<Mode>('pengeluaran');
  const [rekeningId, setRekeningId] = useState('');
  const [rekeningTujuanId, setRekeningTujuanId] = useState('');
  const [kategoriId, setKategoriId] = useState('');
  const [jumlah, setJumlah] = useState('');
  const [tanggal, setTanggal] = useState(tanggalLokal());
  const [catatan, setCatatan] = useState('');
  const [galatJumlah, setGalatJumlah] = useState<string | null>(null);
  const [pesan, setPesan] = useState<{ teks: string; jenis: 'ok' | 'info' | 'galat' } | null>(null);
  const [sudahMasuk, setSudahMasuk] = useState(true);
  const [online, setOnline] = useState(true);
  const [membacaStruk, setMembacaStruk] = useState(false);
  const inputStruk = useRef<HTMLInputElement>(null);
  const [lampiran, setLampiran] = useState<File | null>(null);
  const [lampiranDariScan, setLampiranDariScan] = useState(false);
  const [notif, setNotif] = useState<DataNotif | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  const inputBukti = useRef<HTMLInputElement>(null);

  async function muatReferensi() {
    const r = await ambilReferensi();
    setRekening(r.rekening.filter((x) => !x.diarsipkan_at));
    setKategori(r.kategori);
  }

  useEffect(() => {
    setSudahMasuk(ambilSesi() !== null);
    setOnline(navigator.onLine);
    muatReferensi().then(async () => {
      if (navigator.onLine && (await segarkanReferensi())) await muatReferensi();
    });
  }, []);

  const kategoriTampil = kategori.filter((k) => k.tipe === mode);

  function pilihMode(m: Mode) {
    setMode(m);
    setKategoriId('');
    setGalatJumlah(null);
  }

  // Isi form dari foto struk. Hasilnya hanya usulan: pengguna tetap memeriksa dan menyimpan sendiri.
  async function bacaFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const berkas = e.target.files?.[0];
    e.target.value = '';
    if (!berkas) return;

    setMembacaStruk(true);
    setPesan({ teks: 'Membaca struk…', jenis: 'info' });
    try {
      const usulan = await bacaStruk(berkas);
      // Foto struk juga menjadi bukti. Pengguna bisa menghapusnya di form.
      if (!galatBukti(berkas)) {
        setLampiran(berkas);
        setLampiranDariScan(true);
      }
      if (usulan.jumlah) setJumlah(usulan.jumlah);
      if (usulan.tanggal) setTanggal(usulan.tanggal);
      if (usulan.toko && !catatan.trim()) setCatatan(usulan.toko);
      setPesan(
        usulan.jumlah
          ? { teks: 'Isian diambil dari struk. Periksa lagi sebelum menyimpan.', jenis: 'info' }
          : { teks: 'Jumlah tidak terbaca dari struk. Isi jumlah secara manual.', jenis: 'galat' },
      );
    } catch (err) {
      setPesan({ teks: err instanceof Error ? err.message : 'Struk tidak bisa dibaca.', jenis: 'galat' });
    } finally {
      setMembacaStruk(false);
    }
  }

  function pilihBukti(e: React.ChangeEvent<HTMLInputElement>) {
    const berkas = e.target.files?.[0];
    e.target.value = '';
    if (!berkas) return;
    const galat = galatBukti(berkas);
    if (galat) return setPesan({ teks: galat, jenis: 'galat' });
    setLampiran(berkas);
    setLampiranDariScan(false);
  }

  async function kirim(e: React.FormEvent) {
    e.preventDefault();
    // Cegah kirim ganda. Tap dua kali saat proses berjalan membuat form yang sudah dikosongkan divalidasi lagi
    // dan menampilkan galat jumlah, padahal transaksi pertama sudah tersimpan.
    if (menyimpan) return;
    setMenyimpan(true);
    try {
      await simpan();
    } finally {
      setMenyimpan(false);
    }
  }

  async function simpan() {
    setPesan(null);

    const galat = validasiJumlah(jumlah);
    setGalatJumlah(galat);
    if (galat) return;
    if (!rekeningId) return setPesan({ teks: 'Pilih rekening terlebih dahulu.', jenis: 'galat' });
    if (mode === 'transfer') {
      if (!rekeningTujuanId) return setPesan({ teks: 'Pilih rekening tujuan.', jenis: 'galat' });
      if (rekeningTujuanId === rekeningId) return setPesan({ teks: 'Rekening asal dan tujuan harus berbeda.', jenis: 'galat' });
    }
    if (!tanggal) return setPesan({ teks: 'Tanggal wajib diisi.', jenis: 'galat' });

    const jumlahBersih = jumlah.trim();
    const catatanBersih = catatan.trim() || null;

    if (mode === 'transfer') {
      await simpanEntri({
        jenis: 'transfer',
        tanggal,
        jumlah: jumlahBersih,
        catatan: catatanBersih,
        rekening_asal_id: Number(rekeningId),
        rekening_tujuan_id: Number(rekeningTujuanId),
      });
    } else {
      const uuid = await simpanEntri({
        jenis: 'transaksi',
        tanggal,
        jumlah: jumlahBersih,
        catatan: catatanBersih,
        rekening_id: Number(rekeningId),
        kategori_id: kategoriId ? Number(kategoriId) : null,
        tipe: mode,
      });
      // Bukti disimpan bersama transaksi di perangkat, lalu diunggah setelah transaksinya masuk server.
      if (lampiran) {
        await db().lampiran.put({ uuid, berkas: lampiran, nama: lampiran.name, mime: lampiran.type });
      }
    }

    setJumlah('');
    setCatatan('');
    setKategoriId('');
    setGalatJumlah(null);
    setLampiran(null);
    setLampiranDariScan(false);

    // Hasil simpan ditampilkan sebagai modal, karena ini kabar penting yang perlu dibaca dan punya langkah lanjutan.
    if (!navigator.onLine) {
      setNotif({
        jenis: 'info',
        judul: 'Tersimpan di perangkat',
        pesan: 'Transaksi akan dikirim otomatis saat koneksi kembali.',
      });
      return;
    }

    const hasil = await kirimAntrean();
    if (hasil.gagal > 0) {
      setNotif({
        jenis: 'galat',
        judul: 'Server menolak transaksi',
        pesan: 'Transaksi tersimpan di perangkat, tetapi server menolaknya. Buka Transaksi untuk melihat alasannya.',
      });
    } else if (hasil.tertunda > 0) {
      setNotif({
        jenis: 'info',
        judul: 'Tersimpan di perangkat',
        pesan: 'Koneksi terputus. Transaksi akan dikirim otomatis saat Anda online lagi.',
      });
    } else {
      setNotif({ jenis: 'ok', judul: 'Tersimpan', pesan: 'Tersimpan dan terkirim ke server.' });
    }
  }

  if (!sudahMasuk) {
    return (
      <div className="kartu space-y-3">
        <p>Sesi Anda belum aktif. Masuk dengan email dan kata sandi untuk melanjutkan.</p>
        <a href="/masuk" className="tombol-utama w-full">Buka halaman Masuk</a>
      </div>
    );
  }

  return (
    <section className="space-y-6" aria-labelledby="judul-catat">
      <div className="space-y-1">
        <h2 id="judul-catat" className="judul-ungu text-4xl font-bold leading-tight tracking-tight">Catat transaksi</h2>
        <p className="text-sm text-redup">Pemasukan, pengeluaran, atau transfer antar rekening</p>
      </div>

    <form onSubmit={kirim} className="kartu space-y-6 rounded-[32px] p-6 sm:p-7" noValidate>
      <PillTabs
        label="Jenis catatan"
        aktif={mode}
        onPilih={pilihMode}
        pilihan={[
          { nilai: 'pemasukan', label: 'Pemasukan' },
          { nilai: 'pengeluaran', label: 'Pengeluaran' },
          { nilai: 'transfer', label: 'Transfer' },
        ]}
      />

      {online && (
        <>
          <input
            ref={inputStruk}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={bacaFoto}
          />
          <button
            type="button"
            className="flex w-full items-center justify-center gap-2 rounded-full bg-inset px-5 py-3.5 font-bold text-teks transition hover:bg-garis disabled:opacity-50"
            onClick={() => inputStruk.current?.click()}
            disabled={membacaStruk}
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" />
            </svg>
            {membacaStruk ? 'Membaca struk…' : 'Ambil dari foto struk'}
          </button>
        </>
      )}

      {mode !== 'transfer' && (
        <InsetCard className="space-y-3">
          <p className="text-sm font-bold">Bukti (opsional)</p>
          {lampiran ? (
            <div className="flex items-center justify-between gap-3 rounded-2xl bg-permukaan px-3 py-2.5 shadow-sm">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{lampiran.name}</p>
                <p className="text-xs text-redup">
                  {lampiranDariScan ? 'Dari foto struk' : 'Diunggah setelah transaksi tersimpan di server'}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 text-sm font-semibold text-bahaya underline underline-offset-4"
                onClick={() => {
                  setLampiran(null);
                  setLampiranDariScan(false);
                }}
              >
                Hapus
              </button>
            </div>
          ) : (
            <button type="button" className="tombol-garis w-full" onClick={() => inputBukti.current?.click()}>
              Lampirkan foto atau PDF
            </button>
          )}
          <input
            ref={inputBukti}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={pilihBukti}
          />
        </InsetCard>
      )}

      <div>
        <label className="label-form" htmlFor="rekening">{mode === 'transfer' ? 'Dari rekening' : 'Rekening'}</label>
        <Dropdown
          id="rekening"
          nilai={rekeningId}
          onUbah={setRekeningId}
          placeholder="Pilih rekening"
          pilihan={rekening.map((r) => ({ nilai: String(r.id), label: r.nama }))}
        />
      </div>

      {mode === 'transfer' ? (
        <div>
          <label className="label-form" htmlFor="rekening-tujuan">Ke rekening</label>
          <Dropdown
            id="rekening-tujuan"
            nilai={rekeningTujuanId}
            onUbah={setRekeningTujuanId}
            placeholder="Pilih rekening"
            pilihan={rekening.map((r) => ({ nilai: String(r.id), label: r.nama }))}
          />
        </div>
      ) : (
        <div>
          <label className="label-form" htmlFor="kategori">Kategori</label>
          <Dropdown
            id="kategori"
            nilai={kategoriId}
            onUbah={setKategoriId}
            kosong="Tanpa kategori"
            pilihan={kategoriTampil.map((k) => ({ nilai: String(k.id), label: k.nama }))}
          />
        </div>
      )}

      <div>
        <label className="label-form" htmlFor="jumlah">Jumlah</label>
        <InputRupiah
          id="jumlah"
          nilai={jumlah}
          onUbah={(v) => {
            setJumlah(v);
            // Galat lama tidak relevan lagi begitu pengguna mengubah isian.
            if (galatJumlah) setGalatJumlah(null);
          }}
          className="text-2xl font-bold"
          placeholder="50.000"
          invalid={!!galatJumlah}
          describedBy={galatJumlah ? 'galat-jumlah' : undefined}
        />
        {galatJumlah && <p id="galat-jumlah" className="mt-1 text-sm text-bahaya">{galatJumlah}</p>}
      </div>

      <div>
        <label className="label-form" htmlFor="tanggal">Tanggal</label>
        <PemilihTanggal id="tanggal" nilai={tanggal} onUbah={setTanggal} />
      </div>

      <div>
        <label className="label-form" htmlFor="catatan">Catatan (opsional)</label>
        <input id="catatan" className="masukan" value={catatan} maxLength={500} onChange={(e) => setCatatan(e.target.value)} />
      </div>

      <button type="submit" className="tombol-utama min-h-14 w-full text-base" disabled={menyimpan}>
        {menyimpan ? 'Menyimpan…' : 'Simpan transaksi'}
      </button>

      {pesan && (
        <p role="status" className={pesan.jenis === 'galat' ? 'text-sm text-bahaya' : 'text-sm text-cendera'}>
          {pesan.teks}
        </p>
      )}
    </form>

    <ModalNotif
      notif={notif}
      onTutup={() => setNotif(null)}
      labelTutup={notif?.jenis === 'ok' ? 'Catat lagi' : 'Oke'}
      tautan={notif && notif.jenis !== 'info' ? { label: 'Lihat transaksi', href: '/app/transaksi' } : undefined}
    />
    </section>
  );
}
