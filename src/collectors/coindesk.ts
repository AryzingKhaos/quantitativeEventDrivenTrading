import type { CollectorDefinition } from './types.js';
import { collectFromRssFeed } from './rss.js';

export const coindeskCollector: CollectorDefinition = {
  sourceKey: 'coindesk',
  async collect({ source, fetcher, limit, knownUrls }) {
    return collectFromRssFeed({
      sourceKey: 'coindesk',
      feedUrl: source.listUrl,
      fetcher,
      limit: limit ?? source.historicalLimit,
      knownUrls
    });
  }
};
