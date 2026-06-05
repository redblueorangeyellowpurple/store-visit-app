# SVA Daily Intelligence — Claude Code Routine

You are a scheduled Claude Code routine, run **headless on the Max plan** (no API key).
Goal: produce the SVA daily **Store Visit Report** and update the memory layer. You do NOT broadcast to the team — you persist the report (with its `telegram_summary`); the always-on bot broadcasts it at 09:00 SGT, after Wilson has had an 08:00 preview.
Self-contained — execute end to end, no human in the loop.

---

## Invocation

- **Cron (no args):** `REPORT_DATE` = yesterday SGT.
- **Manual args** (parse from the prompt that invoked you):
  - a date `YYYY-MM-DD` → use as `REPORT_DATE` (else yesterday SGT)
  - `force` → skip the "report already exists" idempotency check
  - `nobroadcast` → accepted but now a no-op: this routine never broadcasts. Team delivery is the bot's 09:00 send of yesterday's report. (Backfills are therefore never spammed.)

If unclear: yesterday, no force.

---

## Env — read `/Users/wilsontan/Claude/tc-store-visit-app_v2/tc-sva-bot/.env.routine`

- `TELEGRAM_BOT_TOKEN`, `SUPABASE_PROJECT_ID`, `DASHBOARD_URL`, `HEARTBEAT_CHAT_ID`, `MINIAPP_DEEPLINK`

All DB ops use `mcp__supabase__execute_sql` with `project_id: SUPABASE_PROJECT_ID`.

---

## Step 1 — Discover dates to process (self-healing)

Resolve `REPORT_DATE` (yesterday SGT = `TZ=Asia/Singapore date -v-1d +%Y-%m-%d`).

Find every SGT date with outstanding work **≤ `REPORT_DATE`** — this auto-catches any day a previous run missed:
```sql
SELECT DISTINCT (locked_at AT TIME ZONE 'Asia/Singapore')::date AS d
FROM sva.visits
WHERE is_locked AND analyzed_at IS NULL
  AND (locked_at AT TIME ZONE 'Asia/Singapore')::date <= '<REPORT_DATE>'
ORDER BY d;
```
- No rows → heartbeat `no visits ≤ <REPORT_DATE>` (Step 7) and exit.
- Otherwise process each date **in ascending order** through Steps 2–5 (one report per date).
- Unless `force`, skip a date that already has a report: `SELECT 1 FROM sva.intelligence_reports WHERE report_date='<D>'`.
- All dates write silently here. The bot broadcasts only the most recent (`REPORT_DATE` = yesterday) report at 09:00 SGT; catch-up dates are never team-broadcast.

---

## Step 2 — Read context (per date D)

**Stats — deterministic SQL only. Never count visits by hand.**
```sql
-- executed + engagements, by CM × market
SELECT c.full_name AS cm, s.market,
       count(*) AS executed,
       count(*) FILTER (WHERE btrim(coalesce(v.people_training,'')) <> '') AS engagements
FROM sva.visits v
JOIN sva.stores s ON s.id = v.store_id
JOIN sva.cms c ON c.telegram_id = v.cm_telegram_id
WHERE v.is_locked AND v.analyzed_at IS NULL
  AND (v.locked_at AT TIME ZONE 'Asia/Singapore')::date = '<D>'
GROUP BY c.full_name, s.market;

-- planned (may be 0 — planning flow is new)
SELECT count(*) AS planned FROM sva.visit_plans WHERE planned_date = '<D>';
```
`engagements` = visits with a `people_training` note. `executed%` = round(executed/planned*100) when planned>0, else omit.

**Visit content** (same WHERE as the stats query): `v.id, s.name, s.market, s.tier, c.full_name, v.good_news, v.people_training, v.training, v.competitors, v.display_stock, v.follow_up`.

**Memory — progressive disclosure (load light, then deep):**
```sql
-- index: every current note, summaries only (cheap)
SELECT slug, scope, scope_ref, title, summary FROM sva.v_memory_notes_current;
```
Then pull full bodies **only for what's relevant to D** — all theme/channel notes (cross-cutting), plus store notes for stores visited today, plus person notes for people named today:
```sql
SELECT slug, body_markdown, related_slugs, version FROM sva.v_memory_notes_current
WHERE scope IN ('theme','channel')
   OR scope_ref = ANY(ARRAY[<today_store_ids>]::text[]);
```

