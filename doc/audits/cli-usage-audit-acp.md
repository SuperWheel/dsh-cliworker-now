# Kimi、Grok Build、ZCode 数据接线复查

2026-10-16，v0.8.1，按活动 `integrate-native-cli-conversations` 第 10.3 项核对。保留完整官方 `sidebar.chat.conversation`；本组只调整 Host producer 和离线回归，不调用真实模型或账号，不更新 Desktop、lib、profile，不升版或推送。共享 telemetry/runtime 的汇总改动由主任务统一记录。

## 覆盖矩阵

| CLI / transport | 累计 Token 与缓存 | 当前上下文 | 原生单次响应 usage | 公开过程 / 工具 | 引导 |
| --- | --- | --- | --- | --- | --- |
| Kimi ACP | 已安装 ACP 映射没有公开计费用量；保持未知 | `usage_update.used/size` 为当前上下文估算与所选模型容量；已补 prompt 回执之后的有界读取，避免异步快照被关进程截断 | 已安装 ACP 没有逐模型响应结束/usage 映射，不拿上下文或任务总量代替 | 仅公开 `agent_thought_chunk`；按正文/工具分开思考段。工具保留 `rawInput/rawOutput`，仅有 ACP 完成 `content` 时保留其真实结果 | 尚无本插件已接通的运行中通路；保持原生 Inbox 下一完整 CLI 步骤接续 |
| Kimi 旧 stream-json | `PromptJsonWriter` 不输出 usage；保持未知 | 不输出上下文；保持未知 | 没有响应 usage；保持未知 | `writeThinkingDelta()` 为空，不伪造公开思考；assistant/tool 为真实记录。共享 `CliProtocol` 的显式 callId/input/output 由另组补齐 | 同上 |
| Grok ACP | 已补读取 `session/prompt.result._meta.usage` 并发出严格筛选的 `cliworker.grok_prompt_usage`；是本 prompt 累计，input 包含缓存。共享遥测负责读取与规范化，`usageIsIncomplete` 不可当完整账单 | 标准 `usage_update` 若实际存在沿原通路；源码另有标准通知 `_meta.totalTokens`，来自当前估算上下文，不能当计费用量；容量缺失时仍未知 | 已补实时 `_x.ai/session_notification` 的 `response_started` → `response_completed`。仅具备真实 started 的后端挂响应块；没有 started 的后端保留旧过程，不把任务账单补到最后回复 | 按原生开始/结束保持公开思考、正文和工具顺序；不投影 signature/encrypted 内容；去重原生 eventId，忽略 replay | 未新增未经接通/验收的引导方法 |
| Grok 旧 streaming-json | `end.usage` 是本 prompt 累计，input 已经是未缓存输入；共享 telemetry 不得再次扣缓存 | 此协议没有经本次确证的上下文容量/占用组合；保持未知 | 已补 `usage` 原生响应边界。仅带 `messageId` 或 `stopReason` 的行可以结算响应 usage；无二者的 `TurnUsage` 行绝不作为单次响应账单；`end.usage` 不回填最后回复 | 公开 thought/text/tool 块顺序保留；补显式 callId/input/output；signature 不进入公开事件 | 同上 |
| ZCode app-server | 保留 `turn.completed.usage` 的 run 累计；`projection.totalTokenCount` 是本次原生进程内事件的累计，标为 run，不作为跨进程 session 总数；SDK input 包含两个缓存桶，共享原生显示仅扣一次 | 保留精确 session 的 `projection.contextUsed/contextWindow`；没有容量不从累计总数猜测 | 已补 `main_turn` 的有序 `model_complete`（映射为 `session.updated`，payload 含 content/stopReason/toolCallCount/usage），与 streaming `assistantMessageId` 绑定。缓存从 inclusive input 扣除后进入原生四桶；缺分类不补零 | 公开 reasoning_delta/text_delta 分块，保留真实工具结果；terminal result 标为 run，避免重复追加整个任务正文 | 不新增未接通的运行中引导 |
| ZCode 旧 stream-json | 同上，旧 producer 没有把 run 账单当 response usage | 无完整公开快照时保持缺失 | 同一 `model_complete` tracker；没有真实 messageId 或完整缓存分类时不造单次账单 | 已补原来漏掉的公开 reasoning_delta 和显式工具 callId/input/result/error | 同上 |

## 协议证据

- Kimi：当前已安装 `~/.kimi-code/bin/kimi` 内的原始 `packages/acp-server/src/events-map.ts`、`onTurnEnded` / `emitUsageUpdate` 与 `PromptJsonWriter`。`usageUpdateNotification` 只发送 `used/size`；`onTurnEnded` 先 resolve prompt，再异步查询 model/context。旧 writer 只写 assistant/tool/meta，且 `writeThinkingDelta()` 为空。没有读取用户会话和凭据。
- Grok：当前安装 `~/.grok/downloads/grok-1.0.50-macos-aarch64` 内嵌官方 headless 文档，确认 usage/end 作用域与字段。另与 [官方 headless 文档](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md)、[官方 notification 定义](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/extensions/notification.rs)、[官方 ACP updates](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/src/session/acp_session_impl/updates.rs)、[官方 headless reducer](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/src/headless/reducer/acp.rs) 逐项对照。官方源码是读取当时 main，不声称与安装包逐字同版。尤其 reducer 明确把 `ResponseCompleted` 和 `TurnUsage` 都投影成 type=usage，后者没有 messageId/stopReason。
- ZCode：当前已安装受管 runtime 的 `cli/zcode.cjs`，核对 `normalizeUsage`、`ModelComplete` 构造、`mapSessionEventType`、`mapSessionEventPayload`、`mapSessionProjection`。`normalizeUsage.inputTokens` 原样接 SDK 总输入，缓存是子集。`ModelComplete` 为每模型请求生成，区别于 `TurnComplete` 的汇总；主请求使用 `querySource: main_turn`。
- 2026-10-18 复核 ZCode projection：已安装源码的 `initialSessionProjection` 将 `totalTokenCount` 初始化为 0，`EventReducer.reduce` 从该初值处理当前事件列表，`TurnComplete` 累加该事件的 `tokenCount`。既有同会话三次运行证据中，恢复消息数为 0、2、4，初始总数均为 0，结束总数分别为 15731、15753、15784，均等于各次 `turn.completed.usage.totalTokens`；因此上述 projection 总数属于本次进程，旧版“快照的 session 总数”描述已修正。本轮仅读取源码和既有证据，没有新增模型调用。

## 已执行验收与边界

执行：`node node_modules/vitest/vitest.mjs run tests/acp-zcode-usage-audit.test.ts tests/native-acp.test.ts tests/native-zcode.test.ts tests/grok-adapter.test.ts tests/zcode-adapter.test.ts tests/public-process.test.ts`，6 个文件、88 项通过。

新增回归覆盖缓存包含/分离口径、未知缓存类别、错误总数、reasoning 为 output 子集、多个真实响应只结算一次、整轮总量不能补给最后回复、Kimi 迟到上下文、公开思考分段、content-only 工具结果、原生 Grok response identity/去重及不公开 signature。以上都是明确模拟协议，不代表账号、模型、Windows 或最终 Desktop 的真实执行验收。Host/Client 类型检查和隔离构建由主任务统一执行；本记录不声称已经完成。
