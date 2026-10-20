// Klien HTTP ke backend financa-api.
// - Akun: /api/v1/auth/* (tanpa organisasi).
// - Data: /api/v1/organisasi/{org}/* dengan token Bearer dari /auth/masuk.
//
// Token disimpan di localStorage. Itu berarti skrip apa pun di halaman ini bisa
// membacanya, jadi jaga agar tidak ada skrip pihak ketiga yang dimuat.

export interface Sesi {
  apiUrl: string;
  token: string;
  organisasiId: number;
  /** Nama organisasi aktif, disimpan saat memilih. Kosong untuk sesi lama. */
  organisasiNama?: string;
  email: string;
  /** Nama pengguna dari respons login. Kosong untuk sesi lama sebelum field ini ada. */
  nama?: string;
  /** Peran di organisasi aktif. Kosong untuk sesi lama sebelum fitur ini. */
  peran?: OrganisasiSaya['peran'];
}

/** Alamat API dari PUBLIC_API_URL (di .env frontend), default untuk pengembangan lokal. */
export function apiUrlDefault(): string {
  return import.meta.env.PUBLIC_API_URL || 'http://127.0.0.1:8000';
}

const KUNCI_SESI = 'financa.sesi';

export function ambilSesi(): Sesi | null {
  try {
    const mentah = localStorage.getItem(KUNCI_SESI);
    return mentah ? (JSON.parse(mentah) as Sesi) : null;
  } catch {
    return null;
  }
}

export function simpanSesi(sesi: Sesi | null): void {
  try {
    if (sesi) localStorage.setItem(KUNCI_SESI, JSON.stringify(sesi));
    else localStorage.removeItem(KUNCI_SESI);
  } catch {
    // localStorage tidak tersedia (mode privat tertentu): sesi hilang saat reload.
  }
}

/** status 0 = tidak ada koneksi. Sinkron memakai ini untuk membedakan galat jaringan. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    pesan: string,
  ) {
    super(pesan);
  }
}

// Desimal dikirim sebagai string (serde-with-str), jadi tipenya string.
export type Desimal = string;

export interface Rekening {
  id: number;
  organisasi_id: number;
  nama: string;
  jenis: 'kas' | 'bank' | 'lainnya';
  saldo_awal: Desimal;
  diarsipkan_at: string | null;
}

export interface RekeningDetail extends Rekening {
  saldo: Desimal;
}

export interface Kategori {
  id: number;
  organisasi_id: number | null;
  tipe: 'pemasukan' | 'pengeluaran';
  nama: string;
}

export interface Transaksi {
  id: number;
  organisasi_id: number;
  rekening_id: number;
  kategori_id: number | null;
  tipe: 'pemasukan' | 'pengeluaran' | 'transfer_keluar' | 'transfer_masuk';
  jumlah: Desimal;
  tanggal: string;
  catatan: string | null;
  transfer_id: string | null;
  dibuat_oleh: number;
}

export interface Transfer {
  transfer_id: string;
  keluar: Transaksi;
  masuk: Transaksi;
}

export interface BarisKategori {
  kategori_id: number | null;
  kategori: string;
  total: Desimal;
  jumlah_transaksi: number;
}

export interface LabaRugi {
  dari: string;
  sampai: string;
  pendapatan: BarisKategori[];
  beban: BarisKategori[];
  total_pendapatan: Desimal;
  total_beban: Desimal;
  laba_bersih: Desimal;
}

export interface RingkasanBulanan {
  tahun: number;
  bulan: number;
  dari: string;
  sampai: string;
  total_pemasukan: Desimal;
  total_pengeluaran: Desimal;
  selisih: Desimal;
  jumlah_transaksi: number;
}

/** Draf transaksi dari email yang menunggu ditinjau. Belum tercatat sebagai transaksi. */
export interface Draf {
  id: number;
  sumber_pesan_id: string;
  pengirim: string | null;
  keterangan: string;
  jumlah: Desimal | null;
  tipe: 'pemasukan' | 'pengeluaran' | null;
  tanggal: string | null;
  status: 'menunggu' | 'disetujui' | 'dibuang';
  transaksi_id: number | null;
}

/** Undangan yang belum diterima. Token tidak pernah dikirim balik ke browser. */
export interface UndanganMenunggu {
  id: number;
  email: string;
  peran: 'admin' | 'anggota';
  expires_at: string;
}

export interface TransaksiBaru {
  rekening_id: number;
  kategori_id: number | null;
  tipe: 'pemasukan' | 'pengeluaran';
  jumlah: Desimal;
  tanggal: string;
  catatan: string | null;
  /** UUID dari perangkat. Kirim ulang dengan UUID yang sama tidak membuat duplikat. */
  client_uuid?: string | null;
}

export interface TransferBaru {
  rekening_asal_id: number;
  rekening_tujuan_id: number;
  jumlah: Desimal;
  tanggal: string;
  catatan: string | null;
  client_uuid?: string | null;
}

export interface OrganisasiSaya {
  id: number;
  nama: string;
  slug: string;
  peran: 'owner' | 'admin' | 'anggota';
}

