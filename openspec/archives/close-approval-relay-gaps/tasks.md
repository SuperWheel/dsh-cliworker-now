# Tasks

## 1. 实施

- [x] 1.1 `native-approval-policy.ts`：`approvalQuestion` 标题与分段 `detail`，CLI 内容 Markdown 字面转义。
- [x] 1.2 `harness-observed-tools.ts` / `harness-conversation-stream.ts`：`observedToolInput`，只有 `command` 时以 `{ command }` 作参数。
- [x] 1.3 `runtime.ts`：DSH 备选工具拒绝记录与结果判定。2026-10-28 按用户决定改为：被拒后按已完成判定，不写「本轮结果说明」；运行器报 `LAST_TOOL_FAILED` 时视为被拒工具。
- [x] 1.4 `runtime.ts` / `native-worker.ts` / `native-bridge.mjs`：`task.holdIdle`，Host 计时直接暂停，运行器计时经审批邮箱发送 `idle-` 指令。
- [x] 1.5 （验收中发现）`native-harness-mcp.mjs` 改用 `node:http`；`native-harness-tools.ts` 在调用方断开且无人等待时撤回调用。
- [x] 1.6 （用户 2026-10-28 决定）原生授权被拒后为已完成：`native-tool-outcomes.mjs` 的 `settle` 接收拒绝标记；Codex、Hermes、OpenCode/MiMo、ZCode、Kimi/Grok/Qoder 改为传入该标记，Pi/OMP 运行器直接输出 SUCCESS；新增 `native-tool-outcomes.d.mts` 供 Host 引用 `LAST_TOOL_FAILED`。

## 2. 自动检查

- [x] 2.1 测试：
  - 提问卡标题、`detail` 分段、换行保留、Markdown 符号转义。
  - 工具参数：只有 `command`、有 `input`、两者都无三种条目，实时声明与回放一致。
  - 运行结果（DSH 备选工具）：拒绝后 SUCCESS 或 `LAST_TOOL_FAILED` → completed，且无错误与说明；拒绝后其他原因的 UNCERTAIN 保留；允许后不变；拒绝后 ERROR 仍为失败。
  - 运行结果（原生拒绝）：Codex、Hermes、OpenCode、MiMo、ZCode、Kimi、Grok、Qoder/Qoder CN、OMP 拒绝后正常结束 → SUCCESS，无 `error` 与 `notice`，包括同轮另有工具失败。
  - 空闲时限：Host 计时在等待中不超时、决定后重新计时；运行器邮箱 `hold`/`release` 顺序、先到的 `release`、未启用空闲时限时不发送。
  - 工具桥：调用方断开即撤回、重放仍在等时不撤回；载体不经 `fetch`。
- [x] 2.2 `pnpm typecheck`、关联测试、`pnpm build:preview`。

## 3. Desktop 验收（真实模型调用需已有选型授权）

- [x] 3.1 主 Agent 续聊 Pi，经 DSH 备选命令工具提权：提问卡标题与分段正文；拒绝后任务卡为「结果待核实」（旧规则，已由 3.4 取代）。
- [x] 3.2 Codex 执行一条命令：Worker 原生会话工具块标题显示命令。
- [x] 3.3 空闲时限设为最短档，等待 DSH 备选工具审批超过该时限后再允许：任务不因空闲超时结束，命令执行。
- [x] 3.4 拒绝后为已完成：Codex 原生授权拒绝、Pi 的 DSH 备选工具授权拒绝，任务卡为「已完成」，Worker 会话顶部无横幅，时间线保留授权决定。

## 4. 文档

- [x] 4.1 README（中、英）结果与时限说明；`doc/design.md` 本变更小节；相关变更的发现记录注明由本变更处理。
- [x] 4.2 拒绝结果改为已完成：README（中、英）、`doc/design.md`（本变更小节与 2026-10-25 小节的取代说明）、`report-denied-permission-as-unverified` 与 `relay-harness-tool-approvals` 的 tasks.md。
- [x] 4.3 归档顺序：先归档 `judge-run-outcome-by-native-terminal` 与 `report-denied-permission-as-unverified`，再归档本变更（`worker-run-outcomes` 的 MODIFIED 需求来自这两者）。
  - 2026-10-29：`judge-run-outcome-by-native-terminal` 已归档；`report-denied-permission-as-unverified` 于本日核对 3.2 后归档，随后归档本变更。

## 验证记录（2026-10-28）

### 自动检查

- `pnpm typecheck` 通过。
- 关联测试 18 个文件：439 项通过，1 项跳过（原有跳过项）。涉及 `native-approval-relay`、`task-time-limit`、`native-bridge-time-limit`、`harness-conversation-stream`、`native-harness-tools` 等。
  - 新增的工具桥撤回测试：撤下 Host 侧修复后失败，恢复后通过。
  - 运行器集成测试：空闲时限 400 ms，Host 暂停 1200 ms，运行未超时，总耗时 ≥ 1500 ms。
- `pnpm spec:check` 通过。
- `pnpm build:preview` 成功，预览 Host 可加载；确认无活动任务后，22:58 执行正式 `pnpm build` 更新 Desktop 链接。

### Desktop 实机验收

- 环境：Desktop 0.2.1-rc.3，内置浏览器直连 Host Web UI。
  - 主 Agent：GLM-5.3-Flash，预设为「工作区内修改」。
  - 项目：`/Users/leeyl/AI-Project/cliworker-isolation-test`；工作区外目标目录：`/Users/leeyl/AI-Project/cliworker-accept-outside-20261028/`。
  - 模型使用已有选择：Pi `zai-coding-cn/glm-5.3-flash` low，Codex `gpt-6-luna` low。
