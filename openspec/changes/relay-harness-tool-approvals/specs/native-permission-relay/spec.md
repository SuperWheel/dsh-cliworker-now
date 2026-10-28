## ADDED Requirements

### Requirement: DSH 备选工具的授权请求按轮次来源询问
Worker 经工具桥调用 DSH 备选工具，该工具需要用户审批时（例如 DSH 命令工具申请更宽的沙箱），插件 SHALL 按 CLI 原生授权请求的轮次来源和决定规则处理。

- 主 Agent 调用（`cliworker_start` / `cliworker_followup`）发起的轮次，SHALL 在主 Agent 页面以 DSH 原生提问卡询问。提问卡 MUST 写明 Worker、CLI、DSH 工具名、命令（工具参数里有命令时）、请求原因和工作目录，只提供「允许一次」和「拒绝」。
- 用户在 Worker 会话中发起的轮次，SHALL 由该 Worker 原生会话中的 DSH 审批面板作答。
- 两种来源下，等待期间 Worker 卡片 SHALL 显示「等待审批」，时间线 SHALL 记录请求、决定和决定来源。
- 拒绝、关闭提问卡、无应答者或任务停止时，该工具调用 MUST 不获授权。
- 不属于当前工具桥调用的 DSH 审批请求，插件 MUST NOT 处理，应交给原有应答者。

#### Scenario: 主 Agent 续聊的任务经 DSH 命令工具提权
- **WHEN** 预设为工作区内修改，主 Agent 用 `cliworker_followup` 让 Pi 通过 DSH 备选命令工具，以更宽的沙箱写工作区外的文件
- **THEN** 主 Agent 页面出现提问卡，写明该 Worker、Pi、`bash` 和命令；Worker 卡片显示「等待审批」；用户选择「允许一次」后命令执行，时间线记录决定来源为 DSH 用户

#### Scenario: 主页面拒绝
- **WHEN** 同上，用户在提问卡选择「拒绝」
- **THEN** 命令不执行，DSH 工具向 CLI 返回拒绝，时间线记录「授权决定：拒绝（DSH 用户）」

#### Scenario: Worker 会话中续聊
- **WHEN** 用户在 Worker 会话中续聊，本轮 DSH 命令工具申请提权
- **THEN** 审批出现在该 Worker 原生会话的 DSH 审批面板，主 Agent 页面不出现提问卡，Worker 卡片显示「等待审批」

#### Scenario: 等待中任务停止
- **WHEN** 提问卡尚未回答时任务被停止
- **THEN** 提问卡撤回，该工具调用不获授权，时间线记录决定来源为任务停止

#### Scenario: 以规划模式启动的轮次
- **WHEN** 本轮以规划模式启动（例如仅可查看），DSH 工具仍申请审批
- **THEN** 无论本轮由谁发起，都直接拒绝，不弹出提问卡或审批面板，时间线记录决定来源为规划模式

#### Scenario: 非工具桥的审批请求
- **WHEN** 主 Agent 自己的 DSH 工具、其他会话，或插件为 CLI 原生请求在子会话发起的审批请求进入审批流程
- **THEN** 插件不处理，照常交给 DSH 原有的应答者
