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
  token_hash CHAR(64) NOT NULL,
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
