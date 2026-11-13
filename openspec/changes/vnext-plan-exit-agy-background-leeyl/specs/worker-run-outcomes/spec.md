## ADDED Requirements

### Requirement: Claude Code 规划模式提交方案即完成本轮
Claude Code 以原生规划模式运行（DSH 规划模式或 Worker 规划开关）时，原生 `ExitPlanMode` 授权请求带非空方案（`input.plan`）SHALL 视为本轮已完成：方案 SHALL 作为本轮结果正文交给主 Agent 与 Worker，终态 SHALL 为成功，并附说明「已提交方案，未退出规划、未执行」。插件 MUST NOT 批准退出规划模式，MUST NOT 把该请求转交 DSH 审批，SHALL 回复拒绝并中断，使 CLI 不执行方案中的任何步骤。`ExitPlanMode` 工具步骤 SHALL 记为完成。派遣、续聊、原生会话恢复与分支 SHALL 按同一规则判定。

#### Scenario: 主 Agent 派遣规划任务
- **WHEN** 规划模式的 Claude Code Worker 调用 `ExitPlanMode`，请求带 `requires_user_interaction: true` 与完整方案，插件中断后 CLI 以 `error_during_execution` 结束
- **THEN** Worker 终态为成功，结果正文为方案原文，不出现审批卡，CLI 没有执行方案

#### Scenario: 续聊与恢复原生会话
- **WHEN** 已有原生会话的 Claude Code Worker 以规划模式续聊（`--resume`），本轮以 `ExitPlanMode` 收尾
- **THEN** 结果与新会话相同：方案作为结果、终态成功、不退出规划

### Requirement: Claude Code 规划收尾的失败边界
插件为保持规划而中断后，CLI 给出的 `error_during_execution` 终态与对 `ExitPlanMode` 的拒绝记录 MUST NOT 计为失败或用户拒绝。非规划模式下的 `ExitPlanMode`、方案为空的 `ExitPlanMode` 以及其他需要用户交互的请求 MUST 保持「CLI 请求额外交互授权，插件未批准」失败判定。中断之后出现其他终态错误、非零退出或未完成工具时 MUST 仍判失败。

#### Scenario: 方案为空
- **WHEN** 规划模式下 `ExitPlanMode` 的 `input.plan` 为空白
- **THEN** 插件不伪造结果，仍判「CLI 请求额外交互授权，插件未批准」失败

#### Scenario: 非规划模式或其他交互请求
- **WHEN** 非规划模式的 Claude Code 发出 `ExitPlanMode`，或规划模式下发出其他需要用户交互的请求
- **THEN** 插件拒绝并中断，结果仍为失败
