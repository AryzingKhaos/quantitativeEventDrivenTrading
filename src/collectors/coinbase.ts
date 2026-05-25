import type { CollectorDefinition } from './types.js';
import { collectFromListingPage } from './shared.js';

export const coinbaseCollector: CollectorDefinition = {
  sourceKey: 'coinbase',
  async collect({ source, fetcher, limit, knownUrls, listConditional, onListConditional, logger }) {
    return collectFromListingPage({
      sourceKey: 'coinbase',
      listUrl: source.listUrl,
      baseUrl: source.baseUrl,
      hrefIncludes: ['/blog/'],
      hrefExcludes: ['/blog?'],
      limit: limit ?? source.historicalLimit,
      knownUrls,
      fetcher,
      logger,
      listConditional,
      onListConditional,
      detailSelectors: {
        title: ['h1'],
        summary: ['meta[name="description"]'],
        content: ['article', 'main', '[class*="RichText"]', '[data-testid="blog-post-content"]'],
        publishedAt: ['time', '[datetime]']
      }
    });
  }
};
