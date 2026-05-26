import type { Pool } from 'pg';

import type {
  NormalizedEvent,
  PersistedEvent,
  RefinementResult,
  ScoreResult
} from '../types/event.js';
import type { SourceKey } from '../types/source.js';

export interface EventRow {
  id: number;
  source_key: PersistedEvent['sourceKey'];
  market: PersistedEvent['market'] | null;
  title: string;
  summary: string | null;
  content: string | null;
  url: string;
  published_at: Date | null;
  fetched_at: Date;
  fingerprint: string;
  raw_payload: unknown;
  matched: boolean;
  matched_rule: string | null;
  score: number;
  created_at: Date;
  importance: number | null;
  category: string | null;
  affected_assets: string[] | null;
  actionable: boolean | null;
  tldr: string | null;
  reason: string | null;
  refined_at: Date | null;
  refine_model: string | null;
  refine_prompt_version: string | null;
  cluster_id: number | string | null;
  cluster_role: PersistedEvent['clusterRole'];
  triage_score: number | null;
  direction: string | null;
  tickers: string[] | null;
  surprise: string | null;
  horizon: string | null;
  confidence: number | null;
  detect_latency_ms: number | null;
}

export function mapRow(row: EventRow): PersistedEvent {
  return {
    id: row.id,
    sourceKey: row.source_key,
    market: row.market ?? 'crypto',
    title: row.title,
    summary: row.summary,
    content: row.content,
    url: row.url,
    publishedAt: row.published_at,
    fetchedAt: row.fetched_at,
    fingerprint: row.fingerprint,
    rawPayload: row.raw_payload,
    matched: row.matched,
    matchedRule: row.matched_rule,
    score: row.score,
    createdAt: row.created_at,
    importance: row.importance,
    category: row.category,
    affectedAssets: row.affected_assets,
    actionable: row.actionable,
    tldr: row.tldr,
    reason: row.reason,
    refinedAt: row.refined_at,
    refineModel: row.refine_model,
    refinePromptVersion: row.refine_prompt_version,
    clusterId: row.cluster_id !== null ? Number(row.cluster_id) : null,
    clusterRole: row.cluster_role,
    triageScore: row.triage_score,
    direction: row.direction,
    tickers: row.tickers,
    surprise: row.surprise,
    horizon: row.horizon,
    confidence: row.confidence,
    detectLatencyMs: row.detect_latency_ms
  };
}

export class EventsRepository {
  constructor(private readonly pool: Pool) {}

  async countAll(): Promise<number> {
    const result = await this.pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM events');
    return Number.parseInt(result.rows[0]?.count ?? '0', 10);
  }

