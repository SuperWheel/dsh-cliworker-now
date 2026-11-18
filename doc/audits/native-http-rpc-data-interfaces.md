# Pi／OMP／OpenCode／MiMo 原生数据接口补充核查

2026-10-17，续 OpenSpec `integrate-native-cli-conversations` 第 11 节。仅阅读安装源码、固定版本官方源码与用户指定参考；验证采用明确模拟 RPC／HTTP，不执行参考项目，不调用真实账号、模型，不更新 Desktop。

## 1. 安装版证据与能力边界

| CLI | 核查版本与原生来源 | 可取得的数据 | 不可据此承诺的数据 |
| --- | --- | --- | --- |
| Pi | `@earendil-works/pi-coding-agent` 1.0.4；`dist/core/agent-session.js`、`extensions/types.d.ts` | `get_session_stats` 遍历全部 Session entries，包含 assistant、独立 usage、compaction、branch_summary、toolResult usage；`getContextUsage` 提供原生总占用／窗口，压缩后可能明确 unknown | `ExtensionContext` 没有上下文分类 Token API；system prompt 文本与 context 生命周期回调不能直接变成原生分类计数 |
| OMP | 实际运行文件 16.4.4；`~/.local/bin/omp` 内嵌源码核对。Bun 全局 17.0.1 源码只用于定位，不能替代安装版证明 | RPC 原生 builtin `/context` 给出五类估算与 buffer/free；`message_end.usage.orchestration` 可保留原生额外桶 | `get_session_stats` 遍历当前 `state.messages`，压缩后不等于完整历史账单；不能把总量差额自动命名为额外桶 |
| OpenCode | 1.19.0 实际 binary；官方同 tag `session.ts`／`core/session/projector.ts` 与 binary 同段 | `GET /session/{id}` 的持久 `tokens` counter，由 step-finish 更新／删除维护；原生当前保留回执累计；模型 capacity 来自 `/provider` | 该 counter 会随删除等下降，并非不可逆的终身账单；没有已确认的公开分类查询接口 |
| MiMo Code | `@mimo-ai/sdk`／`plugin` 0.1.15 安装类型及 binary | assistant／step-finish 的分桶 usage；模型 capacity；官方 plugin step hooks 的 trajectory 中保留同类记录 | Session 类型没有累计 tokens；`session.llm.request` 提供组装文本而非分类计数；metrics.model_call 仅 sessionID 和部分计数，不能独立证明完整账单与精确请求去重 |

OMP 在 `--no-extensions` 下忽略显式扩展的既有安全边界保持不变。没有为读取统计移除隔离、启用任意用户扩展或替换原 Agent。Pi 现有工具扩展能够读取 `getContextUsage` 和 Session entries，但不额外解锁分类计数，因此继续使用已有原生 RPC 查询。

## 2. OMP 原生上下文采集

`pi-omp-bridge.mjs` 仅在原进程已经确认生成终态、原生 stats 返回之后，执行可选 `/context` 查询。原进程必须先主动公开唯一 `available_commands_update.commands` 条目，包含 `name: context`、`source: builtin`、原生说明 `Show context usage`，且没有参数输入。当前隔离仍包括 `--no-skills`、`--no-extensions`，防止 builtin 前的 skill 分支接管。

安装版 RPC 在普通模型分支前处理 builtin；`/context` handler 只输出报告并返回 consumed，不调用 `session.prompt`，不 append 用户消息。采集要求精确 RPC 请求回执 `success: true`、`command: prompt`、`data.agentInvoked: false`，并且恰好一个报告。元查询有 750ms 上限；失败、超时或版本不兼容只忽略元数据，不改变原生成结果。`command_output` 不进入对话。

原生报告的分类为 `System prompt`、`System tools`、`System context`、`Skills`、`Messages`，附 `Auto-compact buf` 和 `Free`。CLI 省略零行，插件也不补零。`contextUsed` 单独来自本次原生 `get_session_stats.contextUsage.tokens`，只在窗口一致且报告百分比相符时保留，不从分类加总或百分比反推。分类与总占用不强制闭合。原生异常 fallback `Used: 0` 会把 null 显示成零，插件拒绝该 fallback。Snapcompact savings 文本不映射为上下文分类。

输出合同：`type: cliworker.context_inspection`、`cli: omp`、`source: omp.native-context`、精确 `sessionId`、`basis: native-estimate`、原生 `contextCapacity`、可选 `contextUsed`，以及 `categories: [{name, tokens, kind: used|buffer|free}]`。仅计数与分类名称出现在 raw 元数据中。

不得自动调用 `/usage`：官方 helper 会先执行 `fetchUsageReports()`，可能访问账号接口。`/stats` 会同步文件并启动 dashboard，也不是只读采集入口。

## 3. OMP 额外账单桶

