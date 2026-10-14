use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("database: {0}")]
    Db(#[from] sqlx::Error),

    #[error("migrasi: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),

    #[error("{entitas} tidak ditemukan")]
    NotFound { entitas: &'static str },

    #[error("jumlah transaksi harus lebih dari nol")]
    JumlahTidakValid,

    #[error("nilai {tipe} tidak dikenal: {nilai}")]
    NilaiTidakValid { tipe: &'static str, nilai: String },

    #[error("{0}")]
    Validasi(String),

    #[error("internal: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, Error>;
