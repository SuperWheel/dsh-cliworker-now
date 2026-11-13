## ADDED Requirements

### Requirement: Claude 官方账号各操作使用同一原生存放位置
Claude 官方登录、退出、账号终端、状态查询、模型目录读取与 Worker 任务 SHALL 使用同一处原生账号存放位置，即 Claude Code 在当前 Host 环境下的默认位置，与用户在终端直接运行 `claude` 一致。插件 MUST NOT 通过 `--settings` 的 `env` 设置 `CLAUDE_CONFIG_DIR`；Host 自身环境设置了该变量时，子进程 SHALL 在启动时继承同一值。插件 MUST NOT 读取或输出凭据内容，也 MUST NOT 搬移或改写钥匙串条目。状态输出中新增的字段（如 `analyticsDisabled`、`projectsDirectory`、为空的 `orgId`／`orgName`）MUST NOT 影响登录判定。

#### Scenario: 插件内官方登录后立即确认
- **WHEN** 用户在插件「官方登录 / 切换账号」中完成 Claude Code 2.1.311 浏览器授权，账号终端结束
- **THEN** 插件的状态查询读到同一处凭据，登录窗口显示已登录，设置页显示官方账号并加载模型与强度

#### Scenario: 用户自行设置了 CLAUDE_CONFIG_DIR
- **WHEN** DSH 的运行环境中设置了 `CLAUDE_CONFIG_DIR`
- **THEN** 登录、状态查询与任务的 Claude 子进程都在启动时继承该值，状态中的 `configDirectory` 与选定目录一致

#### Scenario: 旧版插件登录写入的凭据
- **WHEN** 用户此前用旧版插件登录，凭据写在带目录哈希后缀的钥匙串条目中
- **THEN** 插件显示未登录并提示原生登录，不读取或迁移该条目；用户重新登录一次后恢复
