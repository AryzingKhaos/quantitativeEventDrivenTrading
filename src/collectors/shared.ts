import * as cheerio from 'cheerio';

import type { CollectorItem } from './types.js';
import type { SourceFetcher } from './fetcher.js';
import { parseMaybeDate, sleep } from '../utils/time.js';
import { deriveSummary, normalizeWhitespace, sanitizeTitle, uniqueNonEmpty } from '../utils/text.js';
import type { SourceKey } from '../types/source.js';
import type { Logger } from '../utils/logger.js';

const DETAIL_FETCH_JITTER_MIN_MS = 200;
const DETAIL_FETCH_JITTER_MAX_MS = 1500;

interface Candidate {
  title: string;
  url: string;
  publishedAt: Date | null;
  summary: string | null;
}

interface DetailSelectors {
  title?: string[];
  summary?: string[];
  content?: string[];
  publishedAt?: string[];
}

interface CollectOptions {
  sourceKey: SourceKey;
  listUrl: string;
  baseUrl: string;
  hrefIncludes: string[];
  hrefExcludes?: string[];
  limit: number;
  knownUrls?: Set<string>;
  detailSelectors?: DetailSelectors;
  listParser?: (html: string, $: cheerio.CheerioAPI) => Candidate[];
  fetcher: SourceFetcher;
  listConditional?: { etag: string | null; lastModified: string | null };
  onListConditional?: (cache: { etag: string | null; lastModified: string | null }) => Promise<void> | void;
  logger?: Logger;
}

function toAbsoluteUrl(baseUrl: string, href: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function extractMetaContent($: cheerio.CheerioAPI, selector: string): string | null {
  const value = $(selector).attr('content');
  return value ? normalizeWhitespace(value) : null;
}

function extractText($: cheerio.CheerioAPI, selectors: string[] = []): string | null {
  for (const selector of selectors) {
    if (selector.startsWith('meta[')) {
      const metaValue = extractMetaContent($, selector);
      if (metaValue) {
        return metaValue;
      }
    }

    const value = normalizeWhitespace($(selector).first().text());
    if (value) {
      return value;
    }
  }

  return null;
}

function extractPublishedAt($: cheerio.CheerioAPI, selectors: string[] = []): Date | null {
  for (const selector of selectors) {
    const element = $(selector).first();
    const value =
      element.attr('datetime') ??
      element.attr('content') ??
      element.attr('dateTime') ??
      normalizeWhitespace(element.text());
    const parsed = parseMaybeDate(value);
    if (parsed) {
      return parsed;
    }
  }

  const meta =
    extractMetaContent($, 'meta[property="article:published_time"]') ??
    extractMetaContent($, 'meta[name="publish-date"]') ??
    extractMetaContent($, 'meta[name="date"]');

  return parseMaybeDate(meta);
}

function parseJsonLdCandidates(html: string, baseUrl: string): Candidate[] {
  const $ = cheerio.load(html);
  const candidates: Candidate[] = [];

  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).contents().text();
    if (!raw.trim()) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown> | Array<Record<string, unknown>>;
      const entries = Array.isArray(parsed) ? parsed : [parsed];

      for (const entry of entries) {
        const itemList = entry.itemListElement;
        if (!Array.isArray(itemList)) {
          continue;
        }

        for (const item of itemList) {
          const listItem = item as Record<string, unknown>;
          const nested = listItem.item as Record<string, unknown> | undefined;
          const url = typeof nested?.url === 'string' ? toAbsoluteUrl(baseUrl, nested.url) : null;
          const title =
            typeof nested?.name === 'string'
              ? sanitizeTitle(nested.name)
              : typeof listItem.name === 'string'
                ? sanitizeTitle(listItem.name)
                : '';

          if (!url || !title) {
            continue;
          }

          candidates.push({
            title,
            url,
            publishedAt: null,
            summary: null
          });
        }
      }
    } catch {
      return;
    }
  });

  return candidates;
}

function extractAnchorCandidates(
  $: cheerio.CheerioAPI,
  baseUrl: string,
  hrefIncludes: string[],
  hrefExcludes: string[]
): Candidate[] {
  const items: Candidate[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href') ?? '';
    if (!hrefIncludes.some((pattern) => href.includes(pattern))) {
      return;
    }

    if (hrefExcludes.some((pattern) => href.includes(pattern))) {
      return;
    }

    const url = toAbsoluteUrl(baseUrl, href);
    if (seen.has(url)) {
      return;
    }

    const title = sanitizeTitle($(element).text());
    if (!title || title.length < 6) {
      return;
    }

    seen.add(url);
    items.push({
      title,
      url,
      publishedAt: null,
      summary: null
    });
  });

  return items;
}

function mergeCandidates(candidates: Candidate[], extra: Candidate[]): Candidate[] {
  const merged = new Map<string, Candidate>();

  for (const candidate of [...candidates, ...extra]) {
    if (!candidate.url) {
      continue;
    }

    const existing = merged.get(candidate.url);
    if (!existing) {
      merged.set(candidate.url, candidate);
      continue;
    }

    merged.set(candidate.url, {
      title: existing.title || candidate.title,
      url: candidate.url,
      publishedAt: existing.publishedAt ?? candidate.publishedAt,
      summary: existing.summary ?? candidate.summary
    });
  }

  return [...merged.values()];
}

