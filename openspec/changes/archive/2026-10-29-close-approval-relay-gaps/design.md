# Design: 收尾授权中继的四个遗留问题

## DSH 侧事实（0.2.1-rc.3 包源码核实）

- `AskUserQuestionItem` 有可选的 `detail`（「随问题显示、不进入选项标签的补充内容」）。`dsh-client-ui-user-questions` 的通用提问流程把 `question` 放在 16px 标题元素中，没有 `white-space` 设置，换行折叠；`detail` 用 `dsh-client-ui-primitives` 的 `MarkdownText` 渲染在正文区。
- `dsh-client-ui-tool` 的工具块摘要：参数为空串时取 callId；能解析为对象时，按工具类别取偏好键，取不到时取第一个非空字符串值的首行；`{}` 没有字符串值，摘要为 `{}`。

## 1. 授权提问卡

`approvalQuestion` 改为：

- `question`：`<Worker>（<CLI>）请求授权`。
- `detail`：请求摘要、原因（有时）、`工作目录：<项目>` 三段，以空行分隔。每段先拆行、去掉首尾空白和空行，再把 ASCII 标点全部加反斜杠转义（CommonMark 允许转义任意 ASCII 标点，结果按字面显示），段内各行以「反斜杠 + 换行」硬换行连接。
- 选项、`id`、`header` 与 `decisionFromAnswer` 不变。

`approvalPrompt` 保留原样，继续用于 Worker 会话审批面板的 `reason`（DSH 面板按纯文本显示，不属本变更）。

取舍：不把命令放进代码块。代码块需要按内容中最长的反引号串计算围栏长度，而摘要里的命令只是摘要的一部分；全量转义更简单，也不依赖 `MarkdownText` 是否过滤 HTML。

## 2. 工具块参数

`harness-observed-tools.ts` 导出 `observedToolInput(toolCall)`：有 `input` 时返回 `input`；否则 `command` 为字符串时返回 `{ command }`；都没有时返回 `undefined`。

- 回放路径（`harness-conversation-stream.ts`）：`arguments` 为 `observedToolInput` 的 JSON，没有时仍为空串。
- 实时声明（`HarnessObservedTools.declare`）：`json(observedToolInput(...) ?? {})`。同一轮内参数一致性检查使用同一取值，不会误报「参数发生变化」。
- 已写入会话的旧工具块不改写。

## 3. 授权被拒后的结果：已完成

用户决定（2026-10-28）：授权被拒是用户的决定，不是 CLI 的失败。CLI 正常结束的轮次显示「已完成」，不显示「结果待核实」，Worker 会话顶部不出横幅，也不附「工具步骤失败，CLI 已自行处理」。拒绝的请求、决定与来源仍在时间线（「授权决定：拒绝（…）」与原生诊断事件）。

- 原生运行器：`createToolOutcomes().settle(io, response, scope, denied)` 新增第四个参数。为真时直接报告 SUCCESS，不带说明，也不看其他工具失败；为假时按原规则判定。
  - Codex、Hermes、OpenCode/MiMo（原生 HTTP 会话）、ZCode、Kimi/Grok/Qoder（ACP）原来的「有拒绝即 UNCERTAIN」分支改为把拒绝标记传给 `settle`。
  - Pi/OMP 运行器不经 `settle`，其拒绝分支直接输出 SUCCESS。
  - ACP 的无正文检查放到拒绝之前：没有正文仍是待核实，无论是否有拒绝。
  - Claude Code 在拒绝时以 `interrupt: true` 中断本轮，并以 `permission_denials` 判失败，不在本变更范围内。
- DSH 备选工具（Host 决定）：`WorkerRuntime.harnessApproval` 在决定为拒绝且来源不是任务停止时，把该轮 runId 记到 `task.harnessDeniedRunId`。运行器不知道这是拒绝，只看到一次工具失败，所以结果判定中：
  - 运行器报 SUCCESS：不写「本轮结果说明」（说明里的失败数包含被拒的工具）。
  - 运行器报 UNCERTAIN 且说明为 `LAST_TOOL_FAILED`（被拒后 CLI 没有再执行工具或回复就结束）：视为被拒工具即该失败步骤，按已完成处理。
  - 运行器因其他原因报 UNCERTAIN、失败、中断、停止：仍按原顺序判定。
- 记录以 runId 区分，下一轮无需清理。

取舍：
- 有拒绝的轮次里，其他工具的失败不再另附说明，最后一步是其他工具失败时也按已完成处理。这样规则简单，各 CLI 一致；这些失败的步骤仍在时间线中显示为失败。
- DSH 备选工具被拒后，Host 不区分运行器的「最后一步失败」是不是被拒的那一步。若被拒之后另一个工具也失败、CLI 随即结束，会按已完成处理，与上一条取舍一致。

