"use client";

import { useEffect, useRef, useState } from "react";
import { StaffDetailPanel } from "./DetailPanels";
import type { StoreVisitSummary, StoreMemoryNote, StaffRow, StoreOpenTask } from "@/lib/queries";

interface StoreInfo {
  id: string;
  name: string;
  chain: string;
  market: string;
  tier: "T1" | "T2" | "T3" | "T4" | null;
}

interface Props {
  storeId: string | null;
  onClose: () => void;
  onOpenNote?: (slug: string) => void;
}

type Tab = "activity" | "people" | "photos";

const TIER_COLORS: Record<string, { bg: string; color: string }> = {
  T1: { bg: "var(--color-tier-t1-bg)", color: "var(--color-tier-t1-fg)" },
  T2: { bg: "var(--color-tier-t2-bg)", color: "var(--color-tier-t2-fg)" },
  T3: { bg: "var(--color-tier-t3-bg)", color: "var(--color-tier-t3-fg)" },
  T4: { bg: "var(--color-tier-t4-bg)", color: "var(--color-tier-t4-fg)" },
};

// Section icons for the visit timeline summary row
const SECTION_ICONS: Array<{ key: keyof StoreVisitSummary; icon: string }> = [
  { key: "good_news", icon: "🌟" },
  { key: "competitors", icon: "🔍" },
  { key: "display_stock", icon: "📦" },
  { key: "people_training", icon: "🤝" },
  { key: "follow_up", icon: "📌" },
  { key: "buzz_plan", icon: "⚡" },
];

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
// ISO-ish week label (Monday-anchored) + sortable key
function weekOf(dateStr: string): { key: string; label: string } {
  const d = new Date(dateStr + "T00:00:00");
  const dow = (d.getDay() + 6) % 7; // Mon = 0
  const monday = new Date(d);
  monday.setDate(d.getDate() - dow);
  const key = monday.toISOString().slice(0, 10);
  return { key, label: `Week of ${monday.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` };
}
function visitSectionIcons(v: StoreVisitSummary): string {
  return SECTION_ICONS.filter(s => !!v[s.key]).map(s => s.icon).join(" ");
}

