# Step 10 - Telegram Delivery And Alerting

## 目标

实现 Telegram 正式消息推送和抓取失败告警。

## 任务

1. 封装 Telegram Bot API 调用
2. 实现正式消息模板
3. 实现失败告警模板
4. 推送成功后写入 `notifications`
5. 推送失败时记录错误

## 正式消息模板

- 标题
- 摘要
- 时间

## 告警消息包含

- 数据源名称
- 请求时间
- 重试次数
- 错误摘要

## 完成标准

- 命中规则的事件可发送到指定 `chat_id`
- 失败告警可发送到同一个 `chat_id`
- `notifications` 有完整记录

## 注意点

- 时间展示统一为北京时间
- `published_at` 为空时回退到 `fetched_at`
