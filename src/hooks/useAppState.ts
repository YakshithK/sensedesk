import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export type AppScreen = "loading" | "setup" | "indexing" | "search";

export function useAppState() {
  const [screen, setScreen] = useState<AppScreen>("loading");

  const checkState = async () => {
    try {
      // Check indexer status to determine which screen to show
      const status: { status: string; files_done: number; files_total: number } = await invoke("get_indexer_status");

      if (status.status === "running" || status.status === "paused") {
        setScreen("indexing");
      } else if (status.files_total > 0) {
        // Previously indexed — go to search
        setScreen("search");
      } else {
        setScreen("setup");
      }
    } catch (e) {
      console.error("Failed to check app state:", e);
      setScreen("setup");
    }
  };

  useEffect(() => {
    checkState();
  }, []);

  return {
    screen,
    setScreen,
    refreshState: checkState,
  };
}
