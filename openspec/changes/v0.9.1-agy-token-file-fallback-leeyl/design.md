# Design

## Context

agy 1.5.9 的令牌存储是组合存储（符号 `codeassistclient.(*compositeTokenStorage)`，含 `peekKeyringStoredToken`、`fallbackSaveTokenToFile`）。程序内相关文本：

- `Failed to load token from keyring, falling back to file: %v`、`Keyring LoadToken timed out after %v, falling back to file storage`
- `Using file-based token storage because a keyring timeout was recorded within the last %v`（更新说明：超时后一小时内跳过钥匙串）
- `Keyring %s failed (%v); using file-based token storage for writes for the rest of this process`
- `Failed to clear stale keyring credential after file fallback: %v`
- `failed to remove token from both keyring (%v) and file (%v)`（`/logout` 两处都删）

文件路径为 `~/.gemini/jetski-standalone-oauth-token`（程序内常量 `jetski-standalone-oauth-token`），内容与钥匙串条目同为 `{auth_method, token, id_token_email, writer_id}`。

## Decisions

1. **按 agy 的读取顺序，而不是只认凭据库。** 「凭据库没有此项 → 读文件」是从「回退写文件后清除凭据库旧凭据」推断的：若 agy 在凭据库无项时不读文件，回退写入后的下一次启动就会丢失登录，清除凭据库也就没有意义。issue #13 的现象（凭据管理器无项、agy 仍为已登录）与此一致。没有反汇编确认分支，真实复现以报告者环境为准（见 tasks 4）。
2. **凭据库读取失败也回退。** agy 在读取失败与超时时都回退文件。若文件不存在或损坏，保留原有「无法读取」结论，不判为未登录或已登录。
3. **不改来源标识。** Windows 绑定沿用 `windows-credential:gemini:antigravity`，避免同一账号因 agy 换存放位置而被判为换号；也避免升级后已有 Windows 绑定全部变化。文件主体按帮助脚本相同算法（`sha256("google:" + sub)` 或小写邮箱）计算。
4. **推翻 macOS「不回退文件」的旧决定。** 旧决定针对 agy 1.4.7 `/logout` 留下旧文件。1.5.x 两处都删；即使仍有 1.4.7 时期留下的旧文件，按决策 1 agy 1.5.x 自己也会加载它，插件显示应与 agy 一致。
5. **不检查 agy 的钥匙串超时标记文件。** 超时标记生效期间 agy 直接用文件，凭据库里可能残留旧条目；该情况下 agy 已在回退后清除旧条目，残留窗口很短，暂不模拟标记逻辑。

## Risks

- 若 agy 实际在凭据库无项时不读文件，插件会在「仅剩旧文件」时显示已登录而 agy 要求登录；派遣会由 agy 自身报未登录。可由报告者或 Windows 实机复测确认。
