## ADDED Requirements

### Requirement: 已验证 Grok 构建支持账号动态目录

Host SHALL 对通过安装版 ACP initialize 模拟目录验证的精确 Grok 构建，使用其已验证动态 schema 解析当前账号允许的模型和强度；离线内置 fallback MUST NOT 被视为这些构建的动态模型上限。未知构建 SHALL 保持账号目录与原生能力的交集限制。

#### Scenario: 新版账号模型不在离线 fallback

- **WHEN** Grok 1.0.77 (50ca579fa996) 的账号权限允许，目录返回具有已知动态字段的新模型，离线 fallback 不含该 ID
- **THEN** Host 返回该账号模型及已知原生强度，不要求重新登录，不发送 prompt

#### Scenario: 新旧字段及版本输出兼容

- **WHEN** 已验证的 1.0.0 或 1.0.77 输出 camelCase 或 snake_case 目录字段，1.0.77 版本输出可带 stable 标记
- **THEN** Host 使用相同受限动态 schema 并继续排除账号隐藏或拒绝项

#### Scenario: 未验证构建不推定兼容

- **WHEN** Grok 构建号不在精确验证集合且账号模型不在原生目录
- **THEN** Host 继续报告当前 CLI 未支持账号模型，不按版本号大小推定兼容
