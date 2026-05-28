# PLAN — SVA Visit Flow v2

Owner: Wilson Tan · Drafted: 2026-05-20 · Target pilot: end of next week (5 CMs: Ricky, Ginger, Jerome, Johnathan, Zhi Yong)

---

## §1 Context

Replace the current `/visit` flow (template-paste 5 sections + grade + training deep-link) with a conversational 4-prompt + follow-up close-out flow per James's spec (2026-05-19).

**Why:** Structured form doesn't get CMs to *think* per pillar — they dump freetext into one section. Conversational prompts with cue copy nudge depth. Follow-up structured entry creates the foundation for the loops-closed funnel James wants in the digest.

**Source of truth:** James's wants list in `~/.claude/projects/-Users-wilsontan-Claude/memory/project_sva_james_wants_2026_05_19.md`.

---

## §2 Goals & non-goals

### In scope (pilot)

- 4-prompt conversational flow: Good News · People & Training · Competitor Insights · Display & Stock
- Follow-up close-out step with mini-app structured entry + freetext fallback
- Photos tagged to the prompt they arrive during
- Resume-in-progress visit on `/visit` re-entry
- Adaptive `[Skip rest]` after 2 consecutive skips
- Delete visit (from `feat/delete-visit` worktree)
- Mini-app: 4-section visit detail + follow-ups list + add-follow-up form + photo grouping by section

### Out of scope (defer post-pilot)

