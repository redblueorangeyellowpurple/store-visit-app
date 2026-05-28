"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import NavBar from "@/components/NavBar";
import RefreshControl from "@/components/RefreshControl";

type Market = "ALL" | "SG" | "MY" | "TH" | "HK";

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
  co_credit_active: boolean;
  range: { from: string; to: string };
}
interface User { first_name: string; username?: string }

const MARKET_PILL_STYLE: Record<string, { bg: string; color: string }> = {
  SG: { bg: "#FBE6E2", color: "#B5331A" },
  MY: { bg: "#DDE9FB", color: "#1A5DB5" },
  HK: { bg: "#D6F0DC", color: "#1E7A3A" },
  TH: { bg: "#EDE8FD", color: "#5B3FB5" },
};

const MARKET_OPTIONS: { value: Market; label: string }[] = [
  { value: "ALL", label: "All Markets" },
  { value: "SG",  label: "🇸🇬 Singapore" },
  { value: "MY",  label: "🇲🇾 Malaysia" },
  { value: "TH",  label: "🇹🇭 Thailand" },
  { value: "HK",  label: "🇭🇰 Hong Kong" },
];

function todayISO(): string {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}
function shiftDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function mondayOfISO(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function fmtWeek(week: PayrollWeek): string {
  const start = new Date(week.start + "T00:00:00");
  const end = new Date(week.end + "T00:00:00");
  const dayNum = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric" });
  const monthShort = (d: Date) => d.toLocaleDateString("en-GB", { month: "short" });
  if (start.getMonth() === end.getMonth()) {
    return `${dayNum(start)}–${dayNum(end)} ${monthShort(end)}`;
  }
  return `${dayNum(start)} ${monthShort(start)}–${dayNum(end)} ${monthShort(end)}`;
}

type RangePreset = "this_week" | "last_week" | "last_2w" | "last_4w" | "this_month" | "last_month" | "custom";
const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: "this_week",  label: "This week"  },
  { key: "last_week",  label: "Last week"  },
  { key: "last_2w",    label: "Last 2 wks" },
  { key: "last_4w",    label: "Last 4 wks" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
];

function rangeFor(preset: RangePreset): { from: string; to: string } {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monday = mondayOfISO(todayISO());
  if (preset === "this_week")  return { from: monday, to: shiftDays(monday, 6) };
  if (preset === "last_week")  { const lastMon = shiftDays(monday, -7); return { from: lastMon, to: shiftDays(lastMon, 6) }; }
  if (preset === "last_2w")    return { from: shiftDays(monday, -7),  to: shiftDays(monday, 6) };
  if (preset === "last_4w")    return { from: shiftDays(monday, -21), to: shiftDays(monday, 6) };
  if (preset === "this_month") { const first = new Date(today.getFullYear(), today.getMonth(), 1); const last = new Date(today.getFullYear(), today.getMonth() + 1, 0); return { from: first.toISOString().slice(0,10), to: last.toISOString().slice(0,10) }; }
  if (preset === "last_month") { const first = new Date(today.getFullYear(), today.getMonth() - 1, 1); const last = new Date(today.getFullYear(), today.getMonth(), 0); return { from: first.toISOString().slice(0,10), to: last.toISOString().slice(0,10) }; }
  return { from: shiftDays(monday, -21), to: shiftDays(monday, 6) };
}

