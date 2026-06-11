import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

// Every Supabase call (queries + storage) flows through this fetch. A stalled
// request on a slow/flaky network would otherwise wait forever and, inside a
// bot conversation, hold that CM's per-chat lock until the next redeploy.
// Bounding it here aborts the socket and surfaces an error instead, so the
// handler fails fast and the CM recovers on their own. 30s is well under the
// 60s webhook window and far above any healthy query.
const SUPABASE_TIMEOUT_MS = 30_000;
const timeoutFetch: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPABASE_TIMEOUT_MS);
  // Honour an upstream abort (e.g. a caller's own AbortSignal) too.
  if (init?.signal) init.signal.addEventListener('abort', () => controller.abort(), { once: true });
  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

export const supabase = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'sva' },
    global: { fetch: timeoutFetch },
  },
);

// Second client pinned to the shared `feedback` schema (the product-feedback
// dashboard's source of truth). Same project + service-role key — the key is
// cross-schema, so no new env var. Separate instance because supabase-js pins
// the schema per client and `supabase` above is locked to `sva`.
export const feedbackDb = createClient(
  config.supabase.url,
  config.supabase.serviceRoleKey,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: 'feedback' },
    global: { fetch: timeoutFetch },
  },
);
