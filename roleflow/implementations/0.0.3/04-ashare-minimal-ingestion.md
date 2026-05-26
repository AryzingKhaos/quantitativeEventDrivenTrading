# 04 A股 最小可用（cninfo 巨潮）

## 问题

A股 完全空白。A股 是**政策 + 强制披露**驱动的市场，事件源、事件类型、传导逻辑都与 crypto 不同，不能套用现成规则。

## 目标

A股 从 0 到 1，最小可用：**只接 cninfo 巨潮**，跑通"披露 → 召回 → LLM 冲击 → 推送"全链路。财联社等强反爬快讯源**本版不做，0.0.5 再接**。

## 涉及文件

- 新：`src/collectors/cninfo.ts`（巨潮披露接入）
- 改：`src/config/sources.ts`（注册 cninfo，`market: 'ashare'`）
- 改：`src/config/rules.ts`（新增 `market:'ashare'` 规则集 / 召回词）
- 新：`src/config/ashare-tickers.json` + 加载器（实体→6 位代码 + 概念板块）
- 改：`src/config/watchlist.ts`（watchlist 按 `market` 拆成 crypto / ashare 两套）
- 改：`src/config/prompts/`（A股 system prompt，在 `02` 已预留双市场）

## 设计要点

### cninfo 接入

巨潮有公告披露查询接口（按分类 / 日期 / 板块），结构化程度高、相对好爬：

- 抓**分类公告**：重大事项 / 业绩预告·快报 / 重组 / 权益变动 / 停复牌 / 立案 等。
- 每条公告 → normalize 成统一 event（title = 公告标题，content = 摘要/正文，`tickers` 预填该公司 6 位代码）。
- 抓取频率与反爬强度实测决定，复用 panews 踩过 Cloudflare 的那套 fetcher 经验。
- 注意交易时段：A股 有盘前/盘中/盘后与**涨跌停**——本版只在展示层标注"是否盘中/是否易封板"，**不做任何交易动作**。

### A股 事件类型规则（召回层）

`market:'ashare'` 召回词覆盖高冲击事件类型：
立案调查 / 被处罚 / 重大资产重组 / 控制权变更 / 业绩预告（预增·预亏·扭亏）/ 业绩快报 / 停牌·复牌 / 减持·增持·回购 / 限售解禁 / 中标·重大合同 / 股权激励 / ST·*ST·退市 / 分红送转。

召回优先（宁滥勿缺），语义与量级判断交 `02` 的 A股 prompt。

### 实体 → 股票代码

LLM 给的公司名要落成可交易代码（交易版必需，本版先建表）：

- 本地维护 `ashare-tickers.json`：`{ code, name, aliases[], concepts[] }`（如 `600519 贵州茅台 [茅台] [白酒,消费]`）。
- collector 已知发文主体时直接填 `tickers`；LLM 抽到的其他公司名走本地表模糊匹配补全。

### 板块 / 概念传导（基础版）

A股 很多 alpha 在"一条利好带动整条板块"：

- 公司 → 其 `concepts[]`（所属概念板块）。
- `02` 的 A股 prompt 增加一问："此事件是公司个体级还是板块级利好/利空？" → 写入 `reason`，板块级事件 impact 适当上浮。
- 完整的板块联动图谱推迟到 0.0.5，本版只做"标注所属板块 + LLM 粗判板块级"。

### watchlist 按 market 拆

`watchlist` 拆成 crypto / ashare 两套（A股 关注的个股/板块与 crypto 资产完全不同）；refine 与推送加权按事件 `market` 取对应那套。

## 灰度策略

- cninfo 独立 `enabled`；先抓少量分类影子跑，确认解析正确、实体映射命中率。
- A股 规则集与 crypto 物理隔离（`market` 区分），互不影响。

## 验收标准

- cninfo 跑通：能稳定抓到当日重大披露，解析无明显丢字段。
- 实体→代码 命中率 ≥ 90%（抽查）。
- A股 经 LLM 后，立案/重组/超预期业绩等被正确判为高 impact。

## 开放问题

→ 已集中到 [OPEN-QUESTIONS.md](./OPEN-QUESTIONS.md)（本步相关：OQ-C1 实体→代码 数据来源、OQ-C2 cninfo 抓取/反爬、OQ-C3 互动易/交易所公告是否本版加、OQ-C4 财联社推迟）。
