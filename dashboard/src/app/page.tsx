"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import NavBar from "@/components/NavBar";
import MemoryNoteDrawer from "@/components/MemoryNoteDrawer";
import { StoreDetailPanel, CMDetailPanel, StaffDetailPanel } from "@/components/DetailPanels";
import type { DetailView } from "@/lib/visit-shared";

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"],
};

interface Stats {
  visits_this_month: number;
  visits_all_time: number;
  active_cms_this_month: number;
  total_cms: number;
  total_stores: number;
}

interface StoreStatus {
  id: string;
  name: string;
  chain: string;
  market: "SG" | "MY" | "TH" | "HK";
  tier: "T1" | "T2" | "T3" | "T4" | null;
  last_visit_date: string | null;
}

interface VisitRow {
  id: string;
  visit_date: string;
  cm_telegram_id: number;
  cm_name: string;
  store_id: string;
  store_name: string;
  store_market: string;
  store_tier: string | null;
  good_news: string | null;
  competitors: string | null;
  display_stock: string | null;
  follow_up: string | null;
  buzz_plan: string | null;
  training: string | null;
}

interface PayrollWeek { start: string; end: string }
interface PayrollRow {
  telegram_id: number;
  full_name: string;
  market: "SG" | "MY" | "TH" | "HK";
  am_name: string | null;
  counts: number[];
  range_total: number;
}
interface PayrollGrid {
  weeks: PayrollWeek[];
  rows: PayrollRow[];
  range: { from: string; to: string };
}

interface ReportSummary {
  id: string;
  report_date: string;
  version: number;
  edited_by_human: boolean;
}
interface ReportFull extends ReportSummary {
  brief_markdown: string;
}

interface NoteSummary {
  slug: string;
  scope: "store" | "person" | "theme" | "channel";
  title: string;
  summary: string;
  tier: "short" | "long";
  last_touched_at: string;
}

interface User { first_name: string; username?: string; role?: string }

