# 01 打分模型重定义：从"关键词相关"到"预期交易冲击"

## 问题

现在 `src/services/filter.service.ts` 的 `score` 是关键词加权，它衡量"撞了几个词"，不是"会让价格动多少"：

- **price-in 问题**：被市场预期过的事件（预告过的降准、排期内的解锁）关键词分很高，实际冲击≈0。
- **方向缺失**：利好和利空可能撞同样的词，同分。
- **跨市场不可比**：crypto 的"上线"和 A股 的"立案"无法用同一套权重表达。
- 0.0.2 复盘已确认：关键词分高度依赖文本长度/位置，且 panews 因体量大而主导——这些都说明"关键词分 ≠ 重要性"。

## 目标

确立新的打分语义，并把关键词层摆到正确位置：

- **最终决定推不推、排序的分 = LLM 估计的预期交易冲击**（在 `02` 产出，本步只搭框架）。
- **关键词层降级为"召回初筛"**：threshold 再降，只回答"这条值不值得花钱过 LLM"，召回优先（宁滥勿缺）。
- 规则集按 `market` 拆分（crypto / ashare 各一套），互不污染。

## 涉及文件

- 改：`src/config/rules.ts`（规则按 `market` 分组；threshold 进一步下调为召回阈值；A股 规则在 `04` 填充）
- 改：`src/services/filter.service.ts`（`evaluate` 语义明确为 `recall`：输出 `{ recalled: boolean, recallScore, market, matchedKeywords }`，不再宣称是"最终重要性"）
- 改：`src/types/rule.ts`（`Rule` 增加 `market: 'crypto' | 'ashare'` 字段）
- 改：`src/types/event.ts`（`ScoreResult` → 语义改名/补充，区分"召回分"与后续"冲击分"）
- 改：`src/jobs/poll.job.ts`（把 `filterService.evaluate` 的结果当"是否进 LLM"的门，而非"是否推送"的门——推送门移到 `02` 之后）

## 设计要点

### 关键词层只做召回

```ts
// filter.service 输出语义升级
interface RecallResult {
  recalled: boolean;        // 是否值得过 LLM
  recallScore: number;      // 仅用于成本排序 / triage 优先级，不是最终分
  market: 'crypto' | 'ashare';
  matchedRule: string | null;
  matchedKeywords: string[];
  excludedBy: string | null;
}
```

- `recalled = recallScore >= rule.threshold`，但 threshold 调到很低（召回优先）。
- `excludeKeywords` 思路收缩：**只保留"100% 是垃圾"的词**（抽奖 / 教程 / 周报）。一切"可能重要也可能不重要"的语义判断，交给 `02` 的 LLM，不再靠堆排除词。
- 沿用 0.0.2 收尾修的 `includesExcludeKeyword`（ASCII 词边界匹配）与按源 content 截断。

### 规则按 market 拆分

`rules.ts` 现有三条规则（exchange / panews / ai-industry）归到 `market: 'crypto'`。`04` 再加 `market: 'ashare'` 的规则（立案 / 重组 / 业绩预告…）。`filter.service` 按事件 source 所属 market 选规则集，并把 `market` 透传给 `02` 的 prompt 选择。

### 推送门后移

当前 `poll.job` 在 `scoreResult.matched` 处既决定"进不进后续"又间接决定"推不推"。本步把它改成：**`recalled` 只决定进不进 LLM**；推不推由 `02` 的 `impact` + `05` 的路由决定。

## 灰度策略

- 关键词阈值调整后，用 `npx tsx src/analyze-passrate.ts --days=14` 复跑，确认**召回率**（真信号被召回比例）足够高、且 LLM 入口量在预算内。
- 本步可在 `LLM_REFINEMENT_ENABLED=false` 下先合入（关键词层照旧推送），等 `02` 就绪再切。

## 验收标准

- 真信号召回率 ≥ 95%（人工抽查近两周明显该推的事件，被关键词层放行的比例）。
- 进入 LLM 的日候选量落在 `02` 估算的成本预算内。
- crypto / ashare 规则集物理隔离，互不命中。

## 开放问题

- `events.score` 列：继续存"召回分"还是干脆存 `02` 的最终 `impact`？建议存 `impact`，召回分只存 `triage`（见 `02`）。
- threshold 调到多低算合适——需用 `analyze-passrate` 实测召回/成本曲线后定。
