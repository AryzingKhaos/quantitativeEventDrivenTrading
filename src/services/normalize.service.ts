import type { CollectorItem } from '../collectors/types.js';
import type { NormalizedEvent } from '../types/event.js';
import { buildFingerprint } from '../utils/fingerprint.js';
import { deriveSummary, normalizeWhitespace, sanitizeTitle } from '../utils/text.js';
import { nowUtc, parseMaybeDate } from '../utils/time.js';

export class NormalizeService {
  normalize(item: CollectorItem): NormalizedEvent {
    const title = sanitizeTitle(item.title);
    if (!title) {
      throw new Error(`Collector item is missing title for ${item.sourceKey}`);
    }

    const content = normalizeWhitespace(item.content);
    const summary = deriveSummary(item.summary, content || null);
    const publishedAt = parseMaybeDate(item.publishedAt);
    const fetchedAt = nowUtc();

    return {
      sourceKey: item.sourceKey,
      title,
      summary,
      content: content || null,
      url: item.url,
      publishedAt,
      fetchedAt,
      fingerprint: buildFingerprint(item.sourceKey, item.url, title),
      rawPayload: item.rawPayload
    };
  }
}
