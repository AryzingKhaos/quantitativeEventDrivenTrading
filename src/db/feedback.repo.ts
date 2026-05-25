import type { Pool } from 'pg';

export interface FeedbackEntry {
  id: number;
  eventId: number;
  notificationId: number | null;
  rating: 1 | -1;
  reasonTag: string | null;
  comment: string | null;
  ratedAt: Date;
}

export interface FeedbackSampleRow {
  eventId: number;
  rating: 1 | -1;
  reasonTag: string | null;
  title: string;
  tldr: string | null;
  category: string | null;
  affectedAssets: string[] | null;
  importance: number | null;
  sourceKey: string;
  ratedAt: Date;
}

interface FeedbackRow {
  id: number | string;
  event_id: number | string;
  notification_id: number | string | null;
  rating: number;
  reason_tag: string | null;
  comment: string | null;
  rated_at: Date;
}

function mapRow(row: FeedbackRow): FeedbackEntry {
  return {
    id: Number(row.id),
    eventId: Number(row.event_id),
    notificationId: row.notification_id !== null ? Number(row.notification_id) : null,
    rating: row.rating === 1 ? 1 : -1,
    reasonTag: row.reason_tag,
    comment: row.comment,
    ratedAt: row.rated_at
  };
}

export class FeedbackRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(params: {
    eventId: number;
    rating: 1 | -1;
    reasonTag?: string | null;
    comment?: string | null;
    notificationId?: number | null;
  }): Promise<FeedbackEntry> {
    const result = await this.pool.query<FeedbackRow>(
      `
        INSERT INTO feedback (event_id, notification_id, rating, reason_tag, comment)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (event_id, rating) DO UPDATE SET
          reason_tag = COALESCE(EXCLUDED.reason_tag, feedback.reason_tag),
          comment = COALESCE(EXCLUDED.comment, feedback.comment),
          notification_id = COALESCE(EXCLUDED.notification_id, feedback.notification_id),
          rated_at = NOW()
        RETURNING *
      `,
      [
        params.eventId,
        params.notificationId ?? null,
        params.rating,
        params.reasonTag ?? null,
        params.comment ?? null
      ]
    );
    return mapRow(result.rows[0]);
  }

  private async fetchSamples(rating: 1 | -1, days: number, limit: number): Promise<FeedbackSampleRow[]> {
    const result = await this.pool.query<{
      event_id: number | string;
      rating: number;
      reason_tag: string | null;
      title: string;
      tldr: string | null;
      category: string | null;
      affected_assets: string[] | null;
      importance: number | null;
      source_key: string;
      rated_at: Date;
    }>(
      `
        SELECT
          f.event_id, f.rating, f.reason_tag, f.rated_at,
          e.title, e.tldr, e.category, e.affected_assets, e.importance, e.source_key
        FROM feedback f
        JOIN events e ON e.id = f.event_id
        WHERE f.rating = $1
          AND f.rated_at > NOW() - make_interval(days => $2)
        ORDER BY f.rated_at DESC
        LIMIT $3
      `,
      [rating, days, limit]
    );
    return result.rows.map((row) => ({
      eventId: Number(row.event_id),
      rating: row.rating === 1 ? 1 : -1,
      reasonTag: row.reason_tag,
      title: row.title,
      tldr: row.tldr,
      category: row.category,
      affectedAssets: row.affected_assets,
      importance: row.importance,
      sourceKey: row.source_key,
      ratedAt: row.rated_at
    }));
  }

  recentNegative(params: { days: number; limit: number }): Promise<FeedbackSampleRow[]> {
    return this.fetchSamples(-1, params.days, params.limit);
  }

  recentPositive(params: { days: number; limit: number }): Promise<FeedbackSampleRow[]> {
    return this.fetchSamples(1, params.days, params.limit);
  }
}

export interface FeedbackReviewRecord {
  id: number;
  weekOf: Date;
  suggestions: unknown;
  summary: string | null;
  applied: boolean;
  model: string | null;
  createdAt: Date;
}

export class FeedbackReviewsRepository {
  constructor(private readonly pool: Pool) {}

  async insert(params: {
    weekOf: Date;
    suggestions: unknown;
    summary: string | null;
    model: string;
  }): Promise<FeedbackReviewRecord> {
    const result = await this.pool.query<{
      id: number | string;
      week_of: Date;
      suggestions: unknown;
      summary: string | null;
      applied: boolean;
      model: string | null;
      created_at: Date;
    }>(
      `
        INSERT INTO feedback_reviews (week_of, suggestions, summary, applied, model)
        VALUES ($1, $2::jsonb, $3, FALSE, $4)
        RETURNING *
      `,
      [params.weekOf, JSON.stringify(params.suggestions), params.summary, params.model]
    );
    const row = result.rows[0];
    return {
      id: Number(row.id),
      weekOf: row.week_of,
      suggestions: row.suggestions,
      summary: row.summary,
      applied: row.applied,
      model: row.model,
      createdAt: row.created_at
    };
  }
}
