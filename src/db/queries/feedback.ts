import { feedbackDb } from '../client.js';

// This bot logs feedback for the Store Visit App product. The dashboard keys
// products by this slug (feedback.products.key).
const PRODUCT_KEY = 'sva';

export interface FeedbackInput {
  body: string;
  submitterName?: string | null;
  submitterTgId?: number | null;
}

interface SubmissionRow {
  product_id: string;
  source: string;
  submitter_name: string | null;
  submitter_tg_id: number | null;
  body: string;
  item_date: string;
}

// Today's date in SGT (UTC+8) as YYYY-MM-DD — matches how the dashboard groups
// the feedback firehose. Shifting the epoch by +8h then slicing the ISO date
// avoids a late-night submission landing on the previous UTC day.
function todaySGT(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Pure: maps the captured input to a `feedback.submissions` insert row. status,
// cleared, sort, type and priority are left to the table defaults / dashboard
// triage (Wilson classifies type + priority there).
export function buildSubmissionRow(productId: string, input: FeedbackInput): SubmissionRow {
  return {
    product_id: productId,
    source: 'telegram',
    submitter_name: input.submitterName?.trim() || null,
    submitter_tg_id: input.submitterTgId ?? null,
    body: input.body.trim(),
    item_date: todaySGT(),
  };
}

// Resolve + cache the product UUID once per process. The product row is seeded
// and never changes, so a single lookup is enough.
let cachedProductId: string | null = null;
async function getProductId(): Promise<string> {
  if (cachedProductId) return cachedProductId;
  const { data, error } = await feedbackDb
    .from('products')
    .select('id')
    .eq('key', PRODUCT_KEY)
    .single();
  if (error || !data) {
    throw new Error(`feedback product '${PRODUCT_KEY}' not found: ${error?.message ?? 'no row'}`);
  }
  cachedProductId = data.id as string;
  return cachedProductId;
}

// Insert one feedback submission. Returns true on success; logs + returns false
// on failure so the caller can show a friendly retry message.
export async function logFeedback(input: FeedbackInput): Promise<boolean> {
  try {
    const productId = await getProductId();
    const { error } = await feedbackDb.from('submissions').insert(buildSubmissionRow(productId, input));
    if (error) {
      console.error('[feedback] insert failed:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[feedback] logFeedback error:', err instanceof Error ? err.message : err);
    return false;
  }
}
