## Why

GitHub issue #7（Windows 11、DSH 0.2.1-rc.3、插件 0.8.2/0.8.3、`agy` 1.4.7）：CLI 自身登录与 `agy models` 正常，但在 CLI Worker 中连接 Antigravity 报「Antigravity 无法确认当前自身账号」。

原因：agy 1.4.x 写入 Windows 凭据管理器 `gemini:antigravity` 的 blob 不再包含 `id_token`，只保留 `id_token_email`。`src/host/windows-agy-account.ps1` 只从 `id_token` 的 `sub` 计算 `principalHash`，于是只返回 `{"state":"authenticated"}`；`src/host/cli-account-binding.ts` 的 Windows 分支没有 `principalHash` 就得到空 `entries`，抛出 `CliAccountBindingError`。macOS/Linux 读取 `~/.gemini/jetski-standalone-oauth-token` 时同样只认 `id_token`（访问令牌是不透明字符串，没有 `sub`），若该文件也写成新格式会出现同样的失败。

## What Changes

- Windows 帮助脚本：`id_token` 不可用或缺少邮箱时，读取 `id_token_email`（字符串、去空白后不超过 254 字符、邮箱形状），作为 `email` 输出；仍不输出凭据 blob 或令牌。
- Windows 绑定：有 `principalHash`（`id_token` 的 `sub`）时保持原有 `subjectHash` 主体；没有时以已登录状态下的安全邮箱标签（小写）作为 `oauth` 邮箱主体，与 Codex/Claude 原生登录的邮箱主体一致。未登录或没有安全邮箱时仍拒绝。
- macOS/Linux：账号标签与绑定在 `id_token` 不可用时回退到经 `accountEmail` 校验的 `id_token_email`；`id_token` 存在时其 `sub`/邮箱继续优先。
- 不采用 issue 中「签名主体不可用时让用户确认继续」的 UI 方案：两种字段都来自 CLI 自己写入的本机凭据，`id_token` 在插件内本来也只做本地解码，不做签名校验，邮箱主体不降低现有隔离强度。

## Capabilities

### Modified Capabilities

- `cli-account-isolation`：新增「Antigravity 仅含邮箱的原生凭据」。

## Impact

- Host：`src/host/windows-agy-account.ps1`、`src/host/cli-account-binding.ts`、`src/host/account-identity.ts`。
- 测试：`tests/cli-account-binding.test.ts`、`tests/account-identity.test.ts`、`tests/agy-windows-account.test.ts`。
- 兼容性：同一账号由 agy 从旧格式（含 `id_token`）改写为新格式后，绑定版本由 `subjectHash` 变为邮箱主体，按现有规则视为来源变化——已保存的选型需重新选择，旧任务续聊要求新建任务。不迁移旧绑定。
- 未处理：Windows 帮助脚本无法在 macOS 上执行（无 PowerShell、无凭据管理器），需在 Windows 实机或远程回归中验证。
