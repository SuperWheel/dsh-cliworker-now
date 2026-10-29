# cli-native-features Specification

## Purpose

约束各 CLI Worker 默认保留原生功能（网页、skill、命令执行、记忆），只在违反两层任务树、破坏账号隔离或无法遵循 DSH 权限预设时关闭并记录理由；记忆开关跟随用户原生 CLI 的生效设置并与直接使用共用。

## Requirements

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
Pi Worker 在三档下 SHALL 都开放原生 write、edit 与 bash，由插件每轮加载的私有确认扩展按档位拦截：第一项（询问）读类工具直接执行，写入、编辑与命令先经 DSH 询问；中档（自动批准编辑）写入与编辑直接执行，命令先询问；完全权限不加载确认扩展。确认扩展未就绪时 MUST NOT 开始本轮；安装版没有文档化的拦截或确认接口时，第一项 SHALL 只开放读类工具，中档 MUST NOT 开放原生 bash。OMP 第一项 SHALL 以原生 `always-ask` 运行并开放 bash，每次编辑与命令的原生确认经 DSH 审批后回复 OMP；中档以原生 `write` 运行，编辑自动批准、命令询问；完全权限以原生 `yolo` 运行。

#### Scenario: 完全权限下的 Pi
- **WHEN** 本轮实际档位为完全权限，派遣 Pi 写任务
- **THEN** Pi 的原生工具集包含 bash

#### Scenario: 工作区内修改下的 Pi
- **WHEN** 父会话为工作区内修改，Pi Worker 没有保存档位（按中档「自动批准编辑」运行），Pi 写文件后需要执行命令
- **THEN** Pi 原生工具集包含 bash；写文件不询问，执行命令前出现 DSH 询问，拒绝后命令不执行

#### Scenario: 询问档的 Pi
- **WHEN** 本轮实际档位为第一项，Pi 要修改文件
- **THEN** 出现 DSH 询问，用户拒绝后文件不被修改

#### Scenario: 确认扩展未就绪
- **WHEN** Pi 进程启动后没有报告确认扩展就绪
- **THEN** 本轮不发送提示，报错「Pi 权限确认扩展未加载，本轮未开始」

#### Scenario: 询问档的 OMP
- **WHEN** 本轮实际档位为第一项，OMP 要编辑文件或执行命令
- **THEN** OMP 每次原生确认经 DSH 审批后回复，拒绝时 OMP 不执行该操作

#### Scenario: 工作区内修改下的 OMP
- **WHEN** 父会话为工作区内修改，OMP Worker 没有保存档位（按中档「自动批准编辑」运行），写任务需要执行命令
- **THEN** OMP 以原生 `write` 运行并开放 bash，编辑自动批准；每次命令的原生确认经 DSH 审批后回复 OMP，拒绝时 OMP 不执行该命令

### Requirement: CLI 内部子 Agent 保持关闭
Grok 的子 Agent 与 ZCode 的 Agent、Task、SendMessage、工作流工具 SHALL 保持关闭，文档 MUST 记为两层任务树类别；ZCode 的 Skill 工具 SHALL 随之保持关闭。

#### Scenario: 派遣 Grok 或 ZCode 任务
- **WHEN** 插件启动 Grok 或 ZCode Worker
- **THEN** Grok 带 `--no-subagents` 启动，ZCode 的禁用工具列表含 Agent、Task、SendMessage、Skill 与工作流工具

### Requirement: CLI 记忆跟随用户原生设置
Grok、Hermes 与 ZCode Worker 的记忆 SHALL 与用户原生 CLI 当前生效的设置一致：用户设置过的按其设置，未设置时取该 CLI 的默认值（Grok 关、Hermes 开、ZCode 桌面端关）。启用时 Worker MUST 与用户直接使用该 CLI 共用同一份原生记忆目录，不得复制；关闭时 MUST NOT 读写原生记忆。插件判断开关时 MUST NOT 读取凭据文件。OMP 记忆 SHALL 保持关闭，文档 MUST 记录理由。

#### Scenario: 用户开启了 Grok 记忆
- **WHEN** 用户的 `~/.grok/config.toml` 含 `[memory] enabled = true`，插件派遣 Grok 任务
- **THEN** Grok 不带 `--no-memory` 启动，Worker 的记忆目录指向 `~/.grok/memory-v2`

#### Scenario: 用户从未设置 Grok 记忆
- **WHEN** 用户的 Grok 配置与环境都没有记忆设置
- **THEN** Grok 带 `--no-memory` 启动，Worker 不链接原生记忆

#### Scenario: Hermes 未设置记忆段
- **WHEN** 所选 Hermes 账号的 `config.yaml` 没有 `memory` 段
- **THEN** Worker 按 Hermes 默认开启内置记忆与用户档案，工具集含 `memory`，记忆目录指向该账号的 `memories`

#### Scenario: ZCode 桌面端关闭记忆
- **WHEN** ZCode 桌面端设置未开启记忆
- **THEN** 桥对 `session/requestRuntimePreferences` 回复 `memoryEnabled: false`，Worker 不链接原生记忆

#### Scenario: OMP 记忆
- **WHEN** 插件启动 OMP Worker
- **THEN** OMP 配置为 `memory.backend: off`，即使用户原生 OMP 开启了本地记忆
