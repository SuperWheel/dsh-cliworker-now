## ADDED Requirements

### Requirement: 额外授权被拒绝后完成的轮次
插件 SHALL 继续拒绝 CLI 的额外权限/授权请求。拒绝后若 CLI 本轮自身正常结束且无其他失败证据，结果 SHALL 为 uncertain（结果待核实），说明 MUST 写明授权已拒绝、请先核查实际产物、不要自动重试；该状态 MUST NOT 宣称成功。被拒绝的工具因拒绝报告的失败 MUST NOT 单独判为工具失败；轮次失败或中断、非零退出、缺少终态、仍有未完成工具、需要额外交互输入的请求 MUST 仍为失败。被拒绝工具以外的工具失败按「可恢复的工具失败不决定整轮终态」判定，MUST NOT 使有拒绝的轮次被报告为成功。拒绝时即中断本轮的协议（Claude Code）仍为失败。

#### Scenario: 拒绝后改用其他方式完成
- **WHEN** CLI 请求执行 shell 被拒绝，随后改用编辑工具完成并正常结束本轮
- **THEN** Worker 状态为结果待核实，保留拒绝诊断与本轮回复，提示先核查实际产物

#### Scenario: 拒绝后本轮失败
- **WHEN** 授权被拒绝后，本轮以失败或中断结束、缺少终态或进程非零退出
- **THEN** Worker 状态为失败，不转为结果待核实

#### Scenario: 拒绝后另一个工具失败但本轮正常结束
- **WHEN** 授权被拒绝后，另一个工具失败，CLI 随后正常结束本轮
- **THEN** Worker 状态为结果待核实，不宣称成功

### Requirement: 待核实轮次在原生会话中的结束方式
结果为 uncertain 的轮次在 Harness 原生会话中 SHALL 以正常结束（stop）收尾，MUST NOT 产生失败结束（error / CLI_RUN_FAILED）或额外的空步骤；待核实说明 SHALL 由插件自身的警示提示显示，措辞与任务卡「结果待核实」一致。

#### Scenario: 任务详情不显示处理失败
- **WHEN** 拒绝授权后 CLI 正常结束，Worker 状态为结果待核实
- **THEN** 任务详情显示本轮回复与待核实警示，不显示「处理失败 / 本轮运行失败 / CLI_RUN_FAILED」