- 3.1 提问卡（Pi Worker `pi-2`，run `4c036e0c`）：
  - 标题为「pi-2（Pi）请求授权」。
  - 正文三段：请求摘要、danger-full-access 原因、`工作目录：…`。
  - `>`、`/` 等符号按原文显示；没有生成链接或格式元素。
  - 选项为「允许一次」「拒绝」；任务卡显示「等待审批」，侧栏显示「待回答」。
- 3.1 拒绝（`pi-2`，run `417be91b`；这是改为「已完成」之前的旧规则结果，由 3.4 取代）：
  - 时间线记录「授权决定：拒绝（DSH 用户）」，工具 FAILED。
  - Worker 状态为 `uncertain`，说明为「DSH 备选工具的额外授权已拒绝，但 CLI 报告本轮已完成；结果待核实…」，没有「本轮结果说明」。
  - 任务卡显示「Pi 备选命令-工作区外 · 结果待核实」；`pi-deny-unverified.txt` 未生成。
- 3.2 Codex（Worker `codex-1`，run `ad685608`）：
  - 条目为 `{name: 'commandExecution', command: "/bin/zsh -lc 'printf CODEX-TITLE-CHECK'"}`。
  - 原生会话工具块标题为「commandExecution · /bin/zsh -lc 'printf CODEX-TITLE-CHECK'」。
  - 修复前写入的旧工具块仍显示 callId，按设计不改写。
- 3.3 空闲时限 5 分钟（`pi-2`，run `05671afd`）：
  - 22:59:21 提出授权，23:06:13 点「允许一次」，等待 6 分 52 秒，未触发空闲超时。
  - 工具 COMPLETED；`pi-idle-allow2.txt` 内容为 `PI-IDLE-ALLOW2`；Worker 状态 completed；时间线记录「授权决定：允许一次（DSH 用户）」。
- 验收后已把空闲时限恢复为「不启用」，核对 `general-settings.json` 的 `idleTimeLimitMs` 为 0、权限 0600；Desktop 已正常退出并重新打开。

### 拒绝改为已完成后的检查（2026-10-28 晚）

- 自动检查：
  - `pnpm typecheck` 通过。
  - 7 个运行器与时限测试文件 427 项通过。改动前，其中 29 项按旧规则断言「拒绝即待核实」，均失败。
  - 全量 `pnpm test`：239 个文件、4943 项通过，13 项跳过。第一次全量与 `build:preview` 并发运行时，`native-bridge-time-limit` 中有 2 项因 30 秒超时失败；单独重跑和第二次全量均通过。
  - `pnpm spec:check` 46 项通过；`pnpm spec validate close-approval-relay-gaps --strict` 通过，并提示须在两个来源变更之后归档（见 4.3）。
  - `pnpm build:preview` 首次因 Host 新引用的 `native-tool-outcomes.mjs` 未复制到 `lib/types/host` 而失败；`scripts/build.mjs` 补上后成功。确认无活动任务后，23:35 正式 `pnpm build`。
- Desktop 3.4（Worker 会话中续聊，审批在子会话原生面板）：
  - Codex（`codex-2`，run `45a2cec6`，GPT-6-Luna Low）申请提权写入工作区外的 `deny-b.txt`，点「拒绝」。时间线依次为「CLI 请求授权」「授权决定：拒绝（DSH 用户）」「Codex 原生交互请求已拒绝」。Worker `completed`，`error` 与 `resultNotice` 为空；会话显示「已完成，用时 46 秒」，顶部无横幅；任务卡「工作区外写入-拒绝 · 已完成」；`deny-b.txt` 未生成。
  - Pi（`pi-2`，run `ece911e2`，GLM-5.3-Flash Low）经 DSH 备选命令工具申请 danger-full-access 写入 `pi-deny-completed.txt`，点「拒绝」。运行器原始结果帧为 SUCCESS，附「本轮有 1 个工具步骤失败，CLI 已自行处理」；Host 不再写入这句说明：Worker `completed`，`error` 与 `resultNotice` 为空，该轮没有「本轮结果说明」。时间线有「授权决定：拒绝（DSH 用户）」。任务卡「Pi 备选命令-工作区外 · 已完成」，会话无横幅；`pi-deny-completed.txt` 未生成。
  - 两次续聊开始时，上一轮遗留的「结果待核实」横幅均随新一轮清除。
  - 两个 Worker 结束后，主 Agent 都收到完成通知，并各自做了只读核验，没有派出新任务。
- 验收后：确认无活动任务，Desktop 已正常退出并重新打开，含 token 的启动日志已删除。

### 验收中发现并修复（第 5 项）

- run `4c036e0c`（修复前）：22:46:57 提出授权。22:51:58 Pi 的工具调用失败，提示「DSH 工具调用状态无法确认；未自动重试」，相差 5 分 1 秒；提问卡却留到 22:52:14 本轮结束才撤回。
- 根因：工具桥客户端用 Node 内置 `fetch`，300 秒内收不到响应头就放弃；Host 等工具结束才回复，也不因调用方断开而撤回。
- 修复：客户端改用 `node:http`；Host 在调用方断开、且没有重放请求在等时撤回调用。修复后的 run `05671afd` 等待 6 分 52 秒，命令正常执行。

### 观察

- 调用方断开导致的撤回，时间线记为「授权决定：拒绝（任务停止）」，没有单独的来源（见 proposal 范围外）。

### 未验证

- Windows。
- 运行器计时的 CLI（如 Codex）在 Desktop 中等待 DSH 备选工具审批超过空闲时限：只有单测和运行器集成测试。
- 等待审批期间停止任务。
- 规划模式下的 DSH 备选工具拒绝。
