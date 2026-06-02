"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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

interface CoverageStore {
  id: string;
  name: string;
  chain: string;
  market: "SG" | "MY" | "TH" | "HK";
  tier: "T1" | "T2" | "T3" | "T4" | null;
  weeks: boolean[];
  last_visit_date: string | null;
}
interface CoverageGrid {
  weeks: string[];
  stores: CoverageStore[];
  total: number;
  ever_visited: number;
  asof: string;
}

interface ExecutionRow {
  telegram_id: number;
  full_name: string;
  market: "SG" | "MY" | "TH" | "HK";
  planned: number;
  fulfilled: number;
  executed: number;
}
interface ExecutionGrid {
  rows: ExecutionRow[];
  total_planned: number;
  total_executed: number;
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
function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
const CM_COLORS = ["#8B6534", "#6B4E7A", "#4A6A3F", "#3F5A78", "#B86B00", "#5B3FB5", "#1E7A3A", "#B5331A"];
function colorForIdx(i: number) { return CM_COLORS[i % CM_COLORS.length]; }

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
  const [coverage, setCoverage] = useState<CoverageGrid | null>(null);
  const [execution, setExecution] = useState<ExecutionGrid | null>(null);

  // Statistics view toggle + coverage grouping
  const [statsView, setStatsView] = useState<"stores" | "cms">("stores");
  const [coverageGroup, setCoverageGroup] = useState<"country" | "tier">("country");

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
    fetch("/api/coverage").then(r => r.ok ? r.json() : null).then(d => {
      if (d) setCoverage(d);
    });
    fetch(`/api/execution?from=${weekMon}&to=${weekSun}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d) setExecution(d);
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
                  <li><a href="#stats-coverage">Coverage &amp; execution</a></li>
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

            <h3 className="sub-head" id="stats-coverage">Coverage &amp; execution</h3>

            <div className="stats-bar">
              <div className="stats-seg">
                <button className={statsView === "stores" ? "on" : ""} onClick={() => setStatsView("stores")}>Stores</button>
                <button className={statsView === "cms" ? "on" : ""} onClick={() => setStatsView("cms")}>CMs</button>
              </div>
              {statsView === "stores" && coverage && (
                <span className="stats-count">
                  <b>{coverage.ever_visited}</b> / {coverage.total} visited
                  {coverage.total - coverage.ever_visited > 0 && (
                    <> · <b className="r">{coverage.total - coverage.ever_visited} never visited</b></>
                  )}
                </span>
              )}
              {statsView === "cms" && execution && (
                <span className="stats-count">
                  team <b>{execution.total_executed}</b> executed this week
                  {execution.total_planned > 0 && <> · <b>{execution.total_planned}</b> planned</>}
                </span>
              )}
            </div>

            {statsView === "stores"
              ? <CoverageView coverage={coverage} group={coverageGroup} onGroupChange={setCoverageGroup} onOpenStore={openStore} />
              : <ExecutionView execution={execution} weekRange={weekRange} />}
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

// ─── Statistics: Coverage heatmap (Stores view) ───────────────────────────────

const COV_CADENCE: Record<string, number> = { T1: 7, T2: 14, T3: 30, T4: 90 };
const MARKET_FLAG: Record<string, string> = { SG: "🇸🇬", MY: "🇲🇾", TH: "🇹🇭", HK: "🇭🇰" };
const MARKET_NAME: Record<string, string> = { SG: "Singapore", MY: "Malaysia", TH: "Thailand", HK: "Hong Kong" };
const MARKET_ORDER = ["SG", "MY", "TH", "HK"];
const TIER_META: { key: "T1" | "T2" | "T3" | "T4" | null; label: string; cad: string }[] = [
  { key: "T1", label: "Tier 1", cad: "weekly" },
  { key: "T2", label: "Tier 2", cad: "fortnightly" },
  { key: "T3", label: "Tier 3", cad: "monthly" },
  { key: "T4", label: "Tier 4", cad: "quarterly" },
  { key: null, label: "Untiered", cad: "no set cadence" },
];

function daysAgoFrom(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 86400000);
}
function covStatus(days: number | null, tier: string | null): "g" | "a" | "r" {
  if (days === null) return "r";
  const c = (tier && COV_CADENCE[tier]) || 30;
  return days > c ? "r" : days > c * 0.75 ? "a" : "g";
}
function covBarColor(p: number): string {
  return p >= 80 ? "#2F8A57" : p >= 40 ? "#B5811F" : "#C0473C";
}
function dayMonth(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function coverageRatio(stores: CoverageStore[]): number {
  if (!stores.length) return 0;
  return stores.filter((s) => s.last_visit_date !== null).length / stores.length;
}

function HeatHead({ weeks }: { weeks: string[] }) {
  return (
    <div className="hm-head">
      <span /><span>Store</span><span className="hm-tierlab">Tier</span>
      {weeks.map((w, i) => (
        <span key={w} className={`hm-wk${i === weeks.length - 1 ? " now" : ""}`}>{dayMonth(w)}</span>
      ))}
      <span className="hm-lastlab">Last visit</span>
    </div>
  );
}

function HeatRow({ store, onOpenStore }: { store: CoverageStore; onOpenStore: (id: string, name: string) => void }) {
  const days = daysAgoFrom(store.last_visit_date);
  const st = covStatus(days, store.tier);
  return (
    <div className="hm-row">
      <span className={`hm-dot ${st}`} />
      <button className="hm-name" onClick={() => onOpenStore(store.id, store.name)}>{store.name}</button>
      <span className={`hm-tier ${store.tier ?? "none"}`}>{store.tier ?? "–"}</span>
      {store.weeks.map((v, i) => (
        <span key={i} className={`hm-cell${v ? " v" : ""}${i === store.weeks.length - 1 ? " now" : ""}`} />
      ))}
      <span className="hm-last">
        {days !== null ? `${days}d ago · ${dayMonth(store.last_visit_date!)}` : "never"}
      </span>
    </div>
  );
}

function ChannelBlock({ chain, stores, weeks, onOpenStore }: {
  chain: string; stores: CoverageStore[]; weeks: string[]; onOpenStore: (id: string, name: string) => void;
}) {
  const visited = stores.filter((s) => s.last_visit_date !== null);
  const never = stores.length - visited.length;
  const tot = stores.length;
  const pct = tot ? Math.round((visited.length / tot) * 100) : 0;
  const open = visited.length > 0 && visited.length <= 8;
  return (
    <details className="cov-chan" open={open}>
      <summary className="cov-chan-h">
        <span className="cov-chan-name">{chain}{pct === 100 && tot > 0 && <span className="cov-full">✓ full</span>}</span>
        <span className="cov-bar"><i style={{ width: `${pct}%`, background: covBarColor(pct) }} /></span>
        <span className="cov-frac">{visited.length}<small>/{tot}</small></span>
        <span className="cov-chev">›</span>
      </summary>
      <div className="cov-grid">
        <HeatHead weeks={weeks} />
        {visited.map((s) => <HeatRow key={s.id} store={s} onOpenStore={onOpenStore} />)}
        {never > 0 && (
          <div className="cov-never"><span className="cov-never-pill">{never}</span> not yet visited — never logged</div>
        )}
      </div>
    </details>
  );
}

function CovBand({ title, flag, tierChip, cad, visited, total, openDefault, children }: {
  title: string; flag?: string; tierChip?: "T1" | "T2" | "T3" | "T4" | null; cad?: string;
  visited: number; total: number; openDefault?: boolean; children: ReactNode;
}) {
  const pct = total ? Math.round((visited / total) * 100) : 0;
  const isTier = tierChip !== undefined;
  return (
    <details className="cov-band" open={openDefault}>
      <summary className="cov-band-h">
        <span className="cov-band-title">
          {isTier
            ? <span className={`cov-tierchip ${tierChip ?? "none"}`}>{tierChip ?? "–"}</span>
            : <span className="cov-flag">{flag}</span>}
          {title}
          {cad && <span className="cov-cad">· {cad}</span>}
        </span>
        <span className="cov-bar"><i style={{ width: `${pct}%`, background: covBarColor(pct) }} /></span>
        <span className="cov-frac">{visited}<small> / {total} visited</small></span>
        <span className="cov-chev">›</span>
      </summary>
      <div className="cov-chans">{children}</div>
    </details>
  );
}

function CoverageView({ coverage, group, onGroupChange, onOpenStore }: {
  coverage: CoverageGrid | null;
  group: "country" | "tier";
  onGroupChange: (g: "country" | "tier") => void;
  onOpenStore: (id: string, name: string) => void;
}) {
  if (!coverage) return <div className="shell-empty">Loading coverage…</div>;
  const { weeks, stores, total, ever_visited } = coverage;
  const pct = total ? Math.round((ever_visited / total) * 100) : 0;
  const never = total - ever_visited;

  function channelsFor(subset: CoverageStore[]) {
    const chains = [...new Set(subset.map((s) => s.chain))];
    return chains
      .map((c) => ({ chain: c, stores: subset.filter((s) => s.chain === c) }))
      .sort((a, b) => coverageRatio(a.stores) - coverageRatio(b.stores)); // worst-covered first
  }

  let bands: ReactNode;
  if (group === "country") {
    const markets = MARKET_ORDER.filter((m) => stores.some((s) => s.market === m));
    bands = markets.map((m) => {
      const subset = stores.filter((s) => s.market === m);
      const v = subset.filter((s) => s.last_visit_date !== null).length;
      return (
        <CovBand key={m} title={MARKET_NAME[m] ?? m} flag={MARKET_FLAG[m] ?? "🏳️"} visited={v} total={subset.length} openDefault>
          {channelsFor(subset).map((ch) => (
            <ChannelBlock key={ch.chain} chain={ch.chain} stores={ch.stores} weeks={weeks} onOpenStore={onOpenStore} />
          ))}
        </CovBand>
      );
    });
  } else {
    bands = TIER_META.filter((t) => stores.some((s) => s.tier === t.key)).map((t) => {
      const subset = stores.filter((s) => s.tier === t.key);
      const v = subset.filter((s) => s.last_visit_date !== null).length;
      return (
        <CovBand key={t.label} title={t.label} tierChip={t.key} cad={t.cad} visited={v} total={subset.length}
          openDefault={t.key === "T2" || t.key === "T3"}>
          {channelsFor(subset).map((ch) => (
            <ChannelBlock key={ch.chain} chain={ch.chain} stores={ch.stores} weeks={weeks} onOpenStore={onOpenStore} />
          ))}
        </CovBand>
      );
    });
  }

  return (
    <div className="cov-wrap">
      <div className="cov-overall">
        <span className="cov-overall-big">{ever_visited}<span> / {total} stores</span></span>
        <span className="cov-overall-bar"><i style={{ width: `${pct}%` }} /></span>
        <span className="cov-overall-note">{pct}% visited{never > 0 && <> · <b>{never} never visited</b></>}</span>
      </div>

      <div className="cov-toggle">
        <button className={group === "country" ? "on" : ""} onClick={() => onGroupChange("country")}>Country → Channel</button>
        <button className={group === "tier" ? "on" : ""} onClick={() => onGroupChange("tier")}>Tier → Channel</button>
      </div>

      <div className="cov-legend">
        <span><i className="cov-sq v" /> visited</span>
        <span><i className="cov-sq" /> no visit</span>
        <span><i className="cov-sq now" /> this week</span>
        <span className="cov-legend-cad">Cadence: T1 weekly · T2 fortnightly · T3 monthly · T4 quarterly</span>
      </div>
      <p className="cov-sub">Last 6 weeks · filled = visited that week. Status judged vs each tier&apos;s cadence.</p>

      <div className="cov-groups">{bands}</div>
    </div>
  );
}

// ─── Statistics: Execution (CMs view) ─────────────────────────────────────────

function ExecutionView({ execution, weekRange }: { execution: ExecutionGrid | null; weekRange: string }) {
  if (!execution) return <div className="shell-empty">Loading…</div>;
  const { rows, total_planned, total_executed } = execution;

  if (total_planned === 0) {
    return (
      <div className="exec-empty">
        <div className="exec-empty-icon">🗓️</div>
        <div className="exec-empty-title">No plans logged yet</div>
        <div className="exec-empty-hint">
          Once CMs log their Friday plans, this view shows planned-vs-executed completion per CM, grouped by market.
          <br />This week ({weekRange}): <b>{total_executed}</b> visit{total_executed !== 1 ? "s" : ""} executed, with no plans to compare against.
        </div>
      </div>
    );
  }

  const markets = MARKET_ORDER.filter((m) => rows.some((r) => r.market === m));
  return (
    <div className="exec-panel">
      <div className="exec-head">
        <span>Market / CM</span><span className="exec-c">Planned</span><span className="exec-c">Executed</span><span>Completion</span>
      </div>
      {markets.map((m) => {
        const mrows = rows.filter((r) => r.market === m);
        const mp = mrows.reduce((a, r) => a + r.planned, 0);
        const mf = mrows.reduce((a, r) => a + r.fulfilled, 0);
        const mpct = mp ? Math.round((mf / mp) * 100) : 0;
        return (
          <div key={m}>
            <div className="exec-band">
              <span className="exec-mn">{MARKET_FLAG[m]} {MARKET_NAME[m]}</span>
              <span className="exec-c">{mp}</span><span className="exec-c">{mf}</span>
              <span className="exec-compl"><span className="exec-bar"><i style={{ width: `${mpct}%`, background: covBarColor(mpct) }} /></span><span className="exec-pct">{mpct}%</span></span>
            </div>
            {mrows.map((r) => {
              const cpct = r.planned ? Math.round((r.fulfilled / r.planned) * 100) : 0;
              return (
                <div key={r.telegram_id} className="exec-row">
                  <span className="exec-nm">{r.full_name}</span>
                  <span className="exec-c">{r.planned}</span><span className="exec-c">{r.fulfilled}</span>
                  <span className="exec-compl"><span className="exec-bar"><i style={{ width: `${cpct}%`, background: covBarColor(cpct) }} /></span><span className="exec-pct">{cpct}%</span></span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
