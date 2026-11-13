# Proposal

## Why

用户已授权使用 GPT-6.1 Sol 在 macOS、Windows 全量验收，通过后发布 v0.8.1。首次完整运行发现新版 SDK 测试夹具、Windows 原生进程和文件保护兼容问题；普通 npm 包还缺少原生子对话必需的四包界面扩展，开发 Desktop 的成功不能证明用户安装成功。

## What Changes

- 将已授权、可复现的四包原生界面扩展纳入预构建分发，通过官方 bundle 层激活；验证安装、升级、冲突拒绝与卸载恢复。
- 修复 Windows 官方 ConPTY 来源识别和持久遥测文件保护，保持身份、范围退出和只读边界；平台差异使用原生证据。
- 按当前官方 SDK 调整过时夹具，保留业务断言，明确系统专属跳过与未执行项。
- 补齐 Windows Qoder 实际原生 CLI 与官方 npm 入口的自动发现，区分独立 CLI 和编辑器分发别名，保留手动配置、错误拒绝与账号隔离。
- 修复 Qoder 原生账号元数据在 Windows 主动范围收尾时误拒，以及正式 Desktop 的 ASAR/解包终端依赖来源差异；不修改用户账号，不把网络、协议和进程清理失败混为登录成功。
- 冻结同一候选，完成两平台全量、干净安装、正式 Desktop 和指定 Codex 模型验收；通过后发布并回读远端安装包。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `package-distribution`：原生界面必需资产随包交付，安装和卸载经官方配置层完成，保留用户配置及历史。
- `platform-runtime`：Windows 原生文件权限和官方 ConPTY 来源按真实平台核验。

## Impact

影响构建/打包、bundle patch、四包发布资产、Windows 进程入口、Grok/Kimi/Qoder 持久数据读取与相关测试。参考 `scripts/package-release.mjs`、`src/client/harness-native-telemetry.tsx`、`src/host/windows-account-owner.ps1` 和三份 durable reader。保持 v0.8.1；不修改 app.asar，不更换用户模型、账号或系统设置，不把模拟场景写成真实服务通过。原生协议迁移中其他订阅及全部外部 MCP 的未验收事项不借本次归档隐藏。
