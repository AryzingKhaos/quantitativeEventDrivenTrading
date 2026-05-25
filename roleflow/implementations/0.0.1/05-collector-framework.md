# Step 05 - Collector Framework

## 目标

建立统一的采集器接口和公共抓取流程，为后续各来源实现提供一致入口。

## 任务

1. 定义 collector 统一接口
2. 定义返回结构
3. 定义请求超时和错误包装逻辑
4. 实现公共 HTTP 请求封装
5. 实现 collector 调度服务

## collector 输出至少应包含

- `sourceKey`
- `title`
- `summary`
- `content`
- `url`
- `publishedAt`
- `rawPayload`

## 完成标准

- 所有 collector 都能按统一接口返回数据
- 单个 collector 失败不会破坏整体结构

## 注意点

- 第一版优先简单串行抓取
- 不提前实现复杂并发控制
