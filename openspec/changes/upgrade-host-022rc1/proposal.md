# Proposal

## Why

用户 2026-11-05 把 Mac 的 DSH Desktop 从官方更新源装到 Harness 0.2.2-rc.1（nightly，tag `dsh-v0.2.2-rc.1` = `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`）。插件随包的四个原生界面包仍基于 rc.5，并在启用时整体替换官方同名包；Host 端还依赖 0.2.2 已移除的接口：

- `ToolsService.presentAs` 与单调用 `tools.execute({ callId, name, arguments, … })` 被执行器插件和批量 `tools.execute({ calls, signal, agent })` 取代（上游 455686626d）。
- 投影状态 `inbox`、`turnBoundary`、`plan` 的类型声明位置变化。
- cordis 升到 4.1.0，插件 peer 只声明 4.0.4/4.0.5。

## What Changes

- 从固定 tag 重建四包：rc.5 的 48 文件补丁 3-way 应用，8 个冲突文件人工合并并保留官方新行为；冻结独立构建依赖与依赖链接清单，重新 vendor `runtime-host/`，保留 ui-chat 新增的 `lib/assets` 与 `./assets/*` 导出。
- 开发 SDK pin 升到 0.2.2-rc.1，cordis 4.1.0，peer 加 `~4.1.0`；构建、vendor 脚本与测试加入新目标；0.2.2 构建改用 checkout 的 tsdown，使官方预设与构建器共用同一 rolldown 实例。
- Host 工具桥改用 0.2.2 的执行接口，保持逐调用原生执行、策略与审批、审批与 Worker 的匹配和生命周期清理；投影状态改用新类型来源。
- 插件新增的中英文词条在官方新增的日、西、法、德、俄、葡六种语言中暂用英文。
- 插件版本号不变。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `package-distribution`: 随包原生界面跟随 0.2.2-rc.1，保留官方资源导出与新行为。

## Impact

涉及 package.json、锁文件与 workspace 例外、`scripts/`、`host-extensions/dsh-0.2.2-rc.1/`、`runtime-host/`、`src/host/`、相关测试与 README/设计文档。业务派遣协议不变。不调用模型、不派遣任务；不提交到 GitHub、不推送、不发布。
