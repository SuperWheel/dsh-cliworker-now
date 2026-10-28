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

CLI 反向请求 → runner 通过桥的控制通道发给 Host（新增 `approval` 控制消息，带 Worker/run 身份、CLI 原生请求摘要）→ Host 校验运行身份与当前预设 → `ask` 时调用 `approval.request({ agent: <可弹窗的 agent>, tool: 'cliworker:<cli>', reason, displayReason, signal })` → 结果回桥 → runner 回复 CLI 原生允许/拒绝。

- 发起 agent：优先插件子 Agent（若其审批策略可为 ask 且处于轮次中）；否则用父 Agent 并在 `displayReason` 写明 Worker。待 1.2 核实后定稿。
- 并发：多个 Worker 的请求按 DSH 应答者队列逐个弹出；同一 Worker 一次一个。
- 等待期间：暂停空闲时限，总时限照常；任务停止经 `signal` 撤回弹窗。
- 「本会话始终允许」：仅当 DSH 应答结果明确提供该语义且 CLI 原生有对应回复（如 Codex `acceptForSession`）时映射，否则只做单次允许。

## 各 CLI 映射（标「待核实」者须先确认原生能力，不发明）

| CLI | 仅可查看 | 工作区内修改 | 完全权限 | 授权请求入口 |
| --- | --- | --- | --- | --- |
| Codex | `read-only` + `on-request` | `workspace-write` + `on-request` | `danger-full-access` + `never` | `item/*/requestApproval`（已有） |
| Claude Code | `plan` | `acceptEdits` | `bypassPermissions` | stream-json `control_request`（已有，现为 deny） |
| Kimi / Grok / Qoder / Qoder CN | 原生 plan（Qoder 无，拒绝派遣） | 现有写模式 | 原生免确认模式（待核实） | ACP `session/request_permission`（已有） |
| ZCode | 原生只读（待核实） | 现有写模式 | 待核实 | `interaction/requestPermission`（已有） |
| OpenCode / MiMo | `edit/bash: deny` | `edit: allow`，`bash: ask` | `"*": allow` | `permission.asked`（已有） |
| Hermes | 待核实 | 现有 | 待核实 | `approval.request`（已有） |
| Antigravity | 拒绝派遣（无整进程只读） | 去掉 `--dangerously-skip-permissions`，保留 `--sandbox`（待核实是否有审批事件） | 现有参数 | 待核实 |
| Pi / OMP | 现有只读工具集 | 现有工具集 | 现有工具集 | 无原生审批协议，范围外 |

## 兼容与风险

- 「仅可查看可派遣」改变现有规则（`index.ts:669`），需同步修订 `worker-dispatch` 规格。
- 完全权限下 CLI 真正不受沙箱约束，这是用户选择的预设语义；README 需明确提示。
- 多 Worker 并行时弹窗可能较多：用户可切到完全权限；不做插件自己的批量放行。
- 「拒绝后完成标为结果待核实」规则保留，拒绝来源扩展为 DSH 用户或预设。
- 完全权限下的残余授权请求：用户 2026-10-28 决定自动放行并记录，不沿用 DSH `never` 的拒绝语义（DSH 的完全权限在其自身工具上本就不产生审批请求）。规划模式仍优先拒绝写入。
- 回退：恢复自动拒绝分支与固定参数。
