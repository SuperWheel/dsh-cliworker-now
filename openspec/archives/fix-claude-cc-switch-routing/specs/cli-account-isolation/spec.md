# Spec Delta

## MODIFIED Requirements

### Requirement: 自身账号来源
Host SHALL 仅识别各 CLI 自身原生账号目录、插件内该 CLI 登录目录、自己配置的 API Key 和私有环境文件。Host 凭据引用、继承的通用密钥及其他 CLI 账号 MUST 不成为本 CLI 登录证据或由插件注入执行。原生登录同一服务商属于本 CLI 自身来源，不按服务商名称误判跨 CLI；插件不额外提供操作系统级文件禁读隔离。

#### Scenario: 只有其他账号
- **WHEN** 仅 Harness 或其他 CLI 有账号
- **THEN** 本 CLI 无可用模型，任何入口均不能启动模型任务

#### Scenario: 自身 API 配置
- **WHEN** 用户在该 CLI 自身配置中设置 API Key 或私有环境引用
- **THEN** 只允许当前账号确认支持且 CLI 能执行的模型；Claude 自身显式网关配置按其专门目录规则处理。通用环境及其他 CLI 文件引用无效

#### Scenario: Claude 自身配置与继承路由环境
- **WHEN** CC Switch 在 Claude 自身 settings 中写入路由，同时宿主继承了旧的凭据或模型变量
- **THEN** 当前自身 settings 决定查询及执行来源；继承变量被该进程覆盖，不单独作为账号证据，不影响其他 CLI 或改写原生配置

## ADDED Requirements

### Requirement: Claude 官方账号操作独立于网关
Claude 官方登录和退出 SHALL 使用当前原生账号目录与官方认证端点，独立于当前自身网关可达性及其 API 凭据。macOS 与 Windows MUST 保留 CC Switch 路由、原生账号和会话，且拒绝无法安全隔离的账号目录重定向或强制托管覆盖。

#### Scenario: 路由关闭或旧环境仍存在
- **WHEN** 用户关闭 CC Switch 路由后从插件登录官方 Claude 账号
- **THEN** 原生官方登录流程可启动，旧的路由环境不会阻塞或把登录指向代理

#### Scenario: 登录时路由仍在运行
- **WHEN** 用户在自身 API 路由配置存在时启动官方登录或退出
- **THEN** 操作仅作用于官方账号存储，路由 settings 不变；路由开启时新任务仍使用自身选定路由

#### Scenario: 无法覆盖的托管来源
- **WHEN** 原生托管配置强制认证或账号目录来源，无法安全选择官方账号
- **THEN** 返回明确的来源错误，不启动登录或使用其他账号
