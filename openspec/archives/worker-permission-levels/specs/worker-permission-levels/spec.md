## ADDED Requirements

### Requirement: Worker 三档权限菜单
Worker 子会话的权限菜单 SHALL 提供第一项、中档、完全权限三档，名称按 CLI 实际能力确定：第一项在能逐次询问改动的 CLI 上叫「询问」，Kimi 叫「仅工作区编辑」（原生默认模式自动批准 Git 仓库内的编辑），Antigravity 叫「仅规划」，Hermes MUST NOT 显示第一项；中档在有原生自动审批的 CLI 上叫「自动审批」，ZCode、OpenCode 叫「仅工作区编辑」，OMP、Pi 叫「自动批准编辑」；第三项叫「完全权限」。菜单 SHALL 始终列出该 CLI 的全部档位，不因主对话档位减少。每项 SHALL 带悬停说明，自动审批 SHALL 说明由 CLI 自行判断放行。菜单 MUST NOT 包含规划模式。

#### Scenario: Codex 的菜单
- **WHEN** 主对话为任一档位，用户打开 Codex Worker 的权限菜单
- **THEN** 菜单依次为「询问」「自动审批」「完全权限」，没有「规划（只读）」

#### Scenario: 做不出询问的 CLI
- **WHEN** 用户打开 Kimi、Antigravity、Hermes Worker 的权限菜单
- **THEN** 第一项分别为「仅工作区编辑」「仅规划」和不显示

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
CLI 安装版本没有某档对应的原生模式，或原生回读与请求不一致时，插件 SHALL 按更严一档运行并在时间线写明实际模式；第一项也不可用时 MUST 拒绝启动并说明原因。Pi 安装版没有文档化的拦截或确认接口时，询问档 SHALL 以只读运行、自动批准编辑档 SHALL 不开放命令，并在时间线说明。插件 MUST NOT 以更宽的模式代替。

#### Scenario: 自动审批不可用
- **WHEN** Worker 档位为自动审批，CLI 的原生模式目录中没有自动审批
- **THEN** 本轮以第一项运行，时间线写明「原生自动审批不可用，本轮按询问运行」
