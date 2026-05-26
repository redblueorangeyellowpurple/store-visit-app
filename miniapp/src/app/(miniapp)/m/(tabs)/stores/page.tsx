"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { initTelegram } from "../../telegram-init";

interface Store {
  id: string;
  name: string;
  chain: string;
  market: "SG" | "MY" | "TH" | "HK";
  tier: "T1" | "T2" | "T3" | "T4" | null;
  is_assigned: boolean;
  last_visit_by_you: string | null;
  last_visit_by_team: { date: string; cm_name: string } | null;
}

interface StoresPayload {
  stores: Store[];
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const then = new Date(dateStr); then.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - then.getTime()) / 86400000);
}

function relTime(dateStr: string | null): string {
  const d = daysSince(dateStr);
  if (d === null) return "—";
  if (d <= 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function recencyClass(dateStr: string | null): string {
  const d = daysSince(dateStr);
  if (d === null) return "text-[var(--color-ink-300)] font-semibold";
  if (d <= 7) return "text-[var(--color-tier-t1-fg)] font-bold";
  if (d <= 21) return "text-[var(--color-ink-500)] font-bold";
  return "text-[var(--color-ink-300)] font-semibold";
}

function groupByChain(stores: Store[], showMarket: boolean): Array<{ key: string; label: string; items: Store[] }> {
  const map = new Map<string, Store[]>();
  for (const s of stores) {
    const key = showMarket ? `${s.market} · ${s.chain}` : s.chain;
    const arr = map.get(key) ?? [];
    arr.push(s);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({ key, label: key, items }));
}

export default function StoresPage() {
  const [data, setData] = useState<StoresPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initTelegram();
        const initData = window.Telegram?.WebApp?.initData ?? "";
        const res = await fetch("/api/m/stores", { headers: { Authorization: `tma ${initData}` } });
        if (!res.ok) throw new Error(`stores: ${res.status}`);
        const json: StoresPayload = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!data) return null;
    const q = query.trim().toLowerCase();
    const match = (s: Store) =>
      !q || s.name.toLowerCase().includes(q) || s.chain.toLowerCase().includes(q) || s.market.toLowerCase().includes(q);
    const mine = data.stores.filter((s) => s.is_assigned && match(s));
    const other = data.stores.filter((s) => !s.is_assigned && match(s));
    const showMarket = new Set(data.stores.map((s) => s.market)).size > 1;
    return { mine, other, mineGroups: groupByChain(mine, showMarket), otherGroups: groupByChain(other, showMarket) };
  }, [data, query]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-[18px] pt-[22px] pb-4 bg-white border-b border-[var(--color-ink-100)]">
        <div className="flex justify-between items-baseline">
          <div className="text-[26px] font-black text-[var(--color-ink-700)] leading-none tracking-tight">Stores</div>
          {data && (
            <div className="text-[11px] font-semibold text-[var(--color-ink-300)]">
              {data.stores.length} · {data.stores.filter((s) => s.is_assigned).length} assigned
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-[160px]">
        {error && (
          <div className="mx-[14px] mt-4 p-4 rounded-xl border border-[var(--color-status-bad-bg)] bg-[var(--color-status-bad-bg)] text-[var(--color-status-bad-fg)] text-sm">
            {error}
          </div>
        )}

        {!data && !error && (
          <div className="py-16 text-center text-[var(--color-ink-300)] text-sm">Loading…</div>
        )}

        {filtered && (
          <>
            <SectionList label="Your stores" groups={filtered.mineGroups} empty={query ? "No matches" : "No stores assigned yet"} />
            <SectionList label="Other stores" groups={filtered.otherGroups} empty={query ? "No matches" : "All market stores are assigned to you"} className="mt-2" />
          </>
        )}
      </div>

      {/* Floating search above bottom nav */}
      <div className="fixed left-[14px] right-[14px] bottom-[100px] bg-white border border-[var(--color-ink-100)] rounded-2xl px-4 py-[10px] flex items-center gap-[10px] shadow-[0_6px_16px_rgba(0,0,0,0.08)] z-40">
        <span className="text-[var(--color-ink-300)] text-[15px]" aria-hidden>🔍</span>
        <input
          type="text"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any store…"
          className="flex-1 bg-transparent outline-none border-none text-[16px] text-[var(--color-ink-700)] placeholder:text-[var(--color-ink-300)]"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="text-[var(--color-ink-300)] text-[14px] font-bold leading-none"
            aria-label="Clear search"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function SectionList({
  label,
  groups,
  empty,
  className = "",
}: {
  label: string;
  groups: Array<{ key: string; label: string; items: Store[] }>;
  empty: string;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className="text-[10px] font-extrabold tracking-[0.08em] uppercase text-[var(--color-ink-300)] px-[18px] pt-[18px] pb-2">
        {label}
      </div>
      {groups.length === 0 ? (
        <div className="px-[18px] py-6 text-center text-[12px] text-[var(--color-ink-300)] italic">{empty}</div>
      ) : (
        groups.map(({ key, label: groupLabel, items }) => (
          <div key={key}>
            <div className="flex items-baseline justify-between px-[18px] pt-[10px] pb-1.5">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.07em] text-[var(--color-ink-500)]">{groupLabel}</span>
              <span className="text-[10px] font-semibold text-[var(--color-ink-300)]">
                {items.length} {items.length === 1 ? "store" : "stores"}
              </span>
            </div>
            {items.map((store) => (
              <StoreCard key={store.id} store={store} />
            ))}
          </div>
        ))
      )}
    </section>
  );
}

function StoreCard({ store }: { store: Store }) {
  const youLast = store.last_visit_by_you;
  const teamLast = store.last_visit_by_team;
  const youDate = youLast;
  const teamDate = teamLast?.date ?? null;
  const recencyDate = !youDate ? teamDate : !teamDate ? youDate : (youDate > teamDate ? youDate : teamDate);

  return (
    <Link
      href={`/m/store/${store.id}`}
      prefetch
      className="block mx-[14px] mb-1.5 bg-white border border-[var(--color-ink-100)] rounded-2xl px-[14px] py-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)] active:scale-[0.98] transition-transform"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-[14px] font-extrabold text-[var(--color-ink-700)] leading-tight tracking-tight">{store.name}</div>
        <div className={`text-[11px] flex-shrink-0 ml-[10px] ${recencyClass(recencyDate)}`}>
          {recencyDate ? relTime(recencyDate) : "Never"}
        </div>
      </div>
      <div className="flex flex-col gap-1 min-h-[44px] justify-center">
        <MetaRow
          pillLabel="You"
          pillClass="bg-[var(--color-tier-t1-bg)] text-[var(--color-tier-t1-fg)]"
          text={youDate ? relTime(youDate) : "Never visited"}
          muted={!youDate}
        />
        <MetaRow
          pillLabel="Team"
          pillClass="bg-[var(--color-ink-100)] text-[var(--color-ink-500)]"
          text={teamLast ? `${relTime(teamLast.date)}` : "No team visits yet"}
          who={teamLast?.cm_name}
          muted={!teamLast}
        />
      </div>
    </Link>
  );
}

function MetaRow({
  pillLabel,
  pillClass,
  text,
  who,
  muted,
}: {
  pillLabel: string;
  pillClass: string;
  text: string;
  who?: string | undefined;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-[11px] leading-[1.4] min-h-[18px]">
      <span className={`text-[9px] font-bold tracking-wider uppercase px-[7px] py-px rounded-full flex-shrink-0 ${pillClass}`}>{pillLabel}</span>
      <span className={muted ? "text-[var(--color-ink-300)] font-medium" : "text-[var(--color-ink-500)] font-semibold"}>
        {text}
        {who && <span className="text-[var(--color-ink-300)] font-medium"> · {who}</span>}
      </span>
    </div>
  );
}
