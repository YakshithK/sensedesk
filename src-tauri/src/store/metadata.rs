use anyhow::{Context, Result};
use sqlx::{sqlite::SqlitePoolOptions, Pool, Sqlite, Row};

#[derive(Clone)]
pub struct DbStore {
    pub pool: Pool<Sqlite>,
}

impl DbStore {
    pub async fn new(db_url: &str) -> Result<Self> {
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect(db_url)
            .await
            .context("Failed to connect to SQLite metadata DB")?;
        
        // Ensure migrations run automatically
        sqlx::migrate!("./migrations").run(&pool).await?;
        
        Ok(Self { pool })
    }

    pub async fn upsert_file(&self, id: &str, path: &str, file_type: &str, size_bytes: i64, modified_at: i64) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO files (id, path, file_type, size_bytes, modified_at, status)
            VALUES (?1, ?2, ?3, ?4, ?5, 'indexed')
            ON CONFLICT(path) DO UPDATE SET
                file_type = excluded.file_type,
                size_bytes = excluded.size_bytes,
                modified_at = excluded.modified_at,
                status = 'indexed'
            "#,
        )
        .bind(id).bind(path).bind(file_type).bind(size_bytes).bind(modified_at)
        .execute(&self.pool)
        .await?;
        
        Ok(())
    }

    pub async fn insert_chunk(&self, id: &str, file_id: &str, chunk_index: i32, modality: &str, text_excerpt: Option<&str>, qdrant_point_id: &str, created_at: i64) -> Result<()> {
         sqlx::query(
            r#"
            INSERT INTO chunks (id, file_id, chunk_index, modality, text_excerpt, qdrant_point_id, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
        )
        .bind(id).bind(file_id).bind(chunk_index).bind(modality).bind(text_excerpt).bind(qdrant_point_id).bind(created_at)
        .execute(&self.pool)
        .await?;
         
        Ok(())
    }
}
