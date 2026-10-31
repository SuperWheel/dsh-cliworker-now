## MODIFIED Requirements

### Requirement: 额外授权被拒绝后完成的轮次
CLI 的额外权限/授权请求（包括经核实的 Codex Computer Use 应用授权型 elicitation，边界见 native-permission-relay）与 DSH 备选工具的授权请求 SHALL 按 DSH 权限预设与用户决定处理（见 `relay-native-approvals-to-host`、`relay-harness-tool-approvals`）。请求被拒绝（DSH 用户拒绝、权限预设或规划模式拒绝、无人应答）后若 CLI 本轮自身正常结束，结果 SHALL 为 completed（已完成），与没有拒绝的轮次一致；MUST NOT 标为 uncertain（结果待核实），Worker 会话 MUST NOT 显示待核实或失败横幅，结果 MUST NOT 附加「工具步骤失败，CLI 已自行处理」说明。被拒绝的请求、决定与决定来源 SHALL 保留在时间线。轮次失败或中断、非零退出、缺少终态、仍有未完成工具、授权回复未送达、需要额外交互输入的请求（非空表单、URL 登录及未知 elicitation）或任务停止 MUST 仍按原有规则判定；拒绝时即中断本轮的协议（Claude Code）仍为失败。ACP CLI 本轮没有正文时仍按无正文规则判定。

#### Scenario: 原生授权被拒后正常结束
- **WHEN** Codex 请求在工作区外写文件被 DSH 用户拒绝，随后回复命令未执行并正常结束本轮
- **THEN** Worker 状态为已完成，Worker 会话顶部不显示横幅，时间线保留授权决定「拒绝（DSH 用户）」

#### Scenario: DSH 备选工具被拒后正常结束
- **WHEN** 主 Agent 页面拒绝了 Pi 的 DSH 备选命令工具提权，Pi 随后正常结束本轮
- **THEN** Worker 状态为已完成，不显示「本轮有 1 个工具步骤失败，CLI 已自行处理」

#### Scenario: 拒绝后改用其他方式完成
- **WHEN** CLI 请求执行 shell 被拒绝，随后改用编辑工具完成并正常结束本轮
- **THEN** Worker 状态为已完成，不显示横幅，时间线保留拒绝的授权决定

#### Scenario: 拒绝后另一个工具失败但本轮正常结束
- **WHEN** 授权被拒绝后，另一个工具失败，CLI 随后正常结束本轮
- **THEN** Worker 状态为已完成，不附加工具失败说明，失败的步骤仍在时间线中显示为失败

#### Scenario: 拒绝后本轮失败
- **WHEN** 授权被拒绝后，本轮以失败或中断结束、缺少终态或进程非零退出
- **THEN** Worker 状态为失败或中断，不转为已完成

#### Scenario: Computer Use 应用授权拒绝后正常完成
- **WHEN** 用户或规划模式拒绝了已识别的 Computer Use 应用授权，Codex 正常 completed 且进程退出为零
- **THEN** Worker 为 completed，拒绝保留时间线，不产生失败或待核实横幅，即使最后的 MCP 工具因拒绝而失败

#### Scenario: 输入型 elicitation 未支持
- **WHEN** Codex 请求填写非空表单或 URL 登录，随后本轮正常结束
- **THEN** 保留不支持额外交互的失败，不能套用授权拒绝后的 completed 规则
