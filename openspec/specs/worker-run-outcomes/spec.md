# worker-run-outcomes Specification

## Purpose
让用户及主 Agent 依据本轮公开回复、工具事件、进程退出和上游汇总分别判断结果，保留部分执行与错误证据，避免跨轮汇总污染掩盖实际输出或诱发重复执行写入。

## Requirements

### Requirement: 本轮回复与错误独立保留
Worker SHALL 保留本轮已观察到的回复和公开工具记录，并独立返回错误；失败汇总 MUST NOT 覆盖本轮流式正文或以历史 lastResult 冒充本轮输出。正常 SUCCESS 汇总继续按现有规则去重。

#### Scenario: 已有正文后失败
- **WHEN** 本轮已有回复或工具记录，但最终汇总错误、进程非零退出或被取消
- **THEN** 保留实际正文和工具证据，错误独立可见，状态仍准确反映失败或中断

#### Scenario: 汇总重复或陈旧正文
- **WHEN** ERROR 汇总带有与本轮流式正文不同的内容
- **THEN** 不用该内容覆盖已观察的本轮回复，不用上轮结果填充本轮空输出

### Requirement: AGY 续聊汇总冲突终态
AGY 续聊 SHALL 仅在会话身份一致、退出码为零、无取消/解析/清理错误、本轮可识别步骤均 DONE、至少有非空 DONE 回复且无本轮错误证据时，将最终 ERROR 标为 uncertain（结果待核实）。该状态 MUST NOT 宣称成功或已证实历史错误；其他不充分证据仍保留失败。宿主 job 不支持此终态时 SHALL 保守映射 failed，并在结构化结果和说明中保留 uncertain 与禁止自动重试提示。

#### Scenario: DONE 回复与 ERROR 冲突
- **WHEN** 满足上述前提但续聊汇总仍报告 EOF
- **THEN** 展示本轮回复及结果待核实，保留原始汇总错误，提示先核查实际产物，不自动重跑

#### Scenario: 真实失败或部分执行
- **WHEN** 本轮报告错误、仅有工具 DONE、回复未 DONE、缺失结果、非零退出或进程清理失败
- **THEN** 不转为 uncertain 或成功，保留失败及已有结果；取消与超时保留中断

#### Scenario: 持久化与后续操作
- **WHEN** uncertain 记录被重启恢复、筛选、展开过程或再次续聊
- **THEN** 终态可恢复并归入异常，过程用本轮时间结束；续聊仍受原有账号、互斥和清理边界约束

### Requirement: 本轮与累计指标区分
界面 SHALL 以本轮本地时间展示任务时长，将 AGY 上游 result 的耗时和用量标注为 CLI 会话累计；步骤报告的统计 SHALL 按步骤覆盖去重，不与会话累计重复相加，缺失指标不得猜测。

#### Scenario: 累计耗时远大于本轮
- **WHEN** 本轮只有数秒，但 result 报告上千秒及累计用量
- **THEN** 本轮时长不被替换，累计指标单独标注；重复步骤回执不增加统计

### Requirement: 原生回复增量保持消息身份
原生流式回复 SHALL 按已核实的消息、内容块或连续段身份聚合，同一消息的增量只更新同一回复，完成快照只补齐或覆盖对应内容，最终汇总不得造成重复。独立回复、工具前后阶段及不同运行 MUST 保持边界；不将每个 delta 或 token 作为新消息。

#### Scenario: 一句话分多次增量
- **WHEN** OpenCode、MiMo、Hermes 或其他受支持 CLI 将一条回复分成多帧公开增量
- **THEN** 界面连贯更新同一条回复，不产生逐字碎片或重复最终正文，保留原文标点和空白

#### Scenario: 多消息和工具交错
- **WHEN** 一个原生运行包含多个消息/part、工具调用前后回复、公开思考及最终快照
- **THEN** 只归并相同身份内容，保留消息和工具顺序；公开思考不混入最终正文，停止/失败仍保留已收到的部分回复

### Requirement: 有证据的历史碎片恢复
既有无消息身份的碎片历史 SHALL 在存在完整且一致的本轮原始协议边界、增量与终态正文证据时只读重新投影。MUST 不改写用户原始事件/文件，不重跑任务，不凭相邻位置猜测不同消息归属；缺少证据时保留原文和已有状态。

#### Scenario: 唯一文本块的旧 OpenCode 历史
- **WHEN** 旧记录存在单一可核查消息/文本 part，公开增量拼接、原生完成快照和本轮汇总一致
- **THEN** 显示为对应的一条连贯回复，原始文件保持不变，反复读取结果稳定

