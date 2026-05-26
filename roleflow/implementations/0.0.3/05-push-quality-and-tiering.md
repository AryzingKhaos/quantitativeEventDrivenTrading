# 05 推送质量与分级

## 问题

- 当前推送格式信息密度不足以让用户**判断消息质量**（这版的核心目标）。
- 多源接入后推送量会爆，需要分级控噪。
- 同一事件多源都报（如 cninfo + PANews、链上 + 交易所），会重复打扰。

## 目标

让每条推送"一眼能判断要不要在意"，并分级 + 首发去重，**质量可被用户主观评估**。

## 涉及文件

- 改：`src/services/notify.service.ts`（消息模板，crypto / A股 两套）
- 改：`src/services/digest.service.ts`（按 impact 收口）
- 改：`src/services/cluster.service.ts`（跨源同事件 → 推首发、后续标"已确认"）
- 改：`src/jobs/poll.job.ts`（路由：critical / digest / silent，门用 `02` 的 `impact`）

## 设计要点

不分频道：crypto 与 A股 共用一个 Telegram 频道，但每条消息**头部标明话题**（`加密` / `A股`），避免混淆。

### 消息模板（展示 02 的字段）

**crypto：**
```
【加密 · {direction_emoji}{impact}/10 · {category}】{tldr}
标的：{tickers}    意外度：{surprise}    视野：{horizon}
为什么：{reason}
来源：{sourceKey} · {publishedAt 北京时间}（延迟 {detect_latency}）
{url}
```

**A股：**
```
【A股 · {direction_emoji}{impact}/10 · {category}】{tldr}
标的：{name}（{code}） {板块级? · 概念:xxx}
意外度：{surprise}    为什么：{reason}
来源：巨潮 · {publishedAt}（盘中/盘后）
{url}
```

`direction_emoji`：bullish 🟢 / bearish 🔴 / neutral ⚪。话题、方向、意外度、标的全部上墙——这正是用户要"看质量"的抓手。`tickers` 为本地映射表规范化后的标的。

### 路由

```ts
if (impact == null) -> 关键词保底推送（02 失败兜底）
else if (impact >= IMPACT_PUSH_THRESHOLD) -> critical（即时单条）
else if (impact >= DIGEST_MIN_IMPACT)     -> digest（每日简报）
else                                      -> silent
```

### 跨源首发去重

沿用现有 `cluster.service`：同一事件多源报道归一簇。

- 推**首发**（`detect_latency` 最小 / `published_at` 最早）的那条，记下其 Telegram `message_id`。
- 同簇后续源到达：不单独推；若带来增量（更高 impact / 更权威源），用 Telegram `editMessage` **编辑原消息**（追加"✅ 已被 {source} 确认 / impact 上调"），而不是再发一条。
- 这同时让"谁更快"可量化，为交易版的延迟优势评估铺垫。

## 灰度策略

- 模板改动与路由开关独立；`IMPACT_PUSH_THRESHOLD` / `DIGEST_MIN_IMPACT` 可热调。
- 先放宽阈值多推一周（看质量），再逐步收紧到舒适信噪比。

## 验收标准

- 单条消息无需点开链接即可判断"要不要在意"（主观）。
- 日 critical 推送量收敛到用户可接受区间；digest 每日 1 条聚合。
- 同事件不再多源重复推。

## 开放问题

→ 已集中到 [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md)（本步相关：OQ-E3 digest 归档、OQ-E4 已确认追加/编辑、OQ-E5 是否分频道；另 OQ-E2 watchlist 是否拆两套）。
