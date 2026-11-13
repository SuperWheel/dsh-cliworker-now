# Proposal

## Why

用户 2026-11-12 把 Mac 的 DSH Desktop 从官方更新源装到 Harness 0.2.2-rc.2（nightly，tag `dsh-v0.2.2-rc.2` = `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`，rc.1 的后代，1568 个提交）。插件随包的四个原生界面包仍基于 rc.1，并在启用时整体替换官方同名包。实机发现：

- rc.2 的 `@deepseek-ai/dsh-client-ui-primitives` 删除了 `useAnchoredPosition` 导出，rc.1 版 ui-chat 的 `ContextMeter`、`useStatDialog`（`TurnUsagePanel`）调用即抛 `is not a function`，`conversation.composer.bar` 与 `conversation.chat.node` 两个 slot 崩溃，输入栏上下文用量与轮次统计不显示。
- CLI Worker 面板打开后智能体列表为空（该会话有 1 个子智能体），原因待查。

## What Changes

- 从固定 tag 重建四包：rc.1 的补丁 3-way 应用到 rc.2，冲突人工合并并保留官方新行为；冻结独立构建依赖与依赖链接清单，重新 vendor `runtime-host/`。
- 开发 SDK pin 升到 0.2.2-rc.2；构建、vendor 脚本与测试加入新目标。cordis 仍 `~4.1.0`，peer 不变。
- 按类型检查与回归结果适配 Host 端 rc.2 接口变化；查明并修复 Worker 列表为空。
- 插件版本号不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `package-distribution`: 随包原生界面跟随 0.2.2-rc.2，不引用宿主已移除的导出。

## Impact

涉及 package.json、锁文件与 workspace 例外、`scripts/`、`host-extensions/dsh-0.2.2-rc.2/`、`runtime-host/`、`src/host/`（视类型检查结果）、相关测试与 README/设计文档。业务派遣协议不变。不调用模型、不派遣任务；不提交到 GitHub、不推送、不发布。
