-- 029_merge_milton_anc_add_stockwell.sql
-- Merge the two "Milton A.N.C" product spellings into the correct period-suffixed
-- form, and add Marshall Stockwell III to the catalogue.

-- 1. Rename the catalogue entry to the correct spelling (adds trailing period).
--    Only one Milton row exists, so UNIQUE(brand,name) is not violated.
UPDATE sva.products
SET name = 'Milton A.N.C.'
WHERE brand = 'Marshall' AND name = 'Milton A.N.C';

-- 2. Normalise every Milton training row to the corrected display name and link it
--    to the (now corrected) catalogue product. Fixes the 6 no-period names and
--    adopts the 11 free-typed orphans (product_id was NULL).
UPDATE sva.engagement_trainings
SET product_name = 'Marshall Milton A.N.C.',
    product_id   = (SELECT id FROM sva.products
                    WHERE brand = 'Marshall' AND name = 'Milton A.N.C.')
WHERE product_name IN ('Marshall Milton A.N.C', 'Marshall Milton A.N.C.');

-- 3. Normalise the legacy CSV column on visit_staff. Exact-match the no-period rows;
--    equality avoids turning an already-correct '...A.N.C.' into '...A.N.C..'.
UPDATE sva.visit_staff
SET products_trained_on = 'Marshall Milton A.N.C.'
WHERE products_trained_on = 'Marshall Milton A.N.C';

-- 4. Add Marshall Stockwell III to the catalogue.
INSERT INTO sva.products (brand, name)
VALUES ('Marshall', 'Stockwell III')
ON CONFLICT (brand, name) DO NOTHING;
