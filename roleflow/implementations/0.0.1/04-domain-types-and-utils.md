# Step 04 - Domain Types And Utils

## 目标

建立领域模型类型和基础工具，减少后续实现重复。

## 任务

1. 定义 `SourceConfig` 类型
2. 定义 `CollectorItem` 类型
3. 定义标准化后的 `Event` 类型
4. 定义 `Rule` 类型
5. 实现 `fingerprint` 工具
6. 实现文本清洗工具
7. 实现时间格式化工具
8. 实现基础 logger

## 重点工具

- `fingerprint.ts`
  基于 `source_key + url + normalized title` 生成哈希
- `text.ts`
  去空格、清理换行、截断摘要
- `time.ts`
  UTC 存储和北京时间展示转换
- `logger.ts`
  输出结构化日志

## 完成标准

- 后续模块不再需要重复定义核心类型
- 指纹生成规则固定
- 时间转换规则固定

## 注意点

- 文本清洗不要过度改写原意
- 标题清洗要稳定，否则会影响去重结果
