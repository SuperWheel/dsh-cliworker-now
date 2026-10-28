# Design: CLI 权限跟随 DSH 预设，额外授权走 DSH 审批

## 决策

2026-10-28 用户选定方向 A 的修订版（见 proposal）。方案 B（Codex auto_review）、C（仅不覆盖原生配置）不采用；C 的「不覆盖原生配置」并入本方案。

## DSH 侧事实（Desktop 安装包核实）

- `dsh-permission-presets` 预设：`read-only`（ask）、`workspace-write`（ask）、`danger-full-access`（never）；另有实验性 `auto`（`danger-full-access` + `ask` + 审核器），当前未在三档界面中提供。会话可回推为 `custom`（旋钮不匹配任何预设）。
- `dsh-user-approval`：`request({ agent, tool, reason, displayReason?, callId?, signal })`，`ask` 交给应答者（Desktop UI），`never` 直接拒绝，无应答者为 `unavailable`（拒绝）；必须在该 agent 未结束的轮次中调用；中止即 `cancelled`。
- DSH 自身委派子 Agent 时把审批固定为 `never`（`captureDelegatedPolicyOverrides`）。**插件子 Agent 的审批请求能否弹到用户面前是本方案的可行性前提**，见任务 1.2。

## 预设判定

- 读取：`parent.ctx.get('permissionPresets').current(parent.session)` 得到预设；`custom` 时按 `sandboxPolicy.resolve()` 的沙箱与 `approval` 策略组合判定（沙箱决定 CLI 模式，审批策略决定是否弹窗）。规划模式（`planMode`）先判。
- 每轮启动时快照沙箱映射；授权请求到来时重新读取当前预设与审批策略。

## 授权请求通路

CLI 反向请求 → runner 写出桥帧 `{ type: 'approval', id, request }`（CLI、请求种类、命令/路径/网络目标摘要、是否支持会话级允许）→ Host 按运行身份找到该轮的审批处理器 → 决定（见下）→ Host 经桥的私有控制邮箱（与停止、引导同一机制，命令类型 `approval`）写回 `{ id, decision: 'allow-once' | 'allow-session' | 'deny' }` → runner 回复 CLI 原生允许/拒绝。runner 等待期间 CLI 本身阻塞；任务停止、桥关闭或 Host 未在本轮内答复时 runner 回复拒绝。

### 1.2 核实结论（2026-10-28，见 tasks.md 1.2）

- `approval.request` 只能在发起 agent 的开放轮次内调用；父 Agent 在后台派遣后轮次通常已结束，不能可靠发起。
- DSH 原生审批面板只出现在客户端已持有（retain）的那个会话的输入区；插件子会话仅在用户打开该 Worker 会话时被持有，否则 DSH 结果为 `unavailable`。
- `userQuestions.ask` 只要求发起者是存活的根 Agent，不要求开放轮次；不带 callId 的阻塞提问由客户端问题面板在该会话输入区呈现（插件首次选型即用此通路）。
- DSH 审批结果只有 `allowed-once`，无「始终允许」。

### 发起者与弹窗位置（用户 2026-10-28 决定）

| 本轮来源 | 弹窗位置 | 实现 |
| --- | --- | --- |
| 主 Agent 调用（`cliworker_start` / `cliworker_followup`） | 主 Agent 页面 | 父 Agent `userQuestions.ask`：问题卡写明 Worker、CLI、请求内容与工作目录，选项「允许一次 / 本会话始终允许（仅 CLI 原生支持时）/ 拒绝」 |
| 用户在 Worker 会话或侧栏中续聊、排队消息、重新运行 | 该 Worker 的原生会话 | 子 Agent `approval.request`（方案 A）：每轮准备时把子会话审批策略同步为父会话的有效策略（`setApprovalPolicy` 直接写日志，不注入模型消息）；客户端在该轮运行期间持有子会话，并在 Worker 卡片显示「等待审批」，用户在 Worker 会话内原生审批面板作答（只有允许一次 / 拒绝） |

- 无应答者（客户端未持有对应会话、问题服务不可用、发起者不是存活 Agent、子轮次已关闭）一律拒绝，时间线记决定来源「无人应答」。
- 来源在 `launch` 入口按调用者确定，随运行快照，不从提示文字推断。

### 决定规则（每个请求到来时重新读取父会话当前状态）

1. Worker 规划模式（本轮以 `plan` 启动）或父会话处于 Harness 规划模式 → 拒绝，来源「规划模式」，不弹窗。
2. 父会话审批策略 `never`：沙箱为 `danger-full-access`（完全权限）→ 自动放行，来源「完全权限自动放行」；其他沙箱 → 拒绝，来源「权限预设」。
3. 审批策略 `ask` → 按上表弹窗，来源「DSH 用户」（或「无人应答」）。

### 本会话始终允许（用户 2026-10-28 决定）