export default function StoreVisitDrawer({ storeId, onClose, onOpenNote }: Props) {
  const [store, setStore] = useState<StoreInfo | null>(null);
  const [visits, setVisits] = useState<StoreVisitSummary[]>([]);
  const [memoryNotes, setMemoryNotes] = useState<StoreMemoryNote[]>([]);
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [openTasks, setOpenTasks] = useState<StoreOpenTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("activity");
  const [showCompleted, setShowCompleted] = useState(false);
  const [staffDetail, setStaffDetail] = useState<{ id: string; name: string } | null>(null);
  const prevStoreId = useRef<string | null>(null);

  const isOpen = storeId !== null;

  useEffect(() => {
    if (!storeId) return;
    if (storeId === prevStoreId.current) return;
    prevStoreId.current = storeId;

    setStore(null); setVisits([]); setMemoryNotes([]); setStaff([]); setOpenTasks([]);
    setLoading(true); setTab("activity"); setShowCompleted(false); setStaffDetail(null);
    fetch(`/api/visits/store/${storeId}`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (d) {
          setStore(d.store);
          setVisits(d.visits ?? []);
          setMemoryNotes(d.memory_notes ?? []);
          setStaff(d.staff ?? []);
          setOpenTasks(d.open_tasks ?? []);
        }
        setLoading(false);
      });
  }, [storeId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (staffDetail) setStaffDetail(null);
      else onClose();
    }
    if (isOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, staffDetail]);

  const tierStyle = store?.tier ? TIER_COLORS[store.tier] : TIER_COLORS.T4;

  const openList = openTasks.filter(t => t.status !== "done");
  const doneList = openTasks.filter(t => t.status === "done");
  const photoCount = visits.reduce((n, v) => n + (v.photo_count ?? 0), 0);

  async function toggleTask(t: StoreOpenTask) {
    const done = t.status !== "done";
    setOpenTasks(prev => prev.map(x => x.id === t.id ? { ...x, status: done ? "done" : "open" } : x));
    const res = await fetch("/api/follow-ups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id, done }),
    }).catch(() => null);
    if (!res || !res.ok) {
      // revert on failure
      setOpenTasks(prev => prev.map(x => x.id === t.id ? { ...x, status: done ? "open" : "done" } : x));
    }
  }

  // Photos grouped by week (newest first)
  const photoWeeks: Array<{ key: string; label: string; urls: string[] }> = [];
  {
    const byWeek = new Map<string, { label: string; urls: string[] }>();
    for (const v of visits) {
      if (!v.photo_urls?.length) continue;
      const w = weekOf(v.visit_date);
      const b = byWeek.get(w.key) ?? { label: w.label, urls: [] };
      b.urls.push(...v.photo_urls);
      byWeek.set(w.key, b);
    }
    for (const [key, b] of [...byWeek.entries()].sort((a, c) => c[0].localeCompare(a[0]))) {
      photoWeeks.push({ key, ...b });
    }
  }

  function TabBtn({ id, label, count }: { id: Tab; label: string; count?: number }) {
    return (
      <button
        onClick={() => setTab(id)}
        style={{
          padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
          background: "none", border: "none", borderBottom: "2px solid transparent",
          marginBottom: -1, fontFamily: "inherit",
          color: tab === id ? "var(--color-tc-600)" : "var(--color-ink-400)",
          borderBottomColor: tab === id ? "var(--color-tc-500)" : "transparent",
        }}
      >
        {label}{count != null && count > 0 ? ` (${count})` : ""}
      </button>
    );
  }

  return (
    <>
      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 520, zIndex: 200,
          background: "var(--color-surface)", borderLeft: "1px solid var(--color-border)",
          boxShadow: isOpen ? "-8px 0 32px rgba(0,0,0,0.10)" : "none",
          transform: isOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* ── Header ── */}
        <div style={{ padding: "18px 20px 0", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              {store ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 6,
                      background: tierStyle.bg, color: tierStyle.color,
                      textTransform: "uppercase", letterSpacing: "0.5px",
                    }}>{store.tier ?? "—"}</span>
                    <span style={{ fontSize: 11, color: "var(--color-ink-400)", fontWeight: 500 }}>
                      {store.chain} · {store.market}
                    </span>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "var(--color-ink-900)", lineHeight: 1.2 }}>
                    {store.name}
                  </div>
                </>
              ) : (
                <p style={{ fontSize: 13, color: "var(--color-ink-400)" }}>{loading ? "Loading…" : "Store not found"}</p>
              )}
            </div>
            <button
              onClick={onClose} aria-label="Close drawer"
              style={{
                marginLeft: 12, padding: "4px 8px", borderRadius: 8, background: "var(--color-ink-50)",
                border: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, color: "var(--color-ink-500)", flexShrink: 0,
              }}
            >✕</button>
          </div>

          {/* Stat row */}
          {store && (
            <div style={{ display: "flex", gap: 22, margin: "14px 0 12px" }}>
              {[
                { n: visits.length, l: "Visits" },
                { n: openList.length, l: "Open tasks" },
                { n: staff.length, l: "People" },
                { n: photoCount, l: "Photos" },
              ].map((s) => (
                <div key={s.l}>
                  <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1, color: "var(--color-ink-900)" }}>{s.n}</div>
                  <div style={{ fontSize: 10.5, color: "var(--color-ink-400)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 3 }}>{s.l}</div>
                </div>
              ))}
            </div>
          )}

          {/* Tabs */}
          {store && (
            <div style={{ display: "flex", gap: 4 }}>
              <TabBtn id="activity" label="Activity" />
              <TabBtn id="people" label="People" count={staff.length} />
              <TabBtn id="photos" label="Photos" count={photoCount} />
            </div>
          )}
        </div>

        {/* ── Scrollable content ── */}
        <div style={{ overflowY: "auto", flex: 1, padding: "16px 20px 40px" }}>
          {loading && <p style={loadingStyle}>Loading…</p>}

          {/* ===== ACTIVITY ===== */}
          {!loading && store && tab === "activity" && (
            <>
              {/* Open follow-ups */}
              <SectionHeader>📋 Open follow-ups{openList.length > 0 && <Count>{openList.length}</Count>}</SectionHeader>
              {openList.length === 0 ? (
                <p style={emptyLine}>Nothing open.</p>
              ) : (
                <div>
                  {openList.map(t => {
                    const overdue = !!t.due_date && t.due_date < todayISO();
                    return (
                      <div key={t.id} style={fuRow}>
                        <input type="checkbox" checked={false} onChange={() => toggleTask(t)} style={checkboxStyle} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, color: "var(--color-ink-800)" }}>{t.title}</div>
                          {(t.cm_name || t.visit_date) && (
                            <div style={fuMeta}>
                              {t.cm_name}{t.cm_name && t.visit_date ? " · " : ""}{t.visit_date ? `from ${fmtDate(t.visit_date)} visit` : ""}
                            </div>
                          )}
                        </div>
                        {t.due_date && (
                          <span style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", color: overdue ? "var(--color-danger, #c4724a)" : "var(--color-ink-400)" }}>
                            {overdue ? "overdue · " : "due "}{fmtDate(t.due_date)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {doneList.length > 0 && (
                <>
                  <button onClick={() => setShowCompleted(v => !v)} style={completedToggle}>
                    <span style={{ display: "inline-block", transform: showCompleted ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
                    {" "}✓ Completed ({doneList.length})
                  </button>
                  {showCompleted && (
                    <div>
                      {doneList.map(t => (
                        <div key={t.id} style={{ ...fuRow, opacity: 0.7 }}>
                          <input type="checkbox" checked readOnly onChange={() => toggleTask(t)} style={checkboxStyle} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13.5, color: "var(--color-ink-500)", textDecoration: "line-through" }}>{t.title}</div>
                            {(t.cm_name || t.visit_date) && (
                              <div style={fuMeta}>{t.cm_name}{t.cm_name && t.visit_date ? " · " : ""}{t.visit_date ? `from ${fmtDate(t.visit_date)} visit` : ""}</div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* Visit timeline */}
              <SectionHeader style={{ marginTop: 24 }}>🗓️ Visit timeline{visits.length > 0 && <Count>{visits.length}</Count>}</SectionHeader>
              {visits.length === 0 ? (
                <p style={emptyLine}>No visits logged yet.</p>
              ) : (
                <div style={{ position: "relative", paddingLeft: 18 }}>
                  <div style={{ position: "absolute", left: 4, top: 6, bottom: 6, width: 2, background: "var(--color-border)" }} />
                  {visits.map(v => (
                    <div key={v.id} style={{ position: "relative", marginBottom: 13 }}>
                      <div style={{ position: "absolute", left: -18, top: 5, width: 9, height: 9, borderRadius: "50%", background: "var(--color-tc-500)", border: "2px solid var(--color-surface)" }} />
                      <div style={{ fontSize: 11.5, color: "var(--color-ink-400)", fontWeight: 700, marginBottom: 3 }}>
                        {fmtDate(v.visit_date)} · {v.cm_name}
                      </div>
                      <div style={{ background: "var(--color-ink-50)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "10px 12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--color-ink-400)" }}>
                          {visitSectionIcons(v) && <span style={{ letterSpacing: 2 }}>{visitSectionIcons(v)}</span>}
                          {v.photo_count > 0 && <span style={{ fontSize: 12 }}>📸 {v.photo_count}</span>}
                        </div>
                        {v.good_news && (
                          <div style={{ fontSize: 13, color: "var(--color-ink-700)", marginTop: 6, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                            {v.good_news}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* What we know */}
              {memoryNotes.length > 0 && (
                <>
                  <SectionHeader style={{ marginTop: 24 }}>🧠 What we know<Count>{memoryNotes.length}</Count></SectionHeader>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {memoryNotes.map(n => (
                      <button
                        key={n.slug}
                        onClick={() => onOpenNote?.(n.slug)}
                        style={{
                          textAlign: "left", padding: "11px 13px", borderRadius: 10,
                          background: "var(--color-ink-50)", border: "1px solid var(--color-border)",
                          cursor: onOpenNote ? "pointer" : "default", font: "inherit",
                        }}
                      >
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--color-ink-900)", marginBottom: 3 }}>{n.title}</div>
                        {n.summary && <div style={{ fontSize: 12.5, color: "var(--color-ink-500)", lineHeight: 1.4, marginBottom: 7 }}>{n.summary}</div>}
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--color-tc-600)" }}>↳ open note →</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {/* ===== PEOPLE ===== */}
          {!loading && store && tab === "people" && (
            staff.length === 0 ? (
              <p style={emptyLine}>No people logged for this store yet.</p>
            ) : (
              <div>
                {staff.map((s, idx) => (
                  <div
                    key={s.id}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 0", borderBottom: idx < staff.length - 1 ? "1px solid var(--color-border)" : "none" }}
                  >
                    <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 999, flexShrink: 0, background: s.is_ally ? "var(--color-section-green-bg)" : "var(--color-ink-100)", color: s.is_ally ? "var(--color-tc-600)" : "var(--color-ink-500)" }}>
                      {s.is_ally ? "ally" : (s.role ?? "staff")}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <button
                        onClick={() => setStaffDetail({ id: s.id, name: s.name })}
                        style={{ font: "inherit", background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13.5, fontWeight: 700, color: "var(--color-tc-600)", textDecoration: "underline", textUnderlineOffset: 2 }}
                      >{s.name}</button>
                      <div style={{ fontSize: 12.5, color: "var(--color-ink-400)" }}>
                        {s.role ?? "Staff"}
                        {(s.times_trained ?? 0) > 0 && ` · 🎓 ${s.times_trained}×`}
                        {(s.tagged_visits ?? 0) > 0 && ` · ${s.tagged_visits} visit${s.tagged_visits !== 1 ? "s" : ""}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* ===== PHOTOS ===== */}
          {!loading && store && tab === "photos" && (
            <>
              <a
                href={`/visits/store/${store.id}`}
                style={{
                  display: "block", textAlign: "center", padding: "11px", borderRadius: 11, marginBottom: 16,
                  border: "1px dashed var(--color-tc-100)", background: "var(--color-tc-50)",
                  color: "var(--color-tc-600)", fontWeight: 700, fontSize: 13.5, textDecoration: "none",
                }}
              >🔍 Review &amp; annotate photos →</a>
              {photoWeeks.length === 0 ? (
                <p style={emptyLine}>No photos yet.</p>
              ) : (
                photoWeeks.map(w => (
                  <div key={w.key} style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-ink-400)", fontWeight: 700, marginBottom: 8 }}>{w.label}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: 8 }}>
                      {w.urls.map((url, i) => (
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
                ))
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Nested staff profile drawer ── */}
      {staffDetail && store && (
        <div
          style={{
            position: "fixed", top: 0, right: 0, bottom: 0, width: 460, zIndex: 220,
            background: "var(--color-surface)", borderLeft: "1px solid var(--color-border)",
            boxShadow: "-8px 0 32px rgba(0,0,0,0.14)", display: "flex", flexDirection: "column", overflow: "hidden",
          }}
        >
          <StaffDetailPanel
            staffId={staffDetail.id}
            staffName={staffDetail.name}
            storeName={store.name}
            onClose={() => setStaffDetail(null)}
            onOpenVisit={(sid) => { window.location.href = `/visits/store/${sid}`; }}
          />
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.82)", display: "flex", alignItems: "center", justifyContent: "center" }}
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

// ── small presentational helpers ──
const loadingStyle: React.CSSProperties = { fontSize: 13, color: "var(--color-ink-300)", textAlign: "center", paddingTop: 40 };
const emptyLine: React.CSSProperties = { fontSize: 13, color: "var(--color-ink-300)", padding: "4px 0 8px" };
const fuRow: React.CSSProperties = { display: "flex", gap: 9, alignItems: "flex-start", padding: "9px 0", borderBottom: "1px solid var(--color-border)" };
const fuMeta: React.CSSProperties = { fontSize: 11.5, color: "var(--color-ink-400)", marginTop: 2 };
const checkboxStyle: React.CSSProperties = { marginTop: 2, width: 16, height: 16, accentColor: "var(--color-tc-600)", flexShrink: 0, cursor: "pointer" };
const completedToggle: React.CSSProperties = { width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer", font: "inherit", fontSize: 12, color: "var(--color-ink-400)", fontWeight: 700, padding: "10px 0 4px" };

function SectionHeader({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", alignItems: "center", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--color-ink-300)", marginBottom: 9, ...style }}>
      {children}
    </div>
  );
}
function Count({ children }: { children: React.ReactNode }) {
  return <span style={{ marginLeft: 7, background: "var(--color-ink-100)", color: "var(--color-ink-500)", borderRadius: 999, padding: "1px 8px", fontSize: 10.5 }}>{children}</span>;
}
