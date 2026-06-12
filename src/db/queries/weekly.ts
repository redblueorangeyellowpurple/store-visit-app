import { supabase } from '../client.js';

// Recipients + report lookup for the Monday weekly broadcast. The weekly
// narrative itself lives in sva.weekly_reports (written by weekly-routine.md);
// the bot only needs to know a report exists and who opted into the weekly
// cadence (cms.is_weekly_recipient — mig 035), distinct from the daily brief.

export interface WeeklyRecipient {
  telegram_id: number;
  full_name: string;
}

export async function getWeeklyRecipients(): Promise<WeeklyRecipient[]> {
  const { data, error } = await supabase
    .from('cms')
    .select('telegram_id, full_name')
    .eq('is_weekly_recipient', true)
    .eq('is_active', true);
  if (error) {
    console.error('getWeeklyRecipients error:', error);
    return [];
  }
  return (data as WeeklyRecipient[]) ?? [];
}

export interface WeeklyReportRow {
  week_start: string;
  version: number;
}

// Latest version of the weekly report for a given Monday, or null if the
// routine hasn't written one yet (nothing to broadcast).
export async function getWeeklyReportForWeek(
  weekStart: string,
): Promise<WeeklyReportRow | null> {
  const { data, error } = await supabase
    .from('v_weekly_reports_current')
    .select('week_start, version')
    .eq('week_start', weekStart)
    .maybeSingle();
  if (error) {
    console.error('getWeeklyReportForWeek error:', error);
    return null;
  }
  return data as WeeklyReportRow | null;
}