## 4. 等待授权时暂停空闲时限

运行时每轮设置 `task.holdIdle()`，返回只生效一次的恢复函数；`harnessApproval` 在等待前取得，在决定后调用。

- Host 计时（Pi、OMP 及非原生桥传输）：与 CLI 原生审批共用 `holdHostIdle`，计数加一并清除空闲计时器，恢复时减一并重新计时。原 `relay` 改用同一函数，行为不变。
- 运行器计时（其余原生 CLI）：只在 `limit.idleMs > 0` 时，经该轮的私有审批邮箱发送 `hold`、`release` 两条指令。每次暂停有一个键 `idle-<序号>`；邮箱同一 id 只接受一种内容（实测：同 id 换内容会被拒为「引导请求标识已用于其他消息」），所以两条指令的 id 分别为 `idle-<序号>:hold` 与 `idle-<序号>:release`。`release` 等 `hold` 的回执落定后才发送，保证运行器按顺序处理。
  - `native-worker.ts` 的启动结果新增 `holdIdle(key, state)`，写入与授权决定相同的邮箱。
  - `native-bridge.mjs` 的审批邮箱处理函数遇到 `idle-` 前缀时，核对 id 后缀与内容一致，再交给 `native-time-limit.mjs` 的 `createIdleHolds`：`hold` 调用 `timers.hold()` 并按键保存恢复函数；`release` 调用并作废该键；先到的 `release` 也会作废该键，之后同键的 `hold` 不再生效。其他 id 仍交给 `io.answerApproval`。
- 运行结束时清除 `task.holdIdle`；运行器退出时计时器随之关闭，未恢复的暂停不会遗留。

取舍：不新增独立邮箱。审批邮箱每轮已建立、已绑定 nonce 与目录，复用它不改请求文件格式；代价是共享每轮 200 次提交的上限（见风险）。

## 5. 工具桥调用的等待上限与撤回

- 事实：Node 内置 `fetch`（undici）默认 `headersTimeout` 为 300 秒。Host 的 `/rpc` 等工具结束才写响应头，所以任何超过 5 分钟的工具调用都会在客户端失败。实测 22:46:57 提出授权、22:51:58 工具失败，相差 5 分 1 秒。Host 的 `server.requestTimeout`（30 秒）只限制接收请求体，不影响响应。
- 客户端（`createNativeHarnessClient`）改用 `node:http` 的 `request`：没有响应等待上限，仍按调用方的 `signal` 取消，响应大小上限、只认 200、错误文字与原来一致。Pi 扩展与 MCP stdio 载体共用此客户端。
- Host（`createNativeHarnessTools`）：账本条目记录等待中的请求数。响应在写完前关闭（`close` 时 `writableFinished` 为假）即减一，减到零时中止该调用的控制器。中止沿 `dispatch` → 工具 `signal` → DSH 工具的授权请求传递，`answerHarnessApproval` 随之撤回提问卡，决定记为「拒绝（任务停止）」。重放同一调用的请求会加一，因此一个断开不影响另一个。
- 取舍：不采用 Host 先写响应头、再周期性写空白保活。那要改 Host 的状态码语义（错误也得用 200），而 `fetch` 还有 300 秒的 `bodyTimeout`，需要持续保活；改客户端更直接。

## 兼容性

- Client、存储、安装入口不变。
- 新 Host 搭配旧运行器不会出现：运行器 `native-bridge.mjs` 与 Host 同包构建。旧运行器若收到 `idle-` 指令，`answerApproval` 找不到 id 会拒绝，Host 忽略失败，空闲时限照旧计时。

## 风险与回退

- 审批邮箱每轮最多 200 次提交。启用空闲时限时，每次 DSH 备选工具审批占用 2 次；单轮超过约 60 次此类审批后，后续暂停或授权回复可能无法送达，授权按拒绝处理。实际单轮审批次数远低于此。
- 提问卡依赖 DSH 渲染 `detail`。若后续版本不再渲染 `detail`，提问卡只剩标题；升级 DSH 时需复核。
- 回退：五项相互独立，可分别撤回对应改动，无数据迁移。已保存为「结果待核实」的历史 Worker 不改写。
- 归档顺序：`worker-run-outcomes` 的三条 MODIFIED 需求来自未归档的 `judge-run-outcome-by-native-terminal` 与 `report-denied-permission-as-unverified`，本变更须在两者之后归档，否则归档会因找不到需求而拒绝。
