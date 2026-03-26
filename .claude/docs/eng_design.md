# Vish — Engineering Design

> **Note:** This document reflects the *as-built* architecture as of v0.6.x. The original design proposed Qdrant + SQLite; the actual implementation replaced both with a simpler custom JSON vector store (no external DB process, no SQLite).

## Stack

**Framework: Tauri v2 (Rust + React/TypeScript)**
- Smaller binary than Electron, real native OS integration, Rust backend handles file I/O and indexing without GIL or Node.js perf limits
- React frontend keeps the UI layer familiar

**Vector DB: Custom In-Memory JSON Store** (`src-tauri/src/store/vector.rs`)
- No external DB process — pure Rust `Vec<StoredPoint>` loaded into RAM from `~/.local/share/vish/vectors/vectors.json`
- Vectors are L2-normalized at load and upsert time; search uses dot product (equivalent to cosine on normalized vectors)
- Auto-flushes to disk every 200 points during indexing; background 5s flush loop via `tokio::spawn` in `main.rs`
- Supports: `upsert`, `search` (dense), `lexical_search` (keyword), `delete_by_payload`, `delete_by_path_prefix`, `prune_missing_files`

**No SQLite** — all metadata lives directly in the vector payload `HashMap<String, String>` with keys: `path`, `file_type`, `chunk_text`

**Embedding: Gemini Embedding 2 via REST**
- Model: `gemini-embedding-2-preview`, 768-d output
- Rust `reqwest` client with exponential backoff on 429s

---

## Repository layout

```
vish/
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── main.rs             # Tauri app entry, command registration, 5s flush loop
│   │   ├── commands.rs         # Tauri #[command] handlers, AppState, indexing logic
│   │   ├── indexer/
│   │   │   ├── mod.rs
│   │   │   ├── crawler.rs      # FS walk, file type detection
│   │   │   ├── extractor.rs    # Text/PDF/image content extraction
│   │   │   ├── chunker.rs      # Token-aware chunking (tiktoken-rs, cl100k_base)
│   │   │   ├── watcher.rs      # notify crate file watcher with debounce + generation counter
│   │   │   ├── scheduler.rs    # (present but minimal; core scheduling is in commands.rs)
│   │   │   └── media.rs        # Media file helpers
│   │   ├── embedding/
│   │   │   ├── mod.rs
│   │   │   ├── client.rs       # Gemini API client, batching, retry/backoff
│   │   │   └── types.rs        # EmbedRequest/Response types
│   │   ├── store/
│   │   │   ├── mod.rs
│   │   │   ├── vector.rs       # Custom JSON vector store (no Qdrant)
│   │   │   ├── metadata.rs     # (present, minimal)
│   │   │   └── migrations/
│   │   └── search/
│   │       └── mod.rs
├── src/                        # React frontend
│   ├── components/
│   │   ├── SearchBar.tsx
│   │   ├── ResultList.tsx
│   │   ├── SetupScreen.tsx
│   │   ├── IndexingScreen.tsx
│   │   ├── VishLogo.tsx
│   │   └── Settings/
│   │       └── SettingsPanel.tsx
│   ├── hooks/
│   │   ├── useSearch.ts
│   │   └── useAppState.ts
│   └── App.tsx
└── Cargo.toml
```

---

## Data model (actual: vector payload)

No SQLite. Each `StoredPoint` carries all metadata in its `payload: HashMap<String, String>`:

| Key | Example | Notes |
|---|---|---|
| `path` | `/home/user/docs/notes.md` | Absolute path to the source file |
| `file_type` | `md`, `jpg`, `pdf` | Lowercase extension |
| `chunk_text` | `"The cosine similarity formula..."` | First 500 chars of chunk (text files); `[JPG file: cat.jpg]` for binary |

Indexer state is tracked in-process via `Arc<AtomicU32>` (`files_done`, `files_total`) and `Arc<Mutex<String>>` (`status`).

