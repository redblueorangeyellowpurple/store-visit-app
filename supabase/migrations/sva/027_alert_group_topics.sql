-- 027: Forum-topic routing for visit broadcasts.
-- Each market row can now point at a specific forum topic within its group chat.
-- NULL = post to the group's General topic (existing behaviour, unchanged).
ALTER TABLE sva.alert_groups
  ADD COLUMN IF NOT EXISTS message_thread_id bigint;

COMMENT ON COLUMN sva.alert_groups.message_thread_id IS
  'Telegram forum topic thread id for this market. NULL posts to General.';
