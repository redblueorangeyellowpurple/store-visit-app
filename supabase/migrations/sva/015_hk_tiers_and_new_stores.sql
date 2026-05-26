-- HK store tiering update + 19 new stores (sourced from HK team list, 2026-05-27)
-- 1. Re-tier existing 20 HK stores (most were placeholder T2 from migrations 012/014)
-- 2. Add 19 new HK stores: 9 TechLife, 8 AVLife, 2 from new chains (Fortress, Cosmic Tech)
-- 3. Re-assign every HK store to Ricky so the new rows pick up his coverage

-- ─── 1. Tier updates on existing HK stores ──────────────────────────────────

UPDATE sva.stores SET tier = 'T1' WHERE market = 'HK' AND name = 'TechLife @ City Plaza';
UPDATE sva.stores SET tier = 'T1' WHERE market = 'HK' AND name = 'TechLife @ Melbourne Plaza';
UPDATE sva.stores SET tier = 'T1' WHERE market = 'HK' AND name = 'TechLife @ New Town Plaza';
UPDATE sva.stores SET tier = 'T1' WHERE market = 'HK' AND name = 'TechLife @ Ocean Centre';
UPDATE sva.stores SET tier = 'T1' WHERE market = 'HK' AND name = 'TechLife @ Times Square';
UPDATE sva.stores SET tier = 'T3' WHERE market = 'HK' AND name = 'TechLife @ Whampoa';
UPDATE sva.stores SET tier = 'T3' WHERE market = 'HK' AND name = 'TechLife @ Tsing Yi';
UPDATE sva.stores SET tier = 'T4' WHERE market = 'HK' AND name = 'TechLife @ The Wai';
UPDATE sva.stores SET tier = 'T3' WHERE market = 'HK' AND name = 'TechLife @ Ma On Shan';
UPDATE sva.stores SET tier = 'T3' WHERE market = 'HK' AND name = 'TechLife @ Metro Plaza';
UPDATE sva.stores SET tier = 'T3' WHERE market = 'HK' AND name = 'TechLife @ Olympian City';
UPDATE sva.stores SET tier = 'T3' WHERE market = 'HK' AND name = 'TechLife @ Tai Po';
-- TechLife @ Telford and TechLife @ Tung Chung stay T2

UPDATE sva.stores SET tier = 'T1' WHERE market = 'HK' AND name = 'AVLife @ Sogo';
UPDATE sva.stores SET tier = 'T3' WHERE market = 'HK' AND name = 'AVLife @ Tsuen Wan Plaza';
-- AVLife @ K11 stays T2

UPDATE sva.stores SET tier = 'T1' WHERE market = 'HK' AND name = 'API Super King';
UPDATE sva.stores SET tier = 'T1' WHERE market = 'HK' AND name = 'API SuperKing CWB';
UPDATE sva.stores SET tier = 'T1' WHERE market = 'HK' AND name = 'API Radio Unison';

-- ─── 2. New HK stores ──────────────────────────────────────────────────────

INSERT INTO sva.stores (name, chain, market, tier) VALUES
  -- TechLife (9 new)
  ('TechLife @ APM',             'TechLife',    'HK', 'T3'),
  ('TechLife @ Tsuen Wan Plaza', 'TechLife',    'HK', 'T3'),
  ('TechLife @ Tuen Mun Town',   'TechLife',    'HK', 'T3'),
  ('TechLife @ Wai Fung',        'TechLife',    'HK', 'T3'),
  ('TechLife @ PopCorn',         'TechLife',    'HK', 'T4'),
  ('TechLife @ YOHO',            'TechLife',    'HK', 'T2'),
  ('TechLife @ Diamond Hill',    'TechLife',    'HK', 'T3'),
  ('TechLife @ Festival Walk',   'TechLife',    'HK', 'T3'),
  ('TechLife @ Elements',        'TechLife',    'HK', 'T2'),
  -- AVLife (8 new)
  ('AVLife @ New Town Plaza',    'AVLife',      'HK', 'T2'),
  ('AVLife @ Times Square',      'AVLife',      'HK', 'T2'),
  ('AVLife @ City Plaza',        'AVLife',      'HK', 'T3'),
  ('AVLife @ East Point City',   'AVLife',      'HK', 'T3'),
  ('AVLife @ Lok Fu',            'AVLife',      'HK', 'T3'),
  ('AVLife @ Olympian City',     'AVLife',      'HK', 'T3'),
  ('AVLife @ Tuen Mun',          'AVLife',      'HK', 'T3'),
  ('AVLife @ Wong Chuk Hang',    'AVLife',      'HK', 'T3'),
  -- New chains (2)
  ('Fortress @ Golden Centre',   'Fortress',    'HK', 'T3'),
  ('Cosmic Tech @ SSP',          'Cosmic Tech', 'HK', 'T3')
ON CONFLICT (name, market) DO NOTHING;

-- ─── 3. Re-assign all HK stores to Ricky (idempotent) ──────────────────────

INSERT INTO sva.cm_store_assignments (cm_telegram_id, store_id)
SELECT 100102635, id
FROM sva.stores
WHERE market = 'HK' AND is_active = true
ON CONFLICT (cm_telegram_id, store_id) DO NOTHING;
