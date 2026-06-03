"use client";

// Store / CM / Staff detail panels for the right-hand drawer.
// Shared by /visits (Store Updates) and the dashboard. Each panel fetches its
// own data by id and is driven entirely through callback props, so the host
// page decides what "open a visit / CM / store / note" means (scroll the feed
// on /visits, or deep-link to /visits from the dashboard).

import { useEffect, useState } from "react";
import {
  CMDetailInfo, StaffDetailInfo, StaffRow, StoreVisitSummary, StoreMemoryNote, StoreOpenTask,
} from "@/lib/queries";
import {
  VisitRow, MARKET_FLAG, TIER_STYLE, SECTIONS, TEXT_SECTION_KEYS, fmtDate, fmtDateFull, storeSectionIcons,
} from "@/lib/visit-shared";

// ─── Store Detail Panel ───────────────────────────────────────────────────────

export function StoreDetailPanel({
  storeId, storeName, onClose, onOpenCM, onOpenStaff, onOpenVisit, onOpenNote,
}: {
  storeId: string;
  storeName: string;
  onClose: () => void;
  onOpenCM: (id: number, name: string, market: string) => void;
  onOpenStaff: (staffId: string, staffName: string, storeName: string) => void;
  onOpenVisit: (storeId: string, storeName: string, visitId: string) => void;
  onOpenNote: (slug: string) => void;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [data, setData] = useState<{
    store: { id: string; name: string; chain: string; market: string; tier: string | null } | null;
    visits: StoreVisitSummary[];
    staff: StaffRow[];
    memory_notes: StoreMemoryNote[];
    open_tasks: StoreOpenTask[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/visits/store/${storeId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); setLoading(false); });
  }, [storeId]);

  const visits       = data?.visits ?? [];
  const store        = data?.store;
  const staff        = data?.staff ?? [];
  const memoryNotes  = data?.memory_notes ?? [];
  const openTasks    = data?.open_tasks ?? [];

  const lastVisitDate = visits[0]?.visit_date;

  const tierStyle = store?.tier ? TIER_STYLE[store.tier] : null;

  return (
    <>
      {/* Header */}
      <div className="vdp-header">
        <div className="vdp-header-row">
          <div style={{ minWidth: 0, flex: 1 }}>
            {store?.tier && tierStyle && (
              <span style={{
                display: "inline-block", fontSize: 9, fontWeight: 800,
                padding: "2px 6px", borderRadius: 5, marginBottom: 4,
                background: tierStyle.bg, color: tierStyle.color,
                textTransform: "uppercase", letterSpacing: "0.5px",
              }}>{store.tier}</span>
            )}
            <div className="vdp-title">{loading ? storeName : (store?.name ?? storeName)}</div>
            {store && <div className="vdp-sub">{MARKET_FLAG[store.market] ?? ""} {store.chain} · {store.market}</div>}
          </div>
          <button className="vdp-close" onClick={onClose}>✕</button>
        </div>
        <a
          href={`/visits/store/${storeId}`}
          target="_blank"
          rel="noreferrer"
          className="vdp-review-link"
        >
          🖼️ Open photo review →
        </a>
      </div>

      {/* Single scrollable body — no tabs */}
      <div className="vdp-scroll">
        {loading ? (
          <p style={{ fontSize: 13, color: "var(--color-ink-300)", textAlign: "center", paddingTop: 32 }}>Loading…</p>
        ) : (
          <>
            {/* KV info */}
            <div className="vdp-kv-list">
              {store?.tier && tierStyle && (
                <div className="vdp-kv-row">
                  <span className="vdp-kv-label">Tier</span>
                  <span className="vdp-kv-val">
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: tierStyle.bg, color: tierStyle.color }}>{store.tier}</span>
                  </span>
                </div>
              )}
              {store?.chain && (
                <div className="vdp-kv-row">
                  <span className="vdp-kv-label">Chain</span>
                  <span className="vdp-kv-val">{store.chain}</span>
                </div>
              )}
              {store?.market && (
                <div className="vdp-kv-row">
                  <span className="vdp-kv-label">Market</span>
                  <span className="vdp-kv-val">{MARKET_FLAG[store.market] ?? ""} {store.market}</span>
                </div>
              )}
              {lastVisitDate && (
                <div className="vdp-kv-row">
                  <span className="vdp-kv-label">Last visit</span>
                  <span className="vdp-kv-val">{fmtDateFull(lastVisitDate)}</span>
                </div>
              )}
            </div>

            {/* Tasks — open by default, completed collapsed */}
            {(() => {
              const open = openTasks.filter(t => t.status !== "done");
              const done = openTasks.filter(t => t.status === "done");
              if (open.length === 0 && done.length === 0) return null;
              return (
                <>
                  {open.length > 0 && (
                    <>
                      <div className="vdp-section-header">
                        📌 Open Tasks<span className="vdp-section-count">{open.length}</span>
                      </div>
                      <div>
                        {open.map(t => (
                          <div
                            key={t.id}
                            className="vdp-item"
                            onClick={() => onOpenVisit(storeId, store?.name ?? storeName, t.visit_id)}
                          >
                            <div className="sc-fu-check" style={{ flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div className="vdp-item-name">{t.title}</div>
                              <div className="vdp-item-meta">
                                {t.due_date && <>Due {fmtDate(t.due_date)}</>}
                                {t.due_date && t.cm_name && <> · </>}
                                {t.cm_name && <>{t.cm_name}</>}
                                {(t.due_date || t.cm_name) && t.visit_date && <> · </>}
                                {t.visit_date && <>from {fmtDate(t.visit_date)} visit</>}
                              </div>
                            </div>
                            <span className="vdp-item-chev">›</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                  {done.length > 0 && (
                    <>
                      <button
                        className="vdp-section-header"
                        onClick={() => setShowCompleted(v => !v)}
                        style={{ width: "100%", textAlign: "left", background: "none", border: 0, cursor: "pointer", font: "inherit" }}
                      >
                        <span style={{ display: "inline-block", transform: showCompleted ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>›</span>
                        {" "}Completed<span className="vdp-section-count">{done.length}</span>
                      </button>
                      {showCompleted && (
                        <div>
                          {done.map(t => (
                            <div
                              key={t.id}
                              className="vdp-item"
                              onClick={() => onOpenVisit(storeId, store?.name ?? storeName, t.visit_id)}
                              style={{ opacity: 0.7 }}
                            >
                              <div className="sc-fu-check done" style={{ flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div className="vdp-item-name" style={{ textDecoration: "line-through" }}>{t.title}</div>
                                <div className="vdp-item-meta">
                                  {t.cm_name && <>{t.cm_name}</>}
                                  {t.cm_name && t.visit_date && <> · </>}
                                  {t.visit_date && <>from {fmtDate(t.visit_date)} visit</>}
                                </div>
                              </div>
                              <span className="vdp-item-chev">›</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              );
            })()}

            {/* Past Visits */}
            <div className="vdp-section-header">
              Past Visits{visits.length > 0 && <span className="vdp-section-count">{visits.length}</span>}
            </div>
            {visits.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--color-ink-300)", textAlign: "center", padding: "8px 0 16px" }}>No visits logged yet.</p>
            ) : (
              <div>
                {visits.map(v => (
                  <div
                    key={v.id}
                    className="vdp-item"
                    onClick={() => onOpenVisit(storeId, store?.name ?? storeName, v.id)}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="vdp-item-name">{fmtDateFull(v.visit_date)}</div>
                      <div className="vdp-item-meta">
                        <button
                          className="visit-cm-link"
                          style={{ fontSize: 11.5 }}
                          onClick={(e) => { e.stopPropagation(); if (v.cm_telegram_id) onOpenCM(v.cm_telegram_id, v.cm_name, store?.market ?? ""); }}
                        >{v.cm_name}</button>
                        {storeSectionIcons(v) && <> · {storeSectionIcons(v)}</>}
                        {v.photo_count > 0 && <> · 📸 {v.photo_count}</>}
                      </div>
                    </div>
                    <span className="vdp-item-chev">›</span>
                  </div>
                ))}
              </div>
            )}

            {/* Store Staff */}
            {staff.length > 0 && (
              <>
                <div className="vdp-section-header">
                  Staff<span className="vdp-section-count">{staff.length}</span>
                </div>
                <div>
                  {staff.map(s => (
                    <div
                      key={s.id}
                      className="vdp-item"
                      onClick={() => onOpenStaff(s.id, s.name, store?.name ?? storeName)}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="vdp-item-name">
                          {s.name}
                          {s.is_ally && <span className="ally-badge-small">🤝</span>}
                        </div>
                        <div className="vdp-item-meta">
                          {s.role ?? "Staff"}
                          {(s.times_trained ?? 0) > 0 && <> · 🎓 {s.times_trained}×</>}
                          {(s.tagged_visits ?? 0) > 0 && <> · {s.tagged_visits} visit{s.tagged_visits !== 1 ? "s" : ""}</>}
                        </div>
                      </div>
                      <span className="vdp-item-chev">›</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Memory Notes */}
            {memoryNotes.length > 0 && (
              <>
                <div className="vdp-section-header">
                  📝 Notes<span className="vdp-section-count">{memoryNotes.length}</span>
                </div>
                <div>
                  {memoryNotes.map(n => (
                    <div
                      key={n.slug}
                      className="vdp-memory-note"
                      onClick={() => onOpenNote(n.slug)}
                      style={{ cursor: "pointer" }}
                    >
                      <div className="vdp-memory-note-title">{n.title}</div>
                      {n.summary && <div className="vdp-memory-note-summary">{n.summary}</div>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

// ─── CM Detail Panel ──────────────────────────────────────────────────────────

export function CMDetailPanel({
  telegramId, name, market, tab, onTabChange, onClose, onOpenStore, onOpenVisit, onOpenNote,
}: {
  telegramId: number;
  name: string;
  market: string;
  tab: "visits" | "stores";
  onTabChange: (t: "visits" | "stores") => void;
  onClose: () => void;
  onOpenStore: (storeId: string, storeName: string) => void;
  onOpenVisit: (storeId: string, storeName: string, visitId: string) => void;
  onOpenNote: (slug: string) => void;
}) {
  const [data, setData] = useState<{ cm: CMDetailInfo | null; visits: VisitRow[]; memory_notes: StoreMemoryNote[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/visits/cm/${telegramId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); setLoading(false); });
  }, [telegramId]);

  const cm          = data?.cm;
  const stores      = cm?.assigned_stores ?? [];
  const visits      = data?.visits ?? [];
  const memoryNotes = data?.memory_notes ?? [];

  function visitSectionIcons(v: VisitRow): string {
    return TEXT_SECTION_KEYS
      .filter(k => !!v[k as keyof VisitRow])
      .map(k => SECTIONS.find(s => s.key === k)?.icon ?? "")
      .join(" ");
  }

  return (
    <>
      <div className="vdp-header">
        <div className="vdp-header-row">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="vdp-sub" style={{ marginBottom: 2 }}>{MARKET_FLAG[market] ?? ""} {market} · Channel Manager</div>
            <div className="vdp-title">{cm?.full_name ?? name}</div>
            {cm?.am_name && <div className="vdp-sub">AM: {cm.am_name}</div>}
          </div>
          <button className="vdp-close" onClick={onClose}>✕</button>
        </div>
      </div>

      {/* Tabs — Visits first */}
      <div className="vdp-tabs">
        <button className={`vdp-tab${tab === "visits" ? " active" : ""}`} onClick={() => onTabChange("visits")}>
          Visits {!loading && `(${visits.length})`}
        </button>
        <button className={`vdp-tab${tab === "stores" ? " active" : ""}`} onClick={() => onTabChange("stores")}>
          Stores {!loading && `(${stores.length})`}
        </button>
      </div>

      <div className="vdp-scroll">
        {loading ? (
          <p style={{ fontSize: 13, color: "var(--color-ink-300)", textAlign: "center", paddingTop: 32 }}>Loading…</p>
        ) : tab === "visits" ? (
          visits.length === 0 ? (
            <div className="vdp-empty">
              <div className="vdp-empty-icon">📋</div>
              <div className="vdp-empty-title">No visits yet</div>
            </div>
          ) : (
            <div>
              {visits.map(v => (
                <div key={v.id} className="vdp-item" onClick={() => onOpenVisit(v.store_id, v.store_name, v.id)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="vdp-item-name">{v.store_name}</div>
                    <div className="vdp-item-meta">
                      {fmtDate(v.visit_date)}
                      {visitSectionIcons(v) && <> · {visitSectionIcons(v)}</>}
                      {v.photo_count > 0 && <> · 📸 {v.photo_count}</>}
                    </div>
                  </div>
                  <span className="vdp-item-chev">›</span>
                </div>
              ))}
            </div>
          )
        ) : (
          stores.length === 0 ? (
            <div className="vdp-empty">
              <div className="vdp-empty-icon">🏪</div>
              <div className="vdp-empty-title">No stores assigned</div>
            </div>
          ) : (
            <div>
              {stores.map(s => {
                const ts = s.tier ? TIER_STYLE[s.tier] : null;
                return (
                  <div key={s.id} className="vdp-item" onClick={() => onOpenStore(s.id, s.name)}>
                    {ts && (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 4,
                        background: ts.bg, color: ts.color, flexShrink: 0,
                      }}>{s.tier}</span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="vdp-item-name">{s.name}</div>
                      <div className="vdp-item-meta">{s.chain} · {s.market}</div>
                    </div>
                    <span className="vdp-item-chev">›</span>
                  </div>
                );
              })}
            </div>
          )
        )}

        {/* Memory Notes (shown regardless of active tab) */}
        {!loading && memoryNotes.length > 0 && (
          <>
            <div className="vdp-section-header">
              📝 Notes<span className="vdp-section-count">{memoryNotes.length}</span>
            </div>
            <div>
              {memoryNotes.map(n => (
                <div
                  key={n.slug}
                  className="vdp-memory-note"
                  onClick={() => onOpenNote(n.slug)}
                  style={{ cursor: "pointer" }}
                >
                  <div className="vdp-memory-note-title">{n.title}</div>
                  {n.summary && <div className="vdp-memory-note-summary">{n.summary}</div>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ─── Staff Detail Panel ───────────────────────────────────────────────────────

export function StaffDetailPanel({
  staffId, staffName, storeName, onClose, onOpenVisit,
}: {
  staffId: string;
  staffName: string;
  storeName: string;
  onClose: () => void;
  onOpenVisit: (storeId: string, storeName: string, visitId: string) => void;
}) {
  const [data, setData] = useState<StaffDetailInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/visits/staff/${staffId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); setLoading(false); });
  }, [staffId]);

  return (
    <>
      <div className="vdp-header">
        <div className="vdp-header-row">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="vdp-sub" style={{ marginBottom: 2 }}>🏪 {data?.store_name ?? storeName}</div>
            <div className="vdp-title">{data?.name ?? staffName}</div>
            {data?.role && <div className="vdp-sub">{data.role}</div>}
          </div>
          <button className="vdp-close" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="vdp-scroll">
        {loading ? (
          <p style={{ fontSize: 13, color: "var(--color-ink-300)", textAlign: "center", paddingTop: 32 }}>Loading…</p>
        ) : !data ? (
          <div className="vdp-empty">
            <div className="vdp-empty-icon">👤</div>
            <div className="vdp-empty-title">Staff not found</div>
          </div>
        ) : (
          <>
            <div className="vdp-kv-list">
              {data.role && (
                <div className="vdp-kv-row">
                  <span className="vdp-kv-label">Role</span>
                  <span className="vdp-kv-val">{data.role}</span>
                </div>
              )}
              {data.phone && (
                <div className="vdp-kv-row">
                  <span className="vdp-kv-label">Phone</span>
                  <span className="vdp-kv-val">{data.phone}</span>
                </div>
              )}
              {data.is_ally && (
                <div className="vdp-kv-row">
                  <span className="vdp-kv-label">Status</span>
                  <span className="vdp-kv-val">🤝 Ally</span>
                </div>
              )}
              <div className="vdp-kv-row">
                <span className="vdp-kv-label">Trained</span>
                <span className="vdp-kv-val">{data.times_trained}×</span>
              </div>
              <div className="vdp-kv-row">
                <span className="vdp-kv-label">Visit tags</span>
                <span className="vdp-kv-val">{data.tagged_visits}</span>
              </div>
              {data.last_trained_at && (
                <div className="vdp-kv-row">
                  <span className="vdp-kv-label">Last trained</span>
                  <span className="vdp-kv-val">{fmtDateFull(data.last_trained_at)}</span>
                </div>
              )}
            </div>

            {data.training_history.length > 0 && (
              <>
                <div className="vdp-section-header">
                  Training History<span className="vdp-section-count">{data.training_history.length}</span>
                </div>
                {data.training_history.map(t => (
                  <div
                    key={t.visit_id}
                    className="vdp-item"
                    onClick={() => onOpenVisit(t.store_id, t.store_name, t.visit_id)}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="vdp-item-name">{fmtDateFull(t.visit_date)}</div>
                      {t.products && <div className="vdp-item-meta">{t.products}</div>}
                    </div>
                    <span className="pill-trained" style={{ flexShrink: 0, fontSize: 10 }}>Trained</span>
                  </div>
                ))}
              </>
            )}

            {data.tagged_visit_history.length > 0 && (
              <>
                <div className="vdp-section-header">
                  Visit History<span className="vdp-section-count">{data.tagged_visit_history.length}</span>
                </div>
                {data.tagged_visit_history.map(v => (
                  <div
                    key={v.visit_id}
                    className="vdp-item"
                    onClick={() => onOpenVisit(v.store_id, v.store_name, v.visit_id)}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="vdp-item-name">{fmtDateFull(v.visit_date)}</div>
                      <div className="vdp-item-meta">{v.store_name}</div>
                    </div>
                    {v.was_trained && <span className="pill-trained" style={{ flexShrink: 0, fontSize: 10 }}>Trained</span>}
                  </div>
                ))}
              </>
            )}

            {data.training_history.length === 0 && data.tagged_visit_history.length === 0 && (
              <p style={{ fontSize: 13, color: "var(--color-ink-300)", textAlign: "center", paddingTop: 16 }}>No visit history yet.</p>
            )}
          </>
        )}
      </div>
    </>
  );
}
