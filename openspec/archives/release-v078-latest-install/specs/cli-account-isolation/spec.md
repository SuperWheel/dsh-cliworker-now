## ADDED Requirements

### Requirement: 跨平台原生账号文件读取
Host SHALL 在 macOS 与 Windows 读取 OpenCode、Hermes、Pi 原生账号及私有元数据文件前后检查路径与已打开文件的身份，拒绝符号链接、非普通文件、多硬链接及读取期间的路径替换。平台不支持 `O_NOFOLLOW` 时 MUST 保留相同的拒绝行为；来源错误不得暴露账号内容。POSIX 私有 mode 与 Windows ACL SHALL 按平台能力分别解释，不以 Windows `stat.mode` 宣称私有 ACL 已验证。

#### Scenario: 原生账号文件是符号链接
- **WHEN** 上述 CLI 的账号或私有元数据文件路径指向符号链接，即使当前平台没有 `O_NOFOLLOW`
- **THEN** 账号状态不可用，不读取并使用链接目标中的凭据，不将目标账号视为已登录

#### Scenario: 打开或读取期间文件被替换
- **WHEN** 账号路径在初次检查后、打开或读取期间改为另一个文件或符号链接
- **THEN** 来源检查失败，不返回替换文件中的账号，不暴露其秘密

#### Scenario: 原生普通文件保持稳定
- **WHEN** 账号文件及其路径在检查、打开和读取期间保持同一普通文件身份
- **THEN** 按当前原生账号解析状态，不更改原生内容、目录或账号
