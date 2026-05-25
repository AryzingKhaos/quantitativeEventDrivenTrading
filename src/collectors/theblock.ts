import type { CollectorDefinition } from './types.js';
import { collectFromRssFeed } from './rss.js';

export const theblockCollector: CollectorDefinition = {
  sourceKey: 'theblock',
  async collect({ source, fetcher, limit, knownUrls }) {
    return collectFromRssFeed({
      sourceKey: 'theblock',
      feedUrl: source.listUrl,
      fetcher,
      limit: limit ?? source.historicalLimit,
      knownUrls
    });
  }
};
