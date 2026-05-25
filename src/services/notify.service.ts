import type { RuntimeEnv } from '../config/env.js';
import type { PersistedEvent } from '../types/event.js';
import { formatBeijingTime } from '../utils/time.js';
import { shortenText } from '../utils/text.js';
import { TranslationService } from './translation.service.js';

interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

interface SendMessageResult {
  messageId: number | null;
}

export class NotifyService {
  constructor(
    private readonly env: RuntimeEnv,
    private readonly options: { feedbackEnabled: boolean } = { feedbackEnabled: false },
    private readonly translationService: TranslationService | null = null
  ) {}

  async sendEvent(event: PersistedEvent): Promise<SendMessageResult> {
    const shouldTranslate =
      this.translationService !== null && TranslationService.isEnglishSource(event.sourceKey);

    let displayTitle = event.title;
    let displaySummary = event.summary;
    let translated = false;

    if (shouldTranslate) {
      const out = await this.translationService!.translate(
        { title: event.title, summary: event.summary },
        event.fingerprint
      );
      // translate() never throws; failure path returns originals unchanged.
      translated = out.title !== event.title || out.summary !== event.summary;
      displayTitle = out.title;
      displaySummary = out.summary;
    }

    const lines: string[] = [];
    if (event.importance !== null && event.tldr) {
      const category = event.category ?? '?';
      const prefix = translated ? '已翻译 · ' : '';
      lines.push(`【${prefix}${event.importance}/10 · ${category}】${event.tldr}`);
      lines.push(`来源：${event.sourceKey}`);
      if (event.affectedAssets && event.affectedAssets.length > 0) {
        lines.push(`影响资产：${event.affectedAssets.join(', ')}`);
      }
      if (event.reason) {
        lines.push(`原因：${event.reason}`);
      }
      if (translated) {
        lines.push(`标题：${displayTitle}`);
        lines.push(`原标题（EN）：${event.title}`);
      } else {
        lines.push(`原标题：${event.title}`);
      }
      lines.push(`时间：${formatBeijingTime(event.publishedAt ?? event.fetchedAt)}`);
      lines.push(`链接：${event.url}`);
    } else {
      lines.push(translated ? '【新事件 · 已翻译】' : '【新事件】');
      lines.push(`来源：${event.sourceKey}`);
      lines.push(`标题：${displayTitle}`);
      if (translated) {
        lines.push(`原标题（EN）：${event.title}`);
      }
      lines.push(`摘要：${shortenText(displaySummary ?? event.content ?? '无摘要', 180)}`);
      lines.push(`时间：${formatBeijingTime(event.publishedAt ?? event.fetchedAt)}`);
      lines.push(`链接：${event.url}`);
    }

    const replyMarkup = this.options.feedbackEnabled ? this.buildFeedbackKeyboard(event.id) : undefined;
    return this.sendTelegramMessage(lines.join('\n'), replyMarkup);
  }

  async sendBroadcast(text: string): Promise<SendMessageResult> {
    return this.sendTelegramMessage(text);
  }

  async sendSourceFailureAlert(params: {
    sourceName: string;
    attemptCount: number;
    errorSummary: string;
    requestedAt: Date;
  }): Promise<SendMessageResult> {
    const message = [
      '【抓取失败告警】',
      `数据源：${params.sourceName}`,
      `请求时间：${formatBeijingTime(params.requestedAt)}`,
      `重试次数：${params.attemptCount}`,
      `错误摘要：${shortenText(params.errorSummary, 300)}`
    ].join('\n');

    return this.sendTelegramMessage(message);
  }

  private buildFeedbackKeyboard(eventId: number): { inline_keyboard: InlineKeyboardButton[][] } {
    return {
      inline_keyboard: [
        [
          { text: '👍 有用', callback_data: `fb:up:${eventId}` },
          { text: '👎 噪声', callback_data: `fb:dn:${eventId}:noise` },
          { text: '👎 错资产', callback_data: `fb:dn:${eventId}:wrong_asset` },
          { text: '👎 太晚', callback_data: `fb:dn:${eventId}:late` }
        ]
      ]
    };
  }

  private async sendTelegramMessage(
    text: string,
    replyMarkup?: { inline_keyboard: InlineKeyboardButton[][] }
  ): Promise<SendMessageResult> {
    const body: Record<string, unknown> = {
      chat_id: this.env.telegramChatId,
      text,
      disable_web_page_preview: true
    };
    if (replyMarkup) {
      body.reply_markup = replyMarkup;
    }
    const response = await fetch(`https://api.telegram.org/bot${this.env.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Telegram send failed: ${response.status} ${text}`);
    }

    const payload = (await response.json()) as { ok: boolean; result?: { message_id: number } };
    return { messageId: payload.result?.message_id ?? null };
  }
}
