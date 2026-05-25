import { rules } from '../config/rules.js';
import type { PersistedEvent, ScoreResult } from '../types/event.js';
import type { Rule } from '../types/rule.js';
import { cleanEventTextForScoring } from '../utils/source-text.js';
import { includesExcludeKeyword, includesKeyword, normalizeWhitespace } from '../utils/text.js';

function buildHaystack(event: Pick<PersistedEvent, 'sourceKey' | 'title' | 'summary' | 'content'>): string {
  const cleaned = cleanEventTextForScoring(event);
  return normalizeWhitespace([cleaned.title, cleaned.summary, cleaned.content].filter(Boolean).join(' '));
}

export class FilterService {
  evaluate(event: Pick<PersistedEvent, 'sourceKey' | 'title' | 'summary' | 'content'>): ScoreResult {
    const applicableRules = rules.filter((rule) => rule.enabled && rule.sources.includes(event.sourceKey));
    const haystack = buildHaystack(event);

    for (const rule of applicableRules) {
      const excludedBy = rule.excludeKeywords.find((keyword) => includesExcludeKeyword(haystack, keyword));
      if (excludedBy) {
        return {
          matched: false,
          matchedRule: null,
          score: 0,
          excludedBy,
          matchedKeywords: []
        };
      }
    }

    const scoredResults = applicableRules.map((rule) => this.evaluateRule(rule, haystack));
    const best = scoredResults.sort((left, right) => right.score - left.score)[0];

    if (!best) {
      return {
        matched: false,
        matchedRule: null,
        score: 0,
        excludedBy: null,
        matchedKeywords: []
      };
    }

    return best;
  }

  private evaluateRule(rule: Rule, haystack: string): ScoreResult {
    const matchedKeywords: string[] = [];
    let score = 0;

    for (const keyword of rule.keywords) {
      if (!includesKeyword(haystack, keyword.term)) {
        continue;
      }

      matchedKeywords.push(keyword.term);
      score += keyword.score;
    }

    return {
      matched: score >= rule.threshold,
      matchedRule: score >= rule.threshold ? rule.name : null,
      score,
      excludedBy: null,
      matchedKeywords
    };
  }
}
