import { supabase } from '../client.js';

export interface Store {
  id: string;
  name: string;
  chain: string;
  market: 'SG' | 'TH' | 'MY' | 'HK';
  tier: 'T1' | 'T2' | 'T3' | 'T4' | null;
  address: string | null;
  is_active: boolean;
}

export async function getStoresForCM(telegramId: number): Promise<Store[]> {
  const { data, error } = await supabase
    .from('cm_store_assignments')
    .select('store_id, stores(*)')
    .eq('cm_telegram_id', telegramId)
    .eq('is_active', true);

  if (error || !data) return [];

  return data
    .map((row: any) => row.stores as Store)
    .filter((s: Store) => s?.is_active)
    .sort((a: Store, b: Store) => a.name.localeCompare(b.name));
}

export async function getStoreById(storeId: string): Promise<Store | null> {
  const { data, error } = await supabase
    .from('stores')
    .select('*')
    .eq('id', storeId)
    .single();

  if (error || !data) return null;
  return data as Store;
}

export async function searchStoresByName(market: string | null, term: string): Promise<Store[]> {
  let q = supabase
    .from('stores')
    .select('*')
    .eq('is_active', true)
    .ilike('name', `%${term}%`)
    .order('name')
    .limit(8);
  if (market !== null) q = q.eq('market', market);

  const { data, error } = await q;
  if (error || !data) return [];
  return data as Store[];
}

export async function getAllActiveStores(market: string | null): Promise<Store[]> {
  let q = supabase
    .from('stores')
    .select('*')
    .eq('is_active', true)
    .order('name');
  if (market !== null) q = q.eq('market', market);

  const { data, error } = await q;
  if (error || !data) return [];
  return data as Store[];
}