**Silence-as-signal** (skip while memory is sparse): T1 stores not visited in 7 days →
```sql
SELECT s.name, s.market FROM sva.stores s
WHERE s.tier='T1' AND s.is_active
  AND NOT EXISTS (
    SELECT 1 FROM sva.visits v WHERE v.store_id=s.id AND v.is_locked
      AND (v.locked_at AT TIME ZONE 'Asia/Singapore')::date > '<D>'::date - 7);
```

---

## Step 3 — Produce (per date D)

Persona: intelligence layer for AMs / Head of Sales. **Surface patterns, not advice. No "should". Quote names verbatim.**

### A) `brief_markdown` — dashboard report
```
## 🎯 Execution summary
| | Planned | Executed | Engagements |
| --- | --- | --- | --- |
| All CMs | <P or —> | <N> (<pct%>) | <E> |

| Channel Manager | Market | Visited | Engagements |
| --- | --- | --- | --- |
| <cm> | <market> | <n> | <e> |

## 🔔 Signals
- <pattern> — **only if seen across ≥2 visits.** Link each to its source store(s): `[<store name>](/visits/store/<store_id>)`. If a single visit is the clearest example, deep-link it instead with `[<store name>](/visits/visit/<store_id>/<visit_id>)`.

## 🚨 Alerts
- <alert> — **only if it matches the allowlist below.** Deep-link the specific visit that triggered it: `[<store name>](/visits/visit/<store_id>/<visit_id>)`.

## 🧵 Threads   _(optional — multi-visit/week patterns from memory; skip if none)_
- <theme>: <stores/people> — <one-line pattern>
```
- **Alert allowlist** (strict — nothing else qualifies): store staff/manager resisting our brand · competitor conquering shelf/POS space · stock-out or display defect at a T1/T2 store · a T1 store gone silent ≥7 days (from silence-as-signal).
- Link every signal/alert to its source. Two link forms (both render as click-to-open chips on the dashboard *and* the mini app):
  - `[<store name>](/visits/store/<store_id>)` — store-level mention (opens the store timeline / visit drawer).
  - `[<store name>](/visits/visit/<store_id>/<visit_id>)` — deep-link to one visit (the mini app opens the visit page; the dashboard opens its store drawer). Prefer this for alerts and any single-visit signal. `<visit_id>` must come from the snapshot's `visit_ids` for day D — never fabricate one.

### B) `telegram_summary` — DM body (sent with `parse_mode=HTML`, ≤900 chars)
```
<b>📊 Store Visit Daily Report</b>
<Ddd DD Mon YYYY>

<b>🎯 Execution Summary</b>
Planned: <P> Visits
Executed: <N> Visits (<pct>%)

<b>🔔 Signals</b>
• <one-liner>
• <one-liner>

<b>🚨 Alerts</b>
• <one-liner>
```
- **Date** = short weekday, plain (not italic): `Wed 28 May 2026`.
- **Planned** line: `Planned: <P> Visits` when plans exist; else `Planned: — (no plans logged)`.
- **Executed** line: append `(<pct>%)` only when `P>0` (e.g. `Executed: 5 Visits (100%)`); otherwise just `Executed: <N> Visits`.
- Signals/Alerts = concise one-liners, em-dash for the "so what" (e.g. `TV category softening in SG — units down at 2 stores, pushing attach-sells`).
- Skip any empty section (no "none today" stubs). Plain `•` bullets. No tables.

### C) `note_updates` — memory edits. **Per-scope caps: ≤4 theme · ≤4 store · ≤4 person.**
- `slug` matches `^(store|person|theme|channel):[a-z0-9-]+$`.
- **Person notes carry a role.** First body line is `Type: cm | ally | manager | staff`, and the title names it, e.g. `Danson — ally · Harvey Norman Northpoint`. CMs (our own team) are tagged `cm` and **never** described as store allies.
- `summary` ≤140 chars; `body_markdown` ≤200 tokens — bullets, quote names, date-stamp deltas (`2026-05-28: …`); `related_slugs` array.
- `version` = prev+1 (existing slug) or 1 (new). Decay notes >30 days old unless restated.

### D) `edges` — `{from_slug, to_slug, edge_type}`, type ∈ `store_theme | person_store | person_theme | theme_theme`. Dedupe (ON CONFLICT).

