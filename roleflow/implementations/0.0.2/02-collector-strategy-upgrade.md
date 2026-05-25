# 02 数据源接入策略升级

## 问题

当前接入方式参差不齐：

- Binance：内部 API（`bapi/composite/v1/public/cms/article/list/query`），稳定 ✓
- OKX：HTML 爬取（cheerio），脆弱
- Bybit：HTML 爬取，脆弱
- Coinbase：HTML 爬取（且默认 disabled）
- Bitget：HTML 爬取
- PANews：HTML + 解析 `__NUXT_DATA__`，**最脆弱**——前端框架一升级就废

HTML 爬取的本质问题是：**站点没有契约约束**——他们前端今天改个 class 名你就解析失败，今天加个 hydration 你就拿不到数据。这种脆弱对"信息聚合"这种长期跑的项目是致命的。

## 目标

按以下优先级重新评估每一个 source 的接入方式：

1. 官方公开 API（最稳）
2. 官方 RSS / Atom feed（次稳）
3. 移动端 API（半正式，可逆向但不太会突然变）
4. HTML 爬取（兜底，且必须有 fallback selector）
5. 第三方聚合（如 cryptopanic）

## 各 source 重新评估

### Binance

- 现状：内部 API ✓
- 改动：基本不改，但把 catalog id 列表移到 config，方便加新分类
- 注意：`bapi/composite` 不是公开契约，binance 改了就坏；建议增加 fallback 到 `https://www.binance.com/zh-CN/support/announcement` HTML 路径

### OKX

- 现状：HTML
- 选项 A：移动端 API `https://www.okx.com/v3/c2c/tradingOrders/notification`（需要逆向 X-CDN 等 header）
- 选项 B：保留 HTML，但抓取 `__NEXT_DATA__` 里的结构化数据而不是 DOM
- 建议：先 B，B 不行再 A

### Bybit

- 现状：HTML（announcements.bybit.com）
- 已知有官方 API：`GET https://api.bybit.com/v5/announcements/index?locale=zh-TW&type=new_crypto&limit=20`
  - 公开文档：https://bybit-exchange.github.io/docs/v5/announcement
  - 不需要 API key
- 建议：直接换 API，HTML 路径删除

### Coinbase

- 现状：HTML（disabled）
- 选项：Coinbase Blog 有 RSS——`https://www.coinbase.com/blog/rss/`（需要确认）
- 建议：用 RSS 接入，重新启用

### Bitget

- 现状：HTML
- 已知有官方公告 API：`https://www.bitget.com/v1/cms/helpCenter/content/section/helpContentDetail`
- 建议：换 API，HTML 兜底

### PANews

- 现状：HTML + `__NUXT_DATA__` 解析
- 已知有 RSS：需要确认 PANews 的 RSS 地址（旧地址 `https://www.panewslab.com/zh/feed`，待验证）
- 选项 B：他们有移动端 API（流量站常见）
- 建议：先试 RSS，不行就 HTML 路径加固

## 涉及文件

- 改：所有 `src/collectors/*.ts`
- 新：`src/collectors/rss.ts`（通用 RSS 解析器，复用给 PANews / Coinbase / 后续新增的 The Block / CoinDesk 等）
- 新：每 source 的 fallback 链：API → RSS → HTML
- 改：`src/types/source.ts` 加上 `accessStrategies: Array<'api' | 'rss' | 'html'>`

## 设计要点

### Fallback 机制

```ts
async function collectWithFallback(source, fetcher) {
  for (const strategy of source.accessStrategies) {
    try {
      return await collectByStrategy(strategy, source, fetcher);
    } catch (err) {
      logger.warn('Strategy failed, trying next', { source: source.key, strategy, err });
    }
  }
  throw new Error('All strategies exhausted');
}
```

### RSS 通用解析

用 `rss-parser` 或自己用 `cheerio` 解析 XML（选 cheerio 避免新依赖）。RSS 字段映射到 `CollectorItem`：

```
title       -> item.title
url         -> item.url
publishedAt -> item.publishedAt（注意各种 RFC 822 / ISO 格式）
summary     -> item.summary（取 description 或 content:encoded 的截断）
content     -> item.content（取 content:encoded）
```

详情页是否还要单独抓？看情况——RSS 里 `content:encoded` 已经够长就不用，否则按现在的 detail 抓取链。

## 灰度策略

- 每个 source 加一个 `defaultStrategy` 配置
- 切到新 strategy 前，先并行跑两条链 1 周（A/B 对比命中率和数据完整度）
- 发现 API/RSS 漏掉的事件比例 < 5% 时正式切换

## 验收标准

- 每个 source 至少有 1 个 API/RSS 主路径 + 1 个 HTML 兜底路径
- 30 天内无任何 source 因为前端改版完全断流
- HTML 兜底路径触发频次 < 1 次/天

## 开放问题

- Binance 内部 API 是否值得加 HTML fallback？（一旦 binance 改 API，连 fallback 也是脆的，可能直接报警人工处理更现实）
- 各 source 的 API 限频策略要分别确认（有些站 API 限频比 HTML 还严）
