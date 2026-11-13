## ADDED Requirements

### Requirement: Codex 自身自定义路由
Codex 自身配置（`CODEX_HOME/config.toml` 及项目各级 `.codex/config.toml`）启用自定义 provider、自定义地址或 profile 时，Host SHALL 把这条路线视为 Codex 的自身来源，不再因无法识别账号而拒绝。账号来源版本 SHALL 由该路线的配置文件内容、路由环境变量及配置 `env_key` 所指环境变量的值、`auth.json` 内容的 SHA-256 摘要组成，MUST 不保存、不返回或记录其原文。任一项变化 SHALL 视为换号，按「换号后自动续接」处理。插件 MUST 不解析或改写中转地址，派遣参数不追加 provider 覆盖，执行仍由 Codex 读取用户自身配置；启动 Codex 时 SHALL 只额外传入自身配置 `env_key` 所指、且宿主进程中存在的变量，不传其他继承凭据。

#### Scenario: 中转配置派遣
- **WHEN** Codex 配置 `model_provider` 指向自定义中转，且命令行直接运行 Codex 可正常使用
- **THEN** 插件派遣不再报「无法确认当前自身账号」，按 Codex 自身配置执行

#### Scenario: 中转密钥或配置变化
- **WHEN** 用户修改中转配置文件、`env_key` 所指环境变量或 `auth.json`
- **THEN** 账号来源版本改变，已有任务按换号后自动续接处理，不复用旧版本

#### Scenario: env_key 指定的密钥变量
- **WHEN** 中转配置以 `env_key` 指定密钥变量，且宿主进程中存在该变量
- **THEN** 派遣、续聊与分支启动的 Codex 进程获得该变量，其他未指定的继承凭据不传入

#### Scenario: 只有继承的路由环境变量
- **WHEN** Codex 自身配置未声明路由，只有宿主继承的 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 等变量
- **THEN** 仍按继承凭据拒绝，不把它们当作 Codex 自身中转路线

#### Scenario: 官方账号路径不变
- **WHEN** Codex 未配置任何自定义路由
- **THEN** 仍只接受官方 API Key 或 ChatGPT 登录，绑定与原有实现相同

#### Scenario: 配置读取不安全或格式无效
- **WHEN** 适用的配置文件或 `auth.json` 为符号链接、多重硬链接、读取中被改动，或 `auth.json` 不是 JSON 对象
- **THEN** 仍报无法确认账号，不以部分内容生成来源版本
