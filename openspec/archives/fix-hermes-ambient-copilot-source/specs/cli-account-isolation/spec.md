## ADDED Requirements

### Requirement: Hermes 原生环境记录不阻断自身账号
Hermes 原生在 `gh` 已登录时会把无令牌的环境 Copilot 记录（`copilot`/`gh_cli`/`api_key`）写入插件自身账号目录。Host SHALL 在该记录未被 `auth.active_provider` 或 `config.yaml` 任何位置选择时，不把它视为外部账号来源，自身账号的登录终端、状态、续期与执行照常进行。Copilot 一旦被选择，该记录 MUST 仍按外部账号拒绝。守卫拒绝 MUST 以固定原因显示在账号终端、状态与续期结果中，MUST NOT 被改写为安装错误或“稍后刷新”。

#### Scenario: 原生选择器写入环境 Copilot 记录
- **WHEN** 插件 Hermes 账号目录的凭据池含未被选择的 `gh_cli` Copilot 记录，且 Nous 自身登录已过期但可续期
- **THEN** 账号终端可以打开，状态查询正常续期并显示已登录，不读取或复制 `gh` 凭据

#### Scenario: 已选择 Copilot
- **WHEN** 插件 Hermes 配置在 model、auxiliary、MoA 或 fallback 中选择了 Copilot，凭据池含 `gh_cli` 记录
- **THEN** 账号终端、状态与续期均拒绝，并显示「Hermes 含外部账号来源，请使用自身登录」，不启动原生续期
