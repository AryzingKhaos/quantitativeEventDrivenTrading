import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';

import type { RuntimeEnv } from '../config/env.js';

export interface ChatOptions {
  /** Override the configured fast model. */
  model?: string;
  /** Force JSON-object output (DeepSeek `response_format`). */
  json?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResult {
  text: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  cachedPromptTokens: number | null;
}

export class LlmClient {
  private readonly openai: OpenAI;
  private readonly defaultModel: string;

  constructor(private readonly env: RuntimeEnv) {
    if (!env.deepseekApiKey) {
      throw new Error('LlmClient requires DEEPSEEK_API_KEY to be set');
    }
    this.openai = new OpenAI({
      apiKey: env.deepseekApiKey,
      baseURL: env.deepseekBaseUrl
    });
    this.defaultModel = env.deepseekModelFast;
  }

  async chat(messages: ChatCompletionMessageParam[], options: ChatOptions = {}): Promise<ChatResult> {
    const model = options.model ?? this.defaultModel;
    const params: ChatCompletionCreateParamsNonStreaming = {
      model,
      messages,
      stream: false
    };
    if (options.temperature !== undefined) {
      params.temperature = options.temperature;
    }
    if (options.maxTokens !== undefined) {
      params.max_tokens = options.maxTokens;
    }
    if (options.json) {
      params.response_format = { type: 'json_object' };
    }

    const response = await this.openai.chat.completions.create(params);
    const choice = response.choices[0];
    const text = choice?.message?.content?.trim() ?? '';
    const usage = response.usage as
      | (typeof response.usage & {
          prompt_cache_hit_tokens?: number;
        })
      | undefined;

    return {
      text,
      model,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      cachedPromptTokens: usage?.prompt_cache_hit_tokens ?? null
    };
  }
}
