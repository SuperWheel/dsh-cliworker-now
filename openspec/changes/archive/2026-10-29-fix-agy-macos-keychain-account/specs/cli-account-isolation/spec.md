## ADDED Requirements

### Requirement: macOS Antigravity 账号读取系统钥匙串
在 macOS 上，Host SHALL 以系统钥匙串中 service `gemini`、account `antigravity` 的条目作为 Antigravity 登录状态与账号绑定的唯一来源，通过参数数组调用 `/usr/bin/security` 读取并在 Host 进程内解码；凭据、令牌与条目原文 MUST NOT 写入日志、事件、持久化文件或界面。条目不存在时 MUST 视为未登录，MUST NOT 回退到 `~/.gemini/jetski-standalone-oauth-token`；读取失败时 MUST 报告无法读取，不判为已登录或未登录。绑定主体 SHALL 与原文件来源的计算方式一致，同一账号的绑定版本不因来源切换而改变。

#### Scenario: 原生退出后
- **WHEN** 用户在 Antigravity 中 `/logout`，钥匙串条目已删除而遗留文件仍在
- **THEN** 设置页显示未登录；续聊拒绝启动并提示登录，原会话与绑定保留

#### Scenario: 重新登录原账号
- **WHEN** 用户重新登录同一 Antigravity 账号，钥匙串条目重新写入
- **THEN** 设置页显示已登录及邮箱；已有任务以原绑定原生续接，不追加改绑说明

#### Scenario: 在 agy 中换到另一账号
- **WHEN** 钥匙串条目对应另一账号，遗留文件仍属原账号
- **THEN** 绑定按钥匙串中的账号计算，与原账号不同，按换号处理

#### Scenario: 钥匙串不可读
- **WHEN** `/usr/bin/security` 以非「条目不存在」的状态失败、超时或输出无法解析
- **THEN** 显示无法读取 macOS 钥匙串中的 Antigravity 账号，拒绝绑定，不启动任务
