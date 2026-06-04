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
interface Section { kind: "signals" | "alerts" | "threads" | "other"; body: string }

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
  }
  return { exec, sections };
}

// Render a "- bullet" line. Tappable chips come from two link forms in the brief:
//   [name](/visits/store/<store_id>)            → opens the store timeline
//   [name](/visits/visit/<store_id>/<visit_id>) → opens the actual visit
// The visit form carries the store id too so the dashboard (store-keyed drawer)
// and the mini app (visit page) can both resolve the same link.
function renderBullet(
  line: string,
  alert: boolean,
  onNav: (kind: "store" | "visit", id: string) => void,
  key: number,
) {
  const text = line.replace(/^[-*]\s+/, "");
  const re = /\[([^\]]+)\]\(\/visits\/(store|visit)\/([^)]+)\)/g;
  const parts: React.ReactNode[] = [];
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const kind = m[2] as "store" | "visit";
    // store: <store_id>; visit: <store_id>/<visit_id> → take the last segment.
    const id = kind === "visit" ? m[3].split("/").pop() ?? m[3] : m[3];
    parts.push(
      <button key={`c${i++}`} className={`chip${alert ? " emg" : ""}${kind === "visit" ? " visit" : ""}`} onClick={() => onNav(kind, id)}>
        {m[1]}
      </button>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <li key={key}>{parts}</li>;
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
  const alerts = parsed?.sections.find((s) => s.kind === "alerts");
  const markets = useMemo(
    () => Array.from(new Set((exec?.cms ?? []).map((c) => c.market).filter(Boolean))),
    [exec],
  );

  const onNav = (kind: "store" | "visit", id: string) =>
    router.push(kind === "visit" ? `/m/visit/${id}` : `/m/store/${id}`);
  const bullets = (body: string) => body.split("\n").filter((l) => /^\s*[-*]\s+/.test(l));

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

            <div className="card">
              <h2>🔔 Signals</h2>
              {signals?.body
                ? <ul className="bul">{bullets(signals.body).map((l, i) => renderBullet(l, false, onNav, i))}</ul>
                : <p className="calm">No repeated patterns today.</p>}
            </div>

            <div className="card card-emg">
              <h2 className="emg-h">🚨 Alerts</h2>
              {alerts?.body
                ? <ul className="bul">{bullets(alerts.body).map((l, i) => renderBullet(l, true, onNav, i))}</ul>
                : <p className="calm">No alerts today.</p>}
            </div>
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
`;
