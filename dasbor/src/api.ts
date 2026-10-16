// Klien untuk dua service: backend (login) dan analitik (data admin).
// Token sesi disimpan di sessionStorage, sehingga hilang saat tab ditutup.

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';
const ANALITIK_URL = import.meta.env.VITE_ANALITIK_URL || 'http://127.0.0.1:8100';
const KUNCI_TOKEN = 'dasbor.token';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Ringkasan {
  pengguna_total: number;
  organisasi_total: number;
  transaksi_total: number;
  pengguna_aktif_30_hari: number;
  langganan_aktif: { paket: string; organisasi: number }[];
}

export interface Harian {
  hari: string;
  jumlah: number;
}

export function ambilToken(): string | null {
  try {
    return sessionStorage.getItem(KUNCI_TOKEN);
  } catch {
    return null;
  }
}

function simpanToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(KUNCI_TOKEN, token);
    else sessionStorage.removeItem(KUNCI_TOKEN);
  } catch {
    // sessionStorage tidak tersedia: sesi hanya hidup di memori halaman ini.
  }
}

async function kirim<T>(url: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, 'Tidak bisa terhubung ke server.');
  }
  const data = (await res.json().catch(() => null)) as { pesan?: string; error?: string } | null;
  if (!res.ok) {
    throw new ApiError(res.status, data?.pesan ?? data?.error ?? `Server menjawab ${res.status}.`);
  }
  return data as T;
}

export async function masuk(email: string, kataSandi: string): Promise<void> {
  const sesi = await kirim<{ token: string }>(`${BACKEND_URL}/api/v1/auth/masuk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, kata_sandi: kataSandi }),
  });
  simpanToken(sesi.token);
}

export function keluar() {
  simpanToken(null);
}

function dengan(token: string) {
  return { headers: { Authorization: `Bearer ${token}` } };
}

/** Semua panggilan analitik memakai token dari sesi login. 401 atau 403 harus ditangani pemanggil. */
export async function ringkasan(): Promise<Ringkasan> {
  const token = ambilToken();
  if (!token) throw new ApiError(401, 'Belum masuk.');
  return kirim<Ringkasan>(`${ANALITIK_URL}/api/v1/analitik/ringkasan`, dengan(token));
}

export async function pendaftaran(dari: string, sampai: string): Promise<Harian[]> {
  const token = ambilToken();
  if (!token) throw new ApiError(401, 'Belum masuk.');
  const q = new URLSearchParams({ dari, sampai });
  return kirim<Harian[]>(`${ANALITIK_URL}/api/v1/analitik/pendaftaran?${q}`, dengan(token));
}

export async function transaksi(dari: string, sampai: string): Promise<Harian[]> {
  const token = ambilToken();
  if (!token) throw new ApiError(401, 'Belum masuk.');
  const q = new URLSearchParams({ dari, sampai });
  return kirim<Harian[]>(`${ANALITIK_URL}/api/v1/analitik/transaksi?${q}`, dengan(token));
}
