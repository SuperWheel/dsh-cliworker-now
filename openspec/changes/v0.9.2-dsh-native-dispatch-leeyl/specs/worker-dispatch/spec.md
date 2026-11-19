# Spec Delta

## ADDED Requirements

### Requirement: 明确指令派遣 DSH 原生子 Agent

插件 SHALL 将主对话中明确调用 `dsh`、`DeepSeek Harness`、`deepseekharness`、`harness` 或 `DeepSeek Harness 原生子 Agent` 的指令识别为 DSH 原生子 Agent 派遣，匹配时忽略别名内的大小写和空格差异，并接受紧随别名的 `cli` 或「命令行」。当前主 Agent 可用 `subagent` 且宿主允许派遣时，指引 SHALL 要求主 Agent 向 `subagent` 传入用户交办的任务。该任务 MUST NOT 调用 `cliworker_start`、进入外部 CLI 选型，或触发外部 Harness 退役及未知 CLI 提示。宿主 SHALL 负责原生子 Agent 的执行和结果交付。

#### Scenario: 直接调用 DSH

- **WHEN** 用户在主对话发送「调用 dsh 帮我总结 README」，且主 Agent 可用 `subagent` 并获宿主放行
- **THEN** 主 Agent 通过 `subagent` 派遣任务，主对话收到原生子 Agent 的结果，面板的原生子 Agent 分组在开启显示时列出该子 Agent，本次调用不打开外部 CLI 选型卡

#### Scenario: 自然语言别名

- **WHEN** 用户明确要求「调用 DeepSeek Harness」「用 deepseekharness 检查这个目录」「调用 harness 帮我审查」「调用 dsh cli 检查代码」或「用 DeepSeek Harness 原生子 Agent 审查这个模块」
- **THEN** 大小写或空格差异均指向同一 DSH 原生派遣入口，提示不包含「外部 Harness CLI 入口已移除」或「本步用户调用的 CLI 无法确定」

#### Scenario: 讨论与引用

- **WHEN** 用户仅询问「dsh 的子 Agent 是什么」「调用 dsh 和 codex 有什么区别」，或只是讨论、引用、否定派遣指令
- **THEN** 插件不生成派遣指引，主 Agent 不因此派遣原生子 Agent 或外部 CLI

#### Scenario: 当前预设没有原生委派工具

- **WHEN** 用户明确请求 DSH 原生派遣，当前主 Agent 的工具列表没有 `subagent`
- **THEN** 主 Agent 告知用户在 Agent 设置中启用子 Agent 工具，且不通过 `workflow`、`agent()`、`subagent_fork` 或外部 CLI 代为执行该任务

#### Scenario: 宿主拒绝原生派遣

- **WHEN** 当前主 Agent 可见 `subagent`，但 DSH 原生权限或层级检查拒绝本次调用
- **THEN** 主 Agent 如实说明失败，不宣称子 Agent 已启动，也不改用其他执行入口

### Requirement: 退役外部 Harness 记录只读

插件 SHALL 按退役的外部 CLI 身份读取 `cli='harness'` 的存量 Worker 记录。用户查看历史时 SHALL 保留原记录的归属和可读内容，续聊或重新派遣这些记录的请求 MUST 被拒绝。向外部 CLI 工具显式传入退役目标 MUST NOT 启动任务；退役 ID 和存量记录 MUST NOT 转为 DSH 原生子 Agent 或 Hermes Agent。

#### Scenario: 查看和续聊旧外部 Harness 任务

- **WHEN** 用户打开旧 Harness Worker 或要求按旧 Worker 的名称或 ID 继续
- **THEN** 插件仍能查看原始记录，续聊被拒绝且保留退役说明，不启动原生子 Agent 或外部进程

#### Scenario: 误传退役 CLI 参数

- **WHEN** 外部 CLI 的派遣工具收到 `cli='harness'` 或解析为退役身份的旧别名
- **THEN** 插件返回退役错误，不进入选型或创建任务

## MODIFIED Requirements

### Requirement: 保守模糊路由与明确意图

插件 SHALL 仅在明确调用上下文解析名称。外部 CLI 名称的轻微拼写误差只有唯一可信候选时才可解析。目标有歧义、名称未知或本步指定多个不同外部 CLI 时，插件 MUST 在启动前返回候选或要求澄清。明确分别交办给 DSH 和一个外部 CLI 的任务 SHALL 按「同次请求的派遣入口指引」处理。普通模型或 CLI 讨论 MUST 不作为自动派遣授权。