Watched roots are persisted to `~/.local/share/vish/indexed-roots.json`.

---

## Core modules

### 1. Crawler (`crawler.rs`)

```rust
use walkdir::WalkDir;
use std::path::PathBuf;

const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "target", "venv", ".venv",
    "__pycache__", "dist", "build", ".cache"
];

const ALLOWED_EXT: &[&str] = &[
    "txt", "md", "rs", "py", "js", "ts", "jsx", "tsx", "go",
    "c", "cpp", "h", "java", "cs", "json", "yaml", "toml",
    "pdf", "docx", "pptx",
    "png", "jpg", "jpeg", "webp",
    "mp4", "mov", "mp3", "wav", "m4a"
];

pub fn crawl(roots: &[PathBuf]) -> impl Iterator<Item = PathBuf> {
    roots.iter().flat_map(|root| {
        WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                !name.starts_with('.') && !SKIP_DIRS.contains(&&*name)
            })
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter(|e| {
                e.path().extension()
                    .and_then(|x| x.to_str())
                    .map(|ext| ALLOWED_EXT.contains(&ext.to_lowercase().as_str()))
                    .unwrap_or(false)
            })
            .map(|e| e.into_path())
    })
}
```

### 2. Extractor (`extractor.rs`)

Per file type, extract what you'll embed:

| File type | Library | Output |
|-----------|---------|--------|
| `.txt`, `.md`, code | raw read | `String` |
| `.pdf` | `pdfium-render` or call `pdftotext` (poppler) via `std::process::Command` | `Vec<String>` per page, cap at 6 pages for Gemini inline |
| `.docx` | `docx-rs` | `String` |
| `.png`/`.jpg` | read bytes, base64 for Gemini | `Vec<u8>` |
| `.mp4`/`.mov` ≤120s | send raw bytes if under limit; else extract keyframes via `ffmpeg` sidecar | bytes or `Vec<image>` |
| `.mp3`/`.wav` | send raw bytes | bytes |

For PDFs > 6 pages: chunk the extracted text instead of using native PDF embed.

### 3. Chunker (`chunker.rs`)

Use `tiktoken-rs` for token counting:

```rust
pub fn chunk_text(text: &str, chunk_tokens: usize, overlap: usize) -> Vec<String> {
    let bpe = tiktoken_rs::cl100k_base().unwrap();
    let tokens = bpe.encode_ordinary(text);
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < tokens.len() {
        let end = (start + chunk_tokens).min(tokens.len());
        let chunk_tokens_slice = &tokens[start..end];
        chunks.push(bpe.decode(chunk_tokens_slice.to_vec()).unwrap());
        if end == tokens.len() { break; }
        start += chunk_tokens - overlap;
    }
    chunks
}
```

### 4. Embedding client (`client.rs`)

```rust
// Gemini multimodal embed — single request structure
#[derive(Serialize)]
struct EmbedRequest {
    model: String,
    content: Content,
    task_type: String,
    output_dimensionality: u32,
}

// Batch multiple files in one call using batchEmbedContents
// POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-exp-03-07:batchEmbedContents

pub async fn batch_embed(
    client: &reqwest::Client,
    api_key: &str,
    requests: Vec<EmbedRequest>,
) -> Result<Vec<Vec<f32>>> {
    // max ~100 requests per batch per Gemini limits
    // chunk into groups of 100, run concurrently with semaphore(4)
}
```

Use a `tokio::sync::Semaphore` to cap concurrent batch calls (user-configurable, default 4). Exponential backoff on 429s.

### 5. Vector store (`vector.rs`)

```rust
// Custom in-memory JSON vector store
// Path: ~/.local/share/vish/vectors/vectors.json
// Vectors: 768-d f32, L2-normalized at load/upsert
// Search: brute-force dot product, threshold 0.35, top-20

pub struct StoredPoint {
    pub id: u64,
    pub vector: Vec<f32>,
    pub payload: HashMap<String, String>,  // path, file_type, chunk_text
}
```

