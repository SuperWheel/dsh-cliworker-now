## ADDED Requirements

### Requirement: Antigravity 仅含邮箱的原生凭据
Antigravity 原生凭据（Windows 凭据管理器 `gemini:antigravity` 或 `~/.gemini/jetski-standalone-oauth-token`）不含可用 `id_token` 主体但含 `id_token_email` 时，Host SHALL 在本地登录有效的前提下以该邮箱（经安全邮箱校验、小写）作为账号标签与绑定主体。存在可用 `id_token` 主体时 MUST 继续以其为准。邮箱缺失或不安全时 MUST 拒绝绑定，且凭据 blob、令牌 MUST NOT 越过帮助进程或进入投影。

#### Scenario: agy 1.4.x 新凭据格式
- **WHEN** 已登录的 Antigravity 凭据只有 `token` 与 `id_token_email`
- **THEN** 账号显示该邮箱，绑定成功，模型目录与派遣可用

#### Scenario: 同一邮箱续期与大小写
- **WHEN** 原生续期改写了访问或刷新令牌，或邮箱仅大小写不同
- **THEN** 绑定版本不变

#### Scenario: 换号
- **WHEN** `id_token_email` 改为另一邮箱，或凭据由仅邮箱格式变为含 `id_token` 主体
- **THEN** 绑定版本改变，原选型与续聊按账号改变处理

#### Scenario: 邮箱缺失、不安全或未登录
- **WHEN** 既无 `id_token` 主体也无安全邮箱，或本地登录已过期
- **THEN** 拒绝绑定并提示无法确认当前自身账号，不启动任务
