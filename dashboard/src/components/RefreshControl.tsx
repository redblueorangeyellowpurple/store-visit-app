"use client";

import { useEffect, useState } from "react";
import type { AutoRefreshControls } from "@/lib/useAutoRefresh";

function formatRelative(d: Date | null, now: number): string {
  if (!d) return "Not yet refreshed";
  const sec = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (sec < 5) return "Just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default function RefreshControl({
  controls,
  compact = false,
}: {
  controls: AutoRefreshControls;
  compact?: boolean;
}) {
  const { lastRefreshedAt, isRefreshing, refreshNow } = controls;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const label = isRefreshing ? "Refreshing…" : `Updated ${formatRelative(lastRefreshedAt, now)}`;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: compact ? 11 : 12,
        color: "var(--color-ink-300)",
      }}
      title={lastRefreshedAt ? `Last refreshed at ${lastRefreshedAt.toLocaleTimeString("en-GB")}` : undefined}
    >
      <span>{label}</span>
      <button
        type="button"
        onClick={() => { void refreshNow(); }}
        disabled={isRefreshing}
        aria-label="Refresh now"
        title="Refresh now"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 26,
          height: 26,
          borderRadius: 8,
          border: "1px solid var(--color-line-200, #e5e0d8)",
          background: "var(--color-surface-100, #fff)",
          color: "var(--color-ink-400, #3a342c)",
          cursor: isRefreshing ? "default" : "pointer",
          opacity: isRefreshing ? 0.5 : 1,
          padding: 0,
          fontSize: 13,
          lineHeight: 1,
        }}
      >
        ↻
      </button>
    </div>
  );
}
