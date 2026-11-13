# Proposal

## Why

Windows 冷启动首次打开设置会查询全部启用 CLI 的账号，选择模型或强度后的自动保存也会重新校验账号与目录。实机已捕获 Codex、Antigravity 关联的 Windows Terminal 窗口；Codex 的 npm JavaScript 启动器内部使用 `spawn(..., { stdio: 'inherit', env })`，绕过插件直接子进程的隐藏设置。需要修复实际触发层并检查其他后台入口。

## What Changes

- 将后台账号、目录及设置保存的无外部终端窗口行为纳入平台契约，保留必要账号与模型校验。
- 修复已确认的 CLI 启动链缺口，保持原安装身份、argv、环境语义、输出、退出状态及进程范围清理。
- Windows Antigravity 后台模型查询及任务仅在本次子进程设置官方 `AGY_CLI_DISABLE_AUTO_UPDATE=true`，阻止独立更新进程引发窗口；不改系统环境、更新标记或显式账号终端。
- 核对首次设置、手动刷新、模型与强度自动保存，以及其他共用后台入口；显式账号终端继续使用现有内嵌终端。
- 仅执行关联测试及实际 Windows 最小窗口观察，记录其他真实账号／模型未验收的边界。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `platform-runtime`：Windows 设置相关后台进程不得弹出独立终端窗口，包含实际 CLI 启动器内部派生场景。

## Impact

影响 Host 后台启动边界及对应测试、README、设计和验证文档；不改 Harness 核心、账号数据、模型协议、UI 选型逻辑或权限保护。当前版本保持 v0.7.8，不上传 GitHub，不触发真实生成或登录，不执行发布全量验收。
