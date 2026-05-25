import { supabase } from '../client.js';

export type Market = 'SG' | 'MY' | 'HK' | 'TH';
export type IntelligenceMode = 'people' | 'group' | 'both';

export interface AlertGroup {
  market: Market;
  chat_id: number | null;
  intelligence_mode: IntelligenceMode;
}

export async function getAlertGroup(market: Market): Promise<AlertGroup | null> {
  const { data, error } = await supabase
    .from('alert_groups')
    .select('market, chat_id, intelligence_mode')
    .eq('market', market)
    .maybeSingle();
  if (error) {
    console.error('[alert-groups] getAlertGroup failed:', error);
    return null;
  }
  return (data as AlertGroup | null) ?? null;
}

export async function listAlertGroups(): Promise<AlertGroup[]> {
  const { data, error } = await supabase
    .from('alert_groups')
    .select('market, chat_id, intelligence_mode')
    .order('market');
  if (error) {
    console.error('[alert-groups] listAlertGroups failed:', error);
    return [];
  }
  return (data as AlertGroup[]) ?? [];
}

export interface AlertGroupPatch {
  chat_id?: number | null;
  intelligence_mode?: IntelligenceMode;
}

export async function setAlertGroup(
  market: Market,
  patch: AlertGroupPatch,
  updatedByTelegramId: number,
): Promise<boolean> {
  const row = {
    ...patch,
    updated_at: new Date().toISOString(),
    updated_by_telegram_id: updatedByTelegramId,
  };
  const { error } = await supabase.from('alert_groups').update(row).eq('market', market);
  if (error) {
    console.error('[alert-groups] setAlertGroup failed:', error);
    return false;
  }
  return true;
}

export interface JoinRequestAdmin {
  telegram_id: number;
  full_name: string;
}

export async function getJoinRequestAdmins(): Promise<JoinRequestAdmin[]> {
  const { data, error } = await supabase
    .from('cms')
    .select('telegram_id, full_name')
    .eq('is_join_request_admin', true)
    .eq('is_active', true);
  if (error) {
    console.error('[alert-groups] getJoinRequestAdmins failed:', error);
    return [];
  }
  return (data as JoinRequestAdmin[]) ?? [];
}
