# Step 03 - Env And Runtime Config

## 目标

建立统一的环境变量读取、运行时配置和数据源配置。

## 任务

1. 定义环境变量清单
2. 实现环境变量读取与校验
3. 建立 Telegram 配置读取
4. 建立数据库配置读取
5. 建立 `sources.ts`
6. 建立 `rules.ts`

## 最少环境变量

- `DATABASE_URL`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

## sources.ts 需要包含

- `source_key`
- `enabled`
- `pollIntervalSec`
- `baseUrl`
- `type`

## rules.ts 需要包含

- `name`
- `enabled`
- `sources`
- `threshold`
- `excludeKeywords`
- `keywords`

## 完成标准

- 缺失关键环境变量时程序能明确报错
- 数据源与规则配置可被业务层直接读取

## 注意点

- 第一版规则和数据源都不入库
- 配置结构尽量保持静态和简单
