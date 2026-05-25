import type { Pool } from 'pg';

export type SnapshotKind = '1h' | '24h' | '7d';

export interface PendingSnapshot {
  id: number;
  eventId: number;
  asset: string;
  kind: SnapshotKind;
  dueAt: Date;
  attempts: number;
}

interface PendingRow {
  id: number | string;
  event_id: number | string;
  asset: string;
  kind: SnapshotKind;
  due_at: Date;
  attempts: number;
}

function mapPending(row: PendingRow): PendingSnapshot {
  return {
    id: Number(row.id),
    eventId: Number(row.event_id),
    asset: row.asset,
    kind: row.kind,
    dueAt: row.due_at,
    attempts: row.attempts
  };
}

export class PriceSnapshotsRepository {
  constructor(private readonly pool: Pool) {}

  async upsertBaseline(params: {
    eventId: number;
    asset: string;
    baselinePrice: number;
    baselineAt: Date;
    source?: string;
  }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO price_snapshots (event_id, asset, baseline_price, baseline_at, source)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (event_id, asset) DO UPDATE SET
          baseline_price = COALESCE(price_snapshots.baseline_price, EXCLUDED.baseline_price),
          baseline_at = COALESCE(price_snapshots.baseline_at, EXCLUDED.baseline_at)
      `,
      [params.eventId, params.asset.toUpperCase(), params.baselinePrice, params.baselineAt, params.source ?? 'binance']
    );
  }

  async updateForKind(params: {
    eventId: number;
    asset: string;
    kind: SnapshotKind;
    price: number;
    at: Date;
  }): Promise<void> {
    const column =
      params.kind === '1h' ? 'price_1h' : params.kind === '24h' ? 'price_24h' : 'price_7d';
    const atColumn =
      params.kind === '1h' ? 'price_1h_at' : params.kind === '24h' ? 'price_24h_at' : 'price_7d_at';

    await this.pool.query(
      `
        UPDATE price_snapshots
        SET ${column} = $3, ${atColumn} = $4
        WHERE event_id = $1 AND asset = $2
      `,
      [params.eventId, params.asset.toUpperCase(), params.price, params.at]
    );
  }
}

export class PendingSnapshotsRepository {
  constructor(private readonly pool: Pool) {}

  async insert(params: { eventId: number; asset: string; kind: SnapshotKind; dueAt: Date }): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO pending_snapshots (event_id, asset, kind, due_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (event_id, asset, kind) DO NOTHING
      `,
      [params.eventId, params.asset.toUpperCase(), params.kind, params.dueAt]
    );
  }

  async listDue(limit = 50): Promise<PendingSnapshot[]> {
    const result = await this.pool.query<PendingRow>(
      `
        SELECT id, event_id, asset, kind, due_at, attempts
        FROM pending_snapshots
        WHERE done = FALSE AND due_at <= NOW()
        ORDER BY due_at ASC
        LIMIT $1
      `,
      [limit]
    );
    return result.rows.map(mapPending);
  }

  async markDone(id: number): Promise<void> {
    await this.pool.query('UPDATE pending_snapshots SET done = TRUE WHERE id = $1', [id]);
  }

  async markFailed(id: number, errorMessage: string): Promise<void> {
    await this.pool.query(
      'UPDATE pending_snapshots SET attempts = attempts + 1, last_error = $2 WHERE id = $1',
      [id, errorMessage.slice(0, 500)]
    );
  }
}
