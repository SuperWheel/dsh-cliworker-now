## Context

现状见 proposal。用户 2026-10-29 确认的决定：

1. 档位来源：Worker 没有保存档位时跟随主对话；主对话「仅可查看」时第一项照常询问；运行中调低主对话从下一轮生效（本轮授权请求仍按当前状态判定）。（原定「不高于主对话」的上限已于同日取消，见第 9 节。）
2. 「询问」只管改动：读取与只读命令直接执行，改文件和有副作用的命令先问。
3. 做不出询问的 CLI：Antigravity 第一项叫「仅规划」，Hermes 不显示。Pi 原定叫「只读」，同日改为经插件确认扩展询问，叫「询问」（第 9 节）。实施时核实 Kimi 默认模式会自动批准 Git 仓库内的编辑，按同一规则改名为「仅工作区编辑」并在仅可查看下拒绝（见第 6 节）。
4. OMP 中档用原生 write 模式，叫「自动批准编辑」；Pi 中档沿用现有工作区模式，同名。
5. 接受原生自动审批由 CLI 自行判断放行，悬停说明写明。

## Goals / Non-Goals

**Goals**

- 档位模型集中在 Host 一处计算，Client 只展示 Host 给出的选项。
- 规划开关与档位分开，`/plan`、规划标记、`cliworker_start read_only` 行为不变。
- 每个 CLI 的三档映射有原生依据；安装版本没有对应模式时按更严一档运行并说明。

**Non-Goals**

- 插件自定的放行规则（路径白名单等）。
- Hermes 询问档、Antigravity 授权回传。
- 改动 DSH 主对话的权限菜单。

## Decisions

### 1. 档位模型

```text
WorkerLevel = 'ask' | 'auto' | 'full'          // 第一项 / 中档 / 完全权限
主对话档位 → 跟随值：read-only → ask，workspace-write → auto，danger-full-access → full
实际档位 = worker.level ?? 跟随值
实际档位 → 本轮 access：ask → read-only，auto → workspace-write，full → danger-full-access
```

- 档位与现有 `NativeAccess` 一一对应，所以适配器与运行器继续接收 `(mode, access)`：`access` 改为「实际档位」而非「主对话档位」。变化只在 `mode=accept-edits, access=read-only` 这个组合：过去 Host 会把它改成规划，现在它表示第一项（询问）。
- `worker.level` 缺省表示跟随主对话。旧 Worker 与新 Worker 默认行为与现在一致（工作区内修改仍对应中档）。
- `worker.mode` 保留 `plan | accept-edits`，只表示规划开关。存储无需迁移；`level` 为可选字段。

取舍：曾考虑新增 `accessLevel` + `planMode` + `permissionVersion` 并迁移数据（插件内部调查的建议）。复用 `mode` 与 `access` 改动面更小、无迁移风险，代价是 `mode` 的名称不再准确，用注释说明。

### 2. 启动模式

```text
launchMode = worker.mode === 'plan' || 主对话规划 || (access === 'read-only' && 第一项为规划类 CLI) ? 'plan' : 'accept-edits'
```

第一项为规划类的 CLI：Antigravity（仅规划）。其他 CLI 的第一项以原生询问模式启动；Pi 安装版不支持确认扩展时由运行器改为规划（只读工具）。

### 3. 审批判定

```text
规划（本轮或主对话） → 拒绝（plan）
实际档位 full → 审批策略 = 主对话为 full ? 主对话审批策略 : never
审批策略 never 且实际档位 full → 自动放行（full-access）
审批策略 never 且实际档位 auto → 拒绝（preset）
其他 → 询问用户（按轮次来源：主页面提问卡 / 子会话审批面板）
```

实际档位在判定时按主对话当前状态重算，满足「每个请求按其发出时的当前预设决定」。第一项总是询问：用户主动选了询问，问用户不会宽于主对话。

### 4. 菜单与 RPC

- `permissionForWorker` 返回 `{ currentValue: 实际档位, options: 该 CLI 的全部档位, plan: { supported, active }, writable, reason? }`。选项名与说明来自 `src/shared/worker-permissions.ts` 的按 CLI 表。
- Client 把档位映射为 DSH 预设值以复用原生图标与完全权限确认：`ask → read-only`、`auto → workspace-write`、`full → danger-full-access`。不用 `auto`，DSH 会把它强制显示为「自动审查」。
- `configureWorkerPermission` 接受 `ask | auto | full`（保存档位）与 `plan | accept-edits`（规划开关，沿用原有原生会话事件）。
- 规划标记读 `worker.mode === 'plan'`；退出规划调用 `configureWorkerPermission('accept-edits')`。`/plan` 弹窗列出「开启规划」「关闭规划」，`/permissions` 列出档位。
- 是否支持规划改由 `workerPlanSupported(worker)` 判定（与原 `canPlan` 相同），不再从菜单推导。

