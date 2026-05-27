import { supabase } from '../client.js';

export async function getSetting(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  if (error) {
    console.error('[settings] getSetting failed:', error);
    return null;
  }
  return data?.value ?? null;
}

export async function setSetting(
  key: string,
  value: string,
  updatedByTelegramId: number,
): Promise<boolean> {
  const { error } = await supabase
    .from('settings')
    .upsert(
      { key, value, updated_at: new Date().toISOString(), updated_by_telegram_id: updatedByTelegramId },
      { onConflict: 'key' },
    );
  if (error) {
    console.error('[settings] setSetting failed:', error);
    return false;
  }
  return true;
}

// ─── Intelligence kill switch ─────────────────────────────────────────────────
// When paused=true, every Claude call (cron + admin) refuses to spend tokens.
// Stored as JSON in the value column so we can carry reason + audit trail.

const KILL_SWITCH_KEY = 'intelligence_paused';

export interface IntelligencePauseState {
  paused: boolean;
  reason?: string;
  paused_by?: number;
  paused_at?: string;
}

export async function getIntelligencePauseState(): Promise<IntelligencePauseState> {
  const { data, error } = await supabase
    .from('settings')
    .select('value, updated_at, updated_by_telegram_id')
    .eq('key', KILL_SWITCH_KEY)
    .maybeSingle();
  if (error || !data) return { paused: false };
  let parsed: { paused?: boolean; reason?: string } = {};
  try {
    parsed = JSON.parse(data.value);
  } catch {
    // Legacy/manual edit — treat any non-empty value as paused
    parsed = { paused: data.value === 'true' };
  }
  return {
    paused: !!parsed.paused,
    reason: parsed.reason,
    paused_by: data.updated_by_telegram_id ?? undefined,
    paused_at: data.updated_at,
  };
}

export async function setIntelligencePaused(
  paused: boolean,
  byTelegramId: number,
  reason?: string,
): Promise<boolean> {
  const payload: { paused: boolean; reason?: string } = { paused };
  if (paused && reason) payload.reason = reason;
  return setSetting(KILL_SWITCH_KEY, JSON.stringify(payload), byTelegramId);
}
