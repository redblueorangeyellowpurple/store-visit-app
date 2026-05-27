import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import type {
  MemoryNote,
  MemoryNoteWrite,
  MemoryEdgeWrite,
  VisitForReport,
} from '../db/queries/intelligence.js';

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.anthropic.apiKey ?? '' });
  return client;
}

// ─── Model + budget ───────────────────────────────────────────────────────────

const MODEL = 'claude-sonnet-4-6';
// 4000 keeps two back-to-back calls under the Tier-1 8K-output-tokens-per-minute
// rate limit. Raise if/when Anthropic tier is upgraded. Combined with the prompt
// constraints (≤5 note updates, ≤200-token bodies, ≤3 signals per pillar),
// real output typically lands at 2500–3500 tokens.
const MAX_OUTPUT_TOKENS = 4000;

// Sonnet 4 pricing — keep in sync with https://www.anthropic.com/pricing
const PRICE_INPUT_PER_M = 3.0;
const PRICE_OUTPUT_PER_M = 15.0;
const PRICE_CACHE_WRITE_PER_M = 3.75; // 1.25× input
const PRICE_CACHE_READ_PER_M = 0.30; // 0.1× input

export function estimateCostUsd(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}): number {
  const inUncached = usage.input_tokens; // SDK already excludes cached from this
  const inCacheWrite = usage.cache_creation_input_tokens ?? 0;
  const inCacheRead = usage.cache_read_input_tokens ?? 0;
  return (
    (inUncached * PRICE_INPUT_PER_M) / 1_000_000 +
    (inCacheWrite * PRICE_CACHE_WRITE_PER_M) / 1_000_000 +
    (inCacheRead * PRICE_CACHE_READ_PER_M) / 1_000_000 +
    (usage.output_tokens * PRICE_OUTPUT_PER_M) / 1_000_000
  );
}

// ─── Result shape ─────────────────────────────────────────────────────────────

export interface IntelligenceRunResult {
  /** Full markdown brief — lives on the dashboard, organized by 4 pillars. */
  brief_markdown: string;
  /** Compact plain-text version for Telegram (one message, no markdown). */
  telegram_summary: string;
  note_updates: MemoryNoteWrite[];
  edges: MemoryEdgeWrite[];
  stats: {
    themes_active: number;
    themes_promoted: string[];
    notes_touched: number;
    new_notes: string[];
  };
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
}

// ─── Prompt construction ──────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the intelligence layer for TC Acoustic's Store Visit App.
You run daily, reading today's locked store visits plus accumulated memory from prior days.

Your job: produce TWO outputs in one pass.
  1. A daily intelligence brief for AMs / Head of Sales — scannable, point-form, table-friendly, names quoted verbatim.
  2. Updated atomic memory notes (per store, per recurring person, per cross-store theme) + typed edges between them.

INTELLIGENCE, NOT ACTION. No recommendations. No "should." Surface patterns; let the reader decide.