### 5. 子会话 DSH 沙箱

准备与切换档位时，子会话沙箱设为实际档位对应的 access（规划为只读）；审批策略按 `workerApproval`：实际档位为 full 且主对话也为 full 时跟随主对话，full 而主对话较低时为 `never`，否则为 `ask`。这样 DSH 备选工具在第一项下要写入时会走提权询问，在完全权限下与主对话一致。

### 6. 各 CLI 映射（目标）

| CLI | 第一项 | 中档 | 完全权限 | 待核实 |
|---|---|---|---|---|
| Codex | 询问：`read-only` 沙箱 + `on-request` | 自动审批：`workspace-write` + `on-request` + 原生自动审核（`approvals_reviewer`） | `danger-full-access` + `never` | 自动审核在 app-server 中的配置键与回读 |
| Claude Code | 询问：`--permission-mode manual` | 自动审批：`auto` | `bypassPermissions` | `auto` 对当前账号可用；拒绝后不中断 |
| Antigravity | 仅规划：`--mode plan` | 自动审批：`--mode auto`，去掉跳过确认 | 跳过确认，关闭终端沙箱 | 安装版是否有 `auto`；无头模式下残余请求被软拒绝 |
| Grok | 询问：私有配置 `ui.permission_mode="ask"` + `ask=[Bash, Edit, Write]` | 自动审批：私有配置 `ui.permission_mode="auto"`（原生自动审核；`_meta.autoMode` 无回读，不用） | `agent --always-approve` | 自动审核实际效果 |
| Kimi | 仅工作区编辑：ACP `default`（Git 仓库内 Write/Edit 由 `git-cwd-write-approve` 自动批准，命令与其余改动询问；无 ask 规则注入入口，故改名并在仅可查看下拒绝） | 自动审批：ACP `yolo`（引擎 Ask When Needed） | ACP `auto`（引擎 Never Ask） | — |
| Qoder / Qoder CN | 询问：`default` | 自动审批：`auto` | `bypass_permissions` / ACP `yolo` | 安装版 configOptions 是否含 `auto`；两版分别核实 |
| ZCode | 询问：`build` | 仅工作区编辑：`edit` | `yolo` | 只读命令自动放行属原生行为 |
| Hermes | 不提供 | 自动审批：`approvals.mode=smart`、YOLO=0 | `approvals.mode=off` + `HERMES_YOLO_MODE=1` | Runs API 下的实际行为 |
| OpenCode | 询问：build，`edit/bash/external_directory=ask` | 仅工作区编辑：`edit=allow`，`bash/external_directory=ask` | 全部 allow | serve 无原生 `--auto` |
| MiMo | 询问：同 OpenCode | 自动审批：HTTP `skip-all` | 全部 allow + `skip-all` + 删除自动确认 | 安装版 HTTP 接口；不可用时中档降为询问（确认 skip-all 已关闭），无法确认关闭则拒绝启动 |
| Pi | 询问：开放 `write/edit/bash`，私有确认扩展只放行读类工具 | 自动批准编辑：同上，确认扩展另放行 `write/edit`，命令询问 | `write/edit/bash`，不加载确认扩展 | 安装版需有 `ToolCallEventResult.block` 与 RPC `confirm` |
| OMP | 询问：`--approval-mode always-ask`，开放 `write/edit/bash` | 自动批准编辑：`write` | `yolo` | 私有配置防止 `tools.approval.<tool>` 覆盖 |

主对话「仅可查看」时，没有保存档位的 Worker 除 Antigravity、Hermes、Kimi 外均允许派遣（Qoder 由拒绝改为以询问模式运行；`runsUnderViewOnly`）；用户为这三者选定档位后按所选档位运行。某 CLI 的询问档经核实做不到「改动先问」时，在 `worker-permissions.ts` 中把第一项改名或移除，并在仅可查看下拒绝派遣。

### 7. 降级与说明

- 原生模式不可用（安装版不支持、回读不一致）时，运行器按更严一档启动（中档 → 第一项；第一项不可用则拒绝启动），时间线写明实际使用的模式。
- 每轮时间线的「本轮权限：…」改为写 Worker 实际档位的 CLI 名称。

### 8. 实施结果与已知限制（2026-10-29）

