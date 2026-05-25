import cron, { type ScheduledTask } from 'node-cron';

import { enabledSources } from '../config/sources.js';
import type { RuntimeEnv } from '../config/env.js';
import type { Logger } from '../utils/logger.js';
import type { PersistedEvent, SourceRunStats } from '../types/event.js';
import type { SourceConfig, SourceKey } from '../types/source.js';
import { sleep } from '../utils/time.js';
import { CollectService } from '../services/collect.service.js';
import { NormalizeService } from '../services/normalize.service.js';
import { FilterService } from '../services/filter.service.js';
import { NotifyService } from '../services/notify.service.js';
import type { RefineService } from '../services/refine.service.js';
import type { ClusterService } from '../services/cluster.service.js';
import type { EffectivenessService } from '../services/effectiveness.service.js';
import { EventsRepository } from '../db/events.repo.js';
import { NotificationsRepository } from '../db/notifications.repo.js';

interface PollJobDependencies {
  env: RuntimeEnv;
  logger: Logger;
  collectService: CollectService;
  normalizeService: NormalizeService;
  filterService: FilterService;
  notifyService: NotifyService;
  eventsRepo: EventsRepository;
  notificationsRepo: NotificationsRepository;
  refineService?: RefineService;
  clusterService?: ClusterService;
  effectivenessService?: EffectivenessService;
}

function getRetryDelayMs(error: unknown, attempt: number): number {
  const message = error instanceof Error ? error.message : String(error);
  const jitterMultiplier = 1 + Math.random() * 0.35;
  if (message.includes('HTTP 429')) {
    return Math.round(Math.min(60_000, 10_000 * attempt) * jitterMultiplier);
  }

  return Math.round(Math.min(15_000, 1_000 * 2 ** (attempt - 1)) * jitterMultiplier);
}

function toCronExpression(intervalSec: number, offsetSec: number): string {
  if (intervalSec % 60 === 0) {
    const minutes = intervalSec / 60;
    return `${offsetSec} */${minutes} * * * *`;
  }

  return `${offsetSec}/${intervalSec} * * * * *`;
}

export interface PollJobHandle {
  /** Stop the scheduler. For v1 (cron) it stops the tasks; for v2 it signals the loops and resolves once they finish. */
  stop(): Promise<void>;
}

export class PollJob {
  private readonly cooldownUntilBySource = new Map<SourceKey, number>();
  private stopped = false;
  private readonly loopPromises: Promise<void>[] = [];

  constructor(private readonly deps: PollJobDependencies) {}

  async runInitialBackfill(): Promise<void> {
    const eventCount = await this.deps.eventsRepo.countAll();
    if (eventCount > 0) {
      return;
    }

    this.deps.logger.info('First run detected, collecting historical candidates');

    const matchedCandidates: PersistedEvent[] = [];
    for (const source of enabledSources) {
      const stats = await this.runSource(source, this.deps.env.firstRunCandidateLimit, false);
      this.deps.logger.info('First run source processed', {
        sourceKey: stats.sourceKey,
        fetchedCount: stats.fetchedCount,
        insertedCount: stats.insertedCount,
        duplicateCount: stats.duplicateCount,
        matchedCount: stats.matchedCount,
        notifiedCount: stats.notifiedCount,
        errorCount: stats.errorCount
      });
      matchedCandidates.push(...stats.matchedEvents);
      await sleep(1_000);
    }

    const topCandidates = matchedCandidates
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }

