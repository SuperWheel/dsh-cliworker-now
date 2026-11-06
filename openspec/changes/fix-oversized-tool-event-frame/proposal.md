## Why

2026-11-06 用户在 DSH Desktop 实测 Codex app-server 发出含 1,269,672 字节 command 的工具开始事件，插件以 `Native bridge frame exceeds limit` 终止整轮。`src/host/native-transport.mjs` 的出站降级仅移除 detail、delta、toolCall.input/output，保留超大的 command，降级帧仍超限。本次依据用户提供的实测与源码定位，不重新读取私人运行日志或调用真实模型。

## What Changes

- 共享出站降级路径按 UTF-8 字节截断 toolCall 的所有字符串字段（包括 command、name、callId、parentCallId）。
- 降级帧仍超限时去掉工具负载及额外字段，保留步骤、状态与文本摘要；按实际 JSON 行大小继续缩短文本，必要时移除可选步骤与状态，仅最小摘要也放不下才报错。
- 保持 assistant、终态、原生入站保护与 CLI 工具失败处理原状。
- 新增模拟回归测试并同步 README 与设计文档。

## Capabilities

### Modified Capabilities

- `native-output-budget`：补充超大工具事件出站帧的逐级摘要要求。

## Impact

- Host：只修改共享 `native-transport.mjs`，覆盖 Codex、Claude、Antigravity 及共享 HTTP runner 的 command 投影，不逐个修改运行器。
- 测试：`tests/native-transport.test.ts`、`tests/native-output-budget.test.ts`；无 Client、存储格式、依赖、版本或安装变更。
- 范围外：图片 base64 改路径摘要仅评估；不构建、不更新 Desktop、不运行真实 CLI/模型、不提交工作区改动。
