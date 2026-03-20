import { useState, FormEvent } from "react";
import { SearchIcon, Loader2 } from "lucide-react";

interface SearchBarProps {
  onSearch: (query: string) => void;
  isLoading: boolean;
  compact?: boolean;
}

export function SearchBar({
  onSearch,
  isLoading,
  compact = false,
}: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [isFocused, setIsFocused] = useState(false);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
    }
  };

  return (
    <div className={`w-full px-6 ${compact ? "py-3" : "py-4"}`}>
      <div className="relative max-w-2xl mx-auto">
        {/* Subtle glass halo when focused */}
        <div
          className={`absolute -inset-3 rounded-3xl transition-all duration-700 pointer-events-none ${
            isFocused || isLoading
              ? "opacity-100"
              : "opacity-0"
          }`}
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(145, 249, 229, 0.16) 0%, rgba(95, 221, 157, 0.06) 55%, transparent 80%)",
          }}
        />

        {/* The Command Bar */}
        <form onSubmit={handleSubmit} className="relative group">
          <div className={`absolute inset-y-0 left-6 flex items-center pointer-events-none transition-all duration-500`}>
            {isLoading ? (
              <Loader2
                className={`${compact ? "w-5 h-5" : "w-6 h-6"} text-accent animate-spin`}
              />
            ) : (
              <SearchIcon
                className={`${compact ? "w-5 h-5" : "w-6 h-6"} text-frost/45 group-focus-within:text-accent transition-colors duration-300`}
              />
            )}
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            placeholder="Ask Vish anything... e.g. 'That PDF about marketing...' or 'Q3 Finances'"
            className={`w-full ${
              compact ? "pl-14 pr-6 py-4 text-base" : "pl-14 pr-7 py-5 text-lg md:text-xl"
            } 
                       rounded-[2rem] text-frost placeholder:text-frost/30 font-display
                       focus:outline-none transition-all duration-500 glass-strong
                       border ${isFocused ? "border-accent/70" : "border-accent/15"}
                       ${isLoading ? "border-accent/45" : ""}`}
            autoFocus
          />
        </form>

        {/* No decorative grid: blank space first */}
      </div>
    </div>
  );
}
