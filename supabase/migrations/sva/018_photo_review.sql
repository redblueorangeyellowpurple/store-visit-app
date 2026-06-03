-- 018_photo_review.sql
-- Display Review: let reviewers comment on store-visit photos, box specific
-- spots to fix, and grade a display. All additive — no existing data touched.

-- General comments on a photo (0..N per photo).
CREATE TABLE IF NOT EXISTS sva.photo_comments (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id           uuid        NOT NULL REFERENCES sva.visit_photos(id) ON DELETE CASCADE,
  body               text        NOT NULL,
  author_telegram_id bigint,
  author_name        text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photo_comments_photo ON sva.photo_comments(photo_id);

-- Box annotations on a photo (0..N). Coords stored as % of the rendered image
-- (0–100) so they survive any display size. x,y = top-left corner; w,h = size.
CREATE TABLE IF NOT EXISTS sva.photo_annotations (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id           uuid        NOT NULL REFERENCES sva.visit_photos(id) ON DELETE CASCADE,
  x                  real        NOT NULL,
  y                  real        NOT NULL,
  w                  real        NOT NULL,
  h                  real        NOT NULL,
  note               text        NOT NULL,
  author_telegram_id bigint,
  author_name        text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photo_annotations_photo ON sva.photo_annotations(photo_id);

-- Optional per-photo display grade (1 = Good, 2 = Needs work, 3 = Poor). NULL = ungraded.
ALTER TABLE sva.visit_photos
  ADD COLUMN IF NOT EXISTS review_grade smallint;
