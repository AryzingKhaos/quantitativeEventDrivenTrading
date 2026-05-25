import type { SourceKey } from './source.js';

export interface NormalizedEvent {
  sourceKey: SourceKey;
  title: string;
  summary: string | null;
  content: string | null;
  url: string;
  publishedAt: Date | null;
  fetchedAt: Date;
  fingerprint: string;
  rawPayload: unknown;
}

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
  importance: number;
  category: RefinementCategory;
  affectedAssets: string[];
  actionable: boolean;
  tldr: string;
  reason: string;
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
}

export interface ScoreResult {
  matched: boolean;
  matchedRule: string | null;
  score: number;
  excludedBy: string | null;
  matchedKeywords: string[];
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
