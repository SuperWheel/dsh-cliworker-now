## Why

有用户反馈：安装并启用插件后 DSH 白屏，只有重启才恢复。2026-11-06 在 DSH 0.2.2-rc.1 隔离复现。官方插件管理器「安装→立即启用」、dshmarket 1.73.12 安装接口、dshmarket 1.66.45 安装接口三种路径都在启用瞬间白屏，控制台报 `SlotAssemblyError: scope 'session-maybe' rendered without an installed adapter`。

插件用随包界面替换原版会话、对话、子 Agent 与聊天界面。宿主热重载客户端时，先移除旧模块再导入新模块，中间有一段时间没有 `session` 作用域适配器。根渲染器把整页包在 `session-maybe` 作用域里，所有错误边界按设计重新抛出 `SlotAssemblyError`，React 清空 `#root`。新适配器装上后页面也不会恢复，但刷新即可正常启动同一组模块。停用方向同样会白屏，而回来的原版界面无法自行恢复。

## What Changes

- 客户端新增白屏恢复：插件客户端激活时，如果 `#root` 已由 React 挂载却没有内容，等宿主客户端模块同步结束、确认 0.5 秒后仍为空，就重启 DSH 自己的应用挂载（`web boot: application mount` 所在的 fiber）。旧 React 根由 DSH 的卸载流程释放后再重新挂载，页面不刷新，当前路由保留。冷启动时宿主在所有客户端插件激活之后才挂载 React，因此冷启动不会触发。
- 原地恢复不可用（找不到唯一的挂载 owner、模块同步失败或重挂失败）时按平台兜底：网页刷新一次，同一标签页 30 秒内最多一次（记在 sessionStorage），不会循环；DSH Desktop 不刷新，在空白页写入纯文本提示，请用户完全退出后重新打开。Desktop 刷新页面会沿用 Host 启动时的模块注入，必然加载失败并弹出启动失败对话框。
- 插件客户端销毁时（停用插件、界面被替换）继续观察 60 秒，按同样顺序恢复；观察有时限，到时自行结束。
- 不改宿主，不改 patch 结构，不重新插入原版界面行，不另建 React 根。

## Capabilities

### Modified Capabilities

- `package-distribution`：新增「热切换后页面自动恢复」。

## Impact

- Client：新增 `src/client/root-recovery.ts`，`src/client/index.tsx` 接入。
- 测试：`tests/root-recovery.test.ts`。
- 用户体验：启用或停用插件时，页面会空白约 1 秒后原地恢复；界面组件会重新挂载，未发送的输入框内容可能丢失（原先需要重启，同样会丢失）。
- 不处理：已发布 0.8.6 在 0.2.2-rc.1 上冷启动报 `dsh-message-quotes` 激活失败，需靠包含 0.2.2-rc.1 适配的新版本解决；dshmarket 在热重载中自身请求返回 500（市场所在上下文被重载），属于市场问题。
