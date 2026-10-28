## Why

2026-10-28 Desktop 实机验收中发现了这个问题（见 `scope-harness-bridge-tools` 4.1、`relay-native-approvals-to-host` 4.1）。主 Agent 用 `cliworker_followup` 让 Pi 通过 DSH 备选命令工具提权，写入工作区外的文件。审批只出现在该 Worker 的子会话面板里，主 Agent 页面没有提问卡，任务卡也只显示「运行中」。用户不打开子会话就看不到这个审批，任务会一直等下去。这与已确定的弹窗位置不一致：主 Agent 发起的轮次应在主页面弹提问卡。

现状（已对照源码核实）：

- CLI 原生授权请求由运行器写成 `approval` 帧，交给 Host 的 `relayApproval`（`src/host/runtime.ts:255-297`）。Host 按轮次来源决定在哪里询问：主 Agent 发起的轮次用父会话 `userQuestions.ask`，其他轮次用子会话 `approval.request`（`src/host/index.ts:750-786`）。Host 同时记录时间线，并维护 `approvalWaiting`，任务卡据此显示「等待审批」（`src/client/worker-card.tsx:125`）。
- DSH 备选工具由工具桥在 Worker 的子 Agent 内执行，调用方式是 `child.ctx.tools.execute({ callId: 'cliworker:cwn-harness-…', … })`（`src/host/index.ts:566-575`）。工具自身需要审批时，例如 DSH 命令工具的 `sandbox_permissions` 提权（`dsh-sandbox` 的 `approveEscalation`），会直接调用 `ctx.approval.request({ agent: child, toolName, callId, reason, displayReason })`。请求经 `approval/request` waterfall 由 `dsh-api-remotes` 转发给持有该子会话的客户端，插件完全不参与。因此这类请求不区分轮次来源，不写时间线，也不计入「等待审批」。
- 每轮准备时，子会话的审批策略会同步为父会话的有效策略（`src/host/index.ts:474-478`）。所以在工作区内修改预设下，这类请求一定会进入 waterfall。

## What Changes

- Host 以 `prepend` 方式注册一个 `approval/request` 应答者，只处理当前工具桥调用发出的请求：callId 与插件登记的调用一致，且请求方是该 Worker 的子 Agent。其他请求原样交给下一个应答者。
- 主 Agent 发起的轮次，沿用 CLI 原生请求的决定规则：规划模式拒绝；审批策略为 never 时，完全权限放行、其他预设拒绝；审批策略为 ask 时在父页面弹提问卡。提问卡写明 Worker、CLI、DSH 工具名、命令（工具参数里有命令时）、请求原因和工作目录，选项只有「允许一次 / 拒绝」。
- 用户在 Worker 会话中续聊的轮次，仍由子会话的 DSH 原生审批面板作答，插件把请求交给下一个应答者。
- 两种来源都在 Worker 时间线记录请求、决定和决定来源；等待期间 Worker 卡片显示「等待审批」。任务停止或运行身份失效时撤回提问并拒绝。
- 插件把决定映射回 DSH 的结果：
  - 允许一次 → `allowed-once`
  - 用户拒绝、预设拒绝、规划模式拒绝 → `rejected`
  - 任务停止 → `cancelled`
  - 无人应答 → `unavailable`

范围外：

- 不改变 DSH 工具本身的审批语义，也不改 DSH 的审批面板。不提供「本会话始终允许」，因为 DSH 的审批结果里没有会话级授权。
- 等待 DSH 工具审批期间，原生运行器的空闲时限照常计时。运行器只知道 CLI 在等工具结果，要让它暂停，需要扩展 Host 到运行器的控制邮箱协议；空闲时限默认不启用，另行处理。
- 授权提问卡把多行文字显示成一段，以及子会话里 Codex 命令工具块的标题不显示命令，这两个显示问题不在本变更内。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `native-permission-relay`：新增要求「DSH 备选工具的授权请求按轮次来源询问」。该能力目前只存在于尚未归档的 `relay-native-approvals-to-host` 中，所以用 ADDED 表达，等那个变更归档后再合入主规格。

## Impact

- Host：
  - `src/host/index.ts`：登记工具桥调用、注册应答者、按轮次来源决定。
  - `src/host/runtime.ts`：把审批等待的记录逻辑抽成共用函数，并新增工具桥审批入口。
  - `src/host/native-approval-policy.ts`：新增 DSH 工具请求摘要与结果映射，均为纯函数。
- Client：无改动，提问卡与「等待审批」状态沿用现有实现。
- 协议、存储、安装入口：无改动。
