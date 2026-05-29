-- Challenger SG expansion: re-tier existing 8 + add 41 new stores (2026-05-30)
-- Tiering sourced from Zhi Yong's store-visit rhythm (forwarded by Wilson).
--   T1 = weekly visit · T2 = biweekly · everything else = T3.
-- Conflict rule (Wilson): where a new name = an existing store, keep the
--   current row and re-tier it — do NOT rename or duplicate.
--   • "Vivo City"      = existing "Challenger @ Vivocity"  (stays T1)
--   • "ION B3"         = existing "Challenger @ ION"       (re-tier T2)
--   • "Bugis Flagship" = existing "Challenger @ Bugis B1"  (re-tier T1)
--   New rows added for the genuinely distinct storefronts:
--   "Musica Boutique (ION)" (ION L4) and "Bugis Junction (L3)".

-- ─── 1. Re-tier existing Challenger SG stores per the new rhythm ────────────

UPDATE sva.stores SET tier = 'T1' WHERE market = 'SG' AND name = 'Challenger @ Bugis B1';        -- Bugis Flagship
UPDATE sva.stores SET tier = 'T1' WHERE market = 'SG' AND name = 'Challenger @ Causeway Point';
UPDATE sva.stores SET tier = 'T1' WHERE market = 'SG' AND name = 'Challenger @ JEM';
UPDATE sva.stores SET tier = 'T1' WHERE market = 'SG' AND name = 'Challenger @ Jurong Point';
UPDATE sva.stores SET tier = 'T1' WHERE market = 'SG' AND name = 'Challenger @ NEX';
UPDATE sva.stores SET tier = 'T2' WHERE market = 'SG' AND name = 'Challenger @ ION';             -- ION B3 & L4
UPDATE sva.stores SET tier = 'T2' WHERE market = 'SG' AND name = 'Challenger @ Plaza Singapura';
-- Challenger @ Vivocity already T1 — no change.

-- ─── 2. New Challenger SG stores ───────────────────────────────────────────

INSERT INTO sva.stores (name, chain, market, tier) VALUES
  -- T2 (biweekly rhythm)
  ('Challenger @ 313 Somerset',          'Challenger', 'SG', 'T2'),
  ('Challenger @ Ang Mo Kio',            'Challenger', 'SG', 'T2'),
  ('Challenger @ Jewel',                 'Challenger', 'SG', 'T2'),
  ('Challenger @ Musica Boutique (ION)', 'Challenger', 'SG', 'T2'),  -- ION L4
  ('Challenger @ North Point',           'Challenger', 'SG', 'T2'),
  ('Challenger @ Tampines Mall',         'Challenger', 'SG', 'T2'),
  -- T3 (the rest)
  ('Challenger @ Aperia Mall',           'Challenger', 'SG', 'T3'),
  ('Challenger @ Bedok Mall',            'Challenger', 'SG', 'T3'),
  ('Challenger @ Bugis Junction (L3)',   'Challenger', 'SG', 'T3'),
  ('Challenger @ Bukit Panjang Plaza',   'Challenger', 'SG', 'T3'),
  ('Challenger @ Changi City Point',     'Challenger', 'SG', 'T3'),
  ('Challenger @ City Square Mall',      'Challenger', 'SG', 'T3'),
  ('Challenger @ Clementi Mall',         'Challenger', 'SG', 'T3'),
  ('Challenger @ Compass One',           'Challenger', 'SG', 'T3'),
  ('Challenger @ Corporate Sales',       'Challenger', 'SG', 'T3'),
  ('Challenger @ Downtown East',         'Challenger', 'SG', 'T3'),
  ('Challenger @ Funan',                 'Challenger', 'SG', 'T3'),
  ('Challenger @ Great World City',      'Challenger', 'SG', 'T3'),
  ('Challenger @ Headquarters',          'Challenger', 'SG', 'T3'),
  ('Challenger @ Hougang Mall',          'Challenger', 'SG', 'T3'),
  ('Challenger @ IMM',                   'Challenger', 'SG', 'T3'),
  ('Challenger @ J8',                    'Challenger', 'SG', 'T3'),
  ('Challenger @ JCube',                 'Challenger', 'SG', 'T3'),
  ('Challenger @ Lot 1',                 'Challenger', 'SG', 'T3'),
  ('Challenger @ Parkway Parade',        'Challenger', 'SG', 'T3'),
  ('Challenger @ Pasir Ris Mall',        'Challenger', 'SG', 'T3'),
  ('Challenger @ Paya Lebar Quarter',    'Challenger', 'SG', 'T3'),
  ('Challenger @ Raffles City',          'Challenger', 'SG', 'T3'),
  ('Challenger @ Seletar Mall',          'Challenger', 'SG', 'T3'),
  ('Challenger @ Sengkang Grand Mall',   'Challenger', 'SG', 'T3'),
  ('Challenger @ Singapore Post Centre', 'Challenger', 'SG', 'T3'),
  ('Challenger @ Sun Plaza',             'Challenger', 'SG', 'T3'),
  ('Challenger @ Suntec City',           'Challenger', 'SG', 'T3'),
  ('Challenger @ Tampines 1',            'Challenger', 'SG', 'T3'),
  ('Challenger @ Tiong Bahru',           'Challenger', 'SG', 'T3'),
  ('Challenger @ Waterway Point',        'Challenger', 'SG', 'T3'),
  ('Challenger @ West Gate',             'Challenger', 'SG', 'T3'),
  ('Challenger @ West Mall',             'Challenger', 'SG', 'T3'),
  ('Challenger @ White Sands',           'Challenger', 'SG', 'T3'),
  ('Challenger @ Woodleigh Mall',        'Challenger', 'SG', 'T3'),
  ('Challenger @ Yew Tee Point',         'Challenger', 'SG', 'T3')
ON CONFLICT (name, market) DO NOTHING;
