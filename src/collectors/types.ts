import type { SourceConfig, SourceKey } from '../types/source.js';
import type { SourceFetcher } from './fetcher.js';
import type { Logger } from '../utils/logger.js';

export interface CollectorItem {
  sourceKey: SourceKey;
  title: string;
  summary: string | null;
  content: string | null;
  url: string;
  publishedAt: Date | null;
  rawPayload: unknown;
}

export interface CollectorContext {
  source: SourceConfig;
  fetcher: SourceFetcher;
  limit?: number;
  knownUrls?: Set<string>;
  /** Optional per-source listing-page conditional cache (etag / last-modified). */
  listConditional?: { etag: string | null; lastModified: string | null };
  /** Hook to record listing-page cache headers when a fresh body comes back. */
  onListConditional?: (cache: { etag: string | null; lastModified: string | null }) => Promise<void> | void;
  /** Optional logger so collectors can record per-candidate failures. */
  logger?: Logger;
}

export interface CollectorDefinition {
  sourceKey: SourceKey;
  collect(context: CollectorContext): Promise<CollectorItem[]>;
}
