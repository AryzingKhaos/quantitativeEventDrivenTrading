# v0.0.2 Plan Index

本目录下的优化计划按"先稳定、再精度、再体验、再深度"顺序拆分。

每一步都是相对独立的增量改造，可以分多次执行；但**强烈建议按编号顺序推进**，因为后面的步骤依赖前面步骤产出的数据/字段/流程。

## 计划列表

1. [01-http-fetcher-redesign.md](./01-http-fetcher-redesign.md)
   把全局共用的 `src/collectors/http.ts` 拆成"每 source 独立 fetcher"，加 UA 池、Referer、Cookie、sec-fetch headers、条件请求。
2. [02-collector-strategy-upgrade.md](./02-collector-strategy-upgrade.md)
   逐个 source 重新评估接入方式：能用官方 API / RSS 就别爬 HTML；HTML 路径降级为兜底。
3. [03-scheduling-and-egress.md](./03-scheduling-and-egress.md)
   去掉确定性 cron 偏移，改为"完成后随机延迟下一轮"；加请求间抖动；支持可选 HTTP/SOCKS 代理。
4. [04-llm-refinement-layer.md](./04-llm-refinement-layer.md)
   在 `filter.service.ts` 后面新增"LLM 精筛"阶段：关键词粗筛通过的事件交给 DeepSeek（`deepseek-chat` / V3）输出 importance / category / assets / actionable / tldr / reason，按 importance 阈值决定推不推、按 category 决定推到哪里。
5. [05-cross-source-clustering-and-digest.md](./05-cross-source-clustering-and-digest.md)
   新增"跨源聚类"和"digest 简报"能力：同一事件 Binance + PANews 都报道时合并推送一条；importance 不够 critical 但又值得知道的事件攒到每日早 8 点用 LLM 写一份 5-10 条简报推一次。
6. [06-feedback-loop.md](./06-feedback-loop.md)
   每条推送下面挂 Telegram inline keyboard 的 👍/👎，反馈写回 DB；周期性让 LLM 看一批反馈案例，反向产出 watchlist / prompt 优化建议。
7. [07-effectiveness-tracking.md](./07-effectiveness-tracking.md)
   推送时启动 1h / 24h / 7d 三个延迟任务，记录相关资产价格变动；积累一段时间后用来评估推送是否真的"有用"。
8. [08-source-expansion.md](./08-source-expansion.md)
   接入新信源：The Block / CoinDesk RSS / Whale Alert / SEC EDGAR / 几个核心项目的 GitHub release 等。这些事件经过 LLM 精筛后信噪比远高于交易所公告。

## 执行原则（沿用 v0.0.1）

- 每一步都应有可验证产物
- 每一步优先做最小可运行版本，不提前扩展
- 每一步都要带"灰度开关"（环境变量），保证可回滚
- 不把后续步骤的逻辑提前塞进前一步

## 建议里程碑

- 完成 `01` → `03`：抓取告警频次显著下降，是稳定性里程碑
- 完成 `04`：推送数量减少 60%+，每条都更值得看，是精度里程碑
- 完成 `05` → `06`：从"工具"升级为"会自学的助理"，是体验里程碑
- 完成 `07` → `08`：开始有数据驱动决策的能力，是深度里程碑
