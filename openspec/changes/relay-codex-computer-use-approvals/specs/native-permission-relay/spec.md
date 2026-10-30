## ADDED Requirements

### Requirement: Codex Computer Use 授权型 elicitation 转交 DSH
插件 SHALL 仅将已核实的 Computer Use 应用授权型 elicitation 转交 DSH：方法为 `mcpServer/elicitation/request`、MCP 名为 `cua_repl`、mode 为 `form`、schema 为 object 且 properties 为空、无输入要求；元数据包含 `codex_approval_kind: mcp_tool_call` 与 `connector_id: computer-use`，有非空应用显示名或 `tool_params.app`，且 `codex_requires_user_input` 不为 true。threadId MUST 为本轮线程，turnId MUST 为 null 或当前轮次；不要求 `codex_request_type` 或 `tool_name`。其他 elicitation MUST 保持原有失败处理。

#### Scenario: 普通应用授权
- **WHEN** 当前线程发来上述空表单授权，显示应用为 DeepSeek Harness，未带 codex_request_type 或 tool_name
- **THEN** DSH 收到 permission 授权，摘要为「允许 Computer Use 使用应用：DeepSeek Harness」，详情保留 CLI message 和 MCP 名称，以长度受限的字面纯文本显示

#### Scenario: 按 Worker 档位决定
- **WHEN** 已识别的授权请求到达
- **THEN** 与其他原生授权使用同一当前状态与 Worker 档位策略：询问或工作区档按既有审批策略弹窗（中档且父会话不询问时仍拒绝）；规划模式直接拒绝；完全权限按既有规则自动放行，父会话也完全权限且策略为询问时仍询问，不另设 Computer Use 例外

#### Scenario: 输入型与未知 elicitation
- **WHEN** 请求包含非空属性表单、其他输入约束、URL 登录、codex_requires_user_input 为 true、元数据不符或未知 MCP
- **THEN** 不弹授权卡，不回复 accept，沿用不支持交互的错误回复和轮次失败

#### Scenario: 跨线程或跨轮次
- **WHEN** threadId 不属于本轮或非空 turnId 不属于当前轮次
- **THEN** 不转交审批、不放行，保留原有失败处理

### Requirement: Computer Use 授权回复保持原生范围与单次交付
插件 SHALL 将允许一次映射为 `{action: accept, content: {}}`，拒绝映射为 `{action: decline, content: null}`。仅请求元数据 persist 数组明确包含 session 时 SHALL 提供本会话允许并回复 `{action: accept, content: {}, _meta: {persist: session}}`。插件 MUST NOT 回显整份元数据、发送 always 或自行缓存授权。每个请求 ID MUST 最多回复一次；任务停止、超时或轮次结束后的迟到决定 MUST NOT 放行，允许取消或不回复。

#### Scenario: 本会话允许
- **WHEN** 请求 persist 为 [session, always]，用户选择本会话允许
- **THEN** 只回复 session，后续是否询问由 Codex 自身决定

#### Scenario: 无会话授权能力
- **WHEN** persist 缺失、不是数组或未包含 session
- **THEN** 不提供本会话允许选项，不发送会话或永久授权

#### Scenario: 重复请求与迟到回答
- **WHEN** 相同请求 ID 重复到达，或用户回答在停止、超时、轮次完成后到达
- **THEN** 不产生重复审批或重复回复，迟到回答不触发允许

#### Scenario: 回复未送达
- **WHEN** 授权回复发送失败
- **THEN** 轮次按既有回复未送达规则判失败，不能仅因原生 completed 而报告成功
