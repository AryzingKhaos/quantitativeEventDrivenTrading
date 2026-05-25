import type { LlmClient } from './llm.client.js';
import type { Logger } from '../utils/logger.js';
import type { SourceKey } from '../types/source.js';

const ENGLISH_SOURCES: ReadonlySet<SourceKey> = new Set<SourceKey>([
  'openai_blog',
  'nvidia_blog',
  'google_ai_blog',
  'deepmind_blog',
  'microsoft_ai_blog',
  'aws_ml_blog',
  'huggingface_blog',
  'arxiv_cs_ai',
  'arxiv_cs_cl',
  'arxiv_cs_lg',
  'whitehouse',
  'gary_marcus',
  'ai_snake_oil',
  'pluralistic',
  'media_404',
  'tech_policy_press',
  'sec_edgar',
  'coindesk',
  'theblock',
  'coinbase'
]);

export interface TranslationInput {
  title: string;
  summary: string | null;
}

export interface TranslationOutput {
  title: string;
  summary: string | null;
}

interface TranslationDeps {
  llm: LlmClient;
  model: string;
  logger: Logger;
  maxSummaryChars?: number;
}

const SYSTEM_PROMPT =
  'You are a precise translator for AI-industry news. Translate English fields to Simplified Chinese. ' +
  'Preserve company / product / person names in English (e.g. OpenAI, NVIDIA, Jensen Huang). ' +
  'Keep technical jargon idiomatic. Output ONLY a JSON object with the same keys; no commentary.';

export class TranslationService {
  private readonly cache = new Map<string, TranslationOutput>();
  private readonly maxSummaryChars: number;

  constructor(private readonly deps: TranslationDeps) {
    this.maxSummaryChars = deps.maxSummaryChars ?? 400;
  }

  static isEnglishSource(sourceKey: SourceKey): boolean {
    return ENGLISH_SOURCES.has(sourceKey);
  }

  async translate(input: TranslationInput, cacheKey: string): Promise<TranslationOutput> {
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const truncatedSummary =
      input.summary !== null && input.summary.length > this.maxSummaryChars
        ? input.summary.slice(0, this.maxSummaryChars)
        : input.summary;

    const payload = { title: input.title, summary: truncatedSummary };
    const userPrompt =
      '将下列 JSON 中的英文字段翻译为简体中文，保持 JSON 结构与 key 不变。' +
      '专有名词（公司、产品、人名）原样保留英文。null 字段保持 null。\n\n' +
      JSON.stringify(payload);

    try {
      const result = await this.deps.llm.chat(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        { model: this.deps.model, json: true, temperature: 0.2 }
      );

      const parsed = JSON.parse(result.text) as Partial<TranslationOutput>;
      const output: TranslationOutput = {
        title:
          typeof parsed.title === 'string' && parsed.title.trim().length > 0
            ? parsed.title.trim()
            : input.title,
        summary:
          input.summary === null
            ? null
            : typeof parsed.summary === 'string' && parsed.summary.trim().length > 0
              ? parsed.summary.trim()
              : input.summary
      };
      this.cache.set(cacheKey, output);
      return output;
    } catch (error) {
      this.deps.logger.warn('Translation failed, falling back to original', {
        cacheKey,
        error: error instanceof Error ? error.message : String(error)
      });
      return { title: input.title, summary: input.summary };
    }
  }
}