#### Scenario: 历史边界缺失或冲突
- **WHEN** 多 part 旧记录缺少逐帧归属，或快照/正文、会话身份、退出结果存在冲突
- **THEN** 不盲目合并、不修饰为成功，保留已有文字和错误，不能隐藏工具或真实独立回复

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

### Requirement: 额外授权被拒绝后完成的轮次
CLI 的额外权限/授权请求与 DSH 备选工具的授权请求 SHALL 按 DSH 权限预设与用户决定处理（见 `relay-native-approvals-to-host`、`relay-harness-tool-approvals`）。请求被拒绝（DSH 用户拒绝、权限预设或规划模式拒绝、无人应答）后若 CLI 本轮自身正常结束，结果 SHALL 为 completed（已完成），与没有拒绝的轮次一致；MUST NOT 标为 uncertain（结果待核实），Worker 会话 MUST NOT 显示待核实或失败横幅，结果 MUST NOT 附加「工具步骤失败，CLI 已自行处理」说明。被拒绝的请求、决定与决定来源 SHALL 保留在时间线。轮次失败或中断、非零退出、缺少终态、仍有未完成工具、授权回复未送达、需要额外交互输入的请求或任务停止 MUST 仍按原有规则判定；拒绝时即中断本轮的协议（Claude Code）仍为失败。ACP CLI 本轮没有正文时仍按无正文规则判定。

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

### Requirement: Codex Computer Use 应用授权被拒后完成的轮次
经核实的 Codex Computer Use 应用授权型 elicitation（边界见 native-permission-relay）SHALL 按「额外授权被拒绝后完成的轮次」判定。非空表单、URL 登录及未知 elicitation 属于需要额外交互输入的请求，MUST NOT 套用该规则。

#### Scenario: Computer Use 应用授权拒绝后正常完成
- **WHEN** 用户或规划模式拒绝了已识别的 Computer Use 应用授权，Codex 正常 completed 且进程退出为零
- **THEN** Worker 为 completed，拒绝保留时间线，不产生失败或待核实横幅，即使最后的 MCP 工具因拒绝而失败

#### Scenario: 输入型 elicitation 未支持
- **WHEN** Codex 请求填写非空表单或 URL 登录，随后本轮正常结束
- **THEN** 保留不支持额外交互的失败，不能套用授权拒绝后的 completed 规则

### Requirement: DSH 备选工具被拒后直接结束的轮次
DSH 备选工具被拒后，运行器报告「本轮最后的工具步骤失败后 CLI 直接结束」时，该失败步骤 SHALL 视为被拒绝的工具，结果为已完成。

#### Scenario: DSH 备选工具被拒后 CLI 直接结束
- **WHEN** DSH 备选工具被拒后 CLI 没有再执行工具或回复，运行器报告最后的工具步骤失败后直接结束
- **THEN** Worker 状态为已完成

### Requirement: 待核实轮次在原生会话中的结束方式
结果为 uncertain 的轮次在 Harness 原生会话中 SHALL 以正常结束（stop）收尾，MUST NOT 产生失败结束（error / CLI_RUN_FAILED）或额外的空步骤；待核实说明 SHALL 由插件自身的警示提示显示，措辞与任务卡「结果待核实」一致。

#### Scenario: 任务详情不显示处理失败
- **WHEN** 本轮最后的工具步骤失败后 CLI 直接结束，Worker 状态为结果待核实
- **THEN** 任务详情显示本轮回复与待核实警示，不显示「处理失败 / 本轮运行失败 / CLI_RUN_FAILED」

### Requirement: Antigravity ACP 选型与会话有原生回读
Antigravity ACP SHALL 使用返回的模型目录及 thought_level 选项设置模型强度，并在输入前回读确认；恢复 SHALL 保持原会话 ID，加载不兼容时仅以同 ID 回退 stream，MUST NOT 静默创建新会话。既有账号绑定、互斥、时限和换号续接边界 SHALL 不变。

#### Scenario: 选型不匹配
- **WHEN** 模型不在目录、强度选项缺失或设置后回读不一致
- **THEN** 输入前停止，不猜模型与强度的映射，不自动重发

#### Scenario: 旧会话恢复
- **WHEN** 旧 stream conversation_id 在 ACP 中可见
- **THEN** 仍实际加载并核对身份；目录可见不等于恢复成功，不兼容时保留同 ID 后备

