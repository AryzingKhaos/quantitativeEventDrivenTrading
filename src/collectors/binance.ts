import type { CollectorDefinition } from './types.js';
import { deriveSummary, normalizeWhitespace } from '../utils/text.js';
import { parseMaybeDate, sleep } from '../utils/time.js';

interface BinanceCatalogArticle {
  id: number;
  code: string;
  title: string;
}

interface BinanceCatalog {
  catalogId: number;
  catalogName: string;
  articles: BinanceCatalogArticle[];
}

interface BinanceListResponse {
  code: string;
  data?: {
    catalogs?: BinanceCatalog[];
  };
}

interface BinanceArticleDetailResponse {
  code: string;
  data?: {
    id: number;
    code: string;
    title: string;
    body: string | null;
    publishDate: number | null;
    contentJson?: string | null;
  };
}

type BinanceRichNode = {
  node?: string;
  text?: string;
  child?: BinanceRichNode[];
};

const BINANCE_CATALOG_IDS = [48, 49, 50, 161, 157];
const BINANCE_DETAIL_BATCH_SIZE = 5;
const BINANCE_DETAIL_BATCH_DELAY_MIN_MS = 200;
const BINANCE_DETAIL_BATCH_DELAY_MAX_MS = 600;

function renderRichTextToPlainText(node: BinanceRichNode | BinanceRichNode[] | null | undefined): string[] {
  if (!node) {
    return [];
  }

  if (Array.isArray(node)) {
    return node.flatMap((entry) => renderRichTextToPlainText(entry));
  }

  const lines: string[] = [];
  if (node.node === 'text' && node.text) {
    lines.push(node.text);
  }

  if (Array.isArray(node.child)) {
    const childText = renderRichTextToPlainText(node.child);
    if (childText.length > 0) {
      lines.push(...childText);
    }
  }

  return lines;
}

function parseBinanceBody(body: string | null | undefined): string | null {
  if (!body) {
    return null;
  }

  try {
    const parsed = JSON.parse(body) as BinanceRichNode;
    const content = normalizeWhitespace(renderRichTextToPlainText(parsed).join(' '));
    return content || null;
  } catch {
    return normalizeWhitespace(body) || null;
  }
}

export const binanceCollector: CollectorDefinition = {
  sourceKey: 'binance',
  async collect({ source, fetcher, limit, knownUrls }) {
    const targetLimit = limit ?? source.historicalLimit;
    const perCatalogLimit = Math.max(20, Math.ceil(targetLimit / BINANCE_CATALOG_IDS.length) + 1);
    const listUrl = `https://www.binance.com/bapi/composite/v1/public/cms/article/list/query?type=1&pageNo=1&pageSize=${perCatalogLimit}`;
    const listResponse = (await fetcher.fetchJson<BinanceListResponse>(listUrl)).data;

    if (listResponse.code !== '000000') {
      throw new Error(`Binance list query failed with code ${listResponse.code}`);
    }

    const articleCandidates = (listResponse.data?.catalogs ?? [])
      .filter((catalog) => BINANCE_CATALOG_IDS.includes(catalog.catalogId))
      .flatMap((catalog) => catalog.articles.slice(0, perCatalogLimit))
      .filter((article) => article.code && article.title);

    const dedupedCandidates = [...new Map(articleCandidates.map((article) => [article.code, article])).values()];
    const unseenCandidates = dedupedCandidates.filter((article) => {
      if (!knownUrls || knownUrls.size === 0) {
        return true;
      }

      const articleUrl = `${source.baseUrl}/zh-CN/support/announcement/detail/${article.code}`;
      return !knownUrls.has(articleUrl);
    });
    const selectedCandidates = unseenCandidates.slice(0, targetLimit);

    const details: Array<{
      sourceKey: 'binance';
      title: string;
      summary: string | null;
      content: string | null;
      url: string;
      publishedAt: Date | null;
      rawPayload: BinanceArticleDetailResponse['data'];
    } | null> = [];

    for (let index = 0; index < selectedCandidates.length; index += BINANCE_DETAIL_BATCH_SIZE) {
      const batch = selectedCandidates.slice(index, index + BINANCE_DETAIL_BATCH_SIZE);
      const batchDetails = await Promise.all(
        batch.map(async (article) => {
          const detailUrl = `https://www.binance.com/bapi/composite/v1/public/cms/article/detail/query?articleCode=${article.code}`;
          const detailResponse = (
            await fetcher.fetchJson<BinanceArticleDetailResponse>(detailUrl, {
              referer: `${source.baseUrl}/zh-CN/support/announcement`
            })
          ).data;

          if (detailResponse.code !== '000000' || !detailResponse.data) {
            return null;
          }

          const content = parseBinanceBody(detailResponse.data.body);
          const publishedAt = parseMaybeDate(detailResponse.data.publishDate);

          return {
            sourceKey: 'binance' as const,
            title: detailResponse.data.title,
            summary: deriveSummary(null, content),
            content,
            url: `${source.baseUrl}/zh-CN/support/announcement/detail/${detailResponse.data.code}`,
            publishedAt,
            rawPayload: detailResponse.data
          };
        })
      );

      details.push(...batchDetails);

      if (index + BINANCE_DETAIL_BATCH_SIZE < selectedCandidates.length) {
        const jitter =
          BINANCE_DETAIL_BATCH_DELAY_MIN_MS +
          Math.round(Math.random() * (BINANCE_DETAIL_BATCH_DELAY_MAX_MS - BINANCE_DETAIL_BATCH_DELAY_MIN_MS));
        await sleep(jitter);
      }
    }

    return details
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => {
        const leftTime = left.publishedAt?.getTime() ?? 0;
        const rightTime = right.publishedAt?.getTime() ?? 0;
        return rightTime - leftTime;
      })
      .slice(0, targetLimit);
  }
};
