# Spec Delta

## MODIFIED Requirements

### Requirement: 原生功能默认启用，关闭须有记录理由
插件 SHALL 默认保留 CLI 的原生功能，仅在属于以下类别时关闭：破坏账号或凭据隔离、无法遵循当前 DSH 权限预设。每项关闭 MUST 在文档中记录所属类别与理由。账号隔离类关闭（外部插件、导入其他 CLI 配置或凭据、provider 配置导入）MUST 保留。CLI 内部子 Agent 不再作为关闭理由。

#### Scenario: 无记录理由的关闭项
- **WHEN** 某原生功能被关闭但不属于上述类别
- **THEN** 该功能恢复启用，或在文档中补记理由后保留

#### Scenario: 账号隔离类入口
- **WHEN** CLI 支持导入其他 CLI 的配置或凭据
- **THEN** 插件继续关闭该入口，文档写明属于账号隔离

## REMOVED Requirements

### Requirement: CLI 内部子 Agent 保持关闭
**Reason**: 用户 2026-11-05 改为允许子 Agent，任务树层级由插件派遣保证，CLI 内部子 Agent 不再一律关闭。
**Migration**: 由「CLI 内部子 Agent 跟随原生设置」取代；Grok 不再固定传 `--no-subagents`，ZCode 禁用工具列表不再固定包含 Agent、Task、SendMessage、Skill 与工作流工具。

## ADDED Requirements

### Requirement: CLI 内部子 Agent 跟随原生设置
Grok 的子 Agent 与 ZCode 的 Agent、Task、SendMessage、工作流与 Skill 工具 SHALL 跟随用户原生 CLI 的生效设置：用户开过或 CLI 默认开启时启用，用户关闭时保持关闭；插件 MUST NOT 替用户打开原生已关闭的功能。原生子 Agent 的过程 SHALL 只在该 Worker 对话内按 CLI 公开的粒度显示为工具步骤或文本，MUST NOT 在 CLI Worker 窗口新增条目或伪造独立会话、进度。续聊与恢复 MUST 使用与首轮相同的工具开关。

#### Scenario: Grok 默认启动
- **WHEN** 用户原生 Grok 配置未关闭子 Agent，插件启动 Grok Worker
- **THEN** 启动参数与私有配置不再包含 `--no-subagents`、`[subagents] enabled = false` 或 `GROK_SUBAGENTS=0`

#### Scenario: 用户关闭了原生子 Agent
- **WHEN** 用户原生 ZCode 设置禁用了 Task 工具
- **THEN** 插件启动 ZCode 时继续禁用 Task，不替用户打开

#### Scenario: ZCode 续聊
- **WHEN** ZCode Worker 续聊恢复会话
- **THEN** 恢复参数校验接受与首轮相同的禁用工具列表，续聊不因列表变化而失败

#### Scenario: 原生子 Agent 的显示
- **WHEN** Grok 在任务中调用其子 Agent
- **THEN** 子 Agent 过程显示在 Grok Worker 对话内，CLI Worker 窗口不新增条目

### Requirement: 后台原生子 Agent 完成后才结束 Worker 轮次
CLI 原生工具派发即返回、实际工作在后台继续时（Antigravity 的 `invoke_subagent`），插件 MUST NOT 在本轮结束后立即关闭原生进程，而 SHALL 在同一原生会话中按递增间隔自动发送跟进检查。跟进 MUST 标注为 CLI Worker 自动跟进、不是用户消息，并要求不得重新派发。只有待完成标记是本轮最后的内容（之后无正文、无工具调用）时才继续等待，否则结束本轮。等待期间审批、事件与停止有效；总等待受任务超时与插件上限约束，超时 MUST 报告「结果待核实」。待完成标记 MUST NOT 计入输出或出现在流式正文中。没有后台工具的轮次 MUST 只发送一次 prompt。

#### Scenario: Antigravity 生图子 Agent
- **WHEN** Antigravity 调用 `invoke_subagent` 后以 end_turn 结束本轮
- **THEN** 插件保持会话，自动发送跟进检查，直到 Antigravity 汇报子 Agent 结果后才结束 Worker 轮次

#### Scenario: 标记之后同轮送达结果
- **WHEN** 跟进轮先回复待完成标记，随后同一轮内执行工具并给出汇报
- **THEN** 插件结束 Worker 轮次，不再发送跟进，标记不计入输出

#### Scenario: 后台子 Agent 超时
- **WHEN** 跟进检查用尽仍只收到待完成标记
- **THEN** Worker 结果为「结果待核实」，提示核查实际产物

#### Scenario: 等待期间停止
- **WHEN** 用户在等待后台子 Agent 时停止任务
- **THEN** 不再发送跟进，原生进程退出后才报告停止

### Requirement: 后台跟进对用户可见
每次等待与跟进 SHALL 作为插件说明，显示在 Worker 过程视图和 Worker 子会话窗口中。DSH 聊天不显示 notice 形态的上下文，所以子会话以已完成的被动工具行 `cliworker_auto_followup` 显示，MUST NOT 派发、执行，也不作为用户消息。CLI 自身的其他诊断 MUST NOT 因此进入子会话。

#### Scenario: 跟进在子会话可见
- **WHEN** 插件等待后台子 Agent 并发送跟进检查
- **THEN** Worker 子会话窗口在两次回复之间以 `cliworker_auto_followup` 工具行显示「…秒后由 CLI Worker 自动发送第 N 次跟进检查」与「CLI Worker 自动跟进（非用户消息）…」，正文中没有待完成标记

### Requirement: Antigravity 完成本轮后的关闭异常判待核实
Antigravity ACP 本轮已以 end_turn 完成并判为成功，而进程随后只以普通非零退出码退出（无信号、无协议错误、Runner 未报告失败）时，结果 SHALL 为「结果待核实」并注明退出码，MUST NOT 判成功或失败，以免主 Agent 重试已完成的工作。其他 CLI、stream 后备路径与信号退出 MUST 保持判失败。

#### Scenario: agy 关闭时崩溃
- **WHEN** agy 汇报完成后关闭时以退出码 2 退出
- **THEN** Worker 结果为「结果待核实」，说明含退出码 2，最终正文保留
