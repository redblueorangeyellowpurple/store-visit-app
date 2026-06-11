"use client";

import { useEffect, useRef, useState } from "react";
import type { VisitDetail } from "@/lib/queries";
import { SECTIONS, TIER_STYLE } from "@/lib/visit-shared";

interface Props {
  visitId: string | null;
  /** Visit section to highlight + scroll to: good_news | people_training | competitors | display_stock | follow_up. */
  highlight?: string | null;
  /** Verbatim fragment the report drew from — marked inside the highlighted section when it matches. */
  quote?: string | null;
  onClose: () => void;
  /** Called when the user clicks the store name; parent should open StoreVisitDrawer. */
  onOpenStore: (storeId: string) => void;
  /** Called when the user clicks a memory note; parent should open MemoryNoteDrawer. */
  onOpenNote?: (slug: string) => void;
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

// Locate `quote` inside `text` ignoring case + whitespace differences (the report
// may collapse newlines). Returns [start, end) in the ORIGINAL string, or null.
function findQuoteRange(text: string, quote: string): [number, number] | null {
  const target = quote.toLowerCase().replace(/\s+/g, " ").trim();
  if (!target) return null;
  let norm = "";
  const map: number[] = []; // norm index → original index
  let lastWasSpace = true;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) {
      if (!lastWasSpace) { norm += " "; map.push(i); lastWasSpace = true; }
    } else {
      norm += text[i].toLowerCase(); map.push(i); lastWasSpace = false;
    }
  }
  const idx = norm.indexOf(target);
  if (idx === -1) return null;
  return [map[idx], map[Math.min(idx + target.length - 1, map.length - 1)] + 1];
}

