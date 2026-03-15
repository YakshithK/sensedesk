## 1. Product overview

**Product name (working):** SenseDesk

**One-liner:** A local-first desktop app that indexes your files (documents, code, images, small media) using Gemini Embedding 2 and lets you semantically search your entire workspace. [blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)

**Core idea:**  
On first run, SenseDesk scans user-selected folders (Desktop, Documents, Downloads, Pictures, etc.), extracts content, generates multimodal embeddings with Gemini Embedding 2, and stores them in a local vector database. Subsequent searches embed the user’s query and retrieve relevant files/snippets, regardless of exact keywords. [blog.langformers](https://blog.langformers.com/semantic-search/)

**Target user:**  
Power users / devs / students with messy desktops and lots of files (code, PDFs, notes, screenshots) who want “Spotlight on steroids” with semantic search, not just filename search.

**Primary goals:**

- Make “find that doc/screenshot/snippet I vaguely remember” a 1–2 second operation.  
- Provide a simple install-and-forget indexing experience with low friction.  
- Keep data private (local storage) while using Gemini’s cloud API only for embedding. [ai.google](https://ai.google.dev/api/embeddings)

**Non-goals (v1):**

- No cross-device sync.  
- No collaboration or multi-user support.  
- No on-device embedding model (you rely on Gemini API for v1).

***

## 2. Use cases and user stories

### Core use cases

1. **Find an old document by concept**
   - “Show me that physics notes file where I derived the momentum conservation thing.”  
   - App returns: relevant PDFs/notes with previews of the matching chunks.

2. **Find code by behavior**
   - “Find the function where I parse Kaggle CSVs and do LightGBM CV.”  
   - App returns: code files and specific functions/snippets.

3. **Find images/screenshots by semantics**
   - “Find the screenshot where I compared Tesla and Nvidia charts.”  
   - App returns: screenshot images with quick preview. [solafide](https://solafide.ca/blog/2026-03-gemini-embedding-2-multimodal-embeddings)

4. **Find media snippets**
   - “Find the screen recording where I demoed my 3D printer calibration.”  
   - App returns: short video files or thumbnails whose embeddings are close to the query. [blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)

5. **Combined filters**
   - “Show me PDF documents about reinforcement learning I downloaded in the last 3 months.”

### User stories

- As a user, I want to pick which folders to index so I don’t blow up my Downloads or video library.  
- As a user, I want an initial indexing progress bar and ETA so I know when the system is “ready.”  
- As a user, I want a single search box that “just works” across text/code/images/media.  
- As a user, I want to see why a result matched (highlighted snippet, thumbnail) so I trust the tool.  
- As a user, I want to pause/stop/resume indexing because my laptop might be on battery.  
- As a user, I want to see approximate API usage so I don’t get surprise bills.

***

## 3. Scope and requirements

### 3.1 Functional requirements

#### 3.1.1 Initial indexing

- Allow user to pick folders (default: Desktop, Documents, Downloads, Pictures).  
- Recursive directory traversal with file-type filters and ignore rules:
  - Include: txt, md, json, yaml, docx, pdf (up to N pages), pptx, code files, images (png/jpg), small videos, small audio. [qdrant](https://qdrant.tech/documentation/embeddings/gemini/)
  - Exclude by default: executables, installers, archives, node_modules, build directories, virtual envs, hidden system folders.  
- For each file:
  - Extract plaintext (text/code) or renderable content (PDF pages, images, sample frames from short videos). [blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)
  - Chunk long text into segments (e.g., 500–1,000 tokens per chunk).  
  - Generate embeddings with Gemini Embedding 2 (task_type=RETRIEVAL_DOCUMENT). [ai.google](https://ai.google.dev/api/embeddings)
  - Persist:
    - Vector embedding  
    - Metadata: file path, file name, file type, size, modified time, chunk/page indices, brief text snippet or thumbnail reference.  
- Show:
  - Total files discovered, indexed, skipped.  
  - Estimated remaining time.  
  - Estimated API usage/cost (coarse, e.g., “< 1 USD so far”).

#### 3.1.2 Continuous updates

- Background file watcher:
  - On new file creation/update in indexed paths, schedule re-indexing.  
  - On file deletion/move, mark corresponding vectors as deleted or update paths.
- Throttle updates (batch embedding calls) to:
  - Avoid API spam.  
  - Minimize CPU/disk thrash.

#### 3.1.3 Search

- Single search bar in the desktop app.  
- For each query:
  - Generate text embedding using Gemini Embedding 2 with task_type=RETRIEVAL_QUERY. [qdrant](https://qdrant.tech/documentation/embeddings/gemini/)
  - Execute ANN search (kNN) against local vector DB, returning top N hits (configurable, e.g., 20). [blog.langformers](https://blog.langformers.com/semantic-search/)
- Results list:
  - Show ranked entries with:
    - File name and icon.  
    - Path.  
    - File type.  
    - Relevance score.  
    - For text: short snippet of matched chunk.  
    - For images: thumbnail.  
- Actions:
  - Open file with default system application.  
  - Reveal in file explorer.  
  - Copy path.

#### 3.1.4 Modalities and dimensions

- Supported modalities (v1):
  - Text & code  
  - Images  
  - Small/short video (e.g., ≤120 seconds)  
  - Small/short audio clips [solafide](https://solafide.ca/blog/2026-03-gemini-embedding-2-multimodal-embeddings)
- Embedding model:
  - Use Gemini Embedding 2, which supports text, images, videos (≤120s), audio, PDFs (≤6 pages). [blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)
  - Output dimensionality:
    - Default to 768 or 1536 using Matryoshka Representation Learning to reduce DB size while maintaining quality. [solafide](https://solafide.ca/blog/2026-03-gemini-embedding-2-multimodal-embeddings)
    - Allow advanced users to change dimension (768 / 1536 / 3072) in settings.

#### 3.1.5 Settings and controls

- Folder selection and ignore rules (glob patterns and “ignore this folder” UI).  
- Indexing controls:
  - Start / pause / resume / stop.  
  - Rebuild index from scratch.  
- Performance:
  - Max concurrent embedding requests.  
  - CPU/IO throttle levels (e.g., “low/medium/high impact”).  
- Privacy/API:
  - Display Gemini API key status.  
  - Show approximate cumulative tokens embedded and estimated spend.

### 3.2 Non-functional requirements

- **Performance:**
  - Query latency: target <200 ms for vector search + UI rendering (after embedding completes). [blog.langformers](https://blog.langformers.com/semantic-search/)
  - Embedding latency: hidden behind progress bar; batch requests to reduce overhead. [ai.google](https://ai.google.dev/api/embeddings)
- **Resource usage:**
  - Vector DB should remain within a few GB for typical users when using 768–1536 dims with sane filtering. [solafide](https://solafide.ca/blog/2026-03-gemini-embedding-2-multimodal-embeddings)
- **Reliability:**
  - Indexing must be crash-resilient: partial index is okay, must not corrupt DB.  
  - On restart, app resumes indexing where it left off.
- **Privacy:**
  - All vectors and file metadata live locally on disk.  
  - Only content sent to Gemini API is what you embed; there’s no cloud storage of raw file data beyond transient requests. [ai.google](https://ai.google.dev/api/embeddings)
- **Portability:**
  - Target initially: Windows (and optionally macOS). Linux can be later.  
  - Local DB uses a cross-platform storage path.

***

## 4. System design

### 4.1 High-level components

- **Desktop UI**
  - Built in something like Tauri (Rust + React), Electron, or native platform toolkit.  
  - Features: onboarding, folder selection, search bar, results view, indexing progress, settings.

- **Indexer service**
  - Background process / daemon that:
    - Crawls file system.  
    - Extracts content.  
    - Batches requests to Gemini embedding API. [qdrant](https://qdrant.tech/documentation/embeddings/gemini/)
    - Writes vectors + metadata to local db.

- **Embedding client**
  - Wrapper around Gemini Embedding 2 API:
    - Handles batching (batchEmbedContents). [ai.google](https://ai.google.dev/api/embeddings)
    - Configures task_type and output dimensionality. [blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)
    - Retries on transient errors.
  
- **Vector database**
  - Local engine: Qdrant, Chroma, or similar. [blog.langformers](https://blog.langformers.com/semantic-search/)
  - Stores embeddings and simple metadata keys used as pointers to a separate metadata store or co-located data.

- **Metadata store**
  - Either part of vector DB metadata or separate SQLite:
    - file_id, path, type, size, timestamps  
    - content snippet or thumbnail path  
    - chunk/page/video-frame indices

### 4.2 Data model

- **File**
  - id (UUID)  
  - path  
  - type (doc, code, image, video, audio, pdf, other)  
  - size_bytes  
  - last_modified  
  - created_at (first seen)  

- **Chunk**
  - id (UUID)  
  - file_id  
  - chunk_index / page_index / frame_index  
  - text_excerpt (for text) or thumbnail_path (for images/video)  
  - embedding_vector (in vector DB)  
  - modality (text/image/video/audio)  
  - created_at

- **SearchResult**
  - chunk_id  
  - file_id  
  - score  
  - rank

***

## 5. Gemini Embedding 2 specifics

- Use Gemini Embedding 2 as described by Google:
  - Single shared space for text, images, video, audio, and documents. [solafide](https://solafide.ca/blog/2026-03-gemini-embedding-2-multimodal-embeddings)
  - Up to 8,192 tokens input context for text. [blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)
  - Up to 6 images and up to 120 seconds of video per request. [blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)
  - PDF support up to 6 pages per embed call. [blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)
- Matryoshka Representation Learning:
  - Start with 3,072-d output, then truncate to 1,536 or 768 dims for storage. [solafide](https://solafide.ca/blog/2026-03-gemini-embedding-2-multimodal-embeddings)
  - Recommended: 768 or 1,536 for personal search; 3,072 only if you’re obsessed with top-end quality. [solafide](https://solafide.ca/blog/2026-03-gemini-embedding-2-multimodal-embeddings)
- API integration:
  - Use appropriate task_type: RETRIEVAL_DOCUMENT for indexing, RETRIEVAL_QUERY for search queries. [qdrant](https://qdrant.tech/documentation/embeddings/gemini/)

***

## 6. Indexing strategy

### 6.1 Text / code

- Extract plain text using:
  - Built-in libraries (docx, pdf), external tools (poppler, etc.).  
- Normalize:
  - Strip boilerplate, convert to UTF-8, remove huge binary blobs.  
- Chunk:
  - Chunk size ~500–1,000 tokens, overlap ~100–200 tokens to maintain context.  
- Each chunk → one embedding.

### 6.2 Images

- One image file → one embedding.  
- Store thumbnail in local cache for fast preview.

### 6.3 Video

- Only index:
  - Short clips (≤120s) or selected segments. [blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)
- Strategy:
  - Sample keyframes (e.g., 1 per 2–5 seconds) or treat the whole clip as one embed if short and Gemini supports it within video constraints. [blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)
- Store:
  - Thumbnail per sampled frame; choose highest-scoring frame as “representative” for display.

### 6.4 Audio

- Only index:
  - Short recordings (e.g., notes, meetings under some duration). [blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)
- One clip → one embedding, store a short transcript if you later add ASR (v2 feature).

***

## 7. Search experience

- Query input:
  - Text box, supports natural language queries.  
- Optional filters:
  - File type (doc/code/image/video/audio).  
  - Date range.  
  - Folder path.  
- Ranking:
  - Pure vector similarity (cosine) initially. [blog.langformers](https://blog.langformers.com/semantic-search/)
  - Secondary sort by recency or file type weight.

- Result presentation:
  - Basic list:
    - Icon, name, path.  
    - Snippet/thumbnail.  
    - “Open” and “Reveal in Explorer” buttons.  
  - Optional detail pane:
    - Shows more context (surrounding text chunk, bigger image preview).

***

## 8. Privacy, security, and billing

- All embeddings + metadata stored locally only (vector DB + SQLite).  
- Gemini API:
  - Only content required for embedding is sent, no permanent remote storage described for this use case. [ai.google](https://ai.google.dev/api/embeddings)
- User must input their Gemini API key; app never sends it to any third-party server.  
- Billing transparency:
  - Show an approximate counter of “tokens processed” and estimated dollar cost using current Gemini Embedding 2 price. [ai.google](https://ai.google.dev/api/embeddings)

***

## 9. Risks and tradeoffs

- **API dependency:** If Gemini API is down, you can’t index or embed queries (you can still search existing vectors but not embed new queries unless you cache query embeddings). [ai.google](https://ai.google.dev/api/embeddings)
- **Cost drift:** If Google changes pricing, heavy users could see higher bills; need a “hard cap” option in settings. [blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)
- **Indexing time:** On big disks, initial crawl might be hours; you must keep UX clear about progress and make it cancellable.  
- **Noise:** If you don’t aggressively filter garbage (build artifacts, deps, large media), search quality drops.

***

## 10. v1 vs later versions

### v1 (MVP)

- Windows desktop app.  
- Text/code/PDFs + images.  
- Initial indexing, basic continuous updates.  
- Text-only query.  
- Basic filters (file type, date).  
- No RLHF or re-ranking, just vector similarity.

### v2+

- Mac and Linux support.  
- Richer media handling for video/audio. [blog](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-embedding-2/)
- Image/audio query support. [solafide](https://solafide.ca/blog/2026-03-gemini-embedding-2-multimodal-embeddings)
- Rerank step using an LLM on top of retrieved candidates.  
- On-device partial model for offline low-quality embeddings (fallback mode).