# 07 推送效果追踪

## 问题

整套系统跑下来，到底"有用没用"目前只能凭感觉。改 watchlist、调 prompt、加 source，每次改完只能"再过一周看看感觉"。

更严重的问题是：可能某些类型的推送你看了觉得"挺有用"，但实际上对应资产价格根本没动；反之有些你忽略的事件其实对市场冲击很大。**主观感受和客观结果之间有 gap，不量化就永远不知道**。

## 目标

每条推送（critical 或 digest）发出时，自动启动 1h / 24h / 7d 三个延迟任务，记录 `affected_assets` 在推送时刻的价格基线和后续价格。积累 1-3 个月数据后，回看：

- 哪些 category 的推送后续价格波动最大（最值得保留）
- 哪些 category 是"假阳性"（推了但实际没影响）
- 哪些 source 的"前导性"最强（公告刚出还没扩散时推送）
- 推送的"信号-噪声比"在时间维度上的趋势

## 涉及文件

- 新：`src/services/price.service.ts`（价格快照获取）
- 新：`src/jobs/price-snapshot.job.ts`（延迟任务调度）
- 新：`src/db/migrations/xxxx_price_snapshots.sql`
- 新：`src/scripts/effectiveness-report.ts`（人工运行的报告脚本）
- 改：`src/services/notify.service.ts`（推送成功后挂上 snapshot 任务）

## 数据库变更

```sql
CREATE TABLE price_snapshots (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id),
  asset TEXT NOT NULL,                       -- 'BTC' / 'TRX' / etc
  baseline_price NUMERIC(20, 8),             -- 推送时刻
  baseline_at TIMESTAMPTZ,
  price_1h NUMERIC(20, 8),
  price_1h_at TIMESTAMPTZ,
  price_24h NUMERIC(20, 8),
  price_24h_at TIMESTAMPTZ,
  price_7d NUMERIC(20, 8),
  price_7d_at TIMESTAMPTZ,
  source TEXT NOT NULL DEFAULT 'binance',    -- 哪家行情源
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX price_snapshots_event_idx ON price_snapshots(event_id);
CREATE INDEX price_snapshots_asset_idx ON price_snapshots(asset, baseline_at DESC);

-- 待补任务表
CREATE TABLE pending_snapshots (
  id BIGSERIAL PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES events(id),
  asset TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,               -- 何时取价
  kind TEXT NOT NULL,                        -- '1h' / '24h' / '7d'
  done BOOLEAN NOT NULL DEFAULT false,
  attempts SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX pending_snapshots_due_idx ON pending_snapshots(due_at) WHERE done = false;
```

## 设计要点

### 价格源

第一选择：**Binance Spot API**（无需 key、无需 IP 白名单）：

```
GET https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&startTime=...&endTime=...&limit=1
```

回退：CoinGecko free tier（50 req/min，OK）。

注意：

- 资产符号要映射到交易对（`TRX` → `TRXUSDT`）
- 不在交易所交易的小币种（比如 affected_assets 里有"WLFI"但 binance 没上）→ 标记 `unsupported_asset`，跳过

### 调度

发推送 → 立即写 baseline + 3 条 `pending_snapshots`：

```ts
async function trackEffectiveness(event: PersistedEvent) {
  const assets = event.affectedAssets ?? [];
  if (assets.length === 0) return;

  for (const asset of assets) {
    const baseline = await priceService.fetchSpot(asset);
    if (!baseline) continue;

    await priceSnapshotsRepo.insertBaseline({ eventId: event.id, asset, baseline });
    await pendingRepo.insertMany([
      { eventId: event.id, asset, kind: '1h',  dueAt: addHours(now, 1) },
      { eventId: event.id, asset, kind: '24h', dueAt: addHours(now, 24) },
      { eventId: event.id, asset, kind: '7d',  dueAt: addDays(now, 7) }
    ]);
  }
}
```

`price-snapshot.job.ts` 每 5 分钟扫一次 `pending_snapshots WHERE done=false AND due_at <= NOW()`，取价并更新对应字段。

### 报告脚本

`src/scripts/effectiveness-report.ts`，参数 `--days 30`：

输出每个 category 的：

- 平均 1h 价格变动绝对值
- 24h 平均回报率
- 24h 最大回撤
- 中位数 vs 均值（看是否有长尾）
- 按 importance 分桶交叉

CSV / markdown 输出，方便贴到 Notion 或自己复盘。

### 反向运用：自动调权

积累 8 周数据后，可以加一个新任务：根据"category × source × importance"格子的实际价格波动，反推是否要调路由阈值。这一步不进 v0.0.2，留给 v0.0.3。

## 灰度策略

- `EFFECTIVENESS_TRACKING_ENABLED=false` 默认关
- 打开后 1 周观察 binance API 调用量，确认不会撞限频
- 不影响推送链路（追踪失败 swallow，不报警）

## 验收标准

- 1 个月后 `price_snapshots` 表里有至少 50 个完整事件（含 1h/24h/7d）
- 报告脚本能跑出 category 维度的均值差异
- 不影响主流程稳定性

## 开放问题

- 7 天延迟任务跨进程重启会有问题吗？（pending_snapshots 表持久化解决，进程重启后自动续）
- 是否要为 PANews 这种"不针对单个资产"的事件抓 BTC + ETH 整体行情快照？（值得，作为"市场情绪"参考）
- 价格源用 binance 是否会因为 binance 自家公告引起的"price-impact-from-the-source"产生偏差？（理论上有，但优先级不高）
