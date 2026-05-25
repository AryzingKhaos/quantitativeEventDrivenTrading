import cron, { type ScheduledTask } from 'node-cron';

import type { Logger } from '../utils/logger.js';
import type { EffectivenessService } from '../services/effectiveness.service.js';

interface PriceSnapshotJobDeps {
  logger: Logger;
  effectivenessService: EffectivenessService;
  cronExpression: string;
}

export class PriceSnapshotJob {
  private task: ScheduledTask | null = null;

  constructor(private readonly deps: PriceSnapshotJobDeps) {}

  start(): void {
    this.deps.logger.info('Registering price snapshot cron', { expression: this.deps.cronExpression });
    this.task = cron.schedule(this.deps.cronExpression, async () => {
      try {
        const result = await this.deps.effectivenessService.drainDuePending();
        if (result.processed > 0) {
          this.deps.logger.info('Price snapshot batch completed', result);
        }
      } catch (error) {
        this.deps.logger.error('Price snapshot job failed', { error });
      }
    });
  }

  stop(): void {
    this.task?.stop();
    this.task = null;
  }
}
