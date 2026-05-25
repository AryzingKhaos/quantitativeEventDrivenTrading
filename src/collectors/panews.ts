import type { CollectorDefinition } from './types.js';
import { collectFromListingPage } from './shared.js';
import { normalizeWhitespace, sanitizeTitle } from '../utils/text.js';
import { parseMaybeDate } from '../utils/time.js';

export const panewsCollector: CollectorDefinition = {
  sourceKey: 'panews',
  async collect({ source, fetcher, limit, knownUrls, listConditional, onListConditional, logger }) {
    return collectFromListingPage({
      sourceKey: 'panews',
      listUrl: source.listUrl,
      baseUrl: source.baseUrl,
      hrefIncludes: ['/zh/articledetails/', '/zh/articles/'],
      hrefExcludes: ['/zh/login', '/zh/signup'],
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
      },
      listParser: (_html, $) => {
        const items: Array<{ title: string; url: string; publishedAt: Date | null; summary: string | null }> = [];
        const targetLimit = limit ?? source.historicalLimit;

        // PANews currently uses /zh/articles/<uuid>; legacy /zh/articledetails/<slug>
        // is kept as a fallback in case CDNs serve old pages or the path migrates back.
        $('script[id="__NUXT_DATA__"]').each((_, element) => {
          const raw = $(element).contents().text();
          const matches = [
            ...raw.matchAll(/\/zh\/articles\/([a-zA-Z0-9-]+)/g),
            ...raw.matchAll(/\/zh\/articledetails\/([a-zA-Z0-9-]+)/g)
          ];
          const seen = new Set<string>();
          for (const match of matches) {
            const url = `${source.baseUrl}${match[0]}`;
            if (seen.has(url)) {
              continue;
            }
            seen.add(url);
            items.push({ title: '', url, publishedAt: null, summary: null });
            if (items.length >= targetLimit * 2) {
              break;
            }
          }
        });

        $('a[href*="/zh/articles/"], a[href*="/zh/articledetails/"]').each((_, element) => {
          const href = $(element).attr('href') ?? '';
          const title = sanitizeTitle($(element).text());
          const published = parseMaybeDate($(element).find('time').attr('datetime') ?? null);
          items.push({
            title,
            url: new URL(href, source.baseUrl).toString(),
            publishedAt: published,
            summary: normalizeWhitespace($(element).parent().text()) || null
          });
        });

        return items;
      }
    });
  }
};
