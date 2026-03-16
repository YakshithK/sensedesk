pub mod metadata;
pub mod vector;

use dirs_next::data_local_dir;
use sqlx::SqlitePool;

pub async fn init_db() -> Result<SqlitePool, sqlx::Error> {
    // Store the DB in the platform standard app directory (not in the source tree).
    // This avoids triggering dev-tool rebuilds when the DB file changes.
    let app_dir = data_local_dir()
        .ok_or_else(|| sqlx::Error::Configuration("Failed to resolve local data dir".into()))?
        .join("sensedesk");
    std::fs::create_dir_all(&app_dir)
        .map_err(|e| sqlx::Error::Configuration(e.to_string().into()))?;

    let db_path = app_dir.join("sensedesk.db");
    let database_url = format!("sqlite:{}?mode=rwc", db_path.display());
    let pool = SqlitePool::connect(&database_url).await?;

    // Run migrations
    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(pool)
}