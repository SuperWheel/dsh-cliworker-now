# conversation-feature-bridge Specification

## Purpose
CLI 子会话中 Harness 目标、规划、反馈与分支的桥接：能力由 Host 按 CLI 与原生通路判定，不支持的入口禁用并提示原因；目标按轮注入且不自动续轮，反馈只留在 Harness，分支使用 CLI 原生会话分支。

## Requirements

### Requirement: 能力判定与禁用提示
插件 SHALL 按 Worker 的 CLI 与原生 transport 判定 goal、plan、feedback、fork、forkEarlier 是否支持，并写入子会话绑定。不支持的功能入口 MUST 保持可见、禁用，并在悬停或聚焦时显示“当前 CLI 不支持…”的原因；点击或键盘触发 MUST NOT 调用 Host 或产生错误提示。同一控件 MUST 只显示一个提示：插件显示原因时，该原生控件自带的提示与浏览器 `title` MUST NOT 同时出现；原因提示 SHALL 显示在该控件原生提示的同一侧，分支入口（消息操作栏与侧栏菜单）统一在下方。

#### Scenario: 不支持规划的 CLI
- **WHEN** 用户在 Qoder CLI 子会话中把鼠标移到规划入口
- **THEN** 入口显示为禁用并提示“当前 CLI 不支持规划模式”，点击不发起请求、不弹出错误

#### Scenario: 旧绑定
- **WHEN** Client 收到不含 goal/feedback/forkEarlier 能力键的旧 Host 绑定
- **THEN** 绑定仍被接受，三项按不支持处理

#### Scenario: 较早轮次的分支按钮
- **WHEN** 用户在只支持从最新一轮分支的 CLI 子会话中，把鼠标移到较早轮次的分支按钮
- **THEN** 只在按钮下方显示“当前 CLI 只支持从最新一轮分支”，不再同时显示“在新对话中分支”

#### Scenario: 可用的分支按钮
- **WHEN** 用户把鼠标移到最新轮次可用的分支按钮
- **THEN** 只显示原生的“在新对话中分支”

### Requirement: 持久目标
用户 SHALL 能在 CLI 子会话中设置、编辑、暂停、恢复和清除目标。活动目标 MUST 在之后每一轮发送给 CLI 的输入中注入；暂停或清除后 MUST NOT 注入。插件 MUST NOT 因目标存在而自动发起新一轮。

#### Scenario: 设置目标后下一轮
- **WHEN** 用户设置目标后发送一条消息
- **THEN** CLI 收到的本轮输入包含该目标与用户消息，且没有额外自动发起的轮次

#### Scenario: 暂停目标
- **WHEN** 目标被暂停后用户发送消息
- **THEN** CLI 输入不包含目标，GoalBar 显示已暂停

#### Scenario: MiMo 续聊与目标文本无关
- **WHEN** MiMo 已有完成轮，用户在有活动目标或没有目标时继续同一原生会话
- **THEN** 插件 SHALL 遵循原生消息排序，使本轮正常生成新的助手回复，MUST NOT 把上一轮回复当成本轮成功；确实缺少本轮助手终态时仍报告失败

#### Scenario: Qoder CN 首次模型缓存初始化
- **WHEN** 同一 Qoder CN 账号首轮创建模型目录缓存但未增加自定义路由，之后用户继续发送消息
- **THEN** 账号绑定 SHALL 保持不变，允许同会话续聊；真实账号、PAT 或自定义路由变化时 MUST 继续拒绝旧绑定

### Requirement: 反馈仅记录在 Harness
CLI 子会话中的赞踩与反馈 SHALL 通过 Harness 消息评价和会话反馈服务记录；插件 MUST NOT 把反馈发送给 CLI 或厂商，也 MUST NOT 把反馈写入模型上下文。

#### Scenario: 从“+”菜单提交反馈
- **WHEN** 用户在 CLI 子会话中通过“+”菜单打开反馈并提交
- **THEN** 反馈记录在该子会话，CLI 未收到任何新输入

