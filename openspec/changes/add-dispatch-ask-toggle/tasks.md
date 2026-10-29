# Tasks

## 1. 实施

- [x] 1.1 通用设置增加可选 `askBeforeDispatch`，缺省为询问，沿用 `general-settings.json` 的 0700/0600 存储。
- [x] 1.2 `runtime.generalSettings()` 返回 `askBeforeDispatch ?? true`，沿用 `generalSettings` / `saveGeneralSettings` Remote。
- [x] 1.3 `chooseDispatch`：关闭询问时使用有效项目设定，失效或不完整回退完整选型；启动前实时授权不变。
- [x] 1.4 「CLI Worker 设置」通用页「任务调度」新增“调用前询问模型”原生 Switch 及中英文文案，不显示保存成功文字。

## 2. 自动检查

- [x] 2.1 派遣流程测试：默认询问、关闭后不弹卡片直接启动（含 `cliworker_start` 入口）、无完整设定与失效回退、宿主拒绝不保存、对话设定失效时使用项目设定、不跨项目或 CLI。
- [x] 2.2 存储与运行时测试：旧配置缺字段即询问、权限、重开保持、`null` 恢复默认、非法值拒绝。
- [x] 2.3 设置页测试：旧 Host 缺字段显示开启、切换保存、失败恢复；i18n 键与占位符检查。
- [x] 2.4 `build.mjs --typecheck-only`、`build-preview.mjs`、OpenSpec 严格校验。

## 3. 未执行（需另行授权或平台）

- [ ] 3.1 真实 CLI 派遣与 DSH Desktop 实际界面检查（需用户授权更新 Desktop 链接）。
  - 2026-10-29 核对：Windows 2026-10-27 只读核对通用页四个选项齐全（含本开关）；关闭开关后的真实派遣与 Mac Desktop 界面未执行。
- [x] 3.2 Windows 平台界面检查。
  - 2026-10-29 Windows Desktop 实机（0.8.4 冻结包）：「调用前询问模型」On→Off→On、「同目录写任务并行」Off→On→Off 各往返一次并恢复，窗口观察覆盖；浅色布局、English 窄宽、窄宽滚动后两个开关可见均通过。暗色主题未查（Host 无入口）。证据在 `.test-data/windows-remote/full-20261029/`（不入 Git），`ui-roundtrip-covered.json`。

## 4. 文档

- [x] 4.1 同步 `AGENTS.md`、README、`doc/settings-ui-design.md`。
- [x] 4.2 在 `doc/tasks.md` 记录命令、结果与未验证边界。
