## ADDED Requirements

### Requirement: Worker 三档权限菜单
Worker 子会话的权限菜单 SHALL 提供第一项、中档、完全权限三档，名称按 CLI 实际能力确定：第一项在能逐次询问改动的 CLI 上叫「询问」，Kimi 叫「仅工作区编辑」（原生默认模式自动批准 Git 仓库内的编辑），Antigravity 叫「仅规划」，Pi 叫「只读」，Hermes MUST NOT 显示第一项；中档在有原生自动审批的 CLI 上叫「自动审批」，ZCode、OpenCode 叫「仅工作区编辑」，OMP、Pi 叫「自动批准编辑」；第三项叫「完全权限」。每项 SHALL 带悬停说明，自动审批 SHALL 说明由 CLI 自行判断放行。菜单 MUST NOT 包含规划模式。

#### Scenario: Codex 的菜单
- **WHEN** 主对话为完全权限，用户打开 Codex Worker 的权限菜单
- **THEN** 菜单依次为「询问」「自动审批」「完全权限」，没有「规划（只读）」

#### Scenario: 做不出询问的 CLI
- **WHEN** 用户打开 Kimi、Antigravity、Pi、Hermes Worker 的权限菜单
- **THEN** 第一项分别为「仅工作区编辑」「仅规划」「只读」和不显示

#### Scenario: 选择完全权限
- **WHEN** 用户在菜单选择「完全权限」
- **THEN** 先出现 DSH 原生的完全权限确认，确认后才保存

### Requirement: 档位不高于主对话
菜单 SHALL 只列出不高于主对话档位的选项：仅可查看对应第一项（第一项不能保证改动先问的 Kimi、Antigravity 不列出，Hermes 本无第一项），工作区内修改对应第一项与中档，完全权限对应三项。每轮 SHALL 按 Worker 保存的选择与主对话当时档位中较低者运行；Worker 没有保存选择时 SHALL 跟随主对话。保存的选择 MUST NOT 因主对话降档被改写，主对话调回后 SHALL 恢复。菜单当前项 SHALL 显示实际档位；受上限影响时说明 SHALL 写明主对话档位与最高可选项。保存高于当前上限的档位 MUST 被拒绝。运行中调低主对话档位时，本轮已启动的 CLI 不改模式，下一轮起按新档位运行。

#### Scenario: 主对话为工作区内修改
- **WHEN** 主对话为工作区内修改，用户打开 Claude Code Worker 的权限菜单
- **THEN** 只有「询问」「自动审批」两项，说明写明最高可选自动审批

#### Scenario: 主对话降档后恢复
- **WHEN** Worker 已选完全权限，用户把主对话改为工作区内修改，派遣一轮后又改回完全权限
- **THEN** 降档期间菜单显示「自动审批」，该轮时间线写「本轮权限：自动审批（受主对话限制）」；改回后菜单恢复为「完全权限」

#### Scenario: 旧 Worker
- **WHEN** 升级后打开一个之前创建、没有档位记录的 Worker
- **THEN** 菜单显示与主对话对应的档位，行为与升级前相同

### Requirement: 第一项的询问语义
第一项为「询问」时，CLI SHALL 以原生询问模式运行：读取与只读命令可直接执行，改文件与有副作用的命令 SHALL 先经 DSH 询问用户，拒绝时 CLI 收到拒绝且不执行该操作。主对话为仅可查看时 Worker SHALL 按第一项运行并照常询问。插件 MUST NOT 向 CLI 发送原生永久允许规则；会话级允许只在用户选择「本会话始终允许」时发送。经核实某 CLI 的原生询问模式不能保证改动先问时，该 CLI 的第一项 MUST 改为如实的名称或不提供，且在仅可查看下拒绝派遣。

#### Scenario: 询问档写文件
- **WHEN** Worker 档位为询问，CLI 要修改工作区内文件
- **THEN** 按本轮来源出现 DSH 询问，用户拒绝后文件未被修改

#### Scenario: 仅可查看下的询问
- **WHEN** 主对话为仅可查看，用户派遣 Codex 修改文件
- **THEN** Codex 以询问模式运行，修改前出现 DSH 询问，不再自动拒绝

### Requirement: 规划模式独立于档位
规划模式 SHALL 是独立于档位的开关：`/plan` 与规划标记读写 Worker 的规划状态，退出规划不改变档位。规划开启时 CLI SHALL 以原生规划或只读模式运行，授权请求 MUST 直接拒绝。不支持规划的 CLI（Hermes、Qoder、Qoder CN、非 ACP 通路的 Kimi）SHALL 不提供规划开关。

#### Scenario: 开启再退出规划
- **WHEN** Worker 档位为自动审批，用户开启规划后又退出
- **THEN** 规划期间 CLI 以原生规划模式运行，退出后档位仍为自动审批

#### Scenario: 不支持规划的 CLI
- **WHEN** 用户在 Hermes Worker 中输入 `/plan`
- **THEN** 提示当前 CLI 不支持规划模式

### Requirement: 原生模式不可用时降级
CLI 安装版本没有某档对应的原生模式，或原生回读与请求不一致时，插件 SHALL 按更严一档运行并在时间线写明实际模式；第一项也不可用时 MUST 拒绝启动并说明原因。插件 MUST NOT 以更宽的模式代替。

#### Scenario: 自动审批不可用
- **WHEN** Worker 档位为自动审批，CLI 的原生模式目录中没有自动审批
- **THEN** 本轮以第一项运行，时间线写明「原生自动审批不可用，本轮按询问运行」
