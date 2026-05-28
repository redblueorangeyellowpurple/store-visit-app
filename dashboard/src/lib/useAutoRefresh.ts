"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Options = {
  /** Poll interval in ms. Default 60s. */
  intervalMs?: number;
  /** Master switch. Default true. */
  enabled?: boolean;
  /** Caller-controlled pause (drawer open, modal open, mid-save, …). Default false. */
  paused?: boolean;
  /** Skip when the tab is hidden / backgrounded. Default true. */
  pauseWhenHidden?: boolean;
  /** Skip when focus is in an input / textarea / select / contenteditable. Default true. */
  pauseWhenInputFocused?: boolean;
};

export type AutoRefreshControls = {
  lastRefreshedAt: Date | null;
  isRefreshing: boolean;
  refreshNow: () => Promise<void>;
};

/**
 * Silent background refresh on an interval. Designed to be invisible:
 * - Caller's fetcher should merge into existing state (no loading flicker).
 * - Skips ticks while paused / hidden / typing — no clobbering mid-edit.
 * - React state updates don't reset scroll, so list pages stay put.
 *
 * Returns `{ lastRefreshedAt, isRefreshing, refreshNow }` for a manual refresh
 * button + timestamp UI. `refreshNow` ignores pause flags — it's user-initiated.
 */
export function useAutoRefresh(
  fetcher: () => void | Promise<void>,
  opts: Options = {},
): AutoRefreshControls {
  const {
    intervalMs = 60_000,
    enabled = true,
    paused = false,
    pauseWhenHidden = true,
    pauseWhenInputFocused = true,
  } = opts;

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  const inFlightRef = useRef(false);

  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const runFetch = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsRefreshing(true);
    try {
      await fetcherRef.current();
      setLastRefreshedAt(new Date());
    } finally {
      inFlightRef.current = false;
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      if (pausedRef.current) return;
      if (pauseWhenHidden && typeof document !== "undefined" && document.visibilityState !== "visible") return;
      if (pauseWhenInputFocused && typeof document !== "undefined") {
        const ae = document.activeElement as HTMLElement | null;
        if (ae) {
          const tag = ae.tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || ae.isContentEditable) return;
        }
      }
      void runFetch();
    };
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs, pauseWhenHidden, pauseWhenInputFocused, runFetch]);

  return { lastRefreshedAt, isRefreshing, refreshNow: runFetch };
}
