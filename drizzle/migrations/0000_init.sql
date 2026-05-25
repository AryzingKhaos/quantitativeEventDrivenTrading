CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  source_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NULL,
  content TEXT NULL,
  url TEXT NOT NULL,
  published_at TIMESTAMPTZ NULL,
  fetched_at TIMESTAMPTZ NOT NULL,
  fingerprint TEXT NOT NULL,
  raw_payload JSONB NOT NULL,
  matched BOOLEAN NOT NULL DEFAULT FALSE,
  matched_rule TEXT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT events_fingerprint_unique UNIQUE (fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_events_source_key_fetched_at ON events (source_key, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_matched_fetched_at ON events (matched, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_published_at ON events (published_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error_message TEXT NULL,
  sent_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notifications_event_target_unique UNIQUE (event_id, target)
);

CREATE INDEX IF NOT EXISTS idx_notifications_event_id ON notifications (event_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status_created_at ON notifications (status, created_at DESC);
