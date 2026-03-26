use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct StoredPoint {
    pub id: u64,
    pub vector: Vec<f32>,
    pub payload: HashMap<String, String>,
}

#[derive(Serialize, Deserialize, Default)]
struct VectorIndex {
    points: Vec<StoredPoint>,
}

pub struct ScoredPoint {
    pub id: u64,
    pub score: f32,
    pub payload: HashMap<String, String>,
}

pub struct VectorStore {
    storage_path: PathBuf,
    index: tokio::sync::Mutex<VectorIndex>,
    dirty: tokio::sync::Mutex<bool>,
}

impl VectorStore {
    pub fn new(storage_dir: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&storage_dir)
            .context("Failed to create vector storage directory")?;

        let index_path = storage_dir.join("vectors.json");
        let mut index = if index_path.exists() {
            let data = std::fs::read_to_string(&index_path)
                .context("Failed to read vector index")?;
            serde_json::from_str(&data).unwrap_or_default()
        } else {
            VectorIndex::default()
        };

        // Normalize previously persisted vectors so older indexes benefit
        // from cheaper dot-product search without forcing a rebuild.
        for point in &mut index.points {
            normalize_in_place(&mut point.vector);
        }

        Ok(Self {
            storage_path: storage_dir,
            index: tokio::sync::Mutex::new(index),
            dirty: tokio::sync::Mutex::new(false),
        })
    }

    /// Check if the store has any indexed points
    pub async fn has_points(&self) -> bool {
        !self.index.lock().await.points.is_empty()
    }

    /// Clear all stored vectors
    pub async fn clear(&self) -> Result<()> {
        let mut idx = self.index.lock().await;
        idx.points.clear();
        self.persist(&idx).await
    }

    /// Delete all points whose payload[key] == value (used to remove old vectors before re-indexing a file)
    pub async fn delete_by_payload(&self, key: &str, value: &str) -> Result<usize> {
        let mut idx = self.index.lock().await;
        let before = idx.points.len();
        idx.points.retain(|p| {
            p.payload.get(key).map(|v| v.as_str()) != Some(value)
        });
        let removed = before - idx.points.len();
        if removed > 0 {
            *self.dirty.lock().await = true;
        }
        Ok(removed)
    }

    pub async fn delete_by_path_prefix(&self, prefix: &str) -> Result<usize> {
        let mut idx = self.index.lock().await;
        let before = idx.points.len();
        idx.points.retain(|point| {
            point
                .payload
                .get("path")
                .map(|path| {
                    path != prefix
                        && !path.starts_with(&format!("{}/", prefix))
                        && !path.starts_with(&format!("{}\\", prefix))
                })
                .unwrap_or(true)
        });
        let removed = before - idx.points.len();
        if removed > 0 {
            *self.dirty.lock().await = true;
        }
        Ok(removed)
    }

    /// Prune vectors for files that no longer exist on the physical disk
    pub async fn prune_missing_files(&self) -> Result<usize> {
        let mut idx = self.index.lock().await;
        let before = idx.points.len();
        println!("prune_missing_files: Checking {} points...", before);
        
        idx.points.retain(|p| {
            if let Some(path_str) = p.payload.get("path") {
                let exists = std::path::Path::new(path_str).exists();
                if !exists {
                    println!("prune_missing_files: Path missing: {}", path_str);
                }
                exists
            } else {
                false // remove if no path
            }
        });
        
        let removed = before - idx.points.len();
        println!("prune_missing_files: Removed {} ghost points out of {}", removed, before);
        if removed > 0 {
            *self.dirty.lock().await = true;
        }
        Ok(removed)
    }

    /// Add points to the store (buffers writes, call flush() to persist)
    pub async fn upsert(&self, points: Vec<StoredPoint>) -> Result<()> {
        if points.is_empty() {
            return Ok(());
        }

        let mut idx = self.index.lock().await;
        idx.points.extend(points.into_iter().map(|mut point| {
            normalize_in_place(&mut point.vector);
            point
        }));
        *self.dirty.lock().await = true;

        // Auto-flush every 200 points to avoid losing too much on crash
        if idx.points.len() % 200 < 10 {
            self.persist(&idx).await?;
            *self.dirty.lock().await = false;
        }
        Ok(())
    }

    /// Explicitly flush buffered writes to disk
    pub async fn flush(&self) -> Result<()> {
        let dirty = *self.dirty.lock().await;
        if dirty {
            let idx = self.index.lock().await;
            self.persist(&idx).await?;
            *self.dirty.lock().await = false;
        }
        Ok(())
    }

    /// Similarity search over normalized vectors. Since both stored vectors
    /// and query vectors are unit-normalized, cosine similarity reduces to a
    /// simple dot product.
    pub async fn search(&self, query_vector: Vec<f32>, limit: usize) -> Result<Vec<ScoredPoint>> {
        const MIN_SCORE_THRESHOLD: f32 = 0.35;

        let idx = self.index.lock().await;

        if idx.points.is_empty() {
            return Ok(Vec::new());
        }

        let mut query_vector = query_vector;
        if !normalize_in_place(&mut query_vector) {
            return Ok(Vec::new());
        }

        let mut scored: Vec<ScoredPoint> = idx.points.iter().filter_map(|p| {
            let dot: f32 = p.vector.iter().zip(query_vector.iter()).map(|(a, b)| a * b).sum();
            let score = dot;
            if score >= MIN_SCORE_THRESHOLD {
                Some(ScoredPoint {
                    id: p.id,
                    score,
                    payload: p.payload.clone(),
                })
            } else {
                None
            }
        }).collect();

        scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(Ordering::Equal));
        scored.truncate(limit);
        Ok(scored)
    }

    /// Lightweight lexical retrieval over filenames, paths, file types, and
    /// extracted snippets. This complements dense search for exact terms like
    /// symbols, filenames, acronyms, or error strings.
    pub async fn lexical_search(&self, query: &str, limit: usize) -> Vec<ScoredPoint> {
        let idx = self.index.lock().await;
        if idx.points.is_empty() {
            return Vec::new();
        }

        let query = query.trim().to_lowercase();
        if query.is_empty() {
            return Vec::new();
        }

        let tokens = tokenize(&query);
        if tokens.is_empty() {
            return Vec::new();
        }

        let mut scored: Vec<ScoredPoint> = idx
            .points
            .iter()
            .filter_map(|point| {
                let path = point
                    .payload
                    .get("path")
                    .map(|s| s.to_lowercase())
                    .unwrap_or_default();
                let file_type = point
                    .payload
                    .get("file_type")
                    .map(|s| s.to_lowercase())
                    .unwrap_or_default();
                let chunk_text = point
                    .payload
                    .get("chunk_text")
                    .map(|s| s.to_lowercase())
                    .unwrap_or_default();
                let filename = path
                    .rsplit(['/', '\\'])
                    .next()
                    .unwrap_or_default()
                    .to_string();

                let mut score = 0.0;

                if !filename.is_empty() && filename.contains(&query) {
                    score += 8.0;
                }
                if path.contains(&query) {
                    score += 5.0;
                }
                if !chunk_text.is_empty() && chunk_text.contains(&query) {
                    score += 3.5;
                }

                for token in &tokens {
                    if filename.contains(token) {
                        score += 3.0;
                    }
                    if file_type == *token {
                        score += 2.5;
                    }
                    if path.contains(token) {
                        score += 1.5;
                    }
                    if chunk_text.contains(token) {
                        score += 1.2;
                    }
                }

                if score > 0.0 {
                    Some(ScoredPoint {
                        id: point.id,
                        score,
                        payload: point.payload.clone(),
                    })
                } else {
                    None
                }
            })
            .collect();

        scored.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(Ordering::Equal));
        scored.truncate(limit);
        scored
    }

    pub async fn point_count(&self) -> usize {
        self.index.lock().await.points.len()
    }

    /// Returns the maximum point ID in the store, or None if empty.
    /// Used to derive the next safe ID (avoids collisions after deletions).
    pub async fn max_point_id(&self) -> Option<u64> {
        self.index.lock().await.points.iter().map(|p| p.id).max()
    }

    async fn persist(&self, idx: &VectorIndex) -> Result<()> {
        let path = self.storage_path.join("vectors.json");
        let data = serde_json::to_string(idx).context("Failed to serialize vector index")?;
        tokio::fs::write(&path, data).await.context("Failed to write vector index")?;
        Ok(())
    }
}

fn norm(v: &[f32]) -> f32 {
    v.iter().map(|x| x * x).sum::<f32>().sqrt()
}

fn normalize_in_place(v: &mut [f32]) -> bool {
    let magnitude = norm(v);
    if magnitude == 0.0 {
        return false;
    }

    for value in v.iter_mut() {
        *value /= magnitude;
    }

    true
}

fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() {
            current.push(ch);
        } else if !current.is_empty() {
            if current.len() >= 2 {
                tokens.push(std::mem::take(&mut current));
            } else {
                current.clear();
            }
        }
    }

    if current.len() >= 2 {
        tokens.push(current);
    }

    tokens.sort();
    tokens.dedup();
    tokens
}
