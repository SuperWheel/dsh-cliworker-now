# worker-permission-levels Specification

## Purpose

约束 Worker 子会话的三档权限菜单：未选档位时跟随主对话，用户所选档位在续聊与主 Agent 派遣中都按所选运行；第一项按 CLI 实际能力如实命名并经 DSH 询问，规划模式独立于档位，原生模式不可用时降级。

## Requirements

### Requirement: Worker 三档权限菜单
Worker 子会话的权限菜单 SHALL 提供第一项、中档、完全权限三档，名称按 CLI 实际能力确定：第一项在能逐次询问改动的 CLI 上叫「询问」（TRAE CLI CN 由原生只读沙箱加按需审批实现），Kimi 叫「仅工作区编辑」（原生默认模式自动批准 Git 仓库内的编辑），Antigravity 叫「仅规划」，Hermes MUST NOT 显示第一项；中档在有原生自动审批的 CLI 上叫「自动审批」，ZCode、OpenCode、TRAE CLI CN 叫「仅工作区编辑」，OMP、Pi 叫「自动批准编辑」；第三项叫「完全权限」。菜单 SHALL 始终列出该 CLI 的全部档位，不因主对话档位减少。每项 SHALL 带悬停说明，自动审批 SHALL 说明由 CLI 自行判断放行。菜单 MUST NOT 包含规划模式。

#### Scenario: Codex 的菜单
- **WHEN** 主对话为任一档位，用户打开 Codex Worker 的权限菜单
- **THEN** 菜单依次为「询问」「自动审批」「完全权限」，没有「规划（只读）」

#### Scenario: 做不出询问的 CLI
- **WHEN** 用户打开 Kimi、Antigravity、Hermes Worker 的权限菜单
- **THEN** 第一项分别为「仅工作区编辑」「仅规划」和不显示

#### Scenario: TRAE CLI CN 的菜单
- **WHEN** 主对话为任一档位，用户打开 TRAE CLI CN Worker 的权限菜单
- **THEN** 菜单依次为「询问」「仅工作区编辑」「完全权限」；「询问」的悬停说明写明改文件和有副作用的命令先问你，「仅工作区编辑」写明工作区内的改动与命令自动批准、工作区外的改动先问你

#### Scenario: Pi 的菜单
- **WHEN** 主对话为工作区内修改，用户打开 Pi Worker 的权限菜单
- **THEN** 菜单依次为「询问」「自动批准编辑」「完全权限」

#### Scenario: 选择完全权限
- **WHEN** 用户在菜单选择「完全权限」
- **THEN** 先出现 DSH 原生的完全权限确认，确认后才保存

### Requirement: 用户所选档位
Worker 没有保存档位时 SHALL 跟随主对话当时档位：仅可查看对应第一项，工作区内修改对应中档，完全权限对应完全权限。用户在菜单保存档位后，该 Worker 的每一轮（用户续聊、主 Agent 派遣与续聊）SHALL 按所选档位运行，MUST NOT 被主对话档位降低或提高，主 Agent MUST NOT 为此另行询问。菜单当前项 SHALL 显示实际档位。主对话处于规划模式时 MUST 仍拒绝派遣，Worker 规划开关 MUST 仍强制只读。跟随主对话的 Worker 在运行中遇到主对话改档时，本轮已启动的 CLI 不改模式，下一轮起按新档位运行。

#### Scenario: 主对话为工作区内修改时选完全权限
- **WHEN** 主对话为工作区内修改，用户在 Claude Code Worker 菜单选择「完全权限」并确认
- **THEN** 保存成功，此后该 Worker 每轮以原生完全权限运行，时间线写「本轮权限：完全权限」

#### Scenario: 主 Agent 派遣已选档位的 Worker
- **WHEN** Worker 已选「询问」，主对话为完全权限，主 Agent 向该 Worker 续聊
- **THEN** 本轮按「询问」运行，改动前按本轮来源询问用户

#### Scenario: 旧 Worker
- **WHEN** 升级后打开一个之前创建、没有档位记录的 Worker
- **THEN** 菜单显示与主对话对应的档位，行为与升级前相同

### Requirement: 第一项的询问语义
第一项为「询问」时，CLI SHALL 以原生询问模式运行：读取与只读命令可直接执行，改文件与有副作用的命令 SHALL 先经 DSH 询问用户，拒绝时 CLI 收到拒绝且不执行该操作。Pi 没有原生询问模式，SHALL 由插件每轮加载的私有扩展经 Pi 的 `tool_call` 拦截与 RPC `confirm` 询问；扩展在 Pi 报告就绪前 MUST NOT 发送本轮提示，确认失败或无应答 MUST 阻止该调用。主对话为仅可查看且 Worker 没有保存档位时，Worker SHALL 按第一项运行并照常询问。插件 MUST NOT 向 CLI 发送原生永久允许规则；会话级允许只在用户选择「本会话始终允许」时发送。经核实某 CLI 的原生询问模式不能保证改动先问时，该 CLI 的第一项 MUST 改为如实的名称或不提供，且在仅可查看下拒绝派遣。

