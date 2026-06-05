"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import NavBar from "@/components/NavBar";
import MemoryNoteDrawer from "@/components/MemoryNoteDrawer";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import RefreshControl from "@/components/RefreshControl";
import { CMOption, PhotoItem } from "@/lib/queries";
import { StoreDetailPanel, CMDetailPanel, StaffDetailPanel } from "@/components/DetailPanels";
import FeedPhotoLightbox from "@/components/FeedPhotoLightbox";
import {
  VisitRow, DetailView, SectionKey, SECTIONS, TEXT_SECTION_KEYS, TIER_STYLE, fmtDate,
} from "@/lib/visit-shared";

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Section definitions ──────────────────────────────────────────────────────

// Filter bar chips — 4 user-facing labels mapped to underlying section keys
const CHIP_SECTIONS: Array<{ key: typeof SECTIONS[number]["key"]; label: string; icon: string }> = [
  { key: "good_news",     label: "Good News",      icon: "🌟" },
  { key: "trainings",     label: "Engagements",    icon: "🎓" },
  { key: "display_stock", label: "Display & Stock", icon: "📦" },
  { key: "competitors",   label: "Competition",    icon: "🔍" },
  { key: "follow_ups",    label: "Follow-up",      icon: "📌" },
];

// Markets for CM dropdown grouping
const MARKET_ORDER_CM = ["SG", "MY", "TH", "HK"];
const MARKET_FLAG_CM: Record<string, string> = { SG: "🇸🇬", MY: "🇲🇾", TH: "🇹🇭", HK: "🇭🇰" };
const MARKET_FULL_NAME: Record<string, string> = { SG: "Singapore", MY: "Malaysia", TH: "Thailand", HK: "Hong Kong" };

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  if (key === "trainings")  return v.engagement_count > 0;
  if (key === "follow_ups") return v.follow_up_count > 0;
  return !!v[key as keyof VisitRow];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VisitsPage() {
  const [user,           setUser]           = useState<User | null>(null);
  const [visits,         setVisits]         = useState<VisitRow[]>([]);
  const [total,          setTotal]          = useState(0);
  const [loading,        setLoading]        = useState(false);
  const [cms,            setCms]            = useState<CMOption[]>([]);
  const [filterCMs,      setFilterCMs]      = useState<Set<string>>(new Set());
  const [filterPhotos,   setFilterPhotos]   = useState(true);
  const [dateFrom,       setDateFrom]       = useState("");
  const [dateTo,         setDateTo]         = useState("");
  const [tree,           setTree]           = useState<BrowseTree | null>(null);
  const [selection,      setSelection]      = useState<Selection>({ type: "all" });
  const [openMarkets,    setOpenMarkets]    = useState<Set<string>>(new Set());
  const [openChains,     setOpenChains]     = useState<Set<string>>(new Set());
  const [focusSections,  setFocusSections]  = useState<Set<SectionKey>>(new Set());
  const [expandedVisits, setExpandedVisits] = useState<Set<string>>(new Set());
  const [lightbox,       setLightbox]       = useState<{ photos: PhotoItem[]; index: number; context: string } | null>(null);
  const [detail,         setDetail]         = useState<DetailView>(null);
  const [detailWidth,    setDetailWidth]    = useState(400);
  const [noteSlug,       setNoteSlug]       = useState<string | null>(null);
  const feedRef                             = useRef<HTMLDivElement>(null);
  const [sidebarWidth,   setSidebarWidth]   = useState(300);
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

  // Seed scope + CM filter from the URL query so dashboard links land scoped.
  // (?store=, ?market=, ?chain=, ?cm=id[,id], ?from=, ?to=)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const store = q.get("store");
    const market = q.get("market");
    const chain = q.get("chain");
    const cm = q.get("cm");
    const from = q.get("from");
    const to = q.get("to");
    if (store) {
      setSelection({ type: "store", storeId: store, storeName: "", market: "", flag: "", chain: "" });
    } else if (chain && market) {
      setSelection({ type: "chain", market, flag: MARKET_FLAG_CM[market] ?? "", chain });
    } else if (market) {
      setSelection({ type: "market", market, flag: MARKET_FLAG_CM[market] ?? "" });
    }
    if (cm) setFilterCMs(new Set(cm.split(",").filter(Boolean)));
    if (from) setDateFrom(from);
    if (to) setDateTo(to);
  }, []);

  // A deep-linked ?store= has no label yet — fill it from the browse tree once loaded.
  useEffect(() => {
    if (!tree || selection.type !== "store" || selection.storeName) return;
    for (const m of tree.markets) {
      for (const c of m.chains) {
        const s = c.stores.find(st => st.id === selection.storeId);
        if (s) {
          setSelection({ type: "store", storeId: s.id, storeName: s.name, market: m.market, flag: m.flag, chain: c.chain });
          return;
        }
      }
    }
  }, [tree, selection]);

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
    // scroll reset intentionally removed — auto-refresh should not disrupt position
  }, [selection, filterCMs, dateFrom, dateTo]);

  useEffect(() => { fetchVisits(); }, [fetchVisits]);

  // Silent background refresh — preserves scroll, expanded state, and selection.
  // Paused while a drawer/lightbox/dropdown is open; hook also skips when the tab
  // is hidden or focus is in an input. See useAutoRefresh.
  const silentRefresh = useCallback(async () => {
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
  }, [selection, filterCMs, dateFrom, dateTo]);

  const refresh = useAutoRefresh(silentRefresh, {
    intervalMs: 60_000,
    paused: detail !== null || lightbox !== null || cmDropdownOpen || noteSlug !== null,
  });

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

  // Expand-all / collapse-all across the currently-filtered feed
  const allExpanded = filtered.length > 0 && filtered.every(v => expandedVisits.has(v.id));
  function toggleExpandAll() {
    setExpandedVisits(allExpanded ? new Set() : new Set(filtered.map(v => v.id)));
  }

  function toggleMarket(m: string) {
    setOpenMarkets(prev => prev.has(m) ? new Set() : new Set([m]));
    setOpenChains(new Set()); // collapse all chains when switching/closing a market
  }

  function toggleChain(key: string) {
    const market = key.split("::")[0];
    setOpenChains(prev => {
      if (prev.has(key)) { const n = new Set(prev); n.delete(key); return n; }
      // accordion: close sibling chains in the same market, open this one
      const n = new Set([...prev].filter(k => !k.startsWith(market + "::")));
      n.add(key);
      return n;
    });
  }

  function selectNode(s: Selection) {
    setSelection(s);
    setFocusSections(new Set());
    setExpandedVisits(new Set());
  }

  // Jump the middle feed to a specific visit: re-scope to its store if needed,
  // clear section filters, expand the visit, and scroll it into view.
  function openVisit(storeId: string, storeName: string, visitId: string) {
    const needsRescope = selection.type !== "store" || selection.storeId !== storeId;
    if (needsRescope) {
      setSelection({ type: "store", storeId, storeName, market: "", flag: "", chain: "" });
    }
    setFocusSections(new Set());
    setExpandedVisits(prev => {
      const n = new Set(prev);
      n.add(visitId);
      return n;
    });
    // After fetch + render settle, scroll the card into view.
    const tryScroll = (attemptsLeft: number) => {
      const el = document.getElementById(`visit-${visitId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      if (attemptsLeft > 0) setTimeout(() => tryScroll(attemptsLeft - 1), 150);
    };
    setTimeout(() => tryScroll(8), needsRescope ? 200 : 50);
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
  const ALL_SECTION_EMOJIS = CHIP_SECTIONS.map(s => s.icon).join(" ");

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
            <p className="vsb-section-label" style={{ marginBottom: 6 }}>Channel Managers</p>
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
            <p className="vsb-section-label">Locations</p>

            <div
              className={`tree-node${selection.type === "all" ? " active" : ""}`}
              onClick={() => {
                setOpenMarkets(new Set());
                setOpenChains(new Set());
                selectNode({ type: "all" });
              }}
            >
              <span style={{ fontSize: 12, width: 12 }} />
              🌐 All Countries
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
                    {m.flag} {MARKET_FULL_NAME[m.market] ?? m.market}
                  </div>

                  <div className={`tree-market-children${mOpen ? " open" : ""}`}>
                    <div className="tree-market-children-wrap">
                      {m.chains.map(ch => {
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

                            <div className={`tree-chain-children${chOpen ? " open" : ""}`}>
                              <div className="tree-chain-children-wrap">
                                {sortStoresByTier(ch.stores).map(st => {
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
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
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
          <div className="vfp-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
              <span className="vfp-title">{selectionLabel(selection)}</span>
              <span className="vfp-count">
                {loading ? "Loading…" : `${total} visit${total !== 1 ? "s" : ""}`}
                {focusSections.size > 0
                  ? ` · ${[...focusSections].map(k => SECTIONS.find(s => s.key === k)?.icon ?? "").join(" ")}`
                  : selection.type === "all" ? ` · ${ALL_SECTION_EMOJIS}` : ""}
              </span>
            </div>
            <RefreshControl controls={refresh} />
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
              {CHIP_SECTIONS.map(s => (
                <button
                  key={s.key}
                  className={`section-chip${focusSections.has(s.key) ? " active" : ""}`}
                  onClick={() => handleSectionChipClick(s.key)}
                >{s.icon} {s.label}</button>
              ))}
              <button
                className="section-chip"
                style={allExpanded
                  ? { marginLeft: "auto" }
                  : { marginLeft: "auto", background: "linear-gradient(135deg, var(--color-tc-600), var(--color-tc-500))", color: "#fff", borderColor: "transparent", fontWeight: 700 }}
                onClick={toggleExpandAll}
                disabled={filtered.length === 0}
                title={allExpanded ? "Collapse all visits" : "Expand all visits"}
              >{allExpanded ? "Collapse all" : "Expand all"}</button>
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
                          onOpenStaff={(staffId, staffName, storeName) =>
                            setDetail({ type: "staff", staffId, staffName, storeName })
                          }
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
              onOpenVisit={openVisit}
              onOpenNote={(slug) => setNoteSlug(slug)}
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
              onOpenVisit={openVisit}
              onOpenNote={(slug) => setNoteSlug(slug)}
            />
          ) : (
            <StaffDetailPanel
              key={detail.staffId}
              staffId={detail.staffId}
              staffName={detail.staffName}
              storeName={detail.storeName}
              onClose={() => setDetail(null)}
              onOpenVisit={openVisit}
            />
          )}
        </div>
      </div>

      {/* Memory note drawer — overlays the store/CM/staff panel */}
      <MemoryNoteDrawer slug={noteSlug} onClose={() => setNoteSlug(null)} />

      {/* Photo lightbox — flip with ‹ › / ←→, comment per photo */}
      {lightbox && (
        <FeedPhotoLightbox
          photos={lightbox.photos}
          startIndex={lightbox.index}
          context={lightbox.context}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

// ─── Visit Card ───────────────────────────────────────────────────────────────

function VisitCard({
  v, focusSections, showPhotos, isExpanded, onToggle, onPhoto, onOpenStore, onOpenCM, onOpenStaff,
}: {
  v: VisitRow;
  focusSections: Set<SectionKey>;
  showPhotos: boolean;
  isExpanded: boolean;
  onToggle: () => void;
  onPhoto: (lb: { photos: PhotoItem[]; index: number; context: string }) => void;
  onOpenStore?: (storeId: string, storeName: string) => void;
  onOpenCM?: (telegramId: number, name: string, market: string) => void;
  onOpenStaff?: (staffId: string, staffName: string, storeName: string) => void;
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
      if (focusSections.size === 0) return !!v[s.key as keyof VisitRow];          // no filter: show all
      if (textFocus.length > 0) return textFocus.includes(s.key) && !!v[s.key as keyof VisitRow]; // text-section focus
      return false;                                                                 // focus is trainings/follow_ups only
    });

  const showEngagements = (focusSections.size === 0 || focusSections.has("trainings")) && v.engagement_count > 0;
  const showFollowUps = (focusSections.size === 0 || focusSections.has("follow_ups")) && v.follow_up_count > 0;
  const hasContent    = textSections.length > 0 || showEngagements || showFollowUps || v.photo_count > 0;

  // AM review feedback left on this visit's photos, and whether the CM has seen it.
  const hasFeedback = v.photos.some(p => p.annotations.length > 0 || p.comments.length > 0);

  return (
    <div className="visit-card" id={`visit-${v.id}`}>
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
            {v.engagement_count > 0 && (
              <><span className="visit-meta-item">·</span><span className="visit-meta-item">👥 {v.engagement_count} engaged</span></>
            )}
            {v.follow_up_count > 0 && (
              <><span className="visit-meta-item">·</span><span className="visit-meta-item">📌 {v.follow_up_count} follow-up{v.follow_up_count !== 1 ? "s" : ""}</span></>
            )}
            {v.edited_at && (
              <><span className="visit-meta-item">·</span><span className="visit-meta-item" style={{ color: "var(--color-ink-300)" }}>edited</span></>
            )}
            {hasFeedback && (
              <><span className="visit-meta-item">·</span>
                <span
                  className="visit-meta-item"
                  style={{ color: v.review_ack_at ? "var(--color-emerald-600, #059669)" : "var(--color-ink-300)" }}
                  title={v.review_ack_at ? `CM saw feedback on ${fmtDate(v.review_ack_at.slice(0, 10))}` : "CM hasn't opened the feedback yet"}
                >{v.review_ack_at ? "✓ seen" : "◷ unseen"}</span>
              </>
            )}
          </div>
        </div>
        <span className={`visit-chevron${isExpanded ? " open" : ""}`}>›</span>
      </div>

      {/* Card body */}
      {isExpanded && (
        <div className="visit-detail">
          {showPhotos && v.photos.length > 0 && (
            <div className="photo-strip-wrap">
              <div className="photo-strip">
                {v.photos.map((p, i) => (
                  <button
                    key={p.id}
                    className="photo-thumb"
                    onClick={() => onPhoto({
                      photos: v.photos,
                      index: i,
                      context: `${v.store_name} · ${v.cm_name} · ${fmtDate(v.visit_date)}`,
                    })}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={`Photo ${i + 1}`} />
                    {p.comments.length > 0 && (
                      <span className="photo-cmt-badge">💬 {p.comments.length}</span>
                    )}
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

              {showEngagements && (
                <div className="visit-section-card">
                  <div className="visit-section-label" style={{ color: "var(--color-tier-t2-fg)" }}>👥 Engagements</div>
                  <div className="sc-staff-list">
                    {v.engaged_people.map((p, i) => (
                      <div key={i} className="sc-staff-row">
                        {p.was_trained
                          ? <span className="pill-trained">Trained</span>
                          : <span className="pill-engaged">Engaged</span>}
                        <div>
                          {p.id && onOpenStaff ? (
                            <button
                              className="visit-cm-link sc-staff-name"
                              onClick={(e) => { e.stopPropagation(); onOpenStaff(p.id, p.name, v.store_name); }}
                            >{p.name}</button>
                          ) : (
                            <div className="sc-staff-name">{p.name}</div>
                          )}
                          {p.update_text && <div className="sc-staff-update">{p.update_text}</div>}
                          {p.products && <div className="sc-staff-products">🎓 {p.products}</div>}
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