OUTPUT FORMAT: You MUST call the submit_intelligence_run tool exactly once. Do not output any text — call the tool with the full result.`;

// JSON schema for the structured-output tool. Anthropic validates the tool call,
// so we get a parsed object back instead of fragile text-JSON.
const SUBMIT_TOOL = {
  name: 'submit_intelligence_run',
  description: 'Submit the daily intelligence brief and memory updates as a single structured payload.',
  input_schema: {
    type: 'object' as const,
    properties: {
      brief_markdown: {
        type: 'string',
        description: 'Full daily brief in markdown (lives on dashboard) — follow the BRIEF FORMAT in the user message exactly. Organized around 4 pillars: People, Training, Competitor, Market/Store.',
      },
      telegram_summary: {
        type: 'string',
        description:
          'Compact ONE-MESSAGE plain-text summary for Telegram. ≤900 chars. NO markdown (no **bold**, no #headers, no tables). Format: header line, blank line, "Visited:" with • prefixed CM list, blank line, "Today\'s signal:" with one bullet per pillar that has a real signal — prefix each with its pillar emoji (👥 People, 🎓 Training, ⚔️ Competitor, 🏬 Market). Skip pillars with no signal entirely. If >7 stores visited, show first 5 + "+N more on dashboard".',
      },
      note_updates: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            slug: { type: 'string' },
            scope: { type: 'string', enum: ['store', 'person', 'theme', 'channel'] },
            scope_ref: { type: 'string' },
            title: { type: 'string' },
            summary: { type: 'string' },
            body_markdown: { type: 'string' },
            related_slugs: { type: 'array', items: { type: 'string' } },
          },
          required: ['slug', 'scope', 'scope_ref', 'title', 'summary', 'body_markdown', 'related_slugs'],
        },
      },
      edges: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from_slug: { type: 'string' },
            to_slug: { type: 'string' },
            edge_type: {
              type: 'string',
              enum: ['store_theme', 'person_store', 'person_theme', 'theme_theme'],
            },
          },
          required: ['from_slug', 'to_slug', 'edge_type'],
        },
      },
      stats: {
        type: 'object',
        properties: {
          themes_active: { type: 'integer' },
          themes_promoted: { type: 'array', items: { type: 'string' } },
          notes_touched: { type: 'integer' },
          new_notes: { type: 'array', items: { type: 'string' } },
        },
        required: ['themes_active', 'themes_promoted', 'notes_touched', 'new_notes'],
      },
    },
    required: ['brief_markdown', 'telegram_summary', 'note_updates', 'edges', 'stats'],
  },
};

function buildVisitBlock(visits: VisitForReport[]): string {
  return visits
    .map((v, idx) => {
      const sections = [
        v.good_news && `1. Good News:\n${v.good_news}`,
        v.competitors && `2. Competitors:\n${v.competitors}`,
        v.display_stock && `3. Display & Stock:\n${v.display_stock}`,
        v.follow_up && `4. Follow Up:\n${v.follow_up}`,
        v.buzz_plan && `5. Buzz Plan:\n${v.buzz_plan}`,
        v.training && `6. Training:\n${v.training}`,
      ]
        .filter(Boolean)
        .join('\n\n');
      return `### Visit ${idx + 1}
Store: ${v.store_name} (store_id=${v.store_id})
CM: ${v.cm_full_name}
Locked at: ${v.locked_at}

${sections || '(no notes)'}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Filter accumulated memory to only the notes this run actually needs:
 *   - store notes for stores visited today (we may update them)
 *   - all theme / person / channel notes (cross-store — always relevant context)
 * Drops store notes for stores not visited today — they aren't being analyzed
 * this run, so their bodies don't earn their token cost.
 */
export function filterRelevantNotes(
  notes: MemoryNote[],
  visits: VisitForReport[],
): MemoryNote[] {
  const todayStoreIds = new Set(visits.map((v) => v.store_id));
  return notes.filter((n) => {
    if (n.scope === 'store') return todayStoreIds.has(n.scope_ref);
    return true;
  });
}

function buildMemoryBlock(notes: MemoryNote[]): string {
  if (notes.length === 0) return '(no relevant memory yet)';

  // Just full bodies — no separate index. The model sees the slug + scope inline.
  return notes
    .map(
      (n) =>
        `### ${n.slug} (${n.scope})
${n.body_markdown}
Related: ${n.related_slugs.join(', ') || '(none)'}
Last touched: ${n.last_touched_at}`,
    )
    .join('\n\n---\n\n');
}

