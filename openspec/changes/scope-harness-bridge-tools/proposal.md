## Why

DSH 工具桥把当前子 Agent 获准的 host 工具（DSH 内置 read/write/edit/bash/pwsh/grep/glob/web/terminal 等，以及用户在 DSH 配置的 MCP）以 MCP 服务器 `dsh_worker_tools` 交给 CLI（`src/host/index.ts:477-484`、`native-harness-injection.mjs:55`），与 CLI 自带的同类工具并列，没有主次之分，也没有说明分工。模型面对两套名称、参数、权限与输出限制都不同的同类工具（是否因此选错工具尚无轨迹证据），同类工具的 schema 还占用每次请求的上下文。同一个 MCP 若在 CLI 原生配置和 DSH 中都配置了，模型会看到两份。

2026-10-28 用户要求：**CLI 默认先用自己的工具，DSH 工具只作为备选，不影响 CLI 原生工具调用。**

另有已核实的问题：

- Codex MCP 注入未设置 `tool_timeout_sec`，宿主审批等待或长工具可能先超出 Codex 的 MCP 调用时限（默认值来自官方文档，未在本机核实）。
- 工具桥对非文本结果整体标为错误（`native-harness-tools.ts:83`）。
- ZCode 不在 execution-ready 列表（`native-harness-injection.mjs:7`），目录仍注入但 `tools/call` 被拒（`native-harness-tools.ts:183-184`）。
- `doc/native-harness-tools.md` 仍写 Antigravity「禁用」，而源码已接入（`native-harness-injection.mjs:7`、`native-agy-harness.mjs`），文档过时。

## What Changes

- **原生优先**：对每个 CLI，DSH 中与该 CLI 当前已启用原生能力重叠的工具（本地文件读写编辑、搜索、shell/终端，以及与 CLI 原生配置同名的 MCP 服务器）默认不交给 CLI；CLI 原生缺少或被插件关闭的能力（如 Pi/OMP 没有 bash），对应 DSH 工具保留为备选，经宿主权限与审批执行。重叠判定依据按 CLI 维护的能力表，而非工具名猜测。
- **DSH 独有能力作为备选提供**：用户在 DSH 配置而 CLI 原生没有的 MCP、DSH skill 读取工具等照常提供，工具描述标明「备选：仅在 CLI 自身工具无法完成时使用」。
- **原生优先说明**：CLI 有原生开发者指令入口时（Codex `thread/start.developerInstructions` 等）附简短说明：优先用 CLI 自己的工具与 skill，`dsh_worker_tools` 仅在原生工具缺失或失败时使用，并列出实际交出的工具名。没有指令入口的 CLI 不改写用户任务内容。
- **skill**：CLI 原生 skill 优先；DSH skill 仅经 `dsh_list_skills` / `dsh_read_skill` / `dsh_read_skill_resource` 按需读取，作为备选。
- Codex MCP 注入设置与宿主审批等待相匹配的 `tool_timeout_sec`。
- 未接通执行的 CLI 不注入工具目录（ZCode 等），任务记录说明原因。
- 非文本结果按 CLI 原生支持的内容类型传递；不支持时在目录阶段排除。
- 同步 `doc/native-harness-tools.md` 的接入矩阵（Antigravity 等）。

范围外：不改变宿主权限与审批链；隔离副本任务仍不接入工具桥；是否重新启用插件关闭的 CLI 原生功能另见后续变更。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `conversation-feature-bridge`：新增「CLI 原生工具优先，DSH 工具作为备选」。

## Impact

- Host：`native-harness-tools.ts`（目录过滤与描述）、新增按 CLI 的能力表、`native-harness-injection.mjs`、`index.ts` 工具目录构造、`native-codex.mjs` thread 参数及其他 CLI 的指令入口。
- 依赖 DSH 文件工具的 DSH skill 改由 CLI 原生工具完成，需列出受影响技能。
- 测试：`tests/native-harness-tools.test.ts` 等目录与注入夹具。
