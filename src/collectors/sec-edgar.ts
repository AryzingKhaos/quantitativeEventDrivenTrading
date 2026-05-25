import type { CollectorDefinition } from './types.js';
import { collectFromRssFeed } from './rss.js';

export const secEdgarCollector: CollectorDefinition = {
  sourceKey: 'sec_edgar',
  async collect({ source, fetcher, limit, knownUrls }) {
    return collectFromRssFeed({
      sourceKey: 'sec_edgar',
      feedUrl: source.listUrl,
      fetcher,
      limit: limit ?? source.historicalLimit,
      knownUrls
    });
  }
};
