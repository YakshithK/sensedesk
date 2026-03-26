use anyhow::Result;
use notify::{
    event::{CreateKind, ModifyKind, RemoveKind, RenameMode},
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc::channel, Arc};
use std::time::Duration;

#[derive(Clone, Debug)]
pub enum WatchAction {
    Upsert(PathBuf),
    Delete(PathBuf),
}

fn classify_event(event: &Event) -> Vec<WatchAction> {
    match &event.kind {
        EventKind::Create(CreateKind::Any | CreateKind::File)
        | EventKind::Modify(ModifyKind::Any | ModifyKind::Data(_) | ModifyKind::Metadata(_)) => {
            event
                .paths
                .iter()
                .filter(|path| path.is_file())
                .cloned()
                .map(WatchAction::Upsert)
                .collect()
        }
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if event.paths.len() >= 2 => {
            vec![
                WatchAction::Delete(event.paths[0].clone()),
                WatchAction::Upsert(event.paths[1].clone()),
            ]
        }
        EventKind::Modify(ModifyKind::Name(_)) => event
            .paths
            .iter()
            .cloned()
            .map(WatchAction::Upsert)
            .collect(),
        EventKind::Remove(RemoveKind::Any | RemoveKind::File) => event
            .paths
            .iter()
            .cloned()
            .map(WatchAction::Delete)
            .collect(),
        _ => Vec::new(),
    }
}

pub fn spawn_fs_watcher(
    roots: Vec<PathBuf>,
    generation: u32,
    generation_counter: Arc<AtomicU32>,
    on_actions: Arc<dyn Fn(Vec<WatchAction>) + Send + Sync + 'static>,
) -> Result<()> {
    std::thread::spawn(move || {
        let (tx, rx) = channel();
        let mut watcher = match RecommendedWatcher::new(tx, Config::default()) {
            Ok(watcher) => watcher,
            Err(error) => {
                eprintln!("Failed to start filesystem watcher: {}", error);
                return;
            }
        };

        for root in &roots {
            if let Err(error) = watcher.watch(root, RecursiveMode::Recursive) {
                eprintln!("Failed to watch {}: {}", root.display(), error);
            }
        }

        let mut pending: HashMap<PathBuf, WatchAction> = HashMap::new();

        while generation_counter.load(Ordering::SeqCst) == generation {
            match rx.recv_timeout(Duration::from_millis(350)) {
                Ok(Ok(event)) => {
                    for action in classify_event(&event) {
                        let path = match &action {
                            WatchAction::Upsert(path) | WatchAction::Delete(path) => path.clone(),
                        };
                        pending.insert(path, action);
                    }
                }
                Ok(Err(error)) => {
                    eprintln!("Watcher event error: {}", error);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if !pending.is_empty() {
                        on_actions(pending.drain().map(|(_, action)| action).collect());
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    Ok(())
}