/** Saldo per rekening dalam satu periode. Dihitung server dari transaksi, transfer ikut masuk/keluar. */
export interface ArusKasRekening {
  rekening_id: number;
  nama: string;
  jenis: Rekening['jenis'];
  saldo_awal_periode: Desimal;
  masuk: Desimal;
  keluar: Desimal;
  saldo_akhir: Desimal;
}

export interface SesiMasuk {
  token: string;
  kedaluwarsa: string;
  pengguna: { id: number; nama: string; email: string };
}

async function kirimKe<T>(
  apiUrl: string,
  metode: 'GET' | 'POST' | 'PATCH',
  path: string,
  token: string | null,
  badan?: unknown,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method: metode, headers };
  if (badan !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(badan);
  }

  let res: Response;
  try {
    res = await fetch(`${apiUrl.replace(/\/$/, '')}${path}`, init);
  } catch {
    throw new ApiError(0, 'Tidak ada koneksi ke server.');
  }

  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  if (!res.ok) {
    if (res.status === 401 && token) {
      // Token kedaluwarsa atau dicabut: sesi lokal tidak berguna lagi.
      simpanSesi(null);
    }
    throw new ApiError(res.status, data?.error ?? `Server menjawab ${res.status}.`);
  }
  return data as T;
}

/** Panggilan akun (tanpa organisasi). */
export const akun = {
  masuk: (apiUrl: string, email: string, kataSandi: string) =>
    kirimKe<SesiMasuk>(apiUrl, 'POST', '/api/v1/auth/masuk', null, { email, kata_sandi: kataSandi }),
  keluar: (apiUrl: string, token: string) => kirimKe<void>(apiUrl, 'POST', '/api/v1/auth/keluar', token),
  daftarOrganisasi: (apiUrl: string, token: string) =>
    kirimKe<OrganisasiSaya[]>(apiUrl, 'GET', '/api/v1/organisasi', token),
  /** Selalu 202. Respons sama untuk email baru dan email yang sudah terdaftar. */
  daftar: (apiUrl: string, nama: string, email: string, kataSandi: string) =>
    kirimKe<void>(apiUrl, 'POST', '/api/v1/auth/daftar', null, { nama, email, kata_sandi: kataSandi }),
  lupaKataSandi: (apiUrl: string, email: string) =>
    kirimKe<void>(apiUrl, 'POST', '/api/v1/auth/lupa-kata-sandi', null, { email }),
  resetKataSandi: (apiUrl: string, token: string, kataSandiBaru: string) =>
    kirimKe<void>(apiUrl, 'POST', '/api/v1/auth/reset-kata-sandi', null, {
      token,
      kata_sandi_baru: kataSandiBaru,
    }),
  buatOrganisasi: (apiUrl: string, token: string, nama: string) =>
    kirimKe<{ id: number; nama: string; slug: string }>(apiUrl, 'POST', '/api/v1/organisasi', token, { nama }),
};

export interface BuktiServer {
  id: number;
  transaksi_id: number;
  nama_asli: string;
  mime: string;
  ukuran: number;
  created_at: string;
}

/**
 * Mengunduh berkas bukti sebagai Blob. Butuh header Authorization, jadi tidak bisa lewat `<img src>` biasa.
 */
export async function unduhBukti(buktiId: number): Promise<Blob> {
  const sesi = ambilSesi();
  if (!sesi) throw new ApiError(401, 'Belum masuk. Masuk terlebih dahulu untuk melanjutkan.');

  let res: Response;
  try {
    res = await fetch(`${sesi.apiUrl.replace(/\/$/, '')}/api/v1/organisasi/${sesi.organisasiId}/bukti/${buktiId}`, {
      headers: { Authorization: `Bearer ${sesi.token}` },
    });
  } catch {
    throw new ApiError(0, 'Tidak ada koneksi ke server.');
  }

  if (!res.ok) {
    if (res.status === 401) simpanSesi(null);
    throw new ApiError(res.status, `Server menjawab ${res.status}.`);
  }
  return res.blob();
}

