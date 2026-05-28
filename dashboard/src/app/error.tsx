"use client";

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

  return (
    <div style={{ padding: 32, fontFamily: "ui-monospace, monospace", color: "#222", maxWidth: 900 }}>
      <h1 style={{ fontFamily: "system-ui, sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 12 }}>
        Dashboard error
      </h1>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
        Something threw while rendering this page. Details below.
      </p>
      <pre style={{ background: "#f5f5f0", padding: 16, borderRadius: 6, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", border: "1px solid #ddd" }}>
        <strong>{error.name}: {error.message}</strong>
        {error.digest && <div style={{ marginTop: 8, color: "#888" }}>digest: {error.digest}</div>}
        {error.stack && <div style={{ marginTop: 12, color: "#444" }}>{error.stack}</div>}
      </pre>
      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button onClick={() => reset()} style={{ padding: "8px 16px", border: "1px solid #333", background: "#222", color: "#fff", borderRadius: 4, cursor: "pointer" }}>
          Try again
        </button>
        <a href="/" style={{ padding: "8px 16px", border: "1px solid #ccc", background: "#fff", color: "#222", borderRadius: 4, textDecoration: "none" }}>
          Reload home
        </a>
      </div>
    </div>
  );
}
