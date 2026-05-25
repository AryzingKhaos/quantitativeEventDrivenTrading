# quantitativeEventDrivenTrading v0.0.2

## 当前目标

在 v0.0.1 已稳定跑通的基础上，解决两个核心痛点：

1. **抓取稳定性**：所有 source 共用一组 UA / header / 出口 IP，cron 偏移可预测，整体爬虫指纹明显，易被风控
2. **过滤精度**：纯关键词加权无法表达语义，`excludeKeywords` 越加越长是个坏循环，推送信噪比偏低

本版本的改造方向不是重写，是给 v0.0.1 架构换两层"皮"：

- HTTP 层：从单一 fetcher 升级为多 source 独立配置 + API/RSS 优先
- 过滤层：从纯关键词升级为"关键词粗筛 → LLM 结构化精筛"两阶段漏斗

## 本版本范围

包含：

- HTTP 抓取层重构（独立 fetcher + UA 池 + Referer / Cookie / sec-fetch headers + 条件请求）
- 数据源接入策略升级（官方 API / RSS 优先）
- 调度策略改造（去掉确定性 cron 偏移 + 抖动）
- 出口 IP 与可选代理支持
- LLM 精筛层（粗筛通过的事件交给 DeepSeek `deepseek-chat` 输出结构化判断）
- Watchlist 加权
- 跨源去重与聚类（同一事件多源报道合并推送）
- Digest 模式（次要事件每日简报，不实时打扰）
- 推送质量反馈闭环（Telegram inline keyboard 👍/👎）
- 推送效果追踪（推送后 1h / 24h / 7d 价格变动）
- 信源扩展（The Block / CoinDesk / Whale Alert / SEC EDGAR / GitHub releases 等）

不包含：

- Web 管理后台（仍用代码配置 + 环境变量）
- 多实例部署
- Redis（聚类用 PG 临时表 + 短期内存即可）
- 自动调权 / 强化学习
- 链上大户监控（v0.0.3 再说）

## 设计原则

- **不重写，只增量替换**：v0.0.1 的 collect → normalize → filter → notify 流水线保留，只在节点上插入新能力
- **关键词层不删，只降级**：从"决定推不推"降级为"决定值不值得过 LLM"，召回优先
- **LLM 是过滤器，不是写手**：本版本不让 LLM 改写标题/摘要正文，只用它做结构化打分；写作能力放到未来版本（公众号方向另立项目）
- **本地优先**：reembedding / clustering 等如果能用纯 PG 解决，不引 Redis / 向量库
- **可灰度**：每一个改动都有开关（环境变量），出问题能秒回退
- **可观测**：每条推送的"为什么推/为什么不推"全程可追溯（写入 events.raw_payload 或新加字段）

## 与 v0.0.1 的差异点速览

| 维度          | v0.0.1                                | v0.0.2                                                            |
| ------------- | ------------------------------------- | ----------------------------------------------------------------- |
| HTTP 层       | 全局共用 `defaultHeaders`             | 每 source 独立 fetcher（UA 池 / Referer / Cookie / sec-fetch）    |
| 接入策略      | HTML 爬取为主，仅 Binance 走内部 API  | API / RSS 优先，HTML 兜底                                         |
| 调度          | `cron + (index*7)%60` 确定性偏移      | 完成后随机延迟下一轮（self-rescheduling）+ 请求间抖动             |
| 出口 IP       | 单一（运行机器）                      | 可选 HTTP/SOCKS 代理，建议跑在境外 VPS                            |
| 过滤          | 关键词加权 + excludeKeywords          | 关键词粗筛 → DeepSeek 结构化打分（importance / category / assets）|
| 去重          | source 内 fingerprint                 | source 内指纹 + 跨源 embedding/LLM 聚类                           |
| 推送          | 命中即推                              | critical 实时推 / 次要事件 digest 每日推 / noise 静默             |
| 反馈          | 无                                    | Telegram 👍/👎 → DB → 周期性回看                                  |
| 效果验证      | 无                                    | 推送后 1h / 24h / 7d 价格快照入库                                 |
| 信源          | 6 家（5 交易所 + PANews）             | + The Block / CoinDesk RSS / Whale Alert / SEC EDGAR / GitHub     |

## 落地节奏建议

按对生活质量提升的边际效用排序：

- **里程碑 A（稳定性）**：完成 `01` → `03`，告警和断流的频率显著下降
- **里程碑 B（精度）**：完成 `04`，推送质量从"信噪 1:5"变成"1:1.5"
- **里程碑 C（体验）**：完成 `05` → `06`，推送频次下降但每条都值得看
- **里程碑 D（深度）**：完成 `07` → `08`，开始有数据驱动决策的能力

每个里程碑都可独立交付，不必一口气做完。

## 新增/修改的环境变量（建议）

```
# 既有：DATABASE_URL / TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / DEEPSEEK_API_KEY

# 新增
DEEPSEEK_BASE_URL=https://api.deepseek.com         # OpenAI 兼容端点；SDK 用 `openai` npm 包
DEEPSEEK_MODEL_FAST=deepseek-chat                  # 精筛默认（DeepSeek-V3，支持 JSON mode）
DEEPSEEK_MODEL_SMART=deepseek-reasoner             # 聚类/digest/复盘 必要时升级（R1）
LLM_REFINEMENT_ENABLED=true                        # 精筛层总开关
LLM_REFINEMENT_THRESHOLD=6                         # importance >= 多少分实时推
DIGEST_ENABLED=true
DIGEST_CRON=0 8 * * *                              # 每天早 8 点
DIGEST_MIN_IMPORTANCE=3
HTTP_PROXY=                                        # 可选
SOURCE_FETCHER_PROFILE_DIR=./fetcher-profiles      # 各 source 的 cookie/UA 缓存
WATCHLIST_PATH=./config/watchlist.json
FEEDBACK_BOT_USERNAME=                             # 用于 inline keyboard callback
```

具体每一项的读取与默认值在对应 step 文档里给。

## 文档列表

见 [00-PLAN-INDEX.md](./00-PLAN-INDEX.md)。

## 待确认事项（在动手前最好定一下）

- 是否决定迁移到境外 VPS？这会显著改变代理方案的复杂度
- ~~LLM 用 Anthropic 还是想兼顾 OpenAI / 本地？~~ → **已定：DeepSeek**（OpenAI 兼容端点，SDK 用 `openai` 包，自动 context cache）
- 反馈闭环的 callback 服务跑在哪？（同进程加 webhook server / 单独 polling worker）
- watchlist 是手维护 JSON 还是同步自实际持仓？（后者要接交易所 API，复杂度高一档）
- digest 还是只推 Telegram，还是同时归档为 daily markdown 给自己周末复盘？
