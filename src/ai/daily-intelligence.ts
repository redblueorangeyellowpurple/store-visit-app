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
const MAX_OUTPUT_TOKENS = 8000;

// ─── Result shape ─────────────────────────────────────────────────────────────

export interface IntelligenceRunResult {
  brief_markdown: string;
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
        description: 'Full daily brief in markdown — follow the BRIEF FORMAT in the user message exactly.',
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
    required: ['brief_markdown', 'note_updates', 'edges', 'stats'],
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

function buildMemoryBlock(notes: MemoryNote[]): string {
  if (notes.length === 0) return '(no memory yet — this is the first run)';

  const summaries = notes
    .map((n) => `- [${n.slug}] (${n.tier ?? 'short'}) — ${n.summary}`)
    .join('\n');

  const shortFull = notes
    .filter((n) => n.tier === 'short' || !n.tier)
    .map(
      (n) =>
        `### ${n.slug}
${n.body_markdown}
Related: ${n.related_slugs.join(', ') || '(none)'}
Last touched: ${n.last_touched_at}`,
    )
    .join('\n\n---\n\n');

  return `## Note index (all current notes, by summary)
${summaries}

## Short-tier notes in full (last 14 days of activity)
${shortFull}`;
}

const USER_INSTRUCTIONS = `Call submit_intelligence_run with brief_markdown, note_updates, edges, and stats.

Slug conventions:
- store: "store:<store_id>"
- person: "person:<slug>"
- theme:  "theme:<slug>"
- channel:"channel:<slug>"

scope_ref = store_id for store notes, the slug body for everything else.
Each note body_markdown ≤ ~300 tokens; decay items >30d unless still active.

### BRIEF FORMAT (markdown — goes in brief_markdown)

# 📍 Daily Intelligence Brief — <date>

## 🎯 Today's signal
- <bullet 1>
- <bullet 2>
- <bullet 3>
- → <implication or open window — keep crisp>

(Skip section if no real cross-visit pattern today.)

## 🟢 Wins

| Where | What | Who |
|---|---|---|
| <store> | <what happened> | <who closed it> |

## 🔴 Competitor moves

| Brand | Move | Where | Source |
|---|---|---|---|
| Bose / JBL / Sony / Samsung / Marshall | <what they did> | <store> | <staff who reported> |

## 🟡 Watch
- <store>: <concern>
- ...

## 🧵 Threads
- <theme name> — <Nth visit / M days>, <what's new>
- ...

---

<footer line: <N> visits · <M> CMs · <K> outlets · Key people today: <comma list>>

### RULES
- Quote staff / store / product names verbatim. Never "a CM" or "a competitor."
- Lean. Bullets and tables, not paragraphs. Skip empty sections entirely.
- No recommendations. No "should." Pure intelligence.
- A pattern needs 2+ visits to be called a pattern. One-offs stay under their store note.
- Promotion: a theme moves from "watching" to "active" when 2+ visits across stores support it.
- Decay: drop items >30d from store/person memory bodies unless still active.

### MEMORY RULES
- Every store visited today gets its note updated (or created if absent).
- Person notes ONLY for people mentioned 2+ times across the portfolio. One-offs stay in store notes.
- Theme notes ONLY when 2+ visits across stores support it.
- Each note: body <= ~300 tokens. Decay old context, keep load-bearing context.
- related_slugs is the source of edges — make them bidirectional in your head (cron will dedupe).
`;

// ─── Run ──────────────────────────────────────────────────────────────────────

export async function runDailyIntelligence(args: {
  reportDate: string;
  visits: VisitForReport[];
  notes: MemoryNote[];
}): Promise<IntelligenceRunResult | null> {
  if (!config.anthropic.apiKey) {
    console.error('runDailyIntelligence: ANTHROPIC_API_KEY not set');
    return null;
  }
  if (args.visits.length === 0) {
    console.log('runDailyIntelligence: no visits for', args.reportDate);
    return null;
  }

  const userMessage = `## Report date
${args.reportDate}

## Today's visits (locked & unanalyzed)
${buildVisitBlock(args.visits)}

## Memory state going in
${buildMemoryBlock(args.notes)}

---

${USER_INSTRUCTIONS}`;

  try {
    const response = await getClient().messages.create({
      model: MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [SUBMIT_TOOL],
      tool_choice: { type: 'tool', name: SUBMIT_TOOL.name },
      messages: [{ role: 'user', content: userMessage }],
    });

    if (response.stop_reason === 'max_tokens') {
      console.error(
        'runDailyIntelligence: hit max_tokens cap — tool call likely truncated. Raise MAX_OUTPUT_TOKENS or trim prompt.',
      );
      return null;
    }

    const toolUse = response.content.find(
      (b): b is Extract<typeof b, { type: 'tool_use' }> => b.type === 'tool_use',
    );
    if (!toolUse || toolUse.name !== SUBMIT_TOOL.name) {
      console.error(
        'runDailyIntelligence: model did not call submit_intelligence_run. stop_reason:',
        response.stop_reason,
      );
      return null;
    }

    const parsed = toolUse.input as Partial<IntelligenceRunResult>;

    return {
      brief_markdown: parsed.brief_markdown ?? '',
      note_updates: parsed.note_updates ?? [],
      edges: parsed.edges ?? [],
      stats: parsed.stats ?? {
        themes_active: 0,
        themes_promoted: [],
        notes_touched: 0,
        new_notes: [],
      },
      model: MODEL,
      prompt_tokens: response.usage?.input_tokens ?? 0,
      completion_tokens: response.usage?.output_tokens ?? 0,
    };
  } catch (err) {
    console.error('runDailyIntelligence error:', err);
    return null;
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
