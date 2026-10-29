# Design: 整轮结果按原生终态判定

## 现状

各 runner 都有一个本轮级 `failure`，用 `??=` 只写一次、结束时优先返回 ERROR。工具失败、协议错误、轮次失败共用这一个标记，因而无法区分「工具失败但已恢复」与「轮次失败」。

## 方案

- 每个 runner 拆出独立的工具失败记录：`toolFailures`（数量）与 `lastToolOutcome`（`failed` / `succeeded`，按完成顺序更新；非空 assistant 回复视为其后的成功证据）。工具失败不再写入 `failure`。
- `failure` 只保留：协议/身份不一致、原生轮次非成功终态、缺少终态、未完成工具、非零退出、清理失败、需要交互输入的请求、原生 `error` 且不重试。
- 终态顺序：`failure` → ERROR；否则 `denied` → UNCERTAIN（既有规则）；否则 `lastToolOutcome === 'failed'` → UNCERTAIN（新增，说明「最后的工具步骤失败后 CLI 直接结束」）；否则 SUCCESS。SUCCESS 且 `toolFailures > 0` 时结果说明追加失败步骤数。
- 结果说明：原 SUCCESS 帧不能携带说明（runtime 对 completed 不读 `error`，界面把 `error` 显示为错误）。新增可选 `notice`：`io.result(status, response, error, resultScope, notice)` 仅在 SUCCESS 时写入（≤2000 字符）→ `bridge-protocol.ts` 只对 SUCCESS 解析 → `ProtocolResult.notice` → `Worker.resultNotice`（storage 可选字段，每轮开始重置）→ 时间线诊断「本轮结果说明」与主 Agent 任务结果的 `notice`、guidance。不影响状态。
- 实现：各 runner 共用 `src/host/native-tool-outcomes.mjs`（`failed(id)` 按身份去重、`succeeded()`、`settle(io, response, scope)`）；Pi/OMP 直接读取 `count`/`lastFailed` 输出终态。runtime 的待核实与说明分支改按 `protocol instanceof BridgeProtocol` 判断，Pi/OMP 的 UNCERTAIN 不再当作失败。
- 各 CLI 的「工具失败」信号沿用现有识别（Codex `status/exitCode/success/error`，Claude `is_error`，ACP `status==='failed'`，ZCode `kind:'error'`/`success!==true`/批次 `errorCount`，OpenCode/MiMo `state.status==='error'`，Hermes `tool.failed`，agy `tool_info.error`，Pi/OMP `isError`）。
- ZCode 批次 `errorCount` 与 Codex `turn/completed.items` 回放可能重复报告同一工具，计数按工具身份去重。
- agy：`tool_info.error` 改记工具失败。真实 agy 的失败工具步骤以状态 `ERROR` 结束并带 `tool_info.error`（2026-10-28 实测，类型 `TOOL_ERROR`），此组合是合法终态、不算未完成工具；没有 `tool_info.error` 的 `ERROR` 状态仍为本轮失败。`tool_info.error` 改设 `invalidStep`，继续阻止续聊汇总冲突转为结果待核实，保持 worker-run-outcomes「AGY 续聊汇总冲突终态」不变。
- 未完成工具：Codex 条目以 `inProgress` 收尾、OpenCode/MiMo 工具状态既非 completed 也非 error 时，记为本轮失败。Pi/OMP 不在本变更新增此检查。
- Claude Code：授权拒绝带 `interrupt:true` 仍为失败（不变）；仅工具 `is_error` 不再锁死 ERROR。

## 兼容性

- 持久化 Worker 字段不变；历史 failed 记录不重算。
- 宿主 job 对 uncertain 仍保守映射为 failed 并附核查提示（既有规则）。
- 与 `report-denied-permission-as-unverified` 的冲突：其增量要求「其他工具失败 MUST 仍为失败」。实施前用 openspec-update-change 改为「其他轮次失败……」，否则两份增量归档后主规格自相矛盾。

## 风险与回退

- 风险：CLI 未恢复却报告 completed，被判为成功。缓解：最后一步失败 → UNCERTAIN；SUCCESS 附失败步骤数；不采信完成自述，主 Agent 仍应核查产物。
- 回退：恢复 `failure ??=` 的工具分支即可，无存储迁移。
