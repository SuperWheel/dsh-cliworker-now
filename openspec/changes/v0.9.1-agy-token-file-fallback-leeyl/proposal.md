# Proposal

## Why

GitHub issue（SuperWheel/dsh-cliworker-now#13，v0.9.0，截图为 Windows）：Antigravity 已登录，账号窗口也显示「当前已登录 Antigravity」，但设置页一直显示「未登录」，模型与强度为空，并提示「Antigravity 无法确认当前自身账号」。

- 设置页的账号状态与账号绑定在 Windows 上只读凭据管理器目标 `gemini:antigravity`（`src/host/windows-agy-account.ps1`）；读不到时投影为 `unconfigured`，设置页显示「未登录」，绑定失败，模型目录随之为空。账号窗口的「已登录」来自 agy 自己的画面，说明 agy 手里有有效登录。
- agy 组合存储支持在凭据库不可用时回退文件；原提案把该逻辑扩展到 macOS 明确无条目的情况，导致旧版原生退出后残留文件被误认作当前登录。2026-11-17 的 1.5.10 二进制静态检查与证据边界见 design.md，撤回「所有 1.5.x /logout 必然两处删除」的推断。

## What Changes

- Windows 保留凭据管理器 `gemini:antigravity` 无项或读取失败时的文件回退；macOS 钥匙串 `gemini`／`antigravity` 明确无条目时判未登录，仅读取失败时再读 `~/.gemini/jetski-standalone-oauth-token`。macOS 钥匙串恢复可读但仅文件有效的场景仍有识别限制，见 design.md。
- 账号状态、账号绑定与模型目录前的登录检查都走同一读取顺序。
- Linux（2026-11-17 报告者在 issue #13 补充）：agy 1.5.x 把登录存在 `~/.gemini/antigravity-cli/antigravity-oauth-token`，插件原先只读旧位置 `jetski-standalone-oauth-token`。改为先读 CLI 文件存储，不存在时再读旧文件；CLI 文件损坏或是链接时报告读取失败，不改读旧文件。macOS 与 Windows 不变。
- 同一账号在凭据库与文件之间切换时绑定不变：Windows 文件来源沿用 `windows-credential:gemini:antigravity` 来源标识，主体计算与凭据管理器帮助脚本一致（Google `sub` 的 SHA-256，或仅有 `id_token_email` 时的小写邮箱）；macOS 两处来源本就同为 `~/.gemini`。
- Windows 两处都没有登录时仍显示未登录；凭据库无项而文件损坏时显示「登录状态读取失败」。macOS 明确无条目时即使旧文件损坏也显示未登录；钥匙串读取失败且文件不可用则报告无法读取。
- Windows 隔离测试清单（`scripts/windows-remote-common.mjs` 与 `.github/workflows/windows.yml`）加入 `tests/agy-windows-account.test.ts`。

## Capabilities

### Modified Capabilities

- `cli-account-isolation`：修改「macOS Antigravity 账号读取系统钥匙串」，新增 Windows 的同类读取顺序要求，新增 Linux 按 CLI 文件存储读取的要求。

## Impact

- 代码：`src/host/account-identity.ts`、`src/host/agy-windows-account.ts`、`src/host/agy-macos-account.ts`、`src/host/cli-account-binding.ts`。
- 测试：`tests/agy-windows-account.test.ts`、`tests/agy-macos-account.test.ts`、`tests/cli-account-binding.test.ts`、`tests/account-identity.test.ts`。
- 不改 agy 的登录流程，不写入、迁移或删除任何凭据；凭据原文仍只在 Host 进程内解析。
