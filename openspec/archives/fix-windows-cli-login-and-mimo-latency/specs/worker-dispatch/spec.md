# Spec Delta

## MODIFIED Requirements

### Requirement: 明确调用与别名路由
插件 SHALL 向主 Agent 提供明确派遣工具及中文调用指引，支持规范名称和常用别名；agy 对应 Antigravity，glm／智谱对应 ZCode。名称解析 SHALL 返回规范 CLI 与解析依据，不得改用其他 CLI 或 shell 执行。同一 CLI 的名称与括号别名 SHALL 归一；不同 CLI 或未知括号内容 MUST 不作为单一可信目标。

#### Scenario: 用户指定 agy
- **WHEN** 用户要求“调用 agy cli 帮我检查代码”
- **THEN** 提示与工具接受该名称并解析为 antigravity，进入插件选型与派遣路径

#### Scenario: 用户指定 glm
- **WHEN** 用户要求“调用 glm cli”并通过插件提交 glm 名称
- **THEN** 解析结果是 zcode，展示 ZCode 模型，不将 GLM 当作已授权模型

#### Scenario: 同名括号别名
- **WHEN** 用户明确要求“只使用 Antigravity（agy）CLI”，或工具传入这一名称与别名
- **THEN** 解析为唯一 antigravity；括号内为 codex 或未知名称时拒绝，不舍弃冲突或未知部分

### Requirement: 同次请求的派遣入口指引
插件 SHALL 在主模型第一次处理已准入的明确 CLI 派遣请求时，提供当前 CLI 对应的入口指引，说明 cliworker_start 先收集选型后启动，无需主模型预先询问模型、强度或角色。指引 MUST 与原始人类消息区分来源，并尊重已准入消息、取消、子 Agent 和工具作用域；不得通过隐藏或拦截通用提问工具实现。入口名 CLI Worker、cliworker_start 和 cliworker_resolve MUST 不被解析为空 CLI 或把后续参数说明当作 CLI 名称；本步同一规范 CLI 的重复明确指令 SHALL 合并，不同 CLI、未知目标和真实歧义继续拒绝。

#### Scenario: 原生组装顺序
- **WHEN** Harness 先组装 system prompt 再执行 agent/pre-step，用户本次请求“用agy和我说你好”
- **THEN** 本次模型请求已经包含 cli=antigravity 和进入插件选型的指引，不等到下一步才生效

#### Scenario: 无新增派遣或入口不可见
- **WHEN** 已准入消息不包含人类派遣、步骤被拒绝或取消、当前为子 Agent 或派遣工具不可见
- **THEN** 不新增派遣指引，不修改原始消息，不改变通用提问工具的可见性或执行

#### Scenario: 内部选型不变
- **WHEN** 主模型直接调用 cliworker_start，仅提供 CLI、标题和任务
- **THEN** 插件呈现完整选型或沿用以前设定的问题，用户完成必要选型前不启动 Worker，已有宿主权限检查保持有效

#### Scenario: 入口说明和明确目标并存
- **WHEN** 本次用户请求“请调用 CLI Worker 的 cliworker_start，只使用 Antigravity（agy）CLI”，或先要求“用 agy cli”后说明“请调用 cliworker_start，参数 cli 必须为 antigravity”
- **THEN** 入口说明不产生未知目标，提示唯一 antigravity，不误报全部候选

#### Scenario: 当前批次去重与冲突
- **WHEN** 本步已准入的人类消息重复指定同一 CLI，或同时明确指定不同 CLI
- **THEN** 前者提示唯一规范 CLI，后者继续拒绝自动选择；不读取全历史凑目标，也不只保留最后一条而丢弃本批冲突

#### Scenario: 引用与未知名称
- **WHEN** 用户仅引用、讨论或否定派遣，或一个已知目标与明确未知目标并存
- **THEN** 不将引用、讨论或否定当作授权，不通过舍弃未知目标放行已知 CLI
