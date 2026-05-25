import { normalizeWhitespace } from './text.js';
import type { PersistedEvent } from '../types/event.js';
import type { SourceKey } from '../types/source.js';

const bybitNoiseMarkers = [
  '公告關注 Bybit 最新動態',
  'Current Page>',
  'Current Page >',
  '成為第一個獲得對加密世界的批判性見解和分析的人',
  '© 2018-2026 Bybit.com 版權所有',
  '服務協議 | 隱私條款'
];

function trimAfterFirstMarker(value: string, markers: string[]): string {
  let output = value;

  for (const marker of markers) {
    const index = output.indexOf(marker);
    if (index >= 0) {
      output = output.slice(0, index);
    }
  }

  return normalizeWhitespace(output);
}

export function cleanSourceField(sourceKey: SourceKey, value: string | null, title: string): string | null {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return null;
  }

  if (sourceKey !== 'bybit') {
    return normalized;
  }

  let cleaned = normalized;
  const titleIndex = cleaned.indexOf(title);
  if (titleIndex > 0) {
    cleaned = cleaned.slice(titleIndex);
  }

  cleaned = cleaned.replace(/^.*?Current Page>\s*/i, '');
  cleaned = cleaned.replace(/^.*?Current Page >\s*/i, '');
  cleaned = trimAfterFirstMarker(cleaned, bybitNoiseMarkers);

  return cleaned || null;
}

// AI-ecosystem blog/Substack feeds ship the full article body in their RSS
// (AWS ML ~30k chars, NVIDIA/404/Substack 10k+). For these the catalyst is in
// the headline/lead; the body is how-to/marketing prose that accumulates enough
// low-tier keyword hits ("agentic", "amazon", "partnership"…) to clear the
// threshold on pure tutorial posts. So we score only the lead for them.
//
// Exchange/crypto-news sources (panews ~830, Binance ~3.9k) are the opposite:
// the signal often lives in the body (e.g. Binance's English "Will List …"
// titles don't contain the keyword "listing"), so they stay uncapped.
const LONG_BODY_SCORING_SOURCES = new Set<SourceKey>([
  'openai_blog',
  'nvidia_blog',
  'google_ai_blog',
  'microsoft_ai_blog',
  'aws_ml_blog',
  'huggingface_blog',
  'deepmind_blog',
  'gary_marcus',
  'ai_snake_oil',
  'pluralistic',
  'media_404',
  'tech_policy_press'
]);
const LONG_BODY_SCORING_MAX_CHARS = 280;

export function cleanEventTextForScoring(
  event: Pick<PersistedEvent, 'sourceKey' | 'title' | 'summary' | 'content'>
): Pick<PersistedEvent, 'title' | 'summary' | 'content'> {
  const content = cleanSourceField(event.sourceKey, event.content, event.title);
  const cappedContent =
    content && LONG_BODY_SCORING_SOURCES.has(event.sourceKey)
      ? content.slice(0, LONG_BODY_SCORING_MAX_CHARS)
      : content;
  return {
    title: normalizeWhitespace(event.title),
    summary: cleanSourceField(event.sourceKey, event.summary, event.title),
    content: cappedContent
  };
}
