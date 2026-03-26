import { useState } from "react";
import { Loader2, Settings } from "lucide-react";
import { SetupScreen } from "./components/SetupScreen";
import { IndexingScreen } from "./components/IndexingScreen";
import { SearchBar } from "./components/SearchBar";
import { ResultList } from "./components/ResultList";
import { SettingsPanel } from "./components/Settings/SettingsPanel";
import { VishLogo } from "./components/VishLogo";
import { useSearch } from "./hooks/useSearch";
import { useAppState } from "./hooks/useAppState";
import "./App.css";

function App() {
  const { screen, setScreen } = useAppState();
  const { results, isSearching, error, search, query, setQuery } = useSearch();
  const [showSettings, setShowSettings] = useState(false);

  const hasResults = results.length > 0;
  const searchView = screen === "search";
  const isSetupView = screen === "setup" || screen === "indexing";

  return (
    <main
      className={`forest-app flex h-screen items-center justify-center overflow-hidden ${
        isSetupView ? "px-2 py-2 md:px-3 md:py-3" : "px-4 py-4 md:px-6 md:py-6"
      }`}
    >
      {screen === "loading" && (
        <div className="relative z-10 flex flex-col items-center gap-5 animate-fade-in">
          <VishLogo size={62} glowing />
          <Loader2 className="h-6 w-6 animate-spin text-white/80" />
          <p className="mono-ui text-sm tracking-[0.22em] text-[var(--text-soft)] uppercase">
            loading index
          </p>
        </div>
      )}

      {screen === "setup" && (
        <SetupScreen onStartIndexing={() => setScreen("indexing")} />
      )}

      {screen === "indexing" && (
        <IndexingScreen
          onComplete={() => setScreen("search")}
          onCancel={() => setScreen("setup")}
        />
      )}

      {searchView && !hasResults && !isSearching && (
        <section className="relative z-10 flex min-h-[78vh] w-full flex-col">
          <div className="flex items-start justify-between px-2 pt-1 md:px-4">
            <div className="inter-ui text-[2rem] font-light uppercase tracking-tight text-[var(--text-main)] md:text-[2.75rem] lg:text-[3.5rem]">
              VISH
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="glass-surface flex h-11 w-11 items-center justify-center rounded-2xl text-white/85 transition hover:text-white md:h-16 md:w-16 lg:h-20 lg:w-20"
              aria-label="Open settings"
            >
              <Settings className="h-5 w-5 md:h-8 md:w-8 lg:h-10 lg:w-10" />
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center">
            <SearchBar
              onSearch={search}
              isLoading={isSearching}
              value={query}
              onValueChange={setQuery}
              variant="hero"
            />
          </div>
        </section>
      )}

      {searchView && (hasResults || isSearching) && (
        <section className="window-shell animate-fade-in">
          <div className="window-panel flex flex-col gap-4 p-4 md:p-6">
            <div className="flex items-center justify-between px-1 pb-2 pt-1">
              <div className="inter-ui text-[1.05rem] font-medium tracking-tight text-[var(--text-main)]">
                Vish Search Results
              </div>
              <button
                onClick={() => setShowSettings(true)}
                className="glass-surface flex h-10 w-10 items-center justify-center rounded-2xl text-white/85 transition hover:text-white md:h-14 md:w-14 lg:h-16 lg:w-16"
                aria-label="Open settings"
              >
                <Settings className="h-4 w-4 md:h-6 md:w-6 lg:h-7 lg:w-7" />
              </button>
            </div>

            <SearchBar
              onSearch={search}
              isLoading={isSearching}
              value={query}
              onValueChange={setQuery}
              variant="window"
            />

            {error && (
              <div className="rounded-2xl border border-red-200/35 bg-red-400/10 px-4 py-3 text-sm text-red-100">
                {error}
              </div>
            )}

            <ResultList results={results} />
          </div>
        </section>
      )}

      {searchView && showSettings && (
        <SettingsPanel
          onClose={() => setShowSettings(false)}
          onReindex={() => {
            setShowSettings(false);
            setScreen("setup");
          }}
        />
      )}
    </main>
  );
}

export default App;
