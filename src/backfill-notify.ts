import { config as loadDotEnv } from 'dotenv';
import { Pool } from 'pg';

import { getEnv } from './config/env.js';
import { EventsRepository, mapRow, type EventRow } from './db/events.repo.js';
import { NotificationsRepository } from './db/notifications.repo.js';
import { FilterService } from './services/filter.service.js';
import { LlmClient } from './services/llm.client.js';
import { NotifyService } from './services/notify.service.js';
import { TranslationService } from './services/translation.service.js';
import { createLogger } from './utils/logger.js';
import type { PersistedEvent } from './types/event.js';
import type { SourceKey } from './types/source.js';

loadDotEnv();

interface BackfillOptions {
  sourceKeys?: SourceKey[];
  days: number;
  limit: number;
  dryRun: boolean;
  sendDelayMs: number;
}

function parseSourceKeys(raw: string | undefined): SourceKey[] | undefined {
  if (!raw) return undefined;
  const keys = raw.split(',').map((v) => v.trim()).filter(Boolean) as SourceKey[];
  return keys.length > 0 ? keys : undefined;
}

function parsePositiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Argument ${name} must be a positive integer`);
  }
  return value;
}

function parseArgs(argv: string[]): BackfillOptions {
  const get = (name: string) => argv.find((a) => a.startsWith(`${name}=`))?.split('=')[1];
  return {
    sourceKeys: parseSourceKeys(get('--source')),
    days: parsePositiveInt('--days', get('--days'), 14),
    limit: parsePositiveInt('--limit', get('--limit'), 200),
    dryRun: argv.includes('--dry-run'),
    sendDelayMs: parsePositiveInt('--send-delay-ms', get('--send-delay-ms'), 1500)
  };
}

async function listCandidates(pool: Pool, options: BackfillOptions): Promise<PersistedEvent[]> {
  const sources = options.sourceKeys?.length ? options.sourceKeys : null;
  const { rows } = await pool.query<EventRow>(
    `
      SELECT *
      FROM events
      WHERE ($1::text[] IS NULL OR source_key = ANY($1))
        AND COALESCE(published_at, fetched_at) >= NOW() - make_interval(days => $2)
      ORDER BY COALESCE(published_at, fetched_at) ASC, id ASC
      LIMIT $3
    `,
    [sources, options.days, options.limit]
  );

  return rows.map(mapRow);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const env = getEnv();
  const logger = createLogger(env.logLevel, { filePath: env.logFilePath });
  const pool = new Pool({ connectionString: env.databaseUrl });
  const eventsRepo = new EventsRepository(pool);
  const notificationsRepo = new NotificationsRepository(pool);
  const filterService = new FilterService();
  const translationService = env.deepseekApiKey
    ? new TranslationService({ llm: new LlmClient(env), model: env.deepseekModelFast, logger })
    : null;
  const notifyService = new NotifyService(
    env,
    { feedbackEnabled: env.feedbackEnabled },
    translationService
  );
  const target = env.telegramChatId;

  try {
    const events = await listCandidates(pool, options);
    const eligible: Array<{ event: PersistedEvent; nextScore: number; nextRule: string | null }> = [];

    for (const event of events) {
      const next = filterService.evaluate(event);
      if (!next.matched) continue;
      const alreadyDelivered = await notificationsRepo.hasDelivered(event.id, target);
      if (alreadyDelivered) continue;
      eligible.push({ event, nextScore: next.score, nextRule: next.matchedRule });
    }

    console.log(`\n=== Backfill candidates ===`);
    console.log(`Scanned: ${events.length} events (last ${options.days} days)`);
    console.log(`Eligible to push (newly matched + not yet delivered): ${eligible.length}\n`);

    for (const item of eligible) {
      const ts = (item.event.publishedAt ?? item.event.fetchedAt).toISOString().slice(0, 16);
      const title = item.event.title.slice(0, 90);
      console.log(`  [${ts}] ${item.event.sourceKey.padEnd(20)} s=${item.nextScore}  ${title}`);
    }

    if (options.dryRun) {
      console.log(`\n--dry-run: nothing sent. Re-run without --dry-run to actually push.`);
      return;
    }

    console.log(`\n=== Sending ${eligible.length} backfill notifications ===`);
    let sent = 0;
    let failed = 0;
    for (const item of eligible) {
      try {
        // Persist updated score/matched first so the event row reflects current rule state.
        await eventsRepo.updateScore(item.event.id, {
          matched: true,
          matchedRule: item.nextRule,
          score: item.nextScore,
          matchedKeywords: [],
          excludedBy: null,
          market: item.event.market
        });
        const result = await notifyService.sendEvent(item.event);
        await notificationsRepo.upsertDelivery({
          eventId: item.event.id,
          target,
          status: 'success',
          sentAt: new Date(),
          telegramMessageId: result.messageId
        });
        sent += 1;
        process.stdout.write(`  ✓ ${item.event.id} (${item.event.sourceKey})\n`);
      } catch (error) {
        failed += 1;
        const msg = error instanceof Error ? error.message : String(error);
        await notificationsRepo.upsertDelivery({
          eventId: item.event.id,
          target,
          status: 'failed',
          errorMessage: msg
        });
        process.stdout.write(`  ✗ ${item.event.id} (${item.event.sourceKey}) — ${msg}\n`);
      }
      await sleep(options.sendDelayMs);
    }
    console.log(`\nDone. sent=${sent} failed=${failed}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