- 降级只在运行器内发生：Host 的审批判定与 DSH 备选工具仍按 Worker 实际档位计算，不回读运行器降级后的模式。结果只会更严（例：中档降为询问后，主对话「从不询问」时 Host 按中档拒绝，而不是询问用户）；完全权限降级后运行器拒绝 Host 的 `full-access` 自动放行，不会变宽。
- 每轮启动前的帮助探测：Antigravity（`agy --help`，5 秒）与 OMP（隔离目录下 `omp --help`，10 秒）每轮确认原生模式目录，探测失败即拒绝启动。Claude 在中档/询问时检查帮助中的模式目录。
- Antigravity 规划（含「仅规划」）去掉了跳过确认，残余确认由无头模式软拒绝；比原先更严，真实规划任务尚未实测。
- Codex 中档的 `approvals_reviewer=auto_review` 由自动审核者决定，是否仍有请求转给用户未实测。
- Grok 中档用私有配置 `ui.permission_mode="auto"`：若该键被忽略，Grok 回到默认询问，只会更严。

### 9. 取消主对话上限与 Pi 询问（2026-10-29 用户决定）

用户看到主对话为工作区内修改时 Pi 菜单只有两项后决定：菜单一直列出三项；用户自己选的档位按所选运行，主 Agent 不用询问；主 Agent 派遣与续聊也按该档位；Pi 第一项改为「询问」。

- 取消上限：`effectiveLevel = level ?? 跟随值`；删除菜单说明里的上限、「高于主对话」的保存拒绝和时间线的「受主对话限制」。Host 在 Worker 有档位时跳过仅可查看下的派遣拒绝（`assertAccessSupported`）。
- 完全权限高于主对话时不能问用户：`workerApproval` 在主对话低于完全权限时给 Worker 返回 `never`，子会话 DSH 备选工具与残余授权请求都自动放行，与「完全权限」的含义一致；主对话同为完全权限时仍沿用其审批策略。
- Pi 询问：Pi 1.0.4 文档化了扩展的 `tool_call` 事件（返回 `{ block, reason }` 阻止调用，处理器出错也阻止）和 RPC 模式下 `ctx.ui.confirm` 发出的 `extension_ui_request`。插件新增 `src/host/pi-permission-gate.mjs`，询问与自动批准编辑档以 `--extension` 加载（`--no-extensions` 下仍加载显式路径）：
  - 放行清单：询问为 `read/grep/find/ls`，自动批准编辑另加 `write/edit`，DSH 备选工具自己会问，不重复询问；其余调用经 `confirm` 由桥转给 Host 审批，未批准即阻止。
  - 确认只带工具名、命令、路径、编辑处数与字节数，不带文件内容；标题带每轮随机 nonce，别的扩展的确认不当作审批。
  - 扩展注册钩子后经 fd 3 报告就绪；桥在就绪前不发送本轮提示，5 秒未就绪报错「Pi 权限确认扩展未加载，本轮未开始」。
  - 安装版缺少上述接口时：询问档以规划（只读工具）运行，自动批准编辑不开放 bash，时间线说明。
  - Pi 由此改走 `BridgeProtocol` 的审批转发，与 OMP 相同。
- 取舍：曾考虑菜单显示三项但把高于主对话的项置灰，DSH 原生 `PermissionSelect` 的选项只有 `{id, label, icon}`，做不到置灰；用户也决定不要上限。

## Risks / Trade-offs

- 原生自动审批由 CLI 自己判断，可能放行工作区外操作（用户已接受，悬停说明写明）。
- 第一项依赖各 CLI 的原生询问；会话级或已保存的允许规则可能让后续操作不再询问。插件只回复一次性允许（现有行为），不发送永久规则。
- 多个原生模式只有源码依据，需逐个在安装版本上核实（tasks 第 3 节）；核实失败按第 7 节降级。
- 主对话「仅可查看」下改为询问用户，用户点允许即可写入。这与 DSH 主对话在受限档位下提权询问的方式一致，但比现状（一律拒绝）宽。
- 用户为 Worker 选的档位可以高于主对话，主 Agent 派遣也按该档位运行，不再受主对话档位约束（用户明确决定）；选完全权限仍需 DSH 原生确认。
- Pi 询问依赖 Pi 扩展接口；Pi 升级改动接口时按版本检测降级为更严的运行方式，但检测只看类型声明与 RPC 源码中的标记。

## Migration Plan

- 存储：`level` 可选，缺省表示跟随主对话；不改写旧文件。
- 回退：撤下本变更后旧版本忽略 `level` 字段（zod 对象按现有 schema 解析时剥离未知字段，需在实施时确认）。

## Open Questions

- 无（用户 2026-10-29 已确认全部推荐）。
