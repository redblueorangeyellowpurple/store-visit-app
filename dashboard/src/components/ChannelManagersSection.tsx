"use client";

import { useEffect, useState } from "react";
import type { MarketGroup, CMData, VisitEntry } from "@/app/api/analytics/channel-managers/route";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MARKET_FLAG: Record<string, string> = {
  SG: "🇸🇬",
  MY: "🇲🇾",
  TH: "🇹🇭",
  HK: "🇭🇰",
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-SG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Singapore",
  });
}

// ─── Sub-tables (Good News / Competitor / Display & Stock) ───────────────────

interface SectionEntry {
  cm_name: string;
  store_id: string;
  store_name: string;
  content: string;
  locked_at: string;
}

interface SectionTableProps {
  title: string;
  icon: string;
  market: string;
  entries: SectionEntry[];
  onOpenStore: (storeId: string) => void;
}

function SectionTable({ title, icon, market, entries, onOpenStore }: SectionTableProps) {
  if (entries.length === 0) return null;
  return (
    <div className="mt-4">
      <h4 className="text-[11px] font-bold uppercase tracking-wider mb-2"
        style={{ color: "var(--color-ink-400)" }}>
        {icon} {title} — {MARKET_FLAG[market]} {market}
      </h4>
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ background: "var(--color-ink-50)" }}>
              <th className="text-left px-3 py-2 font-semibold" style={{ color: "var(--color-ink-500)", width: "15%" }}>CM</th>
              <th className="text-left px-3 py-2 font-semibold" style={{ color: "var(--color-ink-500)", width: "18%" }}>Store</th>
              <th className="text-left px-3 py-2 font-semibold" style={{ color: "var(--color-ink-500)" }}>Note</th>
              <th className="text-right px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--color-ink-500)", width: "8%" }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} style={{ borderTop: i > 0 ? "1px solid var(--color-border)" : undefined }}>
                <td className="px-3 py-2 align-top" style={{ color: "var(--color-ink-700)" }}>{e.cm_name.split(" ").slice(-1)[0]}</td>
                <td className="px-3 py-2 align-top">
                  <button
                    onClick={() => onOpenStore(e.store_id)}
                    className="text-left hover:underline"
                    style={{ color: "var(--color-tc-600)", fontWeight: 600 }}
                  >
                    {e.store_name}
                  </button>
                </td>
                <td className="px-3 py-2 align-top leading-snug" style={{ color: "var(--color-ink-700)" }}>
                  {e.content}
                </td>
                <td className="px-3 py-2 align-top text-right whitespace-nowrap" style={{ color: "var(--color-ink-300)" }}>
                  {fmtTime(e.locked_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── CM Visit Row (returns <td> fragments, parent owns the <tr>) ─────────────

interface CMRowProps {
  cm: CMData;
  onOpenStore: (storeId: string) => void;
}

function CMRow({ cm, onOpenStore }: CMRowProps) {
  return (
    <>
      {/* Name */}
      <td className="px-3 py-3 align-top">
        <span className="font-bold text-[13px]" style={{ color: "var(--color-ink-900)" }}>
          {cm.full_name}
        </span>
      </td>
      {/* # Stores */}
      <td className="px-3 py-3 align-top text-center">
        <span className="text-[13px] font-semibold" style={{ color: "var(--color-ink-700)" }}>
          {cm.stores_visited}
        </span>
      </td>
      {/* Trainings */}
      <td className="px-3 py-3 align-top text-center">
        <span className="text-[13px]" style={{ color: "var(--color-ink-500)" }}>
          {cm.engagements || "—"}
        </span>
      </td>
      {/* Visits list: [time] Store name (linked) */}
      <td className="px-3 py-3 align-top">
        <div className="space-y-1">
          {cm.visits.map((v: VisitEntry) => (
            <div key={v.id} className="flex items-baseline gap-2">
              <span className="text-[10px] tabular-nums whitespace-nowrap" style={{ color: "var(--color-ink-300)" }}>
                {fmtTime(v.locked_at)}
              </span>
              <button
                onClick={() => onOpenStore(v.store_id)}
                className="text-[12px] text-left hover:underline"
                style={{ color: "var(--color-tc-600)", fontWeight: 600 }}
              >
                {v.store_name}
              </button>
            </div>
          ))}
        </div>
      </td>
    </>
  );
}

// ─── Market Group ─────────────────────────────────────────────────────────────

interface MarketGroupBlockProps {
  group: MarketGroup;
  onOpenStore: (storeId: string) => void;
}

function MarketGroupBlock({ group, onOpenStore }: MarketGroupBlockProps) {
  const [expanded, setExpanded] = useState(true);

  // Build sub-table entries by section
  const goodNews: SectionEntry[] = [];
  const competitor: SectionEntry[] = [];
  const displayStock: SectionEntry[] = [];

  for (const cm of group.cms) {
    for (const v of cm.visits) {
      const base = { cm_name: cm.full_name, store_id: v.store_id, store_name: v.store_name, locked_at: v.locked_at };
      if (v.good_news) goodNews.push({ ...base, content: v.good_news });
      if (v.competitors) competitor.push({ ...base, content: v.competitors });
      if (v.display_stock) displayStock.push({ ...base, content: v.display_stock });
    }
  }

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
    >
      {/* Country header — click to expand/collapse */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors"
        style={{
          background: expanded ? "var(--color-ink-50)" : "var(--color-surface)",
          borderBottom: expanded ? "1px solid var(--color-border)" : "none",
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[15px]">{MARKET_FLAG[group.market]}</span>
          <span className="font-black text-[14px]" style={{ color: "var(--color-ink-900)" }}>
            {group.market}
          </span>
          <span className="text-[12px]" style={{ color: "var(--color-ink-400)" }}>
            {group.total_visits} visit{group.total_visits !== 1 ? "s" : ""} · {group.cms.length} CM{group.cms.length !== 1 ? "s" : ""}
          </span>
        </div>
        <span className="text-[11px]" style={{ color: "var(--color-ink-300)" }}>
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          {/* CM table */}
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ borderBottom: "2px solid var(--color-border)" }}>
                  <th className="text-left pb-2 pr-3 font-semibold" style={{ color: "var(--color-ink-500)", width: "22%" }}>Channel Manager</th>
                  <th className="text-center pb-2 px-3 font-semibold whitespace-nowrap" style={{ color: "var(--color-ink-500)", width: "12%" }}># Stores</th>
                  <th className="text-center pb-2 px-3 font-semibold whitespace-nowrap" style={{ color: "var(--color-ink-500)", width: "12%" }}>Trainings</th>
                  <th className="text-left pb-2 pl-3 font-semibold" style={{ color: "var(--color-ink-500)" }}>Visits</th>
                </tr>
              </thead>
              <tbody>
                {group.cms.map((cm, i) => (
                  <tr
                    key={cm.telegram_id}
                    style={{ borderTop: i > 0 ? "1px solid var(--color-border)" : undefined }}
                  >
                    <CMRow cm={cm} onOpenStore={onOpenStore} />
                  </tr>
                ))}
              </tbody>

            </table>
          </div>

          {/* Sub-tables: Good News, Competitor, Display & Stock */}
          <SectionTable
            title="Good News"
            icon="🌟"
            market={group.market}
            entries={goodNews}
            onOpenStore={onOpenStore}
          />
          <SectionTable
            title="Competitor Intelligence"
            icon="🔍"
            market={group.market}
            entries={competitor}
            onOpenStore={onOpenStore}
          />
          <SectionTable
            title="Display & Stock"
            icon="📦"
            market={group.market}
            entries={displayStock}
            onOpenStore={onOpenStore}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Section ─────────────────────────────────────────────────────────────

interface ChannelManagersSectionProps {
  date: string | null;
  onOpenStore: (storeId: string) => void;
}

export default function ChannelManagersSection({ date, onOpenStore }: ChannelManagersSectionProps) {
  const [data, setData] = useState<{ markets: MarketGroup[] } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    setData(null);
    fetch(`/api/analytics/channel-managers?date=${date}`)
      .then((r) => r.json())
      .then((d) => setData(d))
      .finally(() => setLoading(false));
  }, [date]);

  if (!date) return null;

  return (
    <section>
      {/* Section header */}
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-lg font-black tracking-tight" style={{ color: "var(--color-ink-900)" }}>
          📊 Channel Managers
        </h2>
        {data && (
          <p className="text-[11px]" style={{ color: "var(--color-ink-300)" }}>
            {data.markets.reduce((s, m) => s + m.total_visits, 0)} visits ·{" "}
            {data.markets.reduce((s, m) => s + m.cms.length, 0)} CMs
          </p>
        )}
      </div>

      {loading && (
        <p className="text-[13px]" style={{ color: "var(--color-ink-300)" }}>Loading…</p>
      )}

      {!loading && data && data.markets.length === 0 && (
        <p className="text-[13px] py-4" style={{ color: "var(--color-ink-300)" }}>
          No locked visits for this date.
        </p>
      )}

      {!loading && data && (
        <div className="space-y-3">
          {data.markets.map((group) => (
            <MarketGroupBlock key={group.market} group={group} onOpenStore={onOpenStore} />
          ))}
        </div>
      )}
    </section>
  );
}
