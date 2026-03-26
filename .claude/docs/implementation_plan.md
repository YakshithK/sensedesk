# Implementation Plan: Vish

> **Historical note:** This was the original implementation plan. The actual build diverged: Qdrant and SQLite were replaced with a custom JSON vector store. Treat this as a design artifact, not a live spec.

**Goal**: Build a local-first desktop application using Tauri (Rust + React) that indexes user files (documents, code, images, small media) using Gemini Embedding 2. It will allow instantaneous semantic search over personal data using a local vector store.

## Proposed Changes

### Project Initialization & Architecture Layout
- Scaffold Tauri application with React + TypeScript frontend (`npm create tauri-app@latest`).
- Configure `Cargo.toml` with dependencies (`qdrant-client`, `sqlx`, `walkdir`, `notify`, `tiktoken-rs`, `reqwest`, `tokio`).
- Set up SQLite schemas via `sqlx` (tables: `files`, `chunks`, `indexer_state`, `api_usage`).

### Phase 1: Core Extractor & Embedder
- **Crawler**: Walk directory trees avoiding ignore-listed directories using `walkdir` (`src-tauri/src/indexer/crawler.rs`).
- **Text & Code Processing**: Read raw text and chunk to 500–1000 tokens using `tiktoken-rs` (`src-tauri/src/indexer/chunker.rs`).
- **Gemini Client**: Implement `reqwest` based REST client for Gemini REST API (`batchEmbedContents`). Implement batching and retry mechanisms (`src-tauri/src/embedding/client.rs`).

### Phase 2: Storage & Indexing Engine
- **Local DB Wrappers**: Implement `qdrant-client` driver logic to push and filter 768-D embeddings (`src-tauri/src/store/vector.rs`). Write metadata attributes to SQLite (`src-tauri/src/store/metadata.rs`).
- **Indexer State Machine**: Manage `Idle` -> `Running` -> `Paused` statuses. Dispatch progress updates to the UI via Tauri WebContents events (`src-tauri/src/indexer/scheduler.rs`).

### Phase 3: Semantic Search Functionality
- **Query Parser**: Pass user query sequentially to Gemini Embedding (`task_type="RETRIEVAL_QUERY"`) -> Qdrant (Cosine Similarity ANN) -> SQLite (Rehydration/Join) -> Front-End React.
- **Search UI**: Build `SearchBar.tsx` and `ResultList.tsx`. Incorporate snippets + icons dynamically for hits. Add Tauri Native OS integrations (Open file, Reveal in Explorer).

### Phase 4: Media & Dynamic Updates
- **File System Watcher**: Integrate `notify` rust crate. Accumulate FS mutations and trigger debounced re-indexes.
- **PDF & Image Extraction**: Incorporate `pdfium-render` (or fallback poppler child processes) for PDF text extraction. Send Image Base64 payloads directly to Gemini API.

## Verification Plan

### Automated Tests
1. **Unit Testing (Rust)**:
   - `cargo test --package indexer` to verify chunking overlaps behavior safely on edge cases.
   - Mocking `reqwest` calls for the Gemini Client ensuring rate limiting and batching thresholds are respected.
2. **Database Integrity**:
   - Validation script inserting/removing dummy records verifying that `sqlx` migrations run smoothly and Qdrant synchronization does not corrupt during edge removals.

### Manual Verification
1. **End-to-End Workflow Validation**:
   - `npm run tauri dev`
   - Bind to a test folder housing `.txt`, `.rs`, [.md](file:///home/yakshith/sensedesk/README.md), `.pdf`, and `.png` files.
   - Initiate manual indexing. Verify progress bar accuracy and API token usage statistics increment correctly compared to real usage.
   - Test "pause/resume" indexing behavior gracefully continues.
2. **Search Verification**:
   - Type a semantic concept ("e.g. login function authentication") and ensure it accurately ranks the correct code file.
   - Validate that double-clicking opens the matched file externally.
