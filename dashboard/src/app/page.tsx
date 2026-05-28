"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "./dashboard-v3.css";

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
function fmtWeekRange(monIso: string): string {
  const mon = new Date(monIso + "T00:00:00");
  const sun = new Date(mon); sun.setDate(sun.getDate() + 6);
  const mShort = (d: Date) => d.toLocaleDateString("en-GB", { month: "short" });
  return `${mon.getDate()} ${mShort(mon)} — ${sun.getDate()} ${mShort(sun)}`;
}
function dayShort(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short" });
}
function countSections(v: VisitRow): { on: boolean[]; total: number } {
  const arr = [v.good_news, v.competitors, v.display_stock, v.follow_up, v.buzz_plan];
  const on = arr.map((s) => !!s);
  return { on, total: on.filter(Boolean).length };
}

// ── sample data for un-wired panels ──────────────────────────────
const SAMPLE_CMS = [
  { name: "Ricky",     market: "SG", planned: 5, executed: 4, color: "#8B6534", trend: "0,18 20,12 40,14 60,8 80,6 100,5" },
  { name: "Ginger",    market: "SG", planned: 5, executed: 5, color: "#6B4E7A", trend: "0,14 20,10 40,6 60,8 80,4 100,2" },
  { name: "Jerome",    market: "MY", planned: 5, executed: 3, color: "#4A6A3F", trend: "0,8 20,14 40,12 60,16 80,18 100,14" },
  { name: "Johnathan", market: "TH", planned: 4, executed: 2, color: "#3F5A78", trend: "0,12 20,10 40,16 60,14 80,18 100,16" },
  { name: "Zhi Yong",  market: "HK", planned: 4, executed: 4, color: "#B86B00", trend: "0,12 20,8 40,10 60,6 80,8 100,4" },
];

function pillForRate(rate: number): "good" | "mid" | "low" {
  if (rate >= 0.8) return "good";
  if (rate >= 0.6) return "mid";
  return "low";
}
function barColor(rate: number): string {
  if (rate >= 0.8) return "var(--green)";
  if (rate >= 0.6) return "var(--amber)";
  return "var(--red)";
}

