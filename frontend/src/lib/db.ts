import Dexie, { type Table } from 'dexie';
import type { Kategori, Rekening } from './api';

/**
 * IndexedDB (Dexie) di perangkat.
 * - rekening, kategori: cache referensi dari server, dipakai saat offline.
 * - entri: transaksi dan transfer yang dicatat di perangkat. Status `menunggu`
 *   atau `gagal` berarti belum masuk server dan akan dikirim ulang oleh sinkron.
 */

export interface EntriLokal {
  uuid: string;
  jenis: 'transaksi' | 'transfer';
  tanggal: string;
  jumlah: string;
  catatan: string | null;
  // jenis = transaksi
  rekening_id?: number;
  kategori_id?: number | null;
  tipe?: 'pemasukan' | 'pengeluaran';
  // jenis = transfer
  rekening_asal_id?: number;
  rekening_tujuan_id?: number;
  status: 'menunggu' | 'tersinkron' | 'gagal';
  galat: string | null;
  /** id transaksi di server, setelah sinkron (jenis = transaksi). */
  server_id: number | null;
  /** transfer_id di server, setelah sinkron (jenis = transfer). */
  transfer_id: string | null;
  dibuat: string;
}

/**
 * Bukti (opsional) yang belum terunggah. Dikaitkan dengan `uuid` entri lokal.
 * Baris dihapus setelah berkasnya masuk server.
 */
export interface LampiranLokal {
  uuid: string;
  berkas: Blob;
  nama: string;
  mime: string;
}

class FinancaDb extends Dexie {
  rekening!: Table<Rekening, number>;
  kategori!: Table<Kategori, number>;
  entri!: Table<EntriLokal, string>;
  lampiran!: Table<LampiranLokal, string>;

  constructor() {
    super('financa');
    this.version(1).stores({
      rekening: 'id',
      kategori: 'id',
      entri: 'uuid, status, dibuat',
    });
    this.version(2).stores({
      lampiran: 'uuid',
    });
  }
}

let _db: FinancaDb | null = null;

export function db(): FinancaDb {
  if (!_db) _db = new FinancaDb();
  return _db;
}
