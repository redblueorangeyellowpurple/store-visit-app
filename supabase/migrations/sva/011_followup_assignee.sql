-- 011_followup_assignee.sql
-- Add an assignee on follow-up tasks. Defaults to the creator (cm_telegram_id)
-- for existing rows so nothing changes for already-open tasks.

ALTER TABLE sva.visit_follow_ups
  ADD COLUMN IF NOT EXISTS assigned_to_telegram_id bigint REFERENCES sva.cms(telegram_id);

UPDATE sva.visit_follow_ups
  SET assigned_to_telegram_id = cm_telegram_id
  WHERE assigned_to_telegram_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_follow_ups_assignee_open
  ON sva.visit_follow_ups(assigned_to_telegram_id) WHERE status = 'open';
