import { invoke } from "@tauri-apps/api/core";
import { SearchResult } from "../hooks/useSearch";
import { FolderOpen, ExternalLink } from "lucide-react";
import { useState } from "react";

interface ResultListProps {
  results: SearchResult[];
}

function FileTypeBadge({ type }: { type: string }) {
  const label = type.toLowerCase();
  return (
    <span className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-mono tracking-[0.22em] uppercase border border-accent/20 bg-accent/5 text-accent/80">
      {label}
    </span>
  );
}

export function ResultList({ results }: ResultListProps) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-frost/40 animate-fade-in">
        <div className="glass-strong rounded-[2rem] px-8 py-10 border border-primary/10 w-full max-w-xl text-center">
          <p className="text-xs font-mono tracking-[0.22em] uppercase text-frost/35 mb-4">
            no hits
          </p>
          <p className="text-sm text-frost/60">
            Adjust your phrasing and let Vish re-embed the intent.
          </p>
        </div>
      </div>
    );
  }

  const handleOpen = async (path: string) => {
    try {
      await invoke("open_file", { path });
    } catch (e) {
      console.error("Failed to open file:", e);
    }
  };

  const handleReveal = async (path: string) => {
    try {
      await invoke("reveal_in_explorer", { path });
    } catch (e) {
      console.error("Failed to reveal file:", e);
    }
  };

  // Deduplicate: keep only the highest-scoring result per file path
  const seen = new Map<string, SearchResult>();
  for (const r of results) {
    const existing = seen.get(r.path);
    if (!existing || r.score > existing.score) {
      seen.set(r.path, r);
    }
  }
  const uniqueResults = Array.from(seen.values()).sort(
    (a, b) => b.score - a.score
  );

  // Normalize scores for display so the spread between results is visible.
  // Raw cosine similarities cluster in a narrow band (e.g. 0.45-0.55) which
  // looks like "similar %" to the user. Min-max normalization maps the best
  // result to ~98% and worst to a proportionally lower value.
  const maxScore = uniqueResults.length > 0 ? uniqueResults[0].score : 1;
  const minScore = uniqueResults.length > 1 ? uniqueResults[uniqueResults.length - 1].score : 0;
  const scoreRange = maxScore - minScore;
  const normalizeScore = (raw: number) => {
    if (uniqueResults.length <= 1 || scoreRange < 0.001) {
      // Single result or all identical scores: show raw as capped at 98
      return Math.min(Math.round(raw * 100), 98);
    }
    // Map to 40-98 range so even the lowest result doesn't look absurdly bad
    return Math.round(40 + ((raw - minScore) / scoreRange) * 58);
  };

  const selectedResult =
    selectedIdx !== null ? uniqueResults[selectedIdx] : null;

  return (
    <div className="flex flex-col gap-6 px-8 py-6 w-full max-w-7xl mx-auto lg:flex-row">
      {/* Result cards */}
      <div className="flex-1 flex flex-col gap-2.5 overflow-y-auto min-w-0">
        <p className="text-xs text-frost/30 mb-1">
          {uniqueResults.length} result{uniqueResults.length !== 1 ? "s" : ""}
        </p>
        {uniqueResults.map((result, idx) => {
          const relevance = normalizeScore(result.score);
          const fileName =
            result.path.split("/").pop() || result.path.split("\\").pop();
          const isSelected = selectedIdx === idx;

          return (
            <div
              key={`${result.path}-${idx}`}
              className={`relative flex items-start gap-5 p-6 rounded-2xl glass-card cursor-pointer group animate-fade-in border
                         ${isSelected ? "border-accent/45" : "border-transparent"}`}
              style={{ animationDelay: `${idx * 50}ms` }}
              onClick={() => {
                setSelectedIdx(idx);
                handleOpen(result.path);
              }}
              onMouseEnter={() => setSelectedIdx(idx)}
            >
              {/* File type badge */}
              <div className="pt-1">
                <FileTypeBadge type={result.file_type} />
              </div>

              {/* Center: filename + snippet */}
              <div className="min-w-0 flex-1">
                <h3 className="font-display font-semibold text-base md:text-lg text-frost/90 truncate mb-1">
                  {fileName}
                </h3>
                {result.text_excerpt && (
                  <div className="mt-3">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.25em] text-accent/70 mb-1.5 block">
                      semantic match
                    </span>
                    <p className="text-sm text-frost/60 line-clamp-4 leading-relaxed font-body">
                      {result.text_excerpt.substring(0, 260)}...
                    </p>
                  </div>
                )}
              </div>

              {/* Right: metadata */}
              <div className="flex flex-col items-end gap-2 shrink-0 text-right">
                <span className="text-[12px] font-mono tracking-[0.18em] text-frost/60 border border-accent/18 bg-accent/5 px-2.5 py-1 rounded-full">
                  {relevance}%
                </span>
                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleReveal(result.path);
                    }}
                    className="p-1.5 rounded-lg transition-all border border-transparent hover:border-primary/20 hover:bg-white/5"
                    title="Reveal in Explorer"
                    aria-label="Reveal in Explorer"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-frost/40" />
                  </button>
                  <div className="p-1.5 opacity-80">
                    <ExternalLink className="w-3.5 h-3.5 text-frost/40" />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Look (small screens) */}
      {selectedResult && (
        <div className="w-full glass-strong rounded-[2rem] p-6 animate-fade-in-scale lg:hidden border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-accent/70">
              quick look
            </h4>
            <FileTypeBadge type={selectedResult.file_type} />
          </div>

          <p className="text-base text-frost font-display font-semibold truncate mb-2">
            {selectedResult.path.split("/").pop() ||
              selectedResult.path.split("\\").pop()}
          </p>
          <p className="text-xs text-frost/35 truncate font-mono" title={selectedResult.path}>
            {selectedResult.path}
          </p>
          {selectedResult.text_excerpt && (
            <div className="mt-4 pt-4 border-t border-white/5">
              <p className="text-sm text-frost/55 line-clamp-4 leading-relaxed font-body">
                {selectedResult.text_excerpt.substring(0, 340)}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Quick Look (large screens) */}
      {selectedResult && (
        <div className="w-80 shrink-0 glass-strong rounded-[2rem] p-6 animate-fade-in-scale hidden lg:flex flex-col border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-accent/70">
              quick look
            </h4>
            <FileTypeBadge type={selectedResult.file_type} />
          </div>

          <p className="text-base text-frost font-display font-semibold truncate mb-2">
            {selectedResult.path.split("/").pop() ||
              selectedResult.path.split("\\").pop()}
          </p>
          <p className="text-xs text-frost/30 truncate font-mono" title={selectedResult.path}>
            {selectedResult.path}
          </p>
          {selectedResult.text_excerpt && (
            <div className="mt-4 pt-4 border-t border-white/5">
              <p className="text-xs text-frost/55 line-clamp-4 leading-relaxed font-body">
                {selectedResult.text_excerpt.substring(0, 320)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
