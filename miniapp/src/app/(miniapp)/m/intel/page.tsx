"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { initTelegram } from "../telegram-init";

// ── Types ────────────────────────────────────────────────────────────────────

interface DateEntry { report_date: string; edited_by_human: boolean }
interface ReportFull {
  report_date: string;
  version: number;
  edited_by_human: boolean;
  brief_markdown: string;
  created_at: string;
}

const MARKET_FLAG: Record<string, string> = { SG: "🇸🇬", MY: "🇲🇾", TH: "🇹🇭", HK: "🇭🇰" };

function fmtWeekday(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}
function fmtDateShort(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// ── Brief parsing (mirrors the dashboard — the stored brief is the source) ────

interface MdTable { header: string[]; rows: string[][] }
interface ExecData {
  planned: string; visited: string; engagements: string;
  cms: { name: string; market: string; visited: string; engagements: string }[];
}
interface Section { kind: "signals" | "alerts" | "threads" | "goodnews" | "engagements" | "other"; body: string }

function splitCells(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}
function parseTables(block: string): MdTable[] {
  const tables: MdTable[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length >= 2) tables.push({ header: splitCells(cur[0]), rows: cur.slice(2).map(splitCells) });
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
    const r = totalsT.rows[0];
    planned = r[1] ?? "—"; visited = r[2] ?? "—"; engagements = r[3] ?? "—";
  }
  const cms = (cmT?.rows ?? [])
    .filter((r) => r[0] && !/all cms/i.test(r[0]))
    .map((r) => ({ name: r[0], market: r[1] ?? "", visited: r[2] ?? "0", engagements: r[3] ?? "0" }));
  if (!totalsT && cms.length) {
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
    else if (/signals/i.test(head)) sections.push({ kind: "signals", body });
    else if (/alerts/i.test(head)) sections.push({ kind: "alerts", body });
    else if (/threads/i.test(head)) sections.push({ kind: "threads", body });
    else if (/good\s*news/i.test(head)) sections.push({ kind: "goodnews", body });
    else if (/engagements/i.test(head)) sections.push({ kind: "engagements", body });
  }
  return { exec, sections };
}

// ── Link / chip helpers ───────────────────────────────────────────────────────

