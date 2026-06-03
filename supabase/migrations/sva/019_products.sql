-- 019_products.sql
-- Products master. Lifts the hard-coded PRODUCT_CATALOGUE (miniapp
-- TrainingEditor) into a managed reference table the dashboard can CRUD.
-- Engagement trainings reference these; product_name stays denormalized on the
-- training row so renames/retirements never rewrite history. All additive.
--
-- `name` is the short name (no brand prefix); display name = brand || ' ' || name
-- (e.g. brand 'Marshall' + name 'Acton III' → "Marshall Acton III"), which
-- matches the existing free-typed product strings 1:1 for later matching.

CREATE TABLE IF NOT EXISTS sva.products (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand       text        NOT NULL,
  name        text        NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand, name)
);

CREATE INDEX IF NOT EXISTS idx_products_brand ON sva.products(brand);

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON sva.products
  FOR EACH ROW EXECUTE FUNCTION sva.update_updated_at();

-- Seed from the current hard-coded catalogue (incl. Marshall Milton A.N.C).
INSERT INTO sva.products (brand, name) VALUES
  ('Marshall', 'Acton III'),
  ('Marshall', 'Stanmore III'),
  ('Marshall', 'Woburn III'),
  ('Marshall', 'Emberton II'),
  ('Marshall', 'Willen'),
  ('Marshall', 'Middleton'),
  ('Marshall', 'Tufton'),
  ('Marshall', 'Kilburn II'),
  ('Marshall', 'Major V'),
  ('Marshall', 'Motif II'),
  ('Marshall', 'Monitor III A.N.C'),
  ('Marshall', 'Milton A.N.C'),
  ('B&W', 'Px7 S2e'),
  ('B&W', 'Px8'),
  ('B&W', 'Pi8'),
  ('B&W', 'Pi6'),
  ('B&W', 'Zeppelin'),
  ('B&W', 'Panorama 3'),
  ('B&W', '700 S3'),
  ('B&W', '600 S3'),
  ('B&W', 'Formation Wedge'),
  ('Sonos', 'Era 100'),
  ('Sonos', 'Era 300'),
  ('Sonos', 'Arc Ultra'),
  ('Sonos', 'Beam (Gen 2)'),
  ('Sonos', 'Ray'),
  ('Sonos', 'Move 2'),
  ('Sonos', 'Roam 2'),
  ('Sonos', 'Ace'),
  ('Sonos', 'Sub Mini'),
  ('Sonos', 'Sub (Gen 3)'),
  ('Sonos', 'Five'),
  ('Sonos', 'Port')
ON CONFLICT (brand, name) DO NOTHING;
