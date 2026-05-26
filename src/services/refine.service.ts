import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import type { LlmClient } from './llm.client.js';
import type { Logger } from '../utils/logger.js';
import type {
  Direction,
  Horizon,
  PersistedEvent,
  RefinementCategory,
  RefinementResult,
  Surprise
} from '../types/event.js';
import type { MarketKind } from '../types/source.js';
import type { Watchlist } from '../config/watchlist.js';
import { watchlistAssetsSet } from '../config/watchlist.js';

export const REFINE_PROMPT_VERSION = 'v2-impact-2026-05';

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

const VALID_DIRECTIONS: ReadonlySet<Direction> = new Set(['bullish', 'bearish', 'neutral']);
const VALID_SURPRISE: ReadonlySet<Surprise> = new Set(['unscheduled', 'beat', 'inline', 'miss']);
const VALID_HORIZON: ReadonlySet<Horizon> = new Set(['minutes', 'intraday', 'days']);

export interface RefineRouting {
  kind: 'critical' | 'digest' | 'silent';
  importanceAfterBoost: number;
  reason: string;
}

type RefineEvent = Pick<PersistedEvent, 'sourceKey' | 'title' | 'summary' | 'content' | 'publishedAt'>;

interface RefineDeps {
  llm: LlmClient;
  watchlist: Watchlist;
  logger: Logger;
  llmRefinementThreshold: number;
  digestMinImportance: number;
}

export class RefineService {
  constructor(private readonly deps: RefineDeps) {}