通过 CLI 原生的会话级授权实现，插件不自行记忆授权：仅当该 CLI 的授权请求原生提供会话级/始终允许的回复（如 Codex `acceptForSession`、ACP `allow_always` 选项、OpenCode `always`）时，主页面问题卡才出现此选项，选择后 runner 回复该原生值；后续是否再询问由 CLI 自己决定。Worker 会话内的 DSH 原生审批面板只有允许一次 / 拒绝。

### 等待与清理

- 并发：同一 Worker 一次一个请求（CLI 本身阻塞）；多个 Worker 的请求由 DSH 应答者逐个呈现。
- 等待期间暂停空闲时限，总时限照常；任务停止、进程退出或运行身份不再匹配时撤回弹窗（`signal`）并回复拒绝，停止仍在进程范围退出后才报告成功。
- 时间线（Worker 事件）记录请求摘要、决定与决定来源；不记录 CLI 原始参数中的环境变量或凭据。

## 各 CLI 映射（2026-10-28 按 `--help`、安装包源码与本机生成的协议 schema 核实，未发模型请求；见 tasks.md 1.3）

仅可查看一律以 CLI 原生规划模式启动（runtime `launchMode=plan`），比原表「Codex `read-only` + `on-request`」更严：规划轮次的 Codex 审批策略为 `never`，不产生升级请求。

| CLI | 仅可查看 | 工作区内修改 | 完全权限 | 授权回复（允许一次 / 本会话始终允许 / 拒绝） |
| --- | --- | --- | --- | --- |
| Codex 0.162.1 | `read-only` + `never` | `workspace-write` + `on-request` | `danger-full-access` + `never` | `accept` / `acceptForSession` / `decline`；permissions 请求回显授予子集，`scope` 为 `turn`/`session` |
| Claude Code 2.1.287 | `plan` | `acceptEdits` | `bypassPermissions` | `--permission-prompts host`；`allow`+`updatedInput` / 另加 `updatedPermissions`（CLI 自己的 `permission_suggestions`，`destination:'session'`）/ `deny`+`interrupt:true`（本轮失败） |
| Kimi 2.3.3（ACP） | `plan` | `default` | 保持 `default`（`--yolo`/`--auto` 帮助与 ACP 描述矛盾），授权自动放行 | `approve_once` / `approve_always`（会话级）/ `reject` |
| Grok 1.0.62 | 私有配置 deny 规则（原有） | `--permission-mode acceptEdits` | `agent --always-approve stdio` | `allow_once` 选项 / 不提供（always 持久到项目）/ `reject_once` |
| Qoder 1.1.73 / CN 1.1.74 | 拒绝派遣（无 plan） | CLI `accept_edits`，ACP `acceptEdits` | CLI `bypass_permissions`，ACP `yolo` | `allow_once` 选项 / `proceed_always`（不选 `proceed_always_and_save`）/ `reject_once` |
| ZCode 0.16.9 / 0.17.0 | `plan` | `edit` | `yolo`（`auto` 未实现，`guarded` 仅 0.17） | `{decision:'allow'}` / 不提供（无已确认会话级回复，`permissionUpdates` 写项目规则）/ `{decision:'deny'}` |
| OpenCode / MiMo | `edit/bash: deny` | `edit: allow`，`bash: ask` | `"*": allow`，`bash: allow` | `reply:'once'` / 不提供（`always` 存活到进程重启或范围未核实）/ `reply:'reject'` |
| Hermes | 拒绝派遣（无已确认只读开关） | 现有 | 保持现有（`--yolo` 对 HTTP 通路未核实），授权自动放行 | `choice:'once'` / `'session'`（仅事件 `choices` 含时）/ `'deny'`；不发 `always` |
| Antigravity 1.4.9 | 拒绝派遣（无整进程只读） | 保持 `--sandbox --dangerously-skip-permissions`（去掉后无已知审批事件） | 同左 | 无原生授权协议 |
| Pi / OMP | 现有只读工具集 | 现有工具集 | 现有工具集 | 无原生授权协议，范围外 |

完全权限下没有已确认原生模式的 CLI（Kimi、Hermes、Antigravity、Pi、OMP）在时间线说明「按其写入模式运行」。

## 兼容与风险

- 「仅可查看可派遣」改变现有规则（`index.ts:669`），需同步修订 `worker-dispatch` 规格。
- 完全权限下 CLI 真正不受沙箱约束，这是用户选择的预设语义；README 需明确提示。
- 多 Worker 并行时弹窗可能较多：用户可切到完全权限；不做插件自己的批量放行。
- 「拒绝后完成标为结果待核实」规则保留，拒绝来源扩展为 DSH 用户或预设。
- 完全权限下的残余授权请求：用户 2026-10-28 决定自动放行并记录，不沿用 DSH `never` 的拒绝语义（DSH 的完全权限在其自身工具上本就不产生审批请求）。规划模式仍优先拒绝写入。
- 回退：恢复自动拒绝分支与固定参数。
