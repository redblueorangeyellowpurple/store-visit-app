"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { TrainedStaffItem, FollowUpItem } from "@/lib/queries";

// ─── Types ────────────────────────────────────────────────────────────────────

interface VisitRow {
  id: string;
  visit_date: string;
  cm_name: string;
  store_id: string;
  store_name: string;
  store_chain: string;
  store_market: string;
  store_tier: "T1" | "T2" | "T3" | "T4" | null;
  good_news: string | null;
  competitors: string | null;
  display_stock: string | null;
  follow_up: string | null;
  buzz_plan: string | null;
  photo_count: number;
  photo_urls: string[];
  edited_at: string | null;
  training_count: number;
  follow_up_count: number;
  trained_staff: TrainedStaffItem[];
  follow_up_items: FollowUpItem[];
}

interface CMOption { telegram_id: number; name: string }
interface User { first_name: string; username?: string }

interface StoreNode { id: string; name: string; tier: string | null }
interface ChainNode { chain: string; stores: StoreNode[] }
interface MarketNode { market: string; flag: string; chains: ChainNode[] }
interface BrowseTree { markets: MarketNode[] }

// ─── Selection ────────────────────────────────────────────────────────────────

type Selection =
  | { type: "all" }
  | { type: "market"; market: string; flag: string }
  | { type: "chain"; market: string; flag: string; chain: string }
  | { type: "store"; storeId: string; storeName: string; market: string; flag: string; chain: string };

function selectionLabel(s: Selection): string {
  switch (s.type) {
    case "all":    return "All Markets";
    case "market": return `${s.flag} ${s.market}`;
    case "chain":  return `${s.flag} ${s.chain}`;
    case "store":  return s.storeName;
  }
}

function selectionParams(s: Selection): URLSearchParams {
  const p = new URLSearchParams();
  if (s.type === "market") p.set("market", s.market);
  if (s.type === "chain")  { p.set("market", s.market); p.set("chain", s.chain); }
  if (s.type === "store")  p.set("store", s.storeId);
  return p;
}

// ─── Section definitions ──────────────────────────────────────────────────────

const SECTIONS = [
  { key: "good_news",     label: "Good News",         icon: "🌟", iconBg: "var(--color-section-amber-bg)",  color: "var(--color-tc-600)" },
  { key: "competitors",   label: "Competitors",        icon: "🔍", iconBg: "var(--color-section-blue-bg)",   color: "var(--color-tier-t1-fg)" },
  { key: "display_stock", label: "Display & Stock",    icon: "📦", iconBg: "var(--color-section-green-bg)",  color: "var(--color-tier-t2-fg)" },
  { key: "follow_up",     label: "Follow Up",          icon: "✅", iconBg: "var(--color-section-pink-bg)",   color: "#C0185A" },
  { key: "buzz_plan",     label: "Buzz Plan",          icon: "⚡", iconBg: "var(--color-section-purple-bg)", color: "#5B2DB5" },
  { key: "trainings",     label: "Trainings",          icon: "🎓", iconBg: "var(--color-section-green-bg)",  color: "var(--color-tier-t2-fg)" },
  { key: "follow_ups",    label: "Follow-ups",         icon: "📌", iconBg: "var(--color-section-pink-bg)",   color: "#C0185A" },
] as const;

type SectionKey = typeof SECTIONS[number]["key"];

