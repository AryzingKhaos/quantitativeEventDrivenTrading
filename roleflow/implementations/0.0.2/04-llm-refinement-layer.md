# 04 LLM 精筛层

## 问题

`src/services/filter.service.ts` 当前是纯关键词加权：

- 表达不了语义（"上线 BTC ETF" 和 "上线交易赛活动" 同 4 分）
- excludeKeywords 已经膨胀到 50+ 个，且永远补不完
- score 不反映"实际重要性"——只反映"撞了多少关键词"
- 与用户实际关心的资产/赛道无关
- 内容长度和位置无关——标题命中和正文 100 行后命中等价

## 目标

在关键词层后插入"LLM 结构化精筛"：

- 关键词层降阈值（召回优先）
- 通过的事件交给 DeepSeek（`deepseek-chat` / V3）输出结构化 JSON
- 按 `importance` 阈值决定推不推
- 按 `category` 决定路由（critical / digest / silent）
- 按 `affected_assets` ∩ watchlist 加权

## 涉及文件

- 改：`src/config/rules.ts`（threshold 全部下调）
- 改：`src/services/filter.service.ts`（拆出关键词阶段，命名为 `coarseFilter`）
- 新：`src/services/refine.service.ts`（LLM 精筛）
- 新：`src/services/llm.client.ts`（封装 OpenAI SDK 指向 DeepSeek baseURL `https://api.deepseek.com`，读取 `DEEPSEEK_API_KEY`）
- 新：`src/config/watchlist.ts`（读取 `WATCHLIST_PATH`）
- 新：`src/db/migrations/xxxx_refinement_columns.sql`（events 表加几个字段）
- 改：`src/jobs/poll.job.ts`（在 filter 通过后插入 refine 调用）

## 数据库变更

`events` 表新增字段：

```sql
ALTER TABLE events
  ADD COLUMN importance SMALLINT,           -- 0-10 LLM 给的重要性
  ADD COLUMN category TEXT,                 -- listing / delisting / hack / regulation / ...
  ADD COLUMN affected_assets TEXT[],        -- ["BTC", "TRX"]
  ADD COLUMN actionable BOOLEAN,
  ADD COLUMN tldr TEXT,                     -- LLM 一句话摘要
  ADD COLUMN reason TEXT,                   -- LLM 解释为什么重要
  ADD COLUMN refined_at TIMESTAMPTZ,
  ADD COLUMN refine_model TEXT,             -- 哪个模型打的分（便于 A/B）
  ADD COLUMN refine_prompt_version TEXT;    -- prompt 版本（便于回放）

CREATE INDEX events_importance_idx ON events(importance DESC, fetched_at DESC) WHERE importance IS NOT NULL;
CREATE INDEX events_category_idx ON events(category, fetched_at DESC);
```

## 设计要点

### LLM 精筛 prompt 结构

System prompt（构造一次，DeepSeek 在 prefix 重复时自动命中 context cache，无需手动 `cache_control`）：

```
你是一个加密货币与全球金融新闻的资深编辑助手。判断一则事件对用户的重要性。

用户画像：
- 主动跟踪：{watchlist 内容，如 "BTC, ETH, SOL, TRX, AI agents 赛道, RWA"}
- 持仓：{选填}
- 关心方向：交易所上下币、监管、被盗/破产、宏观（利率/ETF）、关键人物（孙宇晨、马斯克）

输出严格 JSON：
{
  "importance": 0-10,
  "category": "listing"|"delisting"|"maintenance"|"hack"|"regulation"|"partnership"|"funding"|"macro"|"people"|"product"|"noise",
  "affected_assets": ["BTC", ...],
  "actionable": true|false,
  "tldr": "<= 50 字一句话",
  "reason": "<= 100 字"
}

打分标准：
- 9-10：直接影响用户持仓/watchlist 的关键事件（持仓上下币、被盗、监管制裁）
- 7-8：值得立即知晓的市场事件（重大上下币、ETF 通过、SEC 行动）
- 5-6：值得知道但不紧急（融资、合作、产品发布）
- 3-4：背景信息（行情评论、研报）
- 0-2：噪声（活动预告、教程、抽奖）
```

User prompt（每条事件单独构造）：

```
来源：{sourceKey}
标题：{title}
摘要：{summary || content[:500]}
发布时间：{publishedAt}
```

### 模型与缓存

- 默认 `deepseek-chat`（DeepSeek-V3），输入 token 价格低，原生 JSON 输出（`response_format: { type: 'json_object' }`）
- DeepSeek 自动 context caching：system prompt 不变 → 命中后输入价 ~25% off，无需调用方传 `cache_control`
- 单次调用 ~500-1500 input tokens + ~150 output tokens
- 估算成本：每天 100-500 条经过精筛 → 月成本 < $2（V3 cache hit 输入 $0.07/M，输出 $1.10/M）
- SDK 用 `openai` npm 包，`new OpenAI({ apiKey: process.env.DEEPSEEK_API_KEY, baseURL: 'https://api.deepseek.com' })`

### 路由策略

```ts
function routeRefined(event: RefinedEvent, env: RuntimeEnv): Routing {
  if (event.category === 'noise' || event.importance < env.digestMinImportance) {
    return { kind: 'silent' };
  }
  if (event.importance >= env.llmRefinementThreshold) {
    return { kind: 'critical' }; // 实时推
  }
  return { kind: 'digest' }; // 留给每日简报
}
```

`watchlist` 加权：如果 `affected_assets ∩ watchlist != ∅`，importance += 2（封顶 10）。这一步在 LLM 之外做，不消耗 token。

### Critical 推送格式（升级版）

```
【{importance}/10 · {category}】{tldr}
来源：{sourceKey}
影响资产：{affected_assets.join(', ')}
原因：{reason}
原标题：{title}
时间：{publishedAt 北京时间}
链接：{url}
```

比 v0.0.1 的格式信息密度高得多——一眼能判断是否要点开。

### 失败兜底

LLM 调用失败/JSON 解析失败时：

- 不阻断流程
- 该事件 `importance = null`，按 v0.0.1 规则推送（保底）
- 日志告警，但不写 Telegram failure alert（避免 LLM 抖动疯狂报警）

## 灰度策略

- `LLM_REFINEMENT_ENABLED=false` 默认关
- 打开后第一周影子模式：调用 LLM 但仍按 v0.0.1 规则推送，只把 LLM 结果写到 DB，对比看分数
- 第二周切到 LLM 路由

## 验收标准

- 影子模式 1 周后：
  - LLM importance >= 7 的事件中，主观觉得"值得推"的比例 >= 80%
  - 主观"应该被推但 LLM 判定 importance < 5"的事件 < 5%
- 切换后日均推送数下降 60%+
- 月 LLM 成本 < $5

## 开放问题

- watchlist 静态 JSON 还是动态从交易所 API 拉持仓？
- prompt 版本管理：放代码里 `prompt-version-1.txt` 还是 DB 表？
- 不同 source 是否共用 system prompt？（PANews 和 binance 的事件性质不同，可能要分两套）
- 要不要让 LLM 同时输出"建议的搜索关键词"用来反推 watchlist？
