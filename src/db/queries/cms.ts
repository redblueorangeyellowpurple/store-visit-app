import { supabase } from '../client.js';

export interface CM {
  telegram_id: number;
  full_name: string;
  nickname: string | null;
  role: 'cm' | 'cmic' | 'am' | 'admin';
  market: 'SG' | 'TH' | 'MY' | 'HK';
  am_telegram_id: number | null;
  is_active: boolean;
  pending_request_at: string | null;
}

export interface PendingCM {
  telegram_id: number;
  full_name: string;
  pending_request_at: string;
}

export async function getCMByTelegramId(telegramId: number): Promise<CM | null> {
  const { data, error } = await supabase
    .from('cms')
    .select('*')
    .eq('telegram_id', telegramId)
    .eq('is_active', true)
    .single();

  if (error) console.error('[auth] supabase error:', error.message);
  if (!data) console.error('[auth] no CM for telegramId:', telegramId);
  if (error || !data) return null;
  return data as CM;
}

export async function getAllCMs(market?: string): Promise<CM[]> {
  let query = supabase.from('cms').select('*').eq('is_active', true).order('full_name');
  if (market) query = query.eq('market', market);
  const { data, error } = await query;
  if (error || !data) return [];
  return data as CM[];
}

export async function createCM(data: {
  telegram_id: number;
  full_name: string;
  role: CM['role'];
  market: CM['market'];
  am_telegram_id?: number;
}): Promise<CM | null> {
  const { data: row, error } = await supabase
    .from('cms')
    .upsert(data, { onConflict: 'telegram_id' })
    .select()
    .single();

  if (error) {
    console.error('createCM error:', error);
    return null;
  }
  return row as CM;
}

export async function updateNickname(telegramId: number, nickname: string): Promise<boolean> {
  const { error } = await supabase
    .from('cms')
    .update({ nickname })
    .eq('telegram_id', telegramId);

  if (error) {
    console.error('updateNickname error:', error);
    return false;
  }
  return true;
}

export async function deactivateCM(telegramId: number): Promise<boolean> {
  const { error } = await supabase
    .from('cms')
    .update({ is_active: false })
    .eq('telegram_id', telegramId);

  if (error) {
    console.error('deactivateCM error:', error);
    return false;
  }
  return true;
}

export async function getCMRecord(telegramId: number): Promise<CM | null> {
  // Returns the row regardless of is_active — used for join-request lookups.
  const { data, error } = await supabase
    .from('cms')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (error || !data) return null;
  return data as CM;
}

export async function createPendingCM(data: {
  telegram_id: number;
  full_name: string;
}): Promise<boolean> {
  // Use a default market (SG) — admin will overwrite on approval. The check
  // constraint requires a non-null value, so we can't leave it null.
  const { error } = await supabase
    .from('cms')
    .upsert(
      {
        telegram_id: data.telegram_id,
        full_name: data.full_name,
        role: 'cm',
        market: 'SG',
        is_active: false,
        pending_request_at: new Date().toISOString(),
      },
      { onConflict: 'telegram_id' },
    );
  if (error) {
    console.error('createPendingCM error:', error);
    return false;
  }
  return true;
}

export async function approvePendingCM(
  telegramId: number,
  market: CM['market'],
  role: CM['role'] = 'cm',
): Promise<CM | null> {
  const { data, error } = await supabase
    .from('cms')
    .update({
      is_active: true,
      market,
      role,
      pending_request_at: null,
    })
    .eq('telegram_id', telegramId)
    .select()
    .single();
  if (error) {
    console.error('approvePendingCM error:', error);
    return null;
  }
  return data as CM;
}

export async function rejectPendingCM(telegramId: number): Promise<boolean> {
  // Only delete rows that are still pending — never wipe an active CM.
  const { error } = await supabase
    .from('cms')
    .delete()
    .eq('telegram_id', telegramId)
    .eq('is_active', false)
    .not('pending_request_at', 'is', null);
  if (error) {
    console.error('rejectPendingCM error:', error);
    return false;
  }
  return true;
}

export async function getPendingCMs(): Promise<PendingCM[]> {
  const { data, error } = await supabase
    .from('cms')
    .select('telegram_id, full_name, pending_request_at')
    .eq('is_active', false)
    .not('pending_request_at', 'is', null)
    .order('pending_request_at', { ascending: false });
  if (error || !data) return [];
  return data as PendingCM[];
}

export async function assignStoreToCM(
  cmTelegramId: number,
  storeId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('cm_store_assignments')
    .upsert({ cm_telegram_id: cmTelegramId, store_id: storeId, is_active: true });

  if (error) {
    console.error('assignStoreToCM error:', error);
    return false;
  }
  return true;
}
