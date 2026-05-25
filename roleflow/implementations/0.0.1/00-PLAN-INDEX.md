# v0.0.1 Plan Index

本目录下的计划文档按执行顺序拆分为多个技术步骤。

建议严格按编号顺序推进，每一步完成后再进入下一步。

## 计划列表

1. [01-project-bootstrap.md](/Users/aaron/code/quantitativeEventDrivenTrading/roleflow/implementations/0.0.1/01-project-bootstrap.md)
   初始化 Node.js + TypeScript 项目骨架，建立基础目录和运行入口。
2. [02-database-schema-and-migrations.md](/Users/aaron/code/quantitativeEventDrivenTrading/roleflow/implementations/0.0.1/02-database-schema-and-migrations.md)
   建立 `events` 和 `notifications` 表结构、约束、索引和迁移。
3. [03-env-and-runtime-config.md](/Users/aaron/code/quantitativeEventDrivenTrading/roleflow/implementations/0.0.1/03-env-and-runtime-config.md)
   建立环境变量读取、运行参数和数据源配置。
4. [04-domain-types-and-utils.md](/Users/aaron/code/quantitativeEventDrivenTrading/roleflow/implementations/0.0.1/04-domain-types-and-utils.md)
   定义核心类型和基础工具函数。
5. [05-collector-framework.md](/Users/aaron/code/quantitativeEventDrivenTrading/roleflow/implementations/0.0.1/05-collector-framework.md)
   建立统一抓取接口、抓取结果模型和公共抓取流程。
6. [06-exchange-collectors.md](/Users/aaron/code/quantitativeEventDrivenTrading/roleflow/implementations/0.0.1/06-exchange-collectors.md)
   实现 5 个交易所公告采集器。
7. [07-panews-collector.md](/Users/aaron/code/quantitativeEventDrivenTrading/roleflow/implementations/0.0.1/07-panews-collector.md)
   实现 PANews 新闻采集器。
8. [08-normalization-dedup-and-persistence.md](/Users/aaron/code/quantitativeEventDrivenTrading/roleflow/implementations/0.0.1/08-normalization-dedup-and-persistence.md)
   标准化事件、生成指纹、查重并入库。
9. [09-scoring-and-rule-engine.md](/Users/aaron/code/quantitativeEventDrivenTrading/roleflow/implementations/0.0.1/09-scoring-and-rule-engine.md)
   实现关键词评分、阈值判断和规则命中记录。
10. [10-telegram-delivery-and-alerting.md](/Users/aaron/code/quantitativeEventDrivenTrading/roleflow/implementations/0.0.1/10-telegram-delivery-and-alerting.md)
    实现 Telegram 正式推送和失败告警。
11. [11-scheduler-retries-and-first-run.md](/Users/aaron/code/quantitativeEventDrivenTrading/roleflow/implementations/0.0.1/11-scheduler-retries-and-first-run.md)
    实现调度、单源重试和首次启动历史候选逻辑。
12. [12-logging-and-manual-verification.md](/Users/aaron/code/quantitativeEventDrivenTrading/roleflow/implementations/0.0.1/12-logging-and-manual-verification.md)
    补齐日志、手工验证流程和上线前检查项。

## 执行原则

- 每一步都应有可验证产物。
- 每一步优先做最小可运行版本，不提前扩展。
- 如果某一步依赖外部站点结构，先做最小探测与样例验证，再补完整逻辑。
- 不把后续步骤的逻辑提前塞进前一步，避免实现过重。

## 建议里程碑

- 完成 `01` 到 `04`：项目可以启动，基础类型和配置可用。
- 完成 `05` 到 `08`：项目可以抓取、标准化、查重、入库。
- 完成 `09` 到 `11`：项目可以筛选、推送、调度、重试。
- 完成 `12`：项目达到第一版可人工值守运行状态。
