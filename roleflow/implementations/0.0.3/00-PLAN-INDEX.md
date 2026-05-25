# v0.0.3 Plan Index

本版本目标是**消息质量**：把会影响交易的 crypto + A股 消息，高质量推送。不碰交易执行，但为其预留所有字段。

每一步都是相对独立的增量改造，可分多次执行；**强烈建议按编号顺序推进**，因为 `02` 的字段是 `03/04/05/06` 的共同依赖。

## 计划列表

1. [01-scoring-model-redesign.md](./01-scoring-model-redesign.md)
   把"分数"从**关键词相关性**重定义为**预期交易冲击**。关键词层 threshold 再降、彻底降级为"召回初筛"，只决定值不值得过 LLM。规则集按 `market`（crypto / ashare）拆分。
2. [02-llm-impact-extraction.md](./02-llm-impact-extraction.md)
   **本版本核心。** 把 `refine.service` 升级为两级 LLM：便宜模型粗评全量召回项（砍 noise）→ 强模型精评 top 候选，产出 `impact / direction / tickers / surprise / horizon / confidence / category / tldr / reason`。新增 DB 字段，其中 `direction / tickers / surprise / detect_latency / market` 为交易版预留。
3. [03-crypto-source-expansion.md](./03-crypto-source-expansion.md)
   crypto 信源做深：链上（鲸鱼 / 交易所净流 / 稳定币增发）、衍生品（资金费 / OI / 爆仓）、日历（解锁 / CoinMarketCal）、一手（关键人物 / 治理）。这些是领先指标，过 LLM 后信噪比远高于交易所公告。
4. [04-ashare-minimal-ingestion.md](./04-ashare-minimal-ingestion.md)
   A股 从 0 到 1：接入 **cninfo 巨潮**（最权威、有接口），A股 事件类型规则（立案 / 重组 / 业绩预告 / 停复牌 / 减持 / 解禁…），实体→股票代码 映射，板块/概念传导基础版。财联社等反爬源推迟。
5. [05-push-quality-and-tiering.md](./05-push-quality-and-tiering.md)
   推送质量：消息展示 冲击分 / 方向 / 标的 / 意外度 / 一句话为什么（crypto 与 A股 两套模板）；即时单条 + 每日 digest 两级路由；跨源同事件推首发、后续作"已确认"不重复打扰。
6. [06-forward-compat-and-quality-review.md](./06-forward-compat-and-quality-review.md)
   为交易版铺路 + 质量自检：记录 `detect_latency`（发布→首见）、规范化 `tickers`、贯穿 `market`；把 `analyze-passrate.ts` 扩展成"按冲击分桶抽样复核 LLM 判断"的工具，顺便攒下一版行情校准要用的样本。

## 执行原则（沿用 0.0.1 / 0.0.2）

- 每一步都应有可验证产物。
- 每一步优先做最小可运行版本，不提前扩展。
- 每一步都带"灰度开关"（环境变量），保证可回滚。
- 不把后续步骤的逻辑提前塞进前一步。
- **新增**：凡是为交易版预留的字段，本版只"抽取 + 存 + 展示"，绝不据此触发任何交易动作。

## 建议里程碑

- 完成 `01 → 02`：打分从关键词相关变冲击导向，**精度里程碑**。
- 完成 `03`：crypto 领先指标进来，**深度里程碑**（用户已定 crypto 优先）。
- 完成 `04`：A股 从 0 到 1，**覆盖里程碑**。
- 完成 `05 → 06`：推送可判质量、字段为终局铺好，**体验 + 衔接里程碑**。
