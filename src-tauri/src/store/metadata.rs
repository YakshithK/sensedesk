use sqlx::{SqlitePool, Row};
use uuid::Uuid;
use std::path::PathBuf;

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct FileRecord {
    pub id: String,
    pub path: String,
    pub file_type: String,
    pub size_bytes: i64,
    pub modified_at: i64,
    pub indexed_at: Option<i64>,
    pub status: String,
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct ChunkRecord {
    pub id: String,
    pub file_id: String,
    pub chunk_index: i32,
    pub modality: String,
    pub text_excerpt: Option<String>,
    pub thumbnail_path: Option<String>,
    pub qdrant_point_id: Option<String>,
    pub embedding: Option<String>,
    pub created_at: i64,
}

pub async fn insert_file(pool: &SqlitePool, path: &PathBuf, file_type: &str, size: u64, modified: i64) -> Result<String, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO files (id, path, file_type, size_bytes, modified_at, status) VALUES (?, ?, ?, ?, ?, 'pending')"
    )
    .bind(&id)
    .bind(path.to_string_lossy().as_ref())
    .bind(file_type)
    .bind(size as i64)
    .bind(modified)
    .execute(pool)
    .await?;
    Ok(id)
}

pub async fn update_file_status(pool: &SqlitePool, id: &str, status: &str, indexed_at: Option<i64>) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE files SET status = ?, indexed_at = ? WHERE id = ?")
        .bind(status)
        .bind(indexed_at)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn insert_chunk(
    pool: &SqlitePool,
    file_id: &str,
    chunk_index: i32,
    modality: &str,
    text_excerpt: Option<&str>,
    thumbnail_path: Option<&str>,
    qdrant_point_id: Option<&str>,
    embedding: Option<&str>,
) -> Result<String, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO chunks (id, file_id, chunk_index, modality, text_excerpt, thumbnail_path, qdrant_point_id, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&id)
    .bind(file_id)
    .bind(chunk_index)
    .bind(modality)
    .bind(text_excerpt)
    .bind(thumbnail_path)
    .bind(qdrant_point_id)
    .bind(embedding)
    .bind(chrono::Utc::now().timestamp())
    .execute(pool)
    .await?;
    Ok(id)
}

#[allow(dead_code)]
pub async fn get_indexer_state(pool: &SqlitePool, key: &str) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query("SELECT value FROM indexer_state WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.get("value")))
}

#[allow(dead_code)]
pub async fn set_indexer_state(pool: &SqlitePool, key: &str, value: &str) -> Result<(), sqlx::Error> {
    sqlx::query("INSERT OR REPLACE INTO indexer_state (key, value) VALUES (?, ?)")
        .bind(key)
        .bind(value)
        .execute(pool)
        .await?;
    Ok(())
}