# Proposal

## Why

v0.8.8 接入 TRAE CLI CN 时只评估了 `--permission-mode` 的四种原生模式（`default`、`plan`、`auto`、`bypass_permissions`），没有一种能保证改动先询问，所以 TRAE 只提供「仅工作区编辑」「完全权限」两档：选「询问」或主对话为「仅可查看」时派遣被拒绝（`src/host/native-traecn.mjs`、`src/host/adapters.ts` 抛出「TRAE CN 不支持询问档」）。见 [v0.8.9 PRD](../../../doc/prd/2026-11-10-v0.8.9-PRD.md) 需求 5.1–5.3。

2026-11-10 查到 TRAE 0.213.1 自带与 Codex 相同的原生沙箱与审批开关，可以按 Codex「询问」档的思路实现。

## 调研表（2026-11-10，macOS，traecli 0.213.1）

| 项目 | 结论 | 来源 |
| --- | --- | --- |
| 原生开关 | `-s/--sandbox read-only\|workspace-write\|danger-full-access`、`-a/--ask-for-approval on-request\|never`；等价配置键 `sandbox_mode`、`approval_policy` 可用 `-c` 覆盖 | `traecli --help`；TRAE 自带文档 `~/.trae/skills/.system/traecli-guide/references/permissions.md` |
| 审批人 | `approvals_reviewer` 只接受 `user`、`auto_review`、`guardian_subagent`（传 `bogus` 时报 `unknown variant` 退出 1） | 本机实测（无模型调用） |
| 与 `--permission-mode` 互斥 | 同时给 `--permission-mode default` 与 `-c sandbox_mode=...` 时退出 1：`` `sandbox_mode` and `permission_mode` overrides cannot both be set `` | 本机实测（无模型调用） |
| 启动与会话 | `traecli -c sandbox_mode="read-only" -c approval_policy="on-request" -c approvals_reviewer="user" acp serve` 正常握手；`session/new` 返回会话 ID，`configOptions` 只有 `model`（18 个模型与 v0.8.8 相同），不返回 `modes` | 本机实测（无模型调用） |
| 用户配置 | 临时 `TRAE_HOME/traecli.toml` 写 `permission_mode = "bypass_permissions"` 或 `sandbox_mode = "danger-full-access"` 时，上述 `-c` 启动不报冲突，正常进入认证检查 | 本机实测（未登录，无模型调用） |
| 沙箱效果 | 只读沙箱下 `touch` 被拒（Operation not permitted，文件未生成），`ls` 正常 | 2026-11-10 调查子代理实测，主会话复核过日志结论 |
| **未实测** | 工作区内写文件、有副作用命令是否先发 `session/request_permission`；拒绝后文件不存在；允许后写入；只读命令不询问 | glm-5.3-flash 经 TRAE 服务端返回 400（`Repetition_penalty should be in (0.0, 2.0]`），2026-11-10 22:11 复测仍失败；用户决定不换模型 |
| Hook 方案 | `PreToolUse` Hook 可返回 `ask`，但需写入用户或项目配置并在 TUI 信任，或用 `--dangerously-bypass-hook-trust`；不采用 | TRAE 自带文档 |

## What Changes

- TRAE 的 Worker 菜单增加第一项「询问」；「仅工作区编辑」的说明去掉“没有询问档”。
- 「询问」档（`read-only` 且非规划）的启动参数改为 `-c sandbox_mode="read-only" -c approval_policy="on-request" -c approvals_reviewer="user" acp serve`，不带 `--permission-mode`；runner 不再拒绝启动。
- 「询问」档不设置、不回读 ACP 模式（该参数下 `session/new` 不返回模式）；审批请求沿用现有 ACP 审批转交（主 Agent 发起→主页面提问卡片，Worker 框续聊→子会话原生审批面板），拒绝后本轮显示“因拒绝审批而结束”。
- 「仅工作区编辑」「完全权限」与规划模式的参数不变。每轮都新起 TRAE 进程，换档或切规划从下一轮起生效。
- 主对话为「仅可查看」且 Worker 没选过档位时，TRAE 按「询问」档运行，不再拒绝派遣。
- 同步 TRAE 协议文档、README 权限表与本变更的增量规格。

## 开放条件

真实探测（tasks.md 第 3 节）全部通过前，本变更不得随正式版本发布。任一项不达标时回退为 v0.8.8 的两档，并在协议文档记录实测结论。

## Capabilities

### Modified Capabilities

- `traecn-cli`：「TRAE 权限映射与规划模式」改为提供「询问」档。该能力的主规格尚在 `add-traecn-cli` 中，须先归档 `add-traecn-cli`。
- `worker-permission-levels`：「Worker 三档权限菜单」中 TRAE 显示第一项「询问」。

## Impact

- Host：`src/host/native-traecn.mjs`（argv、编辑模式）、`src/host/adapters.ts`（去掉询问档报错）。
- 共享协议：`src/shared/worker-permissions.ts`（TRAE 档位与仅可查看判断）。
- Client：菜单文案来自共享定义，无组件改动。
- 文档：`doc/traecn-protocol.md`、README。
- 安装入口与持久化：无变化。

## 范围外

- TRAE 的 `auto` 档（审核子代理代批）仍不映射。
- 不写入用户 `~/.trae` 配置、不使用 Hook、不换模型绕过服务端 400。
- Windows 只读沙箱未验证，不在本变更内声明 Windows 可用。
