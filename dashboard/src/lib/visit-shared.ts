// Shared kernel for the store-visit detail panels.
// Pure types/constants/helpers used by both /visits (the Store Updates feed)
// and the dashboard's reused StoreDetailPanel/CMDetailPanel/StaffDetailPanel.
// Keep this React-free so it imports cleanly into any client component.

import { StoreVisitSummary, EngagedPersonItem, FollowUpItem, PhotoItem } from "@/lib/queries";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VisitRow {
  id: string;
  visit_date: string;
  cm_name: string;
  cm_telegram_id: number;
  store_id: string;
  store_name: string;
  store_chain: string;
  store_market: string;
  store_tier: "T1" | "T2" | "T3" | "T4" | null;
  good_news: string | null;
  competitors: string | null;
  display_stock: string | null;
  follow_up: string | null;
  buzz_plan: string | null;
  photo_count: number;
  photo_urls: string[];
  photos: PhotoItem[];
  edited_at: string | null;
  engagement_count: number;
  follow_up_count: number;
  engaged_people: EngagedPersonItem[];
  follow_up_items: FollowUpItem[];
}

// Which entity the right-hand detail panel is showing (null = nothing selected).
export type DetailView =
  | { type: "store"; storeId: string; storeName: string }
  | { type: "cm"; telegramId: number; name: string; market: string }
  | { type: "staff"; staffId: string; staffName: string; storeName: string }
  | null;

// ─── Section definitions ──────────────────────────────────────────────────────

export const SECTIONS = [
  { key: "good_news",     label: "Good News",         icon: "🌟", iconBg: "var(--color-section-amber-bg)",  color: "#92400E" },
  { key: "competitors",   label: "Competitors",        icon: "🔍", iconBg: "var(--color-section-blue-bg)",   color: "var(--color-tier-t1-fg)" },
  { key: "display_stock", label: "Display & Stock",    icon: "📦", iconBg: "var(--color-section-green-bg)",  color: "var(--color-tier-t2-fg)" },
  { key: "follow_up",     label: "Follow Up",          icon: "📌", iconBg: "var(--color-section-pink-bg)",   color: "#C0185A" },
  { key: "buzz_plan",     label: "Buzz Plan",          icon: "⚡", iconBg: "var(--color-section-purple-bg)", color: "#5B2DB5" },
  { key: "trainings",     label: "Engagements",        icon: "👥", iconBg: "var(--color-section-green-bg)",  color: "var(--color-tier-t2-fg)" },
  { key: "follow_ups",    label: "Follow-ups",         icon: "📌", iconBg: "var(--color-section-pink-bg)",   color: "#C0185A" },
] as const;

// Text-only sections (used for pills + section blocks, not trainings/follow_ups rows)
export const TEXT_SECTION_KEYS = ["good_news", "competitors", "display_stock", "follow_up", "buzz_plan"] as const;

export type SectionKey = typeof SECTIONS[number]["key"];

export const MARKET_FLAG: Record<string, string> = { SG: "🇸🇬", MY: "🇲🇾", TH: "🇹🇭", HK: "🇭🇰" };

export const TIER_STYLE: Record<string, { bg: string; color: string }> = {
  T1: { bg: "var(--color-tier-t1-bg)", color: "var(--color-tier-t1-fg)" },
  T2: { bg: "var(--color-tier-t2-bg)", color: "var(--color-tier-t2-fg)" },
  T3: { bg: "var(--color-tier-t3-bg)", color: "var(--color-tier-t3-fg)" },
  T4: { bg: "var(--color-tier-t4-bg)", color: "var(--color-tier-t4-fg)" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function fmtDateFull(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// Section icons present in a StoreVisitSummary (for the detail panel visit list)
export function storeSectionIcons(v: StoreVisitSummary): string {
  return TEXT_SECTION_KEYS
    .filter(k => !!v[k as keyof StoreVisitSummary])
    .map(k => SECTIONS.find(s => s.key === k)?.icon ?? "")
    .join(" ");
}
