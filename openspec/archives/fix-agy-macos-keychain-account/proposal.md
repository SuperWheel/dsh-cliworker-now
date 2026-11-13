## Why

用户 2026-10-26 在 macOS 实测（`agy` 1.4.7）：在 Antigravity 账号终端 `/logout` 后，CLI Worker 设置页仍显示已登录；续聊没有提示登录，而是报「CLI 模型查询失败」。

原因：agy 1.1.x 起在 macOS 上把登录凭据存入系统钥匙串（`go-keyring`，service `gemini`、account `antigravity`，与 Windows 凭据管理器 `gemini:antigravity` 同名），只有调用方要求或最近一小时内钥匙串超时才改用 `~/.gemini/jetski-standalone-oauth-token` 文件。`/logout` 清除钥匙串条目，不动遗留文件。插件在 macOS 上的账号状态（`src/host/account-identity.ts`）与账号绑定（`src/host/cli-account-binding.ts`）只读该文件，因此：

- 退出后仍显示已登录，续聊不按「无当前账号」拒绝；
- 在 agy 中换到另一账号后，插件仍按遗留文件识别为原账号，绑定错误，换号续接与选型的账号隔离失效。

本机核对：`/logout` 后钥匙串中 `gemini`/`antigravity` 条目不存在，遗留文件 10-23 写入、未变化；agy 日志报 `You are not logged into Antigravity`。

## What Changes

- macOS 上 Antigravity 的登录状态与绑定改为读取钥匙串 `gemini`/`antigravity` 条目：Host 以参数数组调用 `/usr/bin/security find-generic-password -s gemini -a antigravity -w`，在 Host 进程内解码（`go-keyring-base64:` / `go-keyring-encoded:` 前缀），与 Windows 同样只得到不含凭据的状态、邮箱标签与主体；凭据不写日志、不落盘、不越过读取函数。
- 条目不存在（退出码 44 或无输出）时视为未登录，MUST 不回退到遗留文件；`security` 其他失败时报「无法读取 macOS 钥匙串中的 Antigravity 账号」，不当作未登录或已登录。
- 绑定主体沿用原 POSIX 计算（`oauthPrincipal`，`id_token` 主体优先，回退 `id_token_email`），来源标识仍为 `~/.gemini`（Antigravity 原生账号根）。实测（2026-10-26）钥匙串条目不含 `id_token`、只有 `id_token_email`，而遗留文件含 `id_token`，因此同一账号从文件切换到钥匙串读取后绑定版本会变化一次（主体由 `sub` 变为邮箱）；该变化按 `continue-tasks-across-account-changes` 静默改绑续接，不提示用户，已保存设定不因此失效。
- Linux 不变（继续读文件），Windows 不变。

## Capabilities

### Modified Capabilities

- `cli-account-isolation`：新增「macOS Antigravity 账号读取系统钥匙串」。

## Impact

- Host：新增 `src/host/agy-macos-account.ts`；修改 `src/host/agy-windows-account.ts`（`nativeAgyAccountIdentity` 按平台选择）、`src/host/cli-account-binding.ts`。
- 测试：新增 `tests/agy-macos-account.test.ts`；在 macOS 上运行、原本以文件夹具模拟 Antigravity 登录的测试改为模拟钥匙串读取。
- 文档：README、`doc/design.md` 账号来源说明。
- 风险：钥匙串条目若由非 `/usr/bin/security` 写入且 ACL 不信任它，读取时 macOS 可能弹出钥匙串访问提示；需真实验收确认。钥匙串超时后 agy 临时改用文件存储的一小时内，插件会显示未登录。
