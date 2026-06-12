-- 031_normalize_heston_120_names.sql
-- Normalise free-typed "Heston 120" to the catalogue display name "Marshall
-- Heston 120" and link the training row to the (now seeded, mig 030) product.
-- Same backfill pattern as 029 for Milton A.N.C.

-- 1. Engagement training rows: adopt the correct display name + link product_id.
UPDATE sva.engagement_trainings
SET product_name = 'Marshall Heston 120',
    product_id   = (SELECT id FROM sva.products
                    WHERE brand = 'Marshall' AND name = 'Heston 120')
WHERE product_name IN ('Heston 120', 'Marshall Heston 120');

-- 2. Legacy CSV column on visit_staff. Anchor on CSV token boundaries so an
--    already-prefixed "Marshall Heston 120" is never double-prefixed.
UPDATE sva.visit_staff
SET products_trained_on = regexp_replace(
      products_trained_on, '(^|, )Heston 120(,|$)', '\1Marshall Heston 120\2', 'g')
WHERE products_trained_on ~ '(^|, )Heston 120(,|$)';
