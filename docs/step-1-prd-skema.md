# Step 1 — PRD ringkas & skema data (MariaDB)

Bagian dari `docs/plan/saas-manajemen-keuangan.md`, Step 1.

## 1. PRD ringkas

**Masalah**: perorangan dan pelaku usaha mencatat keuangan di buku atau spreadsheet. Saldo per kas/bank tidak terlihat dan laporan bulanan butuh waktu lama.

**Tujuan MVP**: pencatatan transaksi harian, saldo per rekening, dan laporan bulanan yang bisa diekspor CSV.

**Pengguna**
- Owner: membuat organisasi, mengundang anggota, mengelola langganan.
- Admin: mengelola rekening dan kategori, mencatat transaksi.
- Anggota: mencatat transaksi.

**User story utama**
1. Sebagai owner, saya membuat organisasi dan rekening kas/bank dengan saldo awal.
2. Sebagai admin, saya mencatat pemasukan dan pengeluaran dengan kategori dan tanggal.
3. Sebagai admin, saya memindahkan uang antar rekening dan saldo keduanya berubah benar.
4. Sebagai owner, saya melihat ringkasan bulanan dan mengekspor CSV.

**Di luar MVP**: penggajian, faktur AR/AP, pajak, multi-mata uang, integrasi bank, payment gateway.

**Aturan bisnis**
- Semua data milik satu organisasi. Setiap query wajib memfilter `organisasi_id`.
- Saldo tidak disimpan sebagai kolom. Saldo dihitung dari `saldo_awal` dan transaksi.
- Jumlah transaksi selalu positif. Arah ditentukan oleh `tipe`.
- Transfer menghasilkan dua baris: `transfer_keluar` di rekening asal dan `transfer_masuk` di rekening tujuan. Keduanya memakai `transfer_id` yang sama.
- Uang disimpan sebagai `DECIMAL(18,2)`, mata uang IDR.
- Periode laporan tidak butuh tabel. Laporan dihitung dari `tanggal` transaksi.

## 2. Skema data

Semua tabel memakai prefiks `fn_`, engine InnoDB, charset `utf8mb4`.

```
fn_pengguna 1─* fn_keanggotaan *─1 fn_organisasi
fn_pengguna 1─* fn_sesi_token
fn_pengguna 1─* fn_reset_password
fn_organisasi 1─* fn_rekening
fn_organisasi 1─* fn_kategori            (organisasi_id NULL = kategori default global)
fn_organisasi 1─* fn_transaksi
fn_rekening 1─* fn_transaksi
fn_kategori 1─* fn_transaksi
fn_transaksi 1─* fn_lampiran
fn_organisasi 1─* fn_langganan
fn_organisasi 1─* fn_audit_log
```

## 3. DDL

