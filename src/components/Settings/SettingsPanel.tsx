import { DragEvent, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderPlus, RefreshCw, Trash2, Upload, X } from "lucide-react";

interface SettingsPanelProps {
  onClose?: () => void;
  onReindex: () => void;
}

export function SettingsPanel({ onClose, onReindex }: SettingsPanelProps) {
  const [roots, setRoots] = useState<string[]>([]);
  const [newRoot, setNewRoot] = useState("");
  const [syncStatus, setSyncStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const syncStatusLabel = useMemo(() => {
    if (syncStatus === "syncing") {
      return "Applying changes";
    }
    if (syncStatus === "idle") {
      return "Watching";
    }
    return syncStatus;
  }, [syncStatus]);

  const loadRoots = async () => {
    try {
      const nextRoots = await invoke<string[]>("get_indexed_roots");
      setRoots(nextRoots);
    } catch (loadError) {
      setError(String(loadError));
    }
  };

  useEffect(() => {
    loadRoots();
    const interval = window.setInterval(async () => {
      try {
        const status = await invoke<string>("get_sync_status");
        setSyncStatus(status);
      } catch {
        // Ignore transient polling failures in the modal.
      }
    }, 1000);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onClose) {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const handleAdd = async () => {
    if (!newRoot.trim()) {
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      await invoke("add_indexed_root", { path: newRoot.trim() });
      setNewRoot("");
      await loadRoots();
    } catch (addError) {
      setError(String(addError));
    } finally {
      setIsBusy(false);
    }
  };

  const addPaths = (paths: string[]) => {
    const nextPath = paths.find((path) => path.trim());
    if (!nextPath) {
      return;
    }

    setNewRoot(nextPath);
    void (async () => {
      setIsBusy(true);
      setError(null);
      try {
        await invoke("add_indexed_root", { path: nextPath.trim() });
        setNewRoot("");
        await loadRoots();
      } catch (addError) {
        setError(String(addError));
      } finally {
        setIsBusy(false);
      }
    })();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragOver(false);

    const paths: string[] = [];
    const items = event.dataTransfer.items;

    if (items) {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item.kind !== "file") {
          continue;
        }

        const file = item.getAsFile();
        const path = (file as File & { path?: string | null })?.path;
        if (path) {
          paths.push(path);
        }
      }
    }

    if (paths.length === 0) {
      for (const file of Array.from(event.dataTransfer.files)) {
        const path = (file as File & { path?: string | null })?.path;
        if (path) {
          paths.push(path);
        }
      }
    }

    addPaths(paths);
  };

  const handleRemove = async (path: string) => {
    setIsBusy(true);
    setError(null);
    try {
      await invoke("remove_indexed_root", { path });
      await loadRoots();
    } catch (removeError) {
      setError(String(removeError));
    } finally {
      setIsBusy(false);
    }
  };

  const handleReset = async () => {
    if (!confirmingReset) {
      setConfirmingReset(true);
      return;
    }

    setIsBusy(true);
    setError(null);
    try {
      await invoke("reset_index");
      onReindex();
    } catch (resetError) {
      setError(String(resetError));
      setIsBusy(false);
    }
  };

  return (
    <div className="settings-overlay animate-fade-in" onClick={onClose}>
      <div
        className="settings-modal glass-surface-strong"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="index-manager-title"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="mono-ui text-xs uppercase tracking-[0.24em] text-[var(--text-dim)]">
              index manager
            </p>
            <h2
              id="index-manager-title"
              className="inter-ui mt-2 text-[1.9rem] font-semibold tracking-tight text-[var(--text-main)]"
            >
              Manage Indexed Directories
            </h2>
            <p className="mt-3 max-w-[32rem] text-[0.98rem] leading-7 text-[var(--text-soft)]">
              Add folders Vish should watch, remove ones you no longer need, or reset the index
              entirely.
            </p>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="glass-surface flex h-11 w-11 items-center justify-center rounded-2xl text-[var(--text-main)]"
              aria-label="Close index manager"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="settings-modal-note mt-6 rounded-[1.35rem] px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="inter-ui text-sm font-semibold text-[var(--text-main)]">Background Sync</p>
            <span className="mono-ui text-xs uppercase tracking-[0.22em] text-[var(--text-soft)]">
              {syncStatusLabel}
            </span>
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--text-soft)]">
            Vish watches your indexed roots and applies file creates, edits, and deletions automatically.
          </p>
        </div>

        <div className="mt-6">
          <p className="inter-ui text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-main)]/88">
            Indexed Roots
          </p>
          <div className="settings-roots-list mt-3">
            {roots.length === 0 ? (
              <div className="glass-surface rounded-[1.25rem] px-4 py-4 text-sm text-[var(--text-soft)]">
                No indexed directories yet.
              </div>
            ) : (
              roots.map((root) => (
                <div
                  key={root}
                  className="glass-surface flex items-center justify-between gap-3 rounded-[1.25rem] px-4 py-3"
                >
                  <span className="mono-ui min-w-0 truncate text-sm text-[var(--text-main)]">
                    {root}
                  </span>
                  <button
                    onClick={() => handleRemove(root)}
                    disabled={isBusy}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[var(--text-soft)] transition hover:bg-white/8 hover:text-white disabled:opacity-50"
                    aria-label={`Remove ${root}`}
                    type="button"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="mt-6">
          <p className="inter-ui text-sm font-semibold uppercase tracking-[0.14em] text-[var(--text-main)]/88">
            Add Directory
          </p>
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
            className={`settings-dropzone glass-surface mt-3 rounded-[1.35rem] px-5 py-5 text-center transition ${
              isDragOver ? "settings-dropzone-active" : ""
            }`}
          >
            <div className="settings-dropzone-icon">
              <Upload className="h-4 w-4" />
            </div>
            <p className="inter-ui mt-3 text-sm font-semibold tracking-tight text-[var(--text-main)]">
              Drop a folder here to add it instantly
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--text-soft)]">
              Manual entry still works below if you prefer to paste an absolute path.
            </p>
          </div>
          <div className="mt-3 flex flex-col gap-3 md:flex-row">
            <input
              value={newRoot}
              onChange={(event) => setNewRoot(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  handleAdd();
                }
              }}
              placeholder="/path/to/your/folder"
              className="setup-directory-input glass-surface mono-ui h-14 flex-1 rounded-2xl px-5 text-base outline-none"
            />
            <button
              onClick={handleAdd}
              disabled={isBusy}
              className="glass-surface inter-ui flex h-14 items-center justify-center gap-2 rounded-2xl px-6 text-base font-medium text-[var(--text-main)] disabled:opacity-50"
              type="button"
            >
              <FolderPlus className="h-4 w-4" />
              Add
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-5 rounded-2xl border border-red-200/30 bg-red-400/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <div className="mt-7 flex flex-col-reverse gap-3 border-t border-white/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={handleReset}
            disabled={isBusy}
            className={`inter-ui rounded-2xl px-5 py-3 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
              confirmingReset
                ? "bg-[rgba(255,132,120,0.92)] text-[rgba(31,14,14,0.92)] shadow-[0_0_24px_rgba(255,132,120,0.24)]"
                : "glass-surface text-[var(--text-main)]"
            }`}
            type="button"
          >
            <span className="flex items-center justify-center gap-2">
              <RefreshCw className={`h-4 w-4 ${isBusy ? "animate-spin" : ""}`} />
              {confirmingReset ? "Confirm Reset Index" : "Reset Index"}
            </span>
          </button>

          <div className="flex justify-end gap-3">
            <button
              onClick={() => setConfirmingReset(false)}
              className="inter-ui text-sm text-[var(--text-soft)] transition hover:text-white"
              type="button"
            >
              {confirmingReset ? "Keep Current Index" : ""}
            </button>
            <button
              onClick={onClose}
              className="glass-surface inter-ui rounded-2xl px-5 py-3 text-base font-medium text-[var(--text-main)]"
              type="button"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