export default function VisitDrawer({ visitId, highlight, quote, onClose, onOpenStore, onOpenNote }: Props) {
  const [visit, setVisit] = useState<VisitDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [storeHover, setStoreHover] = useState(false);
  const prevId = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const highlightRef = useRef<HTMLDivElement | null>(null);

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

  // Scroll the highlighted section into view once the visit has loaded.
  useEffect(() => {
    if (!visit || !highlight) return;
    const el = highlightRef.current;
    const body = bodyRef.current;
    if (el && body) body.scrollTo({ top: Math.max(0, el.offsetTop - body.offsetTop - 12), behavior: "smooth" });
  }, [visit, highlight]);

  const tierStyle = visit?.store_tier ? (TIER_STYLE[visit.store_tier] ?? TIER_FALLBACK) : TIER_FALLBACK;

  // Suppress the unused-import warning for SECTIONS — we reference it for the kernel colour map.
  void SECTIONS;

  return (
    <>
      {/* Attention pulse for the report-source section — inline styles can't host keyframes */}
      <style>{`@keyframes vdSourcePulse{0%{box-shadow:0 0 0 0 rgba(217,119,6,0.45)}70%{box-shadow:0 0 0 9px rgba(217,119,6,0)}100%{box-shadow:0 0 0 0 rgba(217,119,6,0)}}`}</style>
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
                  {/* Store name — quietly clickable, opens the store drawer */}
                  <button
                    onClick={() => { onClose(); onOpenStore(visit.store_id); }}
                    onMouseEnter={() => setStoreHover(true)}
                    onMouseLeave={() => setStoreHover(false)}
                    title="Open store"
                    style={{
                      display: "inline-flex", alignItems: "baseline", gap: 5,
                      background: "none", border: "none", padding: 0, cursor: "pointer",
                      fontFamily: "inherit", textAlign: "left",
                      fontSize: 18, fontWeight: 800, color: "var(--color-ink-900)", lineHeight: 1.2, marginBottom: 2,
                      textDecoration: storeHover ? "underline" : "none", textUnderlineOffset: 3,
                    }}
                  >
                    {visit.store_name}
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink-300)" }}>↗</span>
                  </button>
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
        </div>

        {/* ── Scrollable body ── */}
        <div ref={bodyRef} style={{ overflowY: "auto", flex: 1, padding: "16px 20px 40px" }}>
          {!loading && visit && (
            <>
              {/* Visit sections */}
              {VISIT_SECTIONS.map(({ key, label, icon }) => {
                const text = visit[key as keyof VisitDetail] as string | null;
                if (!text) return null;
                const isHighlighted = highlight === key;
                const quoteRange = isHighlighted && quote ? findQuoteRange(text, quote) : null;
                return (
                  <div key={key} ref={isHighlighted ? highlightRef : undefined} style={{
                    marginBottom: 14, padding: "12px 14px",
                    background: isHighlighted ? "var(--color-section-amber-bg)" : "var(--color-ink-50)",
                    border: isHighlighted ? "2px solid var(--color-section-amber-border)" : "1px solid var(--color-border)",
                    borderRadius: 12,
                    animation: isHighlighted ? "vdSourcePulse 1.3s ease-out 2" : undefined,
                  }}>
                    <div style={{
                      fontSize: 10.5, fontWeight: 700, textTransform: "uppercase",
                      letterSpacing: "0.06em", color: "var(--color-ink-400)",
                      marginBottom: 6, display: "flex", alignItems: "center", gap: 5,
                    }}>
                      <span>{icon}</span> {label}
                      {isHighlighted && (
                        <span style={{
                          marginLeft: "auto", fontSize: 9.5, fontWeight: 800, padding: "2px 8px",
                          borderRadius: 999, background: "var(--color-section-amber-border)",
                          color: "#7C4A03", letterSpacing: "0.05em", whiteSpace: "nowrap",
                        }}>📍 report source</span>
                      )}
                    </div>
                    <div style={{ fontSize: 13.5, color: "var(--color-ink-800)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                      {quoteRange ? (
                        <>
                          {text.slice(0, quoteRange[0])}
                          <mark style={{
                            background: "#FDE047", color: "inherit", fontWeight: 600,
                            padding: "1px 2px", borderRadius: 3, boxDecorationBreak: "clone",
                          }}>{text.slice(quoteRange[0], quoteRange[1])}</mark>
                          {text.slice(quoteRange[1])}
                        </>
                      ) : text}
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

              {/* Engaged people. Current visits keep people_training (the legacy text
                  section) empty, so an ?hl=people_training source link highlights THIS
                  structured block instead — and the person whose text matches `quote`. */}
              {visit.engaged_people.length > 0 && (() => {
                const engHighlighted = highlight === "people_training" && !visit.people_training;
                return (
                <div ref={engHighlighted ? highlightRef : undefined} style={{
                  marginBottom: 14,
                  ...(engHighlighted ? {
                    padding: "12px 14px", borderRadius: 12,
                    background: "var(--color-section-amber-bg)",
                    border: "2px solid var(--color-section-amber-border)",
                    animation: "vdSourcePulse 1.3s ease-out 2",
                  } : {}),
                }}>
                  <div style={sectionHdStyle}>
                    🤝 Engagements
                    <span style={countBadgeStyle}>{visit.engaged_people.length}</span>
                    {engHighlighted && (
                      <span style={{
                        marginLeft: "auto", fontSize: 9.5, fontWeight: 800, padding: "2px 8px",
                        borderRadius: 999, background: "var(--color-section-amber-border)",
                        color: "#7C4A03", letterSpacing: "0.05em", whiteSpace: "nowrap",
                      }}>📍 report source</span>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {visit.engaged_people.map((p, i) => {
                      const trainings = p.trainings ?? [];
                      const personText = [p.name, p.products, p.update_text, ...trainings.map((t) => t.response)].filter(Boolean).join(" ");
                      const isQuoted = engHighlighted && !!quote && findQuoteRange(personText, quote) !== null;
                      const showPerProduct = trainings.some((t) => t.response);
                      return (
                      <div key={i} style={{
                        padding: "9px 12px",
                        background: isQuoted ? "#FEF3C7" : "var(--color-ink-50)",
                        border: isQuoted ? "2px solid var(--color-section-amber-border)" : "1px solid var(--color-border)",
                        borderRadius: 10,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-ink-900)" }}>{p.name}</span>
                          {p.was_trained && (
                            <span style={{
                              fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20,
                              background: "var(--color-section-green-bg)", color: "var(--color-tier-t2-fg)",
                            }}>trained</span>
                          )}
                          {isQuoted && <span style={{ fontSize: 11 }}>📍</span>}
                        </div>
                        {/* Per-product training responses when recorded; else the flat product CSV */}
                        {showPerProduct ? trainings.map((t, j) => (
                          <div key={j} style={{ marginTop: j === 0 ? 4 : 6 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink-500)" }}>{t.product}</div>
                            {t.response && <div style={{ fontSize: 12.5, color: "var(--color-ink-600)", marginTop: 1, lineHeight: 1.4 }}>{t.response}</div>}
                          </div>
                        )) : (
                          p.products && <div style={{ fontSize: 12, color: "var(--color-ink-500)", marginTop: 2 }}>{p.products}</div>
                        )}
                        {p.update_text && <div style={{ fontSize: 12.5, color: "var(--color-ink-600)", marginTop: 3, lineHeight: 1.4 }}>{p.update_text}</div>}
                      </div>
                      );
                    })}
                  </div>
                </div>
                );
              })()}

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

              {/* Memory notes referencing this visit */}
              {visit.memory_notes.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={sectionHdStyle}>
                    🧠 Memories
                    <span style={countBadgeStyle}>{visit.memory_notes.length}</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {visit.memory_notes.map((n) => (
                      <button
                        key={n.slug}
                        onClick={() => onOpenNote?.(n.slug)}
                        style={{
                          textAlign: "left", padding: "9px 12px", borderRadius: 10,
                          background: "var(--color-ink-50)", border: "1px solid var(--color-border)",
                          cursor: onOpenNote ? "pointer" : "default", font: "inherit",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <span style={{
                            fontSize: 9.5, fontWeight: 800, padding: "1px 7px", borderRadius: 999, flexShrink: 0,
                            background: "var(--color-ink-100)", color: "var(--color-ink-500)",
                            textTransform: "uppercase", letterSpacing: "0.04em",
                          }}>{n.scope}</span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--color-ink-900)" }}>{n.title}</span>
                        </div>
                        {n.summary && (
                          <div style={{ fontSize: 12, color: "var(--color-ink-500)", marginTop: 3, lineHeight: 1.4 }}>{n.summary}</div>
                        )}
                      </button>
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