Key operations: `upsert`, `search` (dense), `lexical_search` (keyword/token scoring), `delete_by_payload`, `delete_by_path_prefix`, `prune_missing_files`.

### 6. File watcher (`watcher.rs`)

```rust
use notify::{RecommendedWatcher, RecursiveMode, Watcher, Event};

// Watch all indexed root folders
// Events debounced: accumulate into HashMap<PathBuf, WatchAction> for 350ms
// On timeout flush: fire on_actions callback with deduplicated actions
// Generation counter: watcher exits if counter has advanced (stale watcher cleanup)
```

### 7. Indexer state

No scheduler state machine persisted to disk. State is tracked in-process:
- `files_done: Arc<AtomicU32>` / `files_total: Arc<AtomicU32>` — progress counters
- `status: Arc<Mutex<String>>` — `"idle"` | `"indexing"` | `"done"` | `"error"`
- `sync_status: Arc<Mutex<String>>` — `"idle"` | `"syncing"` (watcher activity)

---

## Search pipeline

```
User query (text)
    ↓
Embed with task_type=RETRIEVAL_QUERY, dim=768
    ↓
Dense: brute-force dot product over all RAM vectors, threshold 0.35, top-20
Lexical: token scan over payload fields (path, file_type, chunk_text)
    ↓
Merge: dense results first, lexical-only appended
    ↓
Return ranked SearchResult[] to frontend
    ↓
Render: snippet / thumbnail, Open / Reveal actions
```

Target: <200ms total after the query embedding returns (~100-200ms for Gemini embed, ~5ms for ANN, ~5ms SQLite join, render instant).

---

## Tauri command surface

These are the `#[tauri::command]` functions your React frontend calls:

```rust
// Indexer
start_indexing(folders: Vec<String>) -> Result<()>
pause_indexing() -> Result<()>
resume_indexing() -> Result<()>
stop_indexing() -> Result<()>
get_indexer_status() -> IndexerStatus  // { status, files_done, files_total, eta_secs }

// Search
search(query: String, filters: SearchFilters) -> Vec<SearchResult>

// Settings
save_settings(settings: AppSettings) -> Result<()>
get_settings() -> AppSettings
get_api_usage() -> ApiUsage  // { tokens_used, estimated_cost_usd }

// File actions
open_file(path: String) -> Result<()>
reveal_in_explorer(path: String) -> Result<()>
```

Use Tauri events (`emit`) for real-time indexer progress from Rust → React.

---

## Key dependencies (`Cargo.toml`)

```toml
[dependencies]
tauri = { version = "2", features = ["shell-open"] }
tokio = { version = "1", features = ["full"] }
reqwest = { version = "0.12", features = ["json"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
# No qdrant-client, no sqlx — custom JSON store only
walkdir = "2"
notify = "6"
tiktoken-rs = "0.5"
base64 = "0.22"
anyhow = "1"
```

Frontend (`package.json`): React 19, Tailwind CSS, `lucide-react`, `@tauri-apps/api`.

---

## Build order / milestones

**Week 1–2: Skeleton**
- Tauri project init, SQLite migrations, basic settings UI with API key input
- Crawler + extractor for txt/md/code only
- Gemini client, single embed call working

**Week 3–4: Full indexer**
- Chunker, batch embed, Qdrant writes
- Indexer state machine (pause/resume), progress events to UI
- PDF and image extraction

**Week 5: Search**
- Search command, result rendering with snippets
- Payload filters (file type, date)

**Week 6: Watcher + polish**
- File watcher + debounced re-index
- API usage counter, cost display
- Crash recovery, error handling

**Week 7+: v1 ship**
- Installer (Tauri's built-in `.msi`/`.exe` bundler)
- Onboarding flow, folder picker UI
- Performance tuning: semaphore tuning, SQLite WAL, Qdrant HNSW params