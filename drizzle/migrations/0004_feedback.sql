CREATE TABLE IF NOT EXISTS feedback (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  notification_id BIGINT REFERENCES notifications(id) ON DELETE SET NULL,
  rating SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
  reason_tag TEXT,
  comment TEXT,
  rated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS feedback_event_rating_uniq ON feedback (event_id, rating);
CREATE INDEX IF NOT EXISTS feedback_rated_at_idx ON feedback (rated_at DESC);

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS telegram_message_id BIGINT;

CREATE TABLE IF NOT EXISTS feedback_reviews (
  id BIGSERIAL PRIMARY KEY,
  week_of DATE NOT NULL,
  suggestions JSONB NOT NULL,
  summary TEXT,
  applied BOOLEAN NOT NULL DEFAULT FALSE,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS feedback_reviews_week_idx ON feedback_reviews (week_of DESC);
