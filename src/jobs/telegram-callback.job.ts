import type { RuntimeEnv } from '../config/env.js';
import type { Logger } from '../utils/logger.js';
import type { FeedbackRepository } from '../db/feedback.repo.js';
import { sleep } from '../utils/time.js';

interface TelegramCallbackQuery {
  id: string;
  data?: string;
  from?: { id: number; username?: string };
  message?: { message_id: number; chat: { id: number } };
}

interface TelegramUpdate {
  update_id: number;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramGetUpdatesResponse {
  ok: boolean;
  result?: TelegramUpdate[];
}

interface TelegramJobDeps {
  env: RuntimeEnv;
  logger: Logger;
  feedbackRepo: FeedbackRepository;
}

const POLL_TIMEOUT_SEC = 25;

export class TelegramCallbackJob {
  private stopped = false;
  private offset: number | null = null;
  private loop: Promise<void> | null = null;

  constructor(private readonly deps: TelegramJobDeps) {}

  start(): void {
    this.deps.logger.info('Starting Telegram callback long-polling worker');
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.loop) {
      await this.loop.catch(() => undefined);
    }
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      try {
        const updates = await this.fetchUpdates();
        for (const update of updates) {
          if (update.callback_query) {
            await this.handleCallback(update.callback_query);
          }
          this.offset = update.update_id + 1;
        }
      } catch (error) {
        this.deps.logger.warn('Telegram polling iteration failed', { error });
        await sleep(5_000);
      }
    }
  }

  private async fetchUpdates(): Promise<TelegramUpdate[]> {
    const params = new URLSearchParams({
      timeout: String(POLL_TIMEOUT_SEC),
      allowed_updates: JSON.stringify(['callback_query'])
    });
    if (this.offset !== null) {
      params.set('offset', String(this.offset));
    }

    const response = await fetch(
      `https://api.telegram.org/bot${this.deps.env.telegramBotToken}/getUpdates?${params.toString()}`
    );
    if (!response.ok) {
      throw new Error(`getUpdates failed: ${response.status}`);
    }
    const payload = (await response.json()) as TelegramGetUpdatesResponse;
    if (!payload.ok) {
      throw new Error('getUpdates returned ok=false');
    }
    return payload.result ?? [];
  }

  private async handleCallback(query: TelegramCallbackQuery): Promise<void> {
    const data = query.data ?? '';
    const parts = data.split(':');
    if (parts[0] !== 'fb' || parts.length < 3) {
      await this.answerCallback(query.id, '无法识别');
      return;
    }
    const sign = parts[1];
    const eventIdNum = Number.parseInt(parts[2], 10);
    if (!Number.isFinite(eventIdNum)) {
      await this.answerCallback(query.id, '事件 ID 无效');
      return;
    }

    const rating: 1 | -1 = sign === 'up' ? 1 : -1;
    const reasonTag = parts[3] ?? null;

    try {
      await this.deps.feedbackRepo.upsert({
        eventId: eventIdNum,
        rating,
        reasonTag
      });
      await this.answerCallback(query.id, rating === 1 ? '已记录 👍' : `已记录 👎${reasonTag ? ` (${reasonTag})` : ''}`);
    } catch (error) {
      this.deps.logger.warn('Failed to record feedback', { eventId: eventIdNum, error });
      await this.answerCallback(query.id, '保存失败');
    }
  }

  private async answerCallback(callbackQueryId: string, text: string): Promise<void> {
    try {
      await fetch(`https://api.telegram.org/bot${this.deps.env.telegramBotToken}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text,
          show_alert: false
        })
      });
    } catch (error) {
      this.deps.logger.warn('answerCallbackQuery failed', { error });
    }
  }
}
