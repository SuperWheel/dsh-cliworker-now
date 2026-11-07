## ADDED Requirements

### Requirement: 原生拒绝即结束本轮的终态
对已核实“拒绝任一授权即以取消结束整轮”的 CLI（CodeBuddy Code 与 TRAE CLI CN），runner SHALL 通过默认关闭的 `deniedCancelEndsTurn` 显式启用本规则。当本轮有授权请求被 DSH 拒绝（用户、权限预设或规划模式）、原生 `stopReason === 'cancelled'`、用户未停止且没有其他失败时，Worker SHALL 以 SUCCESS 结束，结果说明为“因拒绝审批而结束：被拒操作未执行，可续聊继续”，MUST NOT 因空正文降为 UNCERTAIN。被拒绝且没有原生终态的工具 SHALL 显示为已拒绝，不再另报“工具缺少终态”；其他工具缺少终态或失败 MUST 保留错误。用户主动停止、超时、缺少拒绝或取消终态时 MUST 按原有规则判定。未声明该行为的 CLI 不受影响。

#### Scenario: 拒绝命令后 CodeBuddy 结束本轮
- **WHEN** 用户拒绝 CodeBuddy 的命令审批，CodeBuddy 返回 `stopReason: cancelled` 且 `codebuddy.ai/outcome` 为 `PERMISSION_DENIED`
- **THEN** Worker 状态为 SUCCESS，说明为“因拒绝审批而结束”，被拒命令显示已拒绝，时间线保留授权决定

#### Scenario: 拒绝后用户又停止
- **WHEN** 本轮有拒绝记录，但随后用户停止任务，CodeBuddy 以 outcome `CANCELLED` 结束
- **THEN** 按停止处理，不显示“因拒绝审批而结束”

#### Scenario: 没有拒绝却以取消结束
- **WHEN** 本轮没有任何拒绝，CodeBuddy 仍返回 `cancelled`
- **THEN** 按原有规则报告未成功完成，不套用拒绝结束说明
