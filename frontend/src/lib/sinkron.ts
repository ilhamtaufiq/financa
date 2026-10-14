import { api, ambilSesi, ApiError, unggahBukti, type Kategori, type Rekening, type Transaksi } from './api';
import { db, type EntriLokal } from './db';

/** Event di `window` setelah antrean diproses. Halaman yang menampilkan data memuat ulang dari sini. */
export const EVENT_SINKRON = 'financa:sinkron';

// Strategi offline:
// 1. Entri disimpan di IndexedDB dulu dengan status `menunggu`. Tidak pernah hilang
//    walaupun tidak ada koneksi.
// 2. `kirimAntrean` mengirim entri satu per satu saat online. Berhasil -> `tersinkron`.
//    Galat jaringan -> berhenti, dicoba lagi nanti. Galat dari server -> `gagal`
//    dengan pesan, dan ikut dicoba lagi saat kirim berikutnya.
//
// Kirim ulang aman: setiap entri membawa `uuid` sebagai `client_uuid`. Jika request sampai
// ke server tetapi respons hilang, pengiriman berikutnya mendapat transaksi yang sudah ada
// (200), bukan duplikat.

export type StatusBaris = 'server' | 'menunggu' | 'gagal';

export interface BarisDaftar {
  kunci: string;
  tanggal: string;
  tipe: string;
  rekening_id: number | null;
  jumlah: string;
  catatan: string | null;
  status: StatusBaris;
  galat: string | null;
}

export interface HasilKirim {
  berhasil: number;
  gagal: number;
  tertunda: number;
}

/** Kalimat ringkasan hasil kirim untuk ditampilkan ke pengguna. */
export function ringkasKirim(hasil: HasilKirim): string {
  if (hasil.berhasil === 0 && hasil.gagal === 0 && hasil.tertunda === 0) {
    return 'Tidak ada transaksi yang perlu dikirim.';
  }
  const bagian: string[] = [];
  if (hasil.berhasil > 0) bagian.push(`${hasil.berhasil} transaksi terkirim`);
  if (hasil.gagal > 0) bagian.push(`${hasil.gagal} gagal, buka Transaksi untuk melihat alasannya`);
  if (hasil.tertunda > 0) bagian.push(`${hasil.tertunda} menunggu koneksi`);
  return `${bagian.join('. ')}.`;
}

const POLA_JUMLAH = /^\d+(\.\d{1,2})?$/;

/** Pesan galat untuk jumlah, atau `null` jika valid. Sama dengan aturan backend (> 0). */
export function validasiJumlah(nilai: string): string | null {
  const bersih = nilai.trim();
  if (bersih === '') return 'Jumlah wajib diisi.';
  if (!POLA_JUMLAH.test(bersih)) return 'Jumlah harus angka dengan maksimal dua desimal.';
  if (Number(bersih) <= 0) return 'Jumlah harus lebih dari nol.';
  return null;
}

export function sekarang(): string {
  return new Date().toISOString();
}

export function labelTipe(tipe: string): string {
  switch (tipe) {
    case 'pemasukan':
      return 'Pemasukan';
    case 'pengeluaran':
      return 'Pengeluaran';
    case 'transfer_keluar':
      return 'Transfer keluar';
    case 'transfer_masuk':
      return 'Transfer masuk';
    default:
      return tipe;
  }
}

type MasukanEntri = Omit<EntriLokal, 'uuid' | 'status' | 'galat' | 'server_id' | 'transfer_id' | 'dibuat'>;

/** Simpan entri ke perangkat. Tidak membutuhkan koneksi. */
export async function simpanEntri(masukan: MasukanEntri): Promise<string> {
  const uuid = crypto.randomUUID();
  await db().entri.put({
    ...masukan,
    uuid,
    status: 'menunggu',
    galat: null,
    server_id: null,
    transfer_id: null,
    dibuat: sekarang(),
  });
  return uuid;
}

/** Ambil referensi rekening dan kategori dari server ke cache. Mengembalikan `false` jika gagal. */
export async function segarkanReferensi(): Promise<boolean> {
  if (!navigator.onLine) return false;
  try {
    const [rekening, kategori] = await Promise.all([api.rekening(), api.kategori()]);
    const d = db();
    await d.transaction('rw', [d.rekening, d.kategori], async () => {
      await d.rekening.clear();
      await d.rekening.bulkPut(rekening);
      await d.kategori.clear();
      await d.kategori.bulkPut(kategori);
    });
    return true;
  } catch {
    return false;
  }
}

export async function ambilReferensi(): Promise<{ rekening: Rekening[]; kategori: Kategori[] }> {
  const d = db();
  const [rekening, kategori] = await Promise.all([d.rekening.toArray(), d.kategori.toArray()]);
  return { rekening, kategori };
}

export async function hitungTertunda(): Promise<number> {
  return db().entri.where('status').anyOf(['menunggu', 'gagal']).count();
}