```sql
CREATE TABLE fn_organisasi (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama VARCHAR(150) NOT NULL,
  slug VARCHAR(80) NOT NULL,
  mata_uang CHAR(3) NOT NULL DEFAULT 'IDR',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fn_organisasi_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fn_pengguna (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  nama VARCHAR(120) NOT NULL,
  email VARCHAR(190) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  email_terverifikasi_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fn_pengguna_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fn_sesi_token (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pengguna_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,          -- SHA-256 dari token, bukan token mentah
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fn_sesi_token_hash (token_hash),
  KEY ix_fn_sesi_token_pengguna (pengguna_id),
  CONSTRAINT fk_fn_sesi_token_pengguna FOREIGN KEY (pengguna_id) REFERENCES fn_pengguna (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fn_reset_password (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  pengguna_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fn_reset_password_hash (token_hash),
  KEY ix_fn_reset_password_pengguna (pengguna_id),
  CONSTRAINT fk_fn_reset_password_pengguna FOREIGN KEY (pengguna_id) REFERENCES fn_pengguna (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fn_keanggotaan (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organisasi_id BIGINT UNSIGNED NOT NULL,
  pengguna_id BIGINT UNSIGNED NOT NULL,
  peran ENUM('owner','admin','anggota') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fn_keanggotaan (organisasi_id, pengguna_id),
  KEY ix_fn_keanggotaan_pengguna (pengguna_id),
  CONSTRAINT fk_fn_keanggotaan_organisasi FOREIGN KEY (organisasi_id) REFERENCES fn_organisasi (id),
  CONSTRAINT fk_fn_keanggotaan_pengguna FOREIGN KEY (pengguna_id) REFERENCES fn_pengguna (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fn_rekening (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organisasi_id BIGINT UNSIGNED NOT NULL,
  nama VARCHAR(120) NOT NULL,
  jenis ENUM('kas','bank','lainnya') NOT NULL,
  saldo_awal DECIMAL(18,2) NOT NULL DEFAULT 0.00,
  diarsipkan_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_fn_rekening_org (organisasi_id, diarsipkan_at),
  CONSTRAINT fk_fn_rekening_organisasi FOREIGN KEY (organisasi_id) REFERENCES fn_organisasi (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fn_kategori (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organisasi_id BIGINT UNSIGNED NULL,     -- NULL = kategori default global
  tipe ENUM('pemasukan','pengeluaran') NOT NULL,
  nama VARCHAR(100) NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fn_kategori (organisasi_id, tipe, nama),
  CONSTRAINT fk_fn_kategori_organisasi FOREIGN KEY (organisasi_id) REFERENCES fn_organisasi (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fn_transaksi (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organisasi_id BIGINT UNSIGNED NOT NULL,
  rekening_id BIGINT UNSIGNED NOT NULL,
  kategori_id BIGINT UNSIGNED NULL,       -- NULL untuk baris transfer
  tipe ENUM('pemasukan','pengeluaran','transfer_keluar','transfer_masuk') NOT NULL,
  jumlah DECIMAL(18,2) NOT NULL,
  tanggal DATE NOT NULL,
  catatan VARCHAR(500) NULL,
  transfer_id CHAR(36) NULL,              -- UUID; sama untuk dua baris transfer
  dibuat_oleh BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY ix_fn_transaksi_org_tanggal (organisasi_id, tanggal),
  KEY ix_fn_transaksi_rekening_tanggal (rekening_id, tanggal),
  KEY ix_fn_transaksi_transfer (transfer_id),
  KEY ix_fn_transaksi_kategori (kategori_id),
  CONSTRAINT chk_fn_transaksi_jumlah CHECK (jumlah > 0),
  CONSTRAINT fk_fn_transaksi_organisasi FOREIGN KEY (organisasi_id) REFERENCES fn_organisasi (id),
  CONSTRAINT fk_fn_transaksi_rekening FOREIGN KEY (rekening_id) REFERENCES fn_rekening (id),
  CONSTRAINT fk_fn_transaksi_kategori FOREIGN KEY (kategori_id) REFERENCES fn_kategori (id),
  CONSTRAINT fk_fn_transaksi_pengguna FOREIGN KEY (dibuat_oleh) REFERENCES fn_pengguna (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fn_lampiran (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organisasi_id BIGINT UNSIGNED NOT NULL,
  transaksi_id BIGINT UNSIGNED NOT NULL,
  path VARCHAR(255) NOT NULL,
  mime VARCHAR(100) NOT NULL,
  ukuran_byte INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_fn_lampiran_org (organisasi_id),
  KEY ix_fn_lampiran_transaksi (transaksi_id),
  CONSTRAINT fk_fn_lampiran_organisasi FOREIGN KEY (organisasi_id) REFERENCES fn_organisasi (id),
  CONSTRAINT fk_fn_lampiran_transaksi FOREIGN KEY (transaksi_id) REFERENCES fn_transaksi (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fn_langganan (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organisasi_id BIGINT UNSIGNED NOT NULL,
  paket ENUM('gratis','dasar','pro') NOT NULL,
  mulai DATE NOT NULL,
  berakhir DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_fn_langganan_org (organisasi_id, berakhir),
  CONSTRAINT fk_fn_langganan_organisasi FOREIGN KEY (organisasi_id) REFERENCES fn_organisasi (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE fn_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organisasi_id BIGINT UNSIGNED NOT NULL,
  pengguna_id BIGINT UNSIGNED NULL,
  aksi VARCHAR(40) NOT NULL,              -- contoh: create, update, archive
  entitas VARCHAR(40) NOT NULL,           -- contoh: transaksi, rekening
  entitas_id BIGINT UNSIGNED NOT NULL,
  data JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_fn_audit_org_waktu (organisasi_id, created_at),
  KEY ix_fn_audit_entitas (entitas, entitas_id),
  CONSTRAINT fk_fn_audit_organisasi FOREIGN KEY (organisasi_id) REFERENCES fn_organisasi (id),
  CONSTRAINT fk_fn_audit_pengguna FOREIGN KEY (pengguna_id) REFERENCES fn_pengguna (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 4. Urutan migrasi

Urutan naik (up) mengikuti dependensi FK:

1. `fn_organisasi`, `fn_pengguna`
2. `fn_sesi_token`, `fn_reset_password`, `fn_keanggotaan`
3. `fn_rekening`, `fn_kategori`
4. `fn_transaksi`
5. `fn_lampiran`, `fn_langganan`, `fn_audit_log`
6. Seed kategori default (`organisasi_id` NULL) sebagai migrasi terpisah

Urutan turun (down) adalah kebalikannya. Seed dihapus dengan `DELETE FROM fn_kategori WHERE organisasi_id IS NULL`, lalu tabel di-drop dari atas ke bawah.

## 5. Catatan desain

- **Index tenant**: setiap tabel tenant punya `organisasi_id` di awal index atau index sendiri. Ini mendukung filter wajib di Step 2.
- **`uq_fn_kategori` dan NULL**: MariaDB mengizinkan beberapa baris dengan `organisasi_id` NULL pada unique key. Keunikan kategori default dijaga oleh seeder, bukan constraint.
- **`CHECK (jumlah > 0)`**: didukung MariaDB 10.2+. Arah masuk atau keluar ditentukan `tipe`.
- **Soft delete**: hanya `fn_organisasi`, `fn_pengguna`, dan `fn_transaksi` yang punya `deleted_at`. Rekening memakai `diarsipkan_at`.
- **Token**: `fn_sesi_token` dan `fn_reset_password` menyimpan hash SHA-256, bukan token mentah.
- **Ukuran uang**: Rust akan memetakan `DECIMAL(18,2)` ke `rust_decimal::Decimal`. Jangan memakai `f64`.

## 6. Pemeriksaan Acceptance

- [x] Skema lengkap untuk organisasi, pengguna, keanggotaan, rekening, kategori, transaksi, transfer, periode laporan. Periode laporan dihitung dari tanggal dan tidak butuh tabel.
- [x] Foreign key ada di semua tabel relasi.
- [x] Index dimulai dari `organisasi_id` pada tabel tenant.
- [x] Urutan up dan down didefinisikan, sehingga migrasi bisa di-revert.
- [x] Out of scope tidak tercermin di skema: tidak ada tabel gaji, faktur, atau pajak.
- [ ] Belum diuji di MariaDB asli. Validasi DDL dilakukan di Step 2.
