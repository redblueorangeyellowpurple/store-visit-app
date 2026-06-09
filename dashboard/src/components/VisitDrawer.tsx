"use client";

import { useEffect, useRef, useState } from "react";
import type { VisitDetail } from "@/lib/queries";
import { SECTIONS, TIER_STYLE } from "@/lib/visit-shared";

interface Props {
  visitId: string | null;
  onClose: () => void;
  /** Called when the user clicks "Open store →"; parent should open StoreVisitDrawer. */
  onOpenStore: (storeId: string) => void;
}

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "long", year: "numeric",
  });
}

// Text sections shown in the visit body (matches the 5 canonical ones).
const VISIT_SECTIONS = [
  { key: "good_news",     label: "Good News",       icon: "🌟" },
  { key: "people_training", label: "People & Training", icon: "🤝" },
  { key: "competitors",   label: "Competitors",      icon: "🔍" },
  { key: "display_stock", label: "Display & Stock",  icon: "📦" },
  { key: "follow_up",     label: "Follow Up",        icon: "📌" },
] as const;

const TIER_FALLBACK = { bg: "var(--color-ink-100)", color: "var(--color-ink-500)" };

export default function VisitDrawer({ visitId, onClose, onOpenStore }: Props) {
  const [visit, setVisit] = useState<VisitDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const prevId = useRef<string | null>(null);

  const isOpen = visitId !== null;

  useEffect(() => {
    if (!visitId) return;
    if (visitId === prevId.current) return;
    prevId.current = visitId;
    setVisit(null);
    setLoading(true);
    fetch(`/api/visits/${visitId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { setVisit(d?.visit ?? null); })
      .finally(() => setLoading(false));
  }, [visitId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (lightbox) { setLightbox(null); return; }
      onClose();
    }
    if (isOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, lightbox]);

  const tierStyle = visit?.store_tier ? (TIER_STYLE[visit.store_tier] ?? TIER_FALLBACK) : TIER_FALLBACK;

  // Suppress the unused-import warning for SECTIONS — we reference it for the kernel colour map.
  void SECTIONS;

  return (
    <>
      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 520, zIndex: 260,
          background: "var(--color-surface)", borderLeft: "1px solid var(--color-border)",
          boxShadow: isOpen ? "-8px 0 32px rgba(0,0,0,0.10)" : "none",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* ── Header ── */}
        <div style={{
          padding: "18px 20px 14px",
          borderBottom: "1px solid var(--color-border)",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              {loading && <p style={mutedStyle}>Loading…</p>}
              {!loading && !visit && <p style={mutedStyle}>Visit not found.</p>}
              {!loading && visit && (
                <>
                  {/* Tier + chain + market */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 6,
                      background: tierStyle.bg, color: tierStyle.color,
                      textTransform: "uppercase", letterSpacing: "0.5px",
                    }}>{visit.store_tier ?? "—"}</span>
                    <span style={{ fontSize: 11, color: "var(--color-ink-400)", fontWeight: 500 }}>
                      {visit.store_chain} · {visit.store_market}
                    </span>
                  </div>
                  {/* Store name */}
                  <div style={{ fontSize: 18, fontWeight: 800, color: "var(--color-ink-900)", lineHeight: 1.2, marginBottom: 2 }}>
                    {visit.store_name}
                  </div>
                  {/* CM + date */}
                  <div style={{ fontSize: 13, color: "var(--color-ink-500)", marginTop: 4 }}>
                    {visit.cm_name} · {fmtDate(visit.visit_date)}
                  </div>
                </>
              )}
            </div>
            <button
              onClick={onClose} aria-label="Close visit drawer"
              style={{
                padding: "4px 8px", borderRadius: 8, background: "var(--color-ink-50)",
                border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1,
                color: "var(--color-ink-500)", flexShrink: 0,
              }}
            >✕</button>
          </div>

          {/* "Open store" action */}
          {visit && (
            <button
              onClick={() => { onClose(); onOpenStore(visit.store_id); }}
              style={{
                marginTop: 12, width: "100%", padding: "9px 14px",
                border: "1px solid var(--color-tc-100)", borderRadius: 10,
                background: "var(--color-tc-50)", color: "var(--color-tc-600)",
                fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              Open store → {visit.store_name}
            </button>
          )}
        </div>

        {/* ── Scrollable body ── */}
        <div style={{ overflowY: "auto", flex: 1, padding: "16px 20px 40px" }}>
          {!loading && visit && (
            <>
              {/* Visit sections */}
              {VISIT_SECTIONS.map(({ key, label, icon }) => {
                const text = visit[key as keyof VisitDetail] as string | null;
                if (!text) return null;
                return (
                  <div key={key} style={{
                    marginBottom: 14, padding: "12px 14px",
                    background: "var(--color-ink-50)",
                    border: "1px solid var(--color-border)", borderRadius: 12,
                  }}>
                    <div style={{
                      fontSize: 10.5, fontWeight: 700, textTransform: "uppercase",
                      letterSpacing: "0.06em", color: "var(--color-ink-400)",
                      marginBottom: 6, display: "flex", alignItems: "center", gap: 5,
                    }}>
                      <span>{icon}</span> {label}
                    </div>
                    <div style={{ fontSize: 13.5, color: "var(--color-ink-800)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                      {text}
                    </div>
                  </div>
                );
              })}

              {/* Photos */}
              {visit.photo_urls.length > 0 && (
                <div style={{ marginTop: 4, marginBottom: 16 }}>
                  <div style={sectionHdStyle}>📸 Photos ({visit.photo_urls.length})</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(90px,1fr))", gap: 8 }}>
                    {visit.photo_urls.map((url, i) => (
                      <button
                        key={i} onClick={() => setLightbox(url)}
                        style={{ aspectRatio: "1", borderRadius: 10, overflow: "hidden", border: "1px solid var(--color-border)", cursor: "pointer", padding: 0, background: "none" }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={`Photo ${i + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Engaged people */}
              {visit.engaged_people.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={sectionHdStyle}>
                    🤝 Engagements
                    <span style={countBadgeStyle}>{visit.engaged_people.length}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {visit.engaged_people.map((p, i) => (
                      <div key={i} style={{
                        padding: "9px 12px", background: "var(--color-ink-50)",
                        border: "1px solid var(--color-border)", borderRadius: 10,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-ink-900)" }}>{p.name}</span>
                          {p.was_trained && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20,
                              background: "var(--color-section-green-bg)", color: "var(--color-tier-t2-fg)",
                            }}>trained</span>
                          )}
                        </div>
                        {p.products && <div style={{ fontSize: 12, color: "var(--color-ink-500)", marginTop: 2 }}>{p.products}</div>}
                        {p.update_text && <div style={{ fontSize: 12.5, color: "var(--color-ink-600)", marginTop: 3, lineHeight: 1.4 }}>{p.update_text}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Follow-up items */}
              {visit.follow_up_items.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={sectionHdStyle}>
                    📌 Follow-up items
                    <span style={countBadgeStyle}>{visit.follow_up_items.length}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {visit.follow_up_items.map((f, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 0", borderBottom: i < visit.follow_up_items.length - 1 ? "1px solid var(--color-border)" : "none" }}>
                        <span style={{ fontSize: 12, color: f.status === "done" ? "var(--color-ink-300)" : "var(--color-ink-700)", textDecoration: f.status === "done" ? "line-through" : "none" }}>
                          {f.title}
                        </span>
                        {f.due_date && (
                          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--color-ink-400)", whiteSpace: "nowrap" }}>
                            {f.due_date}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, zIndex: 320, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Photo" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 12, objectFit: "contain" }} />
          <button
            onClick={() => setLightbox(null)}
            style={{ position: "absolute", top: 20, right: 24, background: "rgba(255,255,255,0.15)", border: "none", color: "white", fontSize: 18, borderRadius: 8, padding: "4px 10px", cursor: "pointer" }}
          >✕</button>
        </div>
      )}
    </>
  );
}

const mutedStyle: React.CSSProperties = { fontSize: 13, color: "var(--color-ink-400)" };
const sectionHdStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6,
  fontSize: 11, fontWeight: 700, textTransform: "uppercase",
  letterSpacing: "0.06em", color: "var(--color-ink-300)",
  marginBottom: 8,
};
const countBadgeStyle: React.CSSProperties = {
  marginLeft: 4, background: "var(--color-ink-100)", color: "var(--color-ink-500)",
  borderRadius: 999, padding: "1px 8px", fontSize: 10.5,
};
