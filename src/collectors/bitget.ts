import type { CollectorDefinition } from './types.js';
import { collectFromListingPage } from './shared.js';

export const bitgetCollector: CollectorDefinition = {
  sourceKey: 'bitget',
  async collect({ source, fetcher, limit, knownUrls, listConditional, onListConditional, logger }) {
    return collectFromListingPage({
      sourceKey: 'bitget',
      listUrl: source.listUrl,
      baseUrl: source.baseUrl,
      hrefIncludes: ['/support/articles/'],
      hrefExcludes: ['/support/sections/', '/support/categories/'],
      limit: limit ?? source.historicalLimit,
      knownUrls,
      fetcher,
      logger,
      listConditional,
      onListConditional,
      detailSelectors: {
        title: ['h1'],
        summary: ['meta[name="description"]'],
        content: ['article', 'main', '[class*="article"]', '[class*="content"]'],
        publishedAt: ['time', '[datetime]']
      }
    });
  }
};