function parseDetailHtml(html: string, selectors: DetailSelectors | undefined): {
  title: string | null;
  summary: string | null;
  content: string | null;
  publishedAt: Date | null;
} {
  const $ = cheerio.load(html);

  const fallbackTitle = sanitizeTitle($('title').first().text());
  const title =
    extractText($, selectors?.title ?? ['h1']) ??
    extractMetaContent($, 'meta[property="og:title"]') ??
    extractMetaContent($, 'meta[name="twitter:title"]') ??
    (fallbackTitle || null);

  const content =
    extractText(
      $,
      selectors?.content ?? ['article', 'main article', '.article-content', '.markdown-body', 'main', 'body']
    ) ?? null;

  const summary =
    extractText($, selectors?.summary ?? ['meta[name="description"]', 'meta[property="og:description"]']) ??
    extractMetaContent($, 'meta[name="description"]') ??
    extractMetaContent($, 'meta[property="og:description"]') ??
    deriveSummary(null, content, 160);

  const publishedAt = extractPublishedAt(
    $,
    selectors?.publishedAt ?? ['time', '[datetime]', 'meta[property="article:published_time"]']
  );

  return {
    title,
    summary,
    content,
    publishedAt
  };
}

export async function collectFromListingPage(options: CollectOptions): Promise<CollectorItem[]> {
  let html: string;
  if (options.listConditional && (options.listConditional.etag || options.listConditional.lastModified)) {
    const result = await options.fetcher.fetchConditional(options.listUrl, options.listConditional);
    if (result.kind === 'not-modified') {
      return [];
    }
    html = result.text;
    if (options.onListConditional) {
      await options.onListConditional({ etag: result.etag, lastModified: result.lastModified });
    }
  } else {
    const result = await options.fetcher.fetchText(options.listUrl);
    html = result.text;
    if (options.onListConditional) {
      await options.onListConditional({
        etag: result.headers.get('etag'),
        lastModified: result.headers.get('last-modified')
      });
    }
  }

  const $ = cheerio.load(html);

  const anchorCandidates = extractAnchorCandidates(
    $,
    options.baseUrl,
    options.hrefIncludes,
    options.hrefExcludes ?? []
  );
  const jsonLdCandidates = parseJsonLdCandidates(html, options.baseUrl);
  const listParserCandidates = options.listParser ? options.listParser(html, $) : [];
  const mergedCandidates = mergeCandidates(anchorCandidates, mergeCandidates(jsonLdCandidates, listParserCandidates));
  const candidates = mergedCandidates
    .filter((candidate) => {
      if (!options.knownUrls || options.knownUrls.size === 0) {
        return true;
      }

      return !options.knownUrls.has(candidate.url);
    })
    .slice(0, options.limit);

  const items: CollectorItem[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (i > 0) {
      const jitter =
        DETAIL_FETCH_JITTER_MIN_MS +
        Math.round(Math.random() * (DETAIL_FETCH_JITTER_MAX_MS - DETAIL_FETCH_JITTER_MIN_MS));
      await sleep(jitter);
    }

    let detailHtml = '';
    try {
      const detailResult = await options.fetcher.fetchText(candidate.url, { referer: options.listUrl });
      detailHtml = detailResult.text;
    } catch (error) {
      options.logger?.warn('Detail fetch failed; falling back to listing-page candidate', {
        sourceKey: options.sourceKey,
        url: candidate.url,
        listUrl: options.listUrl,
        error
      });
      detailHtml = '';
    }

    const detail = detailHtml ? parseDetailHtml(detailHtml, options.detailSelectors) : null;
    const title = sanitizeTitle(detail?.title ?? candidate.title);
    if (!title) {
      continue;
    }

    const content = normalizeWhitespace(detail?.content ?? '');
    const summary = deriveSummary(detail?.summary ?? candidate.summary, content || null);

    items.push({
      sourceKey: options.sourceKey,
      title,
      summary,
      content: content || null,
      url: candidate.url,
      publishedAt: detail?.publishedAt ?? candidate.publishedAt,
      rawPayload: {
        listUrl: options.listUrl,
        candidate,
        detailFetched: Boolean(detailHtml)
      }
    });
  }

  const deduped = new Map<string, CollectorItem>();
  for (const item of items) {
    const key = `${item.url}|${item.title}`;
    if (!deduped.has(key)) {
      deduped.set(key, {
        ...item,
        summary: item.summary ? normalizeWhitespace(item.summary) : null,
        content: item.content ? normalizeWhitespace(item.content) : null,
        title: sanitizeTitle(item.title)
      });
    }
  }

  return [...deduped.values()].map((item) => ({
    ...item,
    summary: uniqueNonEmpty([item.summary])[0] ?? null,
    content: uniqueNonEmpty([item.content])[0] ?? null
  }));
}
