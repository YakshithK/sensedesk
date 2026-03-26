use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const SKIP_DIRS: &[&str] = &[
    "node_modules", ".git", "target", "venv", ".venv",
    "__pycache__", "dist", "build", ".cache", ".next", ".svelte-kit"
];

const ALLOWED_EXT: &[&str] = &[
    "txt", "md", "rs", "py", "js", "ts", "jsx", "tsx", "go",
    "c", "cpp", "h", "java", "cs", "json", "yaml", "yml", "toml",
    "pdf", "docx", "pptx",
    "png", "jpg", "jpeg", "webp",
    "mp4", "mov", "mp3", "wav", "m4a"
];

pub fn is_allowed_file(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };

    if file_name.starts_with('.') {
        return false;
    }

    path.extension()
        .and_then(|x| x.to_str())
        .map(|ext| ALLOWED_EXT.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Recursively crawls provided root paths and yields matching files.
pub fn crawl(roots: &[PathBuf]) -> impl Iterator<Item = PathBuf> {
    roots.iter().flat_map(|root| {
        WalkDir::new(root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                let name = e.file_name().to_string_lossy();
                // Skip hidden folders or directories we want to ignore
                (!name.starts_with('.') || name == ".") && 
                !SKIP_DIRS.contains(&&*name)
            })
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| {
                let path = e.path().to_owned();
                if is_allowed_file(&path) {
                    Some(e.into_path())
                } else {
                    None
                }
            })
    }).collect::<Vec<_>>().into_iter() // Collect immediately to satisfy Iterator bounds simply for now
}