// Inline text → React nodes, converting visit/store markdown links to chips.
//   [name](/visits/store/<store_id>)            → opens the store timeline
//   [name](/visits/visit/<store_id>/<visit_id>) → opens the actual visit
// Visit links may carry ?hl=<section> (good_news | people_training |
// competitors | display_stock | follow_up) marking which visit section the
// report item drew from — passed through so the visit page can highlight it.
function renderInline(
  text: string,
  alert: boolean,
  onNav: (kind: "store" | "visit", id: string, hl?: string | null) => void,
  keyPrefix: string,
): React.ReactNode[] {
  // Visit/store links become tappable chips; memory-note links (no notes route
  // in the miniapp) render as inert reference pills so the title still reads.
  const re = /\[([^\]]+)\]\((\/visits\/(?:store|visit)\/[^)]+|\/intelligence\/notes\/[^)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const label = m[1], href = m[2];
    if (href.startsWith("/intelligence/notes/")) {
      parts.push(<span key={`${keyPrefix}-c${i++}`} className="memref">{label}</span>);
    } else {
      const vm = href.match(/^\/visits\/(store|visit)\/(.+)$/);
      const kind = (vm?.[1] ?? "store") as "store" | "visit";
      const [path, query = ""] = (vm?.[2] ?? "").split("?");
      const hl = new URLSearchParams(query).get("hl");
      const id = kind === "visit" ? path.split("/").pop() ?? path : path;
      parts.push(
        <button key={`${keyPrefix}-c${i++}`} className={`chip${alert ? " emg" : ""}${kind === "visit" ? " visit" : ""}`} onClick={() => onNav(kind, id, hl)}>
          {label}
        </button>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Render rich inline content: **bold** ranges become <strong>, links become chips.
function renderRichInline(
  text: string,
  alert: boolean,
  onNav: (kind: "store" | "visit", id: string, hl?: string | null) => void,
  keyPrefix: string,
): React.ReactNode[] {
  // Split on **bold** spans first, then process each chunk for links.
  const boldRe = /\*\*([^*]+)\*\*/g;
  const chunks: Array<{ bold: boolean; text: string }> = [];
  let last = 0, m: RegExpExecArray | null;
  while ((m = boldRe.exec(text)) !== null) {
    if (m.index > last) chunks.push({ bold: false, text: text.slice(last, m.index) });
    chunks.push({ bold: true, text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) chunks.push({ bold: false, text: text.slice(last) });

  const result: React.ReactNode[] = [];
  chunks.forEach((chunk, ci) => {
    const inlined = renderInline(chunk.text, alert, onNav, `${keyPrefix}-ch${ci}`);
    if (chunk.bold) result.push(<strong key={`${keyPrefix}-b${ci}`}>{inlined}</strong>);
    else result.push(...inlined);
  });
  return result;
}

// ── Nested bullet renderer ────────────────────────────────────────────────────
//
// New format (new reports):
//   - **Headline** text                     ← top-level bold headline
//     - Elaboration sub-bullet              ← indented (2+ spaces or tab)
//     - Sources: [Store A](/visits/...) ... ← "Sources:" → compact chip row
//
// Old flat format (legacy reports):
//   - plain bullet text                     ← no bold, no indented children
//
// Both render gracefully. Detection: a line is "indented" if it starts with
// whitespace before the list marker. A top-level line has a **bold** opener.

interface BulletNode {
  text: string;          // raw text after stripping the list marker
  isSource: boolean;     // "Sources:" line → chip row
  children: BulletNode[];
}

function parseBulletTree(lines: string[]): BulletNode[] {
  const roots: BulletNode[] = [];
  let current: BulletNode | null = null;
  for (const line of lines) {
    const isIndented = /^\s{2,}[-*]|\t[-*]/.test(line);
    const text = line.replace(/^[\s\t]*[-*]\s+/, "");
    const isSource = /^sources?:/i.test(text);
    if (!isIndented) {
      current = { text, isSource, children: [] };
      roots.push(current);
    } else if (current) {
      current.children.push({ text, isSource, children: [] });
    } else {
      // Orphaned indented line — treat as root.
      current = { text, isSource, children: [] };
      roots.push(current);
    }
  }
  return roots;
}

function renderBulletNode(
  node: BulletNode,
  alert: boolean,
  onNav: (kind: "store" | "visit", id: string, hl?: string | null) => void,
  key: number,
): React.ReactNode {
  const hasChildren = node.children.length > 0;
  const isBoldHeadline = /\*\*/.test(node.text);

  return (
    <li key={key} className={isBoldHeadline ? "bul-headline" : undefined}>
      <span className="bul-top">
        {renderRichInline(node.text, alert, onNav, `r${key}`)}
      </span>
      {hasChildren && (
        <ul className="bul-sub">
          {node.children.map((child, ci) => {
            if (child.isSource) {
              // Strip "Sources: " prefix, render remaining content as chips inline.
              const srcText = child.text.replace(/^sources?:\s*/i, "");
              return (
                <li key={ci} className="bul-sources">
                  <span className="src-label">Sources:</span>
                  {renderInline(srcText, false, onNav, `r${key}-s${ci}`)}
                </li>
              );
            }
            return (
              <li key={ci} className="bul-elaboration">
                {renderRichInline(child.text, false, onNav, `r${key}-e${ci}`)}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

// Legacy entry-point — renders a block body as a list of BulletNodes.
// "alert" tints top-level chips red; sub-bullet chips stay neutral.
function renderBullets(
  body: string,
  alert: boolean,
  onNav: (kind: "store" | "visit", id: string, hl?: string | null) => void,
): React.ReactNode {
  const lines = body.split("\n").filter((l) => /^\s*[-*]\s+/.test(l));
  if (!lines.length) return null;
  const tree = parseBulletTree(lines);
  return (
    <ul className="bul">
      {tree.map((node, i) => renderBulletNode(node, alert, onNav, i))}
    </ul>
  );
}

// Engagements card: the new format leads with a markdown table
// (Product | Trained | Stores | Reception | Sources) followed by ◆ consensus /
// "Other engagements" bullets. Tables don't fit a phone — render each row as a
// stacked block (product · meta line · source chips), then the bullets as usual.
function renderEngagements(
  body: string,
  onNav: (kind: "store" | "visit", id: string, hl?: string | null) => void,
): React.ReactNode {
  const table = parseTables(body)[0];
  const bullets = renderBullets(body, false, onNav);
  if (!table) return bullets;
  const col = (re: RegExp, fallback: number) => {
    const i = table.header.findIndex((h) => re.test(h));
    return i === -1 ? fallback : i;
  };
  const cTrained = col(/trained/i, 1), cStores = col(/store/i, 2);
  const cReception = col(/reception/i, 3), cSources = col(/source/i, 4);
  return (
    <>
      {table.rows.map((r, i) => (
        <div key={i} className="eng-row">
          <div className="eng-prod">{renderRichInline(r[0] ?? "", false, onNav, `ep${i}`)}</div>
          <div className="eng-meta">
            {[r[cTrained] && `${r[cTrained]} trained`, r[cStores]].filter(Boolean).join(" · ")}
          </div>
          {r[cReception] && (
            <div className="eng-read">{renderRichInline(r[cReception], false, onNav, `er${i}`)}</div>
          )}
          {r[cSources] && (
            <div className="eng-src">{renderInline(r[cSources], false, onNav, `es${i}`)}</div>
          )}
        </div>
      ))}
      {bullets}
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function IntelPage() {
  const router = useRouter();

  const [dates, setDates] = useState<DateEntry[]>([]);
  const [report, setReport] = useState<ReportFull | null>(null);
  const [activeDate, setActiveDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = () => ({ Authorization: `tma ${window.Telegram?.WebApp?.initData ?? ""}` });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initTelegram();
        const q = activeDate ? `?date=${activeDate}` : "";
        const res = await fetch(`/api/m/intelligence${q}`, { headers: authHeaders() });
        if (res.status === 401 || res.status === 403) throw new Error("Not authorised to view the brief.");
        if (!res.ok) throw new Error(`Failed to load (${res.status})`);
        const json = await res.json();
        if (cancelled) return;
        setDates(json.dates ?? []);
        setReport(json.report ?? null);
        if (json.report?.report_date) setActiveDate(json.report.report_date);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeDate]);

  const parsed = useMemo(() => (report ? parseBrief(report.brief_markdown) : null), [report]);
  const exec = parsed?.exec ?? null;
  const signals = parsed?.sections.find((s) => s.kind === "signals");
  // Legacy-compat shim: Threads no longer exists as a section — fold any
  // "Threads" bullets from older reports into the Signals card.
  const threads = parsed?.sections.find((s) => s.kind === "threads");
  const signalsBody = [signals?.body, threads?.body].filter(Boolean).join("\n");
  const alerts = parsed?.sections.find((s) => s.kind === "alerts");
  const goodNews = parsed?.sections.find((s) => s.kind === "goodnews");
  const engagements = parsed?.sections.find((s) => s.kind === "engagements");
  const markets = useMemo(
    () => Array.from(new Set((exec?.cms ?? []).map((c) => c.market).filter(Boolean))),
    [exec],
  );

  const onNav = (kind: "store" | "visit", id: string, hl?: string | null) =>
    router.push(
      kind === "visit"
        ? `/m/visit/${id}?from=intel${hl ? `&hl=${encodeURIComponent(hl)}` : ""}`
        : `/m/store/${id}`,
    );

  // ── Date navigation (arrows · dropdown · swipe) ─────────────────────────────
  // Newest first. "Previous" = older day (idx+1), "next" = newer day (idx-1).
  const sortedDates = useMemo(
    () => [...dates].sort((a, b) => b.report_date.localeCompare(a.report_date)),
    [dates],
  );
  const dateIdx = sortedDates.findIndex((d) => d.report_date === activeDate);
  const hasPrev = dateIdx >= 0 && dateIdx < sortedDates.length - 1;
  const hasNext = dateIdx > 0;
  const goTo = (date: string) => { setLoading(true); setActiveDate(date); };
  const goPrev = () => { if (hasPrev) goTo(sortedDates[dateIdx + 1].report_date); };
  const goNext = () => { if (hasNext) goTo(sortedDates[dateIdx - 1].report_date); };

  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    // Horizontal, deliberate swipe only — don't hijack vertical scrolling.
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx > 0) goNext(); // swipe right → next (newer) day
    else goPrev();        // swipe left → previous (older) day
  };

  return (
    <div className="intel">
      <style>{INTEL_CSS}</style>
      <div className="wrap" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <header className="head">
          <div className="kicker">📊 SVA Daily Intelligence</div>
          <h1>{activeDate ? fmtWeekday(activeDate) : "Daily Intelligence"}</h1>
          <div className="sub">
            {exec ? `${exec.visited} visit${exec.visited === "1" ? "" : "s"}` : ""}
            {markets.length ? ` across ${markets.join(" · ")}` : ""}
            {report ? ` · v${report.version}${report.edited_by_human ? " · edited" : ""}` : ""}
          </div>
        </header>

        {sortedDates.length > 1 && (
          <div className="datenav">
            <button className="navbtn" disabled={!hasPrev} onClick={goPrev} aria-label="Previous day">‹</button>
            <div className="datepick">
              <select
                value={activeDate ?? ""}
                onChange={(e) => goTo(e.target.value)}
                aria-label="Jump to date"
              >
                {sortedDates.map((d) => (
                  <option key={d.report_date} value={d.report_date}>
                    {fmtDateShort(d.report_date)}{d.edited_by_human ? " ✎" : ""}
                  </option>
                ))}
              </select>
              <span className="caret">▾</span>
            </div>
            <button className="navbtn" disabled={!hasNext} onClick={goNext} aria-label="Next day">›</button>
          </div>
        )}

        {loading && <p className="empty">Loading…</p>}
        {!loading && error && <p className="empty">{error}</p>}
        {!loading && !error && !report && <p className="empty">No report for this day.</p>}

        {!loading && !error && report && (
          <>
            {exec && (
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
                    <tr><th>Channel Manager</th><th>Market</th><th className="num">Visited</th><th className="num">Engaged</th></tr>
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
                  {exec.planned === "—" ? "No plans logged yet. " : ""}Engagements = visits with a people/training note.
                </div>
              </div>
            )}

            {goodNews?.body && (
              <div className="card card-gn">
                <h2 className="gn-h">🌟 Good News</h2>
                {renderBullets(goodNews.body, false, onNav) ?? <p className="calm">Nothing to highlight.</p>}
              </div>
            )}

            <div className="card">
              <h2>🔔 Signals</h2>
              {renderBullets(signalsBody, false, onNav) ?? <p className="calm">No repeated patterns today.</p>}
            </div>

            <div className="card card-emg">
              <h2 className="emg-h">🚨 Alerts</h2>
              {renderBullets(alerts?.body ?? "", true, onNav) ?? <p className="calm">No alerts today.</p>}
            </div>

            {engagements?.body && (
              <div className="card card-eng">
                <h2 className="eng-h">🤝 Engagements</h2>
                {renderEngagements(engagements.body, onNav) ?? <p className="calm">No engagement notes today.</p>}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const INTEL_CSS = `
.intel{--bg:#F4F1EA;--card:#FFFFFF;--ink:#2A2A27;--muted:#8A857B;--line:#E7E2D8;
  --accent:#3E7C7B;--accent-soft:#E7F0EF;--red:#B23A3A;--red-soft:#F7E3E1;
  background:var(--bg);min-height:100vh;color:var(--ink);
  font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}
.intel .wrap{max-width:680px;margin:0 auto;padding:20px 16px 60px;}
.intel .kicker{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:600;}
.intel h1{font-size:23px;font-weight:800;margin:3px 0 0;letter-spacing:-.02em;}
.intel .sub{color:var(--muted);font-size:12.5px;margin-top:2px;}
.intel .card{background:var(--card);border:1px solid var(--line);border-radius:16px;
  padding:18px 18px;margin-top:16px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 6px 18px rgba(0,0,0,.05);}
.intel .card h2{font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);font-weight:700;margin:0 0 12px;}
.intel .card-emg{background:#FDF6F4;border-color:#EBD3CD;}
.intel .emg-h{color:var(--red)!important;}
.intel .topline{display:flex;border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:14px;}
.intel .stat{flex:1;padding:12px 10px;text-align:center;border-right:1px solid var(--line);}
.intel .stat:last-child{border-right:none;}
.intel .s-plan{background:#F1EFE9;} .intel .s-visit{background:var(--accent-soft);} .intel .s-eng{background:#EAF3EC;}
.intel .stat .n{font-size:25px;font-weight:800;line-height:1;}
.intel .stat .n.dim{color:var(--muted);font-weight:600;}
.intel .stat .l{font-size:11px;color:var(--muted);margin-top:4px;}
.intel table{width:100%;border-collapse:collapse;font-size:13.5px;}
.intel th{text-align:center;font-size:10px;letter-spacing:.03em;text-transform:uppercase;color:var(--muted);font-weight:600;padding:0 0 7px;}
.intel td{padding:8px 0;border-top:1px solid var(--line);text-align:center;}
.intel th:first-child,.intel td:first-child{text-align:left;}
.intel td.num,.intel th.num{font-variant-numeric:tabular-nums;}
.intel tr.total td{font-weight:800;border-top:2px solid var(--line);}
.intel .mk{display:inline-block;font-size:11px;font-weight:600;padding:1px 7px;border-radius:6px;
  background:var(--accent-soft);color:var(--accent);white-space:nowrap;}
.intel .mk.dim{background:#F0ECE3;color:var(--muted);}
.intel .footnote{font-size:11.5px;color:var(--muted);margin-top:11px;line-height:1.4;}
.intel .calm{font-size:13.5px;color:var(--muted);margin:2px 0 0;}
.intel ul.bul{list-style:none;margin:0;padding:0;font-size:14.5px;color:#3a372f;}
.intel ul.bul li{padding:11px 0;border-top:1px solid var(--line);line-height:1.5;}
.intel ul.bul li:first-child{border-top:none;padding-top:2px;}
.intel .chip{font-size:12.5px;font-weight:600;color:var(--accent);background:var(--accent-soft);
  border:1px solid transparent;border-radius:20px;padding:1px 10px 1px 8px;cursor:pointer;
  font-family:inherit;display:inline-flex;align-items:center;gap:4px;line-height:1.4;vertical-align:baseline;margin:1px 0;}
.intel .chip::before{content:"↳";opacity:.6;font-weight:700;}
.intel .chip.emg{color:var(--red);background:var(--red-soft);}
.intel .datenav{display:flex;align-items:center;gap:8px;margin-top:13px;}
.intel .navbtn{flex:0 0 auto;width:38px;height:38px;border-radius:12px;border:1px solid var(--line);
  background:var(--card);color:var(--ink);font-size:20px;font-weight:700;line-height:1;cursor:pointer;
  font-family:inherit;display:flex;align-items:center;justify-content:center;}
.intel .navbtn:disabled{opacity:.35;cursor:default;}
.intel .datepick{position:relative;flex:1;}
.intel .datepick select{appearance:none;-webkit-appearance:none;width:100%;height:38px;
  border:1px solid var(--line);border-radius:12px;background:var(--card);color:var(--ink);
  font-family:inherit;font-size:14px;font-weight:600;text-align:center;padding:0 28px;cursor:pointer;}
.intel .datepick .caret{position:absolute;right:12px;top:50%;transform:translateY(-50%);
  font-size:11px;color:var(--muted);pointer-events:none;}
.intel .chip.visit{padding-left:8px;}
.intel .chip.visit::before{content:"📍";opacity:.85;font-weight:400;}
.intel .empty{color:var(--muted);font-size:13.5px;padding:28px 0;text-align:center;}

/* Good News card */
.intel .card-gn{background:#FDFCF4;border-color:#E8DFA8;}
.intel .gn-h{color:#7A6A00!important;}

/* Engagements card */
.intel .card-eng{background:#F4F9F4;border-color:#C8DEC8;}
.intel .eng-h{color:#3A7040!important;}
/* Engagements table rows, rendered as stacked blocks on phone */
.intel .eng-row{padding:11px 0;border-top:1px solid var(--line);}
.intel .eng-row:first-child{border-top:none;padding-top:2px;}
.intel .eng-prod{font-size:14.5px;font-weight:600;color:#3a372f;line-height:1.4;}
.intel .eng-meta{font-size:12px;color:var(--muted);margin-top:1px;}
.intel .eng-read{font-size:13px;color:var(--muted);line-height:1.45;margin-top:4px;}
.intel .eng-src{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:6px;}
/* Memory-note reference — inert pill (no notes route in the miniapp) */
.intel .memref{font-size:12px;font-weight:600;color:var(--muted);background:#EFEBE2;
  border-radius:20px;padding:1px 9px;display:inline-flex;align-items:center;line-height:1.4;vertical-align:baseline;margin:1px 0;}

/* Nested bullet list */
.intel ul.bul li.bul-headline{padding-bottom:4px;}
.intel ul.bul li.bul-headline .bul-top{font-weight:600;}
.intel ul.bul ul.bul-sub{list-style:none;margin:4px 0 0;padding:0;}
.intel ul.bul ul.bul-sub li{padding:3px 0;border-top:none;font-size:13px;color:var(--muted);line-height:1.45;}
.intel ul.bul ul.bul-sub li.bul-sources{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding-top:5px;}
.intel ul.bul ul.bul-sub li.bul-sources .src-label{font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-right:2px;flex-shrink:0;}
`;