const TIER_STYLE: Record<string, { bg: string; color: string }> = {
  T1: { bg: "var(--color-tier-t1-bg)", color: "var(--color-tier-t1-fg)" },
  T2: { bg: "var(--color-tier-t2-bg)", color: "var(--color-tier-t2-fg)" },
  T3: { bg: "var(--color-tier-t3-bg)", color: "var(--color-tier-t3-fg)" },
  T4: { bg: "var(--color-tier-t4-bg)", color: "var(--color-tier-t4-fg)" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function dayLabel(d: string): string {
  const date = new Date(d + "T00:00:00");
  const today = new Date();
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const fmt = (x: Date) => x.toISOString().slice(0, 10);
  if (d === fmt(today)) return "Today";
  if (d === fmt(yesterday)) return "Yesterday";
  return date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

function visitMatchesSection(v: VisitRow, key: SectionKey): boolean {
  if (key === "trainings")  return v.training_count > 0;
  if (key === "follow_ups") return v.follow_up_count > 0;
  return !!v[key as keyof VisitRow];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VisitsPage() {
  const [user,          setUser]          = useState<User | null>(null);
  const [visits,        setVisits]        = useState<VisitRow[]>([]);
  const [total,         setTotal]         = useState(0);
  const [loading,       setLoading]       = useState(false);
  const [cms,           setCms]           = useState<CMOption[]>([]);
  const [filterCM,      setFilterCM]      = useState("");
  const [tree,          setTree]          = useState<BrowseTree | null>(null);
  const [selection,     setSelection]     = useState<Selection>({ type: "all" });
  const [openMarkets,   setOpenMarkets]   = useState<Set<string>>(new Set(["SG"]));
  const [openChains,    setOpenChains]    = useState<Set<string>>(new Set());
  const [focusSection,  setFocusSection]  = useState<SectionKey | null>(null);
  const [lightbox,      setLightbox]      = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  // Bootstrap
  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => { if (d) setUser(d); });
    fetch("/api/filters").then(r => r.ok ? r.json() : null).then(d => { if (d) setCms(d.cms); });
    fetch("/api/browse").then(r => r.ok ? r.json() : null).then(d => { if (d) setTree(d); });
  }, []);

  // Fetch visits whenever selection or CM filter changes
  const fetchVisits = useCallback(async () => {
    setLoading(true);
    const p = selectionParams(selection);
    if (filterCM) p.set("cm", filterCM);
    const res = await fetch(`/api/visits?${p}`);
    if (res.ok) {
      const data = await res.json();
      setVisits(data.visits);
      setTotal(data.total);
    }
    setLoading(false);
    feedRef.current?.scrollTo({ top: 0 });
  }, [selection, filterCM]);

  useEffect(() => { fetchVisits(); }, [fetchVisits]);

  if (!user) return null;

  // Filter by section focus
  const filtered = focusSection === null
    ? visits
    : visits.filter(v => visitMatchesSection(v, focusSection));

  // Group by date for day dividers
  const byDate = new Map<string, VisitRow[]>();
  for (const v of filtered) {
    const list = byDate.get(v.visit_date) ?? [];
    list.push(v);
    byDate.set(v.visit_date, list);
  }
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

  function toggleMarket(m: string) {
    setOpenMarkets(prev => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });
  }

  function toggleChain(key: string) {
    setOpenChains(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function selectNode(s: Selection) {
    setSelection(s);
    setFocusSection(null);
  }

  return (
    <div>
      <NavBar user={user} />

      <div className="visits-inbox">

        {/* ── LEFT SIDEBAR ──────────────────────────────────── */}
        <div className="visits-sidebar">
          <div className="visits-sidebar-inner">

            {/* CM filter */}
            <p className="vsb-section-label">Filter</p>
            {cms.length > 0 && (
              <select
                value={filterCM}
                onChange={e => setFilterCM(e.target.value)}
                className="filter-select"
                style={{ width: "100%", marginBottom: 10 }}
              >
                <option value="">All CMs</option>
                {cms.map(c => <option key={c.telegram_id} value={c.telegram_id}>{c.name}</option>)}
              </select>
            )}

            {/* Section chips */}
            <div className="section-chips" style={{ marginBottom: 2 }}>
              <button
                className={`section-chip${focusSection === null ? " active" : ""}`}
                onClick={() => setFocusSection(null)}
              >All</button>
              {SECTIONS.map(s => (
                <button
                  key={s.key}
                  className={`section-chip${focusSection === s.key ? " active" : ""}`}
                  onClick={() => setFocusSection(curr => curr === s.key ? null : s.key)}
                >
                  {s.icon} {s.label}
                </button>
              ))}
            </div>

            <hr className="vsb-divider" />

            {/* Browse tree */}
            <p className="vsb-section-label">Browse</p>

            {/* All */}
            <div
              className={`tree-node${selection.type === "all" ? " active" : ""}`}
              onClick={() => selectNode({ type: "all" })}
            >
              <span style={{ fontSize: 12, width: 12 }} />
              🌐 All Markets
            </div>

            {/* Markets */}
            {tree?.markets.map(m => {
              const mOpen = openMarkets.has(m.market);
              const mActive = selection.type === "market" && selection.market === m.market;
              return (
                <div key={m.market}>
                  <div
                    className={`tree-node${mActive ? " active" : ""}`}
                    onClick={() => {
                      toggleMarket(m.market);
                      selectNode({ type: "market", market: m.market, flag: m.flag });
                    }}
                  >
                    <span className={`tree-chevron${mOpen ? " open" : ""}`}>›</span>
                    {m.flag} {m.market}
                  </div>

                  {mOpen && m.chains.map(ch => {
                    const chainKey = `${m.market}::${ch.chain}`;
                    const chOpen = openChains.has(chainKey);
                    const chActive = selection.type === "chain" && selection.market === m.market && selection.chain === ch.chain;
                    return (
                      <div key={chainKey}>
                        <div
                          className={`tree-node tree-indent-1${chActive ? " active" : ""}`}
                          onClick={() => {
                            toggleChain(chainKey);
                            selectNode({ type: "chain", market: m.market, flag: m.flag, chain: ch.chain });
                          }}
                        >
                          <span className={`tree-chevron${chOpen ? " open" : ""}`}>›</span>
                          {ch.chain}
                        </div>

                        {chOpen && ch.stores.map(st => {
                          const stActive = selection.type === "store" && selection.storeId === st.id;
                          return (
                            <div
                              key={st.id}
                              className={`tree-node tree-indent-2${stActive ? " active" : ""}`}
                              onClick={() => selectNode({ type: "store", storeId: st.id, storeName: st.name, market: m.market, flag: m.flag, chain: ch.chain })}
                            >
                              {st.tier && (
                                <span style={{
                                  fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 4,
                                  background: TIER_STYLE[st.tier]?.bg, color: TIER_STYLE[st.tier]?.color,
                                  flexShrink: 0,
                                }}>{st.tier}</span>
                              )}
                              {st.name}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}

          </div>
        </div>

        {/* ── RIGHT FEED PANEL ──────────────────────────────── */}
        <div className="visits-feed-panel">

          {/* Header */}
          <div className="vfp-header">
            <span className="vfp-title">{selectionLabel(selection)}</span>
            <span className="vfp-count">
              {loading ? "Loading…" : `${total} visit${total !== 1 ? "s" : ""}`}
              {focusSection && ` · ${SECTIONS.find(s => s.key === focusSection)?.icon} ${SECTIONS.find(s => s.key === focusSection)?.label}`}
            </span>
          </div>

          {/* Feed */}
          <div className="vfp-scroll" ref={feedRef}>
            {loading ? (
              <div className="empty-state">
                <p style={{ color: "var(--color-ink-300)", fontSize: 13 }}>Loading…</p>
              </div>
            ) : filtered.length === 0 ? (
              <div className="empty-state">
                <p className="empty-state-icon">📋</p>
                <p>No visits {focusSection ? `with ${SECTIONS.find(s => s.key === focusSection)?.label}` : ""} for this scope.</p>
              </div>
            ) : (
              <div>
                {dates.map(date => (
                  <div key={date}>
                    <div className="day-divider">
                      <hr className="day-divider-line" />
                      <span className="day-divider-label">{dayLabel(date)}</span>
                      <hr className="day-divider-line" />
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {(byDate.get(date) ?? []).map(v => (
                        <VisitCard
                          key={v.id}
                          v={v}
                          focusSection={focusSection}
                          onPhoto={setLightbox}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightbox} alt="Photo" className="lightbox-img" />
          <button className="lightbox-close" onClick={() => setLightbox(null)}>Close</button>
        </div>
      )}
    </div>
  );
}

// ─── Visit Card ───────────────────────────────────────────────────────────────

function VisitCard({
  v,
  focusSection,
  onPhoto,
}: {
  v: VisitRow;
  focusSection: SectionKey | null;
  onPhoto: (url: string) => void;
}) {
  const tier = v.store_tier;
  const ts   = tier ? TIER_STYLE[tier] : null;

  // Which text sections to show
  const textSections = SECTIONS
    .filter(s => s.key !== "trainings" && s.key !== "follow_ups")
    .filter(s => {
      if (focusSection && focusSection !== "trainings" && focusSection !== "follow_ups") {
        return s.key === focusSection && !!v[s.key as keyof VisitRow];
      }
      return !!v[s.key as keyof VisitRow];
    });

  const showTrainings = (focusSection === null || focusSection === "trainings") && v.training_count > 0;
  const showFollowUps = (focusSection === null || focusSection === "follow_ups") && v.follow_up_count > 0;

  const hasContent = textSections.length > 0 || showTrainings || showFollowUps || v.photo_count > 0;

  return (
    <div className="visit-card">
      {/* Card header */}
      <div className="visit-card-header" style={{ cursor: "default" }}>
        {ts && (
          <span className="tier-badge" style={{ background: ts.bg, color: ts.color }}>{tier}</span>
        )}
        <div className="visit-card-store">
          <Link href={`/visits/store/${v.store_id}`} className="visit-store-name visit-store-link">
            {v.store_name}
          </Link>
          <div className="visit-meta-row">
            <span className="visit-meta-item">{v.cm_name}</span>
            <span className="visit-meta-item">·</span>
            <span className="visit-meta-item">{fmtDate(v.visit_date)}</span>
            {v.photo_count > 0 && (
              <><span className="visit-meta-item">·</span><span className="visit-meta-item">📸 {v.photo_count}</span></>
            )}
            {v.training_count > 0 && (
              <><span className="visit-meta-item">·</span><span className="visit-meta-item">🎓 {v.training_count} trained</span></>
            )}
            {v.follow_up_count > 0 && (
              <><span className="visit-meta-item">·</span><span className="visit-meta-item">📌 {v.follow_up_count} follow-up{v.follow_up_count !== 1 ? "s" : ""}</span></>
            )}
            {v.edited_at && (
              <><span className="visit-meta-item">·</span><span className="visit-meta-item" style={{ color: "var(--color-ink-300)" }}>edited</span></>
            )}
          </div>
        </div>
      </div>

      {/* Card body */}
      <div className="visit-detail">
        {/* Photo strip */}
        {v.photo_urls.length > 0 && (
          <div className="photo-strip-wrap">
            <div className="photo-strip">
              {v.photo_urls.map((url, i) => (
                <button key={i} className="photo-thumb" onClick={() => onPhoto(url)}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Photo ${i + 1}`} />
                </button>
              ))}
            </div>
          </div>
        )}

        {!hasContent ? (
          <p style={{ fontSize: 13, color: "var(--color-ink-300)", paddingTop: 14 }}>
            No notes were added for this visit.
          </p>
        ) : (
          <div className="visit-sections-grid" style={{ paddingTop: v.photo_urls.length > 0 ? 8 : 14 }}>

            {/* Text section cards */}
            {textSections.map(s => (
              <div
                key={s.key}
                className="visit-section-card"
                style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
              >
                <div className="visit-section-label" style={{ color: s.color }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, borderRadius: 6, background: s.iconBg, fontSize: 11,
                  }}>{s.icon}</span>
                  <span>{s.label}</span>
                </div>
                <p className="visit-section-text">{v[s.key as keyof VisitRow] as string}</p>
              </div>
            ))}

            {/* Trainings Logged */}
            {showTrainings && (
              <div
                className="visit-section-card"
                style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
              >
                <div className="visit-section-label" style={{ color: "var(--color-tier-t2-fg)" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, borderRadius: 6, background: "var(--color-section-green-bg)", fontSize: 11,
                  }}>🎓</span>
                  <span>Trainings Logged</span>
                </div>
                <div className="sc-staff-list">
                  {v.trained_staff.map((ts, i) => (
                    <div key={i} className="sc-staff-row">
                      <span className="pill-trained">Trained</span>
                      <div>
                        <div className="sc-staff-name">{ts.name}</div>
                        {ts.products && <div className="sc-staff-products">{ts.products}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Follow-ups */}
            {showFollowUps && (
              <div
                className="visit-section-card"
                style={{ background: "var(--color-surface)", border: "1px solid var(--color-border)" }}
              >
                <div className="visit-section-label" style={{ color: "#C0185A" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, borderRadius: 6, background: "var(--color-section-pink-bg)", fontSize: 11,
                  }}>📌</span>
                  <span>Follow-ups</span>
                </div>
                <div className="sc-fu-list">
                  {v.follow_up_items.map(fu => (
                    <div key={fu.id} className="sc-fu-row">
                      <div className={`sc-fu-check${fu.status === "done" ? " done" : ""}`} />
                      <div>
                        <div className={`sc-fu-title${fu.status === "done" ? " done" : ""}`}>{fu.title}</div>
                        {fu.due_date && (
                          <div className="sc-fu-due">Due {fmtDate(fu.due_date)}</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
