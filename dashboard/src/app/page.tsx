"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import RefreshControl from "@/components/RefreshControl";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import NavBar from "@/components/NavBar";
import StoreVisitDrawer from "@/components/StoreVisitDrawer";
import MemoryNoteDrawer from "@/components/MemoryNoteDrawer";

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"],
};

interface User { first_name: string; username?: string }

interface ReportSummary {
  id: string;
  report_date: string;
  version: number;
  edited_by_human: boolean;
  model: string | null;
  stats: Record<string, unknown>;
  created_at: string;
}

interface ReportFull extends ReportSummary {
  brief_markdown: string;
}

interface NoteSummary {
  slug: string;
  scope: "store" | "person" | "theme" | "channel";
  scope_ref: string;
  title: string;
  summary: string;
  version: number;
  tier: "short" | "long";
  last_touched_at: string;
  edited_by_human: boolean;
  related_slugs: string[];
}

type ScopeFilter = "all" | "theme" | "store" | "person" | "channel";

const SCOPE_TABS: { value: ScopeFilter; label: string; icon: string }[] = [
  { value: "all", label: "All", icon: "✦" },
  { value: "theme", label: "Themes", icon: "🧵" },
  { value: "store", label: "Stores", icon: "🏬" },
  { value: "person", label: "People", icon: "👤" },
  { value: "channel", label: "Channels", icon: "🔗" },
];

const MARKET_FLAG: Record<string, string> = { SG: "🇸🇬", MY: "🇲🇾", TH: "🇹🇭", HK: "🇭🇰" };

function fmtWeekday(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}
function fmtDateShort(iso: string): string {
  return new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", {
    day: "numeric", month: "short",
  });
}
function fmtRelative(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  return fmtDateShort(iso);
}

// ─── Brief parsing ────────────────────────────────────────────────────────────
// The stored brief IS the endorsed data ("content is right"). Parse it rather than
// re-deriving stats live — single source of truth, no engagements-field drift.

interface MdTable { header: string[]; rows: string[][] }
interface ExecData {
  planned: string; visited: string; engagements: string;
  cms: { name: string; market: string; visited: string; engagements: string }[];
}
interface Section { kind: "signals" | "alerts" | "threads" | "other"; title: string; body: string }

function splitCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}
function parseTables(block: string): MdTable[] {
  const tables: MdTable[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length >= 2) {
      const header = splitCells(cur[0]);
      const rows = cur.slice(2).map(splitCells); // skip the --- separator row
      tables.push({ header, rows });
    }
    cur = [];
  };
  for (const ln of block.split("\n")) {
    if (ln.trim().startsWith("|")) cur.push(ln);
    else flush();
  }
  flush();
  return tables;
}
function parseExecution(block: string): ExecData | null {
  const tables = parseTables(block);
  if (!tables.length) return null;
  const totalsT = tables.find((t) => t.header.some((h) => /planned/i.test(h)));
  const cmT = tables.find((t) => t.header.some((h) => /channel manager/i.test(h))) ?? tables[tables.length - 1];
  let planned = "—", visited = "—", engagements = "—";
  if (totalsT?.rows[0]) {
    const r = totalsT.rows[0]; // | All CMs | planned | executed | engagements |
    planned = r[1] ?? "—"; visited = r[2] ?? "—"; engagements = r[3] ?? "—";
  }
  const cms = (cmT?.rows ?? [])
    .filter((r) => r[0] && !/all cms/i.test(r[0]))
    .map((r) => ({ name: r[0], market: r[1] ?? "", visited: r[2] ?? "0", engagements: r[3] ?? "0" }));
  if (totalsT === undefined && cms.length) {
    // derive totals from CM rows when no totals table present
    visited = String(cms.reduce((s, c) => s + (parseInt(c.visited) || 0), 0));
    engagements = String(cms.reduce((s, c) => s + (parseInt(c.engagements) || 0), 0));
  }
  return { planned, visited, engagements, cms };
}
function parseBrief(md: string): { exec: ExecData | null; sections: Section[] } {
  const chunks = md.split(/\n(?=## )/);
  let exec: ExecData | null = null;
  const sections: Section[] = [];
  for (const chunk of chunks) {
    const nl = chunk.indexOf("\n");
    const head = (nl === -1 ? chunk : chunk.slice(0, nl)).replace(/^##\s*/, "").trim();
    const body = nl === -1 ? "" : chunk.slice(nl + 1).trim();
    if (/execution/i.test(head)) exec = parseExecution(body);
    else if (/signals/i.test(head)) sections.push({ kind: "signals", title: head, body });
    else if (/alerts/i.test(head)) sections.push({ kind: "alerts", title: head, body });
    else if (/threads/i.test(head)) sections.push({ kind: "threads", title: head, body });
    else if (body) sections.push({ kind: "other", title: head, body });
  }
  return { exec, sections };
}

export default function HomePage() {
  const [user, setUser] = useState<User | null>(null);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [report, setReport] = useState<ReportFull | null>(null);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingReport, setLoadingReport] = useState(false);
  const [drawerStoreId, setDrawerStoreId] = useState<string | null>(null);
  const [drawerNoteSlug, setDrawerNoteSlug] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((d) => d && setUser(d));
  }, []);

  useEffect(() => {
    fetch("/api/intelligence/reports").then((r) => r.json()).then((d) => {
      setReports(d.reports ?? []);
      if (d.reports?.[0]) setActiveDate(d.reports[0].report_date);
    });
  }, []);

  const loadNotes = useCallback(() => {
    fetch("/api/intelligence/notes").then((r) => r.json()).then((d) => setNotes(d.notes ?? []));
  }, []);
  useEffect(() => { loadNotes(); }, [loadNotes]);

  const silentRefresh = useCallback(async () => {
    const [reportList, currentReport, noteList] = await Promise.all([
      fetch("/api/intelligence/reports").then((r) => r.ok ? r.json() : null),
      activeDate ? fetch(`/api/intelligence/reports/${activeDate}`).then((r) => r.ok ? r.json() : null) : Promise.resolve(null),
      fetch("/api/intelligence/notes").then((r) => r.ok ? r.json() : null),
    ]);
    if (reportList?.reports) setReports(reportList.reports);
    if (currentReport?.report !== undefined) setReport(currentReport.report ?? null);
    if (noteList?.notes) setNotes(noteList.notes);
  }, [activeDate]);

  const refresh = useAutoRefresh(silentRefresh, {
    intervalMs: 60_000,
    paused: editing || saving || drawerStoreId !== null || drawerNoteSlug !== null,
  });

  useEffect(() => {
    if (!activeDate) return;
    setLoadingReport(true);
    setEditing(false);
    fetch(`/api/intelligence/reports/${activeDate}`)
      .then((r) => r.json())
      .then((d) => { setReport(d.report ?? null); setDraft(d.report?.brief_markdown ?? ""); })
      .finally(() => setLoadingReport(false));
  }, [activeDate]);

  const parsed = useMemo(() => report ? parseBrief(report.brief_markdown) : null, [report]);
  const markets = useMemo(() => {
    const set = new Set((parsed?.exec?.cms ?? []).map((c) => c.market).filter(Boolean));
    return Array.from(set);
  }, [parsed]);

  const filteredNotes = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = notes.slice();
    if (scope !== "all") out = out.filter((n) => n.scope === scope);
    if (q) out = out.filter((n) => n.title.toLowerCase().includes(q) || n.summary.toLowerCase().includes(q));
    out.sort((a, b) => b.last_touched_at.localeCompare(a.last_touched_at));
    return out;
  }, [notes, scope, search]);

  async function saveEdit() {
    if (!activeDate) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/intelligence/reports/${activeDate}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief_markdown: draft }),
      });
      const data = await res.json();
      if (res.ok && data.report) {
        setReport(data.report);
        const list = await fetch("/api/intelligence/reports").then((r) => r.json());
        setReports(list.reports ?? []);
        setEditing(false);
      } else alert(data.error ?? "Save failed");
    } finally { setSaving(false); }
  }

  // Link interceptor → open the store drawer, styled as a mockup chip.
  //   /visits/store/<store_id>             — store mention
  //   /visits/visit/<store_id>/<visit_id>  — visit mention (carries the store id
  //     so the store-keyed drawer still resolves; the mini app uses the visit id)
  const mdComponents = (alert: boolean) => ({
    a({ href, children, ...props }: { href?: string; children?: React.ReactNode }) {
      const store = href?.match(/^\/visits\/store\/([^/?#]+)/);
      const visit = href?.match(/^\/visits\/visit\/([^/?#]+)/);
      const storeId = store?.[1] ?? visit?.[1];
      if (storeId) {
        return (
          <button className={`chip${alert ? " emg" : ""}`} onClick={() => setDrawerStoreId(storeId)}>
            {children}
          </button>
        );
      }
      return <a href={href} {...props}>{children}</a>;
    },
  });

  const signals = parsed?.sections.find((s) => s.kind === "signals");
  const alerts = parsed?.sections.find((s) => s.kind === "alerts");
  const exec = parsed?.exec;

  // Date navigation — reports are newest-first.
  const activeIdx = activeDate ? reports.findIndex((r) => r.report_date === activeDate) : -1;
  const hasOlder = activeIdx >= 0 && activeIdx < reports.length - 1;
  const hasNewer = activeIdx > 0;
  const goOlder = () => { if (hasOlder) setActiveDate(reports[activeIdx + 1].report_date); };
  const goNewer = () => { if (hasNewer) setActiveDate(reports[activeIdx - 1].report_date); };
  const goLatest = () => { if (reports.length > 0) setActiveDate(reports[0].report_date); };

  return (
    <>
      <NavBar user={user as { first_name: string; username?: string }} />
      <style>{INTEL_CSS}</style>
      <div className="intel">
        <div className="wrap">
          {/* Header */}
          <header className="head">
            <div className="head-row">
              <div>
                <div className="kicker">📊 SVA Daily Intelligence</div>
                <h1>{activeDate ? fmtWeekday(activeDate) : "Daily Intelligence"}</h1>
                <div className="sub">
                  {exec ? `${exec.visited} visit${exec.visited === "1" ? "" : "s"}` : "—"}
                  {markets.length ? ` across ${markets.join(" · ")}` : ""}
                  {report?.created_at ? ` · v${report.version}${report.edited_by_human ? " · edited" : ""}` : ""}
                </div>
              </div>
              <div className="head-actions">
                <RefreshControl controls={refresh} />
                {report && !editing && (
                  <button className="btn-edit" onClick={() => setEditing(true)}>Edit brief</button>
                )}
              </div>
            </div>

            {/* Day / Week toggle — Week is deferred (richer AI weekly template, later) */}
            <div className="modetoggle">
              <button className="on" type="button">Day</button>
              <button className="soon" type="button" disabled title="Coming soon — a richer AI weekly synthesis">Week</button>
            </div>

            {/* Day navigator: ‹ › arrows + date dropdown + Latest */}
            <div className="daynav">
              <button className="arrow" title="Older brief" disabled={!hasOlder} onClick={goOlder}>‹</button>
              <div className="datepick">
                <select
                  value={activeDate ?? ""}
                  onChange={(e) => setActiveDate(e.target.value)}
                  disabled={reports.length === 0}
                >
                  {reports.length === 0 && <option value="">No briefs yet</option>}
                  {reports.map((r, i) => (
                    <option key={r.report_date} value={r.report_date}>
                      {fmtDateShort(r.report_date)}{i === 0 ? "  ·  latest" : ""}{r.edited_by_human ? "  ✎" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <button className="today-btn" disabled={reports.length === 0 || activeIdx === 0} onClick={goLatest}>Latest</button>
              <button className="arrow" title="Newer brief" disabled={!hasNewer} onClick={goNewer}>›</button>
            </div>
          </header>

          {loadingReport && <p className="empty">Loading…</p>}
          {!loadingReport && !report && (
            <p className="empty">No reports yet. The routine generates one each morning from locked visits.</p>
          )}

          {/* ── Edit mode ── */}
          {editing && report && (
            <div className="card">
              <textarea
                className="editor"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={Math.min(40, Math.max(18, draft.split("\n").length + 2))}
              />
              <div className="editbar">
                <button className="btn-save" onClick={saveEdit} disabled={saving}>
                  {saving ? "Saving…" : "Save as new version"}
                </button>
                <button className="btn-cancel" onClick={() => { setEditing(false); setDraft(report.brief_markdown); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── Execution summary ── */}
          {!editing && report && exec && (
            <div className="card">
              <h2>Execution summary</h2>
              <div className="topline">
                <div className="stat s-plan">
                  <div className={`n${exec.planned === "—" ? " dim" : ""}`}>{exec.planned}</div>
                  <div className="l">Planned</div>
                </div>
                <div className="stat s-visit"><div className="n">{exec.visited}</div><div className="l">Visited</div></div>
                <div className="stat s-eng"><div className="n">{exec.engagements}</div><div className="l">Engagements</div></div>
              </div>
              <table>
                <thead>
                  <tr><th>Channel Manager</th><th>Market</th><th className="num">Visited</th><th className="num">Engagements</th></tr>
                </thead>
                <tbody>
                  {exec.cms.map((c, i) => (
                    <tr key={i}>
                      <td>{c.name}</td>
                      <td><span className="mk">{MARKET_FLAG[c.market] ?? ""} {c.market}</span></td>
                      <td className="num">{c.visited}</td>
                      <td className="num">{c.engagements}</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>All CMs</td>
                    <td><span className="mk dim">{markets.join(" · ") || "—"}</span></td>
                    <td className="num">{exec.visited}</td>
                    <td className="num">{exec.engagements}</td>
                  </tr>
                </tbody>
              </table>
              <div className="footnote">
                {exec.planned === "—" ? "No plans logged yet — planned-vs-visited fills in once CMs use the planning flow. " : ""}
                Engagements = visits with a people/training note.
              </div>
            </div>
          )}

          {/* ── Signals ── */}
          {!editing && report && (
            <div className="card">
              <h2>🔔 Signals <span className="h2-note">— patterns across ≥2 visits</span></h2>
              {signals?.body ? (
                <div className="md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]} components={mdComponents(false)}>
                    {signals.body}
                  </ReactMarkdown>
                </div>
              ) : <p className="calm">No repeated patterns today.</p>}
            </div>
          )}

          {/* ── Alerts (always shown) ── */}
          {!editing && report && (
            <div className="card card-emg">
              <h2 className="emg-h">🚨 Alerts <span className="h2-note">— explicit triggers only</span></h2>
              {alerts?.body ? (
                <div className="md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]} components={mdComponents(true)}>
                    {alerts.body}
                  </ReactMarkdown>
                </div>
              ) : <p className="calm">No alerts today.</p>}
            </div>
          )}

          {/* ── Memory ── */}
          {!editing && (
            <div className="card mem">
              <h2>Memory <span className="h2-note">— what the system remembers</span></h2>
              <div className="chips scopechips">
                {SCOPE_TABS.map((t) => {
                  const count = t.value === "all" ? notes.length : notes.filter((n) => n.scope === t.value).length;
                  return (
                    <button key={t.value} className={`scopechip${scope === t.value ? " on" : ""}`} onClick={() => setScope(t.value)}>
                      <span>{t.icon}</span> {t.label} <span className="ct">{count}</span>
                    </button>
                  );
                })}
              </div>
              <input
                className="memsearch"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search memory…"
              />
              <div className="notes">
                {filteredNotes.map((n) => (
                  <button key={n.slug} className="note" onClick={() => setDrawerNoteSlug(n.slug)}>
                    <div className="note-top">
                      <span className={`scopetag s-${n.scope}`}>{n.scope}</span>
                      <span className="note-title">{n.title}</span>
                      {n.edited_by_human && <span className="note-ed">✎</span>}
                      <span className="note-rel">{fmtRelative(n.last_touched_at)}</span>
                    </div>
                    <p className="note-sum">{n.summary}</p>
                  </button>
                ))}
                {filteredNotes.length === 0 && <p className="calm">No notes match.</p>}
              </div>
            </div>
          )}

          {activeDate && <p className="gen">{fmtWeekday(activeDate)} · generated daily from locked store visits</p>}
        </div>
      </div>

      <StoreVisitDrawer storeId={drawerStoreId} onClose={() => setDrawerStoreId(null)} onOpenNote={(s) => setDrawerNoteSlug(s)} />
      <MemoryNoteDrawer slug={drawerNoteSlug} onClose={() => setDrawerNoteSlug(null)} />
    </>
  );
}

// Warm "mockup" palette, scoped to .intel so it never bleeds into other pages.
const INTEL_CSS = `
.intel{--bg:#F4F1EA;--card:#FFFFFF;--ink:#2A2A27;--muted:#8A857B;--line:#E7E2D8;
  --accent:#3E7C7B;--accent-soft:#E7F0EF;--red:#B23A3A;--red-soft:#F7E3E1;
  background:var(--bg);min-height:100vh;color:var(--ink);
  font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
.intel .wrap{max-width:760px;margin:0 auto;padding:28px 20px 80px;}
.intel .head{margin-bottom:4px;}
.intel .head-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}
.intel .head-actions{display:flex;align-items:center;gap:10px;flex-shrink:0;}
.intel .kicker{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600;}
.intel h1{font-size:28px;font-weight:800;margin:4px 0 0;letter-spacing:-.02em;}
.intel .sub{color:var(--muted);font-size:13px;margin-top:2px;}
.intel .modetoggle{display:inline-flex;background:#EDE9E0;border-radius:10px;padding:3px;margin-top:16px;}
.intel .modetoggle button{border:none;background:none;font-family:inherit;font-size:12.5px;font-weight:700;
  color:var(--muted);padding:5px 16px;border-radius:8px;cursor:pointer;}
.intel .modetoggle button.on{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08);}
.intel .modetoggle button.soon{cursor:not-allowed;opacity:.55;position:relative;}
.intel .modetoggle button.soon::after{content:"soon";position:absolute;top:-7px;right:2px;font-size:8px;
  background:var(--accent);color:#fff;padding:1px 4px;border-radius:6px;letter-spacing:.03em;}
.intel .daynav{display:flex;align-items:center;gap:10px;margin-top:14px;}
.intel .arrow{width:38px;height:38px;border-radius:11px;border:1px solid var(--line);background:#fff;
  font-size:17px;color:var(--ink);cursor:pointer;display:flex;align-items:center;justify-content:center;
  box-shadow:0 1px 2px rgba(0,0,0,.04);flex-shrink:0;}
.intel .arrow:hover:not(:disabled){border-color:var(--accent);color:var(--accent);}
.intel .arrow:disabled{opacity:.35;cursor:not-allowed;}
.intel .datepick{flex:1;}
.intel .datepick select{width:100%;border:1px solid var(--line);background:#fff;border-radius:11px;
  padding:9px 13px;font-family:inherit;font-size:14px;font-weight:600;color:var(--ink);cursor:pointer;
  box-shadow:0 1px 2px rgba(0,0,0,.04);}
.intel .today-btn{border:1px solid var(--line);background:#fff;border-radius:11px;padding:0 14px;height:38px;
  font-family:inherit;font-size:12.5px;font-weight:600;color:var(--muted);cursor:pointer;flex-shrink:0;}
.intel .today-btn:hover:not(:disabled){border-color:var(--accent);color:var(--accent);}
.intel .today-btn:disabled{opacity:.4;cursor:not-allowed;}
.intel .btn-edit{background:var(--accent-soft);color:var(--accent);border:none;border-radius:9px;
  padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;}
.intel .card{background:var(--card);border:1px solid var(--line);border-radius:16px;
  padding:20px 22px;margin-top:18px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.05);}
.intel .card h2{font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);
  font-weight:700;margin:0 0 14px;}
.intel .h2-note{font-weight:400;text-transform:none;letter-spacing:0;}
.intel .card-emg{background:#FDF6F4;border-color:#EBD3CD;}
.intel .emg-h{color:var(--red)!important;}
.intel .topline{display:flex;border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:16px;}
.intel .stat{flex:1;padding:14px 16px;text-align:center;border-right:1px solid var(--line);}
.intel .stat:last-child{border-right:none;}
.intel .s-plan{background:#F1EFE9;} .intel .s-visit{background:var(--accent-soft);} .intel .s-eng{background:#EAF3EC;}
.intel .stat .n{font-size:28px;font-weight:800;line-height:1;}
.intel .stat .n.dim{color:var(--muted);font-weight:600;}
.intel .stat .l{font-size:12px;color:var(--muted);margin-top:5px;}
.intel table{width:100%;border-collapse:collapse;font-size:14px;}
.intel th{text-align:center;font-size:11px;letter-spacing:.04em;text-transform:uppercase;
  color:var(--muted);font-weight:600;padding:0 0 8px;}
.intel td{padding:9px 0;border-top:1px solid var(--line);text-align:center;}
.intel th:first-child,.intel td:first-child{text-align:left;}
.intel td.num,.intel th.num{font-variant-numeric:tabular-nums;}
.intel tr.total td{font-weight:800;border-top:2px solid var(--line);}
.intel .mk{display:inline-block;font-size:11px;font-weight:600;padding:1px 8px;border-radius:6px;
  background:var(--accent-soft);color:var(--accent);white-space:nowrap;}
.intel .mk.dim{background:#F0ECE3;color:var(--muted);}
.intel .footnote{font-size:12px;color:var(--muted);margin-top:12px;}
.intel .calm{font-size:14px;color:var(--muted);margin:2px 0 0;}
.intel .md{font-size:15px;color:#3a372f;}
.intel .md ul{list-style:none;margin:0;padding:0;}
.intel .md li{padding:12px 0;border-top:1px solid var(--line);line-height:1.5;}
.intel .md li:first-child{border-top:none;padding-top:2px;}
.intel .md p{margin:0;}
.intel .chip{font-size:12.5px;font-weight:600;color:var(--accent);background:var(--accent-soft);
  border:1px solid transparent;border-radius:20px;padding:2px 11px 2px 9px;cursor:pointer;
  font-family:inherit;display:inline-flex;align-items:center;gap:4px;transition:.12s;line-height:1.4;vertical-align:baseline;}
.intel .chip::before{content:"↳";opacity:.6;font-weight:700;}
.intel .chip:hover{border-color:var(--accent);}
.intel .chip.emg{color:var(--red);background:var(--red-soft);}
.intel .chip.emg:hover{border-color:var(--red);}
.intel .datechips{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px;}
.intel .datechip{font-size:11px;font-weight:500;border:none;cursor:pointer;border-radius:20px;
  padding:4px 11px;background:#EDE9E0;color:var(--muted);font-family:inherit;}
.intel .datechip.on{background:var(--accent);color:#fff;font-weight:700;}
.intel .datechip .ed{margin-left:4px;opacity:.8;}
.intel .editor{width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
  padding:14px;border-radius:12px;border:1px solid var(--line);background:#FBFAF6;color:var(--ink);line-height:1.5;}
.intel .editbar{display:flex;gap:8px;margin-top:10px;}
.intel .btn-save{background:var(--accent);color:#fff;border:none;border-radius:9px;padding:7px 13px;
  font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;}
.intel .btn-save:disabled{opacity:.5;}
.intel .btn-cancel{background:none;border:none;color:var(--muted);font-size:12px;cursor:pointer;font-family:inherit;}
.intel .empty{color:var(--muted);font-size:14px;padding:24px 0;text-align:center;}
.intel .scopechips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;}
.intel .scopechip{font-size:12px;font-weight:500;border:1px solid var(--line);cursor:pointer;border-radius:9px;
  padding:5px 11px;background:transparent;color:var(--muted);font-family:inherit;}
.intel .scopechip.on{background:var(--accent-soft);color:var(--accent);font-weight:700;border-color:transparent;}
.intel .scopechip .ct{opacity:.6;margin-left:3px;}
.intel .memsearch{width:100%;border:1px solid var(--line);background:#FBFAF6;border-radius:9px;
  padding:8px 12px;font-size:13px;color:var(--ink);font-family:inherit;margin-bottom:12px;}
.intel .notes{display:grid;gap:8px;}
.intel .note{text-align:left;background:#FBFAF6;border:1px solid var(--line);border-radius:12px;
  padding:12px 14px;cursor:pointer;font-family:inherit;transition:.12s;}
.intel .note:hover{border-color:var(--accent);}
.intel .note-top{display:flex;align-items:center;gap:8px;margin-bottom:3px;}
.intel .scopetag{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;
  padding:2px 7px;border-radius:20px;background:#F0ECE3;color:#6b665c;}
.intel .scopetag.s-theme{background:#EDE8FD;color:#5b4bb5;}
.intel .scopetag.s-store{background:#E7F5EA;color:#2f7a44;}
.intel .scopetag.s-person{background:#EAF1FD;color:#3a6bb5;}
.intel .scopetag.s-channel{background:var(--accent-soft);color:var(--accent);}
.intel .note-title{font-size:13px;font-weight:700;color:var(--ink);}
.intel .note-ed{font-size:11px;color:var(--accent);}
.intel .note-rel{margin-left:auto;font-size:10px;color:var(--muted);white-space:nowrap;}
.intel .note-sum{margin:0;font-size:12.5px;color:var(--muted);line-height:1.4;}
.intel .gen{font-size:11px;color:var(--muted);text-align:center;margin-top:24px;}
`;
