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

export interface VisitEngagementTrainingItem {
  product_name: string;
  response: string | null;
}
export interface VisitEngagedPersonItem {
  name: string;
  update_text: string | null;
  trainings: VisitEngagementTrainingItem[];
}

// Bot-side reader for the new engagement model (mig 021). Mirrors the mini app's
// engaged_people: all people on the visit (known staff or free-typed), each with
// a free-text update + trainings. Falls back to the old products CSV for legacy/
// bot rows that have no engagement_trainings child rows yet.
export async function getVisitEngagements(visitId: string): Promise<VisitEngagedPersonItem[]> {
  const { data: vsRows, error } = await supabase
    .from('visit_staff')
    .select('id, person_name, update_text, products_trained_on, training_response, staff(name)')
    .eq('visit_id', visitId);
  if (error || !vsRows) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = vsRows as any[];
  const ids = rows.map((r) => r.id as string);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let etRows: any[] = [];
  if (ids.length > 0) {
    const { data } = await supabase
      .from('engagement_trainings')
      .select('visit_staff_id, product_name, response')
      .in('visit_staff_id', ids);
    etRows = data ?? [];
  }
  const byPerson = new Map<string, VisitEngagementTrainingItem[]>();
  for (const t of etRows) {
    const arr = byPerson.get(t.visit_staff_id as string) ?? [];
    arr.push({ product_name: t.product_name as string, response: (t.response as string | null) ?? null });
    byPerson.set(t.visit_staff_id as string, arr);
  }

  return rows
    .map((r) => {
      const name = (r.person_name as string | null) ?? (r.staff?.name as string | null) ?? 'Unknown';
      let trainings = byPerson.get(r.id as string) ?? [];
      if (trainings.length === 0 && r.products_trained_on) {
        trainings = String(r.products_trained_on)
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map((p) => ({ product_name: p, response: null }));
      }
      return {
        name,
        update_text: (r.update_text as string | null) ?? (r.training_response as string | null) ?? null,
        trainings,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
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
