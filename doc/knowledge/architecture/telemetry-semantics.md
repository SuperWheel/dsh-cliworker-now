# 账单用量与上下文占用分开计算

结论：账单统计描述已发生的调用消耗，上下文描述当前窗口；积分是独立计费单位，不能与 Token 数互相推算。

## 机制

`TokenUsage.scope` 明确区分 `response`、`run`、`session` 和原生报告范围；累计快照不能反复相加。上下文单独保存 `contextUsed`、`contextCapacity`、`contextRatio` 及来源和估算标记，绑定精确 CLI 会话与模型。

当前 Qoder 的真实请求积分沿 `providerCredits` 和 `usageUnit: 'credits'` 进入当前运行统计及逐轮视图，文案使用“积分用量”；不能由此推得整段 CLI 会话的累计积分。它的隐藏或含糊全零 Token 计数不成为免费调用证明；未公开的 Token 保留未公开状态。仅有原生上下文比例时直接保留比例，不编造分子和容量。

## 易错边界

明确原生零、缺字段和估算值是三种状态。分类不足不通过相减、均分或补零凑成系统/工具/消息三桶；估算显示估算标记。恢复启动占位零不得抹掉同会话上次有效数据，真实零和明确未知仍可更新。不同 CLI 对缓存、总量和推理计数口径各异，归一化必须有原生依据。

## 源码与验证入口

- [共享统计合同](../../../src/shared/telemetry.ts)：`TokenUsage`、`Telemetry`、`ContextTelemetryCheckpoint`；[上下文快照](../../../src/host/context-telemetry.ts)：`withContextTelemetry`；[累计快照](../../../src/host/conversation-telemetry.ts)。
- [上下文回归](../../../tests/context-telemetry.test.ts) · [累计回归](../../../tests/conversation-telemetry.test.ts) · [CLI 统计审计](../../../tests/cli-telemetry-audit.test.ts)。
- [逐 CLI 原生数据范围](../../audits/cli-native-data-audit.md)。

关联：[逐轮归属](turn-usage-attribution.md) · [公开过程](public-process.md) · [返回分类索引](README.md)
