-- 010_training_response.sql
-- Separate response notes from product names for cleaner training data.
-- products_trained_on stays as the comma-separated product list.
-- training_response is the freeform "how did they respond" textarea.

ALTER TABLE sva.visit_staff
  ADD COLUMN IF NOT EXISTS training_response TEXT;
