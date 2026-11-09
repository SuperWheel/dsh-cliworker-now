## ADDED Requirements

### Requirement: 结果说明在 Worker 窗口可见
CLI 本轮带有结果说明（例如因拒绝审批而结束）时，Host SHALL 把该说明以“本轮结果说明”行投影到原生 Worker 窗口的时间线，与写入结果的说明一致；MUST NOT 只保留在结果字段而不在 Worker 窗口显示。

#### Scenario: 拒绝审批后结束本轮
- **WHEN** WorkBuddy 请求的操作被用户拒绝，CLI 随后以 cancelled 结束本轮
- **THEN** Worker 窗口显示“本轮结果说明：因拒绝审批而结束：被拒操作未执行，可续聊继续”