### Requirement: Antigravity 两种协议保留真实终态
ACP SHALL 结合 tool_call 状态、permission 决定和 stopReason 判定；stream SHALL 将非空 denied_actions 标为待核实，将存在 finished_reason 的部分结果标为失败。MUST NOT 将异常结束、未完成工具、非零退出、取消或清理失败判为成功。

#### Scenario: 用户拒绝后正常结束
- **WHEN** DSH 拒绝原生请求后 ACP 有正文且以 end_turn 完整结束
- **THEN** 按既有用户决定语义完成，保留被拒步骤；没有正文仍为待核实

#### Scenario: stream 假成功
- **WHEN** stream 返回 SUCCESS 但有 denied_actions 或 finished_reason
- **THEN** 分别展示未执行的待核实或部分结果失败，保留正文，不自动重试

### Requirement: Antigravity ACP 用量与附件按能力处理
ACP SHALL 将 prompt usage 映射为本轮遥测，不冒充 stream 会话累计；缺少指标 SHALL 留空。附件 SHALL 遵循 promptCapabilities，未声明图片能力时仅提供路径；fork SHALL 保持不支持。

#### Scenario: 未公开附件或分支能力
- **WHEN** initialize 没有 promptCapabilities 或 session fork
- **THEN** 不发送未经声明的图片块，不开启分支会话

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

### Requirement: 结果说明在 Worker 窗口可见
CLI 本轮带有结果说明（例如因拒绝审批而结束）时，Host SHALL 把该说明以“本轮结果说明”行投影到原生 Worker 窗口的时间线，与写入结果的说明一致；MUST NOT 只保留在结果字段而不在 Worker 窗口显示。

#### Scenario: 拒绝审批后结束本轮
- **WHEN** WorkBuddy 请求的操作被用户拒绝，CLI 随后以 cancelled 结束本轮
- **THEN** Worker 窗口显示“本轮结果说明：因拒绝审批而结束：被拒操作未执行，可续聊继续”

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

### Requirement: Claude Code 选 Haiku 时规划回合的模型映射
Claude Code 选 Haiku 且以原生规划模式运行时，CLI 会以 Sonnet 回答规划回合（官方「haiku in plan mode」行为，类似 opusplan）。此时插件 SHALL 把同一进程初始化返回的唯一 `sonnet` 别名映射（`resolvedModel`）视为与选型一致的主回复模型。初始化未返回唯一 `sonnet` 映射、或不在规划模式时，Sonnet 回复 MUST 仍判「原生回复模型与明确选型不一致」。插件 MUST NOT 据此接受其他模型，也 MUST NOT 改写用户保存的模型选择。

#### Scenario: Haiku 规划回合由 Sonnet 回复
- **WHEN** 选 Haiku 的 Claude Code Worker 在规划模式下，初始化报告 Haiku，主回复消息的模型为本进程 `sonnet` 别名对应的模型
- **THEN** 插件不判模型不一致，方案按规划收尾规则作为结果，终态成功

#### Scenario: 缺少映射或非规划模式
- **WHEN** 初始化未返回唯一 `sonnet` 映射，或 Worker 不在规划模式而主回复为 Sonnet
- **THEN** 插件判「原生回复模型与明确选型不一致」并中止本轮

### Requirement: 手动停止的轮次不由主 Agent 自行续派

Worker 本轮因面板停止按钮或 `cliworker_stop` 结束时，Host 交给主 Agent 的后台作业结果 SHALL 带 `stoppedBy: "user"`，并在 `guidance` 中说明这是用户的决定：除非用户在此之后明确要求继续，主 Agent MUST NOT 调用 `cliworker_followup` 续聊或重新派遣同一任务，向用户说明进度前 SHALL 先只读核查实际产物并以核查结果为准，MUST NOT 凭本轮部分回复推测进度。超时、故障等其他中断 MUST NOT 带 `stoppedBy`。派遣说明与 `cliworker_followup` 工具描述 SHALL 写明同一规则。

#### Scenario: 用户从面板停止
- **WHEN** Worker 运行中，用户在 Worker 详情点「停止生成」，本轮以 `interrupted` 结束且中断原因为用户
- **THEN** 后台作业结果为 `killed`，结果 JSON 含 `status: "interrupted"`、`stoppedBy: "user"` 和 `guidance`：不要自行续聊或重派，先只读核查实际产物再说明进度

#### Scenario: 超时中断
- **WHEN** Worker 本轮因超时被中断
- **THEN** 结果 JSON 为 `status: "interrupted"`，不含 `stoppedBy`，`guidance` 不含手动停止说明

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
