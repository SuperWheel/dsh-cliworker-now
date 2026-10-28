## MODIFIED Requirements

### Requirement: 额外授权被拒绝后完成的轮次
CLI 的额外权限/授权请求与 DSH 备选工具的授权请求 SHALL 按 DSH 权限预设与用户决定处理（见 `relay-native-approvals-to-host`、`relay-harness-tool-approvals`）。请求被拒绝（DSH 用户拒绝、权限预设或规划模式拒绝、无人应答）后若 CLI 本轮自身正常结束，结果 SHALL 为 completed（已完成），与没有拒绝的轮次一致；MUST NOT 标为 uncertain（结果待核实），Worker 会话 MUST NOT 显示待核实或失败横幅，结果 MUST NOT 附加「工具步骤失败，CLI 已自行处理」说明。被拒绝的请求、决定与决定来源 SHALL 保留在时间线。轮次失败或中断、非零退出、缺少终态、仍有未完成工具、需要额外交互输入的请求或任务停止 MUST 仍按原有规则判定；拒绝时即中断本轮的协议（Claude Code）仍为失败。ACP CLI 本轮没有正文时仍按无正文规则判定。DSH 备选工具被拒后，运行器报告「本轮最后的工具步骤失败后 CLI 直接结束」时，该失败步骤 SHALL 视为被拒绝的工具，结果为已完成。

#### Scenario: 原生授权被拒后正常结束
- **WHEN** Codex 请求在工作区外写文件被 DSH 用户拒绝，随后回复命令未执行并正常结束本轮
- **THEN** Worker 状态为已完成，Worker 会话顶部不显示横幅，时间线保留授权决定「拒绝（DSH 用户）」

#### Scenario: DSH 备选工具被拒后正常结束
- **WHEN** 主 Agent 页面拒绝了 Pi 的 DSH 备选命令工具提权，Pi 随后正常结束本轮
- **THEN** Worker 状态为已完成，不显示「本轮有 1 个工具步骤失败，CLI 已自行处理」

#### Scenario: DSH 备选工具被拒后 CLI 直接结束
- **WHEN** DSH 备选工具被拒后 CLI 没有再执行工具或回复，运行器报告最后的工具步骤失败后直接结束
- **THEN** Worker 状态为已完成

#### Scenario: 拒绝后本轮失败
- **WHEN** 授权被拒绝后，本轮以失败或中断结束、缺少终态或进程非零退出
- **THEN** Worker 状态为失败或中断，不转为已完成

### Requirement: 待核实轮次在原生会话中的结束方式
结果为 uncertain 的轮次在 Harness 原生会话中 SHALL 以正常结束（stop）收尾，MUST NOT 产生失败结束（error / CLI_RUN_FAILED）或额外的空步骤；待核实说明 SHALL 由插件自身的警示提示显示，措辞与任务卡「结果待核实」一致。

#### Scenario: 任务详情不显示处理失败
- **WHEN** 本轮最后的工具步骤失败后 CLI 直接结束，Worker 状态为结果待核实
- **THEN** 任务详情显示本轮回复与待核实警示，不显示「处理失败 / 本轮运行失败 / CLI_RUN_FAILED」

### Requirement: 可恢复的工具失败不决定整轮终态
原生 runner SHALL 将单个工具的失败（非零退出码、失败状态、错误标记）作为该工具步骤的结果保留并展示，MUST NOT 仅因本轮出现过工具失败而把整轮判为失败。整轮终态 SHALL 依据原生轮次终态、协议完整性（会话身份一致、存在终态、无未完成工具）、进程退出与清理结果，以及取消和超时判定。原生终态成功且无其他失败证据时 SHALL 为成功，并在结果说明中注明本轮失败的工具步骤数量；本轮最后一个工具调用失败且其后没有成功工具或非空回复时 SHALL 为 uncertain（结果待核实），MUST NOT 宣称成功。有授权被拒绝的轮次按「额外授权被拒绝后完成的轮次」判定。

#### Scenario: 工具失败后 CLI 自行恢复
- **WHEN** 一个写文件命令以退出码 1 失败，CLI 随后改用其他方式完成，原生轮次以 completed 结束且进程正常退出
- **THEN** Worker 为成功，失败的工具步骤仍显示失败及其输出，结果说明注明本轮有 1 个工具步骤失败

#### Scenario: 最后一步失败后直接结束
- **WHEN** 本轮最后一个工具调用失败，其后 CLI 没有任何成功工具或非空回复即报告 completed
- **THEN** Worker 为结果待核实，提示先核查实际产物、不要自动重试

#### Scenario: 原生轮次本身失败
- **WHEN** 工具失败后原生轮次以 failed 或 interrupted 结束，或缺少终态、仍有未完成工具、进程非零退出
- **THEN** Worker 仍为失败，保留已观察的回复与工具证据

#### Scenario: 取消与超时
- **WHEN** 本轮出现工具失败后用户停止任务或任务超时
- **THEN** 保留中断或超时的既有终态，不转为成功或结果待核实
