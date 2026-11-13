## 1. 实现

- [x] 1.1 `src/host/accounts.ts`：会话记录 `exited`；`finish()` 在 `terminate()` 前调用 `endForeground()`（非 Windows、未退出时 SIGTERM 前台进程组，最多等待 `graceMs`）。

## 2. 自动检查

- [x] 2.1 `tests/accounts.test.ts`：合成宿主在 CLI 未退出时报幸存僵尸 → 关闭成功且解除占用；忽略 SIGTERM 时宽限后仍清理；已退出不发信号。去掉新调用后僵尸用例失败。

## 3. 真实验收

- [x] 3.1 macOS 本机：Antigravity 账号终端 `/login` 成功后关闭终端，显示已关闭、不再报清理失败，续聊不再被「请先关闭账号终端」阻止。2026-10-26 21:46 用户 `/logout`、`/login` 后关闭终端：之后无残留 agy 进程或其僵尸子进程，设置页无终端占用和「账号终端清理失败」，续聊未被阻止；关闭瞬间的界面提示未由插件侧目视。
