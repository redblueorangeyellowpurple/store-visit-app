-- 021_engagements.sql
-- Trainings → Engagements. Extend visit_staff IN PLACE (NON-DESTRUCTIVE: the old
-- columns stay and are dual-written, so every existing reader/analytics query
-- keeps working) and add a child table for per-training detail.
--
-- New model: a visit has a list of PEOPLE the CM engaged. Each person =
--   - identity: either a known store-staff row (staff_id) OR a free-typed name
--     (person_name, staff_id NULL — daily intelligence resolves identity later)
--   - update_text: free-text note about the interaction
--   - zero or more TRAININGS (engagement_trainings): a product + free-text response
--
-- Old columns kept + dual-written during the transition: was_trained,
-- products_trained_on (CSV), training_response. Readers migrate off incrementally.

-- 1. Surrogate PK. The composite PK (visit_id, staff_id) required staff_id NOT
--    NULL, which blocks free-typed people and multiple unknowns per visit.
ALTER TABLE sva.visit_staff ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE sva.visit_staff DROP CONSTRAINT visit_staff_pkey;
ALTER TABLE sva.visit_staff ADD CONSTRAINT visit_staff_pkey PRIMARY KEY (id);

-- 2. staff_id now optional; keep one-row-per-known-staff-per-visit integrity.
ALTER TABLE sva.visit_staff ALTER COLUMN staff_id DROP NOT NULL;
CREATE UNIQUE INDEX visit_staff_visit_staff_uniq
  ON sva.visit_staff (visit_id, staff_id) WHERE staff_id IS NOT NULL;

-- 3. New per-person fields.
ALTER TABLE sva.visit_staff ADD COLUMN person_name text;
ALTER TABLE sva.visit_staff ADD COLUMN update_text text;

-- 4. Per-training child rows (one product each, with its own free-text response).
CREATE TABLE sva.engagement_trainings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_staff_id uuid NOT NULL REFERENCES sva.visit_staff(id) ON DELETE CASCADE,
  product_id     uuid REFERENCES sva.products(id),
  product_name   text NOT NULL,
  response       text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_engagement_trainings_visit_staff
  ON sva.engagement_trainings(visit_staff_id);

ALTER TABLE sva.engagement_trainings ENABLE ROW LEVEL SECURITY;

-- 5. Backfill (idempotent-safe: only fills where new fields are still empty).
--    a. Person narrative ← old per-person training_response.
UPDATE sva.visit_staff
  SET update_text = training_response
  WHERE update_text IS NULL AND training_response IS NOT NULL;

--    b. Each product in the old CSV → one training row, matched to sva.products
--       by display name (brand || ' ' || name) where possible. product_name keeps
--       the original token verbatim so unmatched/custom products survive.
INSERT INTO sva.engagement_trainings (visit_staff_id, product_id, product_name)
SELECT vs.id, p.id, trim(tok)
FROM sva.visit_staff vs
CROSS JOIN LATERAL unnest(string_to_array(vs.products_trained_on, ',')) AS tok
LEFT JOIN sva.products p
  ON lower(p.brand || ' ' || p.name) = lower(trim(tok))
WHERE vs.products_trained_on IS NOT NULL
  AND length(trim(tok)) > 0
  AND NOT EXISTS (
    SELECT 1 FROM sva.engagement_trainings et WHERE et.visit_staff_id = vs.id
  );