const USER_INSTRUCTIONS = `Call submit_intelligence_run with brief_markdown, telegram_summary, note_updates, edges, and stats.

Slug conventions:
- store: "store:<store_id>"
- person: "person:<slug>"
- theme:  "theme:<slug>"
- channel:"channel:<slug>"

scope_ref = store_id for store notes, the slug body for everything else.
Each note body_markdown ≤ ~300 tokens; decay items >30d unless still active.

### FOUR PILLARS (same taxonomy used by brief, telegram_summary, and memory)

- 👥 People — relationships, good news, sales opportunities, staff dynamics, allies, customer reactions.
- 🎓 Training — who was trained, training quality, knowledge gaps, requests for more training.
- ⚔️ Competitor — rival activity (Bose, Sony, Samsung, JBL, Marshall), launches, pricing, share-of-shelf, promoter strength.
- 🏬 Market / Store — display quality, stock issues, channel-level trends, store performance signals.

A pillar section appears in the output ONLY if today's visits produced a real signal for it. Empty pillars are skipped, not stubbed.

### BRIEF FORMAT (markdown — goes in brief_markdown, rendered on dashboard)

# 📍 Daily Intelligence Brief — <date>

## 🚶 Visited today

| Store | CM |
|---|---|
| <store name> | <CM full name> |
| ... | ... |

<N visits · M CMs · K outlets>

## 👥 People
- <signal>
- <signal>

## 🎓 Training
- <signal>

## ⚔️ Competitor
- <signal>

## 🏬 Market & Store
- <signal>

## 🧵 Threads
- <theme name> — <Nth visit / M days>, <what's new>

(Skip any pillar section that has no real signal today. Threads only if 2+ visits across stores support a theme.)

### TELEGRAM_SUMMARY FORMAT (plain text, no markdown, one message ≤900 chars)

📍 Intel — <date, e.g. Mon 26 May 2026>
<N visits · M stores · K CMs>

Visited:
• <Store> — <CM>
• <Store> — <CM>
(If >7 stores: show first 5 + "+<N> more on dashboard")

Today's signal:
👥 <one-line people signal>
🎓 <one-line training signal>
⚔️ <one-line competitor signal>
🏬 <one-line market signal>

(Skip any pillar that has no signal — do not stub with "—" or "none today". Drop the line entirely.)

### RULES
- Quote staff / store / product / brand names verbatim. Never "a CM" or "a competitor."
- Lean. Bullets, no paragraphs. Skip empty sections entirely (don't stub).
- No recommendations. No "should." Pure intelligence.
- A pattern needs 2+ visits to be called a pattern. One-offs live in their store note, not the brief.
- Decay: drop items >30d from store/person memory bodies unless still active.
- Max 3 bullets per pillar in the brief. Pick the highest-signal ones; everything else lives in memory.

### MEMORY RULES
- Every store visited today gets its note updated (or created if absent).
- Person notes ONLY for people mentioned 2+ times across the portfolio. One-offs stay in store notes.
- Theme notes ONLY when 2+ visits across stores support it.
- Each note body_markdown: HARD CAP 200 tokens. Decay old context, keep load-bearing context.
- Max 8 total note_updates per run (prioritize stores visited today, then people/theme touches). If you'd exceed, merge or skip — never split a note across runs.
- related_slugs is the source of edges — make them bidirectional in your head (cron will dedupe).
`;

// ─── Run ──────────────────────────────────────────────────────────────────────

/**
 * Outcome from a Claude run. Callers must check `ok` before accessing `result`.
 * On `ok=false`, `reason` is human-readable and surfaces in admin replies,
 * and `partial_cost_usd` carries any tokens we were billed for before the failure.
 */
export type IntelligenceRunOutcome =
  | { ok: true; result: IntelligenceRunResult }
  | { ok: false; reason: string; partial_cost_usd?: number };

export async function runDailyIntelligence(args: {
  reportDate: string;
  visits: VisitForReport[];
  notes: MemoryNote[];
}): Promise<IntelligenceRunOutcome> {
  if (!config.anthropic.apiKey) {
    return { ok: false, reason: 'ANTHROPIC_API_KEY not set on bot service' };
  }
  if (args.visits.length === 0) {
    return { ok: false, reason: `no locked visits for ${args.reportDate}` };
  }

  // Lean prompt: only memory notes that today actually touches.
  const relevantNotes = filterRelevantNotes(args.notes, args.visits);

  const userMessage = `## Report date
${args.reportDate}

## Today's visits (locked & unanalyzed)
${buildVisitBlock(args.visits)}

## Memory state going in (filtered to today's scope)
${buildMemoryBlock(relevantNotes)}

---

${USER_INSTRUCTIONS}`;

  // Pre-flight diagnostic — char count is a rough proxy for token count (~3.5 chars/token).
  const promptChars = userMessage.length + SYSTEM_PROMPT.length;
  const estTokens = Math.round(promptChars / 3.5);
  console.log(
    `runDailyIntelligence: prompt ~${promptChars} chars (~${estTokens} tokens) · ${args.visits.length} visits · ${relevantNotes.length} memory notes loaded`,
  );

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      // cache_control on system + last tool = ~90% input discount on repeat runs
      // within 5 min (debug retries, back-to-back cron in dev, etc).
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [{ ...SUBMIT_TOOL, cache_control: { type: 'ephemeral' } }],
      tool_choice: { type: 'tool', name: SUBMIT_TOOL.name },
      messages: [{ role: 'user', content: userMessage }],
    });

    const usage = response.usage;
    const cost_usd = estimateCostUsd({
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
      cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: usage?.cache_read_input_tokens ?? 0,
    });

    if (response.stop_reason === 'max_tokens') {
      return {
        ok: false,
        reason: `hit ${MAX_OUTPUT_TOKENS}-token output cap — Claude couldn't finish the tool call. Trim memory or raise MAX_OUTPUT_TOKENS.`,
        partial_cost_usd: cost_usd,
      };
    }

    const toolUse = response.content.find(
      (b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use',
    );
    if (!toolUse || toolUse.name !== SUBMIT_TOOL.name) {
      return {
        ok: false,
        reason: `Claude returned text instead of calling submit_intelligence_run (stop_reason: ${response.stop_reason ?? 'unknown'})`,
        partial_cost_usd: cost_usd,
      };
    }

    const parsed = toolUse.input as Partial<IntelligenceRunResult>;

    return {
      ok: true,
      result: {
        brief_markdown: parsed.brief_markdown ?? '',
        telegram_summary: parsed.telegram_summary ?? '',
        note_updates: parsed.note_updates ?? [],
        edges: parsed.edges ?? [],
        stats: parsed.stats ?? {
          themes_active: 0,
          themes_promoted: [],
          notes_touched: 0,
          new_notes: [],
        },
        model: MODEL,
        prompt_tokens: usage?.input_tokens ?? 0,
        completion_tokens: usage?.output_tokens ?? 0,
        cache_read_tokens: usage?.cache_read_input_tokens ?? 0,
        cache_creation_tokens: usage?.cache_creation_input_tokens ?? 0,
        cost_usd,
      },
    };
  } catch (err) {
    console.error('runDailyIntelligence error:', err);
    // Rate-limit errors carry exact retry timing in the headers — surface that so
    // the operator knows to wait, not to keep retrying (every retry within the
    // window also 429s; some still cost partial output billing).
    if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 429) {
      const headers = ((err as unknown as { headers?: Record<string, string> }).headers) ?? {};
      const retryAfter = headers['retry-after'] ?? '60';
      const reset = headers['anthropic-ratelimit-output-tokens-reset'];
      const resetSuffix = reset ? ` (reset ${reset})` : '';
      return {
        ok: false,
        reason:
          `Anthropic rate limit hit — 8K output-tokens-per-minute cap (Tier 1). ` +
          `Wait ${retryAfter}s before retrying${resetSuffix}. ` +
          `To raise the limit, upgrade tier at console.anthropic.com/settings/billing.`,
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `Anthropic API error: ${msg}` };
  }
}

