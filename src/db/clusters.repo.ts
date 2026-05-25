import type { Pool } from 'pg';

export interface EventCluster {
  id: number;
  representativeEventId: number;
  topicSummary: string | null;
  memberCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  notified: boolean;
}

interface ClusterRow {
  id: number | string;
  representative_event_id: number | string;
  topic_summary: string | null;
  member_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  notified: boolean;
}

function mapRow(row: ClusterRow): EventCluster {
  return {
    id: Number(row.id),
    representativeEventId: Number(row.representative_event_id),
    topicSummary: row.topic_summary,
    memberCount: row.member_count,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    notified: row.notified
  };
}

export class ClustersRepository {
  constructor(private readonly pool: Pool) {}

  async createForEvent(params: {
    eventId: number;
    topicSummary: string | null;
    seenAt: Date;
  }): Promise<EventCluster> {
    const result = await this.pool.query<ClusterRow>(
      `
        INSERT INTO event_clusters (
          representative_event_id, topic_summary, member_count, first_seen_at, last_seen_at, notified
        )
        VALUES ($1, $2, 1, $3, $3, FALSE)
        RETURNING *
      `,
      [params.eventId, params.topicSummary, params.seenAt]
    );
    return mapRow(result.rows[0]);
  }

  async touch(clusterId: number, seenAt: Date, topicSummary?: string | null): Promise<void> {
    await this.pool.query(
      `
        UPDATE event_clusters
        SET member_count = member_count + 1,
            last_seen_at = GREATEST(last_seen_at, $2),
            topic_summary = COALESCE($3, topic_summary)
        WHERE id = $1
      `,
      [clusterId, seenAt, topicSummary ?? null]
    );
  }

  async markNotified(clusterId: number): Promise<void> {
    await this.pool.query('UPDATE event_clusters SET notified = TRUE WHERE id = $1', [clusterId]);
  }
}
