CREATE TABLE fn_undangan (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organisasi_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(190) NOT NULL,
  peran ENUM('admin','anggota') NOT NULL,
  token_hash CHAR(64) NOT NULL,
  dibuat_oleh BIGINT UNSIGNED NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fn_undangan_hash (token_hash),
  KEY ix_fn_undangan_org (organisasi_id, used_at),
  CONSTRAINT fk_fn_undangan_organisasi FOREIGN KEY (organisasi_id) REFERENCES fn_organisasi (id),
  CONSTRAINT fk_fn_undangan_pembuat FOREIGN KEY (dibuat_oleh) REFERENCES fn_pengguna (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
