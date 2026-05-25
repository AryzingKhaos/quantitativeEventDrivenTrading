import { config as loadDotEnv } from 'dotenv';

// `.env` holds secrets only (DATABASE_URL, TELEGRAM_*, DEEPSEEK_API_KEY) — never commit, AI-blocked.
// `.env.public` holds non-sensitive switches/thresholds/cron — safe to commit and AI-readable.
// dotenv defaults to override:false, so .env values take precedence; .env.public fills in the rest.
loadDotEnv();
loadDotEnv({ path: '.env.public' });

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface RuntimeEnv {
  databaseUrl: string;
  telegramBotToken: string;
  telegramChatId: string;
  logLevel: LogLevel;
  httpTimeoutMs: number;
  maxRetries: number;
  firstRunCandidateLimit: number;
  firstRunDeliveryLimit: number;
  httpFetcherV2: boolean;
  sourceFetcherProfileDir: string;
  schedulerV2: boolean;
  pollJitterRatio: number;
  deepseekApiKey: string | null;
  deepseekBaseUrl: string;
  deepseekModelFast: string;
  deepseekModelSmart: string;
  llmRefinementEnabled: boolean;
  llmRefinementThreshold: number;
  digestMinImportance: number;
  watchlistPath: string;
  clusteringEnabled: boolean;
  digestEnabled: boolean;
  digestCron: string;
  digestTimezone: string;
  feedbackEnabled: boolean;
  feedbackReviewEnabled: boolean;
  feedbackReviewCron: string;
  effectivenessTrackingEnabled: boolean;
  priceSnapshotCron: string;
  logFilePath: string | null;
}

function readRequired(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function readInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer`);
  }

  return value;
}

function readLogLevel(): LogLevel {
  const value = process.env.LOG_LEVEL?.trim() as LogLevel | undefined;
  return value && ['debug', 'info', 'warn', 'error'].includes(value) ? value : 'info';
}

function readBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  return raw === 'true' || raw === '1' || raw === 'yes';
}

function readString(name: string, fallback: string): string {
  const raw = process.env[name]?.trim();
  return raw && raw.length > 0 ? raw : fallback;
}

function readOptional(name: string): string | null {
  const raw = process.env[name]?.trim();
  return raw && raw.length > 0 ? raw : null;
}

function readFloat(name: string, fallback: number, opts: { min?: number; max?: number } = {}): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${name} must be a finite number`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new Error(`Environment variable ${name} must be >= ${opts.min}`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new Error(`Environment variable ${name} must be <= ${opts.max}`);
  }
  return value;
}

let cachedEnv: RuntimeEnv | null = null;

export function getEnv(): RuntimeEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = {
    databaseUrl: readRequired('DATABASE_URL'),
    telegramBotToken: readRequired('TELEGRAM_BOT_TOKEN'),
    telegramChatId: readRequired('TELEGRAM_CHAT_ID'),
    logLevel: readLogLevel(),
    httpTimeoutMs: readInteger('HTTP_TIMEOUT_MS', 15_000),
    maxRetries: readInteger('MAX_RETRIES', 3),
    firstRunCandidateLimit: readInteger('FIRST_RUN_CANDIDATE_LIMIT', 20),
    firstRunDeliveryLimit: readInteger('FIRST_RUN_DELIVERY_LIMIT', 10),
    httpFetcherV2: readBoolean('HTTP_FETCHER_V2', false),
    sourceFetcherProfileDir: readString('SOURCE_FETCHER_PROFILE_DIR', './fetcher-profiles'),
    schedulerV2: readBoolean('SCHEDULER_V2', false),
    pollJitterRatio: readFloat('POLL_JITTER_RATIO', 0.2, { min: 0, max: 0.5 }),
    deepseekApiKey: readOptional('DEEPSEEK_API_KEY'),
    deepseekBaseUrl: readString('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
    deepseekModelFast: readString('DEEPSEEK_MODEL_FAST', 'deepseek-chat'),
    deepseekModelSmart: readString('DEEPSEEK_MODEL_SMART', 'deepseek-reasoner'),
    llmRefinementEnabled: readBoolean('LLM_REFINEMENT_ENABLED', false),
    llmRefinementThreshold: readInteger('LLM_REFINEMENT_THRESHOLD', 6),
    digestMinImportance: readInteger('DIGEST_MIN_IMPORTANCE', 3),
    watchlistPath: readString('WATCHLIST_PATH', './config/watchlist.json'),
    clusteringEnabled: readBoolean('CLUSTERING_ENABLED', false),
    digestEnabled: readBoolean('DIGEST_ENABLED', false),
    digestCron: readString('DIGEST_CRON', '0 8 * * *'),
    digestTimezone: readString('DIGEST_TIMEZONE', 'Asia/Shanghai'),
    feedbackEnabled: readBoolean('FEEDBACK_ENABLED', false),
    feedbackReviewEnabled: readBoolean('FEEDBACK_REVIEW_ENABLED', false),
    feedbackReviewCron: readString('FEEDBACK_REVIEW_CRON', '0 9 * * 0'),
    effectivenessTrackingEnabled: readBoolean('EFFECTIVENESS_TRACKING_ENABLED', false),
    priceSnapshotCron: readString('PRICE_SNAPSHOT_CRON', '*/5 * * * *'),
    // Default on: append JSONL to ./logs/app.log so failures are inspectable after the fact.
    // Set LOG_FILE_PATH= (empty) to disable.
    logFilePath: process.env.LOG_FILE_PATH === '' ? null : readString('LOG_FILE_PATH', './logs/app.log')
  };

  return cachedEnv;
}
