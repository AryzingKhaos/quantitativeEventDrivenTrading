# 01 HTTP 抓取层重构

## 问题

当前 `src/collectors/http.ts` 全局共享一套 fetcher：

- `defaultHeaders` 只设了 `accept-language` 和一个固定的 Mac Chrome 135 UA
- 没有 `Referer`、没有 `Cookie`、没有 `sec-fetch-*`、没有 `accept-encoding`
- 所有 source 共用同一出口 IP、同一 UA、同一组 header
- 列表页拿到 anchor 后，请求详情页不带正确 Referer，详情页能直接看出"不是从列表页跳过来的"
- 没有条件请求（`If-Modified-Since` / `If-None-Match`）

叠加上 `poll.job.ts:100` 的 `(index * 7) % 60` 固定偏移，整体爬虫指纹非常明显。Binance / Bybit / Bitget / Cloudflare 这种风控严的站，捕到这种特征基本就限频或挑战。

## 目标

把 HTTP 层从"单一全局 fetcher"升级为"每 source 独立的 fetcher 实例"：

- 每 source 一组真实浏览器 fingerprint header（UA / sec-fetch / accept / accept-encoding / accept-language）
- 每 source 一个 cookie jar（在内存里，重启时可选 dump 到磁盘）
- 详情页请求自动带列表页作为 Referer
- 列表页支持 304 条件请求
- UA 池：每 source 启动时从一组真实 UA 中固定挑一个（不要每次请求都换，那也是异常特征）

## 涉及文件

- 改：`src/collectors/http.ts`
- 改：所有 `src/collectors/*.ts`（注入 fetcher 实例而不是直接 import 函数）
- 新：`src/collectors/fetcher.ts`（fetcher factory）
- 新：`src/collectors/ua-pool.ts`（UA 列表 + 挑选策略）
- 改：`src/services/collect.service.ts`（持有 fetcher 实例的生命周期）
- 改：`src/db/events.repo.ts` 或新加 `src/db/source-state.repo.ts`：保存 `lastModified` / `etag` 用于条件请求

## 设计要点

### 1. Fetcher 实例化

```ts
interface SourceFetcher {
  fetchText(url: string, opts?: { referer?: string }): Promise<{ status: number; text: string; headers: Headers }>;
  fetchJson<T>(url: string, opts?: { referer?: string }): Promise<{ status: number; data: T; headers: Headers }>;
  fetchConditional(url: string, prev: { etag?: string; lastModified?: string }): Promise<
    | { kind: 'not-modified' }
    | { kind: 'fresh'; text: string; etag?: string; lastModified?: string }
  >;
}

function createSourceFetcher(opts: { sourceKey: SourceKey; profile: FetcherProfile }): SourceFetcher;
```

`FetcherProfile` 包含：

- `userAgent`（启动时从 UA 池里 pick 一个，进程生命周期内固定）
- `acceptLanguage`（中文站走 `zh-CN,zh;q=0.9,en;q=0.8`，英文站走 `en-US,en;q=0.9`）
- `secChUa` 三件套（与 UA 一致，不要 UA 是 Chrome 135 但 sec-ch-ua 漏了）
- `cookieJar`（用 `tough-cookie` 或自己实现一个简易版）

### 2. Referer 自动注入

`shared.ts` 的 `collectFromListingPage` 在请求详情页时显式传 `{ referer: options.listUrl }`：

```ts
const detailHtml = await fetcher.fetchText(candidate.url, { referer: options.listUrl });
```

这一改对 OKX / Bybit / Bitget 风控影响特别明显（这些站会检查 Referer 是否在白名单）。

### 3. 条件请求

只对**列表页**做条件请求（详情页是一次性的）：

```ts
const cached = await sourceStateRepo.getListPageCache(source.key);
const result = await fetcher.fetchConditional(source.listUrl, cached);
if (result.kind === 'not-modified') {
  return []; // 啥也没变，直接返回
}
await sourceStateRepo.setListPageCache(source.key, { etag: result.etag, lastModified: result.lastModified });
```

新加表 `source_state`：

```sql
CREATE TABLE source_state (
  source_key TEXT PRIMARY KEY,
  list_etag TEXT,
  list_last_modified TEXT,
  list_fetched_at TIMESTAMPTZ,
  cookies JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 4. UA 池

一份 5-10 个常见真实 UA（Mac Chrome / Mac Safari / Win Chrome / Win Edge），与之配套的 `sec-ch-ua` 数据。**进程启动时每个 source 固定 pick 一个**，不要每次请求都换。下次进程重启再轮换一次（profile 写到 `SOURCE_FETCHER_PROFILE_DIR`）。

注意：UA 不能太"小众"（移动端、Linux），否则反而是异常特征。

## 灰度策略

- 加环境变量 `HTTP_FETCHER_V2=true`，默认 false
- v2 关闭时回退到当前 `defaultHeaders` 行为
- 灰度 1 周观察各 source 失败率变化

## 验收标准

- 各 source 30 天平均成功率 ≥ 99%（v0.0.1 baseline 需要先测出来）
- 30 分钟 cooldown 触发次数下降 80%
- 列表页 304 命中率 ≥ 50%（说明条件请求生效）

## 开放问题

- cookie jar 是否要持久化到磁盘？（重启后保留 session 对成功率有帮助，但增加复杂度）
- 是否上 `undici` 替换原生 `fetch`？undici 对 keep-alive / 连接复用更可控，但会引入依赖
- 是否考虑 `curl-impersonate`？仅在 OKX / Cloudflare 这种 TLS fingerprint 检测严重的站需要——做成"主路径连续失败 N 次自动升级"
