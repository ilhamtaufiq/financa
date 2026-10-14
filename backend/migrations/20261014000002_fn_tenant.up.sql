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
  organisasi_id BIGINT UNSIGNED NULL,
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
  kategori_id BIGINT UNSIGNED NULL,
  tipe ENUM('pemasukan','pengeluaran','transfer_keluar','transfer_masuk') NOT NULL,
  jumlah DECIMAL(18,2) NOT NULL,
  tanggal DATE NOT NULL,
  catatan VARCHAR(500) NULL,
  transfer_id CHAR(36) NULL,
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
