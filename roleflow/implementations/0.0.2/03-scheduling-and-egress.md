# 03 调度与出口 IP

## 问题

`src/jobs/poll.job.ts:99-111` 当前调度：

```ts
const offsetSec = (index * 7) % 60;
const expression = toCronExpression(source.pollIntervalSec, offsetSec);
return cron.schedule(expression, async () => { await this.runSource(source); });
```

特征：

- 偏移量是 source 索引的固定函数，每个 source 永远在同一秒开始
- cron 周期固定（如每 3 分钟），意味着请求精确落在每分钟的某个固定秒数
- 全局没有跨 source 的并发限制（cron 同时触发就同时打）

加上单一出口 IP（通常是用户笔记本/家庭宽带），对于 Binance / Bybit / Cloudflare 等风控敏感站点：**周期性、规整、来自同一 ASN 的请求 = 典型机器人画像**。

## 目标

调度上：

- 把"按 cron 周期触发"改为"完成一轮后随机延迟到下一轮"（self-rescheduling）
- 单 source 的请求间加 200-1500ms 抖动
- 单 source 的下一轮间隔 = 配置周期 × (0.85 ~ 1.20)（即 ±15-20% 抖动）

出口上：

- 支持可选 HTTP / SOCKS5 代理
- 文档化"国内笔记本 → 境外 VPS"的迁移路径
- 不强制代理，但**强烈建议**

## 涉及文件

- 改：`src/jobs/poll.job.ts`（调度逻辑重写）
- 改：`src/config/env.ts`（加代理相关变量）
- 改：`src/collectors/fetcher.ts`（支持 proxy agent）
- 新：`docs/deployment-vps.md`（VPS 部署 howto）

## 设计要点

### Self-rescheduling 调度

不再用 `cron.schedule`，而是每个 source 独立的循环：

```ts
async function runForever(source: SourceConfig) {
  while (!stopped) {
    await runSource(source);
    const baseMs = source.pollIntervalSec * 1000;
    const jitter = 0.85 + Math.random() * 0.35; // 0.85 ~ 1.20
    const nextMs = Math.round(baseMs * jitter);
    await sleep(nextMs);
  }
}

for (const source of enabledSources) {
  void runForever(source); // 各自独立的 promise loop
}
```

好处：

- 上一轮跑长跑短不影响下一轮（之前 cron 触发时如果上一轮没完，cooldown 逻辑会跳过这次）
- 节奏天然不可预测
- 失败重试触发的 cooldown 也更顺

### 请求间抖动

`shared.ts` 在循环抓 detail 时加 jitter：

```ts
for (const candidate of candidates) {
  const detail = await fetcher.fetchText(candidate.url, { referer: options.listUrl });
  // ... process ...
  await sleep(200 + Math.random() * 1300);
}
```

Binance API 路径已有 `BINANCE_DETAIL_BATCH_DELAY_MS = 250`（`binance.ts:45`），把这个值也加 jitter。

### Proxy 支持

通过 `undici` 或 `https-proxy-agent` + `socks-proxy-agent`：

```ts
const proxyUrl = process.env.HTTP_PROXY ?? process.env.HTTPS_PROXY;
const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

const response = await fetch(url, { dispatcher, headers, ... });
```

支持 per-source 代理（`source.proxy` 字段），便于：

- Binance / Bybit 走境外代理
- PANews / 国内站点直连

### VPS 迁移

更彻底的方案是把整个服务跑在境外便宜 VPS（Vultr / Hetzner / Lightsail，5-10 USD/月），那就不用代理。新建 `docs/deployment-vps.md`：

- pm2 / systemd unit
- pg 用 RDS 或本地都可以
- 日志收集（loki / 简单 logrotate）
- Telegram bot 仍然能正常用

## 灰度策略

- `SCHEDULER_V2=true` 开关；false 时回退到 cron
- 抖动比例可调（环境变量 `POLL_JITTER_RATIO=0.20`）

## 验收标准

- 调度切换后 30 天内观察：
  - 单 source 平均成功率不下降
  - 30 分钟 cooldown 触发次数下降
  - 每个 source 的请求时间戳分布无明显规律（用脚本看分布）

## 开放问题

- 是否决定迁 VPS？这个决策影响代理实现复杂度
- 各 source 是否都要走境外出口？panews 走境外可能反而被 cf 拦
- 调度从 node-cron 切到自循环后，进程退出/平滑重启的处理（SIGTERM 收到后等当前轮结束）
