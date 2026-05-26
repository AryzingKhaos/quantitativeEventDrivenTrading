# 03 crypto 信源深化（领先指标）

## 问题

现有 crypto 源（交易所公告 + PANews）都是**滞后**的"新闻"——价格往往已经动完才出稿。真正能驱动事件交易的是**领先指标**：链上异动、衍生品极值、预定事件（解锁），现在完全没有。

## 目标

接入领先指标类源，统一"事件化"后喂进 `01/02` 的同一条 recall → LLM 管线。**用户已定 crypto 优先**，这是本版深度里程碑。

**只用免费源 / 免费档，不接任何付费源（含 X/Twitter API）。**

## 涉及文件

- 新：`src/collectors/onchain.ts`（链上：大额转账 / 稳定币增发，TRON + ETH）
- 新：`src/collectors/derivatives.ts`（Hyperliquid 等：资金费 / OI / 爆仓，阈值触发型）
- 新：`src/collectors/polymarket.ts`（预测市场赔率异动）
- 新：`src/collectors/calendar.ts`（解锁 / CoinMarketCal 免费档，预定事件型）
- 改：`src/config/sources.ts`（注册新源，标 `market: 'crypto'`、按批 enable）
- 改：`src/collectors/types.ts`（新增"阈值触发"与"日历"两类 collector 形态——不再只是抓列表页）

## 源清单（按批推进，均免费）

### 批 1 — 链上 + 衍生品（领先性强，先做）

| 源 | 拿什么 | 覆盖 |
| --- | --- | --- |
| Etherscan / Tronscan | 大额转账（鲸鱼进出交易所）、稳定币增发/销毁 | **TRON + ETH** |
| Hyperliquid | 资金费率、OI、爆仓、大额持仓异动 | 永续/链上衍生品 |
| Polymarket | 预测市场赔率异动（= 事件发生概率的领先信号） | 事件概率 |

### 批 2 — 预定事件（日历型）

| 源 | 拿什么 | 接入 |
| --- | --- | --- |
| Token Unlocks / DeFiLlama unlocks | 代币解锁日程（潜在抛压） | 免费 API |
| CoinMarketCal | 主网上线 / 升级 / 上所 等预定事件 | 免费档 |

### 批 3 — 一手信源（免费的才做）

| 源 | 拿什么 | 接入 |
| --- | --- | --- |
| 项目 TG / Discord、Snapshot 治理提案 | 提案 / 重大公告 | TG、Snapshot API（免费） |

> X/Twitter 等付费源**不接**。关键人物表态先靠 PANews 转述覆盖。

## 设计要点

### 三种 collector 形态

现有 collector 是"抓列表页 → 列条目"。新源有两种新形态，需在 `collectors/types.ts` 抽象：

- **阈值触发型**（衍生品 / 链上）：拉指标 → 越过**绝对值阈值**（如资金费 > X%、单笔转账 > $Y、OI 变动 > $Z）才生成一个"事件"。阈值与冷却写进 source config，避免刷屏。（用分位数更稳但要存历史，本版用绝对值。）
- **日历型**（解锁 / CMC）：预定事件落库后，在"提前 N 天"和"当天"各生成一次提醒事件；同一预定事件去重（fingerprint = 事件 id + 提醒类型）。

### 链上事件的"事件化"

裸转账要转成可判断的事件文本，LLM 才能打分。例：
`"巨鲸地址向 Binance 转入 12,000 ETH（约 $4200 万）"` → `tickers:[ETH]`，方向暗示（进交易所≈潜在抛压/bearish 倾向，由 LLM 判）。collector 只负责把链上数据拼成自然语言 + 附 `tickers`，判断仍交 LLM。

### 与现有管线的衔接

- 全部走 `normalize → filter(recall) → refine`，不另起炉灶。
- 这些源信噪比好（领先指标），但仍过同一漏斗，保持一致可观测。

## 灰度策略

- 每个新源独立 `enabled` 开关，按批 1→2→3 逐个开。
- 阈值触发型先用**保守阈值**跑影子，观察生成量再放宽。

## 验收标准

- 批 1 跑通后：链上/衍生品事件经 LLM 后，`impact>=7` 的占比明显高于交易所公告（证明领先指标质量更高）。
- 阈值触发型日均生成量可控（不刷屏），冷却生效。

## 开放问题

→ 已集中到 [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md)（本步相关：OQ-B1 链上源选型、OQ-B2 衍生品阈值、OQ-B3 X/Twitter 是否接）。
