# Codingns4DSH 数据处理定向核查

2026-10-17，只读获取 [Codingns4DSH](https://github.com/jingyi0605/Codingns4DSH)，冻结 HEAD `e136681d753061d6e409ccd390c664da19c2ce15`（提交时间 `2026-10-16T12:29:02Z`）。下载到 `/tmp`，未安装依赖、构建或执行该仓库代码；没有访问账号或模型。以下链接均固定提交，区分参考实现与本机协议证据。

## 原生视图与通信

- 它在 [`feature.ts:357–380`](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/cli-adapters/feature.ts#L357-L380) 拦截 `llm/stream`，通过 [`feature.ts:513–535`](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/cli-adapters/feature.ts#L513-L535) 的 projector 将外部 Agent 消息写入 DSH 原生会话、turn 和 step。它复用 DSH 主会话渲染；全 `src` 未发现 `sidebar.chat.conversation`、`ConversationSlotPanel` 或 `ChatView`，不能据此声称它采用本项目的完整官方侧栏会话挂载方式。
- Grok 使用 ACP JSON-RPC stdio：[`grok-driver.ts:427–485`](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/cli-adapters/grok-driver.ts#L427-L485) 在 RPC reader 先观察用量，再入消费队列，核 session/prompt 身份。ZCode 使用 app-server；[`zcode-telemetry.ts:16–33`](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/cli-adapters/zcode-telemetry.ts#L16-L33) 按原生 eventId/seq 去重，取 `session.updated` 模型完成，避免同时计算网络完成通知。

## 可用方法与边界

| 项目 | 固定源码证据 | 本项目处理 |
| --- | --- | --- |
| 真实模型容量 | [`grok-usage.ts:14–29`](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/cli-adapters/grok-usage.ts#L14-L29) 将实际 modelId 映射到 `_meta.totalContextTokens` | 这条线索经本机 Grok 1.0.50 二进制字段及官方源码独立核实后落地；只取精确选中模型，不按名称猜容量。 |
| 上下文与账单分离 | [`grok-usage.ts:131–155`](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/cli-adapters/grok-usage.ts#L131-L155) 独立发布 `usage-observation`，已用上下文与容量分别维护 | 继续将 Grok `_meta.totalTokens` 标为原生上下文估算；容量单独透传，不能把该估算当计费用量或最后一次响应。 |
| 原生上下文绑定 | [`native-session-bridge.ts:392–441`](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/native-session-bridge.ts#L392-L441) 容量与当前 provider/model 绑定，更新 request context | 本项目新增容量 observation 也严格绑定 CLI session/model；缺失容量保持未知。 |
| 上次读数保留 | [`registry.ts:75`](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/cli-adapters/registry.ts#L75)、[`638`](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/cli-adapters/registry.ts#L638) 内存 `lastUsages` 保存最新 usage | 本项目明确持久化完整已确认 run checkpoint，保留原 runId/scope；不将最新样本冒称会话累计。 |

## 不照搬的缺失数据策略

- [`rpc-driver-utils.ts:57–129`](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/cli-adapters/rpc-driver-utils.ts#L57-L129) 用统一别名解析多类协议，缺 input/output 默认零，缺缓存按零求和并用 `Math.max` 修正。这里不能证明未公开缓存就是零；本项目继续逐 CLI 保留 unknown，并拒绝不一致桶。
- [`zcode-telemetry.ts:85–106`](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/cli-adapters/zcode-telemetry.ts#L85-L106) 对缺桶补零，旧累计按基线差并 clamp；[`antigravity-driver.ts:275–290`](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/cli-adapters/antigravity-driver.ts#L275-L290) 无基线时回退整个累计。本项目不将 session 总数当 run 或 response。
- [`dsh-message-projector.ts:45–71`](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/cli-adapters/dsh-message-projector.ts#L45-L71) 有仅上下文时将上下文填入 input 的兼容分支；[`331–344`](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/cli-adapters/dsh-message-projector.ts#L331-L344) 用空格 reasoning block 承载工具标记。均不照搬：上下文不冒充账单，工具不伪装模型公开思考。
- [`kimi-driver.ts:112–122`](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/cli-adapters/kimi-driver.ts#L112-L122) wire 失败后自动回退 stream-json。参考仓库用的是不同 Kimi wire 协议；不能据它的 usage 支持推断本机 ACP 已公开同样字段，也不据此新增静默回退。

## Grok 最小落地与验证

官方固定源码 [`model_state.rs:145–177`](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-pager/src/acp/model_state.rs#L145-L177) 明确默认容量来自当前模型 `totalContextTokens`，已选 `contextWindow` 仅在等于默认值或模型明确提供的 `contextWindows` 中才有效；[`types.rs:1050–1087`](https://github.com/xai-org/grok-build/blob/2bdd1d6a6369de0e8c68132ea4539e9abd9e14a8/crates/codegen/xai-grok-sampling-types/src/types.rs#L1050-L1087) 定义实际选择字段。本机 `~/.grok/downloads/grok-1.0.50-macos-aarch64` 包含这些模型状态字段；官方固定源码与安装包不声称逐字同版。

新增 `grokModelContext` 只接受唯一且精确匹配当前选择的 model 元信息，在模型确认后发出 `cliworker.grok_model_context`；遥测按 session/model 双身份接容量。重复模型、旧 currentModelId、无效/未公开的覆盖容量保持未知。容量不增加 run/session/response 账单。

离线执行 `node node_modules/vitest/vitest.mjs run tests/grok-model-context.test.ts tests/cli-telemetry-audit.test.ts tests/native-acp.test.ts`，3 个文件、42 项通过。夹具为明确模拟，未执行真实 Grok、模型、账号或 Desktop 验收。
