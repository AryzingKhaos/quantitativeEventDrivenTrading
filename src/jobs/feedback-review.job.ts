import cron, { type ScheduledTask } from 'node-cron';

import type { Logger } from '../utils/logger.js';
import type { FeedbackReviewService } from '../services/feedback-review.service.js';
import type { NotifyService } from '../services/notify.service.js';

interface FeedbackReviewJobDeps {
  logger: Logger;
  reviewService: FeedbackReviewService;
  notifyService: NotifyService;
  cronExpression: string;
  timezone?: string;
}

export class FeedbackReviewJob {
  private task: ScheduledTask | null = null;

  constructor(private readonly deps: FeedbackReviewJobDeps) {}

  start(): void {
    this.deps.logger.info('Registering feedback review cron', {
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
      const result = await this.deps.reviewService.run(new Date());
      if (!result) {
        return;
      }
      const message = `【本周推送复盘】\n${result.summary || '（LLM 未返回摘要）'}\n详情见 review #${result.reviewId}`;
      await this.deps.notifyService.sendBroadcast(message);
    } catch (error) {
      this.deps.logger.error('Feedback review job failed', { error });
    }
  }
}
