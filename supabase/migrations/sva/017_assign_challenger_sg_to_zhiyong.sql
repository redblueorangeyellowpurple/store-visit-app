-- Assign all Challenger SG stores to Zhi Yong (Ng Zhi Yong, tg 125229960).
-- Idempotent — re-running picks up any future Challenger SG stores too.

INSERT INTO sva.cm_store_assignments (cm_telegram_id, store_id)
SELECT 125229960, id
FROM sva.stores
WHERE market = 'SG' AND chain = 'Challenger' AND is_active = true
ON CONFLICT (cm_telegram_id, store_id) DO NOTHING;
