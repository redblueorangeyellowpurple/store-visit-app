-- 013_admin_layer.sql
-- Per-country alert routing + flag-based notification recipients.
-- Backs the dashboard Admin tab (stores CRUD, people CRUD, alert config).
--
-- Notification routing decoupled from dashboard role:
--   - role='admin' grants dashboard /admin access (anyone)
--   - is_join_request_admin grants Telegram DM for new join requests (Wilson only by default)
--   - is_intelligence_recipient grants Telegram DM for daily intelligence brief (Wilson only by default)
--
-- Idempotently includes is_intelligence_recipient since migration 008 isn't applied on remote yet.

-- ─── Per-market alert configuration ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sva.alert_groups (
  market                  text        PRIMARY KEY
                                      CHECK (market IN ('SG','MY','HK','TH')),
  chat_id                 bigint,
  intelligence_mode       text        NOT NULL DEFAULT 'people'
                                      CHECK (intelligence_mode IN ('people','group','both')),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by_telegram_id  bigint
);

INSERT INTO sva.alert_groups (market) VALUES ('SG'),('MY'),('HK'),('TH')
  ON CONFLICT (market) DO NOTHING;

-- ─── Notification recipient flags on sva.cms ─────────────────────────────────

ALTER TABLE sva.cms
  ADD COLUMN IF NOT EXISTS is_join_request_admin boolean NOT NULL DEFAULT false;

ALTER TABLE sva.cms
  ADD COLUMN IF NOT EXISTS is_intelligence_recipient boolean NOT NULL DEFAULT false;

-- Permissions inherit from sva schema defaults (service_role).