// ── helpers ──────────────────────────────────────────────────────
function todayISO(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
function mondayOfISO(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function shiftDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function fmtTodayHeader(): string {
  return new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}
function fmtDateHeader(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
}
function fmtWeekRange(monIso: string): string {
  const mon = new Date(monIso + "T00:00:00");
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
  const mShort = (d: Date) => d.toLocaleDateString("en-GB", { month: "short" });
  return `${mon.getDate()} ${mShort(mon)} — ${sun.getDate()} ${mShort(sun)}`;
}
function dayShort(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short" });
}
function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function countSections(v: VisitRow): { on: boolean[]; total: number } {
  const arr = [v.good_news, v.competitors, v.display_stock, v.follow_up, v.buzz_plan];
  const on = arr.map((s) => !!s);
  return { on, total: on.filter(Boolean).length };
}

const CM_COLORS = ["#8B6534", "#6B4E7A", "#4A6A3F", "#3F5A78", "#B86B00", "#5B3FB5", "#1E7A3A", "#B5331A"];
function colorForIdx(i: number) { return CM_COLORS[i % CM_COLORS.length]; }

function trendPolyline(counts: number[]): string {
  if (counts.length === 0) return "";
  const max = Math.max(...counts, 1);
  const w = 100;
  const h = 24;
  const stepX = counts.length > 1 ? w / (counts.length - 1) : 0;
  return counts
    .map((c, i) => {
      const x = i * stepX;
      const y = h - (c / max) * (h - 4) - 2; // pad 2 top/bottom
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function stripAnalyticsSection(md: string | null | undefined): string {
  if (!md) return "";
  return md.replace(/\n## (?:📊 )?Analytics[\s\S]*?(?=\n## |\n# |$)/, "");
}
function stripBriefTitle(md: string): string {
  return md.replace(/^#[^\n]*\n*/, "");
}

const SCOPE_ICON: Record<string, string> = {
  store: "🏬", person: "👤", theme: "🧵", channel: "🔗",
};

// Which KPI card's history/breakdown the drawer is showing.
type KpiKey = "visits_week" | "stores_covered" | "active_cms" | "visits_month";

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [stores, setStores] = useState<StoreStatus[]>([]);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [payroll, setPayroll] = useState<PayrollGrid | null>(null);

  const [intelView, setIntelView] = useState<"daily" | "weekly">("daily");
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [report, setReport] = useState<ReportFull | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  const [notes, setNotes] = useState<NoteSummary[]>([]);

  // Right-hand detail drawer (mirrors /visits)
  const [detail, setDetail] = useState<DetailView>(null);
  const [kpi, setKpi] = useState<KpiKey | null>(null);
  const [noteSlug, setNoteSlug] = useState<string | null>(null);
  const [cmDetailTab, setCmDetailTab] = useState<"visits" | "stores">("visits");
  const router = useRouter();

  const weekMon = useMemo(() => mondayOfISO(todayISO()), []);
  const weekSun = useMemo(() => shiftDays(weekMon, 6), [weekMon]);
  const weekRange = useMemo(() => fmtWeekRange(weekMon), [weekMon]);

  // Payroll range: 4 weeks ending this Sunday
  const payrollFrom = useMemo(() => shiftDays(weekMon, -21), [weekMon]);
  const payrollTo = weekSun;

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => { if (d) setUser(d); });
    fetch("/api/overview").then(r => r.ok ? r.json() : null).then(d => {
      if (d) { setStats(d.stats); setStores(d.stores); }
    });
    fetch(`/api/visits?from=${weekMon}&to=${weekSun}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d?.visits) setVisits(d.visits);
    });
    fetch(`/api/payroll?from=${payrollFrom}&to=${payrollTo}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d) setPayroll(d);
    });
    fetch("/api/intelligence/reports").then(r => r.ok ? r.json() : null).then(d => {
      const list: ReportSummary[] = d?.reports ?? [];
      setReports(list);
      if (list.length > 0) setActiveDate(list[0].report_date);
    });
    fetch("/api/intelligence/notes").then(r => r.ok ? r.json() : null).then(d => {
      if (d?.notes) setNotes(d.notes.slice(0, 5));
    });
  }, [weekMon, weekSun, payrollFrom, payrollTo]);

  // Load the active brief whenever activeDate changes
  useEffect(() => {
    if (!activeDate) { setReport(null); return; }
    setReportLoading(true);
    fetch(`/api/intelligence/reports/${activeDate}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setReport(d?.report ?? null); })
      .finally(() => setReportLoading(false));
  }, [activeDate]);

  const uniqueStoresVisited = new Set(visits.map(v => v.store_id)).size;
  const activeStores = stores.filter(s => s); // all stores in /api/overview are active

  // ── CM execution rows (live from payroll) ──────────────────────
  // payroll.weeks ordered oldest → newest. Last week = current week.
  const cmRows = useMemo(() => {
    if (!payroll) return [];
    const lastIdx = payroll.weeks.length - 1;
    return payroll.rows
      .map((r, i) => {
        const counts = r.counts;
        const thisWeek = lastIdx >= 0 ? (counts[lastIdx] ?? 0) : 0;
        // 4-wk avg includes all weeks in the window
        const avg = counts.length > 0
          ? counts.reduce((a, b) => a + b, 0) / counts.length
          : 0;
        return {
          telegram_id: r.telegram_id,
          name: r.full_name,
          market: r.market,
          thisWeek,
          avg,
          counts,
          color: colorForIdx(i),
        };
      })
      .sort((a, b) => b.thisWeek - a.thisWeek);
  }, [payroll]);

  // ── By-market (live) ───────────────────────────────────────────
  const byMarket = useMemo(() => {
    const markets: ("SG" | "MY" | "TH" | "HK")[] = ["SG", "MY", "TH", "HK"];
    return markets.map((m) => {
      const visitsInMkt = visits.filter(v => v.store_market === m);
      const uniqueStores = new Set(visitsInMkt.map(v => v.store_id)).size;
      const totalStoresInMkt = activeStores.filter(s => s.market === m).length;
      const rate = totalStoresInMkt > 0 ? uniqueStores / totalStoresInMkt : null;
      return { market: m, visits: visitsInMkt.length, stores: uniqueStores, total: totalStoresInMkt, rate };
    });
  }, [visits, activeStores]);

  // ── By-tier (live) ────────────────────────────────────────────
  const byTier = useMemo(() => {
    const tiers: ("T1" | "T2" | "T3" | "T4")[] = ["T1", "T2", "T3", "T4"];
    return tiers.map((t) => {
      const visitsInTier = visits.filter(v => v.store_tier === t);
      const uniqueStores = new Set(visitsInTier.map(v => v.store_id)).size;
      const totalStoresInTier = activeStores.filter(s => s.tier === t).length;
      const rate = totalStoresInTier > 0 ? uniqueStores / totalStoresInTier : null;
      return { tier: t, visits: visitsInTier.length, stores: uniqueStores, total: totalStoresInTier, rate };
    });
  }, [visits, activeStores]);

  // ── Weekly visit totals (team-wide), for the KPI history drawer ─
  // payroll.rows[].counts are per-CM weekly visit counts; sum across CMs.
  const weeklyVisitTotals = useMemo(() => {
    if (!payroll) return [] as { week: PayrollWeek; total: number }[];
    return payroll.weeks.map((w, i) => ({
      week: w,
      total: payroll.rows.reduce((sum, r) => sum + (r.counts[i] ?? 0), 0),
    }));
  }, [payroll]);

  // ── Intelligence date nav ─────────────────────────────────────
  const activeIdx = activeDate ? reports.findIndex(r => r.report_date === activeDate) : -1;
  const hasPrev = activeIdx >= 0 && activeIdx < reports.length - 1; // older
  const hasNext = activeIdx > 0; // newer
  function goPrev() { if (hasPrev) setActiveDate(reports[activeIdx + 1].report_date); }
  function goNext() { if (hasNext) setActiveDate(reports[activeIdx - 1].report_date); }
  function goToday() { if (reports.length > 0) setActiveDate(reports[0].report_date); }

  function rateLabel(rate: number | null): string {
    if (rate === null) return "—";
    return `${Math.round(rate * 100)}%`;
  }
  function ratePillClass(rate: number | null): string {
    if (rate === null) return "low";
    if (rate >= 0.8) return "good";
    if (rate >= 0.5) return "mid";
    return "low";
  }

  function deltaPill(thisWeek: number, avg: number) {
    if (avg === 0 && thisWeek === 0) return { cls: "low", txt: "—" };
    if (avg === 0) return { cls: "good", txt: "+new" };
    const ratio = thisWeek / avg;
    if (ratio >= 1.1) return { cls: "good", txt: "above avg" };
    if (ratio >= 0.9) return { cls: "mid",  txt: "at avg" };
    return { cls: "low", txt: "below avg" };
  }

  // ── Detail drawer openers (KPI + entity drawers are mutually exclusive) ──
  function openStore(storeId: string, storeName: string) {
    setKpi(null);
    setDetail({ type: "store", storeId, storeName });
  }
  function openCM(telegramId: number, name: string, market: string) {
    setKpi(null);
    setDetail({ type: "cm", telegramId, name, market });
    setCmDetailTab("visits");
  }
  function openKPI(k: KpiKey) {
    setDetail(null);
    setKpi(k);
  }
  // Panels hand back a visit to open; on the dashboard that means jumping
  // to the scoped Store Updates feed.
  const goToVisitStore = (storeId: string) => router.push(`/visits?store=${storeId}`);

  // "Open in Store Updates →" target for the current drawer entity.
  const monthStart = todayISO().slice(0, 8) + "01";
  const drawerStoreUpdatesHref =
    detail?.type === "store" ? `/visits?store=${detail.storeId}`
    : detail?.type === "cm" ? `/visits?cm=${detail.telegramId}`
    : null;
  const kpiFeedHref =
    kpi === "visits_month" ? `/visits?from=${monthStart}&to=${todayISO()}`
    : kpi ? `/visits?from=${weekMon}&to=${weekSun}`
    : null;

  if (!user) return null;

  return (
    <div>
      <NavBar user={user} />

      <div className="dashboard-grid">

        {/* SIDEBAR ─────────────────────────────────────── */}
        <aside className="dashboard-sidebar">
          <div className="sidebar-section">
            <div className="sidebar-label">Dashboard</div>
            <ul className="sidebar-toc">
              <li>
                <a className="chap" href="#stats"><span className="n">01</span> Statistics</a>
                <ul className="sub">
                  <li><a href="#stats-overview">Overview</a></li>
                  <li><a href="#stats-cms">CM execution</a></li>
                  <li><a href="#stats-visited">Stores visited</a></li>
                </ul>
              </li>
              <li style={{ marginTop: 10 }}>
                <a className="chap" href="#intel"><span className="n">02</span> Intelligence</a>
                <ul className="sub">
                  <li><a href="#intel" onClick={() => setIntelView("daily")}>Daily highlights</a></li>
                  <li><a href="#intel" onClick={() => setIntelView("weekly")}>Weekly report</a></li>
                </ul>
              </li>
              <li style={{ marginTop: 10 }}>
                <a className="chap" href="#memory"><span className="n">03</span> Memory</a>
              </li>
            </ul>
          </div>
        </aside>

        {/* MAIN ─────────────────────────────────────────── */}
        <main className="dashboard-main">

          {/* 1. STATISTICS */}
          <section className="chapter" id="stats">
            <div className="chapter-head">
              <span className="num">01</span>
              <h2>Statistics</h2>
              <span className="chapter-cadence">{fmtTodayHeader()}</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <button className="tf-pill">📅 <b>This week</b> <em>· {weekRange}</em> ▾</button>
              <button className="compare-link">+ Compare</button>
            </div>

            <h3 className="sub-head" id="stats-overview">Overview</h3>
            <div className="kpi-row">
              <div className="kpi-card accent clickable" onClick={() => openKPI("visits_week")}>
                <p className="kpi-value">{visits.length}</p>
                <p className="kpi-label">Visits this week</p>
              </div>
              <div className="kpi-card clickable" onClick={() => openKPI("stores_covered")}>
                <p className="kpi-value">
                  {uniqueStoresVisited}
                  <span style={{ fontSize: 18, color: "var(--color-ink-300)", marginLeft: 4 }}>
                    /{stats?.total_stores ?? "—"}
                  </span>
                </p>
                <p className="kpi-label">Stores covered</p>
              </div>
              <div className="kpi-card clickable" onClick={() => openKPI("active_cms")}>
                <p className="kpi-value">
                  {stats?.active_cms_this_month ?? "—"}
                  <span style={{ fontSize: 18, color: "var(--color-ink-300)", marginLeft: 4 }}>
                    /{stats?.total_cms ?? "—"}
                  </span>
                </p>
                <p className="kpi-label">Active CMs (mo)</p>
              </div>
              <div className="kpi-card clickable" onClick={() => openKPI("visits_month")}>
                <p className="kpi-value">{stats?.visits_this_month ?? "—"}</p>
                <p className="kpi-label">Visits this month</p>
              </div>
            </div>

            <h3 className="sub-head" id="stats-cms">
              CM execution
              <span style={{ marginLeft: 8, color: "var(--color-ink-400)", fontWeight: 500, fontSize: 11, textTransform: "none", letterSpacing: 0 }}>
                this week vs 4-week trend
              </span>
            </h3>
            <div className="cm-table">
              <div className="row head">
                <span>Channel manager</span>
                <span>Market</span>
                <span>This wk / 4-wk avg</span>
                <span>4-wk trend</span>
                <span style={{ textAlign: "right" }}>vs avg</span>
              </div>
              {!payroll && (
                <div className="row">
                  <span style={{ gridColumn: "1 / -1", color: "var(--color-ink-400)", padding: "12px 0" }}>
                    Loading…
                  </span>
                </div>
              )}
              {payroll && cmRows.length === 0 && (
                <div className="row">
                  <span style={{ gridColumn: "1 / -1", color: "var(--color-ink-400)", padding: "12px 0" }}>
                    No CM activity in the last 4 weeks.
                  </span>
                </div>
              )}
              {cmRows.map((cm) => {
                const max = Math.max(cm.thisWeek, Math.ceil(cm.avg), 1);
                const pct = Math.round((cm.thisWeek / max) * 100);
                const delta = deltaPill(cm.thisWeek, cm.avg);
                return (
                  <div key={cm.telegram_id} className="row">
                    <div className="name">
                      <span className="av" style={{ background: cm.color }}>{cm.name?.[0] ?? "?"}</span>{" "}
                      <button className="db-link" onClick={() => openCM(cm.telegram_id, cm.name ?? "—", cm.market)}>
                        {cm.name ?? "—"}
                      </button>
                    </div>
                    <div className="market">{cm.market}</div>
                    <div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${pct}%`, background: cm.color }}></div>
                      </div>
                      <div className="bar-label">{cm.thisWeek} <span style={{ color: "var(--color-ink-400)" }}>/ {cm.avg.toFixed(1)}</span></div>
                    </div>
                    <div>
                      <svg className="sparkline" viewBox="0 0 100 24" preserveAspectRatio="none"
                           stroke="var(--color-ink-500)" strokeWidth="1.5" fill="none">
                        <polyline points={trendPolyline(cm.counts)} />
                      </svg>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span className={`rate-pill ${delta.cls}`}>{delta.txt}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="split-panels">
              <div className="panel">
                <h4>By market</h4>
                {byMarket.map((m) => (
                  <div key={m.market} className="panel-row">
                    <span className="k">{m.market}</span>
                    <span className="v">{m.visits} visit{m.visits !== 1 ? "s" : ""} · {m.stores}/{m.total} stores</span>
                    {m.rate !== null
                      ? <span className={`rate-pill ${ratePillClass(m.rate)}`}>{rateLabel(m.rate)}</span>
                      : <span style={{ color: "var(--color-ink-300)", fontSize: 11 }}>—</span>}
                  </div>
                ))}
              </div>
              <div className="panel">
                <h4>By tier</h4>
                {byTier.map((t) => (
                  <div key={t.tier} className="panel-row">
                    <span className="k">{t.tier}</span>
                    <span className="v">{t.visits} visit{t.visits !== 1 ? "s" : ""} · {t.stores}/{t.total} stores</span>
                    {t.rate !== null
                      ? <span className={`rate-pill ${ratePillClass(t.rate)}`}>{rateLabel(t.rate)}</span>
                      : <span style={{ color: "var(--color-ink-300)", fontSize: 11 }}>—</span>}
                  </div>
                ))}
              </div>
            </div>

            <h3 className="sub-head" id="stats-visited">
              Stores visited
              <span style={{ marginLeft: 8, color: "var(--color-ink-400)", fontWeight: 500, fontSize: 11, textTransform: "none", letterSpacing: 0 }}>
                {visits.length} visits · {uniqueStoresVisited} stores
              </span>
            </h3>

            <div className="db-head">
              <div className="view-toggle">
                <button className="active">Table</button>
              </div>
              <Link href="/visits" className="db-btn" style={{ marginLeft: "auto", color: "var(--color-tc-600)", textDecoration: "none" }}>
                Open feed →
              </Link>
            </div>

            <div className="db-table">
              <div className="db-row head">
                <span>Store</span>
                <span>Market</span>
                <span>Tier</span>
                <span>CM</span>
                <span>Day</span>
                <span>Sections</span>
                <span style={{ textAlign: "right" }}>—</span>
              </div>
              {visits.length === 0 && (
                <div className="db-row">
                  <span style={{ gridColumn: "1 / -1", color: "var(--color-ink-400)", padding: "12px 0" }}>
                    No visits this week yet.
                  </span>
                </div>
              )}
              {visits.slice(0, 12).map((v) => {
                const sec = countSections(v);
                return (
                  <div key={v.id} className="db-row">
                    <span className="store">
                      <button className="db-link" onClick={() => openStore(v.store_id, v.store_name)}>
                        {v.store_name}
                      </button>
                    </span>
                    <span className="mk">{v.store_market}</span>
                    <span>{v.store_tier && <span className="tier">{v.store_tier}</span>}</span>
                    <span>
                      <button className="db-link" onClick={() => openCM(v.cm_telegram_id, v.cm_name, v.store_market)}>
                        {v.cm_name}
                      </button>
                    </span>
                    <span className="mk">{dayShort(v.visit_date)}</span>
                    <div className="sec-dots">
                      {sec.on.map((on, i) => (
                        <div key={i} className={`d${on ? " on" : ""}`}></div>
                      ))}
                    </div>
                    <span style={{ textAlign: "right", fontSize: 11, color: "var(--color-ink-400)", fontFamily: "ui-monospace, monospace" }}>
                      {sec.total}/5
                    </span>
                  </div>
                );
              })}
              {visits.length > 0 && (
                <div className="db-footer">
                  <span>Showing {Math.min(visits.length, 12)} of {visits.length}</span>
                  <span>{stores.length} total stores</span>
                </div>
              )}
            </div>
          </section>

          {/* 2. INTELLIGENCE */}
          <section className="chapter" id="intel">
            <div className="chapter-head">
              <span className="num">02</span>
              <h2>Intelligence</h2>
              {reports.length > 0 && (
                <span className="chapter-cadence">{reports.length} brief{reports.length !== 1 ? "s" : ""} on file</span>
              )}
            </div>

            <div className="intel-datebar">
              <div className="sub-tab-row">
                <button className={intelView === "daily" ? "active" : ""} onClick={() => setIntelView("daily")}>
                  Daily
                </button>
                <button className={intelView === "weekly" ? "active" : ""} onClick={() => setIntelView("weekly")}>
                  Weekly report
                </button>
              </div>
              {intelView === "daily" ? (
                <div className="date-nav">
                  <button className="arrow" title="Older brief" disabled={!hasPrev} onClick={goPrev}>‹</button>
                  <button className="date-label">
                    📅 {activeDate ? fmtDateHeader(activeDate) : "No briefs yet"}
                  </button>
                  <button className="arrow" title="Newer brief" disabled={!hasNext} onClick={goNext}>›</button>
                  <button className="today-btn" disabled={reports.length === 0} onClick={goToday}>Latest</button>
                </div>
              ) : (
                <div className="date-nav">
                  <button className="date-label">📅 {weekRange}</button>
                </div>
              )}
            </div>

            {intelView === "daily" && reports.length === 0 && (
              <div className="shell-empty">
                No intelligence briefs yet. Run <code>npm run intelligence</code> to generate today&apos;s.
              </div>
            )}
            {intelView === "daily" && reports.length > 0 && reportLoading && (
              <div className="shell-empty">Loading brief…</div>
            )}
            {intelView === "daily" && report && !reportLoading && (
              <div className="markdown-brief" style={{ marginTop: 8 }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
                  components={{
                    a({ href, children, ...props }) {
                      return <a href={href} {...props}>{children}</a>;
                    },
                  }}
                >
                  {stripBriefTitle(stripAnalyticsSection(report.brief_markdown))}
                </ReactMarkdown>
                <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--color-border)" }}>
                  <Link href="/intelligence" style={{ color: "var(--color-tc-600)", textDecoration: "none", fontWeight: 600, fontSize: 13 }}>
                    Open full intelligence workspace →
                  </Link>
                </div>
              </div>
            )}
            {intelView === "weekly" && (
              <div className="shell-empty">
                Weekly report not yet generated.<br />
                <span style={{ color: "var(--color-ink-400)", fontSize: 12 }}>
                  Daily briefs are available above — switch to the Daily tab.
                </span>
              </div>
            )}
          </section>

          {/* 3. MEMORY */}
          <section className="chapter" id="memory">
            <div className="chapter-head">
              <span className="num">03</span>
              <h2>Memory</h2>
              <span className="chapter-cadence">notes that grow with every visit</span>
            </div>

            {notes.length === 0 && (
              <div className="shell-empty">
                No memory notes yet. They&apos;ll accrue as briefs reference stores, people, themes and channels.
              </div>
            )}
            {notes.length > 0 && (
              <>
                <div className="db-head">
                  <span style={{ fontSize: 12, color: "var(--color-ink-400)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700 }}>
                    Recently touched
                  </span>
                  <Link href="/intelligence" className="db-btn" style={{ marginLeft: "auto", color: "var(--color-tc-600)", textDecoration: "none" }}>
                    Browse all →
                  </Link>
                </div>
                <div className="db-table">
                  {notes.map((n) => (
                    <button
                      key={n.slug}
                      onClick={() => setNoteSlug(n.slug)}
                      className="db-row"
                      style={{
                        gridTemplateColumns: "32px 1fr auto",
                        textDecoration: "none",
                        color: "inherit",
                        gap: 12,
                        background: "none",
                        border: "none",
                        font: "inherit",
                        textAlign: "left",
                        width: "100%",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ fontSize: 16 }}>{SCOPE_ICON[n.scope] ?? "✦"}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {n.title}
                        </div>
                        <div style={{ fontSize: 12, color: "var(--color-ink-400)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {n.summary}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, color: "var(--color-ink-400)", fontFamily: "ui-monospace, monospace" }}>
                        {fmtRelative(n.last_touched_at)}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

        </main>

        {/* RIGHT DETAIL DRAWER ──────────────────────────── */}
        <aside className="dashboard-detail">
          {kpi !== null ? (
            <>
              <KpiDrawer
                kpi={kpi}
                visitsThisWeek={visits.length}
                uniqueStoresVisited={uniqueStoresVisited}
                stats={stats}
                weeklyVisitTotals={weeklyVisitTotals}
                byMarket={byMarket}
                cmRows={cmRows}
                onClose={() => setKpi(null)}
                onOpenCM={openCM}
              />
              {kpiFeedHref && (
                <div className="dashboard-drawer-footer">
                  <Link href={kpiFeedHref}>View these visits in Store Updates →</Link>
                </div>
              )}
            </>
          ) : detail === null ? (
            <div className="vdp-empty-state">
              <div className="vdp-empty-icon" style={{ fontSize: 32, opacity: 0.2 }}>🏪</div>
              <div className="vdp-empty-title">Nothing selected</div>
              <div className="vdp-empty-hint">Click a store, CM, KPI, or note to see details here</div>
            </div>
          ) : (
            <>
              {detail.type === "store" ? (
                <StoreDetailPanel
                  key={detail.storeId}
                  storeId={detail.storeId}
                  storeName={detail.storeName}
                  onClose={() => setDetail(null)}
                  onOpenCM={(id, name, market) => openCM(id, name, market)}
                  onOpenStaff={(staffId, staffName, sName) => setDetail({ type: "staff", staffId, staffName, storeName: sName })}
                  onOpenVisit={(storeId) => goToVisitStore(storeId)}
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
                  onOpenStore={(storeId, storeName) => openStore(storeId, storeName)}
                  onOpenVisit={(storeId) => goToVisitStore(storeId)}
                  onOpenNote={(slug) => setNoteSlug(slug)}
                />
              ) : (
                <StaffDetailPanel
                  key={detail.staffId}
                  staffId={detail.staffId}
                  staffName={detail.staffName}
                  storeName={detail.storeName}
                  onClose={() => setDetail(null)}
                  onOpenVisit={(storeId) => goToVisitStore(storeId)}
                />
              )}
              {drawerStoreUpdatesHref && (
                <div className="dashboard-drawer-footer">
                  <Link href={drawerStoreUpdatesHref}>Open in Store Updates →</Link>
                </div>
              )}
            </>
          )}
        </aside>
      </div>

      <MemoryNoteDrawer slug={noteSlug} onClose={() => setNoteSlug(null)} />
    </div>
  );
}

// ─── KPI history / breakdown drawer ───────────────────────────────────────────
// Reuses already-computed page data — no extra fetch. Visit KPIs show a weekly
// trend; coverage shows per-market; active-CMs lists CMs (clickable).

interface CmRow { telegram_id: number; name: string; market: "SG" | "MY" | "TH" | "HK"; thisWeek: number; avg: number }
interface MarketRow { market: "SG" | "MY" | "TH" | "HK"; visits: number; stores: number; total: number; rate: number | null }

function KpiDrawer({
  kpi, visitsThisWeek, uniqueStoresVisited, stats, weeklyVisitTotals, byMarket, cmRows, onClose, onOpenCM,
}: {
  kpi: KpiKey;
  visitsThisWeek: number;
  uniqueStoresVisited: number;
  stats: Stats | null;
  weeklyVisitTotals: { week: PayrollWeek; total: number }[];
  byMarket: MarketRow[];
  cmRows: CmRow[];
  onClose: () => void;
  onOpenCM: (telegramId: number, name: string, market: string) => void;
}) {
  const META: Record<KpiKey, { label: string; value: string }> = {
    visits_week:    { label: "Visits this week",   value: `${visitsThisWeek}` },
    stores_covered: { label: "Stores covered",     value: `${uniqueStoresVisited} / ${stats?.total_stores ?? "—"}` },
    active_cms:     { label: "Active CMs (month)",  value: `${stats?.active_cms_this_month ?? "—"} / ${stats?.total_cms ?? "—"}` },
    visits_month:   { label: "Visits this month",  value: `${stats?.visits_this_month ?? "—"}` },
  };
  const meta = META[kpi];
  const maxWeek = Math.max(...weeklyVisitTotals.map(w => w.total), 1);

  return (
    <>
      <div className="vdp-header">
        <div className="vdp-header-row">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="vdp-sub" style={{ marginBottom: 2 }}>📊 Metric</div>
            <div className="vdp-title">{meta.label}</div>
            <div className="vdp-sub">{meta.value}</div>
          </div>
          <button className="vdp-close" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="vdp-scroll">
        {(kpi === "visits_week" || kpi === "visits_month") && (
          weeklyVisitTotals.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-ink-300)", textAlign: "center", paddingTop: 32 }}>No history yet.</p>
          ) : (
            <>
              <div className="vdp-section-header">Weekly visits<span className="vdp-section-count">{weeklyVisitTotals.length} wks</span></div>
              {weeklyVisitTotals.map((w, i) => {
                const isCurrent = i === weeklyVisitTotals.length - 1;
                return (
                  <div key={w.week.start} className="vdp-item" style={{ cursor: "default" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="vdp-item-name" style={{ fontWeight: isCurrent ? 800 : 600 }}>{fmtWeekRange(w.week.start)}</div>
                      <div className="bar-track" style={{ marginTop: 4 }}>
                        <div className="bar-fill" style={{ width: `${Math.round((w.total / maxWeek) * 100)}%`, background: isCurrent ? "var(--color-tc-500)" : "var(--color-ink-300)" }} />
                      </div>
                    </div>
                    <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{w.total}</span>
                  </div>
                );
              })}
            </>
          )
        )}

        {kpi === "stores_covered" && (
          <>
            <div className="vdp-section-header">Coverage by market</div>
            {byMarket.map(m => (
              <div key={m.market} className="vdp-kv-row">
                <span className="vdp-kv-label">{m.market}</span>
                <span className="vdp-kv-val">
                  {m.stores}/{m.total} stores
                  {m.rate !== null && <span style={{ color: "var(--color-ink-400)", fontWeight: 600 }}> · {Math.round(m.rate * 100)}%</span>}
                </span>
              </div>
            ))}
          </>
        )}

        {kpi === "active_cms" && (
          cmRows.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--color-ink-300)", textAlign: "center", paddingTop: 32 }}>No CM activity yet.</p>
          ) : (
            <>
              <div className="vdp-section-header">Channel managers<span className="vdp-section-count">{cmRows.length}</span></div>
              {cmRows.map(cm => (
                <div key={cm.telegram_id} className="vdp-item" onClick={() => onOpenCM(cm.telegram_id, cm.name, cm.market)}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="vdp-item-name">{cm.name}</div>
                    <div className="vdp-item-meta">{cm.market} · {cm.thisWeek} this week · {cm.avg.toFixed(1)} avg</div>
                  </div>
                  <span className="vdp-item-chev">›</span>
                </div>
              ))}
            </>
          )
        )}
      </div>
    </>
  );
}
