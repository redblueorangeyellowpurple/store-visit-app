"use client";

import { useEffect } from "react";
import type { TrainingProductSummary } from "@/lib/weekly";

// Weekly report drawer: everyone trained on a product this week —
// person, store, date, response. Data is precomputed in the weekly payload.

interface Props {
  product: TrainingProductSummary | null;
  onClose: () => void;
}

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
  });
}

export default function TrainingProductDrawer({ product, onClose }: Props) {
  const isOpen = product !== null;

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
              🎓 Trained This Week
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "var(--color-ink-900)", lineHeight: 1.2 }}>
              {product?.product}
            </div>
            {product && (
              <div style={{ fontSize: 13, color: "var(--color-ink-500)", marginTop: 4 }}>
                {product.trainings} training{product.trainings !== 1 ? "s" : ""} · {product.people} {product.people !== 1 ? "people" : "person"}
              </div>
            )}
          </div>
          <button
            onClick={onClose} aria-label="Close training drawer"
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
          {(product?.persons ?? []).map((p, i) => (
            <div key={i} style={{
              padding: "10px 13px", background: "var(--color-ink-50)",
              border: "1px solid var(--color-border)", borderRadius: 10,
            }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-ink-900)" }}>{p.person}</span>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-ink-400)", whiteSpace: "nowrap" }}>
                  {fmtDate(p.date)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--color-ink-500)", marginTop: 2 }}>{p.store}</div>
              {p.response && (
                <div style={{ fontSize: 12.5, color: "var(--color-ink-600)", marginTop: 4, lineHeight: 1.4 }}>
                  {p.response}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
