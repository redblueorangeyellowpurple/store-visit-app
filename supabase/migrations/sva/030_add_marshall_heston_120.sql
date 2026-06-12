-- 030_add_marshall_heston_120.sql
-- Add Marshall Heston 120 to the product catalogue.
-- name is the short form (no brand prefix); display name = brand || ' ' || name
-- => "Marshall Heston 120".

INSERT INTO sva.products (brand, name)
VALUES ('Marshall', 'Heston 120')
ON CONFLICT (brand, name) DO NOTHING;
