## ADDED Requirements

### Requirement: 原生拒绝即结束本轮的终态
对已核实“拒绝任一授权即以取消结束整轮”的 CLI（当前为 CodeBuddy Code，runner 显式声明），当本轮有授权请求被拒绝（DSH 用户、权限预设或规划模式）且原生终态带有该 CLI 公开的拒绝结束标记时，Worker SHALL 以失败结束，结果说明为“因拒绝审批而结束”，并写明被拒操作未执行、可续聊继续，MUST NOT 显示为用户停止或已取消，MUST NOT 标为成功或结果待核实。被拒绝且没有原生终态的工具 SHALL 显示为已拒绝，不再另报“工具缺少终态”。用户主动停止、超时、缺少终态标记或标记不是拒绝结束时 MUST 按原有规则判定。未声明该行为的 CLI 不受影响。

#### Scenario: 拒绝命令后 CodeBuddy 结束本轮
- **WHEN** 用户拒绝 CodeBuddy 的命令审批，CodeBuddy 返回 `stopReason: cancelled` 且 `codebuddy.ai/outcome` 为 `PERMISSION_DENIED`
- **THEN** Worker 状态为失败，说明为“因拒绝审批而结束”，被拒命令显示已拒绝，时间线保留授权决定

#### Scenario: 拒绝后用户又停止
- **WHEN** 本轮有拒绝记录，但随后用户停止任务，CodeBuddy 以 outcome `CANCELLED` 结束
- **THEN** 按停止处理，不显示“因拒绝审批而结束”

#### Scenario: 没有拒绝却以取消结束
- **WHEN** 本轮没有任何拒绝，CodeBuddy 仍返回 `cancelled`
- **THEN** 按原有规则报告未成功完成，不套用拒绝结束说明
