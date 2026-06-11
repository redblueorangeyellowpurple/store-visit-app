-- 002_pd_snapshots.sql — PD snapshot handoff table.
-- WRITTEN by the SVA intelligence routine (Step 5.6); READ by the Promotchi bot
-- (8am admin DM) + mini app (admin-gated Intel pane). This is the one sanctioned
-- crossing of the intel/Promotchi boundary: Promotchi reads snapshots, never
-- the intel_* tables themselves.
-- stats jsonb: { kind, updates, promoters, stores, customers, sales, headline }
--   headline = one plain-text line for the DM body.

CREATE TABLE IF NOT EXISTS promotchi.pd_snapshots (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date date        NOT NULL,
  kind          text        NOT NULL CHECK (kind IN ('daily','weekly')),
  markdown      text        NOT NULL,
  stats         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, kind)
);

-- RLS on, no policies: service-role only, like 001.
ALTER TABLE promotchi.pd_snapshots ENABLE ROW LEVEL SECURITY;