### Requirement: 会话分支
对支持分支的 CLI，用户 SHALL 能从最新完成轮创建分支；对支持较早截点的 CLI，SHALL 能从较早完成轮创建分支。分支 MUST 使用 CLI 原生分支生成新的原生会话 ID，新建同父 Worker 与 Harness 子会话并包含截点前历史；原会话 MUST 保持可继续。Worker 运行中或有排队消息时 MUST 拒绝分支；分支任一步失败 MUST 清理已创建资源、报告错误且不重发原任务。

#### Scenario: 从最新轮分支
- **WHEN** 用户在空闲的 Claude Code 子会话中点击最新一轮的分支按钮
- **THEN** 出现新的 Worker 子会话，含此前历史，其 CLI 会话 ID 与原会话不同，原会话仍可继续发送

#### Scenario: 不支持较早截点
- **WHEN** 用户在 Claude Code 子会话中把鼠标移到较早一轮的分支按钮
- **THEN** 按钮禁用并提示“当前 CLI 只支持从最新一轮分支”

#### Scenario: 运行中拒绝
- **WHEN** Worker 正在运行时调用分支
- **THEN** 请求被拒绝并说明需等待当前运行结束，不创建任何新 Worker

#### Scenario: 原生会话存储沿用
- **WHEN** Pi、OpenCode 或 ZCode 从最新完成轮创建分支，之后重启 Host 或再次分支
- **THEN** 新 Worker MUST 沿用源会话的原生状态目录，新旧会话 ID 保持独立，新分支的后续输入能找到已创建的原生会话

#### Scenario: ZCode 纯对话分支
- **WHEN** ZCode 已有完成轮但没有工作区检查点
- **THEN** 插件 SHALL 从原生消息列表取得最新助手消息 ID，以 `session/fork` 的 message 目标创建包含该轮的分支，MUST NOT 伪造检查点或发送模型任务

### Requirement: CLI 原生工具优先，DSH 工具作为备选
DSH 工具桥 SHALL 以 CLI 原生工具为首选：与该 CLI 当前已启用原生能力重叠的 DSH 工具（本地文件读写编辑、搜索、命令执行，以及与 CLI 原生配置同名的 MCP 服务器）默认 MUST NOT 交给 CLI；CLI 原生缺少或被插件关闭的能力，对应 DSH 工具 SHALL 作为备选提供。重叠判定 MUST 依据按 CLI 维护的能力表，而非工具名称猜测。交出的 DSH 工具描述 SHALL 标明为备选。CLI 有原生开发者指令入口时，插件 SHALL 附简短的原生优先说明，列出实际交出的工具；MUST NOT 改写用户任务内容或覆盖用户自己的指令文件。尚未接通执行的 CLI MUST NOT 收到工具目录。工具执行仍 MUST 经宿主权限与审批链。

#### Scenario: Codex 收到工具目录
- **WHEN** 写任务中 Codex 启动且工具桥已接通
- **THEN** Codex 的 DSH 工具目录不含与其原生能力重叠的读写、搜索与 shell 工具，只含 DSH 独有能力，描述标明备选，并收到原生优先说明

#### Scenario: CLI 原生缺少某能力
- **WHEN** Pi 的原生工具集中没有命令执行工具
- **THEN** DSH 的命令执行工具作为备选交给 Pi，每次执行经宿主权限与审批

#### Scenario: 同一 MCP 两处都配置
- **WHEN** 用户在 CLI 原生配置和 DSH 中配置了同名 MCP 服务器
- **THEN** CLI 只使用原生那一份，DSH 那一份不交出

#### Scenario: skill 来源
- **WHEN** CLI 原生已有 skill 且 DSH 也有获准 skill
- **THEN** CLI 按原生方式使用自己的 skill，DSH skill 仅可经工具桥的读取工具按需获取

#### Scenario: 未接通执行的 CLI
- **WHEN** 某 CLI 的工具桥执行尚未核验
- **THEN** 不向该 CLI 注入工具目录，任务记录说明原因

#### Scenario: 工具返回不支持的内容类型
- **WHEN** 某宿主工具只能返回 CLI 不支持的内容类型
- **THEN** 该工具在目录阶段即被排除，不出现执行成功却报错的结果
