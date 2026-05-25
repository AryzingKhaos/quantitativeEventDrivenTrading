import type { CollectorContext, CollectorDefinition, CollectorItem } from './types.js';
import { collectFromListingPage } from './shared.js';
import { deriveSummary, normalizeWhitespace, sanitizeTitle } from '../utils/text.js';
import { cleanSourceField } from '../utils/source-text.js';
import { parseMaybeDate } from '../utils/time.js';

interface BybitAnnouncementItem {
  title?: string;
  description?: string;
  url?: string;
  dateTimestamp?: number;
  startDateTimestamp?: number;
  type?: { title?: string };
  tags?: string[];
}

interface BybitAnnouncementResponse {
  retCode?: number;
  retMsg?: string;
  result?: {
    total?: number;
    list?: BybitAnnouncementItem[];
  };
}

const BYBIT_API_URL = 'https://api.bybit.com/v5/announcements/index';
const BYBIT_API_TYPES = ['new_crypto', 'latest_activities', 'delistings'];

async function tryApi(context: CollectorContext, limit: number): Promise<CollectorItem[]> {
  const { source, fetcher, knownUrls } = context;
  const collected = new Map<string, CollectorItem>();

  for (const type of BYBIT_API_TYPES) {
    const url = `${BYBIT_API_URL}?locale=zh-TW&type=${type}&limit=${limit}`;
    const { data } = await fetcher.fetchJson<BybitAnnouncementResponse>(url, { referer: source.listUrl });
    if (data.retCode !== 0 || !data.result?.list) {
      continue;
    }

    for (const entry of data.result.list) {
      if (!entry.url || !entry.title) {
        continue;
      }
      if (knownUrls?.has(entry.url)) {
        continue;
      }
      if (collected.has(entry.url)) {
        continue;
      }

      const title = sanitizeTitle(entry.title);
      const description = normalizeWhitespace(entry.description ?? '') || null;
      const publishedMs = entry.startDateTimestamp || entry.dateTimestamp || null;

      collected.set(entry.url, {
        sourceKey: 'bybit',
        title,
        summary: deriveSummary(description, description),
        content: description,
        url: entry.url,
        publishedAt: publishedMs ? parseMaybeDate(publishedMs) : null,
        rawPayload: { strategy: 'api', type, ...entry }
      });
    }
  }

  return [...collected.values()]
    .sort((left, right) => {
      const leftMs = left.publishedAt?.getTime() ?? 0;
      const rightMs = right.publishedAt?.getTime() ?? 0;
      return rightMs - leftMs;
    })
    .slice(0, limit);
}

async function tryHtml(context: CollectorContext, limit: number): Promise<CollectorItem[]> {
  const { source, fetcher, knownUrls, listConditional, onListConditional, logger } = context;
  const items = await collectFromListingPage({
    sourceKey: 'bybit',
    listUrl: source.listUrl,
    baseUrl: source.baseUrl,
    hrefIncludes: ['/zh-TW/article/'],
    hrefExcludes: ['/categories/', '/author/', '/tag/'],
    limit,
    knownUrls,
    fetcher,
    logger,
    listConditional,
    onListConditional,
    detailSelectors: {
      title: ['meta[property="og:title"]', 'meta[name="twitter:title"]', 'h1'],
      summary: ['meta[name="description"]'],
      content: ['meta[name="description"]', 'article', 'main', '[class*="article"]', '[class*="content"]'],
      publishedAt: ['time', '[datetime]']
    }
  });

  return items.map((item) => {
    const content = cleanSourceField(item.sourceKey, item.content, item.title);
    const summaryCandidate = cleanSourceField(item.sourceKey, item.summary, item.title);
    const summary = deriveSummary(summaryCandidate, content ?? item.title);
    return { ...item, summary, content };
  });
}

export const bybitCollector: CollectorDefinition = {
  sourceKey: 'bybit',
  async collect(context) {
    const limit = context.limit ?? context.source.historicalLimit;

    try {
      const apiItems = await tryApi(context, limit);
      if (apiItems.length > 0) {
        return apiItems;
      }
      // API responded but returned nothing — let HTML take a swing in case the type list drifted.
    } catch {
      // fall through to HTML
    }

    return tryHtml(context, limit);
  }
};
