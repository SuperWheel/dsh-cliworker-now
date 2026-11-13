## Why

Worker 子会话输入框的权限菜单只有「规划（只读）」「允许编辑」两项（`src/shared/worker-permissions.ts`），和用户 2026-10-28 定的方案不符：

- 用户的原话：「这个是否弹出询问框按照 dsh 的三种审批权限走，如果是询问的话那就每次询问，如果是允许修改，那就走自动审批，如果是完全权限，那就采用完全权限，走 cli 原生的审批模式」。
- 之后又补充：不必严格限制只读，用「询问」控制只读，拒绝就不改；菜单改成「询问、自动审批、完全权限」三项，原生不支持自动审批的 CLI 把中档改叫「仅工作区编辑」。
- 2026-10-29 看到主对话为工作区内修改时 Pi 菜单只剩两项，又决定：菜单一直保持三项；用户自己切换的档位按所选运行，主 Agent 不用再询问，主 Agent 派遣与续聊也按该档位；Pi 第一项改为真正的「询问」。

现状对照源码：

1. 「规划（只读）」借用了权限菜单：选中即把 Worker 的 `mode` 存为 `plan`，`/plan` 与规划标记也从这个菜单推导（`src/client/harness-control-guards.tsx`、`src/shared/conversation-features.ts`）。
2. Worker 自己没有档位，每轮直接跟随主对话预设（`runAccess`）。主对话为「仅可查看」时，Host 把本轮强制改成规划模式（`src/host/runtime.ts` 的 `launchMode`），CLI 的授权请求一律直接拒绝（`decideApproval`），不会问用户。
3. 「工作区内修改」统一映射为各 CLI 的工作区自动编辑模式（如 Claude `acceptEdits`、Codex `workspace-write + on-request`），没有用到各 CLI 原生的自动审批模式。

2026-10-28/29 对 12 个 CLI 做了只读调查（三个 Codex 子 agent 读源码与官方文档，关键说法已对照本机安装包核对），并参考了同类项目 Codingns4DSH（commit `4cdeb695`）。结论：各 CLI 的原生能力差别很大，不能只改菜单文字。用户 2026-10-29 确认按「更新后的推荐」实施。

## What Changes

- **三档菜单**：Worker 权限菜单改为第一项 / 中档 / 完全权限三项，文字按 CLI 实际能力确定：
  - 第一项一般叫「询问」：读取和只读命令直接执行，改文件、有副作用的命令先问用户，拒绝就不改。做不出询问的 CLI 按真实行为改名：Kimi 叫「仅工作区编辑」（原生默认模式自动批准 Git 仓库内的编辑），Antigravity 叫「仅规划」（原生规划模式），Hermes 不显示这一项。Pi 没有原生审批模式，插件每轮加载一个私有 Pi 扩展，用 Pi 文档化的 `tool_call` 拦截和 RPC `confirm` 先问用户，所以 Pi 第一项也叫「询问」。
  - 中档：有原生自动审批的 CLI 叫「自动审批」；没有的叫「仅工作区编辑」（ZCode、OpenCode）；OMP、Pi 叫「自动批准编辑」（编辑自动批准、命令询问，原生不限制目录）。
  - 完全权限：CLI 原生完全权限。
- **用户所选档位**：菜单一直列出该 CLI 的全部档位。Worker 没有保存档位时跟随主对话（仅可查看 → 第一项，工作区内修改 → 中档，完全权限 → 完全权限）；用户保存档位后，该 Worker 的每一轮（含主 Agent 派遣与续聊）都按所选档位运行，不受主对话档位限制，主 Agent 不另行询问。选择完全权限仍先出现 DSH 原生确认；主对话处于规划模式时仍拒绝派遣。
- **仅可查看下的询问**：主对话为「仅可查看」且 Worker 没有保存档位时，Worker 按第一项运行，授权请求照常询问用户，不再一律自动拒绝。此时 Antigravity、Hermes、Kimi 拒绝派遣；用户为其选定档位后按所选档位运行。
- **规划与档位分开**：规划模式改为独立开关，`/plan` 与规划标记读 Worker 的规划状态；规划开启时 CLI 仍以原生规划模式运行、授权请求直接拒绝（与现状相同）。
- **审批判定**：Worker 实际档位为完全权限时，残余授权请求自动放行（主对话同为完全权限时沿用其审批策略）；第一项一律询问用户；中档在主对话审批策略为「不询问」时直接拒绝，其余询问用户。
- **各 CLI 映射**：按 design.md 的映射表改启动参数与原生模式。安装版本没有对应原生模式时，按更严一档运行并在时间线说明，不使用更宽的模式。
- **Claude Code 拒绝后继续**：拒绝授权时不再中断本轮，CLI 收到拒绝后继续处理。
- **子会话 DSH 工具**：Worker 子会话的 DSH 沙箱跟随实际档位（第一项为只读、中档为工作区内修改、完全权限为完全权限），使 DSH 备选工具与 CLI 档位一致。

范围外：

- 不新增插件自己的路径放行规则（如 Codingns4DSH 对 Grok 的做法）；ZCode、OMP、Pi 的中档目录边界以原生行为为准，文字如实说明。
- 不改 DSH 主对话的权限菜单与规划模式；主对话处于规划模式时仍拒绝派遣。
- 主 Agent 派遣工具 `cliworker_start` 的 `read_only` 参数含义不变（以规划模式运行）。
- Hermes 的询问需要新的原生审批通路（如 ACP），本变更不做。

## Capabilities

### New Capabilities

- `worker-permission-levels`：Worker 三档权限菜单、按 CLI 的文字、用户所选档位与跟随主对话、规划开关独立、各 CLI 原生映射与降级。

### Modified Capabilities

- `native-permission-relay`：修改「CLI 权限跟随 DSH 权限预设」「额外授权请求走 DSH 审批弹窗」，改为按 Worker 实际档位映射与判定。两条需求在未归档的 `relay-native-approvals-to-host` 中，本变更须在其后归档。
- `worker-dispatch`：修改「选型和宿主权限保持」中仅可查看的派遣规则。该需求的现行版本在未归档的 `relay-native-approvals-to-host` 中。
- `cli-native-features`：修改「Pi 命令执行跟随权限预设」，改为跟随 Worker 实际档位，并由 Pi 确认扩展询问。该需求在未归档的 `reenable-native-cli-features` 中。

## Impact

- Host：`src/host/native-approval-policy.ts`（档位计算与判定）、`src/host/index.ts`（权限快照、派遣检查、菜单 RPC、子会话沙箱、审批）、`src/host/runtime.ts`（启动模式、时间线说明）、`src/host/storage.ts`（新增可选字段）、各 CLI 适配器与运行器（`adapters.ts`、`process.ts`、`native-*.mjs`、`pi-omp-*`、新增 `pi-permission-gate.mjs`、`grok-adapter.ts`、`zcode-adapter.ts`、`cli-native-capabilities.mjs`）。
- Client：`src/client/harness-control-guards.tsx`、`src/client/harness-native-commands.ts`；共享：`src/shared/types.ts`、`src/shared/worker-permissions.ts`、`src/shared/conversation-features.ts`。
- 协议：Host RPC `permissionForWorker` 返回值增加规划状态，`configureWorkerPermission` 接受档位值；旧值 `plan`/`accept-edits` 仍表示规划开关。
- 存储：Worker 新增可选字段 `level`；旧数据无需迁移。
- 文档：README（中、英）、`doc/design.md`。