export default function HomePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [stores, setStores] = useState<StoreStatus[]>([]);
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [intelView, setIntelView] = useState<"daily" | "weekly">("daily");

  const weekMon = useMemo(() => mondayOfISO(todayISO()), []);
  const weekSun = useMemo(() => shiftDays(weekMon, 6), [weekMon]);
  const weekRange = useMemo(() => fmtWeekRange(weekMon), [weekMon]);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => { if (d) setUser(d); });
    fetch("/api/overview").then(r => r.ok ? r.json() : null).then(d => {
      if (d) { setStats(d.stats); setStores(d.stores); }
    });
    fetch(`/api/visits?from=${weekMon}&to=${weekSun}`).then(r => r.ok ? r.json() : null).then(d => {
      if (d?.visits) setVisits(d.visits);
    });
  }, [weekMon, weekSun]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }, [router]);

  if (!user) return null;

  const initials = user.first_name.slice(0, 2).toUpperCase();
  const uniqueStoresVisited = new Set(visits.map(v => v.store_id)).size;

  return (
    <div className="dash-v3-root">

      {/* TOP NAV ─────────────────────────────────────────── */}
      <header className="topnav">
        <Link href="/" className="brand">sva<span className="dot">.</span></Link>
        <nav className="topnav-tabs">
          <button className="active"          onClick={() => router.push("/")}>Dashboard</button>
          <button                              onClick={() => router.push("/visits")}>Updates</button>
          {user.role === "admin" && (
            <button                            onClick={() => router.push("/admin")}>Admin</button>
          )}
        </nav>
        <div className="topnav-right">
          <span className="kbd">⌘K</span>
          <button onClick={logout} className="kbd" style={{ cursor: "pointer" }}>Sign out</button>
          <div className="avatar" title={user.first_name}>{initials}</div>
        </div>
      </header>

      <div className="page">

        {/* SIDEBAR ─────────────────────────────────────────── */}
        <aside className="side">
          <div className="side-section">
            <div className="side-label">Dashboard</div>
            <ul className="toc">
              <li>
                <a className="chap" href="#stats"><span className="n">01</span> Statistics</a>
                <ul className="toc sub">
                  <li><a href="#stats-overview">Overview</a></li>
                  <li><a href="#stats-cms">CM execution</a></li>
                  <li><a href="#stats-visited">Stores visited</a></li>
                </ul>
              </li>
              <li style={{ marginTop: 10 }}>
                <a className="chap" href="#intel"><span className="n">02</span> Intelligence</a>
                <ul className="toc sub">
                  <li><a href="#intel" onClick={() => setIntelView("daily")}>Daily highlights</a></li>
                  <li><a href="#intel" onClick={() => setIntelView("weekly")}>Weekly report</a></li>
                </ul>
              </li>
              <li style={{ marginTop: 10 }}>
                <a className="chap" href="#memory"><span className="n">03</span> Memory</a>
              </li>
            </ul>
          </div>
          <div className="side-foot">
            Brief delivered<br />
            📧 5 recipients · 💬 4 markets
          </div>
        </aside>

        {/* MAIN CANVAS ───────────────────────────────────── */}
        <main className="main">

          {/* HEADER */}
          <div className="header">
            <h1>Dashboard <em>— store visits</em></h1>
            <div className="meta">
              <span>{fmtTodayHeader()}</span>
              <span className="dot"></span>
              <span>SG · MY · TH · HK</span>
              <span className="dot"></span>
              <span>{stats ? `${stats.active_cms_this_month} channel manager${stats.active_cms_this_month === 1 ? "" : "s"}` : "—"}</span>
            </div>
          </div>

          {/* 1. STATISTICS ─────────────────────────────── */}
          <section className="chapter" id="stats">
            <div className="chapter-head">
              <span className="num">01</span>
              <h2>Statistics</h2>
              <div className="chapter-right">
                <button className="tf-pill">📅 <b>This week</b> <em>· {weekRange}</em> <span className="caret">▾</span></button>
                <button className="link-btn">+ Compare</button>
              </div>
            </div>

            <h3 className="sub-head" id="stats-overview">Overview</h3>
            <div className="kpi-grid">
              <div className="kpi">
                <div className="label">Visits</div>
                <div className="value">{visits.length}</div>
                <div className="delta flat">this week</div>
              </div>
              <div className="kpi">
                <div className="label">Stores covered</div>
                <div className="value">{uniqueStoresVisited}<span style={{ fontSize: 18, color: "var(--ink-4)" }}> /{stats?.total_stores ?? "—"}</span></div>
                <div className="delta flat">{stats ? `${stats.total_stores} active` : "—"}</div>
              </div>
              <div className="kpi">
                <div className="label">Active CMs</div>
                <div className="value">{stats?.active_cms_this_month ?? "—"}<span style={{ fontSize: 18, color: "var(--ink-4)" }}> /{stats?.total_cms ?? "—"}</span></div>
                <div className="delta flat">this month</div>
              </div>
              <div className="kpi">
                <div className="label">Visits this month</div>
                <div className="value">{stats?.visits_this_month ?? "—"}</div>
                <div className="delta flat">{stats ? `${stats.visits_all_time} all-time` : "—"}</div>
              </div>
            </div>

            <h3 className="sub-head" id="stats-cms">CM execution</h3>
            {/* TODO: wire to a new per-CM planned-vs-executed aggregation API */}
            <div className="cm-table">
              <div className="row head">
                <span>Channel manager</span>
                <span>Market</span>
                <span>Planned / Executed</span>
                <span>4-wk trend</span>
                <span style={{ textAlign: "right" }}>Rate</span>
              </div>
              {SAMPLE_CMS.map((cm) => {
                const rate = cm.executed / cm.planned;
                const pct = Math.round(rate * 100);
                return (
                  <div key={cm.name} className="row">
                    <div className="name">
                      <span className="av" style={{ background: cm.color }}>{cm.name[0]}</span> {cm.name}
                    </div>
                    <div className="market">{cm.market}</div>
                    <div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${pct}%`, background: barColor(rate) }}></div>
                      </div>
                      <div className="bar-label">{cm.executed} / {cm.planned}</div>
                    </div>
                    <div>
                      <svg className="sparkline" viewBox="0 0 100 24" preserveAspectRatio="none"
                           stroke="#3A3631" strokeWidth="1.5" fill="none">
                        <polyline points={cm.trend} />
                      </svg>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <span className={`pill ${pillForRate(rate)}`}>{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* TODO: wire by-market + by-tier aggregations once API is extended */}
            <div className="split">
              <div className="panel">
                <h4>By market</h4>
                <div className="row"><span className="k">SG</span><span className="v">5 visits · 3 stores</span><span><span className="pill good">86%</span></span></div>
                <div className="row"><span className="k">MY</span><span className="v">3 visits · 2 stores</span><span><span className="pill mid">60%</span></span></div>
                <div className="row"><span className="k">TH</span><span className="v">2 visits · 2 stores</span><span><span className="pill low">50%</span></span></div>
                <div className="row"><span className="k">HK</span><span className="v">2 visits · 1 store</span><span><span className="pill good">100%</span></span></div>
              </div>
              <div className="panel">
                <h4>By tier</h4>
                <div className="row"><span className="k">T1</span><span className="v">6 visits · 4 / 4 stores</span><span><span className="pill good">100%</span></span></div>
                <div className="row"><span className="k">T2</span><span className="v">4 visits · 3 / 5 stores</span><span><span className="pill mid">60%</span></span></div>
                <div className="row"><span className="k">T3</span><span className="v">2 visits · 1 / 4 stores</span><span><span className="pill low">25%</span></span></div>
                <div className="row"><span className="k">T4</span><span className="v">0 visits · 0 / 1 store</span><span><span className="pill low">0%</span></span></div>
              </div>
            </div>

            <h3 className="sub-head" id="stats-visited">
              Stores visited
              <span style={{ fontFamily: "var(--sans)", fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--ink-4)", marginLeft: 8 }}>
                {visits.length} visits · {uniqueStoresVisited} stores
              </span>
            </h3>

            <div className="db-head">
              <div className="view-toggle">
                <button className="active">Table</button>
                <button>Board</button>
                <button>Map</button>
              </div>
              <button className="db-btn">Filter</button>
              <button className="db-btn">↕ Sort</button>
              <button className="db-btn">Group</button>
              <Link href="/visits" className="db-btn" style={{ marginLeft: "auto", color: "var(--amber)" }}>Open feed →</Link>
            </div>

            <div className="db-table">
              <div className="db-row head">
                <span>Store</span>
                <span>Market</span>
                <span>Tier</span>
                <span>CM</span>
                <span>Day</span>
                <span>Sections touched</span>
                <span style={{ textAlign: "right" }}>—</span>
              </div>
              {visits.length === 0 && (
                <div className="db-row">
                  <span style={{ gridColumn: "1 / -1", color: "var(--ink-4)", padding: "12px 4px" }}>
                    No visits this week yet.
                  </span>
                </div>
              )}
              {visits.slice(0, 12).map((v) => {
                const sec = countSections(v);
                return (
                  <div key={v.id} className="db-row">
                    <span className="store">{v.store_name}</span>
                    <span className="mk">{v.store_market}</span>
                    <span>{v.store_tier && <span className="tier">{v.store_tier}</span>}</span>
                    <span>{v.cm_name}</span>
                    <span className="mk">{dayShort(v.visit_date)}</span>
                    <div className="sec-dots">
                      {sec.on.map((on, i) => (
                        <div key={i} className={`d${on ? " on" : ""}`}></div>
                      ))}
                    </div>
                    <span style={{ textAlign: "right", fontFamily: "var(--mono)", fontSize: 11.5, color: "var(--ink-2)" }}>
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

          {/* 2. INTELLIGENCE ───────────────────────────── */}
          <section className="chapter" id="intel">
            <div className="chapter-head">
              <span className="num">02</span>
              <h2>Intelligence</h2>
            </div>

            <div className="intel-datebar">
              <div className="sub-tab-row" id="hl-tabs">
                <button className={intelView === "daily" ? "active" : ""} onClick={() => setIntelView("daily")}>
                  Daily
                </button>
                <button className={intelView === "weekly" ? "active" : ""} onClick={() => setIntelView("weekly")}>
                  Weekly report
                </button>
              </div>
              {intelView === "daily" ? (
                <div className="date-nav">
                  <button className="arrow" title="Previous day">‹</button>
                  <button className="date-label">📅 <em>{fmtTodayHeader()}</em></button>
                  <button className="arrow" title="Next day">›</button>
                  <button className="today-btn">Today</button>
                </div>
              ) : (
                <div className="date-nav">
                  <button className="arrow" title="Previous week">‹</button>
                  <button className="date-label">📅 <em>{weekRange}</em></button>
                  <button className="arrow" title="Next week">›</button>
                  <button className="today-btn">This week</button>
                </div>
              )}
            </div>

            <div style={{
              padding: "48px 24px",
              border: "1px dashed var(--line-2)",
              borderRadius: 10,
              textAlign: "center",
              color: "var(--ink-4)",
              fontSize: 13.5,
              background: "var(--bg-card)",
            }}>
              {intelView === "daily"
                ? "Daily highlights will appear here — content design in progress."
                : "Weekly report will appear here — content design in progress."}
            </div>
          </section>

          {/* 3. MEMORY ─────────────────────────────────── */}
          <section className="chapter" id="memory">
            <div className="chapter-head">
              <span className="num">03</span>
              <h2>Memory</h2>
              <span className="cadence">notes that grow with every visit</span>
            </div>

            <div style={{
              padding: "48px 24px",
              border: "1px dashed var(--line-2)",
              borderRadius: 10,
              textAlign: "center",
              color: "var(--ink-4)",
              fontSize: 13.5,
              background: "var(--bg-card)",
            }}>
              Memory browser will appear here — content design in progress.<br />
              <Link href="/intelligence" style={{ color: "var(--amber)", marginTop: 12, display: "inline-block" }}>
                Open the existing memory browser →
              </Link>
            </div>
          </section>

        </main>
      </div>
    </div>
  );
}
