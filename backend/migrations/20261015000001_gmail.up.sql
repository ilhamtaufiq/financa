-- Koneksi Gmail per pengguna dalam satu organisasi. Refresh token disimpan terenkripsi (AES-GCM),
-- bukan teks biasa. Kunci enkripsi berasal dari GMAIL_ENC_KEY.
CREATE TABLE fn_koneksi_gmail (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organisasi_id BIGINT UNSIGNED NOT NULL,
  pengguna_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(255) NOT NULL,
  refresh_token_enc VARBINARY(1024) NOT NULL,
  sinkron_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fn_koneksi_gmail (organisasi_id, pengguna_id),
  CONSTRAINT fk_fn_koneksi_gmail_organisasi FOREIGN KEY (organisasi_id) REFERENCES fn_organisasi (id),
  CONSTRAINT fk_fn_koneksi_gmail_pengguna FOREIGN KEY (pengguna_id) REFERENCES fn_pengguna (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Draf transaksi hasil tangkapan email. Belum masuk fn_transaksi sampai disetujui.
-- sumber_pesan_id adalah ID pesan Gmail; unik supaya email yang sama tidak menjadi dua draf.
CREATE TABLE fn_draf_transaksi (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organisasi_id BIGINT UNSIGNED NOT NULL,
  sumber VARCHAR(20) NOT NULL,
  sumber_pesan_id VARCHAR(64) NOT NULL,
  pengirim VARCHAR(255) NULL,
  keterangan VARCHAR(255) NOT NULL,
  jumlah DECIMAL(18,2) NULL,
  tipe ENUM('pemasukan','pengeluaran') NULL,
  tanggal DATE NULL,
  status ENUM('menunggu','disetujui','dibuang') NOT NULL DEFAULT 'menunggu',
  transaksi_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fn_draf_sumber (organisasi_id, sumber, sumber_pesan_id),
  KEY ix_fn_draf_status (organisasi_id, status),
  CONSTRAINT fk_fn_draf_organisasi FOREIGN KEY (organisasi_id) REFERENCES fn_organisasi (id),
  CONSTRAINT fk_fn_draf_transaksi FOREIGN KEY (transaksi_id) REFERENCES fn_transaksi (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
