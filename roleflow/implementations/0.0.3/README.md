# quantitativeEventDrivenTrading v0.0.3

## 当前目标

一句话：**把"我判断会影响交易的消息"，高质量地通过机器人推给我，覆盖 crypto + A股。**

本版本只解决「消息质量」——不碰下单 / 仓位 / 风控 / 行情闭环校准。但所有字段与数据结构都为最终目标（事件驱动**自动**交易）预留好，下一版插进来零返工。

> 北极星：最终目标是"事件驱动自动交易"。这版是它的**感知层**——先把"什么消息重要、利好利空谁、影响多大、意不意外"判断准。把这些判断校准成真实行情、再接执行，是 ≥0.0.4 的事。

## 背景 / 痛点（承接 0.0.2 复盘）

- **信源太窄**：目前只有 交易所公告 + PANews + AI 博客。A股 完全空白；crypto 缺链上 / 衍生品 / 一手源（现有源都是滞后的"新闻"，没有领先指标）。
- **打分是"关键词相关性"，不是"交易冲击"**：关键词分高 ≠ 会动价。已被 price-in 的预告（如预告过的降准）关键词分很高，实际冲击≈0；反而"未排期的突发立案"才是真 alpha。
- **LLM 精筛层闲置**：0.0.2 建好的 `refine.service` 默认关着（`LLM_REFINEMENT_ENABLED=false`），且只产 `importance/category`，没有 方向 / 标的 / 意外度——不足以判断"对交易的影响"。
- 0.0.2 末期复盘还发现：panews 主导推送是**结构性的**（唯一高频且有规则的源）、`AMA` 子串误杀 Amazon、长正文低分词累加等问题，已在收尾时修复（见 `src/analyze-passrate.ts` 与项目记忆）。

## 本版本范围

**包含：**

1. **打分模型重定义**：关键词层彻底降级为"召回初筛"，最终分 = LLM 估计的**预期交易冲击**。
2. **两级 LLM 冲击抽取**：便宜模型粗评全量召回项 → 强模型精评 top；产出 `impact / direction / tickers / surprise / horizon / confidence`。
3. **crypto 信源深化**：链上（鲸鱼 / 净流 / 稳定币增发）、衍生品（资金费 / OI / 爆仓）、日历（解锁 / CoinMarketCal）、一手（关键人物 / 治理提案）。
4. **A股 最小可用**：cninfo 巨潮接入 + A股 事件规则 + 实体→股票代码 + 板块/概念传导（基础版）。
5. **推送质量升级**：消息展示 冲击分 / 方向 / 标的 / 意外度 / 一句话为什么；即时单条 + 每日 digest 两级；跨源首发去重。
6. **前向兼容 & 质量复核**：为交易版预留 `tickers / detect_latency / market` 字段；把 `analyze-passrate.ts` 扩展成 LLM 判断的质量复核工具。

**不包含（明确推迟到 ≥0.0.4）：**

- 任何下单 / 执行 / 仓位 / 风控 / 资金管理。
- **行情闭环校准**（把 LLM 估的冲击校准成实测涨跌）——但 `detect_latency` 等字段这版先记好。
- 系统化"预定事件日历"的完整建设（本版 `surprise` 先靠 LLM 判断，日历只做最小）。
- 财联社等强反爬 A股 快讯源（cninfo 跑通之后再说）。
- A股 自动交易合规问题。

## 设计原则

- **不重写，增量替换**：沿用 `collect → normalize → filter → refine → cluster → notify` 主干，只换 filter/refine 的打分内核、在 collectors 上加源。
- **关键词只负责召回**：threshold 再降，只决定"值不值得过 LLM"，**绝不决定推不推**。语义判断全交给 LLM。
- **LLM 是判官不是写手**：只做结构化打分 / 抽取，不改写正文（写作能力另立项目）。
- **为终局留接口**：即使这版不交易，`direction / tickers / surprise / horizon / detect_latency` 现在就抽好存好。
- **可灰度可观测**：每个改动带开关；每条"为什么推 / 为什么不推 / 打了几分"全程可追。
- **双市场隔离**：crypto 与 A股 走不同规则集与 prompt，用 `market` 字段区分，互不污染。

