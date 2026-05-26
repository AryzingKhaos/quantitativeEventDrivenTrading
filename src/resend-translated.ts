// One-off: re-send N already-pushed English-source events through the new
// translation pipeline, so the user can compare the bilingual format.
// Updates the existing notifications row (event_id + target is UNIQUE,
// upsertDelivery just refreshes sent_at and telegram_message_id).

import { config as loadDotEnv } from 'dotenv';
import { Pool } from 'pg';

import { getEnv } from './config/env.js';
import { EventsRepository, mapRow, type EventRow } from './db/events.repo.js';
import { NotificationsRepository } from './db/notifications.repo.js';
import { LlmClient } from './services/llm.client.js';
import { NotifyService } from './services/notify.service.js';
import { TranslationService } from './services/translation.service.js';
import { createLogger } from './utils/logger.js';
import type { PersistedEvent } from './types/event.js';
import type { SourceKey } from './types/source.js';

loadDotEnv();

const ENGLISH_SOURCES: SourceKey[] = [
  'openai_blog',
  'nvidia_blog',
  'google_ai_blog',
  'deepmind_blog',
  'microsoft_ai_blog',
  'aws_ml_blog',
  'huggingface_blog',
  'arxiv_cs_ai',
  'arxiv_cs_cl',
  'arxiv_cs_lg',
  'whitehouse',
  'gary_marcus',
  'ai_snake_oil',
  'pluralistic',
  'media_404',
  'tech_policy_press',
  'sec_edgar',
  'coindesk',
  'theblock',
  'coinbase'
];

function parseArgs(argv: string[]) {
  const limit = Number.parseInt(argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? '10', 10);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
    dryRun: argv.includes('--dry-run'),
    sendDelayMs: 1500
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = getEnv();
  const logger = createLogger(env.logLevel, { filePath: env.logFilePath });
  if (!env.deepseekApiKey) {
    console.error('DEEPSEEK_API_KEY missing — translation can\'t run; aborting.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: env.databaseUrl });
  const eventsRepo = new EventsRepository(pool);
  const notificationsRepo = new NotificationsRepository(pool);
  const translationService = new TranslationService({
    llm: new LlmClient(env),
    model: env.deepseekModelFast,
    logger
  });
  const notifyService = new NotifyService(
    env,
    { feedbackEnabled: env.feedbackEnabled },
    translationService
  );
  const target = env.telegramChatId;

  try {
    const { rows } = await pool.query<EventRow>(
      `
        SELECT e.*
        FROM events e
        JOIN notifications n ON n.event_id = e.id
        WHERE n.target = $1
          AND n.status = 'success'
          AND e.source_key = ANY($2)
        ORDER BY n.sent_at DESC NULLS LAST
        LIMIT $3
      `,
      [target, ENGLISH_SOURCES, options.limit]
    );

    const events: PersistedEvent[] = rows.map(mapRow);

    void eventsRepo;

    console.log(`\n=== Picked ${events.length} already-pushed English-source events ===`);
    for (const ev of events) {
      const ts = (ev.publishedAt ?? ev.fetchedAt).toISOString().slice(0, 16);
      console.log(`  [${ts}] ${ev.sourceKey.padEnd(20)} ${ev.title.slice(0, 90)}`);
    }

    if (options.dryRun) {
      console.log('\n--dry-run: nothing sent.');
      return;
    }

    console.log(`\n=== Re-sending (with translation) ===`);
    let sent = 0;
    let failed = 0;
    for (const ev of events) {
      try {
        const result = await notifyService.sendEvent(ev);
        await notificationsRepo.upsertDelivery({
          eventId: ev.id,
          target,
          status: 'success',
          sentAt: new Date(),
          telegramMessageId: result.messageId
        });
        sent += 1;
        process.stdout.write(`  ✓ ${ev.id} (${ev.sourceKey})\n`);
      } catch (error) {
        failed += 1;
        const msg = error instanceof Error ? error.message : String(error);
        process.stdout.write(`  ✗ ${ev.id} (${ev.sourceKey}) — ${msg}\n`);
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
