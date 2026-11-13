# cli-native-features Specification

## Purpose

约束各 CLI Worker 默认保留原生功能（网页、skill、命令执行、记忆），只在违反两层任务树、破坏账号隔离或无法遵循 DSH 权限预设时关闭并记录理由；记忆开关跟随用户原生 CLI 的生效设置并与直接使用共用。

## Requirements

### Requirement: 原生功能默认启用，关闭须有记录理由
插件 SHALL 默认保留 CLI 的原生功能，仅在属于以下类别时关闭：破坏账号或凭据隔离、无法遵循当前 DSH 权限预设。每项关闭 MUST 在文档中记录所属类别与理由。账号隔离类关闭（外部插件、导入其他 CLI 配置或凭据、provider 配置导入）MUST 保留。CLI 内部子 Agent 不再作为关闭理由。

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

### Requirement: CLI 内部子 Agent 跟随原生设置
Grok 的子 Agent 与 ZCode 的 Agent、Task、SendMessage、工作流与 Skill 工具 SHALL 跟随用户原生 CLI 的生效设置：用户开过或 CLI 默认开启时启用，用户关闭时保持关闭；插件 MUST NOT 替用户打开原生已关闭的功能。原生子 Agent 的过程 SHALL 只在该 Worker 对话内按 CLI 公开的粒度显示为工具步骤或文本，MUST NOT 在 CLI Worker 窗口新增条目或伪造独立会话、进度。续聊与恢复 MUST 使用与首轮相同的工具开关。

#### Scenario: Grok 默认启动
- **WHEN** 用户原生 Grok 配置未关闭子 Agent，插件启动 Grok Worker
- **THEN** 启动参数与私有配置不再包含 `--no-subagents`、`[subagents] enabled = false` 或 `GROK_SUBAGENTS=0`

#### Scenario: 用户关闭了原生子 Agent
- **WHEN** 用户原生 ZCode 设置禁用了 Task 工具
- **THEN** 插件启动 ZCode 时继续禁用 Task，不替用户打开

#### Scenario: ZCode 续聊
- **WHEN** ZCode Worker 续聊恢复会话
- **THEN** 恢复参数校验接受与首轮相同的禁用工具列表，续聊不因列表变化而失败

#### Scenario: 原生子 Agent 的显示
- **WHEN** Grok 在任务中调用其子 Agent
- **THEN** 子 Agent 过程显示在 Grok Worker 对话内，CLI Worker 窗口不新增条目

### Requirement: 后台原生子 Agent 完成后才结束 Worker 轮次
CLI 原生工具派发即返回、实际工作在后台继续时（Antigravity 的 `invoke_subagent`），插件 MUST NOT 在本轮结束后立即关闭原生进程，而 SHALL 在同一原生会话中按递增间隔自动发送跟进检查。跟进 MUST 标注为 CLI Worker 自动跟进、不是用户消息，并要求不得重新派发。只有待完成标记是本轮最后的内容（之后无正文、无工具调用）时才继续等待，否则结束本轮。等待期间审批、事件与停止有效；总等待受任务超时与插件上限约束，超时 MUST 报告「结果待核实」。待完成标记 MUST NOT 计入输出或出现在流式正文中。没有后台工具的轮次 MUST 只发送一次 prompt。

#### Scenario: Antigravity 生图子 Agent
- **WHEN** Antigravity 调用 `invoke_subagent` 后以 end_turn 结束本轮
- **THEN** 插件保持会话，自动发送跟进检查，直到 Antigravity 汇报子 Agent 结果后才结束 Worker 轮次

#### Scenario: 标记之后同轮送达结果
- **WHEN** 跟进轮先回复待完成标记，随后同一轮内执行工具并给出汇报
- **THEN** 插件结束 Worker 轮次，不再发送跟进，标记不计入输出

#### Scenario: 后台子 Agent 超时
- **WHEN** 跟进检查用尽仍只收到待完成标记
- **THEN** Worker 结果为「结果待核实」，提示核查实际产物

#### Scenario: 等待期间停止
- **WHEN** 用户在等待后台子 Agent 时停止任务
- **THEN** 不再发送跟进，原生进程退出后才报告停止

### Requirement: 后台跟进对用户可见
每次等待与跟进 SHALL 作为插件说明，显示在 Worker 过程视图和 Worker 子会话窗口中。DSH 聊天不显示 notice 形态的上下文，所以子会话以已完成的被动工具行 `cliworker_auto_followup` 显示，MUST NOT 派发、执行，也不作为用户消息。CLI 自身的其他诊断 MUST NOT 因此进入子会话。

#### Scenario: 跟进在子会话可见
- **WHEN** 插件等待后台子 Agent 并发送跟进检查
- **THEN** Worker 子会话窗口在两次回复之间以 `cliworker_auto_followup` 工具行显示「…秒后由 CLI Worker 自动发送第 N 次跟进检查」与「CLI Worker 自动跟进（非用户消息）…」，正文中没有待完成标记

### Requirement: Antigravity 完成本轮后的关闭异常判待核实
Antigravity ACP 本轮已以 end_turn 完成并判为成功，而进程随后只以普通非零退出码退出（无信号、无协议错误、Runner 未报告失败）时，结果 SHALL 为「结果待核实」并注明退出码，MUST NOT 判成功或失败，以免主 Agent 重试已完成的工作。其他 CLI、stream 后备路径与信号退出 MUST 保持判失败。

#### Scenario: agy 关闭时崩溃
- **WHEN** agy 汇报完成后关闭时以退出码 2 退出
- **THEN** Worker 结果为「结果待核实」，说明含退出码 2，最终正文保留
