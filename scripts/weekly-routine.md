# SVA Weekly Report — Claude Code Routine

Scheduled Claude Code routine, run **headless on the Max plan** (no API key), same model as the daily `intelligence-routine.md`. Produces the **AI narrative** of the SVA Weekly Report — `## 🌟 Good News`, `## 🔔 Signals`, `## 🚨 Alerts`, `## 🤝 Engagements` — and stores it in `sva.weekly_reports`.

The **deterministic** sections (stat cards, Visits By Day, Execution Summary, Coverage By Tier, Display) are computed live by the dashboard aggregator (`dashboard/src/lib/weekly.ts`). This routine does NOT recompute them — it only writes the narrative. The dashboard Week view reads the narrative from `sva.weekly_reports` and renders it under the deterministic sections.

---

## Invocation
- **Cron (no args):** target = the **last completed Mon–Sun week** (the week whose Sunday is before today, SGT). Runs Monday morning for the week that just ended.
- **Manual args** (the "regenerate" path Wilson runs on demand):
  - a Monday date `YYYY-MM-DD` → use as `WEEK_START`.
  - `force` → skip the "already exists" idempotency check and write a new version.

If unclear: last completed week, no force.

## Env — read `tc-sva-bot/.env.routine`
`SUPABASE_PROJECT_ID`, `HEARTBEAT_CHAT_ID`. All DB ops via `mcp__supabase__execute_sql` with `project_id: SUPABASE_PROJECT_ID`.

---

## Step 1 — Resolve the week
`WEEK_START` = Monday of the target week; `WEEK_END` = `WEEK_START + 6`.
Idempotency (unless `force`): `SELECT 1 FROM sva.weekly_reports WHERE week_start='<WEEK_START>'` → if exists, exit (heartbeat "already done").

## Step 2 — Read the week's content (deterministic SQL only; never count by hand)
```sql
-- every locked visit in the week, with the qualitative fields
SELECT v.id AS visit_id, v.store_id, s.name AS store, s.market, s.tier, s.chain,
       c.full_name AS cm, v.good_news, v.competitors, v.display_stock, v.people_training, v.follow_up
FROM sva.visits v
JOIN sva.stores s ON s.id = v.store_id
JOIN sva.cms c ON c.telegram_id = v.cm_telegram_id
WHERE v.is_locked AND v.visit_date >= '<WEEK_START>' AND v.visit_date <= '<WEEK_END>';

-- staff/ally engagements in the week (for the Engagements section)
SELECT s.name AS store, s.market, vs.person_name, vs.was_trained,
       coalesce(et.product_name, vs.products_trained_on) AS product,
       coalesce(et.response, vs.training_response, vs.update_text) AS response
FROM sva.visit_staff vs
JOIN sva.visits v ON v.id = vs.visit_id
JOIN sva.stores s ON s.id = v.store_id
LEFT JOIN sva.engagement_trainings et ON et.visit_staff_id = vs.id
WHERE v.is_locked AND v.visit_date >= '<WEEK_START>' AND v.visit_date <= '<WEEK_END>'
  AND (btrim(coalesce(vs.update_text,''))<>'' OR btrim(coalesce(vs.training_response,''))<>'' OR vs.was_trained);

-- open follow-ups older than 10 days (for the Alerts "overdue" line)
SELECT s.name AS store, fu.title, (CURRENT_DATE - fu.created_at::date) AS age_days
FROM sva.visit_follow_ups fu JOIN sva.stores s ON s.id = fu.store_id
WHERE fu.status='open' AND (CURRENT_DATE - fu.created_at::date) > 10 ORDER BY age_days DESC;
```

## Step 3 — Synthesize `brief_markdown`
Persona: intelligence layer for AMs / CM-ICs / leadership. **Surface patterns, not advice. No "should". Quote names verbatim.** Four sections, in this order:

```
## 🌟 Good News
_Concrete wins this week — sales closed, space won, allies recruited_
- **<concrete win headline>**
  - <one-sentence elaboration of the win>
  - Sources: [<store name> · <D Mon>](/visits/visit/<store_id>/<visit_id>?hl=<section>&q=<fragment>)

## 🔔 Signals
_Noteworthy good-or-neutral intelligence — repeating patterns & notable observations_
- **<one-line insight header>**
  - <punchy elaboration stating the evidence base, e.g. "3 of 7 SG visits this week, all T1">
  - Sources: [<store A · D Mon>](/visits/visit/<store_id>/<visit_id>?hl=<section>&q=<fragment>) · [<store B · D Mon>](/visits/visit/<store_id>/<visit_id>?hl=<section>&q=<fragment>) · [🧠 <memory note title>](/intelligence/notes/<slug>)

## 🚨 Alerts
_Bad / needs attention_
- **<one-line risk header>**
  - <what's wrong, 1–2 lines>
  - Sources: [<store name> · <D Mon>](/visits/visit/<store_id>/<visit_id>?hl=<section>&q=<fragment>)

## 🤝 Engagements
_Training & engagement rollup by product, with standout responses_
- **<product or topic> — <n> trained · <overall reception: receptive / mixed / lukewarm>**
  - ▲ <person> @ [<store name>](/visits/visit/<store_id>/<visit_id>?hl=people_training&q=<fragment>) — <standout-good response>
  - ▽ <person> @ [<store name>](/visits/visit/<store_id>/<visit_id>?hl=people_training&q=<fragment>) — <standout-weak / concerning response>
- ◆ **Consensus** — <general sentiment/awareness insight across the week's engagements, e.g. floor staff broadly aware of the new promo; product familiarity low in MY chains>
```

