# 05 跨源聚类与 Digest 简报

## 问题

两个相关但独立的痛点：

**问题 A——同一事件多源重复推送**：
- Binance 公告"下架 X" + PANews 报道"Binance 下架 X" 都会命中并推送
- 当前 fingerprint（`src/utils/fingerprint.ts`）是 `source_key + url + title` 的 hash，跨源完全失效
- 用户体验：同一件事被告知 2-3 次

**问题 B——次要事件也实时推**：
- 04 步引入 importance 后，importance=4 的事件如果直接推会打扰；如果直接丢又可惜
- 中间地带的事件需要"批处理"

## 目标

- 跨源去重：同一事件多源报道时合并为一条推送
- Digest 模式：importance < critical 阈值但 >= digest 阈值的事件，攒到每日早 8 点 LLM 写一份 5-10 条简报推一次

## 涉及文件

- 新：`src/services/cluster.service.ts`（事件聚类）
- 新：`src/services/digest.service.ts`（每日简报生成）
- 新：`src/jobs/digest.job.ts`（cron 任务）
- 新：`src/db/migrations/xxxx_clustering.sql`（events 加 cluster_id）
- 改：`src/jobs/poll.job.ts`（在 refine 后插入 cluster 步骤）

## 数据库变更

```sql
ALTER TABLE events
  ADD COLUMN cluster_id BIGINT,
  ADD COLUMN cluster_role TEXT;          -- 'primary' | 'secondary'

CREATE INDEX events_cluster_idx ON events(cluster_id) WHERE cluster_id IS NOT NULL;

CREATE TABLE event_clusters (
  id BIGSERIAL PRIMARY KEY,
  representative_event_id BIGINT NOT NULL REFERENCES events(id),
  topic_summary TEXT,                    -- LLM 给的聚合后标题
  member_count INT NOT NULL DEFAULT 1,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  notified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX event_clusters_recent_idx ON event_clusters(last_seen_at DESC);
```

## 聚类算法（轻量版）

不上向量库。两步走：

### 步骤 1：候选筛选（快）

新事件入库后，找过去 24 小时内的"候选 cluster"：

- `affected_assets` 至少有一个交集
- `category` 相同 或 都是 `null`

```sql
SELECT id, title, summary, refined_at, cluster_id, affected_assets, category
FROM events
WHERE refined_at > NOW() - INTERVAL '24 hours'
  AND affected_assets && $newAssets
  AND (category = $newCategory OR category IS NULL OR $newCategory IS NULL)
ORDER BY refined_at DESC
LIMIT 50;
```

### 步骤 2：LLM 判同（准）

把新事件 + 候选 cluster 各自的代表事件（最多 5 个）一次性扔给 `deepseek-chat`：

```
判断"新事件"和这些候选事件中是否描述同一件事。
新事件：{title} | {tldr}
候选：
1. {id=123} {title} | {tldr}
2. {id=456} {title} | {tldr}
...

输出 JSON：
{
  "matched_cluster_id": <数字或 null>,
  "is_new_topic": true|false,
  "merged_topic_summary": "如果合并，新的统一一句话标题"
}
```

匹配则归入已有 cluster，否则建新 cluster。

### 第一条 vs 后续条目的处理

- cluster 第一条事件：按 04 的路由策略（critical 推 / digest 待定 / silent 丢）
- cluster 后续条目：默认不再推送，但更新 `event_clusters.last_seen_at` 和 `member_count`
- 例外：如果新条目的 importance > 已推送条目 +2，触发"补充推送"，告知"事件升级"

## Digest 简报

### Cron

每天早 8 点（北京时间）触发 `digest.job.ts`，参数：

- 时间范围：过去 24 小时
- 候选：`importance >= DIGEST_MIN_IMPORTANCE` 且未被 critical 推送过
- 按 cluster 去重（每个 cluster 只取代表事件）

### LLM 写 digest

把候选事件列表（精简字段：`id / category / affected_assets / importance / tldr`）扔给 `deepseek-reasoner`（R1，这一步值得用更强的推理模型；如想省成本退回 `deepseek-chat` 也能跑）：

```
基于以下 24 小时事件列表，写一份给加密货币投资者的简报。

要求：
- 总长度 <= 600 字
- 按主题分组（监管 / 上下币 / 安全 / 宏观 / ...）
- 每条 1-2 句话
- 突出对 watchlist 的影响：{watchlist}
- 末尾给 1-2 句"今日最值得关注的"

事件列表：
{events_json}
```

输出直接发 Telegram，每条事件保留链接（用 markdown 链接格式）。

### Digest 推送格式

```
【每日简报 · {date}】

🔴 监管
- {tldr1} [{source}]({url})
- {tldr2} [{source}]({url})

🟢 上下币
- ...

🟡 宏观
- ...

⭐ 今日重点
{closing_paragraph}
```

（注意：用户偏好 no emoji 是默认；这里可以用纯文本符号代替，如 [监管] [上下币] [宏观]）

## 涉及文件细节

```
src/services/cluster.service.ts
  - findCandidates(event): Cluster[]
  - matchOrCreate(event, candidates): Promise<{ clusterId, role, isNew }>

src/services/digest.service.ts
  - selectCandidates(window): Promise<Event[]>
  - composeDigest(events): Promise<string>

src/jobs/digest.job.ts
  - 注册 cron（用 node-cron）
  - 调用 digest.service
  - 用 notify.service 发送
```

## 灰度策略

- `CLUSTERING_ENABLED=false` 默认关
- 关闭时跳过聚类，按 04 策略直推
- `DIGEST_ENABLED=false` 默认关；打开前先看 1 周"如果开了 digest 哪些事件会被攒"

## 验收标准

- 聚类：随机抽 30 个 cluster 人工核对，正确率 >= 85%
- digest：连续 7 天的 digest 主观评估"信息有用"，且每天阅读时间 <= 3 分钟
- 重复推送（同一主题 24 小时内）下降 90%+

## 开放问题

- cluster_id 跨天合并的处理（一个事件持续发酵 3 天怎么办）
- digest 是否同时归档为 markdown 文件？以后可以喂给"周末复盘"
- 聚类用 LLM 调用成本——一天 200 条事件 × 候选 5 条 ≈ 200 次 `deepseek-chat` call ≈ $0.1/天，可接受
- 是否要 embedding？目前判断是不需要，因为候选筛选已经足够精；如果 LLM 召回率不够再上
