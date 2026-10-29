# Design: 原生工具输出预算

## 两层预算

| 层 | 归属 | 现状 | 本变更 |
| --- | --- | --- | --- |
| 插件传输/展示 | 插件 | 累计重发，超 1 MiB/16 MiB 终止 | 增量传输、有界展示、超限只截断 |
| 模型可见输出 | CLI 原生 | Codex `truncation_policy` 10000 tokens、exec `max_output_tokens` 由模型自填 | 不改，只在文档说明 |

## 事件形状

- 运行中：`tool` 事件只带本次 `delta`（新增字段）；不再写累计 `detail`/`toolCall.output`。
- 完成：`toolCall.output` 写一次完整或截断后的输出；`detail` 只留元数据。`truncated`、`outputBytes` 放在事件顶层（工具与思考共用），不放进 `toolCall`。
- `io.native` 记录：传输层统一把超过 64 KiB 的字符串替换为 `{ cliworkerOmitted: true, bytes }`；Codex `outputDelta` 原始帧的 `delta` 一律只记字节数。不保留 sha256（实施决定：逐帧哈希大正文的开销不值得，诊断只需大小）。
- 思考：运行中发 `delta`，完成时一次 `detail` 快照（有界）。

## 预算

- 新配置：`maxToolPreviewBytes`（单工具/思考块展示，默认 256 KiB，实际取它与 `maxLineBytes/4` 的较小值）。实施决定：不另设 `maxDisplayBytes`，原生通路直接以 `maxRunBytes` 作整轮展示预算，避免同义的两个配置项。`maxLineBytes` 保留为出站单帧保护；超出展示预算后续展示降级为摘要而非抛错。
- 原生入站（CLI stdout）：单行保护独立为 `maxNativeLineBytes`，默认 32 MiB。依据：Codex 0.162.1 生成的协议对 `aggregatedOutput`、`outputDelta.delta` 均无上限，二进制中也找不到相关常量；无模型 `command/exec` 实测合法单帧可达 18,000,057 字节（控制字符 6 倍转义）。32 MiB 是暂定值，不是上限证明。入站累计不再终止，只用于统计。
- Host 侧 `runtime.ts` 对原生桥输出累计只统计不终止（非原生通路不变）；`bridge-protocol.ts` 仍按 `maxLineBytes` 检查单帧，并透传新字段。

## Client

- 聚合在共享的 `foldEvents`（`src/shared/types.ts`，Host 构建视图与 Harness 会话流共用）中按 `step` 完成：`delta` 追加到工具行 `toolCall.output` 或思考行 `detail`；旧记录仍按完整 `detail`/`output` 显示（兼容）。
- 渲染：`src/client/worker-process.tsx`（`Tool`、`Reasoning`）是唯一消费工具输出与思考正文的 Client 组件；`src/host/harness-conversation-stream.ts`、`src/host/harness-observed-tools.ts` 把时间线行转成主 Agent 的工具回执。
- 截断标记文案：「输出已截断（共 N KB），完整内容见 CLI 原生会话或实际产物」；大小未知时省略括号。主 Agent 回执末尾附同一说明。

## 兼容与风险

- 旧版 Host 读新事件：新增字段可选，`detail` 仍有预览，降级可用。
- 风险：去掉原始帧正文后难以排查协议问题。原计划的「调试开关下保留原文写入私有日志」本次未实现；大正文只留字节数，排查时以 CLI 原生会话为准。
- 回退：恢复旧事件构造即可；持久化只新增字段。

## 不做

- 不映射 Codex `tool_output_token_limit`/`max_output_tokens`：原生 `config.toml` 已可配置，插件参数（`adapters.ts:290`）未覆盖该项，重复入口会造成两处设定不一致。
