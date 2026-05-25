import { getEnv } from './config/env.js';
import { binanceCollector } from './collectors/binance.js';
import { okxCollector } from './collectors/okx.js';
import { bybitCollector } from './collectors/bybit.js';
import { coinbaseCollector } from './collectors/coinbase.js';
import { bitgetCollector } from './collectors/bitget.js';
import { panewsCollector } from './collectors/panews.js';
import { theblockCollector } from './collectors/theblock.js';
import { coindeskCollector } from './collectors/coindesk.js';
import { secEdgarCollector } from './collectors/sec-edgar.js';
import { createRssCollector } from './collectors/rss.js';
import { createDbPool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { EventsRepository } from './db/events.repo.js';
import { NotificationsRepository } from './db/notifications.repo.js';
import { SourceStateRepository } from './db/source-state.repo.js';
import { ClustersRepository } from './db/clusters.repo.js';
import { FeedbackRepository, FeedbackReviewsRepository } from './db/feedback.repo.js';
import { PendingSnapshotsRepository, PriceSnapshotsRepository } from './db/snapshots.repo.js';
import { PollJob } from './jobs/poll.job.js';
import { DigestJob } from './jobs/digest.job.js';
import { TelegramCallbackJob } from './jobs/telegram-callback.job.js';
import { FeedbackReviewJob } from './jobs/feedback-review.job.js';
import { PriceSnapshotJob } from './jobs/price-snapshot.job.js';
import { FeedbackReviewService } from './services/feedback-review.service.js';
import { PriceService } from './services/price.service.js';
import { EffectivenessService } from './services/effectiveness.service.js';
import { CollectService } from './services/collect.service.js';
import { NormalizeService } from './services/normalize.service.js';
import { FilterService } from './services/filter.service.js';
import { NotifyService } from './services/notify.service.js';
import { LlmClient } from './services/llm.client.js';
import { RefineService } from './services/refine.service.js';
import { TranslationService } from './services/translation.service.js';
import { ClusterService } from './services/cluster.service.js';
import { DigestService } from './services/digest.service.js';
import { loadWatchlist, type Watchlist } from './config/watchlist.js';
import { createLogger } from './utils/logger.js';
import type { SourceKey } from './types/source.js';

export interface BootstrapOptions {
  once?: boolean;
  sourceKey?: SourceKey;
}

export interface BootstrapHandle {
  stop(): Promise<void>;
}

export async function bootstrap(options: BootstrapOptions = {}): Promise<BootstrapHandle> {
  const env = getEnv();
  const logger = createLogger(env.logLevel, { filePath: env.logFilePath });

  await runMigrations();
  logger.info('Database migrations ensured');

  const pool = createDbPool(env);
  const eventsRepo = new EventsRepository(pool);
  const notificationsRepo = new NotificationsRepository(pool);
  const sourceStateRepo = new SourceStateRepository(pool);
  const clustersRepo = new ClustersRepository(pool);
  const feedbackRepo = new FeedbackRepository(pool);
  const feedbackReviewsRepo = new FeedbackReviewsRepository(pool);
  const aiRssSourceKeys: SourceKey[] = [
    'openai_blog',
    'nvidia_blog',
    'google_ai_blog',
    'deepmind_blog',
    'microsoft_ai_blog',
    'aws_ml_blog',
    'huggingface_blog',
    'jiqizhixin',
    'huxiu',
    'kr36',
    'qbitai',
    'arxiv_cs_ai',
    'arxiv_cs_cl',
    'arxiv_cs_lg',
    'whitehouse',
    'gary_marcus',
    'ai_snake_oil',
    'pluralistic',
    'media_404',
    'tech_policy_press'
  ];

  const collectService = new CollectService({
    collectors: [
      binanceCollector,
      okxCollector,
      bybitCollector,
      coinbaseCollector,
      bitgetCollector,
      panewsCollector,
      theblockCollector,
      coindeskCollector,
      secEdgarCollector,
      ...aiRssSourceKeys.map(createRssCollector)
    ],
    sourceStateRepo,
    httpFetcherV2: env.httpFetcherV2,
    httpTimeoutMs: env.httpTimeoutMs,
    profileDir: env.sourceFetcherProfileDir,
    logger
  });
  const normalizeService = new NormalizeService();
  const filterService = new FilterService();

  // LlmClient is needed by translation (always-on when key present) AND by refine/cluster/digest.
  // Construct it up-front so NotifyService can receive a TranslationService.
  let llmClient: LlmClient | undefined;
  let translationService: TranslationService | null = null;
  if (env.deepseekApiKey) {
    llmClient = new LlmClient(env);
    translationService = new TranslationService({
      llm: llmClient,
      model: env.deepseekModelFast,
      logger
    });
    logger.info('Translation gate enabled for English sources');
  } else {
    logger.warn('DEEPSEEK_API_KEY missing; translation gate disabled, English news pushed as-is');
  }

  const notifyService = new NotifyService(
    env,
    { feedbackEnabled: env.feedbackEnabled },
    translationService
  );

  let refineService: RefineService | undefined;
  let clusterService: ClusterService | undefined;
  let digestJob: DigestJob | undefined;
  let watchlist: Watchlist | undefined;

  const llmFeatureRequested = env.llmRefinementEnabled || env.clusteringEnabled || env.digestEnabled;
  if (llmFeatureRequested) {
    if (!llmClient) {
      logger.warn('LLM features requested but DEEPSEEK_API_KEY missing; disabling refine/cluster/digest', {
        llmRefinementEnabled: env.llmRefinementEnabled,
        clusteringEnabled: env.clusteringEnabled,
        digestEnabled: env.digestEnabled
      });
    } else {
      watchlist = await loadWatchlist(env.watchlistPath);
      logger.info('Loaded watchlist', {
        path: env.watchlistPath,
        assetCount: watchlist.assets.length,
        categoryCount: watchlist.categories.length
      });

      if (env.llmRefinementEnabled) {
        refineService = new RefineService({
          llm: llmClient,
          watchlist,
          logger,
          llmRefinementThreshold: env.llmRefinementThreshold,
          digestMinImportance: env.digestMinImportance
        });
      }

      if (env.clusteringEnabled) {
        if (!env.llmRefinementEnabled) {
          logger.warn('CLUSTERING_ENABLED=true requires LLM_REFINEMENT_ENABLED=true; clustering will not run');
        } else {
          clusterService = new ClusterService({
            llm: llmClient,
            eventsRepo,
            clustersRepo,
            logger
          });
        }
      }

      if (env.digestEnabled) {
        const digestService = new DigestService({
          llm: llmClient,
          eventsRepo,
          watchlist,
          logger,
          smartModel: env.deepseekModelSmart,
          fastModelFallback: env.deepseekModelFast,
          digestMinImportance: env.digestMinImportance
        });
        digestJob = new DigestJob({
          logger,
          digestService,
          notifyService,
          cronExpression: env.digestCron,
          timezone: env.digestTimezone
        });
      }
    }
  }

  let telegramCallbackJob: TelegramCallbackJob | undefined;
  if (env.feedbackEnabled) {
    telegramCallbackJob = new TelegramCallbackJob({ env, logger, feedbackRepo });
  }

  let effectivenessService: EffectivenessService | undefined;
  let priceSnapshotJob: PriceSnapshotJob | undefined;
  if (env.effectivenessTrackingEnabled) {
    const priceSnapshotsRepo = new PriceSnapshotsRepository(pool);
    const pendingSnapshotsRepo = new PendingSnapshotsRepository(pool);
    const priceService = new PriceService();
    effectivenessService = new EffectivenessService({
      logger,
      priceService,
      priceSnapshotsRepo,
      pendingSnapshotsRepo
    });
    priceSnapshotJob = new PriceSnapshotJob({
      logger,
      effectivenessService,
      cronExpression: env.priceSnapshotCron
    });
  }

  let feedbackReviewJob: FeedbackReviewJob | undefined;
  if (env.feedbackReviewEnabled) {
    if (!llmClient) {
      logger.warn('FEEDBACK_REVIEW_ENABLED=true but LLM client unavailable; review job disabled');
    } else {
      const reviewService = new FeedbackReviewService({
        llm: llmClient,
        feedbackRepo,
        reviewsRepo: feedbackReviewsRepo,
        smartModel: env.deepseekModelSmart,
        fastModel: env.deepseekModelFast,
        logger
      });
      feedbackReviewJob = new FeedbackReviewJob({
        logger,
        reviewService,
        notifyService,
        cronExpression: env.feedbackReviewCron,
        timezone: env.digestTimezone
      });
    }
  }

  const pollJob = new PollJob({
    env,
    logger,
    collectService,
    normalizeService,
    filterService,
    notifyService,
    eventsRepo,
    notificationsRepo,
    refineService,
    clusterService,
    effectivenessService
  });

  await pollJob.runInitialBackfill();

  if (options.once) {
    await pollJob.runOnce(options.sourceKey);
    await pool.end();
    return {
      async stop() {
        return;
      }
    };
  }

  const handle = pollJob.start();
  if (digestJob) {
    digestJob.start();
  }
  if (telegramCallbackJob) {
    telegramCallbackJob.start();
  }
  if (feedbackReviewJob) {
    feedbackReviewJob.start();
  }
  if (priceSnapshotJob) {
    priceSnapshotJob.start();
  }
  logger.info('Application started', {
    sourceKey: options.sourceKey ?? null,
    schedulerV2: env.schedulerV2,
    refineEnabled: Boolean(refineService),
    clusteringEnabled: Boolean(clusterService),
    digestEnabled: Boolean(digestJob),
    feedbackEnabled: Boolean(telegramCallbackJob),
    feedbackReviewEnabled: Boolean(feedbackReviewJob),
    effectivenessEnabled: Boolean(priceSnapshotJob)
  });

  const shutdown = async () => {
    digestJob?.stop();
    feedbackReviewJob?.stop();
    priceSnapshotJob?.stop();
    if (telegramCallbackJob) {
      await telegramCallbackJob.stop();
    }
    await handle.stop();
    await pool.end();
  };

  let shuttingDown = false;
  const handleSignal = async (signal: 'SIGINT' | 'SIGTERM') => {
    if (shuttingDown) {
      logger.warn(`Force exit on second ${signal}`);
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }
    shuttingDown = true;
    logger.warn(`Received ${signal}, shutting down (press again to force)`);
    await shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void handleSignal('SIGINT');
  });

  process.on('SIGTERM', () => {
    void handleSignal('SIGTERM');
  });

  return {
    stop: shutdown
  };
}
