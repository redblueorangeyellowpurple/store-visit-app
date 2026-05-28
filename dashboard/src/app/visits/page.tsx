"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { TrainedStaffItem, FollowUpItem, CMOption, StoreVisitSummary, CMDetailInfo, StaffRow, StaffDetailInfo, StoreMemoryNote } from "@/lib/queries";

// ─── Types ────────────────────────────────────────────────────────────────────

interface VisitRow {
  id: string;
  visit_date: string;
  cm_name: string;
  cm_telegram_id: number;
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
    case "all":    return "Store Updates";
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

// ─── Detail panel ─────────────────────────────────────────────────────────────

type DetailView =
  | { type: "store"; storeId: string; storeName: string }
  | { type: "cm"; telegramId: number; name: string; market: string }
  | { type: "staff"; staffId: string; staffName: string; storeName: string }
  | null;

// ─── Section definitions ──────────────────────────────────────────────────────

const SECTIONS = [
  { key: "good_news",     label: "Good News",         icon: "🌟", iconBg: "var(--color-section-amber-bg)",  color: "#92400E" },
  { key: "competitors",   label: "Competitors",        icon: "🔍", iconBg: "var(--color-section-blue-bg)",   color: "var(--color-tier-t1-fg)" },
  { key: "display_stock", label: "Display & Stock",    icon: "📦", iconBg: "var(--color-section-green-bg)",  color: "var(--color-tier-t2-fg)" },
  { key: "follow_up",     label: "Follow Up",          icon: "📌", iconBg: "var(--color-section-pink-bg)",   color: "#C0185A" },
  { key: "buzz_plan",     label: "Buzz Plan",          icon: "⚡", iconBg: "var(--color-section-purple-bg)", color: "#5B2DB5" },
  { key: "trainings",     label: "Trainings",          icon: "🎓", iconBg: "var(--color-section-green-bg)",  color: "var(--color-tier-t2-fg)" },
  { key: "follow_ups",    label: "Follow-ups",         icon: "📌", iconBg: "var(--color-section-pink-bg)",   color: "#C0185A" },
] as const;

// Text-only sections (used for pills + section blocks, not trainings/follow_ups rows)
const TEXT_SECTION_KEYS = ["good_news", "competitors", "display_stock", "follow_up", "buzz_plan"] as const;

type SectionKey = typeof SECTIONS[number]["key"];

// Markets for CM dropdown grouping
const MARKET_ORDER_CM = ["SG", "MY", "TH", "HK"];
const MARKET_FLAG_CM: Record<string, string> = { SG: "🇸🇬", MY: "🇲🇾", TH: "🇹🇭", HK: "🇭🇰" };
const MARKET_FLAG: Record<string, string>    = { SG: "🇸🇬", MY: "🇲🇾", TH: "🇹🇭", HK: "🇭🇰" };

// Tier ordering for browse tree
const TIER_ORDER: Record<string, number> = { T1: 0, T2: 1, T3: 2, T4: 3 };
function sortStoresByTier(stores: StoreNode[]): StoreNode[] {
  return [...stores].sort((a, b) => {
    const ta = a.tier ? (TIER_ORDER[a.tier] ?? 99) : 99;
    const tb = b.tier ? (TIER_ORDER[b.tier] ?? 99) : 99;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });
}

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

function fmtDateFull(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
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

function daysSince(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr + "T00:00:00").getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function visitMatchesSection(v: VisitRow, key: SectionKey): boolean {
  if (key === "trainings")  return v.training_count > 0;
  if (key === "follow_ups") return v.follow_up_count > 0;
  return !!v[key as keyof VisitRow];
}

// Section icons present in a StoreVisitSummary (for detail panel visits list)
function storeSectionIcons(v: StoreVisitSummary): string {
  return TEXT_SECTION_KEYS
    .filter(k => !!v[k as keyof StoreVisitSummary])
    .map(k => SECTIONS.find(s => s.key === k)?.icon ?? "")
    .join(" ");
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VisitsPage() {
  const [user,           setUser]           = useState<User | null>(null);
  const [visits,         setVisits]         = useState<VisitRow[]>([]);
  const [total,          setTotal]          = useState(0);
  const [loading,        setLoading]        = useState(false);
  const [cms,            setCms]            = useState<CMOption[]>([]);
  const [filterCMs,      setFilterCMs]      = useState<Set<string>>(new Set());
  const [filterPhotos,   setFilterPhotos]   = useState(false);
  const [dateFrom,       setDateFrom]       = useState("");
  const [dateTo,         setDateTo]         = useState("");
  const [tree,           setTree]           = useState<BrowseTree | null>(null);
  const [selection,      setSelection]      = useState<Selection>({ type: "all" });
  const [openMarkets,    setOpenMarkets]    = useState<Set<string>>(new Set(["SG"]));
  const [openChains,     setOpenChains]     = useState<Set<string>>(new Set());
  const [focusSections,  setFocusSections]  = useState<Set<SectionKey>>(new Set());
  const [expandedVisits, setExpandedVisits] = useState<Set<string>>(new Set());
  const [lightbox,       setLightbox]       = useState<string | null>(null);
  const [detail,         setDetail]         = useState<DetailView>(null);
  const [detailWidth,    setDetailWidth]    = useState(300);
  const feedRef                             = useRef<HTMLDivElement>(null);
  const [sidebarWidth,   setSidebarWidth]   = useState(340);
  const [cmDropdownOpen, setCmDropdownOpen] = useState(false);
  const cmDropdownRef                       = useRef<HTMLDivElement>(null);
  const dragState                           = useRef<{ startX: number; startWidth: number } | null>(null);
  const detailDrag                          = useRef<{ startX: number; startWidth: number } | null>(null);
  // CM panel tab lifted to parent so it persists across entity switches
  const [cmDetailTab,    setCmDetailTab]    = useState<"visits" | "stores">("visits");

  // Bootstrap
  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => { if (d) setUser(d); });
    fetch("/api/filters").then(r => r.ok ? r.json() : null).then(d => { if (d) setCms(d.cms); });
    fetch("/api/browse").then(r => r.ok ? r.json() : null).then(d => { if (d) setTree(d); });
  }, []);

