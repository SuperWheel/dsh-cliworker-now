## MODIFIED Requirements

### Requirement: macOS Antigravity 账号读取系统钥匙串
在 macOS 上，Host SHALL 区分钥匙串条目缺失与读取失败来确定 Antigravity 登录状态与账号绑定：先读系统钥匙串中 service `gemini`、account `antigravity` 的条目（通过参数数组调用 `/usr/bin/security` 并在 Host 进程内解码）；只有钥匙串读取失败时，才读 `~/.gemini/jetski-standalone-oauth-token`。钥匙串正常读取时 MUST 以结果为准，不读文件；明确条目不存在时 MUST 视为未登录，即使旧令牌文件仍在。钥匙串读取失败且文件不存在或无法解析时 MUST 报告无法读取，不判为已登录或未登录。凭据、令牌与条目原文 MUST NOT 写入日志、事件、持久化文件或界面。同一账号的绑定版本 MUST NOT 因登录在钥匙串与文件之间切换而改变。

#### Scenario: 原生退出后
- **WHEN** 用户在 agy 中 `/logout` 后，钥匙串读取明确返回条目不存在，旧令牌文件仍存在（包括有效或损坏内容）
- **THEN** 设置页显示未登录；续聊拒绝启动并提示登录，原会话与绑定保留

#### Scenario: agy 回退到令牌文件
- **WHEN** 本次钥匙串读取失败或超时，且存在可解析的 agy 登录令牌文件
- **THEN** 设置页显示已登录及邮箱，模型目录与派遣可用，绑定与原钥匙串来源相同

#### Scenario: 重新登录原账号
- **WHEN** 用户重新登录同一 Antigravity 账号，钥匙串条目重新写入
- **THEN** 设置页显示已登录及邮箱；已有任务以原绑定原生续接，不追加改绑说明

#### Scenario: 在 agy 中换到另一账号
- **WHEN** 钥匙串条目对应另一账号，令牌文件仍属原账号
- **THEN** 绑定按钥匙串中的账号计算，与原账号不同，按换号处理

#### Scenario: 钥匙串不可读
- **WHEN** `/usr/bin/security` 以非「条目不存在」的状态失败、超时或输出无法解析，且没有可解析的令牌文件
- **THEN** 显示无法读取 macOS 钥匙串中的 Antigravity 账号，拒绝绑定，不启动任务

## ADDED Requirements

### Requirement: Windows Antigravity 凭据管理器无登录时读取令牌文件
在 Windows 上，Host SHALL 先通过固定帮助脚本读取凭据管理器目标 `gemini:antigravity`；该目标不存在或凭据管理器读取失败时，SHALL 在 Host 进程内有界读取 `%USERPROFILE%\.gemini\jetski-standalone-oauth-token`，按与帮助脚本相同的规则投影状态、邮箱与主体摘要。凭据管理器有登录（含已过期、格式未知）时 MUST 以其为准。文件来源 MUST 使用与凭据管理器相同的来源标识，同一账号的绑定版本不因存放位置变化而改变。凭据原文与令牌 MUST NOT 越过读取函数或进入投影。

#### Scenario: agy 已改用令牌文件
- **WHEN** 凭据管理器中没有 `gemini:antigravity`，令牌文件中是有效的 agy 1.5.x 登录（仅含 `id_token_email`）
- **THEN** 设置页显示已登录及邮箱，绑定成功，模型与强度可选

#### Scenario: 两处都没有登录
- **WHEN** 凭据管理器中没有该目标，令牌文件也不存在
- **THEN** 设置页显示未登录，派遣与续聊提示先登录 Antigravity

#### Scenario: 令牌文件损坏
- **WHEN** 凭据管理器中没有该目标，令牌文件无法解析
- **THEN** 显示登录状态读取失败，拒绝绑定，不显示文件内容
