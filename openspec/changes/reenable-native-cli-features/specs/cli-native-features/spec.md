## ADDED Requirements

### Requirement: 原生功能默认启用，关闭须有记录理由
插件 SHALL 默认保留 CLI 的原生功能，仅在属于以下类别时关闭：违反两层任务树、破坏账号或凭据隔离、无法遵循当前 DSH 权限预设。每项关闭 MUST 在文档中记录所属类别与理由。账号隔离类关闭（外部插件、导入其他 CLI 配置或凭据、provider 配置导入）MUST 保留。

#### Scenario: 无记录理由的关闭项
- **WHEN** 某原生功能被关闭但不属于上述类别
- **THEN** 该功能恢复启用，或在文档中补记理由后保留

#### Scenario: 账号隔离类入口
- **WHEN** CLI 支持导入其他 CLI 的配置或凭据
- **THEN** 插件继续关闭该入口，文档写明属于账号隔离

### Requirement: Grok 网页搜索与抓取
Grok Worker SHALL 启用其原生网页搜索与网页抓取，规划模式与仅可查看预设下同样可用。

#### Scenario: Grok 查询网页
- **WHEN** Grok 任务需要查找在线资料
- **THEN** Grok 可使用原生网页搜索与抓取，不因插件参数被禁止

### Requirement: OpenCode 与 MiMo 读取用户原生 skill
OpenCode 与 MiMo Worker SHALL 能使用用户自己的原生 skill；provider 配置、外部插件与其他 CLI 凭据导入 MUST 保持隔离。

#### Scenario: 用户已有 OpenCode skill
- **WHEN** 用户在 OpenCode 原生 skill 目录中有 skill
- **THEN** 插件派遣的 OpenCode 任务能发现并使用该 skill，且不读取其他 CLI 的凭据

### Requirement: Pi 命令执行跟随权限预设
Pi Worker 的原生 bash SHALL 仅在父会话为完全权限时启用；其他预设下 MUST NOT 启用 Pi 原生 bash，命令执行由 DSH 备选工具经宿主沙箱与审批提供。OMP 在其原生审批可接 DSH 审批时 SHALL 按预设映射启用，否则与 Pi 相同。

#### Scenario: 完全权限下的 Pi
- **WHEN** 父会话为完全权限，派遣 Pi 写任务
- **THEN** Pi 的原生工具集包含 bash

#### Scenario: 工作区内修改下的 Pi
- **WHEN** 父会话为工作区内修改，Pi 需要执行命令
- **THEN** Pi 原生工具集不含 bash，Pi 通过 DSH 备选命令工具执行，每次经宿主沙箱与审批
