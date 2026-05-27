"use client";

import { useEffect, useRef, useState } from "react";

interface StoreInfo {
  id: string;
  name: string;
  chain: string;
  market: string;
  tier: "T1" | "T2" | "T3" | "T4" | null;
}

interface StoreVisit {
  id: string;
  visit_date: string;
  cm_name: string;
  good_news: string | null;
  competitors: string | null;
  display_stock: string | null;
  follow_up: string | null;
  buzz_plan: string | null;
  training: string | null;
  people_training: string | null;
  photo_count: number;
  thumb_urls: string[];
  photo_urls: string[];
}

interface StoreMemoryNote {
  slug: string;
  scope: string;
  title: string;
  summary: string;
}

interface Props {
  storeId: string | null;
  onClose: () => void;
  onOpenNote?: (slug: string) => void;
}

const TIER_COLORS: Record<string, { bg: string; color: string }> = {
  T1: { bg: "var(--color-tier-t1-bg)", color: "var(--color-tier-t1-fg)" },
  T2: { bg: "var(--color-tier-t2-bg)", color: "var(--color-tier-t2-fg)" },
  T3: { bg: "var(--color-tier-t3-bg)", color: "var(--color-tier-t3-fg)" },
  T4: { bg: "var(--color-tier-t4-bg)", color: "var(--color-tier-t4-fg)" },
};

const SECTIONS = [
  { key: "good_news",       label: "Good News",          icon: "🎉", bg: "var(--color-section-amber-bg)" },
  { key: "competitors",     label: "Competitor Insights", icon: "🔍", bg: "var(--color-section-blue-bg)" },
  { key: "display_stock",   label: "Display & Stock",     icon: "📦", bg: "var(--color-section-green-bg)" },
  { key: "people_training", label: "People & Training",   icon: "👥", bg: "var(--color-section-teal-bg)" },
  { key: "follow_up",       label: "Follow Up",           icon: "✅", bg: "var(--color-section-pink-bg)" },
  { key: "buzz_plan",       label: "Buzz Plan",           icon: "⚡", bg: "var(--color-section-purple-bg)" },
] as const;

