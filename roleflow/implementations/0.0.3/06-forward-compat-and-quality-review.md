# 06 前向兼容 & 质量复核

## 问题

- 这版不做交易，但若字段/结构没为终局留好，下一版（行情闭环 + 执行）要返工。
- "消息质量"需要能被**系统化复核**，而不只是凭印象。

## 目标

1. 为 ≥0.0.4 的交易版铺好接口（只记录、不使用）。
2. 提供一个质量复核工具，量化"LLM 的冲击判断到底准不准"，并顺手攒下一版做行情校准要用的样本。

## 涉及文件

- 改：`src/services/normalize.service.ts` / `src/jobs/poll.job.ts`（计算并写 `detect_latency_ms`）
- 改：`src/analyze-passrate.ts`（扩展为质量复核：按 `market` / `impact` 分桶抽样、导出 LLM 字段供人工标注）
- 不改但确认对接点：`price.service` / `effectiveness.service` / `snapshots.repo`（交易版用，本版**不触发**）

## 设计要点

### 为交易版预留（只记不用）

- **`detect_latency_ms`**：`fetched_at - published_at`。交易版判断"这段 move 还吃不吃得到"的关键，本版先老实记录。
- **`tickers` 规范化**：crypto 用可直接下单的符号、A股 用 6 位代码（`02`/`04` 已落）。交易版的标的映射零返工。
- **`market` 贯穿**：规则 / prompt / 展示 / 未来的执行路由都按它分流。
- **`direction` / `horizon` / `confidence`**：交易版生成信号方向与持有期的现成输入。

明确红线：本版任何代码**不得**调用 `effectiveness.trackBaseline` 之外的价格逻辑去驱动决策；价格快照若开，仅作观测，不进打分、不进推送门。

### 质量复核工具（扩展 analyze-passrate）

新增子命令，回答"消息质量到底如何"：

- **按 impact 分桶**：近 N 天事件按 `impact` 0-2 / 3-4 / 5-6 / 7-8 / 9-10 分桶，每桶抽样打印 `title / direction / surprise / tickers / reason`，供人工快速扫一眼"这个分给得对不对"。
- **按 market / source 看分布**：每个源的 impact 分布、推送量、triage 通过率。
- **导出标注集**：把近 N 天高 impact 事件导出 JSONL（含全部 LLM 字段 + url + published_at），作为下一版"事件 → 实测涨跌"标注的输入种子。
- **影子对比**（配合 `02` 影子模式）：同一批事件，关键词分 vs LLM impact vs 人工主观，三列并排，校准阈值。

### 与下一版的接缝

本版产出的"事件 + 规范化 tickers + detect_latency + LLM 冲击判断"四件套，正好是 0.0.4 行情闭环的输入：那一版只需对这些事件按 `tickers` 拉多视野行情、算超额收益 / MFE-MAE，回归到 `impact`，即可把"LLM 估的分"校准成"实测的分"。本版不实现，但数据结构对齐。

## 灰度策略

- `detect_latency_ms` 计算无副作用，可直接合入。
- 复核工具是只读脚本，不影响主流程。

## 验收标准

- 能一键导出"近 N 天 LLM 判断 + 字段"供人工复核，并按桶抽样。
- `detect_latency_ms` 对有 `published_at` 的源稳定写入。
- 走查一遍确认：本版无任何代码路径据价格 / 行情触发推送或决策。

## 开放问题

- 人工标注结果存哪（新表 vs JSONL 文件）？倾向先 JSONL，0.0.4 再入库。
- `detect_latency` 对 `published_at` 缺失的源（部分爬取源）如何处理——记 null 还是用 fetched 近似？
- 质量复核要不要也挂到 Telegram（每周自动推一份"本周质量自检"）？
