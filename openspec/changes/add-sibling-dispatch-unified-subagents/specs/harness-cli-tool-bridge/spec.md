# Spec Delta

## ADDED Requirements

### Requirement: Worker 工具桥只放行插件派遣与状态工具
Worker 工具桥 SHALL 在 DSH 工具对该 Worker 可见时放行 `cliworker_start` 与 `cliworker_status`，并在 DSH 原生工具管线中以 Worker 子会话为调用方执行，策略、守卫与审批照常。其他插件工具、`run_code`、DSH 原生 `agent`／`subagent` 系列，以及 spawn、delegate、task、send_message 等派遣或多 Agent 工具 MUST 继续拒绝。工具名前缀或别名不得扩大放行范围。

#### Scenario: Worker 列出 DSH 工具
- **WHEN** Worker 通过工具桥读取可用 DSH 工具
- **THEN** 列表包含 `cliworker_start` 与 `cliworker_status`，不含 `cliworker_followup`、`run_code`、`agent` 或其他派遣工具

#### Scenario: 以别名绕过
- **WHEN** Worker 调用名为 `cliworker_start_x` 或 `cli_worker.start` 的工具
- **THEN** 工具桥拒绝调用，不执行派遣
