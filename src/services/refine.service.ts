import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import type { LlmClient } from './llm.client.js';
import type { Logger } from '../utils/logger.js';
import type { PersistedEvent, RefinementCategory, RefinementResult } from '../types/event.js';
import type { Watchlist } from '../config/watchlist.js';
import { watchlistAssetsSet } from '../config/watchlist.js';

export const REFINE_PROMPT_VERSION = 'v1-2026-05';

const VALID_CATEGORIES: ReadonlySet<RefinementCategory> = new Set([
  'listing',
  'delisting',
  'maintenance',
  'hack',
  'regulation',
  'partnership',
  'funding',
  'macro',
  'people',
  'product',
  'noise'
]);

export interface RefineRouting {
  kind: 'critical' | 'digest' | 'silent';
  importanceAfterBoost: number;
  reason: string;
}

interface RefineDeps {
  llm: LlmClient;
  watchlist: Watchlist;
  logger: Logger;
  llmRefinementThreshold: number;
  digestMinImportance: number;
}

export class RefineService {
  constructor(private readonly deps: RefineDeps) {}

  async refine(event: Pick<PersistedEvent, 'sourceKey' | 'title' | 'summary' | 'content' | 'publishedAt'>): Promise<
    RefinementResult | null
  > {
    const messages = this.buildMessages(event);
    let raw: string;
    let model: string;

    try {
      const result = await this.deps.llm.chat(messages, { json: true, temperature: 0.2, maxTokens: 400 });
      raw = result.text;
      model = result.model;
    } catch (error) {
      this.deps.logger.warn('LLM refine call failed', { sourceKey: event.sourceKey, title: event.title, error });
      return null;
    }

    const parsed = this.parseResponse(raw);
    if (!parsed) {
      this.deps.logger.warn('LLM refine returned unparseable JSON', {
        sourceKey: event.sourceKey,
        title: event.title,
        raw: raw.slice(0, 300)
      });
      return null;
    }

    return { ...parsed, model, promptVersion: REFINE_PROMPT_VERSION };
  }

  /**
   * Apply watchlist boost (importance += 2 capped at 10 if any affected asset
   * is in the watchlist) and route to critical / digest / silent buckets.
   */
  route(refined: RefinementResult): RefineRouting {
    const watchSet = watchlistAssetsSet(this.deps.watchlist);
    const overlap = refined.affectedAssets.filter((asset) => watchSet.has(asset.toUpperCase()));
    const boosted = Math.min(10, refined.importance + (overlap.length > 0 ? 2 : 0));

    if (refined.category === 'noise' || boosted < this.deps.digestMinImportance) {
      return {
        kind: 'silent',
        importanceAfterBoost: boosted,
        reason:
          refined.category === 'noise'
            ? 'category=noise'
            : `boosted importance ${boosted} < digest min ${this.deps.digestMinImportance}`
      };
    }
    if (boosted >= this.deps.llmRefinementThreshold) {
      return {
        kind: 'critical',
        importanceAfterBoost: boosted,
        reason: `boosted importance ${boosted} >= critical threshold ${this.deps.llmRefinementThreshold}`
      };
    }
    return {
      kind: 'digest',
      importanceAfterBoost: boosted,
      reason: `digest range (${this.deps.digestMinImportance} <= ${boosted} < ${this.deps.llmRefinementThreshold})`
    };
  }

  private buildMessages(
    event: Pick<PersistedEvent, 'sourceKey' | 'title' | 'summary' | 'content' | 'publishedAt'>
  ): ChatCompletionMessageParam[] {
    const description = this.deps.watchlist.description ?? '无（默认偏好：交易所上下币、监管、被盗/破产、宏观、关键人物事件）';
    const watchAssets = this.deps.watchlist.assets.length > 0 ? this.deps.watchlist.assets.join(', ') : '（暂无）';
    const watchCategories =
      this.deps.watchlist.categories.length > 0 ? this.deps.watchlist.categories.join(', ') : '（暂无）';

    const system = `你是一个加密货币与全球金融新闻的资深编辑助手。判断一则事件对用户的重要性。

用户画像：
- 主动跟踪资产：${watchAssets}
- 关注赛道：${watchCategories}
- 关心方向：${description}

输出严格 JSON（不要包裹在 markdown 代码块里），字段：
{
  "importance": 0-10 整数,
  "category": "listing"|"delisting"|"maintenance"|"hack"|"regulation"|"partnership"|"funding"|"macro"|"people"|"product"|"noise",
  "affected_assets": ["BTC", ...],   // ticker 大写，无相关填空数组
  "actionable": true|false,           // 是否需要用户立即采取行动
  "tldr": "<= 50 字一句话",
  "reason": "<= 100 字"
}

打分标准：
- 9-10：直接影响用户持仓/watchlist 的关键事件（持仓上下币、被盗、监管制裁）
- 7-8：值得立即知晓的市场事件（重大上下币、ETF 通过、SEC 行动）
- 5-6：值得知道但不紧急（融资、合作、产品发布）
- 3-4：背景信息（行情评论、研报）
- 0-2：噪声（活动预告、教程、抽奖、维护通知）`;

    const summary = event.summary ?? (event.content ? event.content.slice(0, 500) : '（无摘要）');
    const publishedAt = event.publishedAt ? event.publishedAt.toISOString() : '未知';
    const user = `来源：${event.sourceKey}
标题：${event.title}
摘要：${summary}
发布时间：${publishedAt}`;

    return [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ];
  }

  private parseResponse(raw: string): Omit<RefinementResult, 'model' | 'promptVersion'> | null {
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      // attempt to extract from stray markdown fences
      const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
      if (!fenced) {
        return null;
      }
      try {
        payload = JSON.parse(fenced[1]);
      } catch {
        return null;
      }
    }

    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const obj = payload as Record<string, unknown>;
    const importanceRaw = obj.importance;
    const importance = typeof importanceRaw === 'number' ? Math.round(importanceRaw) : NaN;
    if (!Number.isFinite(importance) || importance < 0 || importance > 10) {
      return null;
    }

    const categoryRaw = typeof obj.category === 'string' ? (obj.category.toLowerCase() as RefinementCategory) : null;
    const category: RefinementCategory = categoryRaw && VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : 'noise';

    const affectedAssets = Array.isArray(obj.affected_assets)
      ? obj.affected_assets
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim().toUpperCase())
          .filter(Boolean)
      : [];

    const actionable = typeof obj.actionable === 'boolean' ? obj.actionable : false;
    const tldr = typeof obj.tldr === 'string' ? obj.tldr.trim().slice(0, 200) : '';
    const reason = typeof obj.reason === 'string' ? obj.reason.trim().slice(0, 400) : '';

    return { importance, category, affectedAssets, actionable, tldr, reason };
  }
}