  /**
   * Single LLM call over the headline + short summary: produces the full impact
   * judgement. `market` selects the prompt set. Returns null on any error so the
   * caller can fall back to the keyword path.
   */
  async refine(event: RefineEvent, market: MarketKind): Promise<RefinementResult | null> {
    const messages = this.buildMessages(event, market);
    let raw: string;
    let model: string;

    try {
      const result = await this.deps.llm.chat(messages, { json: true, temperature: 0.2, maxTokens: 500 });
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
    const overlap = [...refined.affectedAssets, ...refined.tickers].filter((asset) =>
      watchSet.has(asset.toUpperCase())
    );
    const boosted = Math.min(10, refined.importance + (overlap.length > 0 ? 2 : 0));

    if (refined.category === 'noise' || boosted < this.deps.digestMinImportance) {
      return {
        kind: 'silent',
        importanceAfterBoost: boosted,
        reason:
          refined.category === 'noise'
            ? 'category=noise'
            : `boosted impact ${boosted} < digest min ${this.deps.digestMinImportance}`
      };
    }
    if (boosted >= this.deps.llmRefinementThreshold) {
      return {
        kind: 'critical',
        importanceAfterBoost: boosted,
        reason: `boosted impact ${boosted} >= critical threshold ${this.deps.llmRefinementThreshold}`
      };
    }
    return {
      kind: 'digest',
      importanceAfterBoost: boosted,
      reason: `digest range (${this.deps.digestMinImportance} <= ${boosted} < ${this.deps.llmRefinementThreshold})`
    };
  }

  private buildMessages(event: RefineEvent, market: MarketKind): ChatCompletionMessageParam[] {
    const description =
      this.deps.watchlist.description ?? '无（默认偏好：交易所上下币、监管、被盗/破产、宏观、关键人物事件）';
    const watchAssets = this.deps.watchlist.assets.length > 0 ? this.deps.watchlist.assets.join(', ') : '（暂无）';
    const watchCategories =
      this.deps.watchlist.categories.length > 0 ? this.deps.watchlist.categories.join(', ') : '（暂无）';

    const outputSpec = `输出严格 JSON（不要包裹在 markdown 代码块里），字段：
{
  "importance": 0-10 整数,          // 预期交易冲击：越能让相关标的价格剧烈变动越高
  "direction": "bullish"|"bearish"|"neutral",   // 对相关标的的方向影响
  "tickers": ["BTC", "600519"],      // 规范化标的：crypto 用大写符号 / A股 用 6 位代码；无则空数组
  "affected_assets": ["比特币", "贵州茅台"],     // 原文提到的名字（可读）
  "surprise": "unscheduled"|"beat"|"inline"|"miss",  // 意外度：unscheduled=突发/未排期, beat=超预期, inline=符合预期(已被price-in), miss=不及预期
  "horizon": "minutes"|"intraday"|"days",       // 冲击主要在多长时间内兑现
  "confidence": 0.0-1.0,             // 你对以上判断的置信
  "category": "listing"|"delisting"|"maintenance"|"hack"|"regulation"|"partnership"|"funding"|"macro"|"people"|"product"|"noise",
  "actionable": true|false,
  "tldr": "<= 50 字一句话",
  "reason": "<= 100 字，必须点出为什么影响交易"
}

打分标准（importance）：
- 9-10：直接、即时、未被预期的重大冲击（持仓标的被盗/龙头被立案/意外监管制裁/超预期 ETF）
- 7-8：值得立即知晓（重大上下币/重组/超预期业绩/央行意外动作）
- 5-6：值得知道但不紧急（融资/合作/排期内但量级大的事件）
- 3-4：背景信息（行情评论/已被充分预期的常规披露）
- 0-2：噪声（活动预告/教程/抽奖/维护）
关键修正：surprise=inline（已被市场预期/price-in）应显著拉低 importance。`;

    const cryptoSystem = `你是加密货币与全球金融市场的资深交易分析助手。判断一则事件对交易的预期冲击。

用户画像：
- 主动跟踪资产：${watchAssets}
- 关注赛道：${watchCategories}
- 关心方向：${description}
- 重点：交易所上下币、监管/制裁、被盗/破产、宏观（利率·ETF）、关键人物、链上异动、资金费率极值。

${outputSpec}`;

    const ashareSystem = `你是 A股 市场的资深交易分析助手。判断一则公告/新闻对相关个股或板块的预期冲击。

用户画像：
- 主动跟踪：${watchAssets}
- 关注方向：${description}
- 重点事件类型：立案调查/处罚、重大资产重组、控制权变更、业绩预告(预增·预亏·扭亏)、业绩快报、停复牌、减持·增持·回购、限售解禁、中标·重大合同、股权激励、ST·退市、政策定调。
- 注意：判断此事件是【公司个体级】还是【板块/概念级】（板块级冲击面更广，importance 适当上浮），并在 reason 里点明。

${outputSpec}`;

    const system = market === 'ashare' ? ashareSystem : cryptoSystem;

    // Short eval: headline + lead summary only, never the full article body.
    const summary = event.summary ?? (event.content ? event.content.slice(0, 200) : '（无摘要）');
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

    const toUpperStringArray = (value: unknown): string[] =>
      Array.isArray(value)
        ? value
            .filter((entry): entry is string => typeof entry === 'string')
            .map((entry) => entry.trim().toUpperCase())
            .filter(Boolean)
        : [];

    const affectedAssets = Array.isArray(obj.affected_assets)
      ? obj.affected_assets.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean)
      : [];
    const tickers = toUpperStringArray(obj.tickers);

    const directionRaw = typeof obj.direction === 'string' ? (obj.direction.toLowerCase() as Direction) : null;
    const direction: Direction = directionRaw && VALID_DIRECTIONS.has(directionRaw) ? directionRaw : 'neutral';

    const surpriseRaw = typeof obj.surprise === 'string' ? (obj.surprise.toLowerCase() as Surprise) : null;
    const surprise: Surprise = surpriseRaw && VALID_SURPRISE.has(surpriseRaw) ? surpriseRaw : 'unscheduled';

    const horizonRaw = typeof obj.horizon === 'string' ? (obj.horizon.toLowerCase() as Horizon) : null;
    const horizon: Horizon = horizonRaw && VALID_HORIZON.has(horizonRaw) ? horizonRaw : 'days';

    const confidenceRaw = typeof obj.confidence === 'number' ? obj.confidence : NaN;
    const confidence = Number.isFinite(confidenceRaw) ? Math.max(0, Math.min(1, confidenceRaw)) : 0.5;

    const actionable = typeof obj.actionable === 'boolean' ? obj.actionable : false;
    const tldr = typeof obj.tldr === 'string' ? obj.tldr.trim().slice(0, 200) : '';
    const reason = typeof obj.reason === 'string' ? obj.reason.trim().slice(0, 400) : '';

    return {
      importance,
      category,
      affectedAssets,
      actionable,
      tldr,
      reason,
      direction,
      tickers,
      surprise,
      horizon,
      confidence
    };
  }
}
