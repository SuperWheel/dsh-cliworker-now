# Tasks

## 1. 实施

- [x] 1.1 共享与 Host：`GeneralSettings.language`（`follow | zh | en`，默认 `follow`）、存储 schema 与补丁（`null` 恢复默认、非法值拒绝、文件 0600）、`generalSettings()` 返回有效值、快照在非 `follow` 时附带 `language`。
- [x] 1.2 Client 语言运行时 `src/client/i18n.ts`：模块级状态、`t()` / `useT()`、`installClientLocale(ctx)` 在可选 `locale` 作用域内用 `scope.effect` 注册 `cliworker` 命名空间并订阅 Harness 语言变化，卸载时注销。
- [x] 1.3 词典 `src/client/i18n-messages.ts`：中文原文为键、完整英文译文；未收录键无法通过类型检查。
- [x] 1.4 抽取 `src/client` 下用户可见中文（文本、`aria-label`、tooltip、占位、状态与错误），日期与数字格式随语言切换；品牌名、CLI 名、模型名、CLI 输出与用户内容不翻译。
- [x] 1.5 「CLI Worker 设置」新增「语言」分区（`NativeChoice`：跟随 DSH / 中文 / English），保存后立即切换；`useWorkers` 采用快照中的语言，使其他已打开视图同步。
- [x] 1.6 `hostText()` / `operationMessage()`：收录的 Host 原文与两条变量模板映射为英文，英文时剥离 `Error:` 前缀；未收录内容原样显示。

## 2. 自动检查

- [x] 2.1 `tests/general-settings.test.ts`：语言持久化（0600、重载、`null` 恢复默认）、非法补丁（`fr`、空串、数字）、Runtime 默认值与快照字段。
- [x] 2.2 `tests/client-i18n.test.tsx`：词典完整性（英文非空、占位符一致、英文不含中文、中文恒等映射）、无 Harness 时中文、显式偏好、非法偏好忽略、跟随 Harness 实时切换、显式覆盖、卸载注销与取消订阅、Host 文案映射与原样保留、已挂载组件随 Harness 语言重绘。
- [x] 2.3 `tests/settings-dialog.test.tsx`：设置窗口内保存 English 后整体切换并可切回中文；Host 返回非法语言时拒绝并提供重试。
- [x] 2.4 `tests/panel.test.tsx`：快照携带 `language: 'en'` 时面板实时切换，字段消失回到跟随。
- [x] 2.5 全量 `vitest run`：仅 `tests/build-dependencies.test.ts` 2 项失败，与改动前基线相同（缺少正式构建生成的 `lib/types`）；中文断言的既有测试在默认语言下通过。
- [x] 2.6 `node scripts/build-preview.mjs`（Host/Client 类型检查与隔离构建）。
- [x] 2.7 `openspec validate add-client-i18n --strict`。

## 3. 未执行与已知限制

- [ ] 3.1 DSH Desktop 实机查看英文界面（窄栏换行、明暗主题、Windows）。
  - 2026-10-29 核对：Mac Desktop 浅色默认窗口下切换 English 已查（2026-10-25）；Mac 窄栏、暗色未查。
  - 2026-10-29 Windows Desktop 实机（0.8.4 冻结包，UI Automation，窗口观察覆盖）：插件 English 窄宽布局与浅色通用页布局通过（`ui-english-narrow.json`、`ui-layout-light.json`）。Host 应用菜单没有主题/语言入口，暗色主题未查；Mac Desktop 未查。证据在 `.test-data/windows-remote/full-20261029/`（不入 Git）。
- [ ] 3.2 真实 DSH 切换语言后 `ctx.locale` 的实际订阅行为（本次仅模拟 locale 服务）。
- [ ] 3.3 未收录的 Host/CLI 错误、Host 生成的标题与摘要、内置角色预设内容、默认名称 `智能体-xxx`、发给 CLI 的附件说明保持中文。
  - 范围说明，不是待办：这些文字保持中文属已知限制。
- [ ] 3.4 给主 Agent 的工具描述与提示词不在本变更范围。
  - 范围说明，不是待办。
- [x] 3.5 并行会话（同目录写任务隔离副本并行）新增的文案在两分支合并时补入词典：设置开关、任务卡、合并/丢弃弹窗用 `t()`；Host 的副本状态、排队原因、冲突原因与错误经 `hostText()` 映射（`hostPatterns` 支持多参数，`reason` 递归映射）。给 CLI 的副本提示、主 Agent 工具描述与确认询问仍为中文。
