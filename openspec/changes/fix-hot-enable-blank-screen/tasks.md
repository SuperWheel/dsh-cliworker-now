## 1. 复现（2026-11-06，隔离环境）

- [x] 1.1 使用 Desktop 自带 CLI（DSH 0.2.2-rc.1），临时 DSH_HOME，无头浏览器；未调用模型，未改动 `~/.dsh`。证据在 `/private/tmp/claude-501/-Users-leeyl-AI-Project-DeepSeekHarness-cliworker-now/5c7f0ead-0353-4663-b486-524356dce98d/scratchpad/blank-install/ev/`。
  - 三种安装路径结果一致：官方插件管理器「安装→立即启用」（`a-npm086`、`a-preview`）、dshmarket 1.73.12 安装接口（`b-market173`、`b2-market173`）、dshmarket 1.66.45 安装接口（`c-market166`）。启用后页面立即空白，报 `SlotAssemblyError: scope 'session-maybe' rendered without an installed adapter`。
  - 已发布 0.8.6：刷新和冷重启后都显示「Failed to load plugins … @deepseek-ai/dsh-message-quotes: failed」，在 0.2.2-rc.1 上重启也无法恢复。
  - 修复前的 HEAD 预览包：热启用同样白屏；刷新后恢复，冷重启正常。
  - dshmarket 两个版本热启用后，自己的安装请求都返回 500「cannot get required service "loader" in inactive context」。
  - 一次性现象：dshmarket 1.73.12 首轮中，CLI Worker Host 启动报「CLI 路径记录不可读取或写入」。新副本重跑、该副本再次冷启动都没有复现，原因未查明。

## 2. 实现

- [x] 2.1 `src/client/root-recovery.ts`：`crashedRoot` 以 React 容器标记（非 null）且无子元素判断白屏；`installRootRecovery` 在根节点已挂载时观察 10 秒，销毁后观察 60 秒；确认 0.5 秒后仍为空才恢复；sessionStorage 记录上次刷新，30 秒内不重复。
- [x] 2.2 `src/client/index.tsx`：在 `installClientLocale` 之后以 `ctx.effect` 接入，传入插件 context（只取应用根 context）。
- [x] 2.3 第三版（gpt-6-astra high 设计实现，已审查）：等客户端模块同步结束，对唯一的 `web boot: application mount` fiber 调用 `Fiber.restart()`，由 DSH 的 `root.unmount()` 释放旧根后重新挂载，不刷新页面、不另建 React 根；不满足条件时网页刷新一次、Desktop 显示重启提示。审查核对了 0.2.2-rc.1 中 `modules.entries.state`、`web/src/mount.ts:21` 的标签、Cordis `Fiber.restart()`/`getEffects()`/`provisions` 均存在。

## 3. 自动检查

- [x] 3.1 `tests/root-recovery.test.ts`：第一版 10 个模拟用例（白屏判定、热启用刷新一次、冷启动不触发、正常页面到期结束、确认期间恢复则不刷新、销毁后发现白屏刷新、销毁观察有时限、跨页面 30 秒间隔、无 sessionStorage 仍可恢复、非页面环境无操作），全部通过。
- [x] 3.3 第三版：`tests/root-recovery.test.ts` 29 个模拟用例（含真实 Cordis：启用后重挂、停用后重挂、冷启动不触发、兜底顺序、旧根 disposer 先于新挂载、`uiRenderer` 替换与应用销毁时清理恢复后的根），与 `tests/client-registration.test.ts` 共 38 项通过；typecheck、`build:preview` 通过（本会话复跑确认）。
- [x] 3.2 `typecheck` 通过（DSH 0.2.2-rc.1）；`tests/client-registration.test.ts`、`tests/host-runtime-package.test.ts`、`tests/build-dependencies.test.ts` 34 项通过；`build:preview` 通过。

## 4. 隔离复测（修复包，官方插件管理器）

