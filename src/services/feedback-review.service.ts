import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import type { LlmClient } from './llm.client.js';
import type { FeedbackRepository, FeedbackReviewsRepository, FeedbackSampleRow } from '../db/feedback.repo.js';
import type { Logger } from '../utils/logger.js';

interface ReviewDeps {
  llm: LlmClient;
  feedbackRepo: FeedbackRepository;
  reviewsRepo: FeedbackReviewsRepository;
  smartModel: string;
  fastModel: string;
  logger: Logger;
}

export interface ReviewOutcome {
  summary: string;
  suggestions: unknown;
  model: string;
  reviewId: number;
}

function summarizeSamples(samples: FeedbackSampleRow[]): string {
  if (samples.length === 0) {
    return '（无数据）';
  }
  return samples
    .map(
      (sample) =>
        `- [${sample.sourceKey}] importance=${sample.importance ?? '?'} category=${sample.category ?? '?'} assets=${(
          sample.affectedAssets ?? []
        ).join('|') || '?'} reason=${sample.reasonTag ?? '?'} :: ${sample.tldr ?? sample.title}`
    )
    .join('\n');
}

export class FeedbackReviewService {
  constructor(private readonly deps: ReviewDeps) {}

  async run(weekOf: Date): Promise<ReviewOutcome | null> {
    const [neg, pos] = await Promise.all([
      this.deps.feedbackRepo.recentNegative({ days: 7, limit: 50 }),
      this.deps.feedbackRepo.recentPositive({ days: 7, limit: 30 })
    ]);

    if (neg.length === 0 && pos.length === 0) {
      this.deps.logger.info('Feedback review skipped: no feedback in window');
      return null;
    }

    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `你是这套加密货币推送系统的产品经理。你的任务是根据用户最近 7 天的反馈，给出可操作的改进建议。

输出严格 JSON：
{
  "keyword_changes": { "add": ["..."], "remove": ["..."] },
  "watchlist_changes": { "add": ["..."], "remove": ["..."] },
  "prompt_tweaks": "改 LLM 精筛 prompt 的一段建议",
  "category_threshold_changes": { "listing": 0, "macro": 0 },
  "summary": "本周关键问题（<=120 字）"
}

约束：
- 仅基于反馈样本作判断；不要假设没出现的事件
- keyword_changes 里的词应该可直接放入关键词规则
- watchlist 用资产 ticker 大写
- summary 用中性、信息量优先`
      },
      {
        role: 'user',
        content: `被赞的事件（${pos.length} 条）：\n${summarizeSamples(pos)}\n\n被踩的事件（${neg.length} 条）：\n${summarizeSamples(neg)}`
      }
    ];

    let raw: string;
    let model: string;
    try {
      const result = await this.deps.llm.chat(messages, {
        model: this.deps.smartModel,
        temperature: 0.3,
        maxTokens: 1000
      });
      raw = result.text;
      model = result.model;
    } catch (error) {
      this.deps.logger.warn('Feedback review smart model failed, falling back', { error });
      const result = await this.deps.llm.chat(messages, {
        model: this.deps.fastModel,
        json: true,
        temperature: 0.3,
        maxTokens: 1000
      });
      raw = result.text;
      model = result.model;
    }

    let suggestions: unknown;
    try {
      suggestions = JSON.parse(raw);
    } catch {
      const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
      if (fenced) {
        try {
          suggestions = JSON.parse(fenced[1]);
        } catch {
          suggestions = { raw };
        }
      } else {
        suggestions = { raw };
      }
    }

    const summary =
      suggestions && typeof suggestions === 'object' && 'summary' in (suggestions as Record<string, unknown>)
        ? String((suggestions as Record<string, unknown>).summary ?? '')
        : '';

    const inserted = await this.deps.reviewsRepo.insert({
      weekOf,
      suggestions,
      summary: summary || null,
      model
    });

    return { summary, suggestions, model, reviewId: inserted.id };
  }
}
