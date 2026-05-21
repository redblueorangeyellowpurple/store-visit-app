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

export function buildSearchResultsPicker(stores: Store[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const store of stores) {
    kb.text(store.name, `store:${store.id}`).row();
  }
  kb.text('← Back', 'search:back').row();
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
