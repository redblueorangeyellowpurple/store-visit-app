-- Seed 3 HK API stores (API SuperKing CWB, API Super King, API Radio Unison)
-- Assign all HK stores to Ricky (telegram_id 100102635)
-- Assign the 3 new API stores to Ginger (telegram_id 228312108)

INSERT INTO sva.stores (name, chain, market, tier) VALUES
  ('API SuperKing CWB',  'API', 'HK', 'T2'),
  ('API Super King',     'API', 'HK', 'T2'),
  ('API Radio Unison',   'API', 'HK', 'T2')
ON CONFLICT (name, market) DO NOTHING;

-- Ricky → every active HK store
INSERT INTO sva.cm_store_assignments (cm_telegram_id, store_id)
SELECT 100102635, id
FROM sva.stores
WHERE market = 'HK' AND is_active = true
ON CONFLICT (cm_telegram_id, store_id) DO NOTHING;

-- Ginger → the 3 new API stores
INSERT INTO sva.cm_store_assignments (cm_telegram_id, store_id)
SELECT 228312108, id
FROM sva.stores
WHERE market = 'HK' AND chain = 'API'
ON CONFLICT (cm_telegram_id, store_id) DO NOTHING;
