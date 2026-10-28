# Design: 原生工具输出预算

## 两层预算

| 层 | 归属 | 现状 | 本变更 |
| --- | --- | --- | --- |
| 插件传输/展示 | 插件 | 累计重发，超 1 MiB/16 MiB 终止 | 增量传输、有界展示、超限只截断 |
| 模型可见输出 | CLI 原生 | Codex `truncation_policy` 10000 tokens、exec `max_output_tokens` 由模型自填 | 不改，只在文档说明 |

## 事件形状

- 运行中：`tool` 事件只带本次 `delta`（新增字段）与有界 `detail` 预览；不再写累计 `toolCall.output`。
- 完成：`toolCall.output` 写一次完整或截断后的输出，附 `outputBytes`、`truncated`。
- `io.native` 记录：对 `item/commandExecution/outputDelta`、`item/completed` 等携带大正文的帧，正文替换为 `{ bytes, sha256?, truncated: true }` 摘要；其余字段保留供诊断。是否保留 sha256 实施时按性能决定。
- 思考：发增量，最终一次有界快照。

## 预算

- 新配置：`maxToolPreviewBytes`（单工具展示，默认建议 256 KiB）、`maxDisplayBytes`（整轮展示，默认沿用 16 MiB）。`maxLineBytes` 保留为单帧保护；`maxRunBytes` 改为整轮展示预算的上限语义，超出后后续展示内容降级为摘要而非抛错。
- 原生入站（CLI stdout）：单行保护独立配置（默认仍 1 MiB，Codex app-server 单个 `item/completed` 可能更大，实施时用真实最大帧确定默认值）；入站累计不再终止，只用于统计。
- Host 侧 `runtime.ts`/`bridge-protocol.ts` 的检查与桥一致。

## Client

- 时间线按 `step` 聚合增量；旧记录仍按完整 `detail` 显示（兼容）。
- 截断标记文案：「输出已截断（共 N KB），完整内容见 CLI 原生会话或实际产物」。

## 兼容与风险

- 旧版 Host 读新事件：新增字段可选，`detail` 仍有预览，降级可用。
- 风险：去掉原始帧正文后难以排查协议问题。缓解：调试开关下保留原文写入私有日志（0600），不入展示与 Git。
- 回退：恢复旧事件构造即可；持久化只新增字段。

## 不做

- 不映射 Codex `tool_output_token_limit`/`max_output_tokens`：原生 `config.toml` 已可配置，插件参数（`adapters.ts:290`）未覆盖该项，重复入口会造成两处设定不一致。
