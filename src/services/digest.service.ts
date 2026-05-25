import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import type { LlmClient } from './llm.client.js';
import type { Logger } from '../utils/logger.js';
import type { EventsRepository } from '../db/events.repo.js';
import type { PersistedEvent } from '../types/event.js';
import type { Watchlist } from '../config/watchlist.js';

interface DigestDeps {
  llm: LlmClient;
  eventsRepo: EventsRepository;
  watchlist: Watchlist;
  logger: Logger;
  smartModel: string;
  fastModelFallback: string;
  digestMinImportance: number;
}

export interface DigestResult {
  text: string;
  eventIds: number[];
  model: string;
}

export class DigestService {
  constructor(private readonly deps: DigestDeps) {}

  async build(windowHours = 24): Promise<DigestResult | null> {
    const candidates = await this.deps.eventsRepo.listForDigest({
      sinceHours: windowHours,
      minImportance: this.deps.digestMinImportance
    });
    if (candidates.length === 0) {
      this.deps.logger.info('Digest skipped: no candidates');
      return null;
    }

    const slim = candidates.map((event) => ({
      id: event.id,
      source: event.sourceKey,
      category: event.category,
      affected_assets: event.affectedAssets ?? [],
      importance: event.importance,
      tldr: event.tldr ?? event.title,
      url: event.url
    }));

    const watchAssets = this.deps.watchlist.assets.length > 0 ? this.deps.watchlist.assets.join(', ') : '（暂无）';

    const messages: ChatCompletionMessageParam[] = [
      {
        role: 'system',
        content: `你是面向加密货币投资者的简报编辑。基于过去 24 小时的事件列表，写一份简洁可扫读的早报。

要求：
- 总长度 <= 600 字
- 按主题分组：[监管] [上下币] [安全] [宏观] [产品/合作] [其他]，没有的组省略
- 每条 1-2 句话，给出 tldr 并在末尾注明来源 (source) 和原文链接
- 突出对 watchlist 影响：${watchAssets}
- 末尾另起 "[今日重点]" 段，1-2 句话点出最值得关注的事
- 输出纯文本，不要 markdown 代码块；URL 直接写出来；不要使用 emoji`
      },
      {
        role: 'user',
        content: `事件列表（JSON）：\n${JSON.stringify(slim, null, 2)}`
      }
    ];

    let text: string;
    let model: string;
    try {
      const result = await this.deps.llm.chat(messages, {
        model: this.deps.smartModel,
        temperature: 0.4,
        maxTokens: 1200
      });
      text = result.text;
      model = result.model;
    } catch (error) {
      this.deps.logger.warn('Digest smart model failed, falling back to fast model', { error });
      const result = await this.deps.llm.chat(messages, {
        model: this.deps.fastModelFallback,
        temperature: 0.4,
        maxTokens: 1200
      });
      text = result.text;
      model = result.model;
    }

    return {
      text: text.trim(),
      eventIds: candidates.map((event) => event.id),
      model
    };
  }
}
