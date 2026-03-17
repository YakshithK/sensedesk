import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderOpen, ArrowRight, Sparkles } from "lucide-react";

interface SetupScreenProps {
  onStartIndexing: () => void;
}

export function SetupScreen({ onStartIndexing }: SetupScreenProps) {
  const [folderPath, setFolderPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleStartIndexing = async () => {
    if (!folderPath.trim()) {
      setError("Please enter a folder path to index.");
      return;
    }
    try {
      setIsLoading(true);
      setError(null);
      await invoke("start_indexing", { folders: [folderPath.trim()] });
      onStartIndexing();
    } catch (e: any) {
      setError(e.toString());
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 relative overflow-hidden">
      {/* Background gradient orbs */}
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-primary/10 blur-[120px] animate-float" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full bg-accent/8 blur-[100px] animate-float" style={{ animationDelay: "1.5s" }} />

      <div className="animate-fade-in-up z-10 flex flex-col items-center max-w-md w-full">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-accent flex items-center justify-center mb-4 shadow-lg shadow-primary/25">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-4xl font-bold gradient-text tracking-tight">Vish</h1>
          <p className="text-muted-foreground text-sm mt-2">Semantic search for your desktop</p>
        </div>

        {/* Folder Selection Card */}
        <div className="w-full glass-strong rounded-2xl p-6 shadow-2xl">
          <div className="animate-fade-in">
            <div className="flex items-center gap-2 mb-4">
              <FolderOpen className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Choose a folder to index</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Enter the full path to the folder you want to search through. All files will be indexed using AI embeddings.
            </p>
            <input
              type="text"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleStartIndexing()}
              placeholder="/home/user/documents"
              className="w-full px-4 py-3 rounded-xl border border-border bg-background/50 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all text-sm font-mono"
              autoFocus
            />
            <button
              onClick={handleStartIndexing}
              disabled={isLoading}
              className="w-full mt-4 px-4 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:opacity-90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/20 disabled:opacity-50"
            >
              {isLoading ? (
                <>Initializing...</>
              ) : (
                <>
                  Start Indexing
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-xs">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