#### Scenario: 询问档写文件
- **WHEN** Worker 档位为询问，CLI 要修改工作区内文件
- **THEN** 按本轮来源出现 DSH 询问，用户拒绝后文件未被修改

#### Scenario: 仅可查看下的询问
- **WHEN** 主对话为仅可查看，用户派遣没有保存档位的 Codex 修改文件
- **THEN** Codex 以询问模式运行，修改前出现 DSH 询问，不再自动拒绝

#### Scenario: Pi 询问档
- **WHEN** Pi Worker 档位为询问，Pi 要写文件或执行命令
- **THEN** 出现 DSH 询问，用户拒绝后 Pi 收到阻止，文件未被修改、命令未执行；读取文件不询问

### Requirement: 规划模式独立于档位
规划模式 SHALL 是独立于档位的开关：`/plan` 与规划标记读写 Worker 的规划状态，退出规划不改变档位。规划开启时 CLI SHALL 以原生规划或只读模式运行，授权请求 MUST 直接拒绝。不支持规划的 CLI（Hermes、Qoder、Qoder CN、非 ACP 通路的 Kimi）SHALL 不提供规划开关。

#### Scenario: 开启再退出规划
- **WHEN** Worker 档位为自动审批，用户开启规划后又退出
- **THEN** 规划期间 CLI 以原生规划模式运行，退出后档位仍为自动审批

#### Scenario: 不支持规划的 CLI
- **WHEN** 用户在 Hermes Worker 中输入 `/plan`
- **THEN** 提示当前 CLI 不支持规划模式

### Requirement: 原生模式不可用时降级
CLI 安装版本没有某档对应的原生模式，或原生回读与请求不一致时，插件 SHALL 按更严一档运行并在时间线写明实际模式；第一项也不可用时 MUST 拒绝启动并说明原因。Pi 安装版没有文档化的拦截或确认接口时，询问档 SHALL 以只读运行、自动批准编辑档 SHALL 不开放命令，并在时间线说明。插件 MUST NOT 以更宽的模式代替；Antigravity 的例外见「Antigravity 自动审批不可用时的降级」。

#### Scenario: 自动审批不可用
- **WHEN** Worker 档位为自动审批，CLI 的原生模式目录中没有自动审批
- **THEN** 本轮以第一项运行，时间线写明「原生自动审批不可用，本轮按询问运行」

#### Scenario: 原生以另一名称回读询问模式
- **WHEN** Claude Code 以 `manual` 启动，初始化或 `system/init` 回读为 `default`（2.1.287 中二者是同一模式）
- **THEN** 视为询问已确认，正常发送任务；以 `auto` 启动而回读为 `default` 时仍按自动审批不可用降级

### Requirement: Antigravity 自动审批不可用时的降级
Antigravity 自动审批不可用（安装版没有，或账号、主机在运行时报告不支持）时 SHALL 按「仅工作区编辑」运行，由 CLI 自动批准请求、终端保持沙箱限制，时间线写明「本轮按仅工作区编辑运行」。主机报告没有终端沙箱时，插件 MUST NOT 跳过原生确认，只由 CLI 自动批准工作区内编辑、不执行命令，时间线写明主机没有终端沙箱。

#### Scenario: Antigravity 自动审批不可用
- **WHEN** Antigravity Worker 档位为自动审批，安装版没有自动审批或账号报告不支持
- **THEN** 本轮按「仅工作区编辑」运行，终端保持沙箱限制，时间线写明「Antigravity 原生自动审批不可用，本轮按仅工作区编辑运行」，不改为仅规划

#### Scenario: Antigravity 主机没有终端沙箱
- **WHEN** Antigravity Worker 档位为自动审批，CLI 在发送任务前报告此主机没有终端沙箱、自动审批不可用（如 Windows）
- **THEN** 原进程退出后以 `accept-edits` 重新启动，不加跳过确认，工作区内编辑由 CLI 自动批准、命令不执行；时间线写明「Antigravity 原生自动审批在此主机不可用（没有终端沙箱），本轮按仅工作区编辑运行，不执行命令」

### Requirement: 运行时才报告自动审批不可用
安装版列出自动审批、但当前账号在运行时才报告不可用时，插件 SHALL 同样降级：在发送任务前识别到的，先确认原进程退出再以降级模式重启；任务发出后才识别到的 MUST 停止本轮并说明原因，MUST NOT 重发任务或自动重试。降级重启时，未收到任务的原进程 MUST NOT 成为本次运行或后续续聊所用的会话。

