## ADDED Requirements

### Requirement: 替换同服务商凭据后按凭据变化确认登录
对指定服务商的登录，Host SHALL 在新登录 ID 出现、同一 ID 的凭据发生变化或终端退出码为 0 时确认成功。凭据变化 MUST 通过只存在于 Host 进程内存的密钥派生指纹比较，指纹与凭据值 MUST NOT 写入磁盘、回执或日志。登录前基线不可读时，现存凭据 MUST NOT 被当作新登录；无法确认时 SHALL 向用户说明原因与退出码。

#### Scenario: 替换同一服务商的 API Key
- **WHEN** 用户在 OpenCode、Pi、OMP 或 Hermes 的账号窗口为已登录的服务商重新输入 Key，终端以非零退出码结束或退出后状态稍后才可读
- **THEN** 只要该服务商的凭据在确认时限内发生变化，就显示登录成功并刷新列表

#### Scenario: 基线不可读
- **WHEN** 登录前读取账号状态得到 unavailable 或 unknown
- **THEN** 已存在的登录行不作为新增确认依据，结果显示无法确认及原因

#### Scenario: 退出后持续读不到状态
- **WHEN** 非指定服务商的账号流程在终端退出后连续 3 次读到 unavailable 或 unknown
- **THEN** 停止重试并给出未确认结果，不耗尽整个确认时限
