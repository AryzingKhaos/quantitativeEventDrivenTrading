# 06 推送质量反馈闭环

## 问题

当前推送是单向的——你看到了，觉得不准，下次想改 keyword/threshold 只能去手动改 `rules.ts`。这种循环太慢，而且改完没有客观对比。

更深层的问题：推送质量的评估标准不在代码里，在你脑子里。系统不知道哪条推送是"惊喜"，哪条是"打扰"。

## 目标

在每条推送下面挂 Telegram inline keyboard 的 👍/👎 按钮，反馈写回 DB。周期性让 LLM 看一批 thumbs-down 案例，反向产出 watchlist / prompt / 关键词调整建议。

## 涉及文件

- 改：`src/services/notify.service.ts`（加 inline keyboard）
- 新：`src/jobs/telegram-callback.job.ts`（webhook 或 polling 接收 callback_query）
- 新：`src/services/feedback.service.ts`（处理反馈）
- 新：`src/jobs/feedback-review.job.ts`（周期性 LLM 复盘）
- 新：`src/db/migrations/xxxx_feedback.sql`

## 数据库变更

```sql
CREATE TABLE feedback (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id),
  notification_id BIGINT REFERENCES notifications(id),
  rating SMALLINT NOT NULL,                  -- +1 or -1
  reason_tag TEXT,                           -- 可选：noise / wrong_asset / late / great / 自定义
  comment TEXT,                              -- 后续支持自由文本
  rated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX feedback_event_uniq ON feedback(event_id, rating);  -- 同事件同向一次

ALTER TABLE notifications
  ADD COLUMN telegram_message_id BIGINT;     -- 用于 callback 关联
```

## 设计要点

### Inline Keyboard

`notify.service.ts` 发送时附带：

```ts
{
  reply_markup: {
    inline_keyboard: [
      [
        { text: '👍 有用', callback_data: `fb:up:${eventId}` },
        { text: '👎 噪声', callback_data: `fb:down:${eventId}:noise` },
        { text: '👎 错资产', callback_data: `fb:down:${eventId}:wrong_asset` },
        { text: '👎 太晚', callback_data: `fb:down:${eventId}:late` }
      ]
    ]
  }
}
```

callback_data 严格 < 64 bytes（Telegram 限制）。

### Callback 接收

两种模式：

**Polling（默认，简单）**：
- `getUpdates` 长轮询
- 进程内一个循环 worker
- 不需要公网 IP / 反向代理

**Webhook（生产推荐）**：
- Telegram 直推到 `https://yourdomain.com/tg/webhook`
- 需要公网 + HTTPS
- 延迟更低

第一版用 polling 就够。

### Feedback 处理

```ts
async function handleCallback(query: CallbackQuery) {
  const [, sign, eventId, reason] = query.data.split(':');
  const rating = sign === 'up' ? 1 : -1;
  await feedbackRepo.upsert({ eventId: Number(eventId), rating, reasonTag: reason });
  await answerCallback(query.id, '已记录');
  // 可选：编辑原消息，把按钮变灰，加上"已评价 👍"
}
```

### 周期性复盘

`feedback-review.job.ts`，每周日跑一次：

```ts
async function review() {
  // 取过去 7 天的 thumbs down 事件，按 reason_tag 分组
  const negSamples = await feedbackRepo.recentNegative({ days: 7, limit: 50 });
  const posSamples = await feedbackRepo.recentPositive({ days: 7, limit: 30 });

  const prompt = `
你是这套推送系统的产品经理。下面是用户过去 7 天的反馈。
被赞的事件（保留特征）：${posSamples}
被踩的事件 + 原因：${negSamples}

输出建议（JSON）：
{
  "keyword_changes": { "add": [...], "remove": [...] },
  "watchlist_changes": { "add": [...], "remove": [...] },
  "prompt_tweaks": "...",
  "category_threshold_changes": { "listing": +1, ... },
  "summary": "本周关键问题"
}
  `;

  const result = await llm.complete(prompt, { model: 'deepseek-reasoner' });
  await reviewsRepo.insert({ weekOf, suggestions: result, applied: false });
  await notify.send(`【本周推送复盘】\n${result.summary}\n详情见 review #${id}`);
}
```

**关键设计：建议默认不自动应用**——你看完手动决定是否落地（`apply.ts` 脚本读 review 把建议落到 `rules.ts` / `watchlist.json`）。AI 复盘做"参谋"，不做"决策者"。

## Critical 设计：避免反馈污染推送

- 反馈是事后的，不影响当条事件已发生的推送
- 反馈数据用于"未来事件的评分"，影响路径是：feedback → 周期 review → 配置变更 → 新事件

## 灰度策略

- `FEEDBACK_ENABLED=false` 默认关
- 打开后先观察 2 周积累数据
- 第 3 周开始 review job

## 验收标准

- 至少 30% 的推送被打分（说明按钮有效）
- 8 周后回看：踩的事件类型有显著变化（说明系统在学）
- review 的建议至少 50% 被你认可（采纳率 < 50% 说明 prompt 还要调）

## 开放问题

- 是否同时支持自由文本反馈？（用户长按消息回复，也写入 feedback.comment）
- 反馈历史是否要影响重复事件的评分？比如某用户连续踩 3 次"funding 类"，下次 funding 类是否自动降权
- 单用户场景下 reason_tag 够不够细？要不要加"too_speculative" / "too_late" 等
