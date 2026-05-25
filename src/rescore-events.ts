import { config as loadDotEnv } from 'dotenv';
import { Pool } from 'pg';

import { EventsRepository } from './db/events.repo.js';
import { FilterService } from './services/filter.service.js';
import type { PersistedEvent } from './types/event.js';
import type { SourceKey } from './types/source.js';

loadDotEnv();

interface RescoreOptions {
  sourceKeys?: SourceKey[];
  days?: number;
  limit: number;
  dryRun: boolean;
}

function readDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error('Missing required environment variable: DATABASE_URL');
  }

  return value;
}

function parseSourceKeys(raw: string | undefined): SourceKey[] | undefined {
  if (!raw) {
    return undefined;
  }

  const sourceKeys = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean) as SourceKey[];

  return sourceKeys.length > 0 ? sourceKeys : undefined;
}

function parseIntegerArg(name: string, raw: string | undefined, fallback?: number): number | undefined {
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Argument ${name} must be a positive integer`);
  }

  return value;
}

function parseArgs(argv: string[]): RescoreOptions {
  const sourceArg = argv.find((arg) => arg.startsWith('--source='));
  const daysArg = argv.find((arg) => arg.startsWith('--days='));
  const limitArg = argv.find((arg) => arg.startsWith('--limit='));

  return {
    sourceKeys: parseSourceKeys(sourceArg?.split('=')[1]),
    days: parseIntegerArg('--days', daysArg?.split('=')[1]),
    limit: parseIntegerArg('--limit', limitArg?.split('=')[1], 1000) ?? 1000,
    dryRun: argv.includes('--dry-run')
  };
}

async function listEventsForRescore(
  pool: Pool,
  options: RescoreOptions
): Promise<PersistedEvent[]> {
  const sources = options.sourceKeys?.length ? options.sourceKeys : null;
  const days = options.days ?? null;
  const result = await pool.query<{
    id: number;
    source_key: PersistedEvent['sourceKey'];
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
    cluster_role: 'primary' | 'secondary' | null;
  }>(
    `
      SELECT *
      FROM events
      WHERE ($1::text[] IS NULL OR source_key = ANY($1))
        AND (
          $2::integer IS NULL
          OR COALESCE(published_at, fetched_at) >= NOW() - make_interval(days => $2)
        )
      ORDER BY COALESCE(published_at, fetched_at) DESC, id DESC
      LIMIT $3
    `,
    [sources, days, options.limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    sourceKey: row.source_key,
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
    clusterRole: row.cluster_role
  }));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const pool = new Pool({
    connectionString: readDatabaseUrl()
  });
  const eventsRepo = new EventsRepository(pool);
  const filterService = new FilterService();

  try {
    const events = await listEventsForRescore(pool, options);
    let changed = 0;
    let newlyMatched = 0;
    let noLongerMatched = 0;
    let scoreChanged = 0;

    for (const event of events) {
      const next = filterService.evaluate(event);
      const hasChanged =
        event.score !== next.score ||
        event.matched !== next.matched ||
        event.matchedRule !== next.matchedRule;

      if (!hasChanged) {
        continue;
      }

      changed += 1;
      if (event.score !== next.score) {
        scoreChanged += 1;
      }
      if (!event.matched && next.matched) {
        newlyMatched += 1;
      }
      if (event.matched && !next.matched) {
        noLongerMatched += 1;
      }

      if (!options.dryRun) {
        await eventsRepo.updateScore(event.id, next);
      }

      console.log(
        JSON.stringify({
          action: options.dryRun ? 'preview_rescore' : 'rescore',
          id: event.id,
          sourceKey: event.sourceKey,
          title: event.title,
          previous: {
            matched: event.matched,
            matchedRule: event.matchedRule,
            score: event.score
          },
          next: {
            matched: next.matched,
            matchedRule: next.matchedRule,
            score: next.score,
            matchedKeywords: next.matchedKeywords,
            excludedBy: next.excludedBy
          }
        })
      );
    }

    console.log(
      JSON.stringify({
        action: options.dryRun ? 'preview_summary' : 'rescore_summary',
        scanned: events.length,
        changed,
        scoreChanged,
        newlyMatched,
        noLongerMatched,
        sourceKeys: options.sourceKeys ?? null,
        days: options.days ?? null,
        limit: options.limit
      })
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
