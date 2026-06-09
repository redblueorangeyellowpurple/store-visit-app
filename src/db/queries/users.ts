import { supabase } from '../client.js';

export interface User {
  id: string;
  telegram_chat_id: number | null;
  full_name: string;
  email: string | null;
  role: 'cm' | 'cmic' | 'am' | 'admin';
  market: 'SG' | 'MY' | 'TH' | 'HK';
  is_active: boolean;
}

export async function getUserByTelegramId(chatId: number): Promise<User | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('telegram_chat_id', chatId)
    .eq('is_active', true)
    .single();

  if (error) console.error('[auth] supabase error:', error.message);
  if (!data) console.error('[auth] no user for chatId:', chatId);
  if (error || !data) return null;
  return data as User;
}

export async function getAllUsers(): Promise<User[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('is_active', true)
    .order('full_name');

  if (error || !data) return [];
  return data as User[];
}

export async function createUser(data: {
  telegram_chat_id: number;
  full_name: string;
  email?: string;
  role: User['role'];
  market: User['market'];
}): Promise<User | null> {
  const { data: row, error } = await supabase
    .from('users')
    .insert(data)
    .select()
    .single();

  if (error) {
    console.error('createUser error:', error);
    return null;
  }
  return row as User;
}

export async function assignStoreToCm(
  cmId: string,
  storeId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from('cm_store_assignments')
    .upsert({ user_id: cmId, store_id: storeId, is_active: true });

  if (error) {
    console.error('assignStore error:', error);
    return false;
  }
  return true;
}
