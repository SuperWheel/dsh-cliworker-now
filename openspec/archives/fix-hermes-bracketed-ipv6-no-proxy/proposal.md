## Why

2026-10-25：合并环境 Copilot 记录修复后，Hermes 账号终端能打开，但状态仍为「Hermes 登录暂时无法续期，请稍后刷新」；用户在账号终端选择 Nous Portal 后看到 `Could not verify credentials: Invalid port: ':1]'`。

本机证据（未打印凭据）：

- 抓取账号终端进程环境：`NO_PROXY` / `no_proxy` 为 `localhost,127.0.0.1,::1,.local,[::1]`。Desktop 主进程只有 `::1`；`[::1]` 由 DSH 发布给子进程的代理环境追加（Desktop 包内代理模块文档说明其按 Node 规则处理 IPv6 旁路）。
- Hermes 自带的 httpx 0.28.1：`NO_PROXY` 含 `[::1]` 时 `httpx.Client()` 抛 `InvalidURL: Invalid port: ':1]'`；只含 `::1` 时正常。Hermes 只在部分路径（Codex 登录、诊断）调用自身的 `sanitize_no_proxy_entries`，Nous 凭据校验与插件私有续期路径没有。
- 插件续期子进程同样继承该值，httpx 异常被固定回执归为 `unavailable`，即「暂时无法续期」。用干净环境运行同一续期操作返回 `ready`（真实刷新成功并保存）。

## What Changes

- 插件启动的所有 Hermes 进程（账号终端、续期、任务运行）共用 `hermesAccountEnvironment`；其中把 `NO_PROXY` / `no_proxy` 的带括号、带端口或 CIDR 形式的 IPv6 条目改写为裸地址并去重，与 Hermes 自身 `sanitize_no_proxy_entries` 规则一致。IPv4、域名、通配符 `*` 与无需改写的值保持继承，不新增或删除代理。
- 不修改 Harness 代理行为与用户代理设置。

## Capabilities

### Modified Capabilities

- `platform-runtime`：新增“Hermes 子进程的 IPv6 代理旁路”要求。

## Impact

- Host：`src/host/hermes-account-context.ts`。
- 测试：`tests/hermes-no-proxy.test.ts`。
