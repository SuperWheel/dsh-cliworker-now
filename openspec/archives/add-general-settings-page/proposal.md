# Proposal: CLI Worker 通用设置页与总并发上限

## Why

当前设置弹窗只有「智能体设置」和各 CLI 连接页，没有放插件级设置的位置。所有 CLI 共用的并发上限固定为部署配置 `maxConcurrent`（默认 2，`src/host/process.ts`、`src/host/index.ts` 中的 Cordis 配置），用户无法在界面调整；任务超出上限就排队（`src/host/runtime.ts` 中的 `drain()`）。

## What Changes

- 设置导航「智能体设置」上方新增「CLI Worker 设置」页，作为插件级设置的统一入口。
- 新增 Host 持久化记录 `general-settings.json`（0600），字段均可选；缺省时沿用部署配置。
- 新增 Remote `generalSettings` / `saveGeneralSettings`；首个字段为所有 CLI 共用的「最高同时对话数」（1–8）。调高后立即放行排队任务，调低不中断进行中的任务。
- 后续分支在同一页面和记录上扩展：界面语言（i18n）、同目录写任务隔离副本并行。

## 范围外

- 不改变同会话互斥、同目录写任务串行；后者由独立变更处理。
- 不按 CLI 分别设上限（用户选择只设总上限）。
- 不修改 Harness 核心设置页。

## 影响

- Host：`storage.ts`、`runtime.ts`、`index.ts`；共享类型 `src/shared/cli-settings.ts`。
- Client：`settings-dialog.tsx` 导航，新增 `general-settings.tsx`。
- 协议：新增两个 Remote，无破坏性变更；旧版本无 `general-settings.json` 时行为不变。
