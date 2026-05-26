-- v0.0.3: impact-oriented scoring + forward-compat fields for the trading version.
-- `importance` is reused as the final expected-trading-impact score (0-10).
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS market TEXT,
  ADD COLUMN IF NOT EXISTS triage_score SMALLINT,
  ADD COLUMN IF NOT EXISTS direction TEXT,        -- bullish | bearish | neutral (trading version)
  ADD COLUMN IF NOT EXISTS tickers TEXT[],        -- normalized symbols/codes (trading version)
  ADD COLUMN IF NOT EXISTS surprise TEXT,         -- unscheduled | beat | inline | miss
  ADD COLUMN IF NOT EXISTS horizon TEXT,          -- minutes | intraday | days (trading version)
  ADD COLUMN IF NOT EXISTS confidence REAL,       -- 0-1 LLM self-rated
  ADD COLUMN IF NOT EXISTS detect_latency_ms INTEGER; -- published_at -> fetched_at (trading version)

CREATE INDEX IF NOT EXISTS events_market_idx
  ON events (market, fetched_at DESC);