        const rightTime = (right.publishedAt ?? right.fetchedAt).getTime();
        const leftTime = (left.publishedAt ?? left.fetchedAt).getTime();
        return rightTime - leftTime;
      })
      .slice(0, this.deps.env.firstRunDeliveryLimit);

    let delivered = 0;
    for (const event of topCandidates) {
      delivered += await this.notifyIfNeeded(event);
    }

    this.deps.logger.info('First run backfill complete', {
      candidateCount: matchedCandidates.length,
      delivered
    });
  }

  start(): PollJobHandle {
    if (this.deps.env.schedulerV2) {
      return this.startSelfRescheduling();
    }
    return this.startCron();
  }

  private startCron(): PollJobHandle {
    const tasks: ScheduledTask[] = enabledSources.map((source, index) => {
      const offsetSec = (index * 7) % 60;
      const expression = toCronExpression(source.pollIntervalSec, offsetSec);

      this.deps.logger.info('Registering source schedule (cron)', {
        sourceKey: source.key,
        expression
      });

      return cron.schedule(expression, async () => {
        await this.runSource(source);
      });
    });

    return {
      stop: async () => {
        for (const task of tasks) {
          task.stop();
        }
      }
    };
  }

  private startSelfRescheduling(): PollJobHandle {
    const ratio = this.deps.env.pollJitterRatio;
    for (const source of enabledSources) {
      this.deps.logger.info('Registering source schedule (self-reschedule)', {
        sourceKey: source.key,
        baseIntervalSec: source.pollIntervalSec,
        jitterRatio: ratio
      });

      this.loopPromises.push(this.runForever(source, ratio));
    }

    return {
      stop: async () => {
        this.stopped = true;
        await Promise.allSettled(this.loopPromises);
      }
    };
  }

  private async runForever(source: SourceConfig, ratio: number): Promise<void> {
    // Initial stagger so loops don't all fire on the same wall-clock instant after process start.
    const initialDelay = Math.round(Math.random() * Math.min(15_000, source.pollIntervalSec * 1_000));
    await sleep(initialDelay);

    while (!this.stopped) {
      try {
        await this.runSource(source);
      } catch (error) {
        this.deps.logger.error('Self-reschedule loop iteration failed', {
          sourceKey: source.key,
          error
        });
      }

      if (this.stopped) {
        break;
      }

      const baseMs = source.pollIntervalSec * 1_000;
      const lower = 1 - ratio;
      const upper = 1 + ratio;
      const factor = lower + Math.random() * (upper - lower);
      const nextMs = Math.max(1_000, Math.round(baseMs * factor));
      await sleep(nextMs);
    }
  }

  async runOnce(sourceKey?: SourceKey): Promise<void> {
    const targets = sourceKey ? enabledSources.filter((source) => source.key === sourceKey) : enabledSources;

    for (const source of targets) {
      await this.runSource(source);
      await sleep(500);
    }
  }

  async runSource(
    source: SourceConfig,
    limit = source.historicalLimit,
    shouldNotify = true
  ): Promise<SourceRunStats & { matchedEvents: PersistedEvent[] }> {
    const startedAt = new Date();
    const stats: SourceRunStats & { matchedEvents: PersistedEvent[] } = {
      sourceKey: source.key,
      fetchedCount: 0,
      insertedCount: 0,
      duplicateCount: 0,
      matchedCount: 0,
      notifiedCount: 0,
      errorCount: 0,
      matchedEvents: []
    };

    const cooldownUntil = this.cooldownUntilBySource.get(source.key) ?? 0;
    if (cooldownUntil > Date.now()) {
      this.deps.logger.warn('Source is in cooldown, skipping poll', {
        sourceKey: source.key,
        sourceName: source.name,
        cooldownUntil: new Date(cooldownUntil).toISOString(),
        cooldownMsRemaining: cooldownUntil - Date.now()
      });
      return stats;
    }

    try {
      const items = await this.collectWithRetry(source, limit);
      stats.fetchedCount = items.length;

      for (const item of items) {
        try {
          const normalized = this.deps.normalizeService.normalize(item);
          const existing = await this.deps.eventsRepo.findByFingerprint(normalized.fingerprint);
          if (existing) {
            stats.duplicateCount += 1;
            continue;
          }

          const inserted = await this.deps.eventsRepo.insert(normalized);
          stats.insertedCount += 1;

          const scoreResult = this.deps.filterService.evaluate(inserted);
          let scoredEvent = await this.deps.eventsRepo.updateScore(inserted.id, scoreResult);

          if (scoreResult.matched) {
            stats.matchedCount += 1;
            stats.matchedEvents.push(scoredEvent);
          }

          let routing: 'critical' | 'digest' | 'silent' | null = null;
          let clusterRole: 'primary' | 'secondary' | null = null;
          if (this.deps.env.llmRefinementEnabled && this.deps.refineService && scoreResult.matched) {
            const refined = await this.deps.refineService.refine(scoredEvent);
            if (refined) {
              scoredEvent = await this.deps.eventsRepo.updateRefinement(scoredEvent.id, refined);
              const route = this.deps.refineService.route(refined);
              routing = route.kind;
              this.deps.logger.info('Event refined', {
                eventId: scoredEvent.id,
                sourceKey: scoredEvent.sourceKey,
                importance: refined.importance,
                category: refined.category,
                affectedAssets: refined.affectedAssets,
                routing: route.kind,
                routingReason: route.reason
              });

              if (this.deps.env.clusteringEnabled && this.deps.clusterService) {
                try {
                  const decision = await this.deps.clusterService.assign(scoredEvent);
                  clusterRole = decision.role;
                  this.deps.logger.info('Event clustered', {
                    eventId: scoredEvent.id,
                    clusterId: decision.clusterId,
                    role: decision.role,
                    kind: decision.kind
                  });
                } catch (error) {
                  this.deps.logger.warn('Clustering failed', { eventId: scoredEvent.id, error });
                }
              }
            }
          }

          if (shouldNotify && scoreResult.matched) {
            // routing===null means refine disabled / failed → fall back to v0.0.1 behavior (notify on match)
            const passesRouting = routing === null || routing === 'critical';
            // Skip secondary cluster members to avoid duplicate notifications.
            const passesCluster = clusterRole !== 'secondary';
            if (passesRouting && passesCluster) {
              stats.notifiedCount += await this.notifyIfNeeded(scoredEvent);
            }
          }
        } catch (error) {
          stats.errorCount += 1;
          this.deps.logger.error('Event processing failed', {
            sourceKey: source.key,
            error
          });
        }
      }
    } catch (error) {
      stats.errorCount += 1;
      this.deps.logger.error('Source poll failed', {
        sourceKey: source.key,
        error
      });
    }

    this.deps.logger.info('Source poll completed', {
      sourceKey: source.key,
      sourceName: source.name,
      startedAt: startedAt.toISOString(),
      fetchedCount: stats.fetchedCount,
      insertedCount: stats.insertedCount,
      duplicateCount: stats.duplicateCount,
      matchedCount: stats.matchedCount,
      notifiedCount: stats.notifiedCount,
      errorCount: stats.errorCount
    });

    return stats;
  }

  private async collectWithRetry(source: SourceConfig, limit: number) {
    let lastError: unknown = null;
    const knownUrls = await this.deps.eventsRepo.listRecentUrlsBySource(source.key, 200);

    for (let attempt = 1; attempt <= this.deps.env.maxRetries; attempt += 1) {
      try {
        return await this.deps.collectService.collect(source, limit, knownUrls);
      } catch (error) {
        lastError = error;
        const retryDelayMs = getRetryDelayMs(error, attempt);
        this.deps.logger.warn('Collector attempt failed', {
          sourceKey: source.key,
          sourceName: source.name,
          attempt,
          maxRetries: this.deps.env.maxRetries,
          retryDelayMs,
          error
        });

        if (attempt < this.deps.env.maxRetries) {
          await sleep(retryDelayMs);
        }
      }
    }

    if (this.isRateLimitedError(lastError)) {
      const cooldownMs = 30 * 60_000;
      this.cooldownUntilBySource.set(source.key, Date.now() + cooldownMs);
      this.deps.logger.warn('Source entered cooldown after repeated rate limiting', {
        sourceKey: source.key,
        sourceName: source.name,
        cooldownMs
      });
    }

    await this.deps.notifyService.sendSourceFailureAlert({
      sourceName: source.name,
      attemptCount: this.deps.env.maxRetries,
      errorSummary: lastError instanceof Error ? lastError.message : String(lastError),
      requestedAt: new Date()
    });

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private isRateLimitedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('HTTP 429');
  }

  private async notifyIfNeeded(event: PersistedEvent): Promise<number> {
    const target = this.deps.env.telegramChatId;
    const delivered = await this.deps.notificationsRepo.hasDelivered(event.id, target);
    if (delivered) {
      return 0;
    }

    try {
      const sendResult = await this.deps.notifyService.sendEvent(event);
      await this.deps.notificationsRepo.upsertDelivery({
        eventId: event.id,
        target,
        status: 'success',
        sentAt: new Date(),
        telegramMessageId: sendResult.messageId
      });
      if (this.deps.effectivenessService) {
        // Fire-and-forget; failures are swallowed inside the service.
        void this.deps.effectivenessService.trackBaseline(event).catch((error) => {
          this.deps.logger.warn('trackBaseline failed', { eventId: event.id, error });
        });
      }
      return 1;
    } catch (error) {
      await this.deps.notificationsRepo.upsertDelivery({
        eventId: event.id,
        target,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : String(error)
      });

      this.deps.logger.error('Telegram delivery failed', {
        eventId: event.id,
        sourceKey: event.sourceKey,
        error
      });
      return 0;
    }
  }
}
