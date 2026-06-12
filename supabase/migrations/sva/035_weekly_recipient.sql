-- 035: Weekly-only intelligence recipients.
-- Splits notification cadence from the daily brief. is_intelligence_recipient
-- (mig 008) stays the DAILY brief opt-in; this new flag opts a person into the
-- Monday weekly-report ping instead. The two are independent — someone can be
-- daily-only, weekly-only, both, or neither.
ALTER TABLE sva.cms
  ADD COLUMN IF NOT EXISTS is_weekly_recipient boolean NOT NULL DEFAULT false;
