# MiMo、OpenCode、OMP、Pi 原生数据接线复查

本记录对应 `integrate-native-cli-conversations` 第 10.4 项，日期 2026-10-16，版本仍为 v0.8.1。复用官方 `sidebar.chat.conversation`；本组没有改界面组件、宿主统计投影或用户配置，没有更新 Desktop/lib/profile，没有真实账号或模型请求。

## 来源与口径

本机实际入口：MiMo 0.1.15、OpenCode 1.19.0、Pi 1.0.4、OMP 16.4.4。OMP 的 Bun 全局源码包另为 17.0.1，不能把它作为 16.4.4 的版本证明；本次追加读取 16.4.4 已安装二进制内嵌 JS 核实 `getSessionStats`、`getContextUsage`、RPC `steer` 与 `get_session_stats`。本机私有证据 `.test-data/native-http-rpc-audit-20261016/installed-protocol-evidence.json` 保存 7 份受限源码片段及 SHA-256，不含账号或用户会话。

| CLI / transport | 已核实的来源 | 累计与缓存 | 原生每次响应 | 上下文 | 公开过程与运行中引导 |
| --- | --- | --- | --- | --- | --- |
| MiMo HTTP/SSE | 安装 SDK `@mimo-ai/sdk/dist/gen/types.gen.d.ts` 的 AssistantMessage/ReasoningPart/ToolPart；0.1.15 二进制 Session.getUsage | `message.updated` 按本轮 message ID 快照，复用 Host 跨 run 会话汇总；input/output/reasoning/cache 分桶 | message ID + part ID；下一助手消息或已核实终态封口；原生 input 取未缓存输入，output = CLI output + reasoning，缓存独立 | 原生 provider.limit.context；当前输入占用维持 MiMo 原生口径，缺分类不补零 | 显式 reasoning.text、工具状态/input/output；补终态快照遗漏的公开块；HTTP 没有接通原生 steer，等待当前完整 run 清理后消费队列 |
| MiMo 历史 JSONL | 同安装版 part 身份和 `step_finish.tokens` | 沿原 step_finish 统计 | 明确 part.sessionID/messageID/id 才接 response；step_finish 只封该响应；无身份历史保持兼容 | 未公开容量保持未知；不能猜模型窗口 | 显式完整 ReasoningPart；无 scope、redacted、provider metadata 不显示；工具仅展示已执行结果 |
| OpenCode HTTP/SSE | 1.19.0 官方源码 Session.getUsage 与已安装版本 | 同一 session 精确消息快照，缓存独立 | message ID + part ID；input/output/reasoning/cache 口径与 MiMo 同形，独立验证 | provider.limit.context；最近请求输入含 cache.read/cache.write，分类保持未知 | 与 HTTP 原生 Part 同边界；没有接通原生 steer，按完整 run 边界处理队列 |
| OpenCode 历史 JSONL | 原生 `step_start` / `step_finish`、完整 Part | 保留 step_finish 统计 | 新接 message/part 身份与 step_finish usage；未具备身份的旧记录不补造 | 旧消息未给容量时保持未知 | 补显式公开 reasoning；补工具 callId/input/output；不把 metadata 当思考 |
| Pi RPC（现行及兼容路径） | 安装 1.0.4 的 `pi-ai/dist/types.d.ts`、`core/agent-session.js`、`modes/rpc/rpc-mode.js` | `get_session_stats` 会话累计，四桶独立；可含原生其他计费记录，不能当最后一条响应 | `message_start` / `message_end` 界定真实响应；contentIndex 界定块；message_end.usage 独立记录。reasoning 已含在 output 内，不重复加总 | 原生 `get_session_stats.contextUsage`；这是 CLI 自己的上下文估计，压缩后 tokens:null 保持未知；没有分类 RPC | 只公开 thinking_delta/thinking_end 和非 redacted 终态块；工具按 message_end 的 toolCall 身份关联执行回执；steer 依原生确认，Pi 以 agent_settled 终结 |
| OMP RPC（现行及兼容路径） | 实际 16.4.4 二进制内嵌 AgentSession/RPC 源码；17.0.1 类型作补充核对 | get_session_stats 累计与缓存；真实 total 保留 | 同 RPC 真实消息边界；reasoningTokens 已含在 output 内。若 total 大于四桶，原生 response usage 整份未知，真实 total 仅留独立遥测，避免 DSH 合成较小总数 | 原生 contextUsage；没有公开分类 RPC，不能从全局源码可用的内部方法假装 RPC 可得 | 公开 thinking；toolCall 与执行结果同块；steer 原生 success，agent_end 终结；不把终结或成功回执等同模型已执行引导 |

OpenCode 口径的官方精确版本来源：[v1.19.0 Session.getUsage](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/opencode/src/session/session.ts#L321)。MiMo 安装二进制的 `getUsage` 同样明确 `output = outputTokens - reasoningTokens`，不是从字段名推测。Pi 与 OMP 各自 Usage 类型明确 reasoning 是 output 子集。

## 本组实施

- 新增 `http-rpc-response.mjs/.d.mts`：校验原生计数、按真实响应归组、每响应只封口一次、保留工具结束回执、拒绝完成后的正文变更。缺失或矛盾计数保持未知。
- `native-session-http.mjs`：HTTP 响应身份和独立 usage、终态公开 reasoning/tool 快照补齐、旧响应不重放正文。
- `pi-omp-bridge.mjs`：每次 response 的 contentIndex、公开 thinking、工具归属与终态 usage；独立白名单 `cliworker.rpc_response`，会话统计仍由 `cliworker.rpc_usage` 提供。两种值不混用。无 contentIndex 的历史流不套用无法关联的终态文本快照。
- `opencode-adapter.ts`：历史 JSONL 的 response/usage、明确公开 reasoning 与工具回执。旧 MiMo 分支由同批 primary 子任务在 `cli-protocol.ts` 实施，独立测试纳入本组验证。
- 本组没有修改共享 `telemetry.ts`；`cliworker.rpc_response` 的白名单、汇总和 UI 解释由主任务协调接线，不能把 producer 单独通过当成完整链路验收。

## 已执行验收

以下均为明确模拟协议，不是模型验收。

```sh
node node_modules/vitest/vitest.mjs run \
  tests/session-http-response-audit.test.ts \
  tests/http-rpc-response-audit.test.ts \
  tests/mimo-legacy-response-audit.test.ts \
  tests/opencode-adapter.test.ts \
  tests/native-http.test.ts \
  tests/pi-omp-adapter.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.host-build.json --noEmit
```

6 文件共 176 项通过，Host 类型检查通过。首轮沙箱阻止本机 `127.0.0.1` 监听而失败，经仅回环模拟测试权限重跑；不把该失败写成业务回归失败。后续回归发现无 contentIndex 的历史夹具终态正文与流不一致，改为保留无法归块的既有流，最终 176 项全通过。

新增独立测试覆盖：HTTP 两次响应各自 token/cache、HTTP 分离 reasoning、终态才出现的公开过程/工具、缺 cache 不补零；实际 Pi/OMP bridge 的两响应、contentIndex、工具归属、白名单去敏、累计统计与单次统计分离；OMP 四桶无法容纳额外总量时原生 usage 未知；历史 OpenCode step_finish 与公开过程。历史 MiMo 的 5 项测试由 primary 子任务新增。

没有执行真实模型、真实账号、Windows、Desktop、外部 MCP 全链路。本组没有构建或安装正式包；隔离 preview 与最终跨模块验收由主任务执行。
