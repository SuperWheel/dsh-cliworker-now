## MODIFIED Requirements

### Requirement: 后台原生子 Agent 完成后才结束 Worker 轮次
CLI 原生工具派发即返回、实际工作在后台继续时（Antigravity 的 `invoke_subagent`），插件 MUST NOT 在本轮结束后立即关闭原生进程，而 SHALL 在同一原生会话中按递增间隔自动发送跟进检查。跟进 MUST 标注为 CLI Worker 自动跟进、不是用户消息，并要求不得重新派发。跟进 SHALL 以「子 Agent 已送达结果消息或原任务要求的产物已存在」为完成依据，MUST 说明 Antigravity `manage_subagents` 列出的 ALIVE 不表示仍在工作。只有待完成标记是本轮最后的内容（之后无正文、无工具调用）时才继续等待，否则结束本轮。等待期间审批、事件与停止有效。插件等待上限 SHALL 只计跟进前的等待间隔，从主回合结束时起算，主回合自身的耗时（含等待 DSH 审批）MUST NOT 占用该上限；整轮（含跟进轮）受任务总时限约束，跟进轮的请求超时 SHALL 取任务剩余时间。上限或检查次数用尽仍只收到待完成标记时 MUST 报告「结果待核实」。待完成标记 MUST NOT 计入输出或出现在流式正文中。没有后台工具的轮次 MUST 只发送一次 prompt。

#### Scenario: Antigravity 生图子 Agent
- **WHEN** Antigravity 调用 `invoke_subagent` 后以 end_turn 结束本轮
- **THEN** 插件保持会话，自动发送跟进检查，直到 Antigravity 汇报子 Agent 结果后才结束 Worker 轮次

#### Scenario: 主回合耗时超过等待上限
- **WHEN** 主回合在派出 `invoke_subagent` 前已用去超过插件等待上限的时间（例如等待 DSH 审批）
- **THEN** 插件仍按间隔发送跟进，Antigravity 汇报结果后 Worker 判成功，不报「未在限定时间内汇报结果」

#### Scenario: 已汇报的子 Agent 仍显示 ALIVE
- **WHEN** 生图子 Agent 已送达结果消息或图片已存在，而 `manage_subagents` 仍列出该子 Agent 为 ALIVE
- **THEN** 跟进提示要求按已完成处理，不回复待完成标记

#### Scenario: 标记之后同轮送达结果
- **WHEN** 跟进轮先回复待完成标记，随后同一轮内执行工具并给出汇报
- **THEN** 插件结束 Worker 轮次，不再发送跟进，标记不计入输出

#### Scenario: 后台子 Agent 超时
- **WHEN** 等待上限或跟进检查用尽仍只收到待完成标记
- **THEN** Worker 结果为「结果待核实」，提示核查实际产物

#### Scenario: 等待期间停止
- **WHEN** 用户在等待后台子 Agent 时停止任务
- **THEN** 不再发送跟进，原生进程退出后才报告停止
