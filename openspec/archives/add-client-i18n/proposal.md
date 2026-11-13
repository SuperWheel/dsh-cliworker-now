# Proposal: CLI Worker 界面中英双语与语言切换

## Why

CLI Worker 的 Client 界面文案全部写死为中文（`src/client` 下约 38 个文件、600 余行含中文的非注释代码），英语用户无法使用；DeepSeek Harness 本身已提供 zh/en 语言切换和插件词典注册（`@deepseek-ai/dsh-client-locale`：`ctx.locale.register(ns, { zh, en })`、`bind(ns)`），插件却没有接入。`add-general-settings-page` 已新增插件级「CLI Worker 设置」页和 `general-settings.json`，可承载插件自己的语言偏好。

## What Changes

- `GeneralSettings` 新增 `language: 'follow' | 'zh' | 'en'`，默认 `follow`（跟随 DSH 当前语言）；Host 持久化于 `general-settings.json`，`null` 恢复默认，非法值拒绝。
- 「CLI Worker 设置」页新增「语言」分区，用 `NativeChoice` 选择「跟随 DSH / 中文 / English」；保存后界面立即切换，不需要重载。
- Host 在 Worker 快照（`watch` 流）中附带当前语言偏好，所有已打开的面板和窗口实时同步。
- Client 新增 `src/client/i18n.ts`：以中文原文为键、提供完整英文译文的类型化词典；在 Cordis 生命周期内向 Harness locale 注册 `cliworker` 命名空间并订阅 Harness 语言变化；`follow` 时经 `ctx.locale.bind('cliworker')` 取词（Harness 外部语言包可覆盖），显式选择时用插件词典。
- 抽取 `src/client` 下用户可见的中文（文本、`aria-label`、tooltip、占位、状态、错误提示）改为经词典取词，提供完整英文；时间与数字格式随语言切换。
- Host 抛给界面的常见中文错误由 Client `operationMessage()` 精确映射为英文；未映射的 Host 错误保持原文。

## 范围外（已知限制）

- 未列入映射表的 Host/CLI 错误、Host 生成的任务标题、状态说明（如 `resumeBlockedReason`）等仍显示中文原文。
- 给主 Agent 的工具描述、系统提示词、Remote 文档与模型可见文本不翻译。
- CLI 输出、模型名、用户内容、品牌名与 CLI 名不翻译；DSH 内插件名 `CLI Worker / CLI Worker Now` 不变。
- 不新增第三种内置语言；不修改 Harness 核心语言设置。
- 并行会话负责的「同目录写任务隔离副本并行」新增文案，在两分支合并时补入词典。

## 能力域

- 新增 `client-localization`（界面语言、词典与实时切换）。
- 涉及 `add-general-settings-page` 的 `general-settings` 能力（新增语言字段，以本变更的增量规格描述）。

## 影响

- Host：`src/host/storage.ts`（schema 与补丁）、`src/host/runtime.ts`（`generalSettings()`、快照字段）。
- 共享：`src/shared/cli-settings.ts`（`GeneralSettings.language`、`LANGUAGE_PREFERENCES`）、`src/shared/types.ts`（`WorkerSnapshot.language`）。
- Client：新增 `src/client/i18n.ts`、`src/client/i18n-messages.ts`；`index.tsx` 生命周期接入；`general-settings.tsx` 语言分区；其余组件改为词典取词。
- 协议：Remote 签名不变；`GeneralSettings` 与快照新增可选字段，旧记录无 `language` 时为 `follow`。
- 安装：无变化。
