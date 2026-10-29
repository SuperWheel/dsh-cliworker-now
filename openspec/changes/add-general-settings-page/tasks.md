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

- [ ] 3.1 DSH Desktop 实机查看设置页布局（明暗主题、窄屏）。
  - 2026-10-29 核对：Mac 浅色默认窗口已查（2026-10-25）；Windows 2026-10-27 只读核对：标题栏设置按钮直接打开本页，四个通用选项齐全。暗色与窄屏未查。
- [x] 3.2 实际 CLI 多任务并发验证。
  - 2026-10-29 核对：2026-10-25 Desktop 复验（用户授权）。同时对话数为 5 时，同一对话并行派遣 5 个 Antigravity（gemini-3.8-flash·Low），5 个任务 0.8 秒内创建。另并行派遣 3 个 OMP（glm-5.3-flash）与 3 个 Grok（Grok 4.6·Low）只读任务，OMP 同账号排队依次运行（`doc/tasks.md` 10-25 两节）。
