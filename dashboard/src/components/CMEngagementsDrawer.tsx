"use client";

import { useEffect } from "react";
import type { WeeklyReport } from "@/lib/weekly";

// Weekly report drawer: every engagement a CM made this week —
// person, store, products trained, response, date. Data is precomputed
// in the weekly payload (perCM[].engagementDetails).

interface Props {
  cm: WeeklyReport["perCM"][number] | null;
  onClose: () => void;
}

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
  });
}

export default function CMEngagementsDrawer({ cm, onClose }: Props) {
  const isOpen = cm !== null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    if (isOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  return (
    <div
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 460, maxWidth: "100vw", zIndex: 260,
        background: "var(--color-surface)", borderLeft: "1px solid var(--color-border)",
        boxShadow: isOpen ? "-8px 0 32px rgba(0,0,0,0.10)" : "none",
        transform: isOpen ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}
    >
      {/* ── Header ── */}
      <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-ink-400)", marginBottom: 4 }}>
              🤝 Engagements This Week
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--color-ink-900)", lineHeight: 1.2 }}>
              {cm?.cm}
            </div>
            {cm && (
              <div style={{ fontSize: 13, color: "var(--color-ink-500)", marginTop: 4 }}>
                {cm.market} · {cm.engagements} engagement{cm.engagements !== 1 ? "s" : ""}
              </div>
            )}
          </div>
          <button
            onClick={onClose} aria-label="Close engagements drawer"
            style={{
              padding: "4px 8px", borderRadius: 8, background: "var(--color-ink-50)",
              border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1,
              color: "var(--color-ink-500)", flexShrink: 0,
            }}
          >✕</button>
        </div>
      </div>

      {/* ── Scrollable body ── */}
      <div style={{ overflowY: "auto", flex: 1, padding: "16px 20px 40px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(cm?.engagementDetails ?? []).map((e, i) => (
            <div key={i} style={{
              padding: "10px 13px", background: "var(--color-ink-50)",
              border: "1px solid var(--color-border)", borderRadius: 10,
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-ink-900)" }}>{e.person}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-ink-400)", whiteSpace: "nowrap" }}>
                  {fmtDate(e.date)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--color-ink-500)", marginTop: 2 }}>{e.store}</div>
              {e.products && (
                <div style={{ fontSize: 12, color: "var(--color-ink-600)", marginTop: 4 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20, marginRight: 6,
                    background: "var(--color-section-green-bg)", color: "var(--color-tier-t2-fg)",
                  }}>trained</span>
                  {e.products}
                </div>
              )}
              {e.response && (
                <div style={{ fontSize: 12.5, color: "var(--color-ink-600)", marginTop: 4, lineHeight: 1.4 }}>
                  {e.response}
                </div>
              )}
            </div>
          ))}
          {cm && cm.engagementDetails.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--color-ink-400)" }}>No engagement detail recorded.</p>
          )}
        </div>
      </div>
    </div>
  );
}
