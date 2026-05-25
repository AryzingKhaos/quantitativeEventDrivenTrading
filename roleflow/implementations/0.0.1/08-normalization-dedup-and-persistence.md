# Step 08 - Normalization, Dedup And Persistence

## 目标

把各采集器输出统一成内部事件，并完成查重和持久化。

## 任务

1. 将 collector 输出映射为内部事件结构
2. 生成 `fingerprint`
3. 查询 `events` 是否已存在
4. 若不存在则写入 `events`
5. 保留原始载荷
6. 统一处理 `summary` 兜底逻辑

## summary 规则

- 有摘要则直接使用
- 无摘要则从正文截取前一段
- 无正文则允许为空

## 完成标准

- 不同来源输出都能统一写入 `events`
- 重复事件不会重复入库

## 注意点

- 标题变化视为新事件
- 只做最小查重，不做复杂“内容相似度”合并
