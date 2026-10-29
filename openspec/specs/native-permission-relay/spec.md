# native-permission-relay Specification

## Purpose
让 CLI Worker 以各 CLI 原生的权限模式运行，并与 DSH 的权限预设和规划模式保持一致；CLI 的额外授权请求和 DSH 备选工具的授权交给 DSH 用户按本轮来源决定，不附加插件沙箱，也不以更宽的模式代替。

## Requirements

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
本轮实际档位为第一项或中档时，CLI 发出的原生授权请求 SHALL 交由 DSH 用户决定，弹窗位置按本轮来源确定：主 Agent 调用（`cliworker_start` / `cliworker_followup`）发起的轮次 SHALL 在主 Agent 页面以 DSH 原生提问卡询问；用户在 Worker 会话或侧栏中发起的轮次 SHALL 在该 Worker 的原生会话中以 DSH 原生审批面板询问，插件客户端 SHALL 在该轮运行期间保持子会话以便面板呈现，并在 Worker 卡片显示「等待审批」。弹窗 MUST 写明 Worker、CLI、请求内容与工作目录；用户批准后插件回复 CLI 允许，拒绝、关闭、无应答者、超时或任务停止 MUST 回复拒绝。

#### Scenario: 主 Agent 派遣的任务申请网络
- **WHEN** 父会话为工作区内修改，主 Agent 派遣的 CLI 申请网络访问以安装依赖
- **THEN** 主 Agent 页面出现 DSH 提问卡，用户选择允许一次后 CLI 继续执行，时间线记录决定来源为 DSH 用户

#### Scenario: Worker 会话中续聊的任务申请授权
- **WHEN** 用户在 Worker 会话中发送续聊消息，本轮 CLI 请求执行沙箱外命令
- **THEN** 该 Worker 的原生会话出现 DSH 审批面板，Worker 卡片显示等待审批，用户拒绝时 CLI 收到拒绝

#### Scenario: 仅可查看下的写入请求
- **WHEN** 父会话为仅可查看，Worker 以询问模式运行，CLI 请求写文件
- **THEN** 每次都按本轮来源出现 DSH 弹窗，拒绝时 CLI 收到拒绝

#### Scenario: 无人处理或任务停止
- **WHEN** 弹窗未得到回答时任务被停止，或客户端没有打开对应会话而无可用应答者
- **THEN** 回复 CLI 拒绝，不视为批准，时间线记录决定来源为任务停止或无人应答，停止仍在进程范围退出后才报告

### Requirement: 授权请求按完全权限与审批策略决定
实际档位为完全权限时，CLI 残余的授权请求 SHALL 自动放行（父会话同为完全权限时沿用其审批策略，策略为询问则询问用户），不弹窗，并在时间线记录决定来源为完全权限自动放行；实际档位为中档而父会话审批策略为不询问时 MUST 直接拒绝；规划模式下 MUST NOT 自动放行写入请求。每个请求 SHALL 按其发出时父会话的当前状态与 Worker 档位决定，时间线 SHALL 记录请求内容、决定与决定来源。

#### Scenario: 父会话完全权限而 Worker 为询问
- **WHEN** 父会话为完全权限且审批策略为不询问，Worker 档位为询问，CLI 请求写文件
- **THEN** 插件不自动放行，按本轮来源询问用户

#### Scenario: 完全权限下的残余请求
- **WHEN** 父会话与 Worker 均为完全权限，CLI 仍发来一个授权请求
- **THEN** 插件不弹窗、回复允许，时间线记录该请求及决定来源为完全权限自动放行

#### Scenario: 运行中切换预设
- **WHEN** 任务运行中用户把父会话预设从完全权限改为工作区内修改
- **THEN** 跟随主对话的 Worker 之后的授权请求按新状态处理，CLI 从下一轮起按新的实际档位启动；已保存档位的 Worker 不受影响

### Requirement: 本会话始终允许使用 CLI 原生会话级授权
主 Agent 页面的提问卡 SHALL 仅在该 CLI 的授权请求原生提供会话级或始终允许回复时，提供「本会话始终允许」选项；用户选择后插件 SHALL 回复该 CLI 的原生会话级允许，后续是否再询问由 CLI 自身决定。插件 MUST NOT 自行记忆或扩大授权；CLI 没有原生会话级回复时 MUST NOT 提供该选项。Worker 会话内的 DSH 原生审批面板只提供允许一次与拒绝。

#### Scenario: Codex 命令请求
- **WHEN** 主 Agent 派遣的 Codex 请求执行命令，用户在提问卡选择本会话始终允许
- **THEN** 插件回复 Codex 原生的会话级允许，时间线记录决定为本会话始终允许

#### Scenario: CLI 没有会话级回复
- **WHEN** 某 CLI 的授权请求只有单次允许与拒绝
- **THEN** 提问卡只显示允许一次与拒绝

### Requirement: 尊重用户原生沙箱配置
插件 SHALL 不以比当前预设更严的轮次参数覆盖用户在 CLI 原生配置中设定的网络与可写目录，规划模式或预设要求更严时除外。继承配置启用网络时插件 MUST NOT 在启动前直接拒绝运行。

#### Scenario: 用户原生配置启用网络
- **WHEN** 预设为工作区内修改，用户 Codex 配置为 workspace-write 且启用网络
- **THEN** 任务沿用该网络设置运行，不在启动前报告权限未保留

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

### Requirement: 授权提问卡分段显示 CLI 内容
主 Agent 页面的授权提问卡 SHALL 以「<Worker>（<CLI>）请求授权」为标题，请求摘要、原因和工作目录 SHALL 作为提问卡正文分段显示，原文中的换行 SHALL 保留。正文中来自 CLI 或工具参数的文字 MUST 按字面显示，MUST NOT 被渲染为链接、格式或 HTML。

#### Scenario: 多行原因分段显示
- **WHEN** Codex 申请执行命令，原因含多行，主 Agent 页面弹出提问卡
- **THEN** 标题为「<Worker>（Codex）请求授权」，正文依次为请求摘要、原因和「工作目录：…」，各自成段，原因内的换行保留

#### Scenario: 命令含 Markdown 符号
- **WHEN** 请求摘要中的命令含 `*`、`_`、反引号、`[...](...)` 或 `<b>`
- **THEN** 提问卡正文按原文显示这些字符，不出现粗体、链接或 HTML 元素

### Requirement: 等待 DSH 备选工具授权时暂停空闲时限
启用空闲时限时，Worker 经工具桥调用的 DSH 备选工具等待用户授权期间，该轮的空闲时限 SHALL 暂停，决定（允许、拒绝、撤回或任务停止）后 SHALL 重新开始计时；总时限 MUST 照常计算。Host 计时与运行器计时的 CLI SHALL 行为一致。

#### Scenario: Codex 等待 DSH 工具授权
- **WHEN** 空闲时限为 2 分钟，Codex 经工具桥调用的 DSH 命令工具申请提权，用户 3 分钟后才允许
- **THEN** 任务不因空闲超时结束，允许后命令执行，空闲时限从决定时重新计时

#### Scenario: Pi 等待 DSH 工具授权
- **WHEN** 空闲时限启用，Pi 的 DSH 备选命令工具等待授权超过空闲时限
- **THEN** 任务不因空闲超时结束

#### Scenario: 总时限仍生效
- **WHEN** 等待授权期间到达总时限
- **THEN** 任务按总时限结束，提问卡撤回，该工具调用不获授权
