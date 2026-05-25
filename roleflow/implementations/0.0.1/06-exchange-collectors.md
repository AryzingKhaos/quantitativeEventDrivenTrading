# Step 06 - Exchange Collectors

## 目标

实现 5 个交易所公告采集器。

## 范围

- Binance
- OKX
- Bybit
- Coinbase
- Bitget

## 任务

1. 逐个确认是否存在官方 API
2. 对每个来源优先实现中文接口或中文页面抓取
3. 提取标题、摘要、正文、链接、发布时间
4. 保留原始响应到 `rawPayload`
5. 对每个来源做最小样例验证

## 实现顺序建议

1. Binance
2. OKX
3. Bybit
4. Coinbase
5. Bitget

## 完成标准

- 每个来源至少能稳定抓到最近若干条公告
- 结果字段能对齐 collector 统一结构

## 注意点

- 页面抓取逻辑要尽量抗轻微结构变化
- 如果某个来源字段缺失，先保证标题和链接可用
