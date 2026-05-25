CREATE TABLE IF NOT EXISTS price_snapshots (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  baseline_price NUMERIC(20, 8),
  baseline_at TIMESTAMPTZ,
  price_1h NUMERIC(20, 8),
  price_1h_at TIMESTAMPTZ,
  price_24h NUMERIC(20, 8),
  price_24h_at TIMESTAMPTZ,
  price_7d NUMERIC(20, 8),
  price_7d_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'binance',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT price_snapshots_event_asset_uniq UNIQUE (event_id, asset)
);

CREATE INDEX IF NOT EXISTS price_snapshots_event_idx ON price_snapshots (event_id);
CREATE INDEX IF NOT EXISTS price_snapshots_asset_idx ON price_snapshots (asset, baseline_at DESC);

CREATE TABLE IF NOT EXISTS pending_snapshots (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  asset TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('1h', '24h', '7d')),
  done BOOLEAN NOT NULL DEFAULT FALSE,
  attempts SMALLINT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pending_snapshots_event_asset_kind_uniq UNIQUE (event_id, asset, kind)
);

CREATE INDEX IF NOT EXISTS pending_snapshots_due_idx ON pending_snapshots (due_at) WHERE done = FALSE;
