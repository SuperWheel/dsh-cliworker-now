## Why

插件对所有 CLI 的额外授权请求一律自动拒绝，且部分 CLI 的权限比用户原生使用时更严，模型无法申请提权后重试，只能绕路（推断：Windows 用户反馈 Codex「总用 python」可能与此有关，尚无调用轨迹证实）。同时插件的权限与用户在 DSH 对话里选择的权限预设脱节：用户选了「完全权限」，CLI 仍被限制在禁网的工作区沙箱里。

现状（源码核实）：

- Codex：`approvalPolicy: 'never'`，turn 级 `sandboxPolicy` 固定 `workspaceWrite`、`writableRoots: [project]`、`networkAccess: false`，审批请求回复 `decline`，用户输入/elicitation 返回错误（`src/host/native-codex.mjs:138-151,224-226,252-263`）；继承配置使 thread 回执 `networkAccess: true` 时直接拒绝运行（`:228`）。
- Claude Code：`--permission-mode plan/acceptEdits`、`--permission-prompts none`，反向审批 `deny` + `interrupt`（`adapters.ts:318-319`、`native-claude.mjs:44,83-89`）。
- ACP 系：非 DSH 工具的审批选 `reject_once`（`native-acp.mjs:113-121`）；Qoder 固定 `accept_edits`（`adapters.ts:288`）。
- ZCode、Hermes：一律 deny（`native-zcode.mjs:244-253`、`native-hermes.mjs:410`）。
- OpenCode/MiMo：写模式 `bash: 'ask'` 但 `permission.asked` 全部 reject（`native-session-http.mjs:39,219`）。
- Antigravity：任何模式都传 `--sandbox --dangerously-skip-permissions`（`process.ts:132-133`），反而比「工作区内修改」宽。
- Pi/OMP：`--tools` 白名单不含 bash，交互请求一律取消（`pi-omp-bridge.mjs:404,746`）。
- 仅可查看模式下插件直接拒绝派遣（`index.ts:669`）。

DSH Desktop 对话权限预设（Desktop 安装包内置配置核实）：

| 界面名称 | 沙箱 | 审批策略 |
| --- | --- | --- |
| 仅可查看 | `read-only` | `ask` |
| 工作区内修改 | `workspace-write` | `ask`（超出工作区的重试需审批） |
| 完全权限 | `danger-full-access` | `never`（不弹窗） |

## What Changes

2026-10-28 用户选定方向 A 的修订版：CLI 的权限跟随父会话当前的 DSH 权限预设；需要额外权限的场景走 DSH 审批弹窗。

- **仅可查看**：允许只读派遣，CLI 以原生只读/规划模式运行；CLI 发出的每个写入或提权请求都通过 DSH 审批弹窗询问。（改变「只读模式拒绝派遣」的现有规则；无法实现整进程只读的 CLI，如 Antigravity，在此模式下仍拒绝派遣。）
- **工作区内修改**：CLI 以原生的「工作区内自动修改」模式运行，工作区内编辑与命令由 CLI 原生沙箱自动放行；CLI 申请超出原生沙箱的权限（沙箱外命令、网络、工作区外路径等）时弹出 DSH 审批弹窗，用户批准才回复允许。
- **完全权限**：CLI 使用其原生的完全权限模式，不弹窗；CLI 仍发来的残余授权请求自动放行并记录（用户 2026-10-28 决定；不沿用 DSH `never` 的拒绝语义）。
- 规划模式始终优先：CLI 以只读运行，写入请求直接拒绝，不弹窗。
- 弹窗写明 Worker 名称、CLI、请求内容（命令/路径/网络目标）与工作目录；拒绝、关闭、超时或任务停止都回复 CLI 拒绝。
- 沙箱模式在每轮启动时按当时预设确定；授权请求按发出时的当前预设决定。运行中切换预设，沙箱从下一轮生效。
- 不再用更严的轮次参数覆盖用户 CLI 原生配置中的网络与可写目录（预设或规划模式要求更严时除外）；继承配置启用网络不再导致启动前失败。
- 时间线记录每个授权请求的内容、决定与决定来源（DSH 用户 / 完全权限自动放行 / 规划模式）。

范围外：插件不附加自己的 OS 沙箱；不发明 CLI 不具备的权限模式（某 CLI 没有对应原生模式时按最接近的更严模式运行并说明）；Pi/OMP 无原生审批协议，本变更不为其新增 bash。

## Capabilities

### New Capabilities

- `native-permission-relay`：CLI 权限跟随 DSH 权限预设、授权请求经 DSH 审批的规则。

### Modified Capabilities

- `worker-dispatch`：仅可查看模式下允许只读派遣（原为一律拒绝）。实施时提取对应现有需求后用 MODIFIED 表达。
- `worker-run-outcomes`：「额外授权被拒绝后完成的轮次」中的拒绝来源扩展为 DSH 用户拒绝或预设拒绝（尚未归档的 `report-denied-permission-as-unverified` 需同步修订）。

## Impact

- Host：各 native runner 的反向请求处理与启动参数（`adapters.ts`、`native-codex.mjs`、`native-claude.mjs`、`native-acp.mjs`、`native-zcode.mjs`、`native-hermes.mjs`、`native-session-http.mjs`、`native-agy.mjs`）；`index.ts` 的派遣权限判断；读取父会话 `permissionPresets` / `sandboxPolicy` / `approval` 服务。
- Client：审批弹窗由 DSH 原生审批 UI 提供；任务时间线显示授权记录。
- 与 `configure-worker-time-limit` 交互：等待弹窗期间不计空闲时限，总时限照常。
