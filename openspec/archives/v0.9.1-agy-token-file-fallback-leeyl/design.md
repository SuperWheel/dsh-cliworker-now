# Design

## Context

issue #13 是 Windows 上 agy 已登录、插件只读凭据管理器而未识别文件回退的问题。最初把同样的「无条目也回退」扩展到 macOS；用户随后报告基于 f485281 的 Mac Desktop 退出失败，Windows 同流程正常。原任务 2.3 的状态读取和任务 2.4 的绑定都复用了 `readMacAgyLogin`。

### 2026-11-17 只读证据及边界

- 本机 `/usr/bin/security find-generic-password -s gemini -a antigravity` 返回 44（条目不存在）；未用 `-w`/`-g`，输出被捕获且仅报告存在性。`~/.gemini/jetski-standalone-oauth-token` 存在，是普通文件，559 字节，mtime 为 2026-11-05 20:29:27 +08:00；只做 lstat，未读、复制或记录内容。
- `~/.local/bin/agy --version` 返回 **1.5.10**，不是原任务记录的 1.5.9，也不能据此断言用户退出时运行的版本。二进制 SHA-256：`780ee763a9938a37b45c7f9d6ae31747d7c574358fd10c64d3a1cdc36faf2798`。
- 静态字符串含 `Failed to load token from keyring, falling back to file: %v`、超时标记、回退后清理旧钥匙串条目及 `failed to remove token from both keyring (%v) and file (%v)`。**字符串不能单独证明 `/logout` 的实际调用路径或删除成功。**
- 进一步从该二进制 Go pclntab 解析函数地址，再用 CommandLineTools 的 `llvm-objdump --disassemble --start-address=… --stop-address=…` 核对：`compositeTokenStorage.LoadStoredToken`（0x101c0ede0）中钥匙串未返回含 token 的状态会进入文件存储读取（0x101c0ee40）；组合存储确实支持仅文件登录，不能声称 agy 1.5.x 一律忽略残留文件。`compositeTokenStorage.RemoveToken`（0x101c0eac0）包含钥匙串清除及文件存储 RemoveToken 调用；`fileTokenStorage.RemoveToken`（0x101c3c010）可走 `os.Remove` 或 `UpdateStoredToken` 保留无 token 的元数据。故撤回原文「1.5.x /logout 两处都删文件」的笼统结论。未执行原生退出，未确认当前 CLI 的 `/logout` 实际采用此组合存储，也不把 1.5.10 静态分支扩张为所有 1.5.x 版本的行为。
- 已确认的插件根因：`readMacAgyLogin` 把明确无钥匙串条目与读取失败合并，读取任何可解析的旧文件。合成有效文件可重现 `authenticated`，账号绑定也成功；修复后同一模拟场景为 `unconfigured` 并拒绝绑定。本机文件仅取元数据，不能断言其中仍有有效令牌。
- 退出调用链：`accounts.ts` 的初始识别、发命令后的检查、退出轮询和终端退出后的重读都经 `readEvidence → evidence → this.identity → macAgyAccountIdentity → readMacAgyLogin`；设置页也用该 identity，绑定经 `cli-account-binding.ts` 同一读取函数。`createAccountGuide` 为 Antigravity 返回 `AgyAccountGuide`，其 `proves` 要求退出后 **unconfigured**，不是通用 `FlowGuide.proves` 的 `state !== authenticated`。本次保持两者不变。

## Decisions

1. **macOS 区分明确缺失与读取失败。** 采用本次任务明确允许的保守修复：`readMacAgyCredential` 正常返回时直接采用结果，包括 undefined；仅 `MacAgyKeychainError`（拒绝访问、超时、损坏输出等）允许读文件。旧版退出留下文件不再使设置页或绑定恢复已登录。
2. **保留真实读取失败时的回退。** 钥匙串不可读且文件可解析时继续投影账号和绑定；同一账号的来源仍为 `~/.gemini`，不因介质改变而改绑。文件缺失或损坏时保留不可读结论。取消和进程清理未确认仍原样上抛，不读文件掩盖失败。
3. **Windows 完全保留现状。** 凭据管理器无项或不可读时都回退文件，来源保持 `windows-credential:gemini:antigravity`，保留原 issue #13 修复及原 Windows 测试。
4. **不增加凭据写入或清理。** 不删除令牌文件，不写退出时间戳，不触碰钥匙串。没有可证实的活动文件来源或版本判据时，插件不扩大原生退出的副作用。仍用 `readAgyTokenFile` 的有界、拒绝链接、读后比对路径保护。
5. **承认原生组合存储与保守策略的差异。** agy 1.5.10 的组合存储在钥匙串无 token 时可能读文件；若 macOS 曾因写失败/超时转存文件，随后钥匙串恢复可读且无条目，本策略会显示未登录。这是本次最小方案的已知限制，不能宣称完全复刻所有原生存储模式；应保留实机待办，在取得原生实际来源证据后再扩展。当前可验证的兼容范围是 Windows 文件回退，以及 macOS 当次钥匙串仍不可读/超时的文件回退。
6. **Linux 先读 CLI 文件存储，缺失时才读旧文件。** 证据：issue #13 报告者 2026-11-17 补充其系统为 Linux，登录文件在 `~/.gemini/antigravity-cli/antigravity-oauth-token`；本机 agy 1.5.10 二进制含 `auth.cliFileTokenStorage`、`auth.CLITokenFilePath` 与独立的 `-oauth-token` 常量，旧的 `jetski-standalone-oauth-token` 常量位于 `codeassistclient` 包。未取得 Linux 版二进制，CLI 文件与旧文件同时存在时 agy 自身采用哪一个未经反汇编证实；按「新存储优先、缺失才回退」处理，旧文件只服务未迁移的旧版 agy。CLI 文件损坏或是链接时报告读取失败，不改读旧文件，以免旧登录掩盖当前状态。macOS 与 Windows 不改（用户 2026-11-17 要求不影响已定功能）。

## Risks

- 用户重新构建后须在 Mac Desktop 复测退出、关闭后刷新和重新登录；本轮不运行真实登录/退出、账号切换或模型，不更新/重启 Desktop。
- 仅文件且钥匙串已恢复可读的 macOS 原生登录待实机确认；不能把测试夹具视为该场景验收。保留任务 4.1、4.2、5.4，不归档隐藏缺口。
- 回退本修复会重新允许旧文件把退出状态变回 authenticated；优先通过更强的原生活动来源证据解决上述限制，而非恢复无条件回退。
- Linux 没有实机环境，只有模拟测试；若 agy 在 Linux 退出时只删 CLI 文件而保留旧文件，插件会按旧文件误判为已登录，须等报告者反馈确认。