#### Scenario: 唯一名称误差

- **WHEN** 明确调用中传入一个与已知较长名称仅差一个字符且具有唯一候选的名称
- **THEN** 返回规范 CLI 和模糊匹配依据

#### Scenario: 歧义与未知名称

- **WHEN** 请求不能唯一确定 CLI 或传入未知名称
- **THEN** 不启动进程、不保存选型，返回澄清信息

#### Scenario: 普通讨论

- **WHEN** 用户仅询问「GLM 模型有哪些」或引用一段调用示例
- **THEN** 插件指引不要求自动派遣，路由提示不将该消息判作执行请求

### Requirement: 同次请求的派遣入口指引

插件 SHALL 在主模型第一次处理已准入的明确派遣请求时，按目标提供当次入口指引。外部 CLI 使用 `cliworker_start` 先选型后启动，主模型无需预问模型、强度或角色。DSH 原生派遣按「明确指令派遣 DSH 原生子 Agent」处理。指引 MUST 区分原始人类消息与插件指引，尊重准入、取消、子 Agent 和工具作用域，且不拦截通用提问工具。`CLI Worker`、`cliworker_start` 和 `cliworker_resolve` MUST 不被解析为 CLI 名称。SHALL 合并同一规范外部 CLI 的重复指令。明确分别交办 DSH 与外部 CLI 时 SHALL 区分各自任务，保留外部 CLI 的选型与权限检查；多个不同外部 CLI、未知目标或真实歧义仍 MUST 拒绝自动选择。

#### Scenario: 原生组装顺序

- **WHEN** Harness 先组装 system prompt 再执行 agent/pre-step，用户本次请求「用agy和我说你好」或「调用 dsh 总结 README」
- **THEN** 本次模型请求已包含对应入口的指引，外部 CLI 指引含 `cli=antigravity`，DSH 指引涉及原生 `subagent`，两者均不延迟到下一步

#### Scenario: 无新增派遣或入口不可见

- **WHEN** 已准入消息无明确人类指令、步骤被拒绝或取消、当前为子 Agent，或请求的外部 CLI 派遣入口不可见
- **THEN** 无明确指令、未准入及取消的步骤不新增派遣指引；子 Agent 不收到 DSH 原生派遣指引，其外部同级派遣沿用原有边界；外部工具不可见时不提供该入口的指引。原始消息与通用提问工具的可见性及执行均保持原样

#### Scenario: 内部选型不变

- **WHEN** 主模型直接调用 `cliworker_start`，仅提供 CLI、标题和任务
- **THEN** 插件呈现完整选型或沿用以前设定的问题，用户完成必要选型前不启动 Worker，已有宿主权限检查保持有效

#### Scenario: 入口说明和明确目标并存

- **WHEN** 本次用户请求「请调用 CLI Worker 的 cliworker_start，只使用 Antigravity（agy）CLI」，或在要求「用 agy cli」后说明 `cliworker_start` 的 `cli` 参数
- **THEN** 入口说明不产生未知目标，提示唯一 antigravity，不误报全部候选

#### Scenario: 当前批次去重与冲突

- **WHEN** 本步已准入的人类消息重复指定同一外部 CLI，或同时明确指定不同外部 CLI
- **THEN** 前者提示唯一规范 CLI，后者继续拒绝自动选择。插件仅依据本步消息处理，不从旧轮次补目标，也不丢弃本批冲突

#### Scenario: 引用与未知名称

- **WHEN** 用户仅引用、讨论或否定派遣，或一个已知目标与明确未知目标并存
- **THEN** 引用、讨论和否定不构成授权，已知目标也不能因舍弃未知目标而自动放行

#### Scenario: DSH 和 Codex 分别执行

- **WHEN** 用户在主对话发送「调用 dsh 和 codex 分别审查这个模块」，两个入口均可用且宿主允许派遣
- **THEN** 主 Agent 用 `subagent` 派遣一个 DSH 原生子 Agent，并通过 `cliworker_start` 显式指定 `cli='codex'`，按 Codex 原有选型和权限流程派遣一个 Codex Worker，两项任务分别执行

#### Scenario: 分别交办时缺少原生工具

- **WHEN** 用户明确把任务分别交给 DSH 与 Codex，主 Agent 看不到 `subagent`，外部 CLI 入口可用
- **THEN** 主 Agent 告知用户如何启用原生子 Agent 工具，Codex 入口仅处理明确交办给 Codex 的任务
