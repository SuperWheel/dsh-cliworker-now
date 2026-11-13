# Spec Delta

## ADDED Requirements

### Requirement: 发起关系标注
由子 Agent 发起的 Worker SHALL 在 CLI Worker 窗口与其他 Worker 同级显示，并在标题行、标题之后以分隔线加文字标注「由 <发起者名称> 发起」（状态之前，过长时省略号截断）；发起者已删除时保留名称。列表 MUST NOT 以缩进、折叠或下级列表表示发起关系。

#### Scenario: 显示发起者
- **WHEN** 用户查看由 Codex-1 发起的 Claude Code Worker
- **THEN** 卡片与 Codex-1 同级，标题行显示「标题｜由 Codex-1 发起」

### Requirement: DSH 子 Agent 在 CLI Worker 窗口统一显示
开关开启时，CLI Worker 窗口 SHALL 列出当前主对话中 DSH 原生调用的直接子 Agent，作为「DSH」分组与各 CLI 分组同级，分组标题 SHALL 像 CLI 分组一样带图标（DSH 官方单色标志）；CLI Worker 自身对应的子会话 MUST NOT 重复列出。条目 SHALL 采用与 CLI Worker 卡片相同的版式：标题与状态一行，下方为插件名称、模型（有公开信息时），右侧箭头，「打开对话 / 删除」放在右键菜单；状态由 DSH 原生事件得出，并参与搜索与「全部 / 进行中 / 已完成 / 异常」筛选。状态 MUST 来自 DSH 原生公开数据，不伪造进度。

#### Scenario: 主 Agent 调用 DSH 子 Agent
- **WHEN** 主 Agent 在当前主对话启动一个 DSH 原生子 Agent
- **THEN** CLI Worker 窗口出现「DSH」分组和对应条目，运行结束后状态随原生事件更新

#### Scenario: CLI Worker 不重复
- **WHEN** 当前主对话同时有 CLI Worker 与 DSH 原生子 Agent
- **THEN** 每个 CLI Worker 只出现在其 CLI 分组，「DSH」分组只含 DSH 原生子 Agent

### Requirement: DSH 子 Agent 打开方式与操作
用户点开 DSH 子 Agent 条目时，插件 SHALL 打开与 CLI Worker 子会话相同样式的窗口，显示其原生记录与统计。可续聊模式（continuable）的子 Agent SHALL 提供续聊与停止，分别调用 DSH 原生 `prompt` 与 `interruptByParent`；一次性或未知模式的子 Agent 只读，输入区与停止不可用。停止 MUST 在原生确认结束后才报告成功。

#### Scenario: 打开已完成的一次性子 Agent
- **WHEN** 用户点开一个已完成的一次性 DSH 子 Agent
- **THEN** 显示其记录与统计，输入区不可用

#### Scenario: 停止运行中的可续聊子 Agent
- **WHEN** 用户在窗口中停止一个运行中的可续聊 DSH 子 Agent
- **THEN** 插件调用原生中断，子会话结束后状态改为已停止；中断失败时显示错误，不报告成功

### Requirement: DSH 子 Agent 名称与按名续聊
插件 SHALL 为每个 DSH 原生子 Agent 分配主对话内唯一的名称 `dsh-<n>`：按插件首次看到的顺序（同批按创建时间）递增，持久保存在插件私有文件（目录 0700、文件 0600）中，隐藏后不复用、不重新编号，不同主对话分别编号。CLI Worker 的名称 MUST NOT 使用 `dsh-<n>` 格式。主 Agent SHALL 能通过 `cliworker_followup` 的 `worker_name` 按该名称（不区分大小写）续聊可续聊模式的 DSH 子 Agent，请求经 DSH 原生 `prompt` 排队送达，回复以 DSH 子 Agent 消息回到主对话；`cliworker_status` SHALL 列出这些名称并可按名称只读查询。名称先匹配 CLI Worker；只有未匹配时才查找 DSH 子 Agent。显示开关关闭、条目已隐藏、名称不存在或子 Agent 为只读时 MUST NOT 发送，并返回明确错误。

#### Scenario: 按名称续聊
- **WHEN** 用户让主 Agent「继续 dsh-1，补充 X」
- **THEN** 主 Agent 调用 `cliworker_followup`，worker_name 为 dsh-1，DSH 子 Agent 收到消息并在其子会话中回复

#### Scenario: 名称稳定
- **WHEN** 用户隐藏 dsh-2 后主 Agent 又启动一个 DSH 子 Agent
- **THEN** 新子 Agent 名为 dsh-4（已有 dsh-1 至 dsh-3），dsh-1 与 dsh-3 的名称不变

#### Scenario: 保留名称
- **WHEN** 用户把某个 CLI Worker 改名为 dsh-2
- **THEN** 插件拒绝并提示该格式保留给 DSH 子 Agent

### Requirement: DSH 子 Agent 显示开关
「CLI Worker 设置 → CLI Worker 设置」SHALL 提供「在 CLI Worker 窗口显示 DSH 子 Agent」开关，默认开启。关闭后 CLI Worker 窗口 MUST 不再列出 DSH 子 Agent，但 DSH 子 Agent 的运行与 DSH 原生入口不受影响；重新开启后立即恢复。「CLI 连接」列表 MUST NOT 为 DSH 新增连接或设置页。

#### Scenario: 默认值
- **WHEN** 用户升级后首次打开设置
- **THEN** 开关为开启

#### Scenario: 关闭开关
- **WHEN** 用户关闭开关
- **THEN** 「DSH」分组立即从 CLI Worker 窗口消失，DSH 子 Agent 照常运行

### Requirement: DSH 子 Agent 数据边界
插件 SHALL 只读取 DSH 原生子 Agent 的公开目录、状态与记录，MUST NOT 复制或改写其会话数据。在 CLI Worker 窗口删除 DSH 子 Agent 条目 SHALL 只在插件内隐藏该条目，并提示不影响 DSH 原生会话。

#### Scenario: 删除 DSH 条目
- **WHEN** 用户在 CLI Worker 窗口删除一个 DSH 子 Agent 条目
- **THEN** 条目从列表隐藏，DSH 原生会话与记录保持不变
