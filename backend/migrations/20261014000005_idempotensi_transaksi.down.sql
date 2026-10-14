ALTER TABLE fn_transaksi
  DROP INDEX uq_fn_transaksi_client,
  DROP COLUMN client_uuid;
