# Spec Delta

## ADDED Requirements

### Requirement: 手动停止的轮次不由主 Agent 自行续派

Worker 本轮因面板停止按钮或 `cliworker_stop` 结束时，Host 交给主 Agent 的后台作业结果 SHALL 带 `stoppedBy: "user"`，并在 `guidance` 中说明这是用户的决定：除非用户在此之后明确要求继续，主 Agent MUST NOT 调用 `cliworker_followup` 续聊或重新派遣同一任务，只说明已完成的进度。超时、故障等其他中断 MUST NOT 带 `stoppedBy`。派遣说明与 `cliworker_followup` 工具描述 SHALL 写明同一规则。

#### Scenario: 用户从面板停止
- **WHEN** Worker 运行中，用户在 Worker 详情点「停止生成」，本轮以 `interrupted` 结束且中断原因为用户
- **THEN** 后台作业结果为 `killed`，结果 JSON 含 `status: "interrupted"`、`stoppedBy: "user"` 和不要自行续聊或重派的 `guidance`

#### Scenario: 超时中断
- **WHEN** Worker 本轮因超时被中断
- **THEN** 结果 JSON 为 `status: "interrupted"`，不含 `stoppedBy`，`guidance` 不含手动停止说明
