## Why

2026-10-28 Desktop 实机验收留下四个问题（见 `relay-native-approvals-to-host`、`relay-harness-tool-approvals`、`bound-native-tool-output` 的 tasks.md），用户决定在一个变更里处理。现状均已对照源码核实：

1. **授权提问卡不换行**。`approvalQuestion` 把请求摘要、原因和工作目录用换行拼进 `question`。DSH 0.2.1-rc.3 的提问卡（`dsh-client-ui-user-questions` `QuestionFlow`）把 `question` 放在标题元素中，换行被折叠，整段连在一起；同一问题的 `detail` 字段则用 `MarkdownText` 渲染在正文区。
2. **Codex 命令工具块标题不显示命令**。Codex 的命令条目只带 `command`、不带 `input`，Worker 原生会话里的工具调用参数因此为空（`harness-conversation-stream.ts` 为空串，`harness-observed-tools.ts` 为 `{}`）。DSH 工具块在参数为空串时以 callId 作摘要，所以标题显示为「commandExecution · cliworker:<runId>:exec-…」。
3. **授权被拒后的结果不一致**。CLI 原生授权被拒后，运行器把 CLI 正常结束的轮次判为结果待核实（`report-denied-permission-as-unverified`），Worker 会话顶部显示「…额外授权已拒绝，但 CLI 报告本轮已完成；结果待核实…」横幅。DSH 备选工具的授权在 Host 决定，运行器看到的只是一次工具失败，结果为「已完成」并附「本轮有 1 个工具步骤失败，CLI 已自行处理」。两条路径结论不同，后者还把用户的拒绝说成 CLI 处理过的失败。
   - 本变更起初按原生规则把 DSH 备选工具的拒绝也改判为结果待核实。2026-10-28 Desktop 验收后，用户决定统一改为另一方向：授权被拒是用户的决定，CLI 正常结束就是「已完成」，不显示「结果待核实」，也不加横幅。其他三种待核实情况（最后一步工具失败后直接结束、AGY 汇总冲突、ACP 无正文）保持不变。
4. **等待 DSH 备选工具审批时，空闲时限照常计时**。Pi、OMP 的空闲时限在 Host 计时，其余原生 CLI 在运行器（`native-bridge.mjs`）计时。CLI 原生审批会暂停这两处计时，DSH 备选工具的审批不会。CLI 在等工具结果时没有输出，用户考虑审批的时间就可能触发空闲超时。

5. **（Desktop 验收中发现）工具桥调用最长只能等 5 分钟，且调用方放弃后 Host 仍在等授权**。2026-10-28 22:46 主 Agent 让 Pi 经 DSH 备选命令工具提权，提问卡等待 5 分 1 秒后，Pi 的工具调用失败（「DSH 工具调用状态无法确认；未自动重试」），提问卡却一直留到本轮结束才撤回。原因：工具桥客户端（`native-harness-mcp.mjs`）用 Node 内置 `fetch` 调 Host，`fetch` 在 300 秒内收不到响应头就放弃；Host 等工具结束才回复，也不因调用方断开而撤回调用。若用户在这之后点「允许一次」，命令仍会执行，而 CLI 已告诉用户命令没有执行。

## What Changes

- 提问卡：标题只写「<Worker>（<CLI>）请求授权」。请求摘要、原因和工作目录放进 `detail`，各占一段，原文多行时保留换行。CLI 内容按字面显示：转义全部 Markdown 标点，不渲染为链接、格式或 HTML。选项与决定映射不变；Worker 会话审批面板的原因文本不变。
- 工具块：CLI 工具条目没有 `input`、只有字符串 `command` 时，以 `{ command }` 作为原生会话中的工具调用参数，标题显示命令首行。实时声明与回放两条路径使用同一取值。
- 运行结果：本轮有授权被拒绝（CLI 原生授权或 DSH 备选工具授权；DSH 用户、预设、规划模式或无人应答），而 CLI 报告本轮正常完成时，结果为「已完成」，没有横幅，也不附「工具步骤失败，CLI 已自行处理」说明；拒绝记录照常留在时间线。CLI 本轮失败、中断或任务停止时仍按原规则处理；Claude Code 拒绝时即中断本轮，仍为失败。
- 空闲时限：等待 DSH 备选工具审批期间暂停空闲计时，决定后恢复；总时限照常。Host 计时的 Pi、OMP 直接暂停；运行器计时的 CLI 由 Host 经该轮的私有审批邮箱发送暂停与恢复指令。只在启用空闲时限时发送。

- 工具桥：客户端改用 `node:http`，不设响应等待上限（总时限与 CLI 自身的工具超时仍然有效）。Host 在调用方断开、且没有其他重放请求在等同一调用时撤回该调用，等待中的授权随之撤回、不会再执行。

范围外：

- 工具桥上 DSH 工具执行本身（审批之外）耗时较长时，仍可能触发运行器的空闲时限。
- 调用方断开导致的撤回，时间线仍记为「授权决定：拒绝（任务停止）」，不另设来源。
- Worker 会话中 DSH 原生审批面板的显示方式。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `native-permission-relay`：新增「授权提问卡分段显示 CLI 内容」与「等待授权时暂停空闲时限」。该能力尚在未归档的 `relay-native-approvals-to-host` 中，用 ADDED 表达。
- `worker-run-outcomes`：修改「额外授权被拒绝后完成的轮次」（改为已完成并覆盖 DSH 备选工具），以及引用它的「待核实轮次在原生会话中的结束方式」「可恢复的工具失败不决定整轮终态」。这三条尚在未归档的 `report-denied-permission-as-unverified`、`judge-run-outcome-by-native-terminal` 中，本变更须在两者之后归档。
- `qoder-cli`：修改「权限、公开事件及停止」中拒绝后的结果。
- `native-cli-conversations`：新增「只有命令的 CLI 工具条目以命令作工具参数」。
- `harness-cli-tool-bridge`：新增「工具桥调用不设响应等待上限，调用方放弃即撤回」。该能力尚在未归档的 `integrate-native-cli-conversations` 中，用 ADDED 表达。

## Impact

- Host：
  - `src/host/native-approval-policy.ts`：提问卡标题与 `detail`、Markdown 字面转义。
  - `src/host/harness-observed-tools.ts`、`src/host/harness-conversation-stream.ts`：工具参数取值。
  - `src/host/runtime.ts`：记录本轮 DSH 备选工具的拒绝，按已完成判定且不附工具失败说明；空闲时限暂停入口。
  - `src/host/native-tool-outcomes.mjs` 与各原生运行器（Codex、Hermes、OpenCode/MiMo、ZCode、Kimi/Grok/Qoder、Pi/OMP）：授权被拒后正常结束的轮次报告 SUCCESS，不带说明。
  - `src/host/native-worker.ts`、`src/host/native-bridge.mjs`：经审批邮箱暂停和恢复运行器的空闲计时。
  - `src/host/native-harness-mcp.mjs`：工具桥客户端改用 `node:http`。
  - `src/host/native-harness-tools.ts`：调用方断开时撤回调用。
- Client：无改动。
- 存储、安装入口：无改动。Host 到运行器的审批邮箱新增 `idle-` 前缀的指令，运行器不认识的指令照旧拒绝。