## 与 0.0.2 的差异速览

| 维度       | v0.0.2                          | v0.0.3                                              |
| ---------- | ------------------------------- | -------------------------------------------------- |
| 打分语义   | 关键词相关性 + LLM importance   | LLM **预期交易冲击**（方向 / 量级 / 意外度）        |
| LLM 结构   | 单模型，产 importance/category  | **两级模型** + 方向 / 标的 / 意外度 / 视野 / 置信   |
| LLM 开关   | 默认关                          | 默认开（影子 → 切换）                              |
| crypto 源  | 交易所 + PANews                 | + 链上 + 衍生品 + 解锁日历 + 一手                   |
| A股        | 无                              | cninfo 巨潮最小可用 + A股 事件规则 + 实体映射       |
| 推送       | importance + tldr               | + 方向 / 冲击 / 标的 / 意外度；跨源首发去重         |
| 复核       | 主观                            | `analyze-passrate` 扩展为质量复核                   |

## 落地节奏（里程碑）

- **里程碑 A（打分内核）**：`01 → 02`。推送从"关键词相关"变"冲击导向"，质量肉眼可见提升。
- **里程碑 B（crypto 深度）**：`03`。链上 / 衍生品等领先指标进来，crypto 覆盖做深。**（用户已定：crypto 先做深）**
- **里程碑 C（A股 接入）**：`04`。A股 从 0 到 1（仅 cninfo 最小可用）。
- **里程碑 D（体验与终局衔接）**：`05 → 06`。推送可判质量 + 为交易版铺好字段。

顺序：A → **B（crypto 优先）** → C（A股 最小） → D。C 可在 B 之后并行起步。

## 新增 / 修改的环境变量（建议）

```
# 既有沿用：DATABASE_URL / TELEGRAM_* / DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL

# LLM 两级
DEEPSEEK_MODEL_FAST=deepseek-chat          # 第一级：粗评全量召回项
DEEPSEEK_MODEL_SMART=deepseek-reasoner     # 第二级：精评 top 候选（或仍用 chat，见 02 开放问题）
LLM_REFINEMENT_ENABLED=true                # 默认开
LLM_TRIAGE_MIN=4                           # 粗评分 >= 多少才升级到第二级精评
LLM_DAILY_CALL_BUDGET=                     # 可选：每日调用上限，超了只走关键词保底
IMPACT_PUSH_THRESHOLD=7                     # 冲击分 >= 多少即时单条推
DIGEST_MIN_IMPACT=4                         # 冲击分 >= 多少进每日 digest

# crypto 源（按需）
ETHERSCAN_API_KEY=
TRONSCAN_API_KEY=
COINGLASS_API_KEY=
COINMARKETCAL_API_KEY=

# A股（cninfo 一般无需 key；实体映射走本地表）
ASHARE_TICKER_TABLE=./config/ashare-tickers.json
```

具体每项的读取与默认值在对应 step 文档里给。

## 待确认事项（动手前最好定）

- **两级模型的升级阈值 `LLM_TRIAGE_MIN` 与每日预算上限**：粗评全量的 token 成本可接受范围？第二级用 `reasoner`（贵、强）还是仍用 `chat`？
- **A股 实体→代码 映射数据来源**：本地维护股票列表 JSON（代码 + 简称 + 概念板块） vs 接口拉？
- **`surprise` 这版靠 LLM 判断够不够**：还是要先建最小"解锁 / 财报"日历做锚？（我的倾向：本版先 LLM，日历放 0.0.4）
- **watchlist 是否拆 crypto / A股 两套**？
- digest 除了推 Telegram，要不要同时归档成 daily markdown 供周末复盘？

## 文档列表

见 [00-PLAN-INDEX.md](./00-PLAN-INDEX.md)。