Rules:
- **Good News** — concrete wins ONLY. Qualifies: closed sale or large order, won or expanded display space, new ally recruited, competitor displaced, **a standout training reception** (staff visibly enthusiastic, committing to push the product, or asking for sell-in — name the person). Does NOT qualify: routine positivity, vague momentum, a good conversation. **Omit the section entirely when no item qualifies** — no placeholder or stub.
- **Signals** = noteworthy GOOD-or-NEUTRAL intelligence. Two kinds qualify: (1) repeating patterns — themes across **≥2 visits**, multi-week themes, or memory-backed themes (competitor insight, new spaces, category shifts); (2) notable one-off observations — e.g. market intel such as gaining access to another brand's sales data. Bad news NEVER goes in Signals — it belongs in Alerts. Use nested-bullet structure: bold headline → elaboration sub-bullets → "Sources:" sub-bullet. Analyst discipline for every pattern item: **cite the full evidence set** (one visit-level link PER contributing visit — the whole week's visits are in Step 2, so every leg is linkable; memory-backed legs cite `[🧠 <note title>](/intelligence/notes/<slug>)`), **quantify the base** ("3 of 7 SG visits this week, all T1" — numerator AND denominator with tier/market mix), and **note persistence** when memory notes show the theme ran in prior weeks.
- **Alerts** = BAD / needs attention: risks, problems, deteriorations, broken or overdue follow-ups (>10 days), competitor threats (conquering shelf/POS), brand resistance, stock-out/display defect at T1/T2, lost demos, a T1 store silent ≥7 days. Rule of thumb: Signals = good or neutral, Alerts = bad. Same nested-bullet structure and analyst discipline as Signals.
- **Engagements** = **rolled up by product or training topic — never a flat person list** (the count lives in the deterministic Execution Summary). Each product bullet: count trained + overall reception read (receptive / mixed / lukewarm), with ▲/▽ sub-bullets ONLY for genuinely standout responses — clearly-strong (▲) or clearly-weak/concerning (▽), named with visit link; an ordinary decent training session stays in the count. Standout *positive* receptions that qualify for Good News go there instead (not repeated here). Plus 1–3 `◆ **Consensus**` lines per week — general sentiment/awareness insights read across the week's engagements (e.g. floor staff broadly aware of the new promo; product familiarity low in MY chains); no visit link required.
- **Link forms** — every item grounded in a specific visit must use a visit-level link `[<store name> · <D Mon>](/visits/visit/<store_id>/<visit_id>?hl=<section>&q=<fragment>)`, and MUST append `?hl=<section>` where `<section>` identifies which of the 5 visit sections the item primarily drew from: `good_news` | `people_training` | `competitors` | `display_stock` | `follow_up`. `&q=<fragment>` carries the evidence: a short fragment (≤12 words) copied **verbatim** from that section's text, URL-encoded (spaces → `%20`; never raw spaces, `)`, or `&` inside the link) — the dashboard highlights that exact passage when the visit opens, so paraphrased fragments won't match. If an item drew from two sections of the same visit, emit two links with different `?hl=`. Memory-note sources: `[🧠 <note title>](/intelligence/notes/<slug>)`. Store-level links `[<store name>](/visits/store/<store_id>)` (no `?hl`) are the LAST RESORT — only for items with no source visit or note at all (e.g. store-silence alerts). All links render as click-to-open chips in the dashboard. `<store_id>` and `<visit_id>` must come from Step 2 — never fabricate.

## Step 4 — Write (single statement, dollar-quoted)
```sql
INSERT INTO sva.weekly_reports (week_start, version, brief_markdown, stats, visit_ids, model)
VALUES ('<WEEK_START>',
  COALESCE((SELECT MAX(version)+1 FROM sva.weekly_reports WHERE week_start='<WEEK_START>'),1),
  $body$<brief_markdown>$body$, $json$<stats>$json$::jsonb,
  ARRAY[<week visit_ids>]::uuid[], 'claude-routine');
```
`stats` = `{executed, engagements, productTrainings, activeCMs, totalCMs, storesCovered, totalStores, planned}` for the record (the dashboard computes its own live, but store a snapshot).

## Step 5 — Heartbeat (ALWAYS)
DM `HEARTBEAT_CHAT_ID`: `[sva-weekly] <WEEK_START>..<WEEK_END> · <N> visits · narrative written (v<version>)`. On abort/error DM the reason. Do not retry.

---

_Scheduling: a LaunchAgent (e.g. `com.wilson.sva-weekly`) fires this Monday ~07:30 SGT for the prior week. Manual regenerate = run this routine with the week's Monday + `force`. A future in-dashboard "Regenerate" button needs the Claude API (SVA Phase 3) — not wired yet._
