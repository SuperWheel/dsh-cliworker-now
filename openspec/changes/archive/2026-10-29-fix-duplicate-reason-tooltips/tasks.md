# Tasks

## 1. 实施

- [x] 1.1 原生按钮被插件说明原因时打上 `data-cwn-reason-tooltip`，样式隐藏其相邻的原生提示气泡；清理时去掉该标记。
- [x] 1.2 原因提示的位置跟随原生提示：消息分支在下方，「+」在上方；侧栏菜单「分支」改到下方。
- [x] 1.3 去掉 `bindHarnessTooltipAnchor` 中无效的 `mouseover/mouseout` 冒泡拦截。
- [x] 1.4 输入框权限、模型、规划控件锁定时改用 `HarnessReasonTooltip`，显示原因期间去掉内部浏览器 `title`。

## 2. 验证

- [x] 2.1 单元测试：标记的设置与清理、提示所在侧、`title` 去除与重新出现时再去除、事件不再被拦截。
- [x] 2.2 `pnpm typecheck`、全量测试、`pnpm build:preview`、正式构建。
- [x] 2.3 Desktop：Pi 子会话较早轮次的分支按钮只显示一个提示且在下方；最新轮次只显示原生提示。

## 验证记录（2026-10-29）

- 单元测试：`tests/harness-native-tooltip.test.ts`（提示所在侧：分支在下、「+」在上；`title` 去除及被重新设置后再去除；事件不再被拦截）、`tests/harness-dom-guard.test.ts`（分支与「+」按钮打标记、清理后去掉）、`tests/client-conversation-features.test.tsx`（可用分支不打标记）；关联客户端测试 6 个文件 77 项通过。
- `pnpm typecheck` 通过；全量 `pnpm test`：242 个文件通过、3 个跳过，5110 项通过、13 项跳过；`pnpm spec validate fix-duplicate-reason-tooltips --strict` 通过。
- `pnpm build:preview` 成功；确认无运行中 Worker 后正式 `pnpm build`，Desktop 退出后重新启动加载。
- Desktop（内置浏览器直连 Host Web UI，Pi 子会话 pi-2「Pi 备选命令-工作区外」，12 个已完成轮次）：
  - 第 1–11 轮的分支按钮均为禁用并带 `data-cwn-reason-tooltip`，第 12 轮（最新）可用且无标记。
  - 鼠标从「点赞」移到第 11 轮分支按钮：只显示一个提示「当前 CLI 只支持从最新一轮分支」，`data-side=bottom`（截图中位于按钮下方）；原生「在新对话中分支」气泡已渲染但 `display:none`。
  - 第 12 轮分支按钮：只显示原生「在新对话中分支」，位于下方。鼠标移开后页面上没有残留提示。
  - 「+」按钮：Pi 支持附件，未被守卫；悬停后原生气泡确为按钮的下一个兄弟元素，临时打上标记时该气泡被隐藏（检查后立即移除标记）。没有不支持附件的子会话可做实际悬停验证。
  - 输入框控件：在 Pi 子会话发「只回复 OK」（运行 `b7cdf954`，`zai-coding-cn/glm-5.3-flash` Low，回复 OK、completed）。运行中权限与模型控件被包住并显示原因「请等待本轮结束后再修改设置」，二者的 `title` 均已去除（原为权限说明、模型名）；结束后控件不再被包，权限控件的 `title` 恢复为「文件编辑自动批准（Pi 不限制编辑目录）；命令先问你。」。运行中悬停未捕获到提示气泡（运行很快结束，锁定控件悬停表现与本次改动前相同）。
- 未验证：不支持附件的 CLI 中「+」的实际悬停；侧栏会话菜单「分支」项的实际悬停（仅代码改为下方）。
