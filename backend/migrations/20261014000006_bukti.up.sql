-- Bukti transaksi (opsional): foto struk atau PDF. Isi berkas disimpan di disk (BUKTI_DIR),
-- bukan di database. `berkas` adalah nama acak di disk; `nama_asli` hanya untuk unduhan.
CREATE TABLE fn_bukti (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organisasi_id BIGINT UNSIGNED NOT NULL,
  transaksi_id BIGINT UNSIGNED NOT NULL,
  nama_asli VARCHAR(255) NOT NULL,
  mime VARCHAR(64) NOT NULL,
  ukuran INT UNSIGNED NOT NULL,
  berkas CHAR(36) NOT NULL,
  dibuat_oleh BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fn_bukti_berkas (berkas),
  KEY ix_fn_bukti_transaksi (organisasi_id, transaksi_id),
  CONSTRAINT fk_fn_bukti_organisasi FOREIGN KEY (organisasi_id) REFERENCES fn_organisasi (id),
  CONSTRAINT fk_fn_bukti_transaksi FOREIGN KEY (transaksi_id) REFERENCES fn_transaksi (id)
);
