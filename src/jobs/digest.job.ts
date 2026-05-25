import cron, { type ScheduledTask } from 'node-cron';

import type { Logger } from '../utils/logger.js';
import type { DigestService } from '../services/digest.service.js';
import type { NotifyService } from '../services/notify.service.js';

interface DigestJobDeps {
  logger: Logger;
  digestService: DigestService;
  notifyService: NotifyService;
  cronExpression: string;
  /** Asia/Shanghai by default, matching the plan's "每日早 8 点" semantics. */
  timezone?: string;
}

export class DigestJob {
  private task: ScheduledTask | null = null;

  constructor(private readonly deps: DigestJobDeps) {}

  start(): void {
    this.deps.logger.info('Registering digest cron', {
      expression: this.deps.cronExpression,
      timezone: this.deps.timezone ?? 'Asia/Shanghai'
    });

    this.task = cron.schedule(
      this.deps.cronExpression,
      async () => {
        await this.runOnce();
      },
      { timezone: this.deps.timezone ?? 'Asia/Shanghai' }
    );
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }

  async runOnce(): Promise<void> {
    try {
      const result = await this.deps.digestService.build(24);
      if (!result) {
        return;
      }
      const header = `【每日简报 · ${formatBeijingDate(new Date())}】`;
      await this.deps.notifyService.sendBroadcast(`${header}\n\n${result.text}`);
      this.deps.logger.info('Digest sent', { events: result.eventIds.length, model: result.model });
    } catch (error) {
      this.deps.logger.error('Digest job failed', { error });
    }
  }
}

function formatBeijingDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}
