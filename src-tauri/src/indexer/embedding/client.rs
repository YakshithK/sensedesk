use super::types::{BatchEmbedRequest, BatchEmbedResponse, EmbedRequest, Content, Part};
use reqwest::Client;
use tokio::sync::Semaphore;
use std::sync::Arc;

pub struct EmbeddingClient {
    client: Client,
    api_key: String,
    semaphore: Arc<Semaphore>,
}

impl EmbeddingClient {
    pub fn new(api_key: String, max_concurrent: usize) -> Self {
        Self {
            client: Client::new(),
            api_key,
            semaphore: Arc::new(Semaphore::new(max_concurrent)),
        }
    }

    pub async fn batch_embed(
        &self,
        requests: Vec<EmbedRequest>,
    ) -> Result<Vec<Vec<f32>>, Box<dyn std::error::Error + Send + Sync>> {
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key={}",
            self.api_key
        );

        // Chunk into batches of 100 as per Gemini limits
        let batch_size = 100;
        let mut all_embeddings = Vec::new();

        for (batch_idx, chunk) in requests.chunks(batch_size).enumerate() {
            println!("[embed] sending batch {} ({} requests)", batch_idx + 1, chunk.len());
            let _permit = self.semaphore.acquire().await?;
            let batch_req = BatchEmbedRequest {
                requests: chunk.to_vec(),
            };

            let response = self.client
                .post(&url)
                .json(&batch_req)
                .send()
                .await?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                eprintln!("[embed] API error {}: {}", status, body);
                return Err(format!("API error: {}", status).into());
            }

            let batch_resp: BatchEmbedResponse = response.json().await?;
            let embeddings: Vec<Vec<f32>> = batch_resp.embeddings.into_iter().map(|e| e.embedding.values).collect();
            println!("[embed] received {} embeddings", embeddings.len());
            all_embeddings.extend(embeddings);
        }

        Ok(all_embeddings)
    }

    // For single embed, but we'll use batch
    pub async fn embed_text(&self, text: &str, task_type: &str) -> Result<Vec<f32>, Box<dyn std::error::Error + Send + Sync>> {
        println!("[embed] embedding text (len={} task={})", text.len(), task_type);
        let request = EmbedRequest {
            model: "text-embedding-004".to_string(),
            content: Content {
                parts: vec![Part {
                    text: Some(text.to_string()),
                }],
            },
            task_type: task_type.to_string(),
            output_dimensionality: Some(768), // As per PRD, start with 768
        };

        let embeddings = self.batch_embed(vec![request]).await?;
        let first = embeddings.into_iter().next().unwrap();
        println!("[embed] embedding returned len={}", first.len());
        Ok(first)
    }
}