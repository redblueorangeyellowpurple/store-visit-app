import { supabase } from "./supabase";

// Dashboard-side mirror of the bot's recap builder (src/db/queries/recap.ts +
// src/notifications/daily-recap.ts), so the Admin "Send test" button can render
// and send a recap via the Telegram API directly — without round-tripping the
// bot process. Keep the format in lockstep with the bot's daily-recap.ts.

interface RecapData {
  visitedStores: string[];
  engagementCount: number;
  trainedCount: number;
  plannedExecuted: string[];
  plannedMissed: string[];
  walkIns: string[];
  openFollowUps: { title: string; store: string; due: string | null }[];
  followUpOpenTotal: number;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FU_LIMIT = 5;

function escapeMd(s: string): string {
  return s.replace(/([_*`\[])/g, "\\$1");
}
function prettyDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${DOW[dt.getUTCDay()]}, ${d} ${MON[m - 1]}`;
}
function addDaysISO(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function dueLabel(due: string | null, todayISO: string): string {
  if (!due) return "";
  if (due < todayISO) return " · ⚠️ overdue";
  if (due === todayISO) return " · due today";
  return ` · due ${prettyDate(due)}`;
}
function storeLabel(s: { name: string | null; chain: string | null } | undefined): string {
  const name = s?.name ?? "a store";
  return s?.chain ? `${name} @ ${s.chain}` : name;
}

async function getCMDailyRecap(telegramId: number, date: string): Promise<RecapData | null> {
  const start = `${date}T00:00:00+08:00`;
  const end = `${date}T23:59:59.999+08:00`;

  const [visitsRes, plansRes, fuRes] = await Promise.all([
    supabase
      .from("visits")
      .select("id, store_id")
      .eq("cm_telegram_id", telegramId)
      .eq("is_locked", true)
      .gte("locked_at", start)
      .lte("locked_at", end),
    supabase.from("visit_plans").select("store_id").eq("cm_telegram_id", telegramId).eq("planned_date", date),
    supabase
      .from("visit_follow_ups")
      .select("title, due_date, store_id")
      .eq("cm_telegram_id", telegramId)
      .eq("status", "open")
      .order("due_date", { ascending: true, nullsFirst: false }),
  ]);

  if (visitsRes.error) {
    console.error("[recap] visits query failed:", visitsRes.error);
    return null;
  }

  const visits = (visitsRes.data ?? []) as { id: string; store_id: string }[];
  const plans = (plansRes.data ?? []) as { store_id: string }[];
  const fus = (fuRes.data ?? []) as { title: string; due_date: string | null; store_id: string }[];

  const storeIds = Array.from(
    new Set([...visits, ...plans, ...fus].map((r) => r.store_id).filter(Boolean)),
  );
  const storeMap = new Map<string, { name: string | null; chain: string | null }>();
  if (storeIds.length > 0) {
    const { data: storeRows } = await supabase.from("stores").select("id, name, chain").in("id", storeIds);
    for (const s of (storeRows ?? []) as { id: string; name: string | null; chain: string | null }[]) {
      storeMap.set(s.id, { name: s.name, chain: s.chain });
    }
  }

  let engagementCount = 0;
  let trainedCount = 0;
  const visitIds = visits.map((v) => v.id);
  if (visitIds.length > 0) {
    const { data: staffRows } = await supabase.from("visit_staff").select("was_trained").in("visit_id", visitIds);
    const rows = (staffRows ?? []) as { was_trained: boolean | null }[];
    engagementCount = rows.length;
    trainedCount = rows.filter((r) => r.was_trained).length;
  }

  const visitedIds = new Set(visits.map((v) => v.store_id));
  const plannedIds = new Set(plans.map((p) => p.store_id));
  const label = (id: string) => storeLabel(storeMap.get(id));

  return {
    visitedStores: [...visitedIds].map(label),
    engagementCount,
    trainedCount,
    plannedExecuted: [...plannedIds].filter((id) => visitedIds.has(id)).map(label),
    plannedMissed: [...plannedIds].filter((id) => !visitedIds.has(id)).map(label),
    walkIns: [...visitedIds].filter((id) => !plannedIds.has(id)).map(label),
    openFollowUps: fus.map((f) => ({ title: f.title, store: label(f.store_id), due: f.due_date })),
    followUpOpenTotal: fus.length,
  };
}

function isRecapEmpty(d: RecapData): boolean {
  return d.visitedStores.length === 0 && d.plannedMissed.length === 0 && d.followUpOpenTotal === 0;
}

function buildRecapMessage(name: string, date: string, d: RecapData): string {
  const todayISO = addDaysISO(date, 1);
  const lines: string[] = [];
  lines.push(`☀️ *Morning, ${escapeMd(name)}!* Your yesterday — ${prettyDate(date)}`);

  lines.push("");
  if (d.visitedStores.length > 0) {
    lines.push(`🏬 *Stores visited: ${d.visitedStores.length}*`);
    for (const s of d.visitedStores) lines.push(`• ${escapeMd(s)}`);
  } else {
    lines.push("🏬 *No store visits logged yesterday.*");
  }

  if (d.engagementCount > 0) {
    const ppl = `${d.engagementCount} ${d.engagementCount === 1 ? "person" : "people"}`;
    const trained = d.trainedCount > 0 ? ` (${d.trainedCount} trained)` : "";
    lines.push("");
    lines.push(`👥 *Engagements: ${ppl}*${trained}`);
  }

  if (d.plannedExecuted.length || d.plannedMissed.length || d.walkIns.length) {
    lines.push("");
    lines.push("📋 *Planned vs done*");
    for (const s of d.plannedExecuted) lines.push(`✓ ${escapeMd(s)}`);
    for (const s of d.walkIns) lines.push(`＋ ${escapeMd(s)} _(walk-in)_`);
    for (const s of d.plannedMissed) lines.push(`✗ ${escapeMd(s)} _(planned, missed)_`);
  }

  if (d.followUpOpenTotal > 0) {
    lines.push("");
    lines.push(`📌 *Open follow-ups: ${d.followUpOpenTotal}*`);
    for (const f of d.openFollowUps.slice(0, FU_LIMIT)) {
      lines.push(`• ${escapeMd(f.title)} · ${escapeMd(f.store)}${dueLabel(f.due, todayISO)}`);
    }
    if (d.followUpOpenTotal > FU_LIMIT) lines.push(`_+${d.followUpOpenTotal - FU_LIMIT} more_`);
  }

  lines.push("");
  lines.push("Have a great one 💪");
  return lines.join("\n");
}

// Build a recap for `dataForTelegramId` and return the Markdown message + whether
// it's an empty day. Returns null on a hard query error.
export async function buildTestRecap(
  dataForTelegramId: number,
  name: string,
  date: string,
): Promise<{ message: string; empty: boolean } | null> {
  const data = await getCMDailyRecap(dataForTelegramId, date);
  if (!data) return null;
  return {
    message: "🧪 *Test recap* — only you can see this.\n\n" + buildRecapMessage(name, date, data),
    empty: isRecapEmpty(data),
  };
}