- [x] 4.1 热启用（`ev/fix-a`）：点「立即启用」后 1 秒页面空白，控制台出现插件的恢复说明，页面自动刷新一次；3 秒时正文恢复（101 字符），之后 0 错误；手动刷新和冷重启均正常。右侧栏新标签页菜单中有 CLI Worker（`ev/fix-presence`）。
- [x] 4.2 停用再启用（`ev/fix-toggle`，插件页开关）：停用时页面白屏后自动刷新一次，显示原版界面；再启用时同样白屏后自动刷新一次，最终页面 0 错误。插件已启用时正常打开页面只加载一次，没有误刷新。
- [x] 4.3 真实 DSH Desktop（2026-11-06 15:15，正式构建，Codex gpt-6.1-sol high 用 Computer Use 操作，截图在 `/private/tmp/dsh-hot-toggle-acceptance/`）：**第一版未通过**。插件页关闭 dsh-cliworker-now 后，约 2.5 秒时自动刷新已触发，但重新加载的页面加载 `@deepseek-ai/dsh-client-ui-session` 失败（`bundle script …client.js&rev=15dc44110734 failed to load`），53 个条目未激活。Desktop 弹出启动失败对话框，提供「禁用第三方插件、备份 profile patch 并重启」等选项（崩溃日志 `~/Library/Logs/DeepSeek Harness/crash-2026-11-06T07-18-39-676Z-web-boot.log`）。
  - 原因：Desktop 的启动 IPC（`apps/desktop/src/main.ts` `DESKTOP_IPC.boot`）每次都返回 Host 启动时记录的模块注入，热切换后刷新页面会请求已不存在的模块版本；Desktop 自带的「刷新页面」菜单也一样。页面没有重启接口。
  - 处置：没有点对话框里的修复选项，用其「退出」按钮关闭 Desktop。profile 与测试前备份相比，只是 bundles 少了 `dsh-cliworker-now`（停用的正常结果），patch 与市场状态未变。插件暂时保持停用。
- [x] 4.4 第二版：Desktop 中不再刷新，改为在空白根节点写入纯文本提示，请用户完全退出后重新打开；网页保留自动刷新。隔离复测（`ev/fix2-a`、`ev/fix2-toggle`）：网页热启用与停用仍各自动刷新一次后恢复；页面加载后设置 Desktop 标记再启用，页面不刷新，显示「CLI Worker 刚刚启用或停用，DeepSeek Harness 需要完全退出后重新打开才能恢复界面。」。模拟用例增至 12 个，与 `tests/client-registration.test.ts` 共 21 项通过，typecheck 通过。
- [x] 4.5 第三版隔离复测（`ev/fix3-a`、`ev/fix3-toggle`）：热启用、热停用后页面短暂空白，随后不发生页面导航即恢复，仍停在插件页；页面加载后设置 Desktop 标记再启用，同样原地恢复，没有出现重启提示；冷启动正常。
- [x] 4.6 第三版真实 DSH Desktop（15:42–15:49，正式构建，Codex gpt-6.1-sol high 用 Computer Use；记录在 `/private/tmp/dsh-hot-toggle-acceptance-2/`）：插件页依次启用、停用、再启用 dsh-cliworker-now，开关最终为开。三次切换后 1–20 秒的全部无障碍树采样都是完整插件页，开关值正确，没有启动失败或修复对话框，没有重启提示；右侧栏开始页的 CLI Worker 按钮随启用出现、停用消失。之后没有新的崩溃日志；profile 的 bundles、patch、市场状态与测试前备份一致。
  - 未确认：Computer Use 截图全程停在旧画面，空白时长与视觉上的原地恢复无法从截图判断；1 秒内的采样已有完整页面，说明没有持续白屏。新标签页菜单检查未能稳定打开，用开始页按钮代替。
- [ ] 4.7 未验证：dshmarket 安装或开关修复包（市场只能安装 npm 上已发布的版本）；Windows；草稿等界面状态在重挂后的表现。