/** Mengunggah bukti (JPG, PNG, atau PDF, maksimal 5 MB) ke transaksi yang sudah ada di server. */
export async function unggahBukti(transaksiId: number, berkas: Blob, nama: string): Promise<BuktiServer> {
  const sesi = ambilSesi();
  if (!sesi) throw new ApiError(401, 'Belum masuk. Masuk terlebih dahulu untuk melanjutkan.');

  const form = new FormData();
  form.append('berkas', berkas, nama);

  let res: Response;
  try {
    res = await fetch(
      `${sesi.apiUrl.replace(/\/$/, '')}/api/v1/organisasi/${sesi.organisasiId}/transaksi/${transaksiId}/bukti`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${sesi.token}` },
        body: form,
      },
    );
  } catch {
    throw new ApiError(0, 'Tidak ada koneksi ke server.');
  }

  const data = (await res.json().catch(() => null)) as (BuktiServer & { error?: string }) | null;
  if (!res.ok) {
    if (res.status === 401) simpanSesi(null);
    throw new ApiError(res.status, data?.error ?? `Server menjawab ${res.status}.`);
  }
  return data as BuktiServer;
}

export interface UsulanStruk {
  jumlah: string | null;
  tanggal: string | null;
  toko: string | null;
  teks: string;
}

/**
 * Membaca foto struk di server (OCR). Hasilnya hanya usulan: tidak ada transaksi yang tersimpan.
 * Butuh koneksi, jadi tidak ikut mode offline.
 */
export async function bacaStruk(berkas: File): Promise<UsulanStruk> {
  const sesi = ambilSesi();
  if (!sesi) throw new ApiError(401, 'Belum masuk. Masuk terlebih dahulu untuk melanjutkan.');

  const form = new FormData();
  form.append('gambar', berkas);

  let res: Response;
  try {
    res = await fetch(`${sesi.apiUrl.replace(/\/$/, '')}/api/v1/organisasi/${sesi.organisasiId}/transaksi/ocr`, {
      method: 'POST',
      // Jangan set Content-Type sendiri: browser menambahkan boundary multipart.
      headers: { Accept: 'application/json', Authorization: `Bearer ${sesi.token}` },
      body: form,
    });
  } catch {
    throw new ApiError(0, 'Tidak ada koneksi ke server.');
  }

  const data = (await res.json().catch(() => null)) as (UsulanStruk & { error?: string }) | null;
  if (!res.ok) {
    if (res.status === 401) simpanSesi(null);
    throw new ApiError(res.status, data?.error ?? `Server menjawab ${res.status}.`);
  }
  return data as UsulanStruk;
}

/** Panggilan data untuk organisasi di sesi aktif. */
async function panggil<T>(metode: 'GET' | 'POST' | 'PATCH', path: string, badan?: unknown): Promise<T> {
  const sesi = ambilSesi();
  if (!sesi) throw new ApiError(401, 'Belum masuk. Masuk terlebih dahulu untuk melanjutkan.');
  return kirimKe<T>(sesi.apiUrl, metode, `/api/v1/organisasi/${sesi.organisasiId}${path}`, sesi.token, badan);
}

export const api = {
  rekening: () => panggil<Rekening[]>('GET', '/rekening'),
  ubahRekening: (id: number, nama: string) => panggil<Rekening>('PATCH', `/rekening/${id}`, { nama }),
  arsipRekening: (id: number) => panggil<Rekening>('POST', `/rekening/${id}/arsip`),
  buatKategori: (b: { tipe: Kategori['tipe']; nama: string }) => panggil<Kategori>('POST', '/kategori', b),
  detailRekening: (id: number) => panggil<RekeningDetail>('GET', `/rekening/${id}`),
  buatRekening: (b: { nama: string; jenis: Rekening['jenis']; saldo_awal?: Desimal }) =>
    panggil<Rekening>('POST', '/rekening', b),
  kategori: () => panggil<Kategori[]>('GET', '/kategori'),
  daftarTransaksi: (dari: string, sampai: string) =>
    panggil<Transaksi[]>('GET', `/transaksi?dari=${dari}&sampai=${sampai}`),
  buatTransaksi: (b: TransaksiBaru) => panggil<Transaksi>('POST', '/transaksi', b),
  daftarBukti: (transaksiId: number) => panggil<BuktiServer[]>('GET', `/transaksi/${transaksiId}/bukti`),
  buatTransfer: (b: TransferBaru) => panggil<Transfer>('POST', '/transfer', b),
  draf: () => panggil<Draf[]>('GET', '/draf'),
  undanganMenunggu: () => panggil<UndanganMenunggu[]>('GET', '/undangan'),
  buatUndangan: (b: { email: string; peran: 'admin' | 'anggota' }) => panggil<void>('POST', '/undangan', b),
  /** Tidak terikat organisasi: undangan membawa organisasi sendiri. */
  terimaUndangan: async (token: string) => {
    const sesi = ambilSesi();
    if (!sesi) throw new ApiError(401, 'Belum masuk. Masuk terlebih dahulu untuk melanjutkan.');
    return kirimKe<{ organisasi_id: number }>(sesi.apiUrl, 'POST', '/api/v1/undangan/terima', sesi.token, { token });
  },
  setujuiDraf: (id: number, rekening_id: number, kategori_id: number | null) =>
    panggil<Transaksi>('POST', `/draf/${id}/setujui`, { rekening_id, kategori_id }),
  buangDraf: (id: number) => panggil<void>('POST', `/draf/${id}/buang`),
  gmailMulai: () => panggil<{ url: string }>('GET', '/gmail/mulai'),
  gmailSinkron: () => panggil<{ diperiksa: number; draf_baru: number }>('POST', '/gmail/sinkron'),
  ringkasanBulanan: (tahun: number, bulan: number) =>
    panggil<RingkasanBulanan>('GET', `/laporan/bulanan?tahun=${tahun}&bulan=${bulan}`),
  arusKas: (dari: string, sampai: string) =>
    panggil<ArusKasRekening[]>('GET', `/laporan/arus-kas?dari=${dari}&sampai=${sampai}`),
  labaRugi: (dari: string, sampai: string) =>
    panggil<LabaRugi>('GET', `/laporan/laba-rugi?dari=${dari}&sampai=${sampai}`),
};
