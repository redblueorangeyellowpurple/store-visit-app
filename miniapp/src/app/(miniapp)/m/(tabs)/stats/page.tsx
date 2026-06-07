"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { initTelegram } from "../../telegram-init";

// ── Types ────────────────────────────────────────────────────────────────────

interface Whoami {
  name: string;
  nickname: string | null;
  role: "cm" | "cmic" | "am" | "admin";
  market: string;
}

interface Activity {
  visits: { date: string; store_id: string; store_name: string }[];
  trainings: { date: string; store_id: string; store_name: string; staff_count: number }[];
  engagements: { date: string; store_id: string; store_name: string }[];
  products: { date: string; store_id: string; product_name: string }[];
}

interface OpenFollowUp {
  id: string;
  visit_id: string;
  title: string;
  store_name: string;
  due_date: string | null;
  openedDaysAgo: number;
  kpiBreach: boolean;
  overdue: boolean;
}

type Preset = "lifetime" | "this-week" | "this-month" | "last-month" | "quarter";

type AppliedFilter =
  | { mode: "preset"; preset: Preset }
  | { mode: "weeks"; weeks: string[] };

// ── Date helpers (mirror mockup) ─────────────────────────────────────────────

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function todayISO(): string { return toISO(new Date()); }

function weekStart(iso: string): string {
  const d = parseISO(iso);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  return toISO(d);
}
function weekEnd(weekStartIso: string): string {
  const d = parseISO(weekStartIso);
  d.setDate(d.getDate() + 6);
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

function presetRange(preset: Preset): [string | null, string | null] {
  const today = todayISO();
  if (preset === "lifetime") return [null, null];
  if (preset === "this-week") return [weekStart(today), weekEnd(weekStart(today))];
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed
  if (preset === "this-month") {
    const start = toISO(new Date(y, m, 1));
    const end = toISO(new Date(y, m + 1, 0));
    return [start, end];
  }
  if (preset === "last-month") {
    const start = toISO(new Date(y, m - 1, 1));
    const end = toISO(new Date(y, m, 0));
    return [start, end];
  }
  if (preset === "quarter") {
    const qStartMonth = Math.floor(m / 3) * 3;
    const start = toISO(new Date(y, qStartMonth, 1));
    const end = toISO(new Date(y, qStartMonth + 3, 0));
    return [start, end];
  }
  return [null, null];
}

function filterRange(f: AppliedFilter): [string | null, string | null] {
  if (f.mode === "preset") return presetRange(f.preset);
  if (f.weeks.length === 0) return [null, null];
  const sorted = [...f.weeks].sort();
  return [sorted[0], weekEnd(sorted[sorted.length - 1])];
}

const PRESET_LABELS: Record<string, string> = {
  "lifetime": "Lifetime",
  "this-week": "This week",
  "this-month": "This month",
  "last-month": "Last month",
  "quarter": "This quarter",
};

function describeFilter(f: AppliedFilter): string {
  if (f.mode === "preset") return PRESET_LABELS[f.preset] ?? "Lifetime";
  if (f.weeks.length === 0) return "Lifetime";
  if (f.weeks.length === 1) return `Week ${isoWeek(f.weeks[0])} · ${weekRangeLabel(f.weeks[0])}`;
  const isoNums = f.weeks.map(isoWeek).sort((a, b) => a - b);
  const contiguous = isoNums.every((n, i) => i === 0 || n === isoNums[i - 1] + 1);
  if (contiguous) return `Weeks ${isoNums[0]}–${isoNums[isoNums.length - 1]}`;
  return `${f.weeks.length} weeks selected`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const [whoami, setWhoami] = useState<Whoami | null>(null);
  const [allActivity, setAllActivity] = useState<Activity | null>(null);
  const [followUps, setFollowUps] = useState<OpenFollowUp[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [appliedFilter, setAppliedFilter] = useState<AppliedFilter>({ mode: "preset", preset: "lifetime" });
  const [visitsOpen, setVisitsOpen] = useState(true);
  const [trainingsOpen, setTrainingsOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);

  // Load whoami + lifetime activity once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await initTelegram();
        const initData = window.Telegram?.WebApp?.initData ?? "";
        const headers = { Authorization: `tma ${initData}` };
        const [whoamiRes, activityRes, followUpsRes] = await Promise.all([
          fetch("/api/m/whoami", { headers }),
          fetch("/api/m/stats/activity", { headers }),
          fetch("/api/m/followups", { headers }),
        ]);
        if (!whoamiRes.ok) throw new Error(`whoami: ${whoamiRes.status}`);
        if (!activityRes.ok) throw new Error(`activity: ${activityRes.status}`);
        const whoamiJson: Whoami = await whoamiRes.json();
        const activityJson: Activity = await activityRes.json();
        // Follow-ups are non-critical — a failure here shouldn't blank the page.
        const followUpsJson: { followUps?: OpenFollowUp[] } = followUpsRes.ok ? await followUpsRes.json() : {};
        if (!cancelled) {
          setWhoami(whoamiJson);
          setAllActivity(activityJson);
          setFollowUps(followUpsJson.followUps ?? []);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const displayName = whoami?.nickname ?? whoami?.name ?? "—";
  const roleLabel = whoami ? whoami.role.toUpperCase() : "";

  // Apply filter client-side
  const activity = useMemo<Activity | null>(() => {
    if (!allActivity) return null;
    const [from, to] = filterRange(appliedFilter);
    const inRange = (date: string) => (!from || date >= from) && (!to || date <= to);
    if (appliedFilter.mode === "weeks") {
      const weekSet = new Set(appliedFilter.weeks);
      const inWeeks = (date: string) => weekSet.has(weekStart(date));
      return {
        visits: allActivity.visits.filter((v) => inWeeks(v.date)),
        trainings: allActivity.trainings.filter((t) => inWeeks(t.date)),
        engagements: allActivity.engagements.filter((e) => inWeeks(e.date)),
        products: allActivity.products.filter((p) => inWeeks(p.date)),
      };
    }
    return {
      visits: allActivity.visits.filter((v) => inRange(v.date)),
      trainings: allActivity.trainings.filter((t) => inRange(t.date)),
      engagements: allActivity.engagements.filter((e) => inRange(e.date)),
      products: allActivity.products.filter((p) => inRange(p.date)),
    };
  }, [allActivity, appliedFilter]);

  const totals = useMemo(() => {
    if (!activity) return { visitCount: 0, storesCovered: 0, trainStaff: 0, trainSessions: 0 };
    const storeSet = new Set(activity.visits.map((v) => v.store_id));
    const staffTotal = activity.trainings.reduce((s, t) => s + (t.staff_count || 1), 0);
    return {
      visitCount: activity.visits.length,
      storesCovered: storeSet.size,
      trainStaff: staffTotal,
      trainSessions: activity.trainings.length,
    };
  }, [activity]);

  const filterLabel = describeFilter(appliedFilter);
  const filterActive = !(appliedFilter.mode === "preset" && appliedFilter.preset === "lifetime");

  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-[18px] pt-[22px] pb-4 bg-white border-b border-[var(--color-ink-100)]">
        <div className="flex justify-between items-baseline">
          <div className="text-[26px] font-black text-[var(--color-ink-700)] leading-none tracking-tight">Stats</div>
          <div className="text-[11px] font-semibold text-[var(--color-ink-300)]">
            {displayName} {roleLabel && <span>· {roleLabel}</span>}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto pb-[100px]">
        {error && (
          <div className="mx-[14px] mt-4 p-4 rounded-xl border border-[var(--color-status-bad-bg)] bg-[var(--color-status-bad-bg)] text-[var(--color-status-bad-fg)] text-sm">
            {error}
          </div>
        )}

        {/* Open follow-ups — outstanding tasks, 48h KPI front-and-centre */}
        {followUps.length > 0 && (
          <>
            <SectionLabel>
              Open follow-ups
              {followUps.some((f) => f.kpiBreach) && (
                <span className="ml-1.5 text-[var(--color-status-bad-fg)]">· ⏰ {followUps.filter((f) => f.kpiBreach).length} past 48h</span>
              )}
            </SectionLabel>
            <FollowUpList items={followUps} />
          </>
        )}

        {/* Performance — personal insights */}
        <SectionLabel>Performance</SectionLabel>
        {allActivity && activity && (
          <PerformancePanel all={allActivity} period={activity} periodLabel={filterLabel} />
        )}

        {/* Activity */}
        <SectionLabel>Activity</SectionLabel>

        <div className="mx-[14px] mt-1 mb-3">
          <button
            type="button"
            onClick={() => setFilterOpen(true)}
            className={`w-full flex items-center justify-between rounded-xl px-3 py-2 border shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${
              filterActive
                ? "border-[var(--color-tc-400)] bg-[var(--color-tc-50)]"
                : "border-[var(--color-ink-100)] bg-white"
            }`}
            aria-label="Change filter"
          >
            <div className="text-left">
              <div className="text-[8px] font-bold uppercase tracking-widest text-[var(--color-ink-300)]">Showing</div>
              <div className={`text-[12px] font-bold mt-0.5 ${filterActive ? "text-[var(--color-ink-700)]" : "text-[var(--color-ink-500)]"}`}>{filterLabel}</div>
            </div>
            <div className="text-[var(--color-ink-300)] text-[13px]">›</div>
          </button>
        </div>

        {activity && (
          <>
            <SummaryCard
              icon="📍"
              iconBg="bg-[var(--color-tier-t1-bg)]"
              label="Store visits"
              valueMain={String(totals.visitCount)}
              valueSub={`across ${totals.storesCovered} ${totals.storesCovered === 1 ? "store" : "stores"}`}
              open={visitsOpen}
              onToggle={() => setVisitsOpen((v) => !v)}
            >
              <Timeline items={activity.visits.map((v) => ({ date: v.date, store_name: v.store_name }))} kind="visit" />
            </SummaryCard>

            <SummaryCard
              icon="🎓"
              iconBg="bg-[var(--color-section-purple-bg)]"
              label="Trainings"
              valueMain={`${totals.trainStaff} staff`}
              valueSub={`· ${totals.trainSessions} ${totals.trainSessions === 1 ? "session" : "sessions"}`}
              open={trainingsOpen}
              onToggle={() => setTrainingsOpen((t) => !t)}
            >
              <Timeline items={activity.trainings.map((t) => ({ date: t.date, store_name: t.store_name, meta: `${t.staff_count} staff` }))} kind="training" />
            </SummaryCard>
          </>
        )}

        {!activity && !error && (
          <div className="py-10 text-center text-[var(--color-ink-300)] text-sm">Loading…</div>
        )}
      </div>

      {filterOpen && allActivity && (
        <FilterPopup
          allActivity={allActivity}
          applied={appliedFilter}
          onApply={(f) => { setAppliedFilter(f); setFilterOpen(false); }}
          onClose={() => setFilterOpen(false)}
        />
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--color-ink-300)] px-[18px] pt-[18px] pb-1">
      {children}
    </div>
  );
}

// ── Open follow-ups ──────────────────────────────────────────────────────────

function FollowUpList({ items }: { items: OpenFollowUp[] }) {
  const dueShort = (iso: string) => parseISO(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <div className="mx-[14px] mt-1 bg-white border border-[var(--color-ink-100)] rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)] divide-y divide-[var(--color-ink-100)]">
      {items.map((f) => (
        <Link key={f.id} href={`/m/visit/${f.visit_id}`} className="flex items-center gap-3 px-4 py-3 active:bg-[var(--color-ink-50)]">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${f.kpiBreach ? "bg-[var(--color-status-bad-fg)]" : "bg-[var(--color-tc-400)]"}`} />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-[var(--color-ink-700)] truncate">{f.title}</div>
            <div className="text-[11px] text-[var(--color-ink-500)] truncate">{f.store_name}</div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className={`text-[10px] font-bold ${f.kpiBreach ? "text-[var(--color-status-bad-fg)]" : "text-[var(--color-ink-300)]"}`}>
              {f.kpiBreach ? `⏰ ${f.openedDaysAgo}d` : f.openedDaysAgo <= 0 ? "today" : `${f.openedDaysAgo}d`}
            </div>
            {f.due_date && (
              <div className={`text-[9px] font-semibold mt-0.5 ${f.overdue ? "text-[var(--color-status-bad-fg)]" : "text-[var(--color-ink-300)]"}`}>
                {f.overdue ? "overdue" : `due ${dueShort(f.due_date)}`}
              </div>
            )}
          </div>
          <div className="text-[var(--color-ink-300)] text-[16px] flex-shrink-0">›</div>
        </Link>
      ))}
    </div>
  );
}

// ── Performance (personal insights) ──────────────────────────────────────────

function topStore(items: { store_id: string; store_name: string }[]): { name: string; count: number } | null {
  if (items.length === 0) return null;
  const m = new Map<string, { name: string; count: number }>();
  for (const it of items) {
    const e = m.get(it.store_id) ?? { name: it.store_name || "—", count: 0 };
    e.count += 1;
    m.set(it.store_id, e);
  }
  let best: { name: string; count: number } | null = null;
  for (const e of m.values()) if (!best || e.count > best.count) best = e;
  return best;
}

function PerformancePanel({ all, period, periodLabel }: { all: Activity; period: Activity; periodLabel: string }) {
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  // This-week / this-month visit counts — fixed periods, independent of the
  // Activity filter below, so the CM always sees their current pace.
  const [twFrom, twTo] = presetRange("this-week");
  const [tmFrom, tmTo] = presetRange("this-month");
  const inR = (d: string, from: string | null, to: string | null) => (!from || d >= from) && (!to || d <= to);
  const visitsThisWeek = all.visits.filter((v) => inR(v.date, twFrom, twTo)).length;
  const visitsThisMonth = all.visits.filter((v) => inR(v.date, tmFrom, tmTo)).length;

  // Period-scoped rollups (respect the Activity filter).
  const engagementCount = period.engagements.length;
  const trainingSessions = period.trainings.length;
  const productCount = period.products.length;
  const topVisited = topStore(period.visits.map((v) => ({ store_id: v.store_id, store_name: v.store_name })));
  const topEngaged = topStore(period.engagements.map((e) => ({ store_id: e.store_id, store_name: e.store_name })));

  const productBreakdown = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of period.products) m.set(p.product_name || "—", (m.get(p.product_name || "—") ?? 0) + 1);
    return Array.from(m.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  }, [period.products]);
  const maxProduct = productBreakdown[0]?.count ?? 1;

  return (
    <div className="mx-[14px] mt-1 space-y-2.5">
      {/* Pace — fixed this-week / this-month */}
      <div className="grid grid-cols-2 gap-2.5">
        <PaceTile label="This week" value={visitsThisWeek} tint="bg-[var(--color-tier-t1-bg)]" fg="text-[var(--color-tier-t1-fg)]" />
        <PaceTile label="This month" value={visitsThisMonth} tint="bg-[var(--color-tc-50)]" fg="text-[var(--color-tc-600)]" />
      </div>

      {/* Period totals */}
      <div className="bg-white border border-[var(--color-ink-100)] rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4">
        <div className="text-[9px] font-extrabold uppercase tracking-wider text-[var(--color-ink-300)] mb-2.5">{periodLabel}</div>
        <div className="grid grid-cols-3 divide-x divide-[var(--color-ink-100)]">
          <StatCell value={engagementCount} label={engagementCount === 1 ? "engagement" : "engagements"} />
          <StatCell value={trainingSessions} label={trainingSessions === 1 ? "training" : "trainings"} />
          <StatCell value={productCount} label={productCount === 1 ? "product" : "products"} />
        </div>
      </div>

      {/* Top stores */}
      {(topVisited || topEngaged) && (
        <div className="bg-white border border-[var(--color-ink-100)] rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.04)] divide-y divide-[var(--color-ink-100)]">
          <TopStoreRow icon="🏆" label="Most visited" store={topVisited} unit="visits" />
          <TopStoreRow icon="🤝" label="Most engaged" store={topEngaged} unit="people" />
        </div>
      )}

      {/* Product breakdown */}
      {productBreakdown.length > 0 && (
        <div className="bg-white border border-[var(--color-ink-100)] rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <button type="button" onClick={() => setBreakdownOpen((o) => !o)} className="w-full px-4 py-3 flex items-center gap-3 text-left">
            <div className="w-[42px] h-[42px] rounded-xl flex items-center justify-center text-[19px] flex-shrink-0 bg-[var(--color-section-purple-bg)]">🎧</div>
            <div className="flex-1 min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-300)] mb-0.5">Products trained</div>
              <div className="text-[22px] font-black text-[var(--color-ink-700)] leading-none tracking-tight">
                {productBreakdown.length}
                <span className="text-[13px] font-semibold text-[var(--color-ink-500)] ml-1">{productBreakdown.length === 1 ? "product" : "products"}</span>
              </div>
            </div>
            <div className={`text-[var(--color-ink-300)] text-[22px] transition-transform flex-shrink-0 ${breakdownOpen ? "rotate-90" : ""}`}>›</div>
          </button>
          {breakdownOpen && (
            <div className="border-t border-[var(--color-ink-100)] px-4 py-3 space-y-2">
              {productBreakdown.map((p) => (
                <div key={p.name} className="flex items-center gap-2.5">
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-[12px] font-semibold text-[var(--color-ink-700)] truncate pr-2">{p.name}</span>
                      <span className="text-[11px] font-bold text-[var(--color-ink-500)] flex-shrink-0">{p.count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[var(--color-ink-100)] overflow-hidden">
                      <div className="h-full rounded-full bg-[var(--color-section-purple-border)]" style={{ width: `${Math.max(8, (p.count / maxProduct) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PaceTile({ label, value, tint, fg }: { label: string; value: number; tint: string; fg: string }) {
  return (
    <div className={`rounded-2xl p-3.5 ${tint}`}>
      <div className={`text-[24px] font-black leading-none tracking-tight ${fg}`}>{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-500)] mt-1.5">{label}</div>
      <div className="text-[9px] font-semibold text-[var(--color-ink-300)] mt-px">{value === 1 ? "visit" : "visits"}</div>
    </div>
  );
}

function StatCell({ value, label }: { value: number; label: string }) {
  return (
    <div className="px-1 text-center first:pl-0 last:pr-0">
      <div className="text-[24px] font-black text-[var(--color-ink-700)] leading-none tracking-tight">{value}</div>
      <div className="text-[10px] font-semibold text-[var(--color-ink-500)] mt-1.5">{label}</div>
    </div>
  );
}

function TopStoreRow({ icon, label, store, unit }: { icon: string; label: string; store: { name: string; count: number } | null; unit: string }) {
  return (
    <div className="px-4 py-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center text-[16px] flex-shrink-0 bg-[var(--color-ink-50)]">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[9px] font-bold uppercase tracking-wider text-[var(--color-ink-300)]">{label}</div>
        <div className="text-[13px] font-bold text-[var(--color-ink-700)] truncate">{store ? store.name : "—"}</div>
      </div>
      {store && (
        <div className="text-right flex-shrink-0">
          <div className="text-[15px] font-black text-[var(--color-ink-700)] leading-none">{store.count}</div>
          <div className="text-[9px] font-semibold text-[var(--color-ink-300)] mt-0.5">{unit}</div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  iconBg,
  label,
  valueMain,
  valueSub,
  open,
  onToggle,
  children,
}: {
  icon: string;
  iconBg: string;
  label: string;
  valueMain: string;
  valueSub: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-[14px] mt-2.5 bg-white border border-[var(--color-ink-100)] rounded-2xl overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
      <button type="button" onClick={onToggle} className="w-full px-4 py-3.5 flex items-center gap-3 text-left">
        <div className={`w-[42px] h-[42px] rounded-xl flex items-center justify-center text-[19px] flex-shrink-0 ${iconBg}`}>{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-ink-300)] mb-0.5">{label}</div>
          <div className="text-[22px] font-black text-[var(--color-ink-700)] leading-none tracking-tight">
            {valueMain}
            <span className="text-[13px] font-semibold text-[var(--color-ink-500)] ml-1">{valueSub}</span>
          </div>
        </div>
        <div className={`text-[var(--color-ink-300)] text-[22px] transition-transform flex-shrink-0 ${open ? "rotate-90" : ""}`}>›</div>
      </button>
      {open && <div className="border-t border-[var(--color-ink-100)]">{children}</div>}
    </div>
  );
}

interface TimelineEntry {
  date: string;
  store_name: string;
  meta?: string;
}

function Timeline({ items, kind }: { items: TimelineEntry[]; kind: "visit" | "training" }) {
  if (items.length === 0) {
    return (
      <div className="py-6 text-center text-[var(--color-ink-300)] text-[12px] italic">
        No {kind === "visit" ? "visits" : "trainings"} in this period
      </div>
    );
  }
  const groups = new Map<string, TimelineEntry[]>();
  for (const it of items) {
    const wk = weekStart(it.date);
    const arr = groups.get(wk) ?? [];
    arr.push(it);
    groups.set(wk, arr);
  }
  const weeks = Array.from(groups.keys()).sort().reverse();

  return (
    <>
      {weeks.map((wk) => {
        const entries = (groups.get(wk) ?? []).sort((a, b) => b.date.localeCompare(a.date));
        const count = kind === "visit"
          ? `${entries.length} visit${entries.length > 1 ? "s" : ""}`
          : `${entries.reduce((s, e) => {
              const n = parseInt((e.meta?.match(/^\d+/) ?? ["1"])[0], 10);
              return s + (Number.isFinite(n) ? n : 1);
            }, 0)} staff`;
        return (
          <div key={wk}>
            <div className="px-4 py-2 bg-[var(--color-ink-50)] border-y border-[var(--color-ink-100)] flex justify-between items-center">
              <span className="flex items-baseline gap-1.5">
                <span className="text-[11px] font-extrabold text-[var(--color-ink-700)]">Week {isoWeek(wk)}</span>
                <span className="text-[10px] font-semibold text-[var(--color-ink-500)]">· {weekRangeLabel(wk)}</span>
              </span>
              <span className="text-[10px] font-bold text-[var(--color-ink-700)] bg-white border border-[var(--color-ink-100)] px-2 py-px rounded-full">
                {count}
              </span>
            </div>
            {entries.map((e, i) => {
              const d = parseISO(e.date);
              const dow = d.toLocaleDateString("en-GB", { weekday: "short" });
              const dateStr = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
              return (
                <div key={`${e.date}-${e.store_name}-${i}`} className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--color-ink-50)] last:border-b-0 text-[13px]">
                  <div className="w-14 flex-shrink-0">
                    <div className="text-[9px] font-bold text-[var(--color-ink-300)] uppercase tracking-wider">{dow}</div>
                    <div className="text-[11px] font-bold text-[var(--color-ink-500)]">{dateStr}</div>
                  </div>
                  <div className="flex-1 min-w-0 text-[var(--color-ink-700)] font-semibold truncate">{e.store_name || "—"}</div>
                  {e.meta && <div className="text-[10px] font-semibold text-[var(--color-ink-300)] flex-shrink-0">{e.meta}</div>}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

// ── Filter popup ─────────────────────────────────────────────────────────────

const PRESETS: { key: Preset; label: string }[] = [
  { key: "lifetime", label: "Lifetime" },
  { key: "this-week", label: "This week" },
  { key: "this-month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "quarter", label: "This quarter" },
];

function FilterPopup({
  allActivity,
  applied,
  onApply,
  onClose,
}: {
  allActivity: Activity;
  applied: AppliedFilter;
  onApply: (f: AppliedFilter) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<AppliedFilter>(applied);

  // Derive available weeks: every week from oldest activity → current week, sorted newest first
  const weeks = useMemo(() => {
    const set = new Set<string>();
    for (const v of allActivity.visits) set.add(weekStart(v.date));
    for (const t of allActivity.trainings) set.add(weekStart(t.date));
    set.add(weekStart(todayISO()));
    return Array.from(set).sort().reverse();
  }, [allActivity]);

  // Activity counts per week
  const countsByWeek = useMemo(() => {
    const m = new Map<string, { visits: number; trainings: number }>();
    for (const wk of weeks) m.set(wk, { visits: 0, trainings: 0 });
    for (const v of allActivity.visits) {
      const wk = weekStart(v.date);
      const c = m.get(wk); if (c) c.visits += 1;
    }
    for (const t of allActivity.trainings) {
      const wk = weekStart(t.date);
      const c = m.get(wk); if (c) c.trainings += 1;
    }
    return m;
  }, [allActivity, weeks]);

  const selectedSet = draft.mode === "weeks" ? new Set(draft.weeks) : new Set<string>();
  const hasWeeks = draft.mode === "weeks" && draft.weeks.length > 0;

  function selectPreset(p: Preset) { setDraft({ mode: "preset", preset: p }); }
  function toggleWeek(wk: string) {
    if (draft.mode !== "weeks") {
      setDraft({ mode: "weeks", weeks: [wk] });
      return;
    }
    const i = draft.weeks.indexOf(wk);
    const next = i >= 0
      ? draft.weeks.filter((w) => w !== wk)
      : [...draft.weeks, wk];
    if (next.length === 0) setDraft({ mode: "preset", preset: "lifetime" });
    else setDraft({ mode: "weeks", weeks: next });
  }
  function clearWeeks() { setDraft({ mode: "preset", preset: "lifetime" }); }

  const today = weekStart(todayISO());

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-[150]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.4)] w-[320px] max-h-[80vh] z-[200] flex flex-col overflow-hidden"
      >
        <div className="px-[18px] pt-4 pb-3 border-b border-[var(--color-ink-100)] flex-shrink-0">
          <div className="text-[15px] font-extrabold text-[var(--color-ink-700)] tracking-tight">Show activity for</div>
          <div className="text-[11px] text-[var(--color-ink-500)] mt-0.5 font-medium">{describeFilter(draft)}</div>
        </div>

        <div className="flex-1 overflow-y-auto py-3">
          <div className="px-[18px] pb-2 text-[9px] font-extrabold text-[var(--color-ink-300)] uppercase tracking-wider">
            Quick presets
          </div>
          <div className="px-[18px] pb-2.5 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const selected = draft.mode === "preset" && draft.preset === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => selectPreset(p.key)}
                  className={`text-[11px] font-bold rounded-full px-2.5 py-1.5 border ${
                    selected
                      ? "bg-[var(--color-tc-50)] text-[var(--color-ink-700)] border-[var(--color-tc-100)]"
                      : "bg-[var(--color-ink-50)] text-[var(--color-ink-700)] border-transparent"
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="h-px bg-[var(--color-ink-100)] mx-[18px] my-1" />

          <div className="px-[18px] pt-2 pb-2 flex items-center justify-between">
            <span className="text-[9px] font-extrabold text-[var(--color-ink-300)] uppercase tracking-wider">Pick specific weeks</span>
            <button
              type="button"
              onClick={clearWeeks}
              disabled={!hasWeeks}
              className={`text-[10px] font-bold ${hasWeeks ? "text-[var(--color-tc-400)]" : "text-[var(--color-ink-300)]"}`}
            >
              Clear
            </button>
          </div>

          <div>
            {weeks.map((wk) => {
              const isSelected = selectedSet.has(wk);
              const counts = countsByWeek.get(wk) ?? { visits: 0, trainings: 0 };
              const isThisWeek = wk === today;
              const metaParts: string[] = [];
              if (counts.visits > 0) metaParts.push(`${counts.visits}v`);
              if (counts.trainings > 0) metaParts.push(`${counts.trainings}t`);
              const meta = isThisWeek ? "This week" : (metaParts.join(" · ") || "—");
              return (
                <button
                  key={wk}
                  type="button"
                  onClick={() => toggleWeek(wk)}
                  className={`w-full flex items-center gap-2.5 px-[18px] py-2.5 text-left ${isSelected ? "bg-[var(--color-tc-50)]" : "hover:bg-[var(--color-ink-50)]"}`}
                >
                  <div className={`w-[18px] h-[18px] rounded-md flex items-center justify-center flex-shrink-0 text-[11px] font-black ${
                    isSelected
                      ? "bg-[var(--color-tc-400)] border-[var(--color-tc-400)] text-white"
                      : "bg-white border-[1.5px] border-[var(--color-ink-200)]"
                  }`}>{isSelected && "✓"}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-bold text-[var(--color-ink-700)] leading-tight">Week {isoWeek(wk)}</div>
                    <div className="text-[10px] font-medium text-[var(--color-ink-500)] mt-px">{weekRangeLabel(wk)}</div>
                  </div>
                  <div className="text-[9px] font-bold text-[var(--color-ink-300)] uppercase tracking-wider flex-shrink-0">{meta}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-[18px] py-3 border-t border-[var(--color-ink-100)] flex gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-[12px] font-bold bg-[var(--color-ink-50)] text-[var(--color-ink-700)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onApply(draft)}
            className="flex-1 py-2.5 rounded-xl text-[12px] font-bold bg-[var(--color-ink-700)] text-white"
          >
            Apply
          </button>
        </div>
      </div>
    </>
  );
}
