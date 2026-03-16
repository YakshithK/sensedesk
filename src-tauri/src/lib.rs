mod commands;
mod store;
mod indexer;

use std::sync::Arc;
use sqlx::SqlitePool;
use tauri::Manager;
use crate::store::vector::VectorStore;
use crate::indexer::embedding::client::EmbeddingClient;

pub struct AppState {
    pool: Arc<SqlitePool>,
    vector_store: Arc<VectorStore>,
    embedding_client: Arc<EmbeddingClient>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())    .plugin(tauri_plugin_dialog::init())    .invoke_handler(tauri::generate_handler![
      commands::get_settings,
      commands::save_settings,
      commands::search,
      commands::start_indexing
    ])
    .setup(|app| {
      // Initialize database
      let pool = tauri::async_runtime::block_on(async {
        store::init_db().await.expect("Failed to init DB")
      });
      let vector_store = Arc::new(VectorStore::new());
      // For now, placeholder API key - in real app, get from settings
      let api_key = std::env::var("GEMINI_API_KEY").unwrap_or_else(|_| {
          eprintln!("Warning: GEMINI_API_KEY not set, using placeholder - embeddings will fail!");
          "placeholder".to_string()
      });
      let embedding_client = Arc::new(EmbeddingClient::new(api_key, 4));
      app.manage(AppState { pool: Arc::new(pool), vector_store, embedding_client });
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
