use serde::{Deserialize, Serialize};

#[derive(Serialize, Clone)]
pub struct EmbedRequest {
    pub model: String,
    pub content: Content,
    pub task_type: String,
    pub output_dimensionality: Option<u32>,
}

#[derive(Serialize, Clone)]
pub struct Content {
    pub parts: Vec<Part>,
}

#[derive(Serialize, Clone)]
pub struct Part {
    pub text: Option<String>,
    // For multimodal, add image/video etc., but for now text
}

#[derive(Deserialize)]
pub struct EmbedResponse {
    pub embedding: Embedding,
}

#[derive(Deserialize)]
pub struct Embedding {
    pub values: Vec<f32>,
}

// For batch
#[derive(Serialize, Clone)]
pub struct BatchEmbedRequest {
    pub requests: Vec<EmbedRequest>,
}

#[derive(Deserialize)]
pub struct BatchEmbedResponse {
    pub embeddings: Vec<EmbedResponse>,
}