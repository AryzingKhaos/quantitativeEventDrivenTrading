# 02 两级 LLM 冲击抽取（本版本核心）

## 问题

0.0.2 的 `refine.service` 只产 `importance / category / affected_assets / actionable / tldr / reason`，且单模型：

- 没有**方向**（利好/利空）、**量级**、**意外度**——无法判断"对交易的影响"。
- 单模型全量跑：多源接入后（PANews ~100/天 + 链上 + A股 cninfo 披露）token 成本会失控。
- `affected_assets` 是 LLM 随口给的松散名字，不是可交易的规范化标的。

## 目标

把精筛层升级为**两级 LLM**，产出冲击导向的结构化字段，并为交易版预留接口：

- **第一级 triage（便宜模型，全量召回项）**：极简输出，砍掉 noise、给粗评分。
- **第二级 deep（强模型，仅 top 候选）**：完整字段，是质量引擎。
- 新字段中 `direction / tickers / surprise / horizon / confidence / detect_latency / market` 为交易版预留——**本版只抽取、存、展示，不据此交易**。

## 涉及文件

- 改：`src/services/refine.service.ts`（拆成 `triage()` + `deepRefine()` 两级 + 新字段 + 双市场 prompt）
- 改：`src/services/llm.client.ts`（支持 fast / smart 两个模型）
- 改：`src/config/env.ts`（`DEEPSEEK_MODEL_FAST/SMART`、`LLM_TRIAGE_MIN`、`LLM_DAILY_CALL_BUDGET`、`IMPACT_PUSH_THRESHOLD`、`DIGEST_MIN_IMPACT`）
- 改：`src/db/events.repo.ts`（读写新字段）
- 新：`src/db/migrations/xxxx_impact_columns.sql`
- 改：`src/jobs/poll.job.ts`（`recall → triage → (达标) deepRefine → 路由`）
- 新：`src/config/prompts/`（crypto / ashare 两套 system prompt，带版本号）

## 数据库变更

```sql
ALTER TABLE events
  ADD COLUMN market TEXT,              -- 'crypto' | 'ashare'，贯穿规则/prompt/展示
  ADD COLUMN triage_score SMALLINT,    -- 第一级粗评 0-10（也用于成本排序）
  ADD COLUMN direction TEXT,           -- 'bullish' | 'bearish' | 'neutral'（交易版预留）
  ADD COLUMN tickers TEXT[],           -- 规范化标的：crypto 用 BINANCE 符号、A股 用 6 位代码（交易版预留）
  ADD COLUMN surprise TEXT,            -- 'unscheduled' | 'beat' | 'inline' | 'miss'（意外度）
  ADD COLUMN horizon TEXT,             -- 'minutes' | 'intraday' | 'days'（交易版预留）
  ADD COLUMN confidence REAL,          -- 0-1，LLM 自评置信
  ADD COLUMN detect_latency_ms INT;    -- published_at → fetched_at（交易版预留，见 06）

-- importance 复用为"最终预期冲击分 0-10"
COMMENT ON COLUMN events.importance IS 'expected trading impact 0-10 (LLM)';
CREATE INDEX events_impact_idx ON events(importance DESC, fetched_at DESC) WHERE importance IS NOT NULL;
CREATE INDEX events_market_idx ON events(market, fetched_at DESC);
```

## 设计要点

### 两级漏斗

```
召回项(关键词放行) ──▶ ① triage(deepseek-chat)         ──▶ ② deepRefine(强模型)
                        输出 {market,triage_score,is_noise}     仅 triage_score>=LLM_TRIAGE_MIN
                        砍掉 noise，全量但极便宜               输出完整冲击字段
```

- **① triage**：极短 system prompt + 仅标题/摘要，输出 `{ market, triage_score:0-10, is_noise:bool }`。目的是用最低成本把"明显噪声"挡在第二级之外。
- **② deepRefine**：只对 `triage_score >= LLM_TRIAGE_MIN` 的跑，输出完整字段（见下）。
- `LLM_DAILY_CALL_BUDGET` 兜底：超预算当天只走关键词保底推送（沿用 0.0.2 失败兜底逻辑）。

### 第二级输出（严格 JSON）

```json
{
  "impact": 0,                // 0-10 预期交易冲击（最终分，写入 importance）
  "direction": "bullish|bearish|neutral",
  "tickers": ["BTC", "600519"],   // 规范化标的，crypto=符号 / A股=6位代码
  "affected_assets": ["比特币", "贵州茅台"],  // 原文提到的松散名（保留可读性）
  "surprise": "unscheduled|beat|inline|miss",
  "horizon": "minutes|intraday|days",
  "confidence": 0.0,
  "category": "listing|delisting|hack|regulation|funding|macro|people|product|...|noise",
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
- **意外度修正**：`surprise=inline`（符合预期/已 price-in）应显著压低 impact——这是本版相对 0.0.2 最关键的判断升级。

### 双市场 prompt

crypto 与 A股 的事件性质、术语、催化逻辑完全不同，分两套 system prompt（按 `market` 选）：

- crypto：上下币 / 监管 / 被盗破产 / 宏观（利率·ETF）/ 关键人物 / 链上异动 / 资金费极值。
- A股：立案 / 重组 / 业绩预告 / 停复牌 / 减持增持 / 解禁 / 中标 / 板块概念传导 / 政策定调。

system prompt 固定 → DeepSeek 自动命中 context cache，省钱。

### 成本估算

- ① triage：~200 input + ~20 output / 条，全量（假设 500 条/天）→ 月 < $1。
- ② deep：~800 input + ~200 output / 条，假设 80 条/天达标 → 月 < $3（chat）/ 视 reasoner 价格上浮。
- `LLM_TRIAGE_MIN` 是成本与召回的旋钮，先保守（4），观察后调。

### 失败兜底（沿用 0.0.2）

LLM 调用 / JSON 解析失败 → 不阻断，`impact=null`，按关键词保底推送，日志告警但不发 Telegram failure alert。

## 灰度策略

- `LLM_REFINEMENT_ENABLED=true` 后先**影子模式 1 周**：跑 LLM、写字段，但仍按旧逻辑推送，用 `06` 的复核工具对比"LLM 冲击分 vs 我主观觉得该不该推"。
- 校准 `IMPACT_PUSH_THRESHOLD` 后切到 impact 路由。

## 验收标准

- 影子 1 周：`impact >= IMPACT_PUSH_THRESHOLD` 的事件里主观"值得推" ≥ 80%；"该推但 impact<5" 漏判 < 5%。
- `surprise=inline` 的事件 impact 中位数显著低于 `unscheduled`（证明意外度判断生效）。
- 月 LLM 成本在预算内（目标 < $5）。

## 开放问题

- 第二级用 `deepseek-reasoner`（强、贵、慢）还是 `deepseek-chat`（够用、便宜）？建议先 chat，挑一批难例 A/B 再定。
- `tickers` 规范化在 LLM 内做还是 LLM 给名字、本地映射表转代码（A股 尤其需要本地表，见 `04`）？倾向**本地映射**更稳。
- triage 和 deep 可否合并成一次调用按需展开？（先分开，简单可控）
