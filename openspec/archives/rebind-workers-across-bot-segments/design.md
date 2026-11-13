# Design

## 方案取舍

| 方案 | 结论 |
| --- | --- |
| 放宽校验：同链即放行，不改归属 | 不采用。旧段被 `archiveSession(stopActivity: true)` 归档停活，显示子会话仍挂在旧父会话上，消息发不出去（Issue 原文与 DS Bot 源码一致） |
| 每个入口单独判断“同链也算本会话” | 不采用。`parentSessionId` 的严格比较散布在 runtime、显示桥、绑定存储与 index 的十余处，逐处放宽容易漏，且会让同一 Worker 同时属于多个父会话 |
| **调用时改写归属（采用）** | 父会话 P 进入 Worker 入口时，先把同链旧段上的空闲 Worker 改到 P；之后所有严格比较照旧成立。显示桥只在一处（`ensure`）增加受控的换父替换 |
| 等宿主提供段链 | 当前没有接口；读取器做成可替换的接口，将来改接宿主即可 |

## 模块边界

- `src/host/parent-lineage.ts`（新）：`ParentLineage` 接口 `formerSegments(parent): ReadonlySet<string> | undefined`，返回“P 为当前段时同链的其他段”；`DsBotLineage` 实现：`statSync` 取 mtime 与大小作为缓存键，变化时才读文件；超过 64 MiB、解析失败、`version !== 1`、ID 非 1–256 字符的字符串时返回空。同一 ID 出现在两条及以上链时，这些链全部丢弃。读取失败不抛出、不打印文件内容。
- `src/host/runtime.ts`：`useParentLineage(lineage)` 注入；私有 `adoptSegments(parent)` 在 `get`、`resolveWorker`、`snapshot`、`restoreWorker`、`checkAgentName` 开头调用。改写条件：Worker 父会话 ∈ `formerSegments(parent)`、不在 `stagedForks`、`busyReason(worker)` 为空。改写后 `storage.save`，并同步内存对象，调用 `changed()`。
- `src/host/harness-conversation.ts` `ensure`：已有记录父会话 ≠ P 时，若 `worker.parentSessionId === P` 且 `worker.formerParentSessionIds` 含记录的父会话，则 `create(parent, worker, options, existing)` 走既有替换流程（`replacements` → `prepareContinuable` → `deps.replaceBinding` → `records.delete(previous)`）；否则仍抛「原生会话父身份不匹配」。替换失败的回滚沿用原逻辑。
- `src/host/harness-conversation-store.ts` `replace`：新记录父会话与旧记录不同时，要求调用方显式声明 `reparent: true`；其余历史引用校验不变。
- `src/host/index.ts` `replaceBinding`：按 Worker ID 取 Worker，要求其当前父会话等于新记录或旧记录的父会话之一、另一个在 `formerParentSessionIds` 中；同父替换仍走原路径。提交后把 `worker.harnessConversation` 的 `sessionId` 与 `parentSessionId` 都改为新值。

## 为什么不改运行中的 Worker

运行中的 Worker 有进行中的显示投影、审批转交与停止路径，都以当时的父会话为准。中途改写会让审批落到已归档的父会话或丢失停止确认。等它空闲后再改写，代价只是新段在本轮结束前看不到它。

## 兼容性与存储

- `Worker.formerParentSessionIds` 为可选字段，zod 中 `.optional().catch(undefined)`，旧数据与降级读取都兼容。降级到旧版本时，新字段被忽略，Worker 归属保持重绑后的父会话。
- 显示记录格式不变；换父只改变 `parentSessionId` 与 `retiredSessionIds`。
- 不写、不锁 DS Bot 文件；DS Bot 整份重写 `state.json` 时，读取器按新的 mtime 重新解析。

## 风险与回退

- DS Bot 状态格式是第三方私有数据，可能变化：任何不符都按没有段链处理，回到 v0.8.8 行为。
- 误判会让一个会话操作另一个会话的 Worker：只承认“P 是链的当前段 + Worker 原父会话在同链”，并排除多链重复 ID；测试覆盖非同链拒绝。
- 回退：去掉 `useParentLineage` 注入即恢复旧行为；已重绑的 Worker 保持新归属。
