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
  aksi VARCHAR(40) NOT NULL,
  entitas VARCHAR(40) NOT NULL,
  entitas_id BIGINT UNSIGNED NOT NULL,
  data JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_fn_audit_org_waktu (organisasi_id, created_at),
  KEY ix_fn_audit_entitas (entitas, entitas_id),
  CONSTRAINT fk_fn_audit_organisasi FOREIGN KEY (organisasi_id) REFERENCES fn_organisasi (id),
  CONSTRAINT fk_fn_audit_pengguna FOREIGN KEY (pengguna_id) REFERENCES fn_pengguna (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