- Loops-closed funnel dashboard surface (table exists, no UI yet)
- Pre-visit context surfacing open follow-ups for the store
- AI digest pipeline updates (`sva.insights`, memory_notes)
- Allies (deprecated — being revamped, per James)
- Grade step (dropped — James didn't mention it; keep nullable column for legacy)
- Buzz as its own prompt (folded into Display & Stock prompt copy)

### Don't touch

- `sva.memory_notes`, `sva.insights`, `v_memory_notes_current` (intelligence layer)
- `sva.visit_staff_training` (structured training entity — keep, new flow links via mini-app)
- `src/notifications/visit-broadcast.ts` (broadcast message doesn't render sections, no change needed)
- `tc_store-visit-app/` (Fanny's legacy Apps Script — abandoned)
- `q2_ai-taskforce/` (Brendan's earlier React attempt — abandoned)

---

## §3 Branch strategy

**Trunk:** `wilson/sva-bot-v2` (existing, has uncommitted work). All Phase 1-5 work commits here.

**Pulls to absorb:**
- `feat/delete-visit` — design-only branch at `.claude/worktrees/delete-visit`. Implementation per `DELETE-VISIT-PLAN.md` happens in trunk.
- `wilson/sva-edit-visit` — separate worktree at `../tc-sva-edit-visit/` using legacy template-paste UX. **Recommendation: merge into trunk first, then rewrite edit-flow against new schema in trunk.** Maintaining the edit branch against a diverged schema = future pain.

**Suggested commit sequence (one commit per phase):**
1. Schema migration 009 (apply via Supabase MCP `apply_migration`)
2. Bot: photo-collection state extension
3. Bot: new visit-flow conversation
4. Bot: resume-in-progress check
5. Bot: queries for follow-ups, people_training
6. Mini-app: visit detail render updates
7. Mini-app: add-follow-up form + API
8. Edit-visit refactor (merge branch first)
9. Delete-visit implementation
10. Help text / `/help` command update

---

## §4 Schema — Migration 009

File: `supabase/migrations/sva/009_visit_flow_v2.sql`

```sql
-- 009_visit_flow_v2.sql
-- Visit flow v2: add people_training freetext, structured follow-ups table,
-- and photo section tagging.

-- ─── 4.1 Add people_training column ──────────────────────────────────────────
-- Merges James's prompts 2 (People) and 3 (Training) into one freetext field.
-- Structured trainings continue to use sva.visit_staff_training (mini-app entry).

ALTER TABLE sva.visits
  ADD COLUMN IF NOT EXISTS people_training text;

-- Legacy columns kept nullable so old visits render fine:
--   good_news, competitors, display_stock, follow_up, buzz_plan, training
-- New flow writes:
--   good_news              ← Good News prompt
--   people_training        ← People & Training prompt (NEW)
--   competitors            ← Competitor Insights prompt (reuse column, relabel in UI)
--   display_stock          ← Display & Stock prompt (absorbs buzz mentions via copy)
--   follow_up              ← freetext follow-up fallback (typed at close-out)
-- New flow does NOT write to:
--   buzz_plan, training, grade, grade_comments

-- ─── 4.2 Structured follow-ups ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sva.visit_follow_ups (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id            uuid        NOT NULL REFERENCES sva.visits(id) ON DELETE CASCADE,
  store_id            uuid        NOT NULL REFERENCES sva.stores(id),
  cm_telegram_id      bigint      NOT NULL,
  title               text        NOT NULL,
  notes               text,
  due_date            date,
  status              text        NOT NULL DEFAULT 'open'
                                  CHECK (status IN ('open','done','cancelled')),
  closed_at           timestamptz,
  closed_by_visit_id  uuid        REFERENCES sva.visits(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_visit ON sva.visit_follow_ups(visit_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_store_open
  ON sva.visit_follow_ups(store_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_follow_ups_cm_open
  ON sva.visit_follow_ups(cm_telegram_id) WHERE status = 'open';

-- ─── 4.3 Photo section tagging ───────────────────────────────────────────────

ALTER TABLE sva.visit_photos
  ADD COLUMN IF NOT EXISTS section_key text;

-- Allowed values (validated app-side, not DB-side to keep migration cheap):
--   'good_news' | 'people_training' | 'competitor' | 'display_stock' | 'follow_up' | NULL
-- NULL = photo arrived before any prompt was active (e.g., during store-pick).
-- The legacy photo_tag column stays untouched (auto-tag AI may still use it later).

CREATE INDEX IF NOT EXISTS idx_photos_visit_section
  ON sva.visit_photos(visit_id, section_key);
```

Apply via `mcp__supabase__apply_migration` with name `009_visit_flow_v2`.

---

## §5 Bot rewrite

### §5.1 Files to touch

| File | Change |
|---|---|
| `src/bot/conversations/visit-flow.ts` | **Rewrite.** New 4-prompt + follow-up flow. |
| `src/bot/photo-collection.ts` | Add `currentSectionKey` to `PhotoCollection`; per-photo section snapshot map. |
| `src/bot/commands/visit.ts` | Resume-in-progress check before entering conversation. |
| `src/db/queries/visits.ts` | Add `people_training` to attach helper; new `getDraftVisit(cmId)` query; remove training Y/N path. |
| `src/db/queries/photos.ts` | Accept `sectionKey` arg in `uploadVisitPhoto`; persist to `section_key` column. |
| `src/db/queries/visit-follow-ups.ts` | **New file.** `createFollowUp`, `listFollowUpsForVisit`, `markFollowUpDone`. |
| `src/bot/visit-details.ts` | Render new sections + follow-ups list in `sendVisitDetails`. |
| `src/bot/commands/help.ts` | Update `/help` text to reflect new flow. |
| `src/utils/parse-template.ts` | **Keep for legacy** but new flow doesn't use it. |

### §5.2 Conversation flow — exact prompt copy

After store-pick (existing picker is fine; reuse `buildStorePicker` etc.), enter the prompt loop:

```
1/4  🎉 Any wins today?
     Sales moved, SM breakthrough, customer compliment, staff Good News…
     [Skip]

2/4  👥 People & training today?
     Who'd you engage, what did you talk about, how did they respond?
     Trained someone with specific products? Tap below to log it properly.
     [📋 Log Training]  [Skip]

3/4  🔍 Competition doing anything?
     Bose / Sony / JBL — promos, products, POS, gossip from staff…
     [Skip]

4/4  📦 Display & Stock — anything to flag?
     Display health, stock levels, POSM/buzz materials up, new spaces conquered?
     [Skip]

✓    Any follow-ups before we close?
     Stock orders, emails, demos to plan, revisits…
     Type one line (quick) OR tap below for multiple with due dates.
     [📋 Add in Mini-App]  [Skip]  [✅ Done — Lock visit]
```

**After 2 consecutive `[Skip]` taps,** the next prompt's keyboard gains a third button:

```
[Skip] [Skip rest →]
```

`[Skip rest →]` jumps directly to the follow-up close-out step.

### §5.3 State machine inside the conversation

Use a simple driver. Pseudo-TypeScript:

```ts
type SectionKey = 'good_news' | 'people_training' | 'competitor' | 'display_stock';

const PROMPTS: { key: SectionKey; emoji: string; question: string; cue: string }[] = [
  { key: 'good_news',       emoji: '🎉', question: 'Any wins today?',
    cue: 'Sales moved, SM breakthrough, customer compliment, staff Good News…' },
  { key: 'people_training', emoji: '👥', question: 'People & training today?',
    cue: 'Who\'d you engage, what did you talk about, how did they respond?\nTrained someone? Tap below to log structured details.' },
  { key: 'competitor',      emoji: '🔍', question: 'Competition doing anything?',
    cue: 'Bose / Sony / JBL — promos, products, POS, gossip from staff…' },
  { key: 'display_stock',   emoji: '📦', question: 'Display & Stock — anything to flag?',
    cue: 'Display health, stock levels, POSM/buzz materials up, new spaces conquered?' },
];

let consecutiveSkips = 0;
const answers: Record<SectionKey, string | null> = { good_news: null, people_training: null, competitor: null, display_stock: null };

for (let i = 0; i < PROMPTS.length; i++) {
  const p = PROMPTS[i];
  setActiveSection(telegramId, p.key);  // photo handler reads this

  const showSkipRest = consecutiveSkips >= 2 && i < PROMPTS.length - 1;
  const kb = buildPromptKeyboard(p.key, showSkipRest);
  await ctx.reply(formatPrompt(i + 1, PROMPTS.length, p), { reply_markup: kb, parse_mode: 'Markdown' });

  const result = await awaitPromptReply();  // returns { kind: 'text'|'skip'|'skipRest'|'training'|'cancel', value? }
  if (result.kind === 'cancel') return;
  if (result.kind === 'skipRest') break;
  if (result.kind === 'skip')    { consecutiveSkips++; continue; }
  if (result.kind === 'training') { await openTrainingMiniApp(); i--; continue; }  // re-prompt same step
  if (result.kind === 'text')    { answers[p.key] = result.value; consecutiveSkips = 0; }

  await persistSection(visit.id, p.key, answers[p.key]);  // save-as-you-go
}

setActiveSection(telegramId, 'follow_up');  // photos during follow-up step
await runFollowUpCloseOut(visit, ctx);
await finalizeVisit(visit.id);
```

### §5.4 Follow-up close-out logic

Three exit paths:

| User action | Persist | Then |
|---|---|---|
| Taps `[📋 Add in Mini-App]` | Wait for return (mini-app POSTs follow-ups directly). Bot polls `listFollowUpsForVisit(visit.id)` or shows confirm-when-ready button. | Show "✓ N follow-ups added" → wait for `[Done]` |
| Types freetext (any text) | `createFollowUp({ visit_id, store_id, cm_telegram_id, title: text, status: 'open' })` AND write to `visits.follow_up` column for back-compat. | Confirm + `[Done]` |
| Taps `[Skip]` | No follow-up persisted. | Straight to lock. |
| Taps `[✅ Done]` (after any of the above, or with nothing) | Skip if nothing entered. | Lock visit. |

Mini-app return detection: simplest path is `[Done]` button stays visible until tapped — bot doesn't need to detect mini-app return automatically. Mini-app submits follow-ups via its own API; user comes back to bot and taps Done.

### §5.5 Photo collection extension

Edit `src/bot/photo-collection.ts`:

```ts
interface PhotoCollection {
  visitId: string;
  storeId: string;
  storeName: string;
  sections: number;
  fileIds: string[];
  fileSectionMap: Map<string, string | null>;  // NEW: fileId → section_key at arrival time
  currentSectionKey: string | null;            // NEW: prompt currently active
  timer: NodeJS.Timeout | null;
  resolveDone: (n: number) => void;
}

export function setActiveSection(telegramId: number, sectionKey: string | null): void {
  const c = collections.get(telegramId);
  if (c) c.currentSectionKey = sectionKey;
}

// In handleIncomingPhoto, snapshot the section on arrival:
collection.fileIds.push(fileId);
collection.fileSectionMap.set(fileId, collection.currentSectionKey);

// In finalizeCollection, pass section per fileId to uploadVisitPhoto:
for (const fileId of fileIds) {
  const sectionKey = collection.fileSectionMap.get(fileId) ?? null;
  await uploadVisitPhoto(visitId, buffer, storeId, sectionKey);
}
```

Then `uploadVisitPhoto(visitId, buffer, storeId, sectionKey)` writes `section_key` on insert.

### §5.6 Resume-in-progress visit

In `src/bot/commands/visit.ts`, before entering the conversation:

```ts
const draft = await getDraftVisit(ctx.from.id);  // is_locked = false, created_at within 6h
if (draft) {
  await ctx.reply(
    `You have an open visit at *${draft.storeName}*.\nResume or start fresh?`,
    { reply_markup: new InlineKeyboard()
        .text('▶️ Resume', `resume:${draft.id}`)
        .text('🆕 Start fresh', `discard:${draft.id}`),
      parse_mode: 'Markdown' }
  );
  return;
}
// otherwise → enterConversation('visit-flow')
```

Add `getDraftVisit` to `src/db/queries/visits.ts`:

```ts
export async function getDraftVisit(cmTelegramId: number): Promise<Visit | null> {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('visits')
    .select('*, stores(name)')
    .eq('cm_telegram_id', cmTelegramId)
    .eq('is_locked', false)
    .gte('created_at', sixHoursAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as Visit & { stores: { name: string } };
}
```

Resume handler in `bot.ts`: load draft, jump conversation back to the first unfilled section. Start fresh = delete draft + restart.

### §5.7 Save-as-you-go

After each prompt reply (not at end), call:

```ts
async function persistSection(visitId: string, key: SectionKey, value: string | null) {
  const col = {
    good_news: 'good_news',
    people_training: 'people_training',
    competitor: 'competitors',
    display_stock: 'display_stock',
  }[key];
  await supabase.from('visits').update({ [col]: value }).eq('id', visitId);
}
```

If the conversation crashes or the user closes Telegram, the draft visit (is_locked=false) holds partial data + photos. Resume picks up cleanly.

---

## §6 Mini-app updates

### §6.1 Files to touch

| File | Change |
|---|---|
| `miniapp/src/app/(miniapp)/m/visit/[id]/page.tsx` | Render 4 sections + follow-ups list + grouped photos. |
| `miniapp/src/app/(miniapp)/m/visit/[id]/followup/page.tsx` | **New page.** Add follow-up form (multi-item). |
| `miniapp/src/app/api/m/visit/[id]/route.ts` | Return new fields: `people_training`, `follow_ups[]`, photos grouped by `section_key`. |
| `miniapp/src/app/api/m/visit/[id]/followup/route.ts` | **New API.** POST create, GET list, PATCH mark-done. |
| `miniapp/src/lib/queries.ts` | Add `listFollowUpsForVisit`, `getFullVisitV2` (includes people_training + follow-ups). |
| `miniapp/src/lib/visit-render.ts` (new or in page) | Group photos by `section_key`, render labeled groups. |

### §6.2 Visit detail page layout (`/m/visit/[id]`)

```
┌─────────────────────────────────────┐
│  ← Back to Bishan                   │
│                                     │
│  Visit · 2026-05-20                 │
│  Wilson Tan · Co: —                 │
│  [Edit] [Delete]                    │
│                                     │
│  🎉 Good News                       │
│  SM finally agreed to push Arc Ultra│
│  📸 [photo] [photo]                 │
│                                     │
│  👥 People & Training               │
│  Trained Ryan on Arc Ultra…         │
│  ┌ 📋 Structured trainings ──────┐ │
│  │ Arc Ultra · Ryan · 2nd time   │ │
│  └───────────────────────────────┘ │
│  📸 [photo]                         │
│                                     │
│  🔍 Competitor Insights             │
│  Bose 25% off Soundbar 900…         │
│                                     │
│  📦 Display & Stock                 │
│  POSM up, Klipsch magazine seen…    │
│                                     │
│  ✅ Follow-ups (2 open)             │
│  ☐ Email SM Tue re demo stock      │
│  ☐ Order new display board · Fri   │
│  [+ Add follow-up]                  │
│                                     │
│  📸 Other photos                    │
│  [photo] [photo]                    │
└─────────────────────────────────────┘
```

### §6.3 Add follow-up form (`/m/visit/[id]/followup`)

Telegram-style form with multi-add:

```
Add Follow-ups for Bishan
─────────────────────────

Item 1
[ Title ____________________ ]
[ Notes (optional) __________ ]
[ Due date 📅 ]
[ × Remove ]

[+ Add another]

[ Save All ] [ Cancel ]
```

POST to `/api/m/visit/[id]/followup` with `{ items: [{ title, notes?, due_date? }, ...] }`. Telegram WebApp closes on success (`WebApp.close()`), returning user to bot.

### §6.4 Deep link

Bot constructs:

```
https://t.me/{bot_username}/{miniapp_short_name}?startapp=visit_{visitId}_followup
```

Mini-app's `m/page.tsx` (entry) parses `startapp` param, routes to `/m/visit/{id}/followup` if suffix matches.

---

## §7 Edit-visit refactor

**Branch decision:** Merge `wilson/sva-edit-visit` into `wilson/sva-bot-v2` *before* Phase 2 starts. Then rewrite edit flow against new schema.

**New edit flow:** Mini-app-first. The `[Edit]` button on the visit detail page opens an editor with the same 4-section layout (each section text + edit pencil) + follow-ups manager + photo re-tag UI. No bot-side editing conversation needed for v2 (drop the template-paste edit session).

**Files affected by merge:**
- `tc-sva-edit-visit/src/bot/edit-session.ts` — delete or repurpose
- `tc-sva-edit-visit/src/utils/parse-template.ts` — drop
- `tc-sva-edit-visit/src/ai/analyze-visit.ts` — port if still relevant for AI (intelligence layer, out of pilot scope — defer port)

Edit UI lives in mini-app: `miniapp/src/app/(miniapp)/m/visit/[id]/edit/page.tsx` (new).

---

## §8 Delete-visit integration

Per `.claude/worktrees/delete-visit/DELETE-VISIT-PLAN.md`:

- `Delete` chip next to `Edit` chip on visit detail page
- Bottom-sheet confirmation
- `DELETE /api/m/visit/[id]` route
- Auth: visit owner CM + admins (co-CMs blocked)
- DB delete: `visit_photos`, `visit_cms`, `visit_staff`, `insights` cascade from FK; visit_follow_ups now ALSO cascades (per §4.2 schema)
- Storage: `supabase.storage.from('sva-photos').remove([paths])` *after* DB success
- Hard delete (no soft-delete pattern in codebase)
- Risk flagged: dangling broadcast deep-link (no `message_id` stored) — leave as v2 cleanup

---

## §9 Acceptance criteria

### Bot
- [ ] `/visit` → store-pick → 4 prompts in order → follow-up close-out → Done in <60s on happy path
- [ ] `[Skip]` on every prompt advances without writing
- [ ] After 2 consecutive `[Skip]`s, prompt 3 (or wherever) shows `[Skip rest →]` button
- [ ] Photo sent during prompt 2 → `sva.visit_photos.section_key = 'people_training'`
- [ ] Photo sent during store-pick (before any prompt) → `section_key = NULL`
- [ ] Photo sent after lock → ignored (no error to user)
- [ ] `/cancel` at any prompt → draft visit deleted, no orphans
- [ ] `/visit` while draft exists (<6h) → Resume / Start fresh prompt
- [ ] Freetext at follow-up close-out → creates 1 row in `visit_follow_ups` (title=text)
- [ ] Mini-app follow-up form submit → 1+ rows in `visit_follow_ups`
- [ ] `[Done]` locks visit; broadcast fires; mini-app deep-link works

### Mini-app
- [ ] Visit detail page renders all 4 sections + follow-ups + photos grouped by `section_key`
- [ ] Untagged photos appear under "Other photos" group
- [ ] `[+ Add follow-up]` button on visit detail opens form
- [ ] Follow-up form supports multi-item add, optional due date
- [ ] Mark follow-up `done` updates `closed_at` + `status`
- [ ] `[Edit]` opens new mini-app editor (4 sections + follow-ups)
- [ ] `[Delete]` shows confirm sheet → deletes visit + photos in storage

### Schema
- [ ] Migration 009 applies cleanly to staging Supabase
- [ ] Old visits (with `competitors`, `display_stock`, etc. populated, no `people_training`) still render in mini-app without errors

---

## §10 Manual QA script

Run all of these against staging bot before pilot:

1. **Happy path full log** — `/visit` → pick store → type into all 4 prompts → send 1 photo per prompt → type freetext follow-up → Done. Verify mini-app shows all sections, 4 tagged photos, 1 follow-up.
2. **Skip everything** — `/visit` → pick store → Skip × 4 → Skip follow-up → Done. Verify visit row exists with all section columns NULL.
3. **Skip rest** — `/visit` → store → Skip → Skip → tap `[Skip rest →]` on prompt 3. Verify jumps to follow-up step, all section columns NULL.
4. **Photos out of order** — Send photo during store-pick (no section) → pick store → photo during prompt 1 → photo during prompt 3. Verify `section_key` values: NULL, 'good_news', 'competitor'.
5. **Mini-app follow-up multi-add** — At close-out, tap `[📋 Add in Mini-App]` → add 3 items with due dates → Save All → return to bot → tap Done. Verify 3 rows in `visit_follow_ups`.
6. **Resume** — Start `/visit`, fill prompt 1, close Telegram. Re-open `/visit` within 6h. Verify Resume prompt; tap Resume; verify prompt 2 is next.
7. **Start fresh** — As above, tap Start fresh. Verify old draft deleted, new flow from prompt 1.
8. **Cancel mid-flow** — `/visit` → prompt 2 → `/cancel`. Verify no visit row, no orphan photos.
9. **Training mini-app link** — Tap `[📋 Log Training]` on prompt 2 → mini-app opens to training form → add training → return → re-prompt continues. Verify training in `sva.visit_staff_training`.
10. **Delete visit** — From mini-app, delete a locked visit. Verify `visits`, `visit_photos`, `visit_follow_ups` rows gone; storage paths gone.

---

## §11 Rollout

1. Apply migration 009 to staging Supabase first → verify with `list_tables`.
2. Deploy bot to staging Railway → run QA script.
3. Deploy mini-app to staging → run QA script.
4. Apply migration 009 to production Supabase.
5. Merge `wilson/sva-bot-v2` → production branch (or whatever deploy trigger). Bot + mini-app go live.
6. Dry-run meeting with 5 pilot CMs (Ricky, Ginger, Jerome, Johnathan, Zhi Yong). Walk through flow live.
7. Day-after check: query `sva.visits` to verify new visits use new columns; spot-check `visit_follow_ups` and `section_key` data.

---

## §12 Notes for the executing agent

- **Don't add tests.** This codebase has no test suite; manual QA per §10 is the verification path.
- **Don't add feature flags.** Wilson prefers direct cuts. Old visits keep rendering via legacy columns; new visits use new shape.
- **Don't refactor unrelated code.** If you see something tempting (e.g., simplify photo-collection further), resist. Ship the spec, not adjacent improvements.
- **Don't touch CLAUDE.md, knowledge files, or memory.** Those are Wilson's tools.
- **Use the Supabase MCP** (`apply_migration`, `execute_sql`) for schema work — not raw SQL files via CLI.
- **Commit per phase** with conventional-style messages: `feat(bot): visit flow v2 — 4-prompt conversational`, `feat(schema): migration 009 visit flow v2`, etc.
- **Push to `origin/wilson/sva-bot-v2`** after each phase commits clean. Railway auto-deploys.
- **If you discover a real blocker** (Sonnet finds the schema doesn't match what this plan assumed, or a file has been deleted, etc.) — stop and ask. Don't paper over with workarounds.
