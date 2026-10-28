# Tasks

## 1. 实施

- [x] 1.1 `native-approval-policy.ts`：新增 DSH 工具请求摘要 `harnessApprovalRequest` 与结果映射 `outcomeFromDecision`。
- [x] 1.2 `runtime.ts`：把审批等待的记录逻辑抽成 `trackApproval`，原生请求与工具桥共用；新增 `harnessApproval` 入口，找不到同一 runId 的运行中任务时拒绝。
- [x] 1.3 `index.ts`：工具桥 `execute` 登记和清除调用；以 `prepend` 注册 `approval/request` 应答者，按轮次来源决定（主 Agent 发起 → `decideNativeApproval`；其他 → 先按规划与预设执行 `decideApproval`，需要询问时才 `next()`，并与停止信号赛跑）。
  - 实施中补的两处设计缺口（已同步 design.md 与规格场景）：Worker 来源原先直接 `next()`，以规划模式启动时仍会在子会话弹面板；任务停止后 `next()` 可能一直挂起，等待计数不回落。

## 2. 自动检查

- [x] 2.1 测试（合成 Agent 与运行时，不启动 CLI 或 Desktop）：
  - 主 Agent 来源：父页面提问卡写明工具与命令；允许和拒绝分别映射为 `allowed-once` / `rejected`；时间线与等待计数正确。
  - Worker 来源：交给下一个应答者，同样计数和记录。
  - 非工具桥请求、callId 不匹配、请求方不是该子 Agent 时不处理。
  - 任务停止时撤回并返回 `cancelled`；以规划模式启动时直接拒绝、不提问。
  - 结果：`tests/native-approval-relay.test.ts` 新增 describe「DSH tool approvals from the tool bridge follow the turn origin」9 项，全文件 59 项通过。
- [x] 2.2 `pnpm typecheck`、关联测试、`pnpm build:preview`。
  - 2026-10-28：typecheck 通过；关联 12 个测试文件 334 项通过；`build:preview` 成功，预览包可加载；确认无活动任务后正式 `pnpm build`（22:05）更新 Desktop 链接。

## 3. Desktop 验收（真实模型调用需已有选型授权）

环境：DSH Desktop 0.2.1-rc.3（macOS），内置浏览器直连 Host Web UI；主 Agent GLM-5.3-Flash Max；Worker 为 Pi，`zai-coding-cn/glm-5.3-flash`、强度 low；预设为工作区内修改；目标文件在工作区外。证据为 Worker `06a086fa-85bd-41ef-ab91-3f26b4b1490c` 的 events。

- [x] 3.1 主 Agent 续聊 Pi，经 DSH 备选命令工具提权写工作区外文件：核对主页面提问卡、任务卡「等待审批」、允许和拒绝的结果、文件与时间线。
  - 允许（run `b2901a11`）：主页面提问卡写明「pi-2（Pi）请求授权：执行命令（DSH 备选工具 bash）：printf PI-AGENT-ALLOW > …/pi-agent-allow.txt」、DSH 给出的提权原因（danger-full-access 与 justification）和工作目录，选项只有「允许一次 / 拒绝」；任务卡显示「等待审批」，侧栏显示「待回答」。时间线记录请求和「授权决定：允许一次（DSH 用户）」；工具调用 COMPLETED；文件内容为 `PI-AGENT-ALLOW`，权限 0644。
  - 拒绝（run `fd373cf9`）：时间线记录「授权决定：拒绝（DSH 用户）」；工具调用 FAILED；`pi-agent-deny.txt` 未创建。
- [x] 3.2 用户在 Worker 会话续聊同样的请求：审批出现在子会话面板，主页面不出现提问卡。
  - run `517e94e0`：子会话出现 DSH 原生审批面板「等待审批」（拒绝 / 允许一次），主页面没有提问卡，任务卡显示「等待审批」；时间线记录请求和「授权决定：允许一次（DSH 用户）」；`pi-ui-allow.txt` 内容为 `PI-UI-ALLOW`。
- 未在 Desktop 验证（只有单测覆盖）：等待中停止任务、以规划模式启动的轮次。未验证：Windows。
- 观察（未改）：DSH 备选工具被拒后，本轮结果为「已完成」并附诊断「本轮有 1 个工具步骤失败，CLI 已自行处理」；CLI 原生授权被拒后为「结果待核实」，两者不一致。
- 范围外（见提案）：工具桥审批等待期间不暂停空闲时限。

## 4. 文档

- [x] 4.1 README（中、英）权限段说明 DSH 备选工具的审批同样按轮次来源询问；`doc/design.md` 增加本变更小节；`relay-native-approvals-to-host` 与 `scope-harness-bridge-tools` 的发现记录注明由本变更处理。