/**
 * Unggah bukti yang tertunda untuk satu transaksi. Galat tidak mengubah status transaksi:
 * bukti tetap di antrean dan dicoba lagi pada sinkron berikutnya.
 */
async function unggahLampiranEntri(uuid: string, transaksiId: number): Promise<void> {
  const lampiran = await db().lampiran.get(uuid);
  if (!lampiran) return;
  try {
    await unggahBukti(transaksiId, lampiran.berkas, lampiran.nama);
    await db().lampiran.delete(uuid);
  } catch {
    // Tetap di antrean.
  }
}

let prosesAktif: Promise<HasilKirim> | null = null;

/**
 * Kirim semua entri yang belum tersinkron, urut dari yang paling lama.
 * Tanpa koneksi atau sesi, tidak ada yang dikirim: entri tetap `menunggu`, bukan `gagal`.
 * Pemanggilan bersamaan berbagi satu proses supaya entri tidak terkirim dua kali.
 */
export function kirimAntrean(): Promise<HasilKirim> {
  if (prosesAktif) return prosesAktif;
  prosesAktif = prosesAntrean().finally(() => {
    prosesAktif = null;
  });
  return prosesAktif;
}

async function prosesAntrean(): Promise<HasilKirim> {
  const hasil: HasilKirim = { berhasil: 0, gagal: 0, tertunda: 0 };
  if (!navigator.onLine || !ambilSesi()) {
    hasil.tertunda = await hitungTertunda();
    return hasil;
  }

  const antrean = await db().entri.where('status').anyOf(['menunggu', 'gagal']).sortBy('dibuat');
  for (const e of antrean) {
    try {
      if (e.jenis === 'transaksi') {
        const t = await api.buatTransaksi({
          rekening_id: e.rekening_id!,
          kategori_id: e.kategori_id ?? null,
          tipe: e.tipe!,
          jumlah: e.jumlah,
          tanggal: e.tanggal,
          catatan: e.catatan,
          client_uuid: e.uuid,
        });
        await db().entri.update(e.uuid, { status: 'tersinkron', galat: null, server_id: t.id });
        await unggahLampiranEntri(e.uuid, t.id);
      } else {
        const t = await api.buatTransfer({
          rekening_asal_id: e.rekening_asal_id!,
          rekening_tujuan_id: e.rekening_tujuan_id!,
          jumlah: e.jumlah,
          tanggal: e.tanggal,
          catatan: e.catatan,
          client_uuid: e.uuid,
        });
        await db().entri.update(e.uuid, { status: 'tersinkron', galat: null, transfer_id: t.transfer_id });
      }
      hasil.berhasil++;
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        // Koneksi putus di tengah antrean: hentikan, sisanya tetap menunggu.
        hasil.tertunda = await hitungTertunda();
        break;
      }
      hasil.gagal++;
      await db().entri.update(e.uuid, {
        status: 'gagal',
        galat: err instanceof Error ? err.message : 'Terjadi masalah. Coba lagi nanti.',
      });
    }
  }
  // Bukti dari transaksi yang sudah tersinkron, tetapi unggahannya gagal sebelumnya.
  for (const l of await db().lampiran.toArray()) {
    const e = await db().entri.get(l.uuid);
    if (e?.server_id) await unggahLampiranEntri(l.uuid, e.server_id);
  }

  if (hasil.berhasil > 0 || hasil.gagal > 0) {
    window.dispatchEvent(new Event(EVENT_SINKRON));
  }
  return hasil;
}

/**
 * Gabungkan daftar dari server dengan entri lokal yang belum tersinkron.
 * Entri lokal yang sudah tersinkron tidak ditampilkan dua kali karena sudah ada di server.
 */
export function gabungkanDaftar(server: Transaksi[], lokal: EntriLokal[]): BarisDaftar[] {
  const dariServer: BarisDaftar[] = server.map((t) => ({
    kunci: `srv-${t.id}`,
    tanggal: t.tanggal,
    tipe: t.tipe,
    rekening_id: t.rekening_id,
    jumlah: t.jumlah,
    catatan: t.catatan,
    status: 'server',
    galat: null,
  }));

  const dariLokal: BarisDaftar[] = lokal
    .filter((e) => e.status !== 'tersinkron')
    .map((e) => ({
      kunci: `lok-${e.uuid}`,
      tanggal: e.tanggal,
      tipe: e.jenis === 'transfer' ? 'transfer_keluar' : (e.tipe ?? 'pengeluaran'),
      rekening_id: e.jenis === 'transfer' ? (e.rekening_asal_id ?? null) : (e.rekening_id ?? null),
      jumlah: e.jumlah,
      catatan: e.catatan,
      status: e.status === 'gagal' ? 'gagal' : 'menunggu',
      galat: e.galat,
    }));

  return [...dariLokal, ...dariServer].sort((a, b) =>
    a.tanggal === b.tanggal ? (a.kunci < b.kunci ? 1 : -1) : a.tanggal < b.tanggal ? 1 : -1,
  );
}
