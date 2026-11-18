# 原生 turn 的外部 CLI 运行合计

`externalTurnUsage` 是独立的会话投影，依据真实 CLI run 的完整已结算统计。它不制造模型 response，不与原生逐 response 用量相加。普通 DSH 会话没有这个投影，行为保持原生合同。

## 精确归属与持久化

Host 的真实原生 route 同时取得 `position.turn` 和 `run.runId` 后，在原有 `updateRecord` 串行事务中保存：

```ts
turnRuns?: Array<{ turn: number; runId: string }>
```

同 run、同 turn 幂等；同 run 不得跨 turn。存储层拒绝删除或重写已经确认的 pair。一个 turn 可以关联多个不同 run，输出前按 run ID 去重。先登记 stream 的取消所有权，再等待绑定落盘，期间不输出模型块；记录丢失、冲突或落盘失败时停止并等待已启动 run 清理后报错。显示子会话替换不继承旧 child 的 turn 映射；失败回滚可恢复旧 child 自己的映射。旧 Session 日志不改写。

## Gateway 投影

`watch` 只从当前 selected Worker 的精确 parent/worker/child 绑定读取映射，并调用公开 `runtime.runUsage(parentSessionId, workerId, runId)`。输出形状：

```ts
Readonly<Record<string, {
  basis: 'external-run'
  runIds: readonly string[]
  usage: {
    uncachedInputTokens: number
    outputTokens: number
    totalTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reasoningTokens?: number
  }
  label?: string
} | null>>
```

- 完整值要求每个 run 均有已确认 completed/failed/interrupted 终态和可归桶的完整 run receipt。桶转换复用 `shared/native-token-usage.ts`，不自行猜测 cache/input/reasoning 口径。
- 当前 run 仍 busy、明确冲突、来源存在但无效或加总溢出时，该 turn 为 `null`，禁止展示部分合计。
- 缺少完整整 run 统计来源时省略该 turn key，保留原生完整逐 response 统计的回退。缺 key 不代表零，也不从累计 session 统计反推本 turn。
- 不把 response 集合仅凭“看起来齐了”宣称完整 run，不把 session checkpoint 当本 turn，不把外部 run 合计与原生 attempt 用量重复相加。

## 旧记录只读恢复

没有持久映射的旧记录，仅在当前 Worker 空闲、绑定存在 accepted native input 且 Worker 有相应接收回执时，读取官方 `SessionQuery.observeSession(child, { projectionMode: 'none', signal })`。观察引用始终释放，错误或取消不触发 CLI 或 Session 修复。

恢复同时要求：

1. 官方 observation 的 header.id、parentSession 和 subagent 身份匹配当前绑定，忽略继承的旧事件。
2. 连续事件中存在真实 turn/start、step/start、对应 user/message、step/end、turn/end；user/message.source.rpcId 精确等于 accepted input 的 requestId。
3. 完整 accepted batch 的所有成员唯一属于同一实际 turn；未闭合、同 RPC 在多个 turn 出现、状态未确认或缺成员时不恢复。
4. Worker user 事件的 queuedFollowupId 等于 batchId，admittedRunId 等于其 runId，且同 batch 只对应一个已结算 run。
5. 当前已持久化的 turnRuns 优先，恢复结果不能覆盖它，也不能借用其他 child 或 parent 的记录。

只向本次 watch 的内存对象附加映射，不写旧 binding 或 Session。RPC 文本相同、promptHash 相同、时间相近都不能证明归属。异步观察期间 revision 改变时丢弃旧快照并重读当前绑定。

本次针对用户指定旧 Hermes run 的只读检查与纯函数历史重放均恢复到真实 turn 3；具体 ID、seq 与读取前后 SHA-256 在私有 `.test-data/native-turn-usage-hermes-readonly/exact-id-recovery-report.json`，不把这些用户运行记录写入分发内容。实际官方 Gateway 接线使用模拟 observation 验证，没有更新 Desktop。

## 已执行验证

`tests/harness-turn-usage.test.ts` 26 项覆盖 route 幂等/冲突/失败清理、存储不可改写与新 child 隔离、整 turn 统计、多 run 去重、缺来源回退、明确未知 mask、原生桶归一、Gateway 精确绑定、旧记录恢复和读取失败。与原有原生 Host 测试合计 6 文件 79 项通过，Host TypeScript 检查通过。未调用真实模型、未启动真实 CLI 任务、未写用户 Session/配置、未更新 Desktop 或正式构建目录。
