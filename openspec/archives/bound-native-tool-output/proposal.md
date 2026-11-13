## Why

读大文件或长任务会让 Worker 整轮被终止（`Native bridge output exceeds run limit` / `Native bridge frame exceeds limit`）。根因在插件传输层：

- Codex 每个 `item/commandExecution/outputDelta` 都把累计全文同时写入 `detail` 与 `toolCall.output`，再加原始通知（`src/host/native-codex.mjs:179-185`）；完成时完整输出再出现约三份（`:119-125`、`:192`）。传输量随输出长度平方增长。内存模拟（真实 `runNativeCodex` + `createNativeIO`、假 RPC peer）：单条命令约 256–400KB 输出、或 20 条各 64KB 输出，即超过 16 MiB 整轮上限。
- 其他 CLI 同类：Claude（`native-claude.mjs:189,191,211`，思考累计重发 `:138-139`）、ACP 系（`native-acp.mjs:92,199,204-206`，思考 `:170,175`）、ZCode（`native-zcode.mjs:226,396,400`，思考 `:355-357`）、OpenCode/MiMo（`native-session-http.mjs:202,315`）、Hermes（`native-hermes.mjs:369,406`）、agy（`native-agy.mjs:80,102`）、Pi/OMP 写死 1 MiB/16 MiB（`pi-omp-bridge.mjs:841,893`）。
- 超限即终止进程，不是截断（`native-transport.mjs:23-30,129-136,377-392`；Host 再查一次 `runtime.ts:2478`、`bridge-protocol.ts:35`）。
- 工具桥响应按字符数而非字节判断 1 MiB（`native-harness-tools.ts:213`），下一层按字节（`native-harness-mcp.mjs:50`），多字节内容会在下层失败。

2026-10-28 用户反馈另指出第二层预算：把 `maxRunBytes` 调到 512 MiB 后读大文件仍「爆」，因为 Codex 模型可见的工具输出由 Codex 自己截断。本机 Codex 0.162.1 核实：gpt-6.x / gpt-5.6 模型目录标注 `tool_mode: code_mode_only`、`truncation_policy: {mode: tokens, limit: 10000}`；代码模式 exec 只接受模型自填的 `yield_time_ms` 与 `max_output_tokens`；`tool_output_token_limit` 是 Codex 自身 `config.toml` 配置，插件未覆盖。这一层属于 Codex 原生行为，原生 Codex 使用同一模型时相同。

## What Changes

- 传输去重：工具输出在运行中只发增量，同一工具的完整输出在完成时只发一份；原始 native 记录对大正文只保留长度与摘要，不再重复正文。思考摘要改发增量或有界快照。
- 预算分层：单帧上限只约束单个协议帧；UI 展示用有界预览；超出整轮展示预算时截断展示并明确标注「输出已截断，完整内容见 CLI 原生会话/产物」，MUST NOT 因展示数据超限终止 CLI 运行。原生入站单行超限仍保护进程，但上限与展示预算分开配置。
- Pi/OMP 桥改读 Host 的 `maxLineBytes`/`maxRunBytes`，不再写死。
- 工具桥统一按 `Buffer.byteLength` 计算，并为包装预留余量。
- 文档：README 说明两层预算——插件传输预算（本变更后不再因此终止）与 CLI 模型可见输出预算（Codex 由模型每次的 `max_output_tokens` 与 `config.toml` 的 `tool_output_token_limit` 决定，插件不覆盖、不暴露），并说明 gpt-6.x 在原生 Codex 中同样使用代码模式 exec/wait 工具。

范围外：不新增插件对 Codex `max_output_tokens`/`tool_output_token_limit` 的映射旋钮（原生已可在 `config.toml` 设置，插件不重复造入口）；不改变模型可见输出；不改终态判定（见 `judge-run-outcome-by-native-terminal`）。

## Capabilities

### New Capabilities

- `native-output-budget`：原生工具输出与思考的传输、展示预算及超限行为。

### Modified Capabilities

（无）

## Impact

- Host：`native-transport.mjs`、各 `native-*.mjs` runner、`pi-omp-bridge.mjs`、`native-harness-tools.ts`、`runtime.ts`/`bridge-protocol.ts` 的接收侧预算。
- Client：工具步骤与思考的展示需从增量聚合并显示截断标记（`src/client` 时间线组件，具体文件实施时确认）。
- 持久化：时间线工具输出保存有界预览；历史记录兼容旧的完整 `detail`。
- 协议：桥到 Host 的事件新增增量/截断字段，需版本兼容；安装方式不变。
