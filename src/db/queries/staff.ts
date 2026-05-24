import { supabase } from '../client.js';

export interface Staff {
  id: string;
  name: string;
  role: string | null;
  store_id: string | null;
  phone: string | null;
  is_ally: boolean;
  ally_since: string | null;
  created_at: string;
}

export async function getStaffForStore(storeId: string): Promise<Staff[]> {
  const { data, error } = await supabase
    .from('staff')
    .select('*')
    .eq('store_id', storeId)
    .order('name');

  if (error || !data) return [];
  return data as Staff[];
}

export async function createStaff(data: {
  name: string;
  role?: string;
  store_id: string;
}): Promise<Staff | null> {
  const { data: row, error } = await supabase
    .from('staff')
    .insert(data)
    .select()
    .single();

  if (error) {
    console.error('createStaff error:', error);
    return null;
  }
  return row as Staff;
}

export async function setAllyStatus(
  staffId: string,
  isAlly: boolean,
): Promise<boolean> {
  const { error } = await supabase
    .from('staff')
    .update({
      is_ally: isAlly,
      ally_since: isAlly ? new Date().toISOString() : null,
    })
    .eq('id', staffId);

  if (error) {
    console.error('setAllyStatus error:', error);
    return false;
  }
  return true;
}

export async function attachStaffToVisit(
  visitId: string,
  staffIds: string[],
): Promise<void> {
  if (staffIds.length === 0) return;

  const rows = staffIds.map(staff_id => ({ visit_id: visitId, staff_id }));
  const { error } = await supabase.from('visit_staff').insert(rows);
  if (error) console.error('attachStaffToVisit error:', error);
}

export interface TrainedStaffEntry {
  staff_id: string;
  products: string;
}

export async function countTrainedStaff(visitId: string): Promise<number> {
  const { count, error } = await supabase
    .from('visit_staff')
    .select('staff_id', { count: 'exact', head: true })
    .eq('visit_id', visitId)
    .eq('was_trained', true);

  if (error) {
    console.error('countTrainedStaff error:', error);
    return 0;
  }
  return count ?? 0;
}

export async function attachTrainedStaffToVisit(
  visitId: string,
  entries: TrainedStaffEntry[],
): Promise<void> {
  if (entries.length === 0) return;

  // Delete any existing visit_staff rows for this visit (idempotent re-run safety)
  await supabase.from('visit_staff').delete().eq('visit_id', visitId);

  const rows = entries.map((e) => ({
    visit_id: visitId,
    staff_id: e.staff_id,
    was_trained: true,
    products_trained_on: e.products,
  }));
  const { error } = await supabase.from('visit_staff').insert(rows);
  if (error) console.error('attachTrainedStaffToVisit error:', error);
}
