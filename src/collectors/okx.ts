import type { CollectorDefinition } from './types.js';
import { collectFromListingPage } from './shared.js';

export const okxCollector: CollectorDefinition = {
  sourceKey: 'okx',
  async collect({ source, fetcher, limit, knownUrls, listConditional, onListConditional, logger }) {
    return collectFromListingPage({
      sourceKey: 'okx',
      listUrl: source.listUrl,
      baseUrl: source.baseUrl,
      hrefIncludes: ['/zh-hans/help/'],
      hrefExcludes: ['/section/', '/category/'],
      limit: limit ?? source.historicalLimit,
      knownUrls,
      fetcher,
      logger,
      listConditional,
      onListConditional,
      detailSelectors: {
        title: ['h1'],
        summary: ['meta[name="description"]'],
        content: ['article', 'main', '[class*="article"]', '[class*="richText"]'],
        publishedAt: ['time', '[datetime]']
      }
    });
  }
};