  async findByFingerprint(fingerprint: string): Promise<PersistedEvent | null> {
    const result = await this.pool.query<EventRow>(
      `
        SELECT *
        FROM events
        WHERE fingerprint = $1
        LIMIT 1
      `,
      [fingerprint]
    );

    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async listRecentUrlsBySource(sourceKey: SourceKey, limit: number): Promise<Set<string>> {
    const result = await this.pool.query<{ url: string }>(
      `
        SELECT url
        FROM events
        WHERE source_key = $1
        ORDER BY COALESCE(published_at, fetched_at) DESC, id DESC
        LIMIT $2
      `,
      [sourceKey, limit]
    );

    return new Set(result.rows.map((row) => row.url));
  }

  async insert(event: NormalizedEvent): Promise<PersistedEvent> {
    // Detection latency (publish -> first seen). Forward-compat for the trading version;
    // clamp negatives (clock skew) to 0, leave null when the source gave no publish time.
    const detectLatencyMs =
      event.publishedAt !== null
        ? Math.max(0, event.fetchedAt.getTime() - event.publishedAt.getTime())
        : null;

    const result = await this.pool.query<EventRow>(
      `
        INSERT INTO events (
          source_key,
          market,
          title,
          summary,
          content,
          url,
          published_at,
          fetched_at,
          fingerprint,
          raw_payload,
          detect_latency_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
        RETURNING *
      `,
      [
        event.sourceKey,
        event.market,
        event.title,
        event.summary,
        event.content,
        event.url,
        event.publishedAt,
        event.fetchedAt,
        event.fingerprint,
        JSON.stringify(event.rawPayload),
        detectLatencyMs
      ]
    );

    return mapRow(result.rows[0]);
  }

  async updateScore(eventId: number, scoreResult: ScoreResult): Promise<PersistedEvent> {
    const result = await this.pool.query<EventRow>(
      `
        UPDATE events
        SET
          matched = $2,
          matched_rule = $3,
          score = $4
        WHERE id = $1
        RETURNING *
      `,
      [eventId, scoreResult.matched, scoreResult.matchedRule, scoreResult.score]
    );

    return mapRow(result.rows[0]);
  }

  async assignCluster(eventId: number, clusterId: number, role: 'primary' | 'secondary'): Promise<void> {
    await this.pool.query(
      'UPDATE events SET cluster_id = $2, cluster_role = $3 WHERE id = $1',
      [eventId, clusterId, role]
    );
  }

  async findRecentRefinedForClustering(params: {
    affectedAssets: string[];
    category: string | null;
    sinceHours: number;
    excludeId: number;
    limit: number;
  }): Promise<
    Array<{
      id: number;
      title: string;
      tldr: string | null;
      affectedAssets: string[] | null;
      category: string | null;
      clusterId: number | null;
      refinedAt: Date | null;
      sourceKey: PersistedEvent['sourceKey'];
    }>
  > {
    const result = await this.pool.query<{
      id: number;
      title: string;
      tldr: string | null;
      affected_assets: string[] | null;
      category: string | null;
      cluster_id: number | string | null;
      refined_at: Date | null;
      source_key: PersistedEvent['sourceKey'];
    }>(
      `
        SELECT id, title, tldr, affected_assets, category, cluster_id, refined_at, source_key
        FROM events
        WHERE id <> $1
          AND refined_at IS NOT NULL
          AND refined_at > NOW() - make_interval(hours => $2)
          AND ($3::text IS NULL OR category IS NULL OR category = $3)
          AND ($4::text[] IS NULL OR affected_assets && $4)
        ORDER BY refined_at DESC
        LIMIT $5
      `,
      [
        params.excludeId,
        params.sinceHours,
        params.category,
        params.affectedAssets.length > 0 ? params.affectedAssets : null,
        params.limit
      ]
    );

    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      tldr: row.tldr,
      affectedAssets: row.affected_assets,
      category: row.category,
      clusterId: row.cluster_id !== null ? Number(row.cluster_id) : null,
      refinedAt: row.refined_at,
      sourceKey: row.source_key
    }));
  }

  async listForDigest(params: { sinceHours: number; minImportance: number }): Promise<PersistedEvent[]> {
    const result = await this.pool.query<EventRow>(
      `
        WITH ranked AS (
          SELECT e.*,
                 ROW_NUMBER() OVER (
                   PARTITION BY COALESCE(e.cluster_id, e.id)
                   ORDER BY e.importance DESC NULLS LAST, e.fetched_at DESC
                 ) AS rn
          FROM events e
          WHERE e.refined_at IS NOT NULL
            AND e.fetched_at > NOW() - make_interval(hours => $1)
            AND e.importance >= $2
            AND e.category IS DISTINCT FROM 'noise'
            AND NOT EXISTS (
              SELECT 1 FROM notifications n
              WHERE n.event_id = e.id AND n.status = 'success'
            )
        )
        SELECT * FROM ranked WHERE rn = 1
        ORDER BY importance DESC NULLS LAST, fetched_at DESC
      `,
      [params.sinceHours, params.minImportance]
    );
    return result.rows.map(mapRow);
  }

  async updateRefinement(eventId: number, refinement: RefinementResult): Promise<PersistedEvent> {
    const result = await this.pool.query<EventRow>(
      `
        UPDATE events
        SET
          importance = $2,
          category = $3,
          affected_assets = $4,
          actionable = $5,
          tldr = $6,
          reason = $7,
          refined_at = NOW(),
          refine_model = $8,
          refine_prompt_version = $9,
          direction = $10,
          tickers = $11,
          surprise = $12,
          horizon = $13,
          confidence = $14
        WHERE id = $1
        RETURNING *
      `,
      [
        eventId,
        refinement.importance,
        refinement.category,
        refinement.affectedAssets,
        refinement.actionable,
        refinement.tldr,
        refinement.reason,
        refinement.model,
        refinement.promptVersion,
        refinement.direction,
        refinement.tickers,
        refinement.surprise,
        refinement.horizon,
        refinement.confidence
      ]
    );
    return mapRow(result.rows[0]);
  }
}
