# SenseDesk — Engineering Design

## Stack decision upfront

**Framework: Tauri v2 (Rust + React/TypeScript)**
- Smaller binary than Electron, real native OS integration, Rust backend handles file I/O and indexing without GIL or Node.js perf limits
- Tauri's sidecar API lets you run a Python/Rust subprocess for the indexer if needed
- React frontend keeps the UI layer familiar

**Vector DB: Qdrant (embedded mode)**
- Runs in-process via `qdrant` Rust crate — no separate server process
- Supports payload filtering (file type, date, folder) natively on top of ANN search
- Matryoshka-aware: store 3072-d, search with truncated 768-d vector

**Metadata: SQLite via `sqlx` (Rust)**
- Separate from Qdrant; stores file records, chunk records, indexer state, API usage counters
- WAL mode for crash resilience

**Embedding: Gemini Embedding 2 via REST**
- `gemini-embedding-exp-03-07` or `text-embedding-004` until Embedding 2 GA
- Rust `reqwest` client with retry/backoff

---

## Repository layout

```
sensedesk/
├── src-tauri/                  # Rust backend
│   ├── src/
│   │   ├── main.rs             # Tauri app entry, command registration
│   │   ├── indexer/
│   │   │   ├── mod.rs
│   │   │   ├── crawler.rs      # FS walk, file type detection
│   │   │   ├── extractor.rs    # Text/PDF/image content extraction
│   │   │   ├── chunker.rs      # Token-aware chunking
│   │   │   ├── watcher.rs      # notify crate file watcher
│   │   │   └── scheduler.rs   # Batch queue + throttle
│   │   ├── embedding/
│   │   │   ├── mod.rs
│   │   │   ├── client.rs       # Gemini API client, batching, retry
│   │   │   └── types.rs        # EmbedRequest/Response types
│   │   ├── store/
│   │   │   ├── mod.rs
│   │   │   ├── vector.rs       # Qdrant wrapper
│   │   │   ├── metadata.rs     # SQLite schema + queries
│   │   │   └── migrations/
│   │   ├── search/
│   │   │   └── mod.rs          # Query embed → ANN → merge with metadata
│   │   └── commands.rs         # Tauri #[command] handlers exposed to frontend
├── src/                        # React frontend
│   ├── components/
│   │   ├── SearchBar.tsx
│   │   ├── ResultList.tsx
│   │   ├── ResultCard.tsx
│   │   ├── IndexProgress.tsx
│   │   └── Settings/
│   ├── hooks/
│   │   ├── useSearch.ts
│   │   └── useIndexerStatus.ts
│   └── App.tsx
└── Cargo.toml
```

---

## Data model (SQLite)

```sql
CREATE TABLE files (
  id          TEXT PRIMARY KEY,  -- UUID
  path        TEXT UNIQUE NOT NULL,
  file_type   TEXT NOT NULL,     -- 'pdf' | 'code' | 'image' | 'docx' | ...
  size_bytes  INTEGER,
  modified_at INTEGER,           -- Unix timestamp
  indexed_at  INTEGER,
  status      TEXT DEFAULT 'pending'  -- pending | indexed | failed | deleted
);

CREATE TABLE chunks (
  id            TEXT PRIMARY KEY,
  file_id       TEXT REFERENCES files(id) ON DELETE CASCADE,
  chunk_index   INTEGER,
  modality      TEXT,            -- 'text' | 'image' | 'video'
  text_excerpt  TEXT,            -- NULL for images
  thumbnail_path TEXT,           -- NULL for text
  qdrant_point_id TEXT UNIQUE,   -- UUID stored in Qdrant
  created_at    INTEGER
);

CREATE TABLE indexer_state (
  key   TEXT PRIMARY KEY,
  value TEXT
);
-- e.g. key='status' value='paused' | 'running' | 'idle'
-- key='tokens_used' value='3820500'

CREATE TABLE api_usage (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ts         INTEGER,
  tokens     INTEGER,
  cost_usd   REAL
);
```

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
// Qdrant collection setup
// Collection name: "sensedesk"
// Vector config: size=3072 (store full), distance=Cosine
// On search: pass named vector or truncate to 768

// Each point payload:
{
  "chunk_id": "...",
  "file_id": "...",
  "file_type": "pdf",
  "path": "/Users/.../notes.pdf",
  "modified_at": 1710000000,
  "modality": "text"
}
```

Search with payload filtering:
```rust
// Filter example: PDFs modified in last 90 days
Filter {
    must: vec![
        Condition::field("file_type").matches("pdf"),
        Condition::field("modified_at").range(since_90_days, now),
    ]
}
```

### 6. File watcher (`watcher.rs`)

```rust
use notify::{RecommendedWatcher, RecursiveMode, Watcher, Event};

// Watch all indexed root folders
// On Create/Modify → push path to a bounded channel (cap 1000)
// Scheduler drains channel, deduplicates paths, waits 5s after last event
// (debounce) before triggering re-index of that file
```

### 7. Indexer scheduler (`scheduler.rs`)

State machine:
```
Idle → Running → (Paused ↔ Running) → Idle
```

Persists `status`, `current_file_index`, `total_files` in `indexer_state` table so on crash/restart it resumes from roughly where it left off.

---

## Search pipeline

```
User query (text)
    ↓
Embed with task_type=RETRIEVAL_QUERY, dim=768
    ↓
Qdrant ANN search, top_k=20, with optional payload filter
    ↓
Fetch chunk records from SQLite by qdrant_point_id
    ↓
Join with file records (path, type, modified_at)
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
reqwest = { version = "0.12", features = ["json", "multipart"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
sqlx = { version = "0.7", features = ["sqlite", "runtime-tokio", "migrate"] }
qdrant-client = "1.9"
walkdir = "2"
notify = "6"
tiktoken-rs = "0.5"
uuid = { version = "1", features = ["v4"] }
base64 = "0.22"
anyhow = "1"
tracing = "0.1"
tracing-subscriber = "0.3"
```

Frontend (`package.json`): React 18, TanStack Query (for search/status), Tailwind, Radix UI primitives, `@tauri-apps/api`.

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