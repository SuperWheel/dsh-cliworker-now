# Design: DSH 备选工具的授权请求按轮次来源询问

## DSH 侧事实（0.2.1-rc.3 包源码核实）

- `dsh-user-approval` 的 `request()` 先检查会话策略：策略为 `never` 时直接返回 `rejected`。策略为 `ask` 时，以 `scopeTarget(agent, agent)` 发出 `approval/request` waterfall，由 `ctx.waterfall` 依次调用已注册的应答者，没有应答者时为 `unavailable`。服务会在请求方会话里写入 `approval/asked` 和 `approval/decided` 审计事件，并与请求的 `signal` 赛跑：中止时结果为 `cancelled`。
- cordis 的 waterfall 从外层往内执行，以 `prepend` 注册的监听器最先运行；监听器调用 `next()` 即交给下一个。没有限定 Agent 作用域的监听器会收到所有 Agent 的请求。
- `dsh-api-remotes` 在客户端连上 Gateway 时用普通 `ctx.on` 注册转发监听器，排在末尾，把请求转给持有该会话的客户端。客户端不持有该会话时，请求继续向下传，最终为 `unavailable`。ACP 的监听器只处理 ACP 自己的 Agent。
- DSH 命令工具提权时发出的请求包括：`toolName`（例如 `bash`）、`callId`（即工具调用 ID）、`reason`（`escalate sandbox to <mode>: <justification>`），以及 `displayReason.zh`（`允许本次操作使用 <mode> 权限：<justification>`）。请求里不含命令本身。

## 方案

在 Host 构造时调用 `ctx.on('approval/request', listener, true)` 注册监听器。它由插件 fiber 持有，插件卸载时自动移除。

1. **登记工具桥调用**。工具桥的 `execute` 在调用 `child.ctx.tools.execute` 之前，把 `cliworker:<callId>` 登记到 `bridgeCalls`，记录 Worker、本轮 runId、子 Agent、工具名和参数；调用结束时在 `finally` 中删除。callId 由工具桥按 MCP 客户端与请求 ID 的哈希生成，同一次调用重放时复用原来的 Promise，不会重复登记。
2. **认领请求**。监听器只认领同时满足以下条件的请求，其他请求一律 `next()`：带 `callId`、能在 `bridgeCalls` 中找到、请求方就是登记的子 Agent。插件自己为 CLI 原生请求在子会话发起的 `approval.request` 不带 callId，因此不会被认领，也不会重复计数。
3. **生成请求摘要**（纯函数 `harnessApprovalRequest`）。参数里有字符串 `command` 时，摘要为 `执行命令（DSH 备选工具 <name>）：<command>`，否则为 `使用 DSH 备选工具 <name>`。详情取 `displayReason.zh`，没有时取 `reason`，按原生请求的上限截断（摘要 500 字符，详情 4000 字符）。`allowSession` 为 false。
4. **记录与决定**。通过运行时的新入口 `harnessApproval(worker, runId, request, signal, decide)` 处理。它与原生请求共用 `trackApproval`：写入「CLI 请求授权：…」时间线，`approvalWaiting` 加一，调用决定函数，记录「授权决定：…」，最后把计数减一。找不到运行中的同一 runId 任务时直接拒绝（任务停止）。监听信号由三部分组合：任务的控制器、`approvals` 撤回信号，以及 DSH 请求自带的 `signal`。
5. **按轮次来源决定**：
   - 主 Agent 发起的轮次（`runOrigins` 为 `agent`）：复用 `decideNativeApproval`。它先按父会话当前状态和本轮启动模式执行 `decideApproval`（规划 / 预设 / 完全权限），需要询问时才在父页面调用 `userQuestions.ask`，提问卡与原生请求使用同一套文案。
   - 其他轮次：先用同样的 `decideApproval` 处理规划和预设，需要询问时才 `next()` 交给下一个应答者，即子会话的原生审批面板，结果用 `decisionFromOutcome` 换算后记录。等待用 `waitForInput` 与停止信号赛跑，避免任务停止后仍挂在一个无人作答的面板上。
6. **映射回 DSH**（纯函数 `outcomeFromDecision`）：
   - `allow-once`、`allow-session` → `allowed-once`
   - 来源为 `stopped` → `cancelled`
   - 来源为 `unavailable` → `unavailable`
   - 其余 → `rejected`

## 取舍

- **不采用：把子会话策略固定为 never，改由插件代问**。这样 Worker 会话续聊时子会话就没有原生面板了，违背已定的弹窗位置，而且 DSH 会在 waterfall 之前就以 `rejected` 结束请求，插件根本拿不到。
- **不采用：在客户端把子会话面板转到父页面**。客户端无法在父页面伪造 DSH 审批面板；父会话的提问卡只能由 Host 用 `userQuestions.ask` 发起。
- **不采用：只把「等待审批」记到任务卡，不改弹窗位置**。主 Agent 页面仍然没有可以作答的地方，问题没有解决。

## 兼容性与生命周期

- Worker 会话续聊的轮次：弹窗位置不变，只新增时间线记录和「等待审批」计数。
- 存储与协议都不变。`approvalWaiting` 是已有字段，运行结束时由运行时清理（`runtime.ts` 结束分支）。
- `bridgeCalls` 只保存正在执行的调用；工具桥关闭或调用结束后即删除，不持久化。
- 插件卸载时监听器随 fiber 移除，此后 DSH 回到原有应答链。

## 风险与回退

- 若有其他插件也以 `prepend` 注册，并且在本插件之后加载，它会先收到请求。它若直接作答，插件就拿不到请求，表现会退回到改动前的样子，不会出现越权。
- 用户长时间不回答时，如果开启了空闲时限，运行器仍可能超时结束任务；这时信号撤回提问卡，工具调用不获授权（见提案「范围外」）。
- 回退办法：删除这个监听器注册即可恢复原有行为，无需迁移数据。
