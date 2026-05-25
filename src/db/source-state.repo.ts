import type { Pool } from 'pg';

import type { SourceKey } from '../types/source.js';

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expiresAt: number | null;
}

export interface SourceState {
  sourceKey: SourceKey;
  listEtag: string | null;
  listLastModified: string | null;
  listFetchedAt: Date | null;
  cookies: StoredCookie[];
}

interface SourceStateRow {
  source_key: SourceKey;
  list_etag: string | null;
  list_last_modified: string | null;
  list_fetched_at: Date | null;
  cookies: StoredCookie[] | null;
}

function mapRow(row: SourceStateRow): SourceState {
  return {
    sourceKey: row.source_key,
    listEtag: row.list_etag,
    listLastModified: row.list_last_modified,
    listFetchedAt: row.list_fetched_at,
    cookies: row.cookies ?? []
  };
}

export class SourceStateRepository {
  constructor(private readonly pool: Pool) {}

  async get(sourceKey: SourceKey): Promise<SourceState | null> {
    const result = await this.pool.query<SourceStateRow>(
      'SELECT * FROM source_state WHERE source_key = $1 LIMIT 1',
      [sourceKey]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async setListPageCache(
    sourceKey: SourceKey,
    cache: { etag: string | null; lastModified: string | null }
  ): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO source_state (source_key, list_etag, list_last_modified, list_fetched_at, updated_at)
        VALUES ($1, $2, $3, NOW(), NOW())
        ON CONFLICT (source_key) DO UPDATE SET
          list_etag = EXCLUDED.list_etag,
          list_last_modified = EXCLUDED.list_last_modified,
          list_fetched_at = EXCLUDED.list_fetched_at,
          updated_at = NOW()
      `,
      [sourceKey, cache.etag, cache.lastModified]
    );
  }

  async setCookies(sourceKey: SourceKey, cookies: StoredCookie[]): Promise<void> {
    await this.pool.query(
      `
        INSERT INTO source_state (source_key, cookies, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (source_key) DO UPDATE SET
          cookies = EXCLUDED.cookies,
          updated_at = NOW()
      `,
      [sourceKey, JSON.stringify(cookies)]
    );
  }
}
