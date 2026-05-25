CREATE TABLE IF NOT EXISTS source_state (
  source_key TEXT PRIMARY KEY,
  list_etag TEXT NULL,
  list_last_modified TEXT NULL,
  list_fetched_at TIMESTAMPTZ NULL,
  cookies JSONB NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
