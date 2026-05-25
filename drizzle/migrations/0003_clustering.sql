ALTER TABLE events
  ADD COLUMN IF NOT EXISTS cluster_id BIGINT,
  ADD COLUMN IF NOT EXISTS cluster_role TEXT;

CREATE INDEX IF NOT EXISTS events_cluster_idx ON events (cluster_id) WHERE cluster_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_clusters (
  id BIGSERIAL PRIMARY KEY,
  representative_event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  topic_summary TEXT,
  member_count INT NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  notified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS event_clusters_recent_idx ON event_clusters (last_seen_at DESC);
