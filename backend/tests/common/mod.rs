use financa_api::db;
use sqlx::mysql::{MySqlPool, MySqlPoolOptions};
use uuid::Uuid;

/// Database sementara per tes. Dibuat dari `DATABASE_URL`, lalu di-drop lewat `hapus`.
///
/// `DATABASE_URL` harus berbentuk `mysql://user:pass@host:port/<db-yang-sudah-ada>`
/// tanpa query string, dan user harus punya privilege CREATE/DROP DATABASE.
pub struct TestDb {
    pub pool: MySqlPool,
    admin: MySqlPool,
    nama: String,
}

/// `None` jika `DATABASE_URL` tidak diset. Tes akan dilewati dengan pesan di stderr.
pub async fn baru() -> Option<TestDb> {
    let Ok(url) = std::env::var("DATABASE_URL") else {
        eprintln!("SKIP: DATABASE_URL tidak diset, tes database dilewati");
        return None;
    };

    let (base, _) = url.rsplit_once('/').expect("DATABASE_URL tidak valid");
    let admin = MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("gagal konek ke server database");

    let nama = format!("financa_test_{}", Uuid::new_v4().simple());
    sqlx::query(&format!("CREATE DATABASE `{nama}`"))
        .execute(&admin)
        .await
        .expect("gagal membuat database tes");

    let pool = db::connect(&format!("{base}/{nama}"))
        .await
        .expect("gagal konek ke database tes");
    db::migrate(&pool).await.expect("migrasi gagal");

    Some(TestDb { pool, admin, nama })
}

impl TestDb {
    pub async fn hapus(self) {
        self.pool.close().await;
        sqlx::query(&format!("DROP DATABASE IF EXISTS `{}`", self.nama))
            .execute(&self.admin)
            .await
            .expect("gagal menghapus database tes");
        self.admin.close().await;
    }
}
