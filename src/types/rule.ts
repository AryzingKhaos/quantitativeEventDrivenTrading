import type { MarketKind, SourceKey } from './source.js';

export interface KeywordRule {
  term: string;
  score: number;
}

export interface Rule {
  name: string;
  enabled: boolean;
  /** Market this rule belongs to. The filter only applies rules matching the event's market. */
  market: MarketKind;
  sources: SourceKey[];
  threshold: number;
  excludeKeywords: string[];
  keywords: KeywordRule[];
}