#### Scenario: 账号在发送任务前报告不支持自动审批
- **WHEN** Worker 档位为自动审批，CLI 启动后、任务发出前报告当前账号不支持自动审批（如 Antigravity 的 stderr 警告）
- **THEN** 原进程退出后以降级模式重新启动并只发送一次任务，时间线写明实际模式，只绑定新进程的会话

#### Scenario: 账号在任务发出后才报告不支持
- **WHEN** 任务已经发出后，CLI 才报告当前账号不支持自动审批
- **THEN** 停止本轮并报告失败原因，不重发任务、不自动重试

#### Scenario: 初始化回读后降级重启
- **WHEN** Claude Code 初始化回读未确认自动审批，插件改用询问模式重启，而原进程在此之前已带出会话 ID
- **THEN** 只有收到任务的新进程会话绑定到本次运行；续聊恢复该会话，不恢复从未收到任务的原会话

### Requirement: Antigravity 按能力选择 ACP 与规划后备
Antigravity SHALL 仅在安装版帮助确认 acp 的 stdio 入口时选用 ACP；探测失败或旧版 SHALL 保留 stream。没有已核实的原生 ACP 规划模式时，第一项和规划开关 SHALL 使用 stream --mode plan，MUST NOT 以普通 ACP 执行冒充规划。

#### Scenario: 旧版或探测失败
- **WHEN** 安装版不提供 acp --stdio，或能力探测失败
- **THEN** 本轮使用既有 stream 参数与权限检查，明确说明后备，不根据版本字符串猜测能力

#### Scenario: 仅规划
- **WHEN** Worker 开启规划或选择 Antigravity 第一档
- **THEN** 使用已确认的 stream plan；未确认的 --agent 名称不能充当规划模式

### Requirement: Antigravity ACP 权限保持原生边界
ACP 自动审批 SHALL 先以零输入的 stream 启动读取 agy 自己报告的主机终端沙箱状态（与 stream 降级同一依据，不发送输入、不触碰绑定会话）。确认主机有终端沙箱时 SHALL 以原生终端沙箱加跳过确认运行，与 stream 自动审批等价；报告没有沙箱或无法确认时 MUST NOT 跳过确认，原生请求 SHALL 逐条转交 DSH。完全权限 SHALL 关闭终端沙箱并使用原生跳过确认。授权只使用提供的 allow_once/reject_once，MUST NOT 提供会话授权。

#### Scenario: 无终端沙箱
- **WHEN** 在无终端沙箱的主机运行自动审批档
- **THEN** 命令与其他实际到达的权限请求逐条进入 DSH；时间线说明按原生请求逐条询问，不声称工作区编辑自动放行或一定询问

#### Scenario: 停止或超时
- **WHEN** 等待 DSH 审批时用户停止、运行超时或连接关闭
- **THEN** 不再发送允许，撤回等待并清理进程范围；仅确认退出后报告停止完成

#### Scenario: 主机有终端沙箱
- **WHEN** 零输入启动报告账号不支持 auto，或没有警告即发出 init
- **THEN** ACP 以终端沙箱加跳过确认运行，命令不再逐条确认；时间线说明依据

#### Scenario: 沙箱状态无法确认
- **WHEN** 零输入启动在时限内没有任何报告，或提前退出
- **THEN** 不跳过确认，不因平台名称推断沙箱，原生请求逐条转交 DSH；原生启动失败则停止且不重发 prompt

### Requirement: 派遣结果写明实际档位
主 Agent 通过 `cliworker_start` 或 `cliworker_followup` 派遣或续聊 Worker 时，Host SHALL 在返回结果与完成结果中写明本轮实际生效的权限档位名称（按该 CLI 的档位命名）以及来源：规划模式、跟随主对话权限预设（Worker 未选过档位），或用户为该 Worker 选定的档位。写明的档位 SHALL 是任务受理时实际采用的档位，MUST NOT 改变档位的判定规则。

#### Scenario: 未选过档位的 Worker
- **WHEN** 主 Agent 派遣一个用户从未选过档位的 Worker
- **THEN** 结果写明本轮档位跟随主对话权限预设，以及对应的档位名称

#### Scenario: 用户选过档位
- **WHEN** 用户已为该 Worker 选定一个高于主对话预设的档位，主 Agent 续聊
- **THEN** 结果写明本轮按用户为此 Worker 选定的档位运行

#### Scenario: 规划模式
- **WHEN** 主对话处于规划模式时派遣 Worker
- **THEN** 结果写明本轮为规划模式（只读）