export default function PayrollPage() {
  const [user, setUser] = useState<User | null>(null);
  const [payroll, setPayroll] = useState<PayrollGrid | null>(null);
  const [payrollLoading, setPayrollLoading] = useState(false);
  const [market, setMarket] = useState<Market>("ALL");

  const [preset, setPreset] = useState<RangePreset>("last_4w");
  const initial = rangeFor("last_4w");
  const [from, setFrom] = useState<string>(initial.from);
  const [to,   setTo]   = useState<string>(initial.to);

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.ok ? r.json() : null).then(d => { if (d) setUser(d); });
  }, []);

  const fetchPayroll = useCallback(async (f: string, t: string) => {
    setPayrollLoading(true);
    try {
      const res = await fetch(`/api/payroll?from=${encodeURIComponent(f)}&to=${encodeURIComponent(t)}`);
      if (res.ok) setPayroll(await res.json());
    } finally {
      setPayrollLoading(false);
    }
  }, []);

  useEffect(() => { fetchPayroll(from, to); }, [from, to, fetchPayroll]);

  const silentRefresh = useCallback(async () => {
    const pr = await fetch(`/api/payroll?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`).then(r => r.ok ? r.json() : null);
    if (pr) setPayroll(pr);
  }, [from, to]);

  const refresh = useAutoRefresh(silentRefresh, { intervalMs: 60_000, paused: payrollLoading });

  function applyPreset(p: RangePreset) {
    setPreset(p);
    if (p !== "custom") {
      const r = rangeFor(p);
      setFrom(r.from);
      setTo(r.to);
    }
  }

  if (!user) return null;

  return (
    <div>
      <NavBar user={user} />
      <div className="page-content">

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <RefreshControl controls={refresh} />
        </div>

        <div className="section-header">
          <h2 className="section-title">Visits by week — payroll</h2>
          {payroll && (
            <span className="section-badge">
              {payroll.weeks.length} wk · {payroll.rows.filter(r => market === "ALL" || r.market === market).length} CM
            </span>
          )}
          {payroll && !payroll.co_credit_active && (
            <span className="payroll-note">Lead CM only · co-CM credit pending visit_cms migration</span>
          )}
        </div>

        <div className="market-chips" style={{ marginBottom: 20 }}>
          {MARKET_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              className={`mchip${market === value ? " active" : ""}`}
              onClick={() => setMarket(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="range-bar">
          <div className="chip-group">
            {RANGE_PRESETS.map(p => (
              <button
                key={p.key}
                className={`mchip${preset === p.key ? " active" : ""}`}
                onClick={() => applyPreset(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="range-inputs">
            <label className="range-label">From
              <input type="date" value={from} max={to}
                onChange={(e) => { setPreset("custom"); setFrom(e.target.value); }} />
            </label>
            <label className="range-label">To
              <input type="date" value={to} min={from}
                onChange={(e) => { setPreset("custom"); setTo(e.target.value); }} />
            </label>
          </div>
        </div>

        {payrollLoading && !payroll && (
          <div className="empty-state" style={{ padding: 32 }}>
            <p>Loading payroll…</p>
          </div>
        )}

        {payroll && (() => {
          const pg = payroll;
          const filteredRows = pg.rows.filter((r) => market === "ALL" || r.market === market);
          if (filteredRows.length === 0) {
            return (
              <div className="empty-state" style={{ padding: 32 }}>
                <p className="empty-state-icon">📊</p>
                <p>No CMs in this market.</p>
              </div>
            );
          }
          const grouped = new Map<string, PayrollRow[]>();
          for (const r of filteredRows) {
            const key = r.am_name ?? "Unassigned";
            const arr = grouped.get(key) ?? [];
            arr.push(r);
            grouped.set(key, arr);
          }
          const groups = [...grouped.entries()].sort((a, b) => {
            if (a[0] === "Unassigned") return 1;
            if (b[0] === "Unassigned") return -1;
            return a[0].localeCompare(b[0]);
          });

          const thisMonStart = mondayOfISO(todayISO());

          function groupTotals(rows: PayrollRow[]): { perWeek: number[]; total: number } {
            const perWeek = pg.weeks.map((_, i) => rows.reduce((s, r) => s + (r.counts[i] ?? 0), 0));
            const total = perWeek.reduce((a, b) => a + b, 0);
            return { perWeek, total };
          }

          const overall = groupTotals(filteredRows);

          return (
            <div className={`payroll-card${payrollLoading ? " loading" : ""}`}>
              <div className="payroll-scroll">
                <table className="payroll-grid">
                  <thead>
                    <tr>
                      <th className="cm-col">CM</th>
                      <th>Market</th>
                      {pg.weeks.map((w) => (
                        <th key={w.start} className={`month-col${w.start === thisMonStart ? " current" : ""}`}>
                          {fmtWeek(w)}{w.start === thisMonStart ? " ●" : ""}
                        </th>
                      ))}
                      <th className="total-col">Range total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map(([amName, rows]) => {
                      const gt = groupTotals(rows);
                      return (
                        <Fragment key={amName}>
                          <tr className="am-row">
                            <td className="am-label" colSpan={2}>
                              {amName === "Unassigned" ? "Unassigned" : amName} · {rows.length} CM{rows.length !== 1 ? "s" : ""}
                            </td>
                            {gt.perWeek.map((n, i) => (
                              <td key={i} className="am-week">{n}</td>
                            ))}
                            <td className="am-total">{gt.total}</td>
                          </tr>
                          {rows.map((r) => {
                            const pill = MARKET_PILL_STYLE[r.market];
                            return (
                              <tr key={r.telegram_id}>
                                <td className="cm-cell">{r.full_name}</td>
                                <td>
                                  <span className="market-pill" style={{ background: pill.bg, color: pill.color }}>
                                    {r.market}
                                  </span>
                                </td>
                                {r.counts.map((c, i) => {
                                  const w = pg.weeks[i];
                                  return (
                                    <td key={w.start}
                                      className={`month-col${w.start === thisMonStart ? " current" : ""}${c === 0 ? " zero" : ""}`}>
                                      {c}
                                    </td>
                                  );
                                })}
                                <td className="total-col">{r.range_total}</td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
                    <tr className="overall-row">
                      <td className="cm-cell" colSpan={2}>All CMs</td>
                      {overall.perWeek.map((n, i) => (
                        <td key={i} className="month-col">{n}</td>
                      ))}
                      <td className="total-col">{overall.total}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