const SCOPE_BG: Record<string, string> = {
  theme:   "var(--color-section-purple-bg)",
  store:   "var(--color-section-green-bg)",
  person:  "var(--color-section-blue-bg)",
  channel: "var(--color-ink-50)",
};

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function StoreVisitDrawer({ storeId, onClose, onOpenNote }: Props) {
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [visits, setVisits] = useState<StoreVisit[]>([]);
  const [memoryNotes, setMemoryNotes] = useState<StoreMemoryNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const prevStoreId = useRef<string | null>(null);

  const isOpen = storeId !== null;

  useEffect(() => {
    if (!storeId) return;
    if (storeId === prevStoreId.current) return;
    prevStoreId.current = storeId;

    setStore(null);
    setVisits([]);
    setMemoryNotes([]);
    setLoading(true);
    fetch(`/api/visits/store/${storeId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d) {
          setStore(d.store);
          setVisits(d.visits);
          setMemoryNotes(d.memory_notes ?? []);
        }
        setLoading(false);
      });
  }, [storeId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    if (isOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const tierStyle = store?.tier ? TIER_COLORS[store.tier] : TIER_COLORS.T4;

  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          zIndex: 200,
          background: "var(--color-surface)",
          borderLeft: "1px solid var(--color-border)",
          boxShadow: isOpen ? "-8px 0 32px rgba(0,0,0,0.10)" : "none",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            padding: "18px 20px 14px",
            borderBottom: "1px solid var(--color-border)",
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            {store ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 6,
                      background: tierStyle.bg, color: tierStyle.color,
                      textTransform: "uppercase", letterSpacing: "0.5px",
                    }}
                  >
                    {store.tier ?? "—"}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--color-ink-400)", fontWeight: 500 }}>
                    {store.chain} · {store.market}
                  </span>
                </div>
                {/* Clickable store name → opens full store page */}
                <a
                  href={`/visits/store/${store.id}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: "block", fontSize: 17, fontWeight: 800,
                    color: "var(--color-tc-600)", lineHeight: 1.2,
                    textDecoration: "none", marginBottom: 3,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                  onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                >
                  {store.name} ↗
                </a>
                <p style={{ fontSize: 11, color: "var(--color-ink-300)", marginTop: 2 }}>
                  {visits.length} visit{visits.length !== 1 ? "s" : ""}
                  {visits[0] ? ` · last ${fmtDate(visits[0].visit_date)}` : ""}
                </p>
              </>
            ) : (
              <p style={{ fontSize: 13, color: "var(--color-ink-400)" }}>
                {loading ? "Loading…" : "Store not found"}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close drawer"
            style={{
              marginLeft: 12, padding: "4px 8px", borderRadius: 8,
              background: "var(--color-ink-50)", border: "none",
              cursor: "pointer", fontSize: 16, lineHeight: 1,
              color: "var(--color-ink-500)", flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ overflowY: "auto", flex: 1, padding: "20px 20px 40px" }}>
          {loading && (
            <p style={{ fontSize: 13, color: "var(--color-ink-300)", textAlign: "center", paddingTop: 40 }}>
              Loading visits…
            </p>
          )}

          {!loading && visits.length === 0 && (
            <p style={{ fontSize: 13, color: "var(--color-ink-300)", textAlign: "center", paddingTop: 40 }}>
              No visits logged yet.
            </p>
          )}

          {visits.map((v, idx) => {
            const filledSections = SECTIONS.filter((s) => v[s.key]);
            return (
              <div
                key={v.id}
                style={{
                  marginBottom: idx < visits.length - 1 ? 28 : 0,
                  paddingBottom: idx < visits.length - 1 ? 28 : 0,
                  borderBottom: idx < visits.length - 1 ? "1px solid var(--color-border)" : "none",
                }}
              >
                {/* Visit header */}
                <div
                  style={{
                    display: "flex", alignItems: "center",
                    justifyContent: "space-between", marginBottom: 14,
                  }}
                >
                  <span style={{ fontSize: 15, fontWeight: 700, color: "var(--color-ink-900)" }}>
                    {fmtDate(v.visit_date)}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, color: "var(--color-ink-500)" }}>{v.cm_name}</span>
                    {v.photo_count > 0 && (
                      <span style={{ fontSize: 12, color: "var(--color-ink-300)" }}>📸 {v.photo_count}</span>
                    )}
                  </div>
                </div>

                {/* Photo strip */}
                {v.photo_urls.length > 0 && (
                  <div
                    style={{
                      display: "flex", gap: 6, overflowX: "auto",
                      marginBottom: 16, paddingBottom: 4,
                    }}
                  >
                    {v.photo_urls.map((url, i) => (
                      <button
                        key={i}
                        onClick={() => setLightbox(url)}
                        style={{
                          flexShrink: 0, width: 80, height: 80,
                          borderRadius: 8, overflow: "hidden",
                          border: "1px solid var(--color-border)",
                          cursor: "pointer", padding: 0, background: "none",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={`Photo ${i + 1}`}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      </button>
                    ))}
                  </div>
                )}

                {/* Sections */}
                {filledSections.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--color-ink-300)" }}>No notes logged.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {filledSections.map((s) => (
                      <div
                        key={s.key}
                        style={{ borderRadius: 10, padding: "12px 14px", background: s.bg }}
                      >
                        <p
                          style={{
                            fontSize: 11, fontWeight: 700, letterSpacing: "0.4px",
                            color: "var(--color-ink-600, var(--color-ink-500))",
                            marginBottom: 6, textTransform: "uppercase",
                          }}
                        >
                          {s.icon} {s.label}
                        </p>
                        <p
                          style={{
                            fontSize: 13.5, color: "var(--color-ink-700)",
                            lineHeight: 1.6, whiteSpace: "pre-wrap",
                          }}
                        >
                          {v[s.key]}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Memory notes for this store */}
          {memoryNotes.length > 0 && (
            <div style={{ marginTop: visits.length > 0 ? 28 : 0, paddingTop: visits.length > 0 ? 28 : 0, borderTop: visits.length > 0 ? "1px solid var(--color-border)" : "none" }}>
              <p
                style={{
                  fontSize: 11, fontWeight: 700, textTransform: "uppercase",
                  letterSpacing: "0.6px", color: "var(--color-ink-300)", marginBottom: 10,
                }}
              >
                🧠 Memory notes ({memoryNotes.length})
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {memoryNotes.map((n) => (
                  <button
                    key={n.slug}
                    onClick={() => onOpenNote?.(n.slug)}
                    style={{
                      textAlign: "left", padding: "10px 12px", borderRadius: 10,
                      background: "var(--color-ink-50)",
                      border: "1px solid var(--color-border)",
                      cursor: onOpenNote ? "pointer" : "default",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <span
                        style={{
                          fontSize: 9, fontWeight: 800, padding: "1px 5px", borderRadius: 4,
                          background: SCOPE_BG[n.scope] ?? "var(--color-ink-100)",
                          color: "var(--color-ink-700)", textTransform: "uppercase", letterSpacing: "0.4px",
                        }}
                      >
                        {n.scope}
                      </span>
                      <p style={{ fontSize: 12.5, fontWeight: 700, color: "var(--color-ink-900)" }}>
                        {n.title}
                      </p>
                    </div>
                    <p style={{ fontSize: 11.5, color: "var(--color-ink-500)", lineHeight: 1.4 }}>
                      {n.summary}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 300,
            background: "rgba(0,0,0,0.82)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Photo"
            style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 12, objectFit: "contain" }}
          />
          <button
            onClick={() => setLightbox(null)}
            style={{
              position: "absolute", top: 20, right: 24,
              background: "rgba(255,255,255,0.15)", border: "none",
              color: "white", fontSize: 18, borderRadius: 8,
              padding: "4px 10px", cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
