-- Daily CM recap: per-CM opt-in flag, mirroring is_intelligence_recipient.
-- Recipients are chosen in the dashboard Admin tab. Defaults false so nobody
-- receives a recap until explicitly toggled on. The app-wide on/off kill switch
-- lives in sva.settings (key 'daily_recaps_enabled'), not here.

ALTER TABLE sva.cms
  ADD COLUMN IF NOT EXISTS is_recap_recipient boolean NOT NULL DEFAULT false;
