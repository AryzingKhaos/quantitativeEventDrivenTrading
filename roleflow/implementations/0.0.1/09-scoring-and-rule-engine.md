# Step 09 - Scoring And Rule Engine

## 目标

实现第一版关键词评分与阈值判断。

## 任务

1. 加载 `rules.ts`
2. 按 `source_key` 过滤适用规则
3. 检查 `excludeKeywords`
4. 计算关键词分数
5. 生成 `matched`、`matched_rule`、`score`
6. 将评分结果回写到 `events`

## 评分规则

- 标题、摘要、正文都参与匹配
- 同一关键词在同一条事件中只计分一次
- 命中排除词则直接不推送
- `score >= threshold` 则 `matched = true`
- `score` 允许负数

## 完成标准

- 同一事件能得到稳定分数
- 阈值判断逻辑清晰可复现

## 注意点

- 第一版不做正则
- 第一版不做多字段不同权重
- 第一版不做多规则二次计算
