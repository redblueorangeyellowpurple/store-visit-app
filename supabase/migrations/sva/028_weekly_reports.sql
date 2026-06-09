-- 028: Weekly report narrative storage (Signals / Alerts / Engagements).
-- Mirrors sva.intelligence_reports but keyed by the Mon–Sun week start, isolated
-- from the daily report so the daily view/queries carry zero risk.
-- Deterministic sections (stats, coverage, display) are computed live by the
-- dashboard aggregator; only the AI-synthesized narrative lives here.
create table if not exists sva.weekly_reports (
  id                 uuid primary key default gen_random_uuid(),
  week_start         date not null,                 -- Monday of the Mon–Sun week
  version            integer not null default 1,
  brief_markdown     text not null,
  stats              jsonb not null default '{}'::jsonb,
  visit_ids          uuid[] not null default '{}'::uuid[],
  model              text,
  prompt_tokens      integer,
  completion_tokens  integer,
  edited_by_human    boolean not null default false,
  created_at         timestamptz not null default now()
);

create unique index if not exists weekly_reports_week_version
  on sva.weekly_reports (week_start, version);

-- Latest version per week (mirrors v_intelligence_reports_current).
create or replace view sva.v_weekly_reports_current as
  select distinct on (week_start) *
  from sva.weekly_reports
  order by week_start, version desc;
