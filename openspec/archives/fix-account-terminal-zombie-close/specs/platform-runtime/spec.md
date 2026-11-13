## ADDED Requirements

### Requirement: POSIX 账号终端关闭先结束 CLI
在 macOS 与 Linux 上关闭仍在运行的原生账号终端时，插件 SHALL 先请求该终端的前台 CLI 退出（SIGTERM），最多等待配置的宽限时间，再由宿主终端清理确认整个范围退出；CLI 已退出时 MUST 不再发送任何信号。CLI 未在宽限时间内退出时仍执行原清理，无法确认时保持“清理失败、继续占用”的原语义。

#### Scenario: 登录辅助进程成为僵尸
- **WHEN** CLI 登录时派生的辅助进程已结束但未被 CLI 回收，用户随后关闭账号终端
- **THEN** CLI 先退出、僵尸由系统回收，清理成功，状态为已关闭且解除占用

#### Scenario: CLI 忽略 SIGTERM
- **WHEN** CLI 在宽限时间内未退出
- **THEN** 继续调用宿主清理，结果以清理是否确认为准

#### Scenario: CLI 已自行退出
- **WHEN** 用户在 CLI 中退出后终端随之结束
- **THEN** 不向任何进程发送信号，只完成清理
