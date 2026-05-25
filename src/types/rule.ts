import type { SourceKey } from './source.js';

export interface KeywordRule {
  term: string;
  score: number;
}

export interface Rule {
  name: string;
  enabled: boolean;
  sources: SourceKey[];
  threshold: number;
  excludeKeywords: string[];
  keywords: KeywordRule[];
}
