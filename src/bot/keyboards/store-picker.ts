import { InlineKeyboard } from 'grammy';
import { Store } from '../../db/queries/stores.js';

export const STORE_PAGE_SIZE = 6;

// Visit cadence per store tier (days). Confirmed with Wilson 2026-05-21.
// T1=weekly · T2=biweekly · T3=monthly · T4=quarterly.
const TIER_CADENCE_DAYS: Record<NonNullable<Store['tier']>, number> = {
  T1: 7,
  T2: 14,
  T3: 30,
  T4: 90,
};

// "Due soon" thresholds — surface stores approaching their cadence so CMs can
// plan ahead. ~70% of cadence: T1=5d, T2=10d, T3=21d, T4=63d. Untiered stores
// fall back to T3 cadence as a neutral middle ground.
const TIER_DUE_SOON_DAYS: Record<NonNullable<Store['tier']>, number> = {
  T1: 5,
  T2: 10,
  T3: 21,
  T4: 63,
};

const DEFAULT_CADENCE_DAYS = TIER_CADENCE_DAYS.T3;
const DEFAULT_DUE_SOON_DAYS = TIER_DUE_SOON_DAYS.T3;

type Status = 'never' | 'on_track' | 'due_soon' | 'overdue';

const STATUS_RANK: Record<Status, number> = {
  overdue: 0,
  due_soon: 1,
  on_track: 2,
  never: 3,
};

function daysSince(dateStr: string): number {
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function cadenceFor(tier: Store['tier']): { cadence: number; dueSoon: number } {
  if (!tier) return { cadence: DEFAULT_CADENCE_DAYS, dueSoon: DEFAULT_DUE_SOON_DAYS };
  return { cadence: TIER_CADENCE_DAYS[tier], dueSoon: TIER_DUE_SOON_DAYS[tier] };
}

function statusFor(store: Store, lastVisits: Record<string, string>): Status {
  const date = lastVisits[store.id];
  if (!date) return 'never';
  const days = daysSince(date);
  const { cadence, dueSoon } = cadenceFor(store.tier);
  if (days >= cadence) return 'overdue';
  if (days >= dueSoon) return 'due_soon';
  return 'on_track';
}

function statusIcon(s: Status): string {
  switch (s) {
    case 'overdue': return '🔴';
    case 'due_soon': return '🟡';
    case 'on_track': return '✅';
    case 'never': return '⚪';
  }
}

function tierLabel(tier: Store['tier']): string {
  return tier ?? '—';
}

function lastVisitLabel(storeId: string, lastVisits: Record<string, string>): string {
  const date = lastVisits[storeId];
  if (!date) return 'never visited';
  const days = daysSince(date);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  return `${days}d ago`;
}

// Sort: overdue first, then due-soon, then on-track, then never. Ties by name.
function sortStoresByStatus(
  stores: Store[],
  lastVisits: Record<string, string>,
): Store[] {
  return [...stores].sort((a, b) => {
    const ra = STATUS_RANK[statusFor(a, lastVisits)];
    const rb = STATUS_RANK[statusFor(b, lastVisits)];
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
}

export function buildStoreContextMessage(
  stores: Store[],
  lastVisits: Record<string, string> = {},
): string {
  const sorted = sortStoresByStatus(stores, lastVisits);
  const lines = sorted.map((s) => {
    const icon = statusIcon(statusFor(s, lastVisits));
    const label = lastVisitLabel(s.id, lastVisits);
    return `${icon} *${tierLabel(s.tier)}* · ${s.name} · _${label}_`;
  });
  return (
    `🏪 *Your Stores*\n` +
    `_🔴 overdue · 🟡 due soon · ✅ on track · ⚪ never visited_\n\n` +
    `${lines.join('\n')}`
  );
}

export function buildStorePicker(
  stores: Store[],
  lastVisits: Record<string, string> = {},
  page = 0,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const sorted = sortStoresByStatus(stores, lastVisits);
  const totalPages = Math.ceil(sorted.length / STORE_PAGE_SIZE);
  const pageStores = sorted.slice(page * STORE_PAGE_SIZE, (page + 1) * STORE_PAGE_SIZE);

  for (const store of pageStores) {
    const icon = statusIcon(statusFor(store, lastVisits));
    kb.text(`${icon} ${store.name}`, `store:${store.id}`).row();
  }

  if (totalPages > 1) {
    const prevBtn = page > 0;
    const nextBtn = page < totalPages - 1;
    if (prevBtn && nextBtn) {
      kb.text('← Back', `page:${page - 1}`).text(`Next →`, `page:${page + 1}`).row();
    } else if (prevBtn) {
      kb.text('← Back', `page:${page - 1}`).row();
    } else if (nextBtn) {
      kb.text(`Next →`, `page:${page + 1}`).row();
    }
  }

  kb.text('🔍 Other store', 'search:stores').row();
  kb.text('Cancel', 'cancel').row();
  return kb;
}

export function buildSearchResultsPicker(stores: Store[], opts?: { showMarket?: boolean }): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const store of stores) {
    const label = opts?.showMarket ? `${store.name} · ${store.market}` : store.name;
    kb.text(label, `store:${store.id}`).row();
  }
  kb.text('← Back', 'search:back').row();
  kb.text('Cancel', 'cancel').row();
  return kb;
}

// ── "Other Store" three-step browse: Country → Channel → Store ───────────────
// Wilson 2026-05-26: CMs across all markets can browse any store. Hierarchy
// mirrors how the team is assigned (by channel within a market), and the
// store-level list sorts by tier so the most important stores surface first.

export const COUNTRY_LABELS: Record<string, string> = {
  SG: '🇸🇬 Singapore',
  MY: '🇲🇾 Malaysia',
  TH: '🇹🇭 Thailand',
  HK: '🇭🇰 Hong Kong',
};

const COUNTRY_ORDER = ['SG', 'MY', 'TH', 'HK'];

export function countryLabel(code: string): string {
  return COUNTRY_LABELS[code] ?? code;
}

export function buildCountryPicker(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const code of COUNTRY_ORDER) {
    kb.text(COUNTRY_LABELS[code], `country:${code}`).row();
  }
  kb.text('← Back to my stores', 'search:back').row();
  kb.text('Cancel', 'cancel').row();
  return kb;
}

