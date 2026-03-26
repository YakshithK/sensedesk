// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

pub mod indexer;
pub mod embedding;
pub mod store;
pub mod search;
pub mod commands;

use tauri::Manager;

fn main() {
    // Use the app's local data directory for storing vectors
    let data_dir = dirs::data_local_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("vish");

    let app_state = commands::AppState::new(data_dir);

    tauri::Builder::default()
        .manage(app_state)
        .setup(|app| {
            let state = app.state::<commands::AppState>();
            commands::bootstrap_watchers(state.inner());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_api_key,
            commands::get_api_key,
            commands::check_index_exists,
            commands::get_point_count,
            commands::start_indexing,
            commands::get_indexed_roots,
            commands::add_indexed_root,
            commands::remove_indexed_root,
            commands::reset_index,
            commands::get_sync_status,
            commands::pause_indexing,
            commands::resume_indexing,
            commands::stop_indexing,
            commands::get_indexer_status,
            commands::search,
            commands::open_file,
            commands::reveal_in_explorer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
