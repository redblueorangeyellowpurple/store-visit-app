"use client";

import { useEffect, useMemo, useState, useCallback, useRef, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { initTelegram, getStartParam } from "../../telegram-init";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Whoami {
  name: string;
  nickname: string | null;
  role: "cm" | "cmic" | "am" | "admin";
  market: string;
}

interface VisitRow {
  id: string;
  date: string;
  store_id: string;
  store_name: string;
  store_chain: string;
}

interface Activity {
  visits: VisitRow[];
  trainings: { date: string; store_id: string; store_name: string; staff_count: number }[];
}

interface OpenFollowUp {
  id: string;
  visit_id: string;
  title: string;
  store_name: string;
  due_date: string | null;
  created_at: string;
  openedDaysAgo: number;
  kpiBreach: boolean;
  overdue: boolean;
}

interface RecentPhotoComment {
  id: string;
  visit_id: string;
  visit_date: string;
  store_name: string;
  body: string;
  author_name: string | null;
  created_at: string;
  thumb_url: string | null;
}

interface SearchResult {
  id: string;
  visit_date: string;
  store_id: string;
  store_name: string;
  store_chain: string;
  store_tier: "T1" | "T2" | "T3" | "T4" | null;
  cm_name: string;
  good_news: string | null;
  competitors: string | null;
  display_stock: string | null;
  follow_up: string | null;
  buzz_plan: string | null;
}

type SectionKey = "good_news" | "competitors" | "display_stock" | "follow_up" | "buzz_plan";

interface FilterOptions {
  stores: { id: string; name: string; chain: string }[];
  cms: { telegram_id: number; name: string }[];
  canFilterCM: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIER_STYLE: Record<string, string> = {
  T1: "bg-[var(--color-tier-t1-bg)] text-[var(--color-tier-t1-fg)]",
  T2: "bg-[var(--color-tier-t2-bg)] text-[var(--color-tier-t2-fg)]",
  T3: "bg-[var(--color-tier-t3-bg)] text-[var(--color-tier-t3-fg)]",
  T4: "bg-[var(--color-tier-t4-bg)] text-[var(--color-tier-t4-fg)]",
};

const SECTION_LABELS: Record<string, string> = {
  good_news: "Good News",
  competitors: "Competitors",
  display_stock: "Display & Stock",
  follow_up: "Follow Up",
  buzz_plan: "Buzz Plan",
};

// ── Date helpers ──────────────────────────────────────────────────────────────

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function weekStart(iso: string): string {
  const d = parseISO(iso);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday
  d.setDate(d.getDate() + diff);
  return toISO(d);
}
function isoWeek(iso: string): number {
  const d = parseISO(iso);
  const target = new Date(d);
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstThursdayDayNr = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstThursdayDayNr + 3);
  const diff = (target.getTime() - firstThursday.getTime()) / 86400000;
  return 1 + Math.round(diff / 7);
}
function weekRangeLabel(weekStartIso: string): string {
  const start = parseISO(weekStartIso);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const fmtMonth = (d: Date) => d.toLocaleDateString("en-GB", { month: "short" });
  if (sameMonth) return `${start.getDate()}–${end.getDate()} ${fmtMonth(end)}`;
  return `${start.getDate()} ${fmtMonth(start)} – ${end.getDate()} ${fmtMonth(end)}`;
}
function fmtDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function highlight(text: string | null, query: string): string {
  if (!text || !query) return text ?? "";
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, 80) + (text.length > 80 ? "…" : "");
  const start = Math.max(0, idx - 20);
  const snippet = (start > 0 ? "…" : "") + text.slice(start, idx + query.length + 40);
  return snippet.length < text.length ? snippet + "…" : snippet;
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function VisitsPage() {
  return (
    <Suspense fallback={
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-center text-sm text-ink-300">Loading…</p>
      </main>
    }>
      <VisitsContent />
    </Suspense>
  );
}

function VisitsContent() {
  const router = useRouter();

  const [whoami, setWhoami] = useState<Whoami | null>(null);
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [initData, setInitData] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<OpenFollowUp[]>([]);
  const [comments, setComments] = useState<RecentPhotoComment[]>([]);

  // Search overlay state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sectionFilters, setSectionFilters] = useState<SectionKey[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [storeFilter, setStoreFilter] = useState("");
  const [cmFilter, setCmFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Settings sheet state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nickInput, setNickInput] = useState("");
  const [nickSaving, setNickSaving] = useState(false);
  const [nickSaved, setNickSaved] = useState(false);

  // Bootstrap: handle deep link, load whoami + activity
  useEffect(() => {
    (async () => {
      const id = await initTelegram();
      if (!id) { setError("Open this from inside Telegram."); return; }

      // Deep link from broadcast / Done message — fires once per unique start_param
      const startParam = getStartParam();
      const lastHandled = sessionStorage.getItem("sva-deeplink-handled");
      const visitMatch = startParam && startParam !== lastHandled
        ? startParam.match(/^visit_([0-9a-f-]{36})(?:_(training))?$/i)
        : null;
      if (visitMatch && startParam) {
        sessionStorage.setItem("sva-deeplink-handled", startParam);
        const action = visitMatch[2];
        router.replace(`/m/visit/${visitMatch[1]}${action ? `#${action}` : ""}`);
        return;
      }

      setInitData(id);
      const headers = { Authorization: `tma ${id}` };
      const [wRes, aRes] = await Promise.all([
        fetch("/api/m/whoami", { headers }),
        fetch("/api/m/stats/activity", { headers }),
      ]);
      if (!wRes.ok) { setError(`Failed (${wRes.status})`); return; }
      if (!aRes.ok) { setError(`Failed (${aRes.status})`); return; }
      const wJson: Whoami = await wRes.json();
      const aJson: Activity = await aRes.json();
      setWhoami(wJson);
      setActivity(aJson);
      setNickInput(wJson.nickname ?? wJson.name.split(" ")[0]);

      // Open follow-ups + recent photo comments — non-blocking, render when ready.
      fetch("/api/m/followups", { headers })
        .then((r) => (r.ok ? r.json() : { followUps: [] }))
        .then((j) => setFollowUps(j.followUps ?? []))
        .catch(() => {});
      fetch("/api/m/comments", { headers })
        .then((r) => (r.ok ? r.json() : { comments: [] }))
        .then((j) => setComments(j.comments ?? []))
        .catch(() => {});
    })().catch((e) => setError(String(e)));
  }, [router]);

  // ── Search effects ──────────────────────────────────────────────────────────

  const doSearch = useCallback(
    async (q: string, sections: SectionKey[], from: string, to: string, store: string, cm: string) => {
      if (!initData) { setSearchResults(null); return; }
      const trimmed = q.trim();
      const hasQuery = trimmed.length >= 2;
      const hasFilter = sections.length > 0 || !!from || !!to || !!store || !!cm;
      if (!hasQuery && !hasFilter) { setSearchResults(null); return; }
      setSearching(true);
      try {
        const params = new URLSearchParams();
        if (hasQuery) params.set("q", trimmed);
        for (const s of sections) params.append("section", s);
        if (from) params.set("from", from);
        if (to) params.set("to", to);
        if (store) params.set("store_id", store);
        if (cm) params.set("cm_telegram_id", cm);
        const res = await fetch(`/api/m/search?${params.toString()}`, { headers: { Authorization: `tma ${initData}` } });
        const j = await res.json();
        setSearchResults(j.results ?? []);
      } finally {
        setSearching(false);
      }
    },
    [initData],
  );

  useEffect(() => {
    if (!searchOpen) return;
    const t = setTimeout(
      () => doSearch(searchQuery, sectionFilters, fromDate, toDate, storeFilter, cmFilter),
      350,
    );
    return () => clearTimeout(t);
  }, [searchQuery, sectionFilters, fromDate, toDate, storeFilter, cmFilter, searchOpen, doSearch]);

  useEffect(() => {
    if (!searchOpen || !initData || filterOptions !== null) return;
    fetch("/api/m/filter-options", { headers: { Authorization: `tma ${initData}` } })
      .then((r) => r.json())
      .then((j) => setFilterOptions({ stores: j.stores ?? [], cms: j.cms ?? [], canFilterCM: !!j.canFilterCM }))
      .catch(() => setFilterOptions({ stores: [], cms: [], canFilterCM: false }));
  }, [searchOpen, initData, filterOptions]);

  useEffect(() => {
    if (searchOpen) setTimeout(() => searchRef.current?.focus(), 50);
  }, [searchOpen]);

  const hasAnyFilter =
    sectionFilters.length > 0 || !!fromDate || !!toDate || !!storeFilter || !!cmFilter;
  const filterCount =
    sectionFilters.length + (fromDate ? 1 : 0) + (toDate ? 1 : 0) + (storeFilter ? 1 : 0) + (cmFilter ? 1 : 0);

  function openSearch() {
    setSearchOpen(true);
    setSearchQuery("");
    setSectionFilters([]);
    setFromDate(""); setToDate("");
    setStoreFilter(""); setCmFilter("");
    setSearchResults(null);
  }
  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery("");
    setSearchResults(null);
  }
  function clearAllFilters() {
    setSectionFilters([]);
    setFromDate(""); setToDate("");
    setStoreFilter(""); setCmFilter("");
  }
  function toggleSection(key: SectionKey) {
    setSectionFilters((curr) => curr.includes(key) ? curr.filter((s) => s !== key) : [...curr, key]);
  }

  async function saveNickname() {
    if (!initData || !nickInput.trim()) return;
    setNickSaving(true);
    const res = await fetch("/api/m/whoami", {
      method: "PATCH",
      headers: { Authorization: `tma ${initData}`, "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: nickInput.trim() }),
    });
    setNickSaving(false);
    if (res.ok) {
      setNickSaved(true);
      if (whoami) setWhoami({ ...whoami, nickname: nickInput.trim() });
      setTimeout(() => { setNickSaved(false); setSettingsOpen(false); }, 800);
    }
  }

  // ── Group visits: week → chain ──────────────────────────────────────────────

  const grouped = useMemo(() => {
    if (!activity) return null;
    const byWeek = new Map<string, VisitRow[]>();
    for (const v of activity.visits) {
      const wk = weekStart(v.date);
      const arr = byWeek.get(wk) ?? [];
      arr.push(v);
      byWeek.set(wk, arr);
    }
    const weeks = Array.from(byWeek.keys()).sort().reverse();
    return weeks.map((wk) => {
      const visits = (byWeek.get(wk) ?? []).slice().sort((a, b) => b.date.localeCompare(a.date));
      const byChain = new Map<string, VisitRow[]>();
      for (const v of visits) {
        const c = v.store_chain || "—";
        const arr = byChain.get(c) ?? [];
        arr.push(v);
        byChain.set(c, arr);
      }
      const chains = Array.from(byChain.entries())
        .map(([chain, items]) => ({ chain, items }))
        .sort((a, b) => a.chain.localeCompare(b.chain));
      return { weekStart: wk, total: visits.length, chains };
    });
  }, [activity]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-center text-sm text-ink-400">{error}</p>
      </main>
    );
  }
  if (!whoami || !activity || !grouped) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-center text-sm text-ink-300">Loading…</p>
      </main>
    );
  }

  const displayName = whoami.nickname ?? whoami.name.split(" ")[0];

  return (
    <>
      <main className="min-h-screen pb-4">
        {/* Header */}
        <header className="bg-white border-b border-ink-100 px-4 pt-5 pb-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-300 mb-1">
                Good day
              </p>
              <h1 className="text-[28px] font-extrabold leading-tight text-ink-700">{displayName}</h1>
              <p className="text-xs text-ink-300 mt-0.5">{whoami.market}</p>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <button
                onClick={openSearch}
                className="h-9 w-9 flex items-center justify-center rounded-xl bg-ink-100 text-ink-400 text-base"
                aria-label="Search"
              >
                🔍
              </button>
              <button
                onClick={() => setSettingsOpen(true)}
                className="h-9 w-9 flex items-center justify-center rounded-xl bg-ink-100 text-ink-400 text-base"
                aria-label="Settings"
              >
                ⚙️
              </button>
            </div>
          </div>
        </header>

        {/* Open follow-ups + recent comments */}
        <AttentionBlock followUps={followUps} comments={comments} />

        {/* Timeline */}
        {grouped.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm text-ink-400 font-semibold">No visits yet</p>
            <p className="text-xs text-ink-300 mt-1">Use <strong>/visit</strong> in the bot to log your first one.</p>
          </div>
        ) : (
          grouped.map(({ weekStart: wk, total, chains }) => (
            <section key={wk} className="mt-4">
              <div className="px-4 pb-2 flex items-baseline justify-between">
                <div>
                  <span className="text-[11px] font-extrabold text-ink-700">Week {isoWeek(wk)}</span>
                  <span className="text-[10px] font-semibold text-[var(--color-ink-500)] ml-1.5">· {weekRangeLabel(wk)}</span>
                </div>
                <span className="text-[10px] font-bold text-[var(--color-ink-500)] bg-white border border-[var(--color-ink-100)] px-2 py-px rounded-full">
                  {total} {total === 1 ? "visit" : "visits"}
                </span>
              </div>

              {chains.map(({ chain, items }) => (
                <div key={chain} className="mt-2">
                  <div className="flex items-baseline justify-between px-[18px] pb-1.5">
                    <span className="text-[10px] font-extrabold uppercase tracking-[0.07em] text-[var(--color-ink-500)]">
                      {chain}
                    </span>
                    <span className="text-[10px] font-semibold text-ink-300">
                      {items.length} {items.length === 1 ? "visit" : "visits"}
                    </span>
                  </div>
                  <ul className="space-y-1.5 px-3.5">
                    {items.map((v) => <VisitCard key={v.id} visit={v} />)}
                  </ul>
                </div>
              ))}
            </section>
          ))
        )}
      </main>

      {/* Search overlay */}
      {searchOpen && (
        <div className="fixed inset-0 z-[60] bg-[var(--color-ink-50)] flex flex-col">
          <div className="bg-white border-b border-ink-100 px-4 pt-5 pb-3">
            <div className="flex items-center gap-3">
              <div className="flex-1 flex items-center gap-2 bg-ink-100 rounded-xl px-3 h-10">
                <span className="text-ink-300 text-sm">🔍</span>
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search visit notes…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="flex-1 bg-transparent text-[16px] text-ink-700 placeholder:text-ink-300 outline-none"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery("")} className="text-ink-300 text-lg leading-none">×</button>
                )}
              </div>
              <button onClick={closeSearch} className="text-sm font-semibold text-ink-400 shrink-0">
                Cancel
              </button>
            </div>

            <div className="flex gap-1.5 mt-2.5 overflow-x-auto pb-0.5 no-scrollbar">
              {(Object.entries(SECTION_LABELS) as [SectionKey, string][]).map(([v, l]) => {
                const active = sectionFilters.includes(v);
                return (
                  <button
                    key={v}
                    onClick={() => toggleSection(v)}
                    className={`shrink-0 text-[11px] font-semibold rounded-full px-3 py-1 transition-colors ${
                      active ? "bg-[var(--color-tc-600)] text-white" : "bg-ink-100 text-ink-400"
                    }`}
                  >
                    {l}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between mt-2">
              <button
                onClick={() => setFiltersOpen((v) => !v)}
                className="text-[11px] font-semibold text-[var(--color-tc-600)]"
              >
                {filtersOpen ? "▾ Hide filters" : `▸ More filters${filterCount > 0 ? ` (${filterCount})` : ""}`}
              </button>
              {hasAnyFilter && (
                <button
                  onClick={clearAllFilters}
                  className="text-[11px] font-semibold text-ink-300"
                >
                  Clear all
                </button>
              )}
            </div>

            {filtersOpen && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="flex-1 text-[16px] bg-ink-100 rounded-lg px-2.5 py-1.5 outline-none text-ink-700"
                    placeholder="From"
                  />
                  <span className="text-ink-300 text-[11px]">to</span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="flex-1 text-[16px] bg-ink-100 rounded-lg px-2.5 py-1.5 outline-none text-ink-700"
                    placeholder="To"
                  />
                </div>

                <select
                  value={storeFilter}
                  onChange={(e) => setStoreFilter(e.target.value)}
                  className="w-full text-[16px] bg-ink-100 rounded-lg px-2.5 py-1.5 outline-none text-ink-700"
                >
                  <option value="">All stores</option>
                  {(filterOptions?.stores ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.name} · {s.chain}</option>
                  ))}
                </select>

                {filterOptions?.canFilterCM && (
                  <select
                    value={cmFilter}
                    onChange={(e) => setCmFilter(e.target.value)}
                    className="w-full text-[16px] bg-ink-100 rounded-lg px-2.5 py-1.5 outline-none text-ink-700"
                  >
                    <option value="">All CMs</option>
                    {filterOptions.cms.map((c) => (
                      <option key={c.telegram_id} value={String(c.telegram_id)}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {searching && (
              <p className="text-center text-sm text-ink-300 py-8">Searching…</p>
            )}
            {!searching && searchResults !== null && searchResults.length === 0 && (
              <p className="text-center text-sm text-ink-300 py-8">
                No matches{searchQuery ? <> for &ldquo;{searchQuery}&rdquo;</> : ""}
              </p>
            )}
            {!searching && searchResults && searchResults.length > 0 && (
              <ul className="space-y-2 p-3.5">
                {searchResults.map((r) => (
                  <SearchResultCard key={r.id} result={r} query={searchQuery} />
                ))}
              </ul>
            )}
            {!searching && searchResults === null && (
              <p className="text-center text-sm text-ink-300 py-8">
                Type at least 2 characters or pick a filter
              </p>
            )}
          </div>
        </div>
      )}

      {/* Settings bottom sheet */}
      {settingsOpen && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/40" onClick={() => setSettingsOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 z-[61] bg-white rounded-t-2xl px-5 pt-5 pb-8 shadow-xl">
            <div className="w-8 h-1 bg-ink-200 rounded-full mx-auto mb-5" />
            <h2 className="text-base font-extrabold text-ink-700 mb-4">Settings</h2>

            <label className="block text-[11px] font-semibold uppercase tracking-wide text-ink-300 mb-1.5">
              Display name
            </label>
            <input
              type="text"
              value={nickInput}
              onChange={(e) => setNickInput(e.target.value)}
              maxLength={30}
              placeholder="Your name"
              className="w-full rounded-xl border border-ink-200 bg-ink-50 px-4 py-3 text-[16px] text-ink-700 outline-none focus:border-[var(--color-tc-500)]"
            />
            <p className="text-[11px] text-ink-300 mt-1">This is how the bot and mini app will greet you.</p>

            <button
              onClick={saveNickname}
              disabled={nickSaving || !nickInput.trim()}
              className="mt-4 w-full rounded-xl py-3 text-sm font-bold text-white transition-colors disabled:opacity-50"
              style={{ background: nickSaved ? "#1E7A3A" : "var(--color-tc-600)" }}
            >
              {nickSaved ? "✓ Saved" : nickSaving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </>
  );
}

// ── Attention block: open follow-ups + recent comments ─────────────────────────

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return weeks === 1 ? "1w ago" : `${weeks}w ago`;
}

function AttentionBlock({
  followUps,
  comments,
}: {
  followUps: OpenFollowUp[];
  comments: RecentPhotoComment[];
}) {
  if (followUps.length === 0 && comments.length === 0) return null;
  const breaches = followUps.filter((f) => f.kpiBreach).length;

  return (
    <>
      {followUps.length > 0 && (
        <section className="mt-4">
          <div className="px-4 pb-2 flex items-center justify-between">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-ink-300">
              Open follow-ups · {followUps.length}
            </h2>
            {breaches > 0 && (
              <span className="text-[10px] font-bold text-[var(--color-status-bad-fg)]">
                ⏰ {breaches} past 48h
              </span>
            )}
          </div>
          <ul className="space-y-1.5 px-3.5">
            {followUps.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/m/visit/${f.visit_id}`}
                  className="flex items-center gap-3 rounded-[16px] border border-ink-100 bg-white px-3.5 py-2.5 shadow-sm active:bg-ink-50"
                >
                  <span className={`shrink-0 text-sm ${f.kpiBreach ? "" : "opacity-30"}`}>
                    {f.kpiBreach ? "⏰" : "○"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-ink-700">{f.title}</p>
                    <p className="text-[11px] text-ink-300">
                      {f.store_name} · logged {timeAgo(f.created_at)}
                      {f.overdue && <span className="text-[var(--color-status-bad-fg)] font-semibold"> · overdue</span>}
                    </p>
                  </div>
                  <span className="text-ink-200 text-sm shrink-0">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {comments.length > 0 && (
        <section className="mt-4">
          <h2 className="px-4 pb-2 text-[10px] font-bold uppercase tracking-widest text-ink-300">
            Recent comments · {comments.length}
          </h2>
          <ul className="space-y-1.5 px-3.5">
            {comments.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/m/visit/${c.visit_id}`}
                  className="flex items-start gap-3 rounded-[16px] border border-ink-100 bg-white px-3 py-2.5 shadow-sm active:bg-ink-50"
                >
                  {c.thumb_url ? (
                    <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-ink-100">
                      <Image src={c.thumb_url} alt="" fill className="object-cover" sizes="44px" unoptimized />
                    </span>
                  ) : (
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-sm">💬</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[13px] leading-snug text-ink-700">{c.body}</p>
                    <p className="text-[11px] text-ink-300 mt-0.5">
                      {c.author_name ? `${c.author_name} · ` : ""}{c.store_name} · {timeAgo(c.created_at)}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ── Cards ─────────────────────────────────────────────────────────────────────

function VisitCard({ visit }: { visit: VisitRow }) {
  const d = parseISO(visit.date);
  const dow = d.toLocaleDateString("en-GB", { weekday: "short" });
  const dayLabel = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  return (
    <li>
      <Link
        href={`/m/visit/${visit.id}`}
        className="flex items-center gap-3 rounded-[16px] border border-ink-100 bg-white px-3.5 py-3 shadow-sm active:scale-[0.98] transition-transform"
      >
        <div className="w-12 shrink-0">
          <div className="text-[9px] font-bold text-ink-300 uppercase tracking-wider">{dow}</div>
          <div className="text-[11px] font-bold text-[var(--color-ink-500)]">{dayLabel}</div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-ink-700">{visit.store_name || "—"}</p>
        </div>
        <span className="text-ink-200 text-lg">›</span>
      </Link>
    </li>
  );
}

function SearchResultCard({ result, query }: { result: SearchResult; query: string }) {
  const tierStyle = result.store_tier ? TIER_STYLE[result.store_tier] : TIER_STYLE.T4;
  const sections = [
    { key: "good_news", label: "Good News", value: result.good_news },
    { key: "competitors", label: "Competitors", value: result.competitors },
    { key: "display_stock", label: "Display & Stock", value: result.display_stock },
    { key: "follow_up", label: "Follow Up", value: result.follow_up },
    { key: "buzz_plan", label: "Buzz Plan", value: result.buzz_plan },
  ].filter((s) => s.value?.toLowerCase().includes(query.toLowerCase()));

  return (
    <li>
      <Link
        href={`/m/visit/${result.id}`}
        className="block rounded-[18px] border border-ink-100 bg-white p-3.5 shadow-sm active:scale-[0.98] transition-transform"
      >
        <div className="flex items-center gap-2 mb-2">
          <span className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-lg ${tierStyle}`}>
            {result.store_tier ?? "—"}
          </span>
          <span className="text-sm font-bold text-ink-700 truncate">{result.store_name}</span>
        </div>
        <p className="text-[11px] text-ink-300 mb-2">
          {fmtDate(result.visit_date)} · {result.cm_name}
        </p>
        {sections.map((s) => (
          <div key={s.key} className="mb-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wide text-ink-300">{s.label} </span>
            <span className="text-[12px] text-ink-500">{highlight(s.value, query)}</span>
          </div>
        ))}
      </Link>
    </li>
  );
}
