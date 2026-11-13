# Proposal

## Why

用户 2026-10-30 把 Mac 与 Windows 的 DSH Desktop 都更新到 Harness 0.2.1-rc.5，而插件随包的四个原生界面包（`runtime-host/`）仍基于 rc.3，并在启用时整体替换官方同名包。官方 rc.4 起在 `ui-chat` 中先去掉推理开头的 `<signature>…</signature>` 再显示，推理 Body Slot 新增 `rawText`；`ui-conversation` 调整了视图标签提示与「更多会话视图」文案。继续使用 rc.3 包会让主对话和子对话丢失这些官方行为。

## What Changes

- 从固定官方 tag `dsh-v0.2.1-rc.5` 重建四包，把现有 48 文件补丁移植到 rc.5，冻结独立构建依赖与依赖链接清单，重新 vendor `runtime-host/`。
- 开发用 DSH SDK pin 从 rc.3 升到 rc.5，构建/vendor 脚本与选图测试加入 rc.5 目标；插件版本号不变。
- 只在需要的地方调整；Host/Client 业务协议不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `package-distribution`: 随包原生界面跟随 rc.5，保留官方推理显示文本与 Body Slot 字段。

## Impact

涉及 package.json、锁文件与 workspace 例外、`scripts/build-dependencies.mjs`、`scripts/build-host-extension.mjs`、`scripts/vendor-host-extensions.mjs`、`host-extensions/dsh-0.2.1-rc.5/`、`runtime-host/`、相关测试与文档。不调用模型、不派遣任务；不提交到 GitHub、不推送、不发布。
