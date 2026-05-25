# Step 02 - Database Schema And Migrations

## 目标

建立 `events` 和 `notifications` 两张表，以及第一版所需约束和索引。

## 任务

1. 选择 ORM 或迁移工具
2. 建立数据库连接模块
3. 定义 `events` 表
4. 定义 `notifications` 表
5. 添加唯一约束、索引、外键
6. 生成初始化迁移

## 重点字段

`events`：

- `id`
- `source_key`
- `title`
- `summary`
- `content`
- `url`
- `published_at`
- `fetched_at`
- `fingerprint`
- `raw_payload`
- `matched`
- `matched_rule`
- `score`
- `created_at`

`notifications`：

- `id`
- `event_id`
- `target`
- `status`
- `error_message`
- `sent_at`
- `created_at`

## 约束建议

- `events.fingerprint` 唯一
- `notifications.event_id -> events.id` 外键
- `notifications(event_id, target)` 唯一
- `score` 默认 `0`
- `matched` 默认 `false`
- 时间字段支持 UTC 存储

## 完成标准

- 可成功执行迁移
- 两张表结构与设计文档一致
- 索引和约束已创建

## 注意点

- `score` 允许负数
- `url` 不做唯一约束
- 标题变化视为新事件
