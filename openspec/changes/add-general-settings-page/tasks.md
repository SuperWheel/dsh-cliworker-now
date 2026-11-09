# Tasks

## 1. 实施

- [x] 1.1 Host：`general-settings.json` 存储（可选字段、`null` 恢复默认、0600）与 `generalSettings` / `saveGeneralSettings` Remote。
- [x] 1.2 Runtime：有效上限 = 已保存值 ?? 部署配置；保存后立即 `drain()`。
- [x] 1.3 Client：导航新增「CLI Worker 设置」（位于「智能体设置」上方）与 `GeneralSettingsPane`。

## 2. 自动检查

- [x] 2.1 `tests/general-settings.test.ts`：持久化、非法补丁、调高放行排队任务。
- [x] 2.2 `tests/settings-dialog.test.tsx`：导航顺序、延迟读取、保存上限。
- [x] 2.3 `node scripts/build-preview.mjs`（Host/Client 类型检查与隔离构建）。
- [x] 2.4 `pnpm spec validate add-general-settings-page --strict`。

## 3. 未执行

- [x] 3.1 DSH Desktop 实机查看设置页布局（明暗主题、窄屏）。
  - 2026-11-09 窄屏（用户反馈原窄屏把导航与内容切成上下两半“好丑”，要求任何宽度都左右并排）：`src/client/styles.ts` 的 ≤640px 规则改为导航列 `clamp(112px, 30vw, 184px)`、间距 16px，去掉上下堆叠、导航限高与 CLI 两列网格，`doc/settings-ui-design.md` 已同步。Mac Desktop 实机（正式 `pnpm build` 后重启，Codex Computer Use 截图）：窗口约 640pt 时（导航列当时为 160px）导航在左、内容在右，无重叠或横向裁切，Claude Code、Hermes Agent 被省略号截断；放宽到 184px 后再看，窗口只能缩到约 720pt（未触发窄屏规则），两者完整显示、左右并排。184px 在 640pt 窗口下的画面未目视，按宽度计算可完整显示两者。宽屏（约 1280pt）左右并排正常。`tests/settings-dialog.test.tsx` 等 3 个文件 285/285 通过，`pnpm typecheck` 通过。
  - 2026-10-29 核对：Mac 浅色默认窗口已查（2026-10-25）；Windows 2026-10-27 只读核对：标题栏设置按钮直接打开本页，四个通用选项齐全。暗色与窄屏未查。
  - 2026-11-09 Mac Desktop 实机（正式 `pnpm build`，`feat/general-settings` 0bb2158；Desktop 退出后重启，内置浏览器直连 Host Web UI，视口 1280×860）：通用页「CLI Worker 设置」浅色与暗色都已看，分区（语言、任务调度、任务时限）、说明文字、选择框与开关对齐正常；切到 English 再切回正常。窄屏仍未查，本项保持未勾选。
- [x] 3.2 实际 CLI 多任务并发验证。
  - 2026-10-29 核对：2026-10-25 Desktop 复验（用户授权）。同时对话数为 5 时，同一对话并行派遣 5 个 Antigravity（gemini-3.8-flash·Low），5 个任务 0.8 秒内创建。另并行派遣 3 个 OMP（glm-5.3-flash）与 3 个 Grok（Grok 4.6·Low）只读任务，OMP 同账号排队依次运行（`doc/tasks.md` 10-25 两节）。
