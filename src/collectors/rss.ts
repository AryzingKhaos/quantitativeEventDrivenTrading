import * as cheerio from 'cheerio';

import type { CollectorDefinition, CollectorItem } from './types.js';
import type { SourceFetcher } from './fetcher.js';
import type { SourceKey } from '../types/source.js';
import { deriveSummary, normalizeWhitespace, sanitizeTitle } from '../utils/text.js';
import { parseMaybeDate } from '../utils/time.js';

export interface RssCollectOptions {
  sourceKey: SourceKey;
  feedUrl: string;
  fetcher: SourceFetcher;
  limit: number;
  knownUrls?: Set<string>;
}

export async function collectFromRssFeed(options: RssCollectOptions): Promise<CollectorItem[]> {
  const { text } = await options.fetcher.fetchText(options.feedUrl);
  const $ = cheerio.load(text, { xmlMode: true });

  const items: CollectorItem[] = [];

  // RSS 2.0
  $('item').each((_, element) => {
    const node = $(element);
    const url = normalizeWhitespace(node.find('link').first().text());
    if (!url) {
      return;
    }
    if (options.knownUrls?.has(url)) {
      return;
    }

    const title = sanitizeTitle(node.find('title').first().text());
    if (!title) {
      return;
    }

    const description = normalizeWhitespace(node.find('description').first().text());
    const contentEncoded = normalizeWhitespace(
      node.find('content\\:encoded, encoded').first().text()
    );
    const pubDate = node.find('pubDate').first().text() || node.find('dc\\:date, date').first().text();

    items.push({
      sourceKey: options.sourceKey,
      title,
      summary: deriveSummary(description || null, contentEncoded || description || null),
      content: contentEncoded || description || null,
      url,
      publishedAt: parseMaybeDate(pubDate),
      rawPayload: { feedUrl: options.feedUrl, format: 'rss2' }
    });
  });

  // Atom
  if (items.length === 0) {
    $('entry').each((_, element) => {
      const node = $(element);
      const url =
        node.find('link[rel="alternate"]').attr('href') ??
        node.find('link').first().attr('href') ??
        normalizeWhitespace(node.find('id').first().text());
      if (!url) {
        return;
      }
      if (options.knownUrls?.has(url)) {
        return;
      }

      const title = sanitizeTitle(node.find('title').first().text());
      if (!title) {
        return;
      }

      const summary = normalizeWhitespace(node.find('summary').first().text());
      const content = normalizeWhitespace(node.find('content').first().text());
      const published = node.find('published').first().text() || node.find('updated').first().text();

      items.push({
        sourceKey: options.sourceKey,
        title,
        summary: deriveSummary(summary || null, content || summary || null),
        content: content || summary || null,
        url,
        publishedAt: parseMaybeDate(published),
        rawPayload: { feedUrl: options.feedUrl, format: 'atom' }
      });
    });
  }

  return items.slice(0, options.limit);
}

export function createRssCollector(sourceKey: SourceKey): CollectorDefinition {
  return {
    sourceKey,
    async collect({ source, fetcher, limit, knownUrls }) {
      return collectFromRssFeed({
        sourceKey,
        feedUrl: source.listUrl,
        fetcher,
        limit: limit ?? source.historicalLimit,
        knownUrls
      });
    }
  };
}