const BROWSE_PAGE_SIZE = 5;

export function buildChannelPicker(
  market: string,
  channels: Array<{ chain: string; count: number }>,
  page: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const totalPages = Math.max(1, Math.ceil(channels.length / BROWSE_PAGE_SIZE));
  const clamped = Math.min(Math.max(0, page), totalPages - 1);
  const slice = channels.slice(clamped * BROWSE_PAGE_SIZE, (clamped + 1) * BROWSE_PAGE_SIZE);
  for (const c of slice) {
    kb.text(`${c.chain} · ${c.count}`, `channel:${market}:${c.chain}`).row();
  }
  if (totalPages > 1) {
    const prev = clamped > 0;
    const next = clamped < totalPages - 1;
    if (prev && next) {
      kb.text('← Prev', `channel-page:${market}:${clamped - 1}`)
        .text('Next →', `channel-page:${market}:${clamped + 1}`).row();
    } else if (prev) {
      kb.text('← Prev', `channel-page:${market}:${clamped - 1}`).row();
    } else if (next) {
      kb.text('Next →', `channel-page:${market}:${clamped + 1}`).row();
    }
  }
  kb.text('← Countries', 'country-back').row();
  kb.text('Cancel', 'cancel').row();
  return kb;
}

const TIER_RANK: Record<string, number> = { T1: 0, T2: 1, T3: 2, T4: 3 };

function sortStoresByTier(stores: Store[]): Store[] {
  return [...stores].sort((a, b) => {
    const ra = a.tier ? TIER_RANK[a.tier] : 4;
    const rb = b.tier ? TIER_RANK[b.tier] : 4;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name);
  });
}

export function buildChannelStorePicker(
  market: string,
  chain: string,
  stores: Store[],
  page: number,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  const sorted = sortStoresByTier(stores);
  const totalPages = Math.max(1, Math.ceil(sorted.length / BROWSE_PAGE_SIZE));
  const clamped = Math.min(Math.max(0, page), totalPages - 1);
  const slice = sorted.slice(clamped * BROWSE_PAGE_SIZE, (clamped + 1) * BROWSE_PAGE_SIZE);
  for (const s of slice) {
    const tier = s.tier ?? '—';
    kb.text(`${tier} · ${s.name}`, `store:${s.id}`).row();
  }
  if (totalPages > 1) {
    const prev = clamped > 0;
    const next = clamped < totalPages - 1;
    if (prev && next) {
      kb.text('← Prev', `store-page:${market}:${chain}:${clamped - 1}`)
        .text('Next →', `store-page:${market}:${chain}:${clamped + 1}`).row();
    } else if (prev) {
      kb.text('← Prev', `store-page:${market}:${chain}:${clamped - 1}`).row();
    } else if (next) {
      kb.text('Next →', `store-page:${market}:${chain}:${clamped + 1}`).row();
    }
  }
  kb.text('← Channels', `channel-back:${market}`).row();
  kb.text('Cancel', 'cancel').row();
  return kb;
}

export function buildCountrySearchResultsPicker(market: string, stores: Store[]): InlineKeyboard {
  const sorted = sortStoresByTier(stores);
  const kb = new InlineKeyboard();
  for (const s of sorted) {
    const tier = s.tier ?? '—';
    kb.text(`${tier} · ${s.name}`, `store:${s.id}`).row();
  }
  kb.text('← Channels', `channel-back:${market}`).row();
  kb.text('← Countries', 'country-back').row();
  kb.text('Cancel', 'cancel').row();
  return kb;
}

export function buildStaffPicker(
  staffList: Array<{ id: string; name: string; role: string | null; is_ally: boolean }>,
  selected: Set<string>,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const s of staffList) {
    const tick = selected.has(s.id) ? '✅ ' : '';
    const ally = s.is_ally ? ' ⭐' : '';
    kb.text(`${tick}${s.name}${ally}`, `staff:toggle:${s.id}`).row();
  }
  kb.text('+ Add new staff', 'staff:add').row();
  kb.text('Done', 'staff:done').row();
  return kb;
}
