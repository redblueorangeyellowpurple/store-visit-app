# SVA Dashboard

AM/IC web dashboard for TC Store Visit App.

## Stack
- Next.js 16 + Tailwind 4 + TypeScript
- Same Supabase project as bot/miniapp (`sva` schema, service role)
- Auth: Telegram Login Widget → signed session cookie. **Dashboard is AM / CM IC / Admin only.** OAuth callback (`/api/auth/telegram`) looks up `sva.cms` by `telegram_id` and rejects plain CMs and non-registered users (redirect to `/login?error=cm_only|not_registered`). Role is baked into the cookie payload; middleware enforces it on every page/API request; API routes use `requireDashboardRole` as the security gate.

## Setup
1. Copy `.env.example` → `.env.local`, fill in vars
2. In BotFather: `/setdomain` → set to your Railway domain (required for Telegram Login Widget)
3. `npm install && npm run dev`

## Conventions
- Every page component must run all hooks unconditionally — auth/loading gates (`if (!user) return null`) go on the JSX `return`, NOT above the `useMemo`/`useEffect` calls. Violating this throws React error #310 in production. App ships `app/error.tsx` so any future hook-order or render bug surfaces inline instead of as a browser-level "page couldn't load". See `claude-os-knowledge/insights/learnings/react-hooks-after-early-return.md`.

## Env vars
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — same as bot/miniapp
- `TELEGRAM_BOT_TOKEN` — same as bot
- `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` — bot username without @
- `SESSION_SECRET` — random 32+ char string (`openssl rand -hex 32`)

## Deploy (Railway)
- Root Directory: `/dashboard`
- Watch paths: `dashboard/**`
- Build: `npm run build`, Start: `npm start`
- Add all env vars to the Railway service

## Routes
- `/` — Home: **3-column layout mirroring `/visits`** — left section nav (Statistics/Intelligence/Memory), middle content (KPI cards, CM execution, by-market/tier, stores-visited table, intelligence brief, memory notes), right **detail drawer**. Clicking a store/CM name opens the shared `StoreDetailPanel`/`CMDetailPanel` (from `@/components/DetailPanels`, kernel in `@/lib/visit-shared`); KPI cards open a history/breakdown drawer (weekly trend from `payroll.counts`, no extra fetch); memory notes open `MemoryNoteDrawer`. Each entity/KPI drawer deep-links into `/visits?store=|cm=|from=&to=` (the visits page seeds `selection`/`filterCMs` from those query params).
- `/intelligence` — Daily Intelligence: brief reader (date chips + edit-as-new-version) + memory browser (5 scope tabs, search, sort, tier filter, 🔗 touched-in-this-brief toggle). Visible to all dashboard roles.
- `/intelligence/notes/[slug]` — Single memory note (full content + version history + edit-as-new-version)
- `/visits` — Store Updates: 2-up card grid; section chips are **single-section focus** (tap Good News → only Good News visits + only that section card per visit), not multi-select "has" filters; sections inside cards stack 1-column
- `/staff` — Store Staff: store-grouped roster of store-side staff/allies, ally toggle, training pills (count + last-trained + products) from `visit_staff` (mig 005); market chips + search + filter chips
- `/channel-managers` — Channel Managers: AM-grouped CM cards with assigned-store list + per-store unassign (×) + `+ Add store…` picker (scoped to CM's market). Writes to `sva.cm_store_assignments`.
- `/admin` — **Admin role only** (path-gated in `middleware.ts`, API routes use `requireAdmin`). Three cards: (1) **People** — pending join requests with inline market-pick Approve/Reject, manual Add Person form, active people table with editable role/market/AM and toggles for `is_intelligence_recipient` + `is_join_request_admin` (the two notification flags are decoupled from dashboard role — admins manage who-can-edit, toggles control who-gets-notified). (2) **Alert groups** — per-market chat_id + intelligence_mode (`people` / `group` / `both`) + Test button. (3) **Stores** — full CRUD with inline-editable cells, market/tier selects, deactivate/reactivate.
- `/login` — Telegram login widget
- `/api/auth/telegram` — OAuth callback (public)
- `/api/auth/me` — current session user
- `/api/auth/logout` — POST to clear cookie
- `/api/stats` — team stats
- `/api/overview` — stats + store status (payroll moved out)
- `/api/payroll?from=&to=` — weekly payroll grid (added 2026-05-17). Default range: last 4 weeks. Co-CM credit via `sva.visit_cms` when available; falls back to lead CM only.
- `/api/visits` — visit feed (GET, paginated, filterable)
- `/api/staff` — staff list with training aggregates (GET) + ally toggle (PATCH)
- `/api/cms` — active CMs with their assigned stores + all stores (GET, for Channel Managers tab)
- `/api/cms/assignments` — assign (POST) / unassign (DELETE) — body `{ cm_telegram_id, store_id }`. Writes to `sva.cm_store_assignments`
- `/api/filters` — CM + store options for filter dropdowns
- `/api/admin/people` — GET active + pending people / POST manual add (telegram_id, full_name, role, market) / PATCH (role, market, am_telegram_id, is_active, is_intelligence_recipient, is_join_request_admin). All admin-only.
- `/api/admin/people/approve` — POST `{ telegram_id, market, role? }` — mirrors bot inline-Approve callback. Defaults role to `cm`.
- `/api/admin/people/reject` — POST `{ telegram_id }` — only deletes rows still marked pending.
- `/api/admin/alert-groups` — GET 4 market rows / PATCH `{ market, chat_id?, intelligence_mode? }`. Writes to `sva.alert_groups`.
- `/api/admin/alert-groups/test` — POST `{ market }` → calls Telegram Bot API directly with shared `TELEGRAM_BOT_TOKEN`, sends a probe message to the configured chat_id. Returns 400 if no chat_id set for that market.
- `/api/admin/stores` — GET / POST (add) / PATCH (edit any field incl. soft-delete via `is_active`). Validates market ∈ SG/MY/TH/HK and tier ∈ T1–T4.
