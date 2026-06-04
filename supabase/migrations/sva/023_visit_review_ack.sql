-- 023_visit_review_ack.sql
-- Let a CM acknowledge that they've seen the AM review feedback (boxed fixes +
-- comments) left on a visit's photos. One ack per visit. The AM sees "✓ seen"
-- on the visit once set. Additive — no existing data touched.
ALTER TABLE sva.visits
  ADD COLUMN IF NOT EXISTS review_ack_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_ack_by bigint;
