# Manual Verification

## 启动前准备

1. 复制 `.env.example` 到 `.env` 并填入真实的 `DATABASE_URL`、`TELEGRAM_BOT_TOKEN`、`TELEGRAM_CHAT_ID`。
2. 安装依赖：`npm install`
3. 执行迁移：`npm run migrate`

## 最小验证顺序

1. 验证数据库连接  
   运行 `npm run migrate`，确认 `events` 和 `notifications` 表成功创建。
2. 验证单源抓取  
   运行 `npx tsx src/index.ts --once --source=okx`，观察日志中的 `fetchedCount`、`insertedCount`、`matchedCount`。
3. 验证去重  
   连续执行两次同一命令，第二次应主要增加 `duplicateCount`。
4. 验证评分  
   检查 `events.score`、`events.matched`、`events.matched_rule` 是否按规则写回。
5. 验证 Telegram 推送  
   选一个容易命中的来源执行一次，确认 Telegram 收到消息且 `notifications.status = 'success'`。
6. 验证重试与告警  
   临时把某个 `listUrl` 改成无效地址，执行 `--once`，确认日志出现三次重试且 Telegram 收到失败告警。

## 运行方式

- 常驻模式：`npm run dev`
- 单次轮询：`npm run once`
- 指定来源单次轮询：`npx tsx src/index.ts --once --source=panews`

## 上线前检查清单

- PostgreSQL 可写，`DATABASE_URL` 指向生产库。
- Telegram 机器人已加入目标群组或频道。
- 6 个数据源都至少成功抓到最近数据。
- 首次启动只推送高分前 10 条历史候选，没有刷屏。
- 普通轮询会写入结构化日志，可据此定位某个来源是否失效。
