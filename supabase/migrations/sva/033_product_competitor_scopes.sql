-- 033_product_competitor_scopes.sql — extend memory scopes for entity-level
-- product and competitor notes (e.g. product:minor-iv, competitor:jbl-sg).
-- Filing rule (enforced in synthesis prompts, not here): a product/competitor
-- earns its own note at 3+ distinct-day sightings; until then it stays a
-- bullet on a store/theme note. Edge types unchanged — extend
-- memory_edges.edge_type when the first product/competitor edge is needed.

ALTER TABLE sva.memory_notes DROP CONSTRAINT memory_notes_scope_check;
ALTER TABLE sva.memory_notes ADD CONSTRAINT memory_notes_scope_check
  CHECK (scope IN ('store','person','theme','channel','product','competitor'));
