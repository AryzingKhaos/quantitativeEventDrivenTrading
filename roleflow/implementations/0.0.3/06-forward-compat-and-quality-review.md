# 06 前向兼容 & 质量复核

## 问题

- 这版不做交易，但若字段/结构没为终局留好，下一版（行情闭环 + 执行）要返工。
- "消息质量"需要能被**系统化复核**，而不只是凭印象。

## 目标

1. 为 ≥0.0.4 的交易版铺好接口（只记录、不使用）。
2. 提供一个**只读**的质量自检工具，让用户能快速扫一眼"LLM 的冲击判断准不准"。**本版不做任何人工标注/打标存储**（人工成本过高）。

## 涉及文件

- 改：`src/services/normalize.service.ts` / `src/jobs/poll.job.ts`（计算并写 `detect_latency_ms`）
- 改：`src/analyze-passrate.ts`（扩展为只读质量自检：按 `market` / `impact` 分桶抽样查看）
- 不改但确认对接点：`price.service` / `effectiveness.service` / `snapshots.repo`（交易版用，本版**不触发**）

## 设计要点

### 为交易版预留（只记不用）

- **`detect_latency_ms`**：`fetched_at - published_at`。交易版判断"这段 move 还吃不吃得到"的关键，本版先老实记录。
- **`tickers` 规范化**：crypto 用可直接下单的符号、A股 用 6 位代码（`02`/`04` 已落）。交易版的标的映射零返工。
- **`market` 贯穿**：规则 / prompt / 展示 / 未来的执行路由都按它分流。
- **`direction` / `horizon` / `confidence`**：交易版生成信号方向与持有期的现成输入。

明确红线：本版任何代码**不得**调用 `effectiveness.trackBaseline` 之外的价格逻辑去驱动决策；价格快照若开，仅作观测，不进打分、不进推送门。

### 只读质量自检工具（扩展 analyze-passrate）

新增子命令，回答"消息质量到底如何"——**只看不存**，不产生任何需要人工打标的产物：

- **按 impact 分桶**：近 N 天事件按 `impact` 0-2 / 3-4 / 5-6 / 7-8 / 9-10 分桶，每桶抽样打印 `title / direction / surprise / tickers / reason`，用户扫一眼即可判断"这个分给得对不对"。
- **按 market / source 看分布**：每个源的 impact 分布、推送量、召回通过率。
- **影子对比**（配合 `02` 影子模式）：同一批事件，关键词召回 vs LLM impact 并排，用来校准阈值。

### 每周质量自检（可选，成本低则做）

若实现成本不高，把上面的分桶概览每周自动汇成一条推到 Telegram（"本周质量自检"），省得手动跑脚本。

### 与下一版的接缝

本版产出的"事件 + 规范化 tickers + detect_latency + LLM 冲击判断"四件套，正好是 0.0.4 行情闭环的输入：那一版只需对这些事件按 `tickers` 拉多视野行情、算超额收益 / MFE-MAE，回归到 `impact`，即可把"LLM 估的分"校准成"实测的分"。本版不实现，但数据结构对齐。

## 灰度策略

- `detect_latency_ms` 计算无副作用，可直接合入。
- 复核工具是只读脚本，不影响主流程。

## 验收标准

- 能一条命令按 impact 分桶抽样查看近 N 天事件（只读，无导出/打标产物）。
- `detect_latency_ms` 对有 `published_at` 的源稳定写入；缺 `published_at` 记 null。
- 走查一遍确认：本版无任何代码路径据价格 / 行情触发推送或决策，也无任何人工标注/打标存储。

## 开放问题

→ 已集中到 [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md)（本步相关：OQ-F1 标注结果存哪、OQ-F2 缺 published_at 的 detect_latency、OQ-F3 质量复核是否挂 Telegram）。
