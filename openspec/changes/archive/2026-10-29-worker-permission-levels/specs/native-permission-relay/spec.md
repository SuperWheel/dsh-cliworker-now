## MODIFIED Requirements

### Requirement: CLI 权限跟随 DSH 权限预设
插件 SHALL 在每轮启动时确定本轮实际档位：Worker 保存了档位时为所选档位，否则跟随父会话当前的 DSH 权限预设；并把 CLI 映射到其原生对应模式：第一项映射为原生询问模式（Antigravity 为原生规划，Pi 为插件确认扩展询问），中档映射为原生自动审批或工作区编辑模式，完全权限映射为原生完全权限模式。规划模式 SHALL 优先于档位。CLI 没有对应原生模式时 MUST 使用更严一档并在任务记录中说明，MUST NOT 使用比实际档位更宽的模式。插件 MUST NOT 附加自己的操作系统沙箱。

#### Scenario: 完全权限
- **WHEN** 父会话为完全权限，Worker 档位为完全权限，派遣 Codex 写任务
- **THEN** Codex 以原生完全权限模式运行，不出现审批弹窗

#### Scenario: 工作区内修改
- **WHEN** 父会话为工作区内修改，Worker 跟随主对话，Claude Code 编辑工作区内文件
- **THEN** Claude Code 以原生自动审批模式运行，由 CLI 自行判断放行

#### Scenario: Worker 档位与父会话不同
- **WHEN** 父会话为完全权限，Worker 档位为询问
- **THEN** CLI 以原生询问模式运行，改动前询问用户；父会话为工作区内修改而 Worker 档位为完全权限时，CLI 以原生完全权限运行

#### Scenario: 规划模式
- **WHEN** 父会话或 Worker 处于规划模式，无论档位为何
- **THEN** CLI 以原生只读或规划模式运行，写入请求直接拒绝，不弹窗

#### Scenario: CLI 没有对应模式
- **WHEN** 某 CLI 的安装版本没有原生自动审批模式，Worker 实际档位为中档
- **THEN** 以更严一档运行，任务记录说明实际使用的模式

### Requirement: 额外授权请求走 DSH 审批弹窗
本轮实际档位为第一项或中档时，CLI 发出的原生授权请求 SHALL 交由 DSH 用户决定，弹窗位置按本轮来源确定：主 Agent 调用（`cliworker_start` / `cliworker_followup`）发起的轮次 SHALL 在主 Agent 页面以 DSH 原生提问卡询问；用户在 Worker 会话或侧栏中发起的轮次 SHALL 在该 Worker 的原生会话中以 DSH 原生审批面板询问，插件客户端 SHALL 在该轮运行期间保持子会话以便面板呈现，并在 Worker 卡片显示「等待审批」。弹窗 MUST 写明 Worker、CLI、请求内容与工作目录；用户批准后插件回复 CLI 允许，拒绝、关闭、无应答者、超时或任务停止 MUST 回复拒绝。实际档位为完全权限时，CLI 残余的授权请求 SHALL 自动放行（父会话同为完全权限时沿用其审批策略，策略为询问则询问用户），不弹窗，并在时间线记录决定来源为完全权限自动放行；实际档位为中档而父会话审批策略为不询问时 MUST 直接拒绝；规划模式下 MUST NOT 自动放行写入请求。每个请求 SHALL 按其发出时父会话的当前状态与 Worker 档位决定，时间线 SHALL 记录请求内容、决定与决定来源。

#### Scenario: 主 Agent 派遣的任务申请网络
- **WHEN** 父会话为工作区内修改，主 Agent 派遣的 CLI 申请网络访问以安装依赖
- **THEN** 主 Agent 页面出现 DSH 提问卡，用户选择允许一次后 CLI 继续执行，时间线记录决定来源为 DSH 用户

#### Scenario: Worker 会话中续聊的任务申请授权
- **WHEN** 用户在 Worker 会话中发送续聊消息，本轮 CLI 请求执行沙箱外命令
- **THEN** 该 Worker 的原生会话出现 DSH 审批面板，Worker 卡片显示等待审批，用户拒绝时 CLI 收到拒绝

#### Scenario: 仅可查看下的写入请求
- **WHEN** 父会话为仅可查看，Worker 以询问模式运行，CLI 请求写文件
- **THEN** 每次都按本轮来源出现 DSH 弹窗，拒绝时 CLI 收到拒绝

#### Scenario: 父会话完全权限而 Worker 为询问
- **WHEN** 父会话为完全权限且审批策略为不询问，Worker 档位为询问，CLI 请求写文件
- **THEN** 插件不自动放行，按本轮来源询问用户

#### Scenario: 完全权限下的残余请求
- **WHEN** 父会话与 Worker 均为完全权限，CLI 仍发来一个授权请求
- **THEN** 插件不弹窗、回复允许，时间线记录该请求及决定来源为完全权限自动放行

#### Scenario: 无人处理或任务停止
- **WHEN** 弹窗未得到回答时任务被停止，或客户端没有打开对应会话而无可用应答者
- **THEN** 回复 CLI 拒绝，不视为批准，时间线记录决定来源为任务停止或无人应答，停止仍在进程范围退出后才报告

#### Scenario: 运行中切换预设
- **WHEN** 任务运行中用户把父会话预设从完全权限改为工作区内修改
- **THEN** 跟随主对话的 Worker 之后的授权请求按新状态处理，CLI 从下一轮起按新的实际档位启动；已保存档位的 Worker 不受影响
