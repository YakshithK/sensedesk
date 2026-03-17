import { SetupScreen } from "./components/SetupScreen";
import { IndexingScreen } from "./components/IndexingScreen";
import { SearchBar } from "./components/SearchBar";
import { ResultList } from "./components/ResultList";
import { useSearch } from "./hooks/useSearch";
import { useAppState } from "./hooks/useAppState";
import { SettingsIcon, Sparkles, Loader2 } from "lucide-react";
import { useState } from "react";

import "./App.css";

function App() {
  const { screen, setScreen } = useAppState();
  const { results, isSearching, error, search } = useSearch();
  const [showSettings, setShowSettings] = useState(false);

  // Loading state
  if (screen === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  // Setup screen
  if (screen === "setup") {
    return <SetupScreen onStartIndexing={() => setScreen("indexing")} />;
  }

  // Indexing screen
  if (screen === "indexing") {
    return (
      <IndexingScreen
        onComplete={() => setScreen("search")}
        onCancel={() => setScreen("setup")}
      />
    );
  }

  // Search screen (main app)
  return (
    <main className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Subtle background gradient */}
      <div className="absolute top-[-30%] left-[50%] -translate-x-1/2 w-[800px] h-[400px] rounded-full bg-primary/5 blur-[120px] pointer-events-none" />

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 z-10">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          <span className="text-lg font-bold gradient-text tracking-tight">Vish</span>
        </div>
        <button
          onClick={() => setShowSettings(!showSettings)}
          className={`p-2 rounded-lg transition-all ${showSettings ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
      </header>

      {error && (
        <div className="mx-6 mb-2 px-4 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm animate-fade-in">
          {error}
        </div>
      )}

      {showSettings ? (
        <div className="flex-1 px-6 py-4 animate-fade-in">
          <h2 className="text-xl font-bold mb-4">Settings</h2>
          <div className="max-w-md glass-strong rounded-2xl p-5">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2 text-muted-foreground">Gemini API</label>
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-background/50 text-sm">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-muted-foreground">API key configured</span>
                </div>
                <p className="text-xs text-muted-foreground/70 mt-2">
                  Embeddings powered by Gemini Embedding 2. All data stays local.
                </p>
              </div>
              <div>
                <button
                  onClick={() => setScreen("setup")}
                  className="w-full px-4 py-2.5 rounded-xl border border-border bg-background/50 text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                >
                  Re-index folders
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col z-10">
          {/* Search section */}
          <div className={`flex flex-col transition-all duration-500 ${results.length === 0 && !isSearching ? 'flex-1 justify-center' : 'pt-0'}`}>
            {results.length === 0 && !isSearching && (
              <div className="text-center mb-6 px-6 animate-fade-in">
                <h2 className="text-2xl font-bold gradient-text mb-1">What are you looking for?</h2>
                <p className="text-muted-foreground text-sm">Search through your indexed files using natural language</p>
              </div>
            )}
            <SearchBar onSearch={search} isLoading={isSearching} />
          </div>

          {results.length > 0 && (
            <div className="animate-fade-in">
              <ResultList results={results} />
            </div>
          )}
        </div>
      )}
    </main>
  );
}

export default App;
