# Proposal

## Why

Codex 公开摘要已由 `native-codex.mjs` 正确请求和接收，但 `HarnessConversationStream.appendOnlyReasoning` 仅允许 Hermes 的公开增量即时投影，Codex 摘要在生成期间被完成门槛暂扣。另一个排查误区是将 rollout 的兼容字段 `turn_context.summary: none` 当作请求未生效：安装中的 0.162.1 配合无账号模拟服务已证实实际请求包含 `reasoning.summary: auto`。

## What Changes

- 仅允许当前 run 的 `codex-app-v1` 公开摘要与 Hermes 一样实时进入原生 reasoning block。
- 保留未核验协议的可撤回快照门槛、原生位置、无内容不展开和私密字段排除规则。
- 用关联回归与安装中 CLI 的本机模拟响应核对摘要、空摘要及结束保留；修正排查文档。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `worker-conversation-interaction`：细化 Codex 公开摘要在运行中显示和停止后保留的要求。

## Impact

影响 Host 原生会话流投影及其关联测试，不改客户端组件、请求模型、强度、权限、账户、历史数据或 Harness 核心。参考 codex-host 固定版本 `a8adb78b` 原生通知透传方式，不复制外部 CLI 的伪工具展示。版本维持 v0.8.1；不调用真实模型，不做全量测试或 GitHub 提交。
