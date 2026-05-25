# TC SVA — Bot + Mini App

Owner: Wilson Tan (TC Acoustic) · Active project

---

## What's Here

Two services in one repo, both deploy off `wilson/sva-bot-v2`:

- **Bot** at repo root (`src/`) — TypeScript + grammY. Capture engine: ≤2-min visit logging via `/visit` (5-section template + photos + auto-lock). Auth via `sva.cms` allowlist by `telegram_id`.
- **Mini app** at `miniapp/` — Next.js 16 + Tailwind 4. Richer CM views: portfolio, per-store timeline, full visit + photo lightbox. Telegram `initData` HMAC auth against the same `sva.cms` table.

Decision rule: see `[[surface-tiers]]` in claude-os-knowledge. **Bot = chat-fast capture. Mini app = mobile-but-richer thinking. Future web dashboard = AM/IC desk-time.**

---

## Architecture

- `sva` Postgres schema — isolated from CultivAIte's `public` schema on the same Supabase project
- Supabase JS client with `db: { schema: 'sva' }` — all `.from()` calls routed automatically
- Service role only, no RLS
- Photo storage: `sva-photos` bucket (private, signed URLs) at `{store_id}/{visit_id}/{uuid}.jpg`
- Bot photo collection: process-level `Map<telegramId, PhotoCollection>` + 2s debounce, using `bot.api` singleton (not conversation ctx)
- Mini app Supabase client: lazy-init via Proxy (avoids "Collecting page data" build crash — see `[[nextjs]]`)
- **Per-market alert routing (mig 013)** — `sva.alert_groups` table (one row per market) holds `chat_id` + `intelligence_mode`. Visit-lock broadcasts resolve chat by `visit.store.market`; falls back to DMing CMs flagged `is_join_request_admin` if no chat is set. Join-request broadcasts always go to the flagged admin set (NOT a group chat). Intelligence brief: always delivered to `is_intelligence_recipient=true` people; markets with `intelligence_mode in ('group','both')` also push to their `chat_id`. The two `cms` flags are intentionally decoupled from dashboard `role` — admin role grants `/admin` access, flags control DM routing.

---

## Env Vars (shared across services)

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET` (bot only)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WEBHOOK_DOMAIN` (bot only)
- `PORT` (Railway sets this automatically)

When adding new env-dependent code in the miniapp, **match these names** — don't introduce `BOT_TOKEN` / `SUPABASE_SERVICE_KEY` short forms.

---

## Deployment

Both services live in the same Railway project but as **separate services**:

- Bot — Root Directory `/`, watches all paths, runs `node dist/index.js`
- Miniapp — Root Directory `/miniapp`, watch paths `miniapp/**`, runs `npm start`

Each service has its own `railway.toml` — the bot's at repo root, the miniapp's at `miniapp/railway.toml`. Without the second toml, Railway leaks the bot's `startCommand` to the miniapp service.

---

## Key Files

### Bot
- `src/bot/conversations/visit-flow.ts` — main visit flow
- `src/bot/photo-collection.ts` — debounce handler; init with `bot.api`
- `src/bot/bot.ts` — handler registration + Edit/Delete/Confirm/View callbacks
- `src/bot/commands/` — start, help, mystores, myvisits, storevisits, visit, cancel, admin/*
- `src/db/queries/` — cms, visits, stores, photos, visit-plans, staff, **alert-groups** (per-market chat + intelligence mode + join-request admin set)
- `src/notifications/admin-notify.ts` — DM every flagged `is_join_request_admin` CM; used as fallback when a market has no alert chat
- `src/utils/parse-template.ts` — position-based 5-section parser

### Mini app
- `miniapp/src/lib/supabase.ts` — lazy-init Supabase client (Proxy)
- `miniapp/src/lib/miniapp-auth.ts` — Telegram `initData` HMAC verify
- `miniapp/src/lib/queries.ts` — portfolio, store timeline, full visit + signed URLs
- `miniapp/src/app/(miniapp)/m/*` — three pages: portfolio, store/[id], visit/[id]
- `miniapp/src/app/api/m/*` — whoami, portfolio, store/[id], visit/[id]
- `miniapp/src/app/health/route.ts` — Railway healthcheck

---

## Editing Conventions

- TypeScript strict mode. No `any` unless escaping a Supabase generic.
- Imports use `.js` extension (NodeNext module resolution) for the bot side. Mini app uses bundler resolution — no extension needed.
- Don't touch `q2_ai-taskforce/` or `tc_store-visit-app/` — those are abandoned/archived.
- Knowledge captures and reflections go in `claude-os-knowledge/`, not here.