安装版 OpenAI 解析器明确读取 provider 的 `input_tokens_details.orchestration_input_tokens`、`orchestration_input_cached_tokens`、`output_tokens_details.orchestration_output_tokens`，并生成 `usage.orchestration.input?`／`cacheRead?`／`output?`。原生会先判断 provider primary 计数是否已经包含这些额外调用，从普通桶中移除已包含部分，再保留 provider `totalTokens`。可选键在原生零值时被省略。

`http-rpc-response.mjs` 现在只透传真实存在的合法整数键，不复制未知字段，不由 `total - 四桶` 生成额外类别。普通四桶加显式额外桶与 provider total 相等时才能视作可闭合；不相等时保留实际 total 和各桶的事实，不把差额抹去。DSH 普通 response 四桶暂不能表达正额外桶，因此整个 response usage 保持 unknown，避免自动合成较小总量；raw `cliworker.rpc_response.usage.orchestration` 可供宿主可选详情扩展消费。

## 4. OpenCode 原生会话快照

官方 1.19.0 projector 对 `step-finish` PartUpdated 先减旧 usage 再加新 usage；PartRemoved／MessageRemoved 会减去原记录，SessionUpdated 直接替换字段。新实现仅接收原生 snapshot，不累加本次响应，不作差分，不保留历史最大值。

新建会话后 GET 精确 ID 的快照；恢复时复用已核验的 GET；idle 结束后在 750ms 内可选重读同 ID 和项目目录。所有 native input／output／reasoning／cache read／cache write 必须显式有效且安全可加。输出 `cliworker.session_usage`，`cli: opencode`、`source: opencode.session.get`、`scope: session`、精确 `sessionId`。`usage.output` 保留 HTTP 原生不含 reasoning 的口径，`usage.total` 为明确五项安全和，由共享口径层统一转换；不输出 cost，不充当 run 或最后 response 的用量。

MiMo 没有相同 Session counter，不发送此记录或额外查询。MiMo plugin 的 `session.userQuery.post` 虽提供稳定 assistantMessageID 与 trajectory，但仍是已有响应回执，不能证明没有遗漏独立辅助调用；不能凭此伪称全账单或分类覆盖。

## 5. 用户指定参考

- [codex-host 固定 commit 的 Pi usage](https://github.com/BytePioneer-AI/codex-host/blob/1aa9f65d6abf8f15b3a390f10de0b97ad85ae847/packages/adapters/pi/src/pi-usage.ts)：采用 native stats 与 request receipts，并保留 history complete 标记；没有公开分类细分。
- [codex-host 的 OMP usage](https://github.com/BytePioneer-AI/codex-host/blob/1aa9f65d6abf8f15b3a390f10de0b97ad85ae847/packages/adapters/omp/src/omp-usage.ts)：消息 usage 与 context 总量，不构成 orchestration 口径证明。
- [Codingns4DSH 的 Pi driver](https://github.com/jingyi0605/Codingns4DSH/blob/e136681d753061d6e409ccd390c664da19c2ce15/src/host/cli-adapters/pi-driver.ts)：有界 native stats 查询；context-only 事件补 input/output 零的实现不沿用。
- [OpenCode 1.19.0 原生 projector](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/core/src/session/projector.ts) 与 [Session HTTP token 口径](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/opencode/src/session/session.ts)：用于原生 snapshot 生命周期和 reasoning 分离证明。实际安装 binary 已核对应计数更新逻辑。

本机只读安装源码与固定 git 对象都未被执行；参考项目、安装目录和用户会话没有修改。真实 OMP／Pi／OpenCode／MiMo 模型、Windows 以及 Desktop 的本轮新统计渲染仍需各自验收，离线夹具通过不替代这些结论。

## 6. 已执行验证

`node node_modules/vitest/vitest.mjs run tests/omp-context-inspection.test.ts tests/opencode-session-usage.test.ts tests/http-rpc-response-audit.test.ts tests/session-http-response-audit.test.ts tests/pi-omp-adapter.test.ts tests/native-http.test.ts tests/mimo-legacy-response-audit.test.ts`：7 文件、186 项通过。最初受沙箱禁止本地监听而出现 `listen EPERM 127.0.0.1`；随后经工具批准在沙箱外重跑相同离线夹具通过，没有访问真实账号／模型。

OMP `basis: native-active-context` 最后一处合同调整后，重跑以上前四个文件及 `mimo-legacy-response-audit.test.ts`，5 文件、53 项通过。`node node_modules/typescript/bin/tsc -p tsconfig.host-build.json --noEmit` 通过。

独立测试覆盖原生命令缺失／非 builtin／非本地回执／重复输出／超时／晚到回执与清理、分类缺项和零 fallback、额外账单白名单及矛盾总量、原进程会话文件不改写、OpenCode 新建与恢复、快照下降／明确清零、缺值／越会话／错目录／失败与用户取消。未在本组执行正式构建、安装或真实 CLI 调用。
