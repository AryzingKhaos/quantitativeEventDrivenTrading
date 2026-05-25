# 08 信源扩展

## 问题

当前 6 个 source（5 家交易所 + PANews）信源结构偏"交易所中心"——能覆盖上下币、维护、暂停充提，但下面这些事件类型几乎漏掉：

- 重要项目的融资 / 合作 / 路线图发布
- 安全事件（被盗 / 漏洞 / 跑路）
- 链上大额转账（鲸鱼动作）
- 监管动作（SEC filing / 制裁 / 立法）
- 协议升级 / 主网事件（GitHub release）
- 宏观（美联储、CPI、ETF 数据）

这些事件类型经过 LLM 精筛后信噪比远高于交易所公告（交易所公告大量都是营销活动）。

## 目标

在 v0.0.2 末期接入下列信源，**前提是 04-06 已经稳定**——LLM 精筛 + 聚类 + digest 是吸收新信源不被淹没的关键。

## 候选信源清单

### 高优（建议先接）

| 信源              | 类型      | 接入方式                                       | 备注                                  |
| ----------------- | --------- | ---------------------------------------------- | ------------------------------------- |
| The Block         | 新闻      | RSS：`https://www.theblock.co/rss.xml`         | 英文，需要 LLM 精筛阶段做翻译/摘要     |
| CoinDesk          | 新闻      | RSS：`https://www.coindesk.com/arc/outboundfeeds/rss/` | 英文                              |
| Whale Alert       | 链上转账  | Twitter/X API（@whale_alert）或 webhook        | 需要 X API access；或第三方镜像服务   |
| SEC EDGAR         | 监管文件  | RSS：`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=&output=atom` | 全市场 filing，量大需关键词预筛       |
| Coinglass         | 资金费率  | 公开 API                                       | 抓异常资金费率/爆仓数据               |
| RootData          | 融资      | 网页或 API                                     | 中文，融资事件最全                    |

### 中优

| 信源              | 类型           | 接入方式                                       |
| ----------------- | -------------- | ---------------------------------------------- |
| 项目 GitHub release | 协议升级     | GitHub API：`/repos/{owner}/{repo}/releases`   |
| Foresight News    | 中文资讯       | RSS                                            |
| 链闻 ChainNews    | 中文资讯       | RSS                                            |
| Galxe / Layer3    | 空投活动       | 网页爬                                         |
| TradingView 经济日历 | 宏观        | RSS / API                                      |

### 低优

| 信源              | 类型               | 备注                                |
| ----------------- | ------------------ | ----------------------------------- |
| Reddit r/cryptocurrency | 社区情绪    | 噪声大，仅作可选                    |
| 币圈大V Twitter   | 关键人物动态       | X API 限制多，性价比低              |

## 涉及文件

- 改：`src/config/sources.ts`（新增 source 条目）
- 新：每个新 source 一个 `src/collectors/{name}.ts`
- 多数 source 复用 02 步建的 RSS / API 通用工具
- 改：`src/config/rules.ts`（每个新 source 配粗筛 keyword 列表，召回优先）

## 设计要点

### 新 source 接入清单（每个 source 都要回答）

1. 是否需要登录 / API key？
2. 限频是多少？要不要单独 pollIntervalSec？
3. 字段映射（title/url/publishedAt/summary/content）
4. 是否英文？需要在精筛阶段做翻译？
5. 粗筛关键词初版

### 翻译策略

英文 source（The Block / CoinDesk / SEC EDGAR）的处理：

- 关键词粗筛阶段：英文关键词列表（与中文并列）
- LLM 精筛阶段：在 prompt 里加一句"如果是英文，输出 tldr/reason 时翻译为中文"
- 不要单独搞翻译流水线——LLM 精筛阶段一次解决

### 信源优先级与频次

新 source 进来后，pollIntervalSec 默认值建议：

- RSS 类：300 秒
- API 类：180 秒
- GitHub releases：900 秒
- SEC EDGAR：600 秒（filing 量大但更新慢）

### 灰度

新 source 默认 `enabled: false`，启用前先用 `--once --source=<key>` 跑一次看：

- 抓数量是否合理
- 字段是否齐全
- 关键词命中率是否过高/过低

## 验收标准

- 接入 3 个新高优信源（The Block / CoinDesk / RootData 或类似）
- 接入后日均推送数（critical + digest 合计）维持在 10-30 条之间（说明 LLM 精筛和 digest 在工作）
- 新 source 命中的事件中，importance >= 7 比例不低于现有 source

## 开放问题

- Whale Alert 的接入方式（X API 收费 / 第三方镜像可靠性）
- 是否要专门接一个"宏观日历"作为单独 channel 推送（比如每天推次日的关键经济数据）
- 长期是否要接 Telegram channel monitor（关注几个核心项目的官方 channel）——这个不能用爬虫，要用 telegram-cli 或 user bot

## 之后

v0.0.2 完成后，下一版本（v0.0.3）的方向候选：

- 链上大户监控（基于 Tron/Eth 节点 + Whale Alert）
- 持仓/账户对接（让 watchlist 自动从交易所同步）
- Web dashboard（看历史推送、效果报告、调 watchlist）
- 自动调权（07 步积累的数据反推 04 的阈值）
