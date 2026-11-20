## ADDED Requirements

### Requirement: Antigravity 转入后台的命令在本轮结束时判待核实

Antigravity ACP 的 `run_command` 入参带数值 `WaitMsBeforeAsync` 时，SHALL 视为 agy 可自行转入后台的命令。本轮原生以 `end_turn` 结束、用户未停止且没有其他失败，而仍未到 `completed`/`failed` 的工具全部是这类命令时，Worker SHALL 以待核实（UNCERTAIN）结束并保留本轮正文；结果说明 SHALL 写明命令已被转入后台、本轮结束时仍未完成、随 Worker 关闭会话中止且没有结果，并列出命令（截断）。对应工具步骤 SHALL 以失败收尾并给出同样的说明，MUST NOT 停留在运行中，也 MUST NOT 计为成功。存在其他未终态工具、原生轮次不是 `end_turn` 或用户停止时 MUST 按原有规则判失败。插件 MUST NOT 依据模型正文判断是否转入后台。其他 CLI 不受影响。

#### Scenario: agy 把长命令转入后台后结束本轮

- **WHEN** agy 发起带 `WaitMsBeforeAsync` 的 `run_command`，只给出 `in_progress`，随后回复「已启动后台任务，请稍候」并以 `end_turn` 结束
- **THEN** Worker 状态为结果待核实，说明命令已转入后台、未完成并随会话中止，不显示「CLI 工具缺少终态」，命令步骤显示失败及说明

#### Scenario: 同一轮内后台命令补发完成

- **WHEN** 带 `WaitMsBeforeAsync` 的命令在本轮结束前收到 `completed` 更新
- **THEN** 按原有工具结果规则判定，不附加后台说明

#### Scenario: 其他工具缺少终态

- **WHEN** 本轮以 `end_turn` 结束，但还有未带 `WaitMsBeforeAsync` 的工具停在运行中
- **THEN** 仍判失败「CLI 工具缺少终态」

#### Scenario: 原生轮次未正常结束

- **WHEN** 后台命令未终态，且原生轮次以 `cancelled`、`max_tokens` 等非 `end_turn` 结束或用户停止
- **THEN** 按原有失败或停止规则判定，不改判待核实
