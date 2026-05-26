-- Seed 17 Hong Kong stores (14 TechLife + 3 AVLife)
-- TL prefix in source list normalized to TechLife (same chain, abbreviation only)

INSERT INTO sva.stores (name, chain, market, tier) VALUES
  ('TechLife @ Telford',          'TechLife', 'HK', 'T2'),
  ('TechLife @ City Plaza',       'TechLife', 'HK', 'T2'),
  ('TechLife @ Whampoa',          'TechLife', 'HK', 'T2'),
  ('TechLife @ Ocean Centre',     'TechLife', 'HK', 'T2'),
  ('TechLife @ Tsing Yi',         'TechLife', 'HK', 'T2'),
  ('TechLife @ Tung Chung',       'TechLife', 'HK', 'T2'),
  ('TechLife @ Times Square',     'TechLife', 'HK', 'T2'),
  ('TechLife @ Melbourne Plaza',  'TechLife', 'HK', 'T2'),
  ('TechLife @ New Town Plaza',   'TechLife', 'HK', 'T2'),
  ('TechLife @ The Wai',          'TechLife', 'HK', 'T2'),
  ('TechLife @ Ma On Shan',       'TechLife', 'HK', 'T2'),
  ('TechLife @ Metro Plaza',      'TechLife', 'HK', 'T2'),
  ('TechLife @ Olympian City',    'TechLife', 'HK', 'T2'),
  ('TechLife @ Tai Po',           'TechLife', 'HK', 'T2'),
  ('AVLife @ Sogo',               'AVLife',   'HK', 'T2'),
  ('AVLife @ Tsuen Wan Plaza',    'AVLife',   'HK', 'T2'),
  ('AVLife @ K11',                'AVLife',   'HK', 'T2')
ON CONFLICT (name, market) DO NOTHING;
