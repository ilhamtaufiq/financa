-- Kunci idempotensi dari klien (UUID yang dibuat di perangkat). Kirim ulang dengan
-- UUID yang sama tidak membuat baris baru. Unik per organisasi; NULL dibiarkan berulang.
ALTER TABLE fn_transaksi
  ADD COLUMN client_uuid CHAR(36) NULL AFTER transfer_id,
  ADD UNIQUE KEY uq_fn_transaksi_client (organisasi_id, client_uuid);