  // Fetch visits whenever selection, CM filter, or date range changes
  const fetchVisits = useCallback(async () => {
    setLoading(true);
    const p = selectionParams(selection);
    if (filterCMs.size === 1) {
      p.set("cm", [...filterCMs][0]);
    } else if (filterCMs.size > 1) {
      p.set("cm", [...filterCMs].join(","));
    }
    if (dateFrom) p.set("from", dateFrom);
    if (dateTo)   p.set("to", dateTo);
    const res = await fetch(`/api/visits?${p}`);
    if (res.ok) {
      const data = await res.json();
      setVisits(data.visits);
      setTotal(data.total);
    }
    setLoading(false);
    feedRef.current?.scrollTo({ top: 0 });
  }, [selection, filterCMs, dateFrom, dateTo]);

  useEffect(() => { fetchVisits(); }, [fetchVisits]);

  // Close CM dropdown when clicking outside
  useEffect(() => {
    if (!cmDropdownOpen) return;
    function handleOutside(e: MouseEvent) {
      if (cmDropdownRef.current && !cmDropdownRef.current.contains(e.target as Node)) {
        setCmDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [cmDropdownOpen]);

  if (!user) return null;

  // filterPhotos = toggle to show/hide photo strips (not a visit filter)
  const photoFiltered = visits;

  // Client-side: section focus filter (OR — show if any selected section matches)
  const filtered = focusSections.size === 0
    ? photoFiltered
    : photoFiltered.filter(v => [...focusSections].some(k => visitMatchesSection(v, k)));

  // Group by date for day dividers
  const byDate = new Map<string, VisitRow[]>();
  for (const v of filtered) {
    const list = byDate.get(v.visit_date) ?? [];
    list.push(v);
    byDate.set(v.visit_date, list);
  }
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));

  function toggleMarket(m: string) {
    setOpenMarkets(prev => { const n = new Set(prev); n.has(m) ? n.delete(m) : n.add(m); return n; });
  }

  function toggleChain(key: string) {
    setOpenChains(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }

  function selectNode(s: Selection) {
    setSelection(s);
    setFocusSections(new Set());
    setExpandedVisits(new Set());
  }

  // Section chip click: toggle focus AND auto-expand matching visits
  function handleSectionChipClick(key: SectionKey) {
    setFocusSections(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      if (next.size > 0) {
        const matchIds = visits
          .filter(v => [...next].some(k => visitMatchesSection(v, k)))
          .map(v => v.id);
        setExpandedVisits(new Set(matchIds));
      }
      return next;
    });
  }

  function handleResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: sidebarWidth };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    function onMove(ev: MouseEvent) {
      if (!dragState.current) return;
      setSidebarWidth(Math.max(160, Math.min(620, dragState.current.startWidth + (ev.clientX - dragState.current.startX))));
    }
    function onUp() {
      dragState.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function handleDetailResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    detailDrag.current = { startX: e.clientX, startWidth: detailWidth };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    function onMove(ev: MouseEvent) {
      if (!detailDrag.current) return;
      setDetailWidth(Math.max(240, Math.min(560, detailDrag.current.startWidth + (detailDrag.current.startX - ev.clientX))));
    }
    function onUp() {
      detailDrag.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // Build CM groups for custom dropdown
  const cmsByMarketMap = new Map<string, CMOption[]>();
  for (const cm of cms) {
    const m = cm.market ?? "Other";
    if (!cmsByMarketMap.has(m)) cmsByMarketMap.set(m, []);
    cmsByMarketMap.get(m)!.push(cm);
  }
  const cmGroups = [
    ...MARKET_ORDER_CM.filter(m => cmsByMarketMap.has(m)).map(m => ({
      market: m, flag: MARKET_FLAG_CM[m] ?? m, cms: cmsByMarketMap.get(m)!,
    })),
    ...(cmsByMarketMap.has("Other") ? [{ market: "Other", flag: "🌐", cms: cmsByMarketMap.get("Other")! }] : []),
  ];

  const selectedCmLabel = filterCMs.size === 0
    ? "All Channel Managers"
    : filterCMs.size === 1
      ? (cms.find(c => filterCMs.has(String(c.telegram_id)))?.name ?? "1 CM")
      : `${filterCMs.size} CMs`;

  function toggleCM(id: string) {
    setFilterCMs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function toggleMarketCMs(mCms: CMOption[], allSelected: boolean) {
    setFilterCMs(prev => {
      const n = new Set(prev);
      for (const c of mCms) allSelected ? n.delete(String(c.telegram_id)) : n.add(String(c.telegram_id));
      return n;
    });
  }

  // All section emojis for "Store Updates" header when no filter active
  const ALL_SECTION_EMOJIS = SECTIONS.map(s => s.icon).join(" ");

  return (
    <div className="visits-page-root">
      <NavBar user={user} />

      <div className="visits-inbox">

        {/* ── LEFT SIDEBAR ──────────────────────────────────── */}
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <div className="visits-sidebar" style={{ "--sidebar-w": sidebarWidth + "px" } as any}>

          {/* Pinned filter area */}
          <div className="vsb-filter-area">

            {/* Date range */}
            <p className="vsb-section-label" style={{ marginBottom: 6 }}>Date Range</p>
            <div className="vsb-date-row" style={{ marginBottom: 12 }}>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="vsb-date-inp" />
              <span className="vsb-date-sep">→</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="vsb-date-inp" />
            </div>

            {/* CM filter — multi-select */}
            <p className="vsb-section-label" style={{ marginBottom: 6 }}>CM Filter</p>
            {cms.length > 0 && (
              <div className="cm-dropdown" ref={cmDropdownRef}>
                <button
                  className={`cm-dropdown-btn${cmDropdownOpen ? " open" : ""}`}
                  onClick={() => setCmDropdownOpen(o => !o)}
                >
                  <span className="cm-dropdown-btn-label">{selectedCmLabel}</span>
                  <span className="cm-dropdown-arrow">▼</span>
                </button>
                {cmDropdownOpen && (
                  <div className="cm-dropdown-panel">
                    <div
                      className={`cm-dropdown-all${filterCMs.size === 0 ? " selected" : ""}`}
                      onClick={() => { setFilterCMs(new Set()); setCmDropdownOpen(false); }}
                    >All Channel Managers</div>
                    {cmGroups.map(g => {
                      const allSelected = g.cms.every(c => filterCMs.has(String(c.telegram_id)));
                      return (
                        <div key={g.market}>
                          <div className="cm-dropdown-mkt-header">
                            <span>{g.flag} {g.market}</span>
                            <button
                              className="cm-dropdown-select-all"
                              onClick={() => toggleMarketCMs(g.cms, allSelected)}
                            >{allSelected ? "Deselect all" : "Select all"}</button>
                          </div>
                          {g.cms.map(c => {
                            const isSel = filterCMs.has(String(c.telegram_id));
                            return (
                              <div
                                key={c.telegram_id}
                                className={`cm-dropdown-item${isSel ? " selected" : ""}`}
                                onClick={() => toggleCM(String(c.telegram_id))}
                              >
                                <span className="cm-dropdown-check">{isSel ? "✓" : ""}</span>
                                {c.name}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="visits-sidebar-inner">

            {/* Browse tree */}
            <p className="vsb-section-label">Browse</p>

            <div
              className={`tree-node${selection.type === "all" ? " active" : ""}`}
              onClick={() => selectNode({ type: "all" })}
            >
              <span style={{ fontSize: 12, width: 12 }} />
              🌐 All Markets
            </div>

            {tree?.markets.map(m => {
              const mOpen = openMarkets.has(m.market);
              const mActive = selection.type === "market" && selection.market === m.market;
              return (
                <div key={m.market}>
                  <div
                    className={`tree-node${mActive ? " active" : ""}`}
                    onClick={() => { toggleMarket(m.market); selectNode({ type: "market", market: m.market, flag: m.flag }); }}
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
                          onClick={() => { toggleChain(chainKey); selectNode({ type: "chain", market: m.market, flag: m.flag, chain: ch.chain }); }}
                        >
                          <span className={`tree-chevron${chOpen ? " open" : ""}`}>›</span>
                          {ch.chain}
                        </div>

                        {chOpen && sortStoresByTier(ch.stores).map(st => {
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

        {/* ── RESIZE HANDLE ────────────────────────────────── */}
        <div className="visits-resize-handle" onMouseDown={handleResizeMouseDown} />

        {/* ── FEED PANEL ────────────────────────────────────── */}
        <div className="visits-feed-panel">

          {/* Header */}
          <div className="vfp-header">
            <span className="vfp-title">{selectionLabel(selection)}</span>
            <span className="vfp-count">
              {loading ? "Loading…" : `${total} visit${total !== 1 ? "s" : ""}`}
              {focusSections.size > 0
                ? ` · ${[...focusSections].map(k => SECTIONS.find(s => s.key === k)?.icon ?? "").join(" ")}`
                : selection.type === "all" ? ` · ${ALL_SECTION_EMOJIS}` : ""}
            </span>
          </div>

          {/* Section filter bar */}
          <div className="vfp-section-bar">
            <div className="section-chips">
              <button
                className={`section-chip${focusSections.size === 0 ? " active" : ""}`}
                onClick={() => setFocusSections(new Set())}
              >All</button>
              <button
                className={`photo-toggle-btn${filterPhotos ? " on" : ""}`}
                onClick={() => setFilterPhotos(p => !p)}
                title={filterPhotos ? "Hide photos" : "Show photos"}
              >
                📸
                <span className="photo-toggle-dot" />
              </button>
              <span className="section-bar-divider" />
              {SECTIONS.map(s => (
                <button
                  key={s.key}
                  className={`section-chip${focusSections.has(s.key) ? " active" : ""}`}
                  onClick={() => handleSectionChipClick(s.key)}
                >{s.icon} {s.label}</button>
              ))}
            </div>
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
                <p>No visits {focusSections.size > 0 || filterPhotos ? "matching the selected filter" : ""} for this scope.</p>
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
                          focusSections={focusSections}
                          showPhotos={filterPhotos}
                          isExpanded={expandedVisits.has(v.id)}
                          onToggle={() => {
                            const isCurrentlyExpanded = expandedVisits.has(v.id);
                            setExpandedVisits(prev => {
                              const n = new Set(prev);
                              isCurrentlyExpanded ? n.delete(v.id) : n.add(v.id);
                              return n;
                            });
                            // Expanding a card also opens its store in the detail panel
                            if (!isCurrentlyExpanded) {
                              setDetail({ type: "store", storeId: v.store_id, storeName: v.store_name });
                            }
                          }}
                          onPhoto={setLightbox}
                          onOpenStore={(storeId, storeName) => setDetail({ type: "store", storeId, storeName })}
                          onOpenCM={(telegramId, name, market) => {
                            setDetail({ type: "cm", telegramId, name, market });
                            setCmDetailTab("visits");
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── DETAIL PANEL — always visible ─────────────────── */}
        <div className="visits-resize-handle" onMouseDown={handleDetailResizeMouseDown} />
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <div className="visits-detail-panel" style={{ "--detail-w": detailWidth + "px" } as any}>
          {detail === null ? (
            <div className="vdp-empty-state">
              <div className="vdp-empty-icon" style={{ fontSize: 32, opacity: 0.2 }}>🏪</div>
              <div className="vdp-empty-title">Nothing selected</div>
              <div className="vdp-empty-hint">Click a store name, CM, or staff member to see details here</div>
            </div>
          ) : detail.type === "store" ? (
            <StoreDetailPanel
              key={detail.storeId}
              storeId={detail.storeId}
              storeName={detail.storeName}
              onClose={() => setDetail(null)}
              onOpenCM={(id, name, market) => {
                setDetail({ type: "cm", telegramId: id, name, market });
                setCmDetailTab("visits");
              }}
              onOpenStaff={(staffId, staffName, sName) => setDetail({ type: "staff", staffId, staffName, storeName: sName })}
            />
          ) : detail.type === "cm" ? (
            <CMDetailPanel
              key={detail.telegramId}
              telegramId={detail.telegramId}
              name={detail.name}
              market={detail.market}
              tab={cmDetailTab}
              onTabChange={setCmDetailTab}
              onClose={() => setDetail(null)}
              onOpenStore={(storeId, storeName) => setDetail({ type: "store", storeId, storeName })}
            />
          ) : (
            <StaffDetailPanel
              key={detail.staffId}
              staffId={detail.staffId}
              staffName={detail.staffName}
              storeName={detail.storeName}
              onClose={() => setDetail(null)}
            />
          )}
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
  v, focusSections, showPhotos, isExpanded, onToggle, onPhoto, onOpenStore, onOpenCM,
}: {
  v: VisitRow;
  focusSections: Set<SectionKey>;
  showPhotos: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onPhoto: (url: string) => void;
  onOpenStore?: (storeId: string, storeName: string) => void;
  onOpenCM?: (telegramId: number, name: string, market: string) => void;
}) {
  const tier = v.store_tier;
  const ts   = tier ? TIER_STYLE[tier] : null;

  // Sections with content — for header pill row (emoji only, no background)
  const pillSections = SECTIONS
    .filter(s => (TEXT_SECTION_KEYS as readonly string[]).includes(s.key))
    .filter(s => !!v[s.key as keyof VisitRow]);

  // Sections to show in expanded body (respects multi-select focus)
  const textFocus = [...focusSections].filter(k => k !== "trainings" && k !== "follow_ups") as SectionKey[];
  const textSections = SECTIONS
    .filter(s => (TEXT_SECTION_KEYS as readonly string[]).includes(s.key))
    .filter(s => {
      if (textFocus.length > 0) return textFocus.includes(s.key) && !!v[s.key as keyof VisitRow];
      return !!v[s.key as keyof VisitRow];
    });

  const showTrainings = (focusSections.size === 0 || focusSections.has("trainings")) && v.training_count > 0;
  const showFollowUps = (focusSections.size === 0 || focusSections.has("follow_ups")) && v.follow_up_count > 0;
  const hasContent    = textSections.length > 0 || showTrainings || showFollowUps || v.photo_count > 0;

  return (
    <div className="visit-card">
      {/* Card header */}
      <div className="visit-card-header" onClick={onToggle}>
        {ts && <span className="tier-badge" style={{ background: ts.bg, color: ts.color }}>{tier}</span>}
        <div className="visit-card-store">
          <button
            className="visit-store-link"
            onClick={(e) => { e.stopPropagation(); onOpenStore?.(v.store_id, v.store_name); }}
          >{v.store_name}</button>
          <div className="visit-meta-row">
            <button
              className="visit-cm-link"
              onClick={(e) => { e.stopPropagation(); onOpenCM?.(v.cm_telegram_id, v.cm_name, v.store_market); }}
            >{v.cm_name}</button>
            <span className="visit-meta-item">·</span>
            <span className="visit-meta-item">{fmtDate(v.visit_date)}</span>

            {/* Section pills — emoji only, no backgrounds */}
            {pillSections.map(s => (
              <span key={s.key} className="sec-pill-emoji">{s.icon}</span>
            ))}

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
        <span className={`visit-chevron${isExpanded ? " open" : ""}`}>›</span>
      </div>

      {/* Card body */}
      {isExpanded && (
        <div className="visit-detail">
          {showPhotos && v.photo_urls.length > 0 && (
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
              {textSections.map(s => (
                <div key={s.key} className="visit-section-card">
                  <div className="visit-section-label" style={{ color: s.color }}>{s.icon} {s.label}</div>
                  <p className="visit-section-text">{v[s.key as keyof VisitRow] as string}</p>
                </div>
              ))}

              {showTrainings && (
                <div className="visit-section-card">
                  <div className="visit-section-label" style={{ color: "var(--color-tier-t2-fg)" }}>🎓 Trainings Logged</div>
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

              {showFollowUps && (
                <div className="visit-section-card">
                  <div className="visit-section-label" style={{ color: "#C0185A" }}>📌 Follow-ups</div>
                  <div className="sc-fu-list">
                    {v.follow_up_items.map(fu => (
                      <div key={fu.id} className="sc-fu-row">
                        <div className={`sc-fu-check${fu.status === "done" ? " done" : ""}`} />
                        <div>
                          <div className={`sc-fu-title${fu.status === "done" ? " done" : ""}`}>{fu.title}</div>
                          {fu.due_date && <div className="sc-fu-due">Due {fmtDate(fu.due_date)}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Store Detail Panel ───────────────────────────────────────────────────────

function StoreDetailPanel({
  storeId, storeName, onClose, onOpenCM, onOpenStaff,
}: {
  storeId: string;
  storeName: string;
  onClose: () => void;
  onOpenCM: (id: number, name: string, market: string) => void;
  onOpenStaff: (staffId: string, staffName: string, storeName: string) => void;
}) {
  const [data, setData] = useState<{
    store: { id: string; name: string; chain: string; market: string; tier: string | null } | null;
    visits: StoreVisitSummary[];
    staff: StaffRow[];
    memory_notes: StoreMemoryNote[];
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

  const lastVisitDate = visits[0]?.visit_date;

  const TIER_COLORS: Record<string, { bg: string; color: string }> = {
    T1: { bg: "var(--color-tier-t1-bg)", color: "var(--color-tier-t1-fg)" },
    T2: { bg: "var(--color-tier-t2-bg)", color: "var(--color-tier-t2-fg)" },
    T3: { bg: "var(--color-tier-t3-bg)", color: "var(--color-tier-t3-fg)" },
    T4: { bg: "var(--color-tier-t4-bg)", color: "var(--color-tier-t4-fg)" },
  };
  const tierStyle = store?.tier ? TIER_COLORS[store.tier] : null;

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
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <Link href={`/visits/store/${storeId}`} target="_blank" rel="noreferrer" className="vdp-open-link" onClick={e => e.stopPropagation()}>↗</Link>
            <button className="vdp-close" onClick={onClose}>✕</button>
          </div>
        </div>
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

            {/* Past Visits */}
            <div className="vdp-section-header">
              Past Visits{visits.length > 0 && <span className="vdp-section-count">{visits.length}</span>}
            </div>
            {visits.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--color-ink-300)", textAlign: "center", padding: "8px 0 16px" }}>No visits logged yet.</p>
            ) : (
              <div>
                {visits.map(v => (
                  <div key={v.id} className="vdp-item">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="vdp-item-name">{fmtDateFull(v.visit_date)}</div>
                      <div className="vdp-item-meta">
                        <button
                          className="visit-cm-link"
                          style={{ fontSize: 11.5 }}
                          onClick={() => { if (v.cm_telegram_id) onOpenCM(v.cm_telegram_id, v.cm_name, store?.market ?? ""); }}
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
                    <div key={n.slug} className="vdp-memory-note">
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

function CMDetailPanel({
  telegramId, name, market, tab, onTabChange, onClose, onOpenStore,
}: {
  telegramId: number;
  name: string;
  market: string;
  tab: "visits" | "stores";
  onTabChange: (t: "visits" | "stores") => void;
  onClose: () => void;
  onOpenStore: (storeId: string, storeName: string) => void;
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
                <div key={v.id} className="vdp-item" onClick={() => onOpenStore(v.store_id, v.store_name)}>
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
                <div key={n.slug} className="vdp-memory-note">
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

function StaffDetailPanel({
  staffId, staffName, storeName, onClose,
}: {
  staffId: string;
  staffName: string;
  storeName: string;
  onClose: () => void;
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
                  <div key={t.visit_id} className="vdp-item">
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
                  <div key={v.visit_id} className="vdp-item">
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
