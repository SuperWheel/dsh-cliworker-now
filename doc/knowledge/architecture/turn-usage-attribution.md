# 逐轮用量依靠精确执行归属

结论：消息尾部的“本轮用量”必须关联真实原生 turn 与已结算 CLI run，不能拿累计统计、包装模型用量或相近时间替代。

## 机制

原生 route 同时取得 `position.turn` 与 `runId` 后，将 `{ turn, runId }` 存进绑定记录 `turnRuns`。同 pair 幂等，同 run 跨 turn 拒绝；确认后的映射不能删除或改写。一个 turn 可包含多个 run，按 run ID 去重。

`projectExternalTurnUsage` 仅对匹配 parent/Worker/child 的当前绑定输出 `externalTurnUsage`，再由原生用量组件展示。Token 桶复用原生口径转换；当前 Qoder 单独汇总精确积分。模型来源使用已确认的 run 事件 `displayRoutes`，与内部执行 provider 分开。

## 易错边界

缺 key 允许保留完整原生逐响应回执；`null` 表达明确不可用，阻止退回包装用量。多 run 合计必须全部满足终态及完整口径，不显示看似完整的部分总量。旧记录只读恢复要求官方会话事件闭环、原始 RPC ID、batch 与 Worker 接收回执同时匹配；prompt 相同不足以恢复归属。

## 源码与验证入口

- [归属与投影](../../../src/host/harness-turn-usage.ts)：`bindHarnessTurnRun`、`recoverHarnessTurnRuns`、`projectExternalTurnUsage`；[共享合同](../../../src/shared/native-turn-usage.ts)。
- [存储不可改写约束](../../../src/host/harness-conversation-store.ts) · [逐轮用量回归](../../../tests/harness-turn-usage.test.ts)。
- [详细归属规则](../../protocols/native-turn-usage.md)；该文部分示例早于积分扩展，现行类型以源码为准。

关联：[三类身份](session-identities.md) · [遥测口径](telemetry-semantics.md) · [返回分类索引](README.md)
