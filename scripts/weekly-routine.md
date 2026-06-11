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

-- open follow-ups older than 10 days (for the Alerts "overdue" line);
-- visit_id/store_id let the alert link the ORIGINATING visit (?hl=follow_up)
SELECT s.name AS store, fu.title, fu.store_id, fu.visit_id,
       (CURRENT_DATE - fu.created_at::date) AS age_days
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
_How the floor felt after trainings + relationship touches_
- ◆ **<product or topic> — <receptive / mixed / lukewarm / unreadable>** — <how the floor felt after the week's trainings, 1–2 sentences; standout reactions as inline quote-chips: ["<verbatim ≤10-word quote>"](/visits/visit/<store_id>/<visit_id>?hl=people_training&q=<same fragment>)>
  - Sources (<N>): <chain> · [<store> · <D Mon>](/visits/visit/<store_id>/<visit_id>?hl=people_training) [<store> · <D Mon>](/visits/visit/<store_id>/<visit_id>?hl=people_training) — <chain> · … · [🧠 <note title>](/intelligence/notes/<slug>)
- **<person> (<chain> @ <store>)** — <relationship touch ≤15 words: new ally, access granted, manager talk, promo coordination> — [<store> · <D Mon>](/visits/visit/<store_id>/<visit_id>?hl=people_training&q=<fragment>)
```

Rules:
- **Universal sourcing (every section).** Every item ends with a complete `Sources:` line (or Sources cell): one visit-level link per contributing visit PLUS one `[🧠 <note title>](/intelligence/notes/<slug>)` link per memory note that informed the item. Any persistence claim ("multi-week run", "trained w/c 3 Jun") MUST be backed by a cited 🧠 note or prior-brief date — no uncited multi-week claims; if nothing backs it, reword to this-week-only. When a Sources line carries **more than 4 links**, write it as `Sources (<N>): …` with `<N>` = the exact link count — the dashboard collapses counted Sources lines into a tap-to-expand row; with 4 or fewer links use the plain `Sources:` form.
- **One-home rule.** A named person or win gets its full quote treatment in exactly ONE section — precedence Good News > Signals/Alerts > Engagements. Elsewhere they are part of a count or at most a brief cross-mention. Never repeat the same person+quote in two sections. Post-training reception reads — however enthusiastic — home in **Engagements**; a reception only leaves it for Good News when it clears that bar, and Signals picks up training only as follow-through (kind 3 below), never the reception itself.
- **Good News** — concrete wins ONLY. Qualifies: closed sale or large order, won or expanded display space, new ally recruited, competitor displaced, **a standout training reception** (staff visibly enthusiastic, committing to push the product, or asking for sell-in — name the person). Does NOT qualify: routine positivity, vague momentum, a good conversation. **No count cap** — the bar is strict but the list is not: if many wins qualify, list them all. **Omit the section entirely when no item qualifies** — no placeholder or stub.
- **Signals** = noteworthy GOOD-or-NEUTRAL intelligence. Three kinds qualify: (1) repeating patterns — themes across **≥2 visits**, multi-week themes, or memory-backed themes (competitor insight, new spaces, category shifts); (2) notable one-off observations — e.g. market intel such as gaining access to another brand's sales data; (3) **training follow-through** — a product trained in a PRIOR week (memory notes carry this) now showing on-the-ground selling evidence in this week's visits (staff quoting it to customers, sell-through mentions, display prominence) — or conspicuously NOT, despite heavy training. We have no sales-system data; ground this only in visit text and memory notes, and say which it is ("trained 6 staff w/c 3 Jun → 2 stores now report it moving" vs "no selling signal yet"). Bad news NEVER goes in Signals — it belongs in Alerts. Use nested-bullet structure: bold headline → elaboration sub-bullets → "Sources:" sub-bullet. Analyst discipline for every pattern item: **cite the full evidence set** (one visit-level link PER contributing visit — the whole week's visits are in Step 2, so every leg is linkable; memory-backed legs cite `[🧠 <note title>](/intelligence/notes/<slug>)`), **quantify the base** ("3 of 7 SG visits this week, all T1" — numerator AND denominator with tier/market mix), and **note persistence** when memory notes show the theme ran in prior weeks.
- **Alerts** = BAD / needs attention: risks, problems, deteriorations, broken or overdue follow-ups (>10 days), competitor threats (conquering shelf/POS), brand resistance, stock-out/display defect at T1/T2, lost demos, a T1 store silent ≥7 days. Rule of thumb: Signals = good or neutral, Alerts = bad. Same nested-bullet structure and analyst discipline as Signals. Overdue-follow-up items link each follow-up's ORIGINATING visit — `[<store> · <D Mon>](/visits/visit/<store_id>/<visit_id>?hl=follow_up)` using `fu.visit_id`/`fu.store_id` from Step 2 — not the store.
- **Engagements** = the qualitative layer of the week's staff/ally engagements: how the floor FELT after trainings, plus relationship touches. Counts live in the deterministic Execution Summary — no table, no Trained/Stores columns, never a flat trainee list; a number appears in prose only when it IS the story (e.g. the scale of an unreadable blind spot). Structure: (a) ≤3 `- ◆ **<product or topic> — <verdict>**` bullets, one per product/topic trained this week — a post-training sentiment read (receptive / mixed / lukewarm / unreadable) in 1–2 sentences naming clearly-standout reactions, good or bad, with standout quotes as inline quote-chips `["<verbatim quote ≤10 words>"](/visits/visit/<store_id>/<visit_id>?hl=people_training&q=<same fragment URL-encoded>)` (the quote is the chip label, max 2–3 per bullet); when reception can't be read (names-only logs), say so — that IS the read. (b) Every ◆ bullet ends with a `- Sources:` sub-bullet listing ONE link per visit where the product was trained (`?hl=people_training`), grouped by chain when >6 ("TechLife · [Telford · 3 Jun] [APM · 4 Jun] — AVLife · [Sogo · 3 Jun]"), plus any 🧠 notes that informed the read — counted `Sources (<N>):` collapse form when >4 links. (c) One `- **<person> (<chain> @ <store>)**` bullet per non-training engagement that cleared no other section's bar — manager talks, new allies/contacts, access granted, promo/roadshow coordination — ≤15-word note + the visit link inline at the end. **Routing:** market/competitor intel a staff member shares during an engagement is intelligence, not an engagement — it goes to Signals (good/neutral) or Alerts (bad), linked `?hl=people_training`; receptions that clear the Good News bar go there; training follow-through (selling evidence) is Signals kind 3, not an Engagement. Engagements holds the reception reads and the relationship leftovers.
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
