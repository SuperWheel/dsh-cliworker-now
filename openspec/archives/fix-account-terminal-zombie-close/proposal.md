## Why

用户 2026-10-26 在 macOS 实测（`agy` 1.4.7）：在 Antigravity 账号终端 `/login` 成功后关闭终端，界面报「账号终端清理失败，请重试关闭」，该 CLI 一直保持“账号终端占用”，续聊被「请先关闭账号终端」阻止。

本机核对：agy（pid 13692）登录时派生的浏览器打开辅助进程已结束，但 agy 未回收它，留下僵尸子进程（13708 `<defunct>`）。宿主 `dsh-subprocess-local` 的 macOS 终端清理先清后代、存在幸存者即抛出 `terminal cleanup failed; surviving pids: …`，之后才向顶层 CLI 发 SIGTERM；僵尸进程无法被信号结束，只能由父进程回收或父进程退出后由系统回收，因此清理永远在结束 agy 之前失败。合成探针（`.test-data/probe-terminal-zombie.ts`）复现了同样的失败；先对顶层发 SIGTERM、待其退出后再清理即可成功。

## What Changes

- 非 Windows 平台关闭账号终端时，若 CLI 仍在运行，先通过宿主终端句柄向前台进程组发送 SIGTERM，最多等待 `graceMs` 让 CLI 自行退出，再调用宿主 `terminate()` 清理剩余成员；SIGTERM 被忽略时仍按原流程清理并保持原失败语义。
- CLI 已经退出的终端不再发送任何信号，避免进程号复用后误伤其他进程。
- Windows 不变。宿主核心不修改。

## Capabilities

### Modified Capabilities

- `platform-runtime`：新增「POSIX 账号终端关闭先结束 CLI」。

## Impact

- Host：`src/host/accounts.ts` `AccountManager.finish()`。
- 测试：`tests/accounts.test.ts` 终端夹具在 SIGTERM 时模拟 CLI 退出；新增僵尸辅助进程、忽略 SIGTERM、已退出不发信号三项。