// ─── Validation guard ─────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  warnings: string[];
  reason?: string;
}

export function validateRunResult(
  result: IntelligenceRunResult,
  context: { previousNotes: MemoryNote[]; visits: VisitForReport[] },
): ValidationResult {
  const warnings: string[] = [];

  if (!result.brief_markdown || result.brief_markdown.length < 50) {
    return { ok: false, warnings, reason: 'brief_markdown empty or too short' };
  }
  if (!result.telegram_summary || result.telegram_summary.length < 30) {
    return { ok: false, warnings, reason: 'telegram_summary empty or too short' };
  }
  if (result.telegram_summary.length > 1200) {
    warnings.push(
      `telegram_summary is ${result.telegram_summary.length} chars (target ≤900) — may exceed one Telegram message`,
    );
  }

  // Brief must mention at least one store visited today (no hallucination check)
  const todayStoreNames = context.visits.map((v) => v.store_name.toLowerCase());
  const briefLower = result.brief_markdown.toLowerCase();
  const mentionsAnyStore = todayStoreNames.some((s) =>
    briefLower.includes(s.toLowerCase()),
  );
  if (!mentionsAnyStore && todayStoreNames.length > 0) {
    return {
      ok: false,
      warnings,
      reason: 'brief mentions no store from today\'s visits — likely hallucination',
    };
  }

  // Memory size sanity check: if a note's body shrank by >60% vs previous, flag
  const prevBySlug = new Map(context.previousNotes.map((n) => [n.slug, n]));
  for (const upd of result.note_updates) {
    const prev = prevBySlug.get(upd.slug);
    if (prev) {
      const ratio = upd.body_markdown.length / Math.max(prev.body_markdown.length, 1);
      if (ratio < 0.4) {
        warnings.push(
          `note ${upd.slug} body shrank to ${(ratio * 100).toFixed(0)}% of previous — possible drift`,
        );
      }
    }
  }

  // Edge sanity: every from_slug / to_slug should appear in note_updates or previous notes
  const knownSlugs = new Set<string>([
    ...result.note_updates.map((n) => n.slug),
    ...context.previousNotes.map((n) => n.slug),
  ]);
  for (const edge of result.edges) {
    if (!knownSlugs.has(edge.from_slug)) {
      warnings.push(`edge from_slug ${edge.from_slug} not in note set`);
    }
    if (!knownSlugs.has(edge.to_slug)) {
      warnings.push(`edge to_slug ${edge.to_slug} not in note set`);
    }
  }

  return { ok: true, warnings };
}
