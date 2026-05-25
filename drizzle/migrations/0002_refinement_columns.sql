ALTER TABLE events
  ADD COLUMN IF NOT EXISTS importance SMALLINT,
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS affected_assets TEXT[],
  ADD COLUMN IF NOT EXISTS actionable BOOLEAN,
  ADD COLUMN IF NOT EXISTS tldr TEXT,
  ADD COLUMN IF NOT EXISTS reason TEXT,
  ADD COLUMN IF NOT EXISTS refined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refine_model TEXT,
  ADD COLUMN IF NOT EXISTS refine_prompt_version TEXT;

CREATE INDEX IF NOT EXISTS events_importance_idx
  ON events (importance DESC, fetched_at DESC)
  WHERE importance IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_category_idx
  ON events (category, fetched_at DESC);
