-- Add Harvey Norman @ Lot One (SG, T1) and assign it to Johnathan Tan.
-- Idempotent — safe to re-run.

INSERT INTO sva.stores (name, chain, market, tier) VALUES
  ('Harvey Norman @ Lot One', 'Harvey Norman', 'SG', 'T1')
ON CONFLICT (name, market) DO NOTHING;

-- Tag Johnathan Tan (tg 29347638) to the new store.
INSERT INTO sva.cm_store_assignments (cm_telegram_id, store_id)
SELECT 29347638, id
FROM sva.stores
WHERE market = 'SG' AND name = 'Harvey Norman @ Lot One' AND is_active = true
ON CONFLICT (cm_telegram_id, store_id) DO NOTHING;