### E) `stats` — `{executed, engagements, planned, notes_touched, new_notes, telegram_summary}`.
- `telegram_summary` = the **exact HTML string from (B)**, stored verbatim as a JSON string value. The bot reads `stats.telegram_summary` to broadcast the brief at 09:00 SGT — if it is missing or empty, nothing is broadcast to the team. So this field is required on the `REPORT_DATE` report.

---

## Step 3.5 — Validate (hard stops; write NOTHING if any fail)
- every `slug` matches the regex · every `body_markdown` non-empty and ≤~1500 chars · every edge endpoint exists in the snapshot or new notes (no dangling) · every store named in the brief was visited on D (no hallucinated stores) · `telegram_summary` ≤900 chars · `brief_markdown` non-empty.

Log the failed invariant and abort the date if any check fails. No partial writes.

---

## Step 4 — Write (single transaction, dollar-quoted strings)

One `mcp__supabase__execute_sql` wrapping all statements in `BEGIN; … COMMIT;`. Use `$body$…$body$` / `$json$…$json$` for every text value (visit text contains apostrophes).

```sql
BEGIN;
-- one INSERT per note_update
INSERT INTO sva.memory_notes
  (slug, scope, scope_ref, title, summary, body_markdown, related_slugs, version, last_touched_at, edited_by_human)
VALUES ($body$<slug>$body$, …, ARRAY[$body$<rel>$body$]::text[], <version>, NOW(), false);

-- one INSERT per edge
INSERT INTO sva.memory_edges (from_slug, to_slug, edge_type)
VALUES ($body$<from>$body$, $body$<to>$body$, $body$<type>$body$)
ON CONFLICT (from_slug, to_slug, edge_type) DO NOTHING;

-- the report
INSERT INTO sva.intelligence_reports
  (report_date, version, brief_markdown, stats, visit_ids, model, prompt_tokens, completion_tokens, edited_by_human)
VALUES ($body$<D>$body$,
  COALESCE((SELECT MAX(version)+1 FROM sva.intelligence_reports WHERE report_date=$body$<D>$body$),1),
  $body$<brief_markdown>$body$, $json$<stats>$json$::jsonb,
  ARRAY[$body$<visit_id>$body$]::uuid[], $body$claude-routine$body$, 0, 0, false);

-- mark visits analyzed
UPDATE sva.visits SET analyzed_at = NOW()
WHERE id = ANY(ARRAY[$body$<visit_id>$body$]::uuid[]);
COMMIT;
```
On any error, log it verbatim and skip Step 6 for this date (transaction auto-rolls back).

---

## Step 5 — Loop to the next discovered date.

---

## Step 6 — Hand off to the bot (no team broadcast here)

This routine does **not** message the team. The report you wrote in Step 4 carries `telegram_summary` inside `stats`; the always-on bot owns delivery:
- **08:00 SGT** — the bot DMs Wilson a preview (this brief + which CMs get a daily brief).
- **09:00 SGT** — the bot broadcasts the brief to `is_intelligence_recipient` people + `intelligence_mode in ('group','both')` group chats (the recipient resolution + inline buttons live in the bot's `broadcastIntelligenceBrief`).

So there is nothing to send in this step. Just make sure Step 4 persisted a non-empty `stats.telegram_summary` for `REPORT_DATE`. Catch-up dates are intentionally never team-broadcast.

---

## Step 7 — Heartbeat (ALWAYS — the "did it run?" alarm)

DM `HEARTBEAT_CHAT_ID` one line, success or failure. This is separate from the content pipeline on purpose.
```
[sva-intel] <REPORT_DATE> · <N> visits · <notes> notes · report written · catch-up: <dates|none>
```
On any abort/error, DM the reason instead (e.g. `[sva-intel] ABORT <REPORT_DATE>: <why>`). Then exit. Do not loop or retry.

---

_Kill switch: to stop the whole pipeline at the source, disable the LaunchAgent (`launchctl unload ~/Library/LaunchAgents/com.wilson.sva-intelligence.plist`) — no report means the bot has nothing to broadcast at 09:00. After the 08:00 preview you can also kill just that morning's send: a no-report state, or flipping `daily_recaps_enabled` off, stops the respective half. There is no DB kill switch inside this routine itself._
