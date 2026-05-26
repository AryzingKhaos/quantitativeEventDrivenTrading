# 02 LLM 冲击抽取（单次调用）

## 问题

0.0.2 的 `refine.service` 只产 `importance / category / affected_assets / actionable / tldr / reason`：

- 没有**方向**（利好/利空）、**量级**、**意外度**——无法判断"对交易的影响"。
- `affected_assets` 是 LLM 随口给的松散名字，不是可交易的规范化标的。

## 目标

把精筛层升级为**冲击导向的结构化抽取**，并为交易版预留接口：

- 关键词召回通过的事件 → **单次 LLM 调用**（只喂标题 + 摘要，做"短评"，不喂全文正文）→ 输出完整冲击字段。
- 字段中 `direction / tickers / surprise / horizon / confidence / detect_latency / market` 为交易版预留——**本版只抽取、存、展示，不据此交易**。

## 涉及文件

- 改：`src/services/refine.service.ts`（单次 `refine(event, market)` + 完整字段 + 双市场 prompt）
- 改：`src/services/llm.client.ts`（模型可配）
- 改：`src/config/env.ts`
- 改：`src/db/events.repo.ts`（读写新字段）
- 新：`src/db/migrations/xxxx_impact_columns.sql`
- 改：`src/jobs/poll.job.ts`（`recall →（命中）refine → 路由`）
- 新：`src/config/prompts/`（crypto / ashare 两套 system prompt，带版本号）

## 数据库变更

```sql
ALTER TABLE events
  ADD COLUMN market TEXT,              -- 'crypto' | 'ashare'，贯穿规则/prompt/展示
  ADD COLUMN direction TEXT,           -- 'bullish' | 'bearish' | 'neutral'（交易版预留）
  ADD COLUMN tickers TEXT[],           -- 规范化标的（交易版预留，见下"本地映射"）
  ADD COLUMN surprise TEXT,            -- 'unscheduled' | 'beat' | 'inline' | 'miss'（意外度）
  ADD COLUMN horizon TEXT,             -- 'minutes' | 'intraday' | 'days'（交易版预留）
  ADD COLUMN confidence REAL,          -- 0-1 LLM 自评
  ADD COLUMN detect_latency_ms INTEGER,-- published_at -> fetched_at（交易版预留，见 06）
  ADD COLUMN triage_score SMALLINT;    -- 保留列，本版单次调用未使用

-- importance 复用为"最终预期冲击分 0-10"
CREATE INDEX events_market_idx ON events(market, fetched_at DESC);
```

## 设计要点

### 单次调用（短评）

```
召回项(关键词放行) ──▶ refine(event, market)  [deepseek-chat]
                        输入：标题 + 摘要（不含全文正文）
                        输出：完整冲击字段（见下）
```

LLM 模型用 `deepseek-chat`（fast）。成本由两点压住：召回层先过滤、且只喂标题 + 摘要（短文本）。

### 输出（严格 JSON）

```json
{
  "impact": 0,                // 0-10 预期交易冲击（最终分，写入 importance）
  "direction": "bullish|bearish|neutral",
  "tickers": ["BTC", "600519"],   // 规范化标的（见"本地映射"）
  "affected_assets": ["比特币", "贵州茅台"],  // 原文松散名（可读）
  "surprise": "unscheduled|beat|inline|miss",
  "horizon": "minutes|intraday|days",
  "confidence": 0.0,
  "category": "listing|delisting|hack|regulation|funding|macro|people|product|...|noise",
  "actionable": true|false,
  "tldr": "<= 50 字",
  "reason": "<= 100 字，必须点出为什么影响交易"
}
```

打分锚点（写进 prompt）：

- **9-10**：直接、即时、未被 price-in 的重大冲击（持仓币被盗 / 龙头立案 / 意外监管制裁 / 超预期 ETF）。
- **7-8**：值得立即知晓（重大上下币 / 重组 / 超预期业绩 / 央行意外动作）。
- **5-6**：值得知道不紧急（融资 / 合作 / 排期内但量级大的事件）。
- **3-4**：背景（行情评论 / 已充分预期的常规披露）。
- **0-2**：噪声。
- **意外度修正**：`surprise=inline`（已 price-in）显著拉低 impact。

### 双市场 prompt

按 `market` 选 crypto / ashare 两套 system prompt（事件性质、术语、催化逻辑不同）。system prompt 固定 → DeepSeek 自动命中 context cache，省钱。

### tickers 本地映射

LLM 给出标的名/符号后，由**本地映射表**规范化成可交易标的（crypto 符号 / A股 6 位代码），写入 `tickers`；`affected_assets` 保留原文松散名供阅读。A股 的映射表见 step 04；crypto 先用最小符号规整。

### 意外度

`surprise` 本版由 LLM 直接判断（无系统化日历）。

### 失败兜底（沿用 0.0.2）

LLM 调用 / JSON 解析失败 → 不阻断，`impact=null`，按关键词保底推送，日志告警但不发 Telegram failure alert。

## 灰度策略

- `LLM_REFINEMENT_ENABLED=true` 后先**影子模式 1 周**：跑 LLM、写字段，但仍按旧逻辑推送，对比"LLM 冲击分 vs 主观该不该推"。
- 校准 `LLM_REFINEMENT_THRESHOLD`（critical 阈值）后切到 impact 路由。

## 验收标准

- 影子 1 周：`impact >= 阈值` 的事件里主观"值得推" ≥ 80%；"该推但 impact<5" 漏判 < 5%。
- `surprise=inline` 的事件 impact 中位数显著低于 `unscheduled`（证明意外度判断生效）。
- 月 LLM 成本在预算内（目标 < $5）。

## 开放问题

→ 已集中到 [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md)（本步相关：OQ-A1 模型、OQ-A5 单次调用/短评、OQ-E1 tickers 本地映射）。
