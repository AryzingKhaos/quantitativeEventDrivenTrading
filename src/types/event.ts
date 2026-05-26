import type { MarketKind, SourceKey } from './source.js';

export interface NormalizedEvent {
  sourceKey: SourceKey;
  market: MarketKind;
  title: string;
  summary: string | null;
  content: string | null;
  url: string;
  publishedAt: Date | null;
  fetchedAt: Date;
  fingerprint: string;
  rawPayload: unknown;
}

/** Expected price direction the event implies. Forward-compat field for the trading version (≥0.0.4); v0.0.3 only displays it. */
export type Direction = 'bullish' | 'bearish' | 'neutral';
/** Whether the event was anticipated. `inline` (already priced-in) should pull impact down. */
export type Surprise = 'unscheduled' | 'beat' | 'inline' | 'miss';
/** Rough timescale over which the impact plays out. Forward-compat field for the trading version. */
export type Horizon = 'minutes' | 'intraday' | 'days';

export type RefinementCategory =
  | 'listing'
  | 'delisting'
  | 'maintenance'
  | 'hack'
  | 'regulation'
  | 'partnership'
  | 'funding'
  | 'macro'
  | 'people'
  | 'product'
  | 'noise';

export interface RefinementResult {
  importance: number; // expected trading impact 0-10
  category: RefinementCategory;
  affectedAssets: string[];
  actionable: boolean;
  tldr: string;
  reason: string;
  // v0.0.3 impact fields. direction/tickers/horizon are forward-compat for the trading version.
  direction: Direction;
  tickers: string[];
  surprise: Surprise;
  horizon: Horizon;
  confidence: number; // 0-1
  model: string;
  promptVersion: string;
}

export type ClusterRole = 'primary' | 'secondary';

export interface PersistedEvent extends NormalizedEvent {
  id: number;
  matched: boolean;
  matchedRule: string | null;
  score: number;
  createdAt: Date;
  importance: number | null;
  category: string | null;
  affectedAssets: string[] | null;
  actionable: boolean | null;
  tldr: string | null;
  reason: string | null;
  refinedAt: Date | null;
  refineModel: string | null;
  refinePromptVersion: string | null;
  clusterId: number | null;
  clusterRole: ClusterRole | null;
  // v0.0.3 impact + forward-compat columns
  triageScore: number | null;
  direction: string | null;
  tickers: string[] | null;
  surprise: string | null;
  horizon: string | null;
  confidence: number | null;
  detectLatencyMs: number | null;
}

export interface ScoreResult {
  matched: boolean;
  matchedRule: string | null;
  score: number;
  excludedBy: string | null;
  matchedKeywords: string[];
  /** Market of the matched rule; null when nothing matched. */
  market: MarketKind | null;
}

export interface SourceRunStats {
  sourceKey: SourceKey;
  fetchedCount: number;
  insertedCount: number;
  duplicateCount: number;
  matchedCount: number;
  notifiedCount: number;
  errorCount: number;
}
