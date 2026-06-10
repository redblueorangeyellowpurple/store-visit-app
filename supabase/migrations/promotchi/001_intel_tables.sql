-- Promoter intelligence layer — lives in the promotchi schema (all promoter data
-- in one place) but is OWNED by the SVA intelligence system, not the Promotchi app:
-- written by the local intel-inbox bot (scripts/intel-inbox/) + the 7am routine,
-- read by the SVA weekly report. The intel_ prefix marks the boundary — Promotchi
-- app code never touches these tables. RLS on with no policies (service role only),
-- matching the rest of the promotchi schema.

-- One row per promoter shift report (a forwarded group-chat message, or post-launch
-- a Promotchi store update). Raw capture + Wilson's tags; the 7am routine fills
-- crowd/notes and explodes customer-level detail into intel_interactions.
create table promotchi.intel_updates (
  id uuid primary key default gen_random_uuid(),
  promoter_name text,
  promoter_id bigint,                         -- soft link to promotchi.promoters.tg_user_id once promoters onboard; no FK while they pre-date launch
  store_label text,                           -- raw label as the promoter wrote it, e.g. "CWP"
  store_id uuid references sva.stores(id),
  shift_date date,
  shift_type text check (shift_type in ('AM', 'PM', 'FD')),
  crowd jsonb,                                -- { flow_estimate, peak_hours, age_group, shopper_type } — parser-filled
  notes text,                                 -- shift-level observations — parser-filled
  raw_content text not null,
  source text not null default 'forwarded' check (source in ('forwarded', 'bot')),
  submitted_at timestamptz,                   -- when the promoter originally sent it (forward_origin date)
  parsed_at timestamptz,                      -- null = awaiting the routine's parse step
  created_at timestamptz not null default now()
);

-- One row per customer interaction extracted from an update by the routine.
create table promotchi.intel_interactions (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references promotchi.intel_updates(id) on delete cascade,
  time_block text,
  intention text,
  products_pitched text[] not null default '{}',
  products_sold text[] not null default '{}',
  outcome text check (outcome in ('sold', 'will_return', 'considering', 'lost', 'browsing')),
  objection text,
  objection_type text check (objection_type in ('price', 'feature_gap', 'stock', 'channel_price', 'competitor_pref', 'other')),
  competitor_brands text[] not null default '{}',
  follow_up boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

-- Promoter shorthand -> store master. Taught once via the inbox bot's store
-- picker ("CWP" -> Challenger @ Causeway Point), reused on every later forward.
create table promotchi.intel_store_aliases (
  alias text primary key,                     -- always lowercased
  store_id uuid not null references sva.stores(id),
  note text,
  created_at timestamptz not null default now()
);

alter table promotchi.intel_updates enable row level security;
alter table promotchi.intel_interactions enable row level security;
alter table promotchi.intel_store_aliases enable row level security;

create index intel_updates_unparsed_idx on promotchi.intel_updates (created_at) where parsed_at is null;
create index intel_updates_store_date_idx on promotchi.intel_updates (store_id, shift_date);
create index intel_interactions_update_idx on promotchi.intel_interactions (update_id);
