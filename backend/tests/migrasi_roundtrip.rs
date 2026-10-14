mod common;

use financa_api::db::MIGRATOR;

async fn jumlah_tabel_fn(pool: &sqlx::mysql::MySqlPool) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM information_schema.tables \
         WHERE table_schema = DATABASE() AND table_name LIKE 'fn%'",
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn migrasi_up_down_up_bersih() {
    let Some(db) = common::baru().await else { return };

    // Setelah `baru()`, semua migrasi sudah naik.
    assert!(jumlah_tabel_fn(&db.pool).await >= 10, "tabel fn_* belum terbentuk");

    // Turun sampai nol: semua tabel fn_* harus hilang.
    MIGRATOR.undo(&db.pool, 0).await.expect("undo gagal");
    assert_eq!(jumlah_tabel_fn(&db.pool).await, 0, "masih ada tabel fn_* setelah undo");

    // Naik lagi: skema harus kembali utuh.
    MIGRATOR.run(&db.pool).await.expect("migrasi ulang gagal");
    assert!(jumlah_tabel_fn(&db.pool).await >= 10, "tabel fn_* tidak kembali setelah migrasi ulang");

    db.hapus().await;
}
