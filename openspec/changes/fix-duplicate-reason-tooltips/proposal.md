## Why

2026-10-29 用户在 Desktop 的 Pi 子会话中截图：较早轮次的「在新对话中分支」按钮悬停时同时出现两个提示框——上方是插件的「当前 CLI 只支持从最新一轮分支」，下方是 DSH 原生的「在新对话中分支」。用户要求逐一核查，删掉多余的提示框，统一移到下方。

对照源码核查插件在原生控件上叠加原因提示的所有位置：

1. 消息操作栏的分支按钮（`harness-dom-guard.ts` + `harness-native-tooltip.tsx`）：DSH `MessageIconActions` 用 `Tooltip side="bottom"` 包住按钮；插件另挂 `side="top"` 的原因提示。插件原想在按钮上阻止 `mouseover/mouseout` 冒泡来压住原生提示，但 React 的进入事件由上一个元素的 `mouseout` 推导，所以没压住；反而原生提示的离开事件被拦下，可能残留。
2. 输入框「+」按钮（附件不可用时）：DSH `InputBar` 用 `Tooltip side="top"`（延迟 500ms）显示「添加文件或调用指令」，插件原因提示也在上方，两者重叠。
3. 输入框的权限、模型、规划控件被锁定时（运行中、读取中、CLI 不支持）：插件用 `Tooltip` 包住原生控件显示原因，原生触发按钮自带浏览器 `title`（权限说明、模型名），悬停稍久会再弹出一个系统提示。
4. 侧栏会话菜单的「分支」项：只有插件一个提示，位置在上方，与消息分支按钮不一致。

## What Changes

- 同一控件只显示一个提示：原生按钮被插件说明原因时，隐藏其相邻的原生提示气泡（DSH 非 portal 的 `Tooltip` 把气泡紧跟在按钮后渲染），由插件的原因提示代替；分支可用时仍只显示原生提示。
- 被包住的锁定控件在显示原因时去掉内部的浏览器 `title`；原因消失后控件不再被包，重新挂载时恢复原生 `title`。
- 提示位置与该控件原生提示一致：分支（消息操作栏与侧栏菜单）统一在下方；「+」按钮与输入框控件保持在上方（与 DSH 原生提示相同）。
- 去掉无效的事件拦截，恢复原生提示的正常进入/离开。

## Capabilities

### Modified Capabilities

- `conversation-feature-bridge`：「能力判定与禁用提示」增加「只显示一个提示、位置与原生提示一致」。

## Impact

- Client：`src/client/harness-native-tooltip.tsx`、`src/client/harness-dom-guard.ts`、`src/client/styles.ts`、`src/client/harness-control-guards.tsx`、`src/client/harness-worker-fork.tsx`。
- 测试：`tests/harness-native-tooltip.test.ts`、`tests/harness-dom-guard.test.ts`、`tests/client-conversation-features.test.tsx`。
- 无 Host、协议或存储变化。
