use anyhow::{Context, Result};
use reqwest::{Client, StatusCode};
use std::time::Duration;
use tokio::time::sleep;

use super::types::{BatchEmbedRequest, BatchEmbedResponse, EmbedRequest, Content, Part, InlineData};

const GEMINI_MODEL: &str = "models/gemini-embedding-2-preview";
const GEMINI_EMBED_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:batchEmbedContents";
const EMBED_DIMENSION: u32 = 768;

/// Build an EmbedRequest for a text chunk (used during indexing)
pub fn make_text_request(text: &str, title: Option<&str>) -> EmbedRequest {
    EmbedRequest {
        model: GEMINI_MODEL.to_string(),
        content: Content {
            parts: vec![Part {
                text: Some(text.to_string()),
                inline_data: None,
            }],
        },
        task_type: "RETRIEVAL_DOCUMENT".to_string(),
        output_dimensionality: EMBED_DIMENSION,
        title: title.map(|t| t.to_string()),
    }
}

/// Build an EmbedRequest for a binary file (PDF, image, etc.)
pub fn make_binary_request(base64_data: &str, mime_type: &str, title: Option<&str>) -> EmbedRequest {
    let mut parts = Vec::new();
    
    if let Some(t) = title {
        parts.push(Part {
            text: Some(format!("File: {}", t)),
            inline_data: None,
        });
    }

    parts.push(Part {
        text: None,
        inline_data: Some(InlineData {
            mime_type: mime_type.to_string(),
            data: base64_data.to_string(),
        }),
    });

    EmbedRequest {
        model: GEMINI_MODEL.to_string(),
        content: Content { parts },
        task_type: "RETRIEVAL_DOCUMENT".to_string(),
        output_dimensionality: EMBED_DIMENSION,
        title: title.map(|t| t.to_string()),
    }
}

/// Build an EmbedRequest for a search query
pub fn make_query_request(query: &str) -> EmbedRequest {
    EmbedRequest {
        model: GEMINI_MODEL.to_string(),
        content: Content {
            parts: vec![Part {
                text: Some(query.to_string()),
                inline_data: None,
            }],
        },
        task_type: "RETRIEVAL_QUERY".to_string(),
        output_dimensionality: EMBED_DIMENSION,
        title: None,
    }
}

/// Batch embed multiple requests. Returns one Vec<f32> per input request.
pub async fn batch_embed(
    client: &Client,
    api_key: &str,
    requests: Vec<EmbedRequest>,
) -> Result<Vec<Vec<f32>>> {
    if requests.is_empty() {
        return Ok(Vec::new());
    }

    let url = format!("{}?key={}", GEMINI_EMBED_URL, api_key);
    let payload = BatchEmbedRequest { requests };

    let mut retries = 0;
    let max_retries = 3;

    loop {
        let response = client
            .post(&url)
            .json(&payload)
            .send()
            .await?;

        let status = response.status();
        
        if status.is_success() {
            let body: BatchEmbedResponse = response.json().await.context("Failed to parse Gemini embedding response")?;
            return Ok(body.embeddings.into_iter().map(|e| e.values).collect());
        }

        if status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error() {
            if retries >= max_retries {
                anyhow::bail!("Gemini API failed after {} retries: {}", retries, status);
            }
            retries += 1;
            sleep(Duration::from_secs(2_u64.pow(retries))).await;
            continue;
        }

        let err_body = response.text().await.unwrap_or_default();
        anyhow::bail!("Gemini API error {}: {}", status, err_body);
    }
}

/// Embed a single text query (convenience wrapper)
pub async fn embed_query(client: &Client, api_key: &str, query: &str) -> Result<Vec<f32>> {
    let req = make_query_request(query);
    let mut results = batch_embed(client, api_key, vec![req]).await?;
    results.pop().context("Empty embedding response from Gemini")
}
