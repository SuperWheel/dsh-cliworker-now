## ADDED Requirements

### Requirement: Grok 只读任务使用私有配置中的拒绝规则
只读 Grok 运行 SHALL 在本次私有 `GROK_HOME/config.toml` 中以 `[permission] deny` 阻止 `Edit`、`Write`、`Bash(mkdir)` 与 `Bash(touch)`，MUST NOT 依赖 Grok 配置不支持的 `permission_mode = "dontAsk"`，也 MUST NOT 修改用户或项目的 Grok/Claude 配置。仅当 DSH 工具桥已就绪且绑定 Grok 时 SHALL 追加 `allow = ["MCPTool(dsh_worker_tools__*)"]`。可写运行的私有配置 MUST NOT 含这些规则。

#### Scenario: 只读任务尝试写入
- **WHEN** 只读 Grok 尝试写文件、`touch` 或 `mkdir`
- **THEN** Grok 按 deny 规则直接拒绝，不发审批请求，项目中不产生文件或目录

#### Scenario: DSH 工具桥
- **WHEN** 只读运行的 DSH 工具桥已就绪且绑定 Grok
- **THEN** 私有配置仅额外允许 `MCPTool(dsh_worker_tools__*)`；工具桥未就绪、绑定其他 CLI 或任务可写时不加该规则

#### Scenario: 可写任务
- **WHEN** 同一 Worker 之后以可写模式运行
- **THEN** 私有配置恢复为不含只读规则的基础配置

### Requirement: Grok 原生 ACP 只读启动与兜底
原生 ACP 启动参数中只读 MUST NOT 依赖 `agent` 之前的全局权限参数，权限参数只出现一次或不出现。ACP 完全不列出模式时，插件 SHALL 以私有配置为准运行只读任务；ACP 列出模式时 MUST 由 ACP 提供并确认 `plan`。其他 CLI 在 ACP 未提供所需模式时 MUST 继续失败关闭。只读任务中插件 MUST 拒绝非工具桥的额外权限请求。

#### Scenario: ACP 不列出模式
- **WHEN** Grok 1.0.62 的 ACP 会话不返回 `modes`，用户派遣只读 Grok 任务
- **THEN** 启动参数不含全局权限参数，不请求 ACP 切换模式，任务正常发送提示

#### Scenario: 其他需审批的调用
- **WHEN** 只读 Grok 发起 deny 规则未覆盖、需审批的调用
- **THEN** 插件拒绝该审批请求

#### Scenario: ACP 列出模式
- **WHEN** ACP 返回可用模式列表
- **THEN** 只读任务必须在列表中找到并切换到 `plan`，否则在发送提示前失败

#### Scenario: 其他 CLI
- **WHEN** 其他 ACP CLI 未列出所需模式
- **THEN** 任务在发送提示前失败，不推定模式
