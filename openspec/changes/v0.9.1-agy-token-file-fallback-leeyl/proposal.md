# Proposal

## Why

GitHub issue（SuperWheel/dsh-cliworker-now#13，v0.9.0，截图为 Windows）：Antigravity 已登录，账号窗口也显示「当前已登录 Antigravity」，但设置页一直显示「未登录」，模型与强度为空，并提示「Antigravity 无法确认当前自身账号」。

- 设置页的账号状态与账号绑定在 Windows 上只读凭据管理器目标 `gemini:antigravity`（`src/host/windows-agy-account.ps1`）；读不到时投影为 `unconfigured`，设置页显示「未登录」，绑定失败，模型目录随之为空。账号窗口的「已登录」来自 agy 自己的画面，说明 agy 手里有有效登录。
- agy 1.5.9（Mac 与 Windows 测试机同版本）的登录存放在组合存储 `compositeTokenStorage` 中：先系统凭据库，再 `~/.gemini/jetski-standalone-oauth-token`。程序内的日志与更新说明（`strings ~/.local/bin/agy`）写明：凭据库超时后一小时内改用文件、凭据库写入失败后本进程余下写入都走文件、读凭据库失败时回退读文件、回退写文件后清除凭据库里的旧凭据，`/logout` 同时删除凭据库与文件。
- 因此 agy 回退到文件时，凭据库里没有这一项，插件判为未登录，与 agy 实际状态不一致。macOS 现行规格（`cli-account-isolation`「macOS Antigravity 账号读取系统钥匙串」）明确禁止回退读文件，理由是 agy 1.4.7 `/logout` 只删钥匙串、留下旧文件；1.5.x 已改为两处都删。

## What Changes

- Windows 与 macOS 读取 Antigravity 登录时按 agy 自己的顺序：先系统凭据库（Windows 凭据管理器 `gemini:antigravity`／macOS 钥匙串 `gemini`／`antigravity`）；凭据库没有这一项或读取失败时，再读 `~/.gemini/jetski-standalone-oauth-token`。凭据库有登录时以凭据库为准，不看文件。
- 账号状态、账号绑定与模型目录前的登录检查都走同一读取顺序。
- 同一账号在凭据库与文件之间切换时绑定不变：Windows 文件来源沿用 `windows-credential:gemini:antigravity` 来源标识，主体计算与凭据管理器帮助脚本一致（Google `sub` 的 SHA-256，或仅有 `id_token_email` 时的小写邮箱）；macOS 两处来源本就同为 `~/.gemini`。
- 两处都没有登录时仍显示未登录；凭据库无项而文件损坏时显示「登录状态读取失败」，不判为已登录。
- Windows 隔离测试清单（`scripts/windows-remote-common.mjs` 与 `.github/workflows/windows.yml`）加入 `tests/agy-windows-account.test.ts`。

## Capabilities

### Modified Capabilities

- `cli-account-isolation`：修改「macOS Antigravity 账号读取系统钥匙串」，新增 Windows 的同类读取顺序要求。

## Impact

- 代码：`src/host/account-identity.ts`、`src/host/agy-windows-account.ts`、`src/host/agy-macos-account.ts`、`src/host/cli-account-binding.ts`。
- 测试：`tests/agy-windows-account.test.ts`、`tests/agy-macos-account.test.ts`、`tests/cli-account-binding.test.ts`。
- 不改 agy 的登录流程，不写入、迁移或删除任何凭据；凭据原文仍只在 Host 进程内解析。
