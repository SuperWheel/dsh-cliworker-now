# Proposal

## Why

2026-11-22 排查用户反馈的「rc.5 输入框消失」时，在 Windows DSH Desktop 0.2.2-rc.5 + 插件 0.9.2 正式包上实测（Codex gpt-6.2-astra high，CDP 直连 Electron 窗口）：

- 每次在插件页启用或停用 dsh-cliworker-now，DSH 都会抛出一次 `SlotAssemblyError: scope 'session-maybe' rendered without an installed adapter`，`#root` 短暂清空。插件按「热切换后页面自动恢复」规格重启 DSH 自己的应用挂载，页面约 1.6～2.7 秒后恢复。
- 热启用恢复后很快再停用，2 次实测 2 次整页被替换为「需要完全退出后重新打开」的 Desktop 提示，会话、侧栏和输入框一起消失。
- 运行时取值（`recovery-probe.jsonl`）：出问题那次 `recoverCrashedRoot()` 已选定 restart，但距上次重挂只有 5,631 ms，未满 `RELOAD_GAP_MS`（30 秒），于是跳过重挂、进入 Desktop 提示分支；间隔 41,099 ms 和 47,110 ms 的两次对照都正常恢复。
- 冷启动、停用状态冷启动后热启用、单次停用→启用、热启用后切换会话均正常。

根因：`src/client/root-recovery.ts` 用同一个 30 秒门槛同时做两件事：防止同一次切换反复重挂，以及节流网页刷新。门槛按根节点计时，不区分是哪一次切换，于是用户紧接着做的另一次独立切换也被当成重复尝试拦下。

## What Changes

- 每次热启用或热停用开始的观察（`watchCrashedRoot`）各带一个切换标识，`recoverCrashedRoot(env, watch)` 记录这次重挂属于哪一次切换。
- 另一次切换造成的空白，即使距上次重挂不到 30 秒，也 SHALL 原地重挂一次；同一次切换内不再第二次重挂（每个观察本来就只恢复一次即结束）。
- 不带切换标识的调用仍按 30 秒门槛限制重复重挂；网页刷新的 30 秒节流、Desktop 不刷新、恢复不可用时显示提示等其余行为不变。

## Capabilities

### Modified Capabilities

- `package-distribution`：「热切换后页面自动恢复」补充：每次切换各自可原地重挂一次，不受上一次切换 30 秒门槛限制。

## Impact

- Client：`src/client/root-recovery.ts`。
- Host、协议、存储、安装入口不变。
- 测试：`tests/root-recovery.test.ts` 新增 2 项模拟用例。
- 面板：REQ-0139（目标版本 0.9.3）。
- 与 REQ-0140（未构建源码目录链接安装导致输入框消失）是两个独立问题，本变更不处理后者。
