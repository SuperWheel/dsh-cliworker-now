# Tasks

## 1. 可行性与能力核实

- [x] 1.1 核实 DSH 三档预设的沙箱/审批组合与审批接口语义（Desktop 安装包内置配置与包文档）。
  - 2026-10-28：仅可查看＝read-only+ask，工作区内修改＝workspace-write+ask，完全权限＝danger-full-access+never；另有实验性 auto；`approval.request` 需在 agent 未结束轮次中调用，无应答者即拒绝；DSH 委派子 Agent 审批固定 never。结论已写入 design.md。
- [x] 1.2 核实插件子 Agent（或父 Agent）在 CLI 运行期间能否发起 `approval.request` 并在 Desktop 弹窗；确认子 Agent 审批策略是否被固定为 never、轮次是否处于活动状态。不可行时回到用户重新决策。
  - 2026-10-28 只读核实（开发依赖 0.2.1-rc.3 源码；DSH Desktop 0.12.1 安装包 `app.asar` 内置 0.2.1-rc.2，相关实现一致；未启动 Desktop）。结论：**按现方案不能保证「每次都弹窗」，已停下等待用户决定**。
  - 子 Agent 审批策略：`dsh-subagent` `captureDelegatedPolicyOverrides` 把子会话固定为 `never`（`source: 'delegation'`），但「之后的子会话切换优先」；插件可用公开的 `approval.setPolicy(child, 'ask')` 或 `setApprovalPolicy(child.session, 'ask')` 改回 ask（前者会给子会话下一步注入一条「由用户更改」消息）。目前插件未改，桥接 DSH 工具的审批也因此被 `never` 直接拒绝。
  - 轮次：CLI 运行期间子 Agent 的 AgentLoop 正在流式输出本轮（`harness-conversation-stream.ts` `segment(agent, turn, step, signal)`），满足 `approval.request` 的开放轮次要求。父 Agent 不满足：派遣在后台执行（`routing.ts` 指引「任务在后台执行并报告完成」），父轮次通常已结束，侧栏续聊也没有父轮次，此时 `request` 会抛错。
  - 弹窗可见性（关键）：Host `approval/request` waterfall 经 `dsh-api-remotes` 按 agentId 转发；客户端 Gateway（`dsh-api-gateway` `client.browser.js` `answer()`）用 typert `agent` 适配器解析 agentId，客户端未持有该会话时直接 `next`，Host 结果为 `unavailable`（拒绝）。`dsh-client-ui-approval` 的面板注册为该会话的待处理交互，只在该会话的 `conversation.composer` 中显示。插件客户端仅在用户打开某 Worker 的原生会话时才 `sessions.retain` 子会话（`src/client/harness-conversation.tsx`）。因此以子 Agent 发起时，只有用户正好打开该 Worker 会话才会看到弹窗，否则静默拒绝；主对话不会出现弹窗。
  - 结果词汇只有 `allowed-once | rejected | cancelled | unavailable`，没有「本会话始终允许」（关系到 1.4）。
  - 2026-10-28 用户决定（据上述结论）：主 Agent 调用（`cliworker_start` / `cliworker_followup`）发起的轮次在主 Agent 页面弹出（父 Agent `userQuestions.ask` 问题卡，只要求存活根 Agent，不要求开放轮次）；用户在 Worker 会话或侧栏中发起的轮次按方案 A（子 Agent `approval.request`，子会话审批策略每轮同步为父会话策略，客户端在 CLI Worker 面板挂载期间持有运行中 Worker 的子会话并显示「等待审批」）。已写入 design.md 与 native-permission-relay 规格。
  - 残留限制：用户未打开 CLI Worker 面板时，子会话不被持有，Worker 会话内发起的轮次的授权按「无人应答」拒绝；主 Agent 调用的轮次不受影响。
- [x] 1.3 逐个核实 design.md 映射表中「待核实」的 CLI 原生模式与审批事件（Kimi/Grok/Qoder 免确认模式、ZCode、Hermes、Antigravity 去掉免确认后的审批事件），更新映射表。
  - 2026-10-28 由两个 Codex 子 agent（gpt-6.1-sol high）只读核实，我对照仓库代码复核后采用：仅用 `--help`/`--version`（临时 HOME、超时、Kimi 设 `KIMI_CODE_NO_AUTO_UPDATE=1`）、安装包源码/二进制字符串与 `codex app-server generate-json-schema`；未发模型请求、未登录、未改用户配置。本机版本：Kimi 2.3.3、Grok 1.0.62、Qoder 1.1.73 / CN 1.1.74、ZCode 0.16.9（托管）/ 0.17.0（Desktop）、agy 1.4.9、Claude Code 2.1.287、Codex 0.162.1；Hermes 空 HOME 下 `--help` 报错，只读源码。
  - 已确认并采用：Qoder CLI `bypass_permissions` / ACP `yolo`；ZCode `plan/edit/yolo`（`auto` 未实现）；Grok `agent --always-approve stdio`；Claude `--permission-mode` 含 `plan/acceptEdits/bypassPermissions`、`--permission-prompts host|none`；Codex `sandbox` 三值与 `approvalPolicy` `untrusted/on-request/never`。映射表已更新（design.md「各 CLI 映射」）。
  - 无法确认、保持现有行为：Kimi `--yolo`/`--auto` 帮助与 ACP 描述矛盾（完全权限仍用 `default`，授权由插件自动放行）；Hermes 无已确认只读开关（仅可查看拒绝派遣），`--yolo` 对 HTTP 通路未核实（完全权限保持现有）；Antigravity 去掉免确认后是否有可回复的审批事件未确认（保持 `--sandbox --dangerously-skip-permissions`，仅可查看拒绝派遣）；Grok 顶层 `--permission-mode` 对 `agent stdio` 的效力、各 CLI 真实审批往返均未实测。
- [x] 1.4 核实 DSH 审批结果是否提供「本会话始终允许」语义，以及 Codex 等 CLI 的对应回复。
  - DSH 结果无「始终允许」。用户 2026-10-28 决定通过 CLI 原生会话级授权实现，仅在主页面问题卡提供：Codex `acceptForSession`（permissions 请求 `scope:'session'`）、Claude `updatedPermissions`（CLI 自己的 `permission_suggestions` 改为 `destination:'session'`）、Kimi `approve_always`、Qoder `proceed_always`（不选 `proceed_always_and_save`）、Hermes `choice:'session'`（仅事件 `choices` 含时）。不提供：Grok（always 持久到项目）、ZCode（无已确认会话级回复，`permissionUpdates` 写项目规则）、OpenCode/MiMo（`always` 存活到进程重启或范围未核实）。
- [x] 1.5 用 openspec-update-change 修订 `report-denied-permission-as-unverified` 与 `worker-dispatch` 相关规格（拒绝来源、仅可查看可只读派遣）。
  - `report-denied-permission-as-unverified` 的 worker-run-outcomes 首句改为按 DSH 预设与用户决定处理并列出拒绝来源；本变更新增 `specs/worker-dispatch/spec.md`（MODIFIED「选型和宿主权限保持」：仅可查看允许只读派遣，Antigravity、Qoder、Qoder CN、Hermes 拒绝）。`corepack pnpm spec validate <name> --strict` 两个变更均通过。

## 2. 实施

- [x] 2.1 Host：读取父会话预设/规划模式，每轮快照沙箱映射；授权请求按当前预设决定。
  - `index.ts` `permissionState`（`planMode` / `sandboxPolicy.resolve().mode` / `approval.overrideOf ?? config.policy ?? 'ask'`，无审批服务按 `never`）；`runtime.setAccessSnapshot` 每轮快照档位并写状态「本轮权限：…」，仅可查看以 `launchMode=plan` 启动；`decideNativeApproval` 每个请求到来时重读父会话状态（`decideApproval`）。完全权限下没有已确认原生模式的 CLI（Kimi、Hermes、Antigravity、Pi、OMP）在时间线说明按写入模式运行。
- [x] 2.2 桥控制通道新增授权请求/应答消息，带运行身份校验、停止撤回与清理。
  - 桥帧 `{type:'approval',id:'approval-N',request}`（runner `nativeApprovalRequest` 与 Host `parseNativeApprovalRequest` 双向限长、丢弃未知字段）；Host → runner 走私有邮箱命令 `approval`（`createNativeApprovalControl` / `receiveNativeApprovalControl`，nonce 与目录绑定）。停止、桥关闭、超过 50 个待决、无 nonce 时 runner 一律回复拒绝；Host 侧运行已停止或 runId 已变更时强制拒绝（来源「任务停止」）。
- [x] 2.3 Host 调用 DSH 审批，弹窗文案含 Worker、CLI、请求内容、工作目录；等待期间暂停空闲时限。
  - 已完成：主页面问题卡与 Worker 原生审批面板文案（`approvalPrompt`：Worker、CLI、请求摘要与详情、工作目录）；Worker 卡片「等待审批」（`approvalWaiting` 计数）。
  - 2026-10-28 合并时接入（主会话）：`startRunTimers` 新增 `hold()`，只暂停空闲窗口、不暂停总时限；`createNativeIO` 第六个参数 `onApprovalWait` 在每个审批请求发出前持有、在决定、停止或关闭时释放；`native-bridge.mjs` 接到 `timers.hold()`。夹具（`tests/native-approval-relay.test.ts`「the idle window waits while a user decides」，模拟计时器）：持有期间超过空闲窗口不超时、释放后重新计满一个窗口、持有期间总时限照常触发；两个并发请求分别在批准与停止后释放。Pi/OMP 不经此桥且无审批协议，不涉及。
- [x] 2.4 Codex：按映射设置 thread/turn 沙箱与审批策略，改写 `native-codex.mjs:228` 一致性检查为「不比预设更宽」，不再覆盖用户原生网络/可写目录配置。
  - `codexPermission`：仅可查看（规划）`read-only`+`never`；工作区内修改 `workspace-write`+`on-request`；完全权限 `danger-full-access`+`never`。一致性检查改为核对 `approvalPolicy` 与沙箱类型；只有规划轮次与旧版（无档位）运行才在 `turn/start` 固定 `sandboxPolicy`、检查网络，带档位时保留用户原生网络/可写目录配置。
- [x] 2.5 Claude、ACP 系、ZCode、OpenCode/MiMo、Hermes、Antigravity：按映射调整启动参数，授权请求改走 Host。
  - 按 1.3 核实结果：Claude（`bypassPermissions`、`--permission-prompts host`、`can_use_tool` 中继，拒绝仍 `interrupt:true` 判失败）；ACP 系（`session/request_permission` 中继，Qoder 完全权限 `bypass_permissions`/`yolo`，Grok `--always-approve`，Kimi 不变）；ZCode（`yolo`，`interaction/requestPermission` 中继）；OpenCode/MiMo（完全权限 `"*": allow`、`bash: allow`，`permission.asked` 中继）；Hermes（`approval.request` 中继，完全权限保持现有）。Antigravity 按核实结果保持原参数、无中继（无已知审批协议）。runner 等待期间不阻塞读循环（Codex、Claude、ACP、ZCode）；Hermes 与 HTTP 会话系在事件循环内顺序等待。
- [x] 2.6 `index.ts`：仅可查看模式允许只读派遣（Antigravity 等无整进程只读的 CLI 仍拒绝）。
  - `assertExecution(agent, dispatch)` 仅对 CLI 派遣及其控制入口放行仅可查看（合并隔离副本、账号操作仍拒绝，见 3.3 审查第 1 项）；`assertAccessSupported` 仅在父会话沙箱为只读时拒绝 Antigravity、Qoder、Qoder CN、Hermes（Worker 规划任务本身不受影响）；派遣与排队续聊两处均检查。
- [x] 2.7 完全权限下残余授权请求自动放行（不弹窗），规划模式除外。
  - `decideApproval`：规划 → 拒绝（「规划模式」）；`never`+完全权限 → 允许一次（「完全权限自动放行」）；`never`+其他 → 拒绝（「权限预设」）；`ask` → 按来源弹窗。
- [x] 2.8 时间线记录授权请求、决定与决定来源。
  - 时间线：状态「CLI 请求授权：<摘要>」、「授权决定：<允许一次/本会话始终允许/拒绝>（<来源>）」；回复未送达记诊断「授权决定未送达 CLI，CLI 按拒绝处理」。只记请求摘要（命令/路径），不记环境变量或凭据。

## 3. 自动检查

- [x] 3.1 夹具矩阵：三档预设 × 规划模式 × 批准/拒绝/关闭/无应答者/停止 × 运行中切换预设；完全权限残余请求自动放行并记录、规划模式下仍拒绝写入；继承网络配置不再启动前失败。
  - `tests/native-approval-relay.test.ts`（全部为合成夹具，无 CLI 进程/模型/Desktop）：三档预设 × Worker 规划/父会话规划的档位与决定；批准、本会话始终允许、拒绝、关闭（自定义回答）、无应答者（`unavailable`）、停止（`cancelled`）的答案映射；运行中切换预设后按新状态决定；完全权限残余请求自动放行、规划模式仍拒绝；传输通道无 nonce/停止/桥关闭/未知 id/畸形回答；邮箱往返；`BridgeProtocol` 帧校验；runtime 中继（状态与决定文本、停止或 runId 变更强制拒绝、回复未送达诊断）。
  - 各 runner 中继夹具：Codex（`accept`/`acceptForSession`/`decline`，带档位时用户原生网络配置不再启动前失败）、Claude（`allow`/会话级 `updatedPermissions`/`deny`+`interrupt`）、Kimi/Grok（ACP 选项）、Qoder（`proceed_always`、不选 `proceed_always_and_save`、完全权限 `yolo` 回读确认）、ZCode（`allow`/`deny`，无 `permissionUpdates`，`yolo` 模式）、OpenCode/MiMo（`once`/`reject`）、Hermes（`once`/`session`/`deny`，不发 `always`）。拒绝后正常结束仍为结果待核实（Claude 为失败）。
- [x] 3.2 每个 CLI 的启动参数映射测试，确认不比预设更宽。
  - `native-approval-relay.test.ts`「each CLI launches no wider than the DSH tier」：Codex exec、Claude、Qoder、Grok 三档参数；`native-http.test.ts` OpenCode/MiMo 权限规则（规划仍 `edit/bash: deny`）；`native-zcode.test.ts` `edit`/`yolo`；`native-qoder.test.ts` `yolo`；`native-primary-runners.test.ts` Codex 四种档位/规划组合与 Claude `claudePermissionMode`、档位与启动参数不一致时拒绝启动；`harness-service-integration.test.ts` 仅可查看下 Antigravity、Qoder、Hermes 拒绝派遣。
  - 未覆盖：runtime `launchMode`（仅可查看 → 规划）没有端到端用例，由映射测试的 `launch()` 模拟与代码复核覆盖。
- [x] 3.3 `pnpm typecheck`、关联测试、`pnpm build:preview`。
  - 2026-10-28：`corepack pnpm typecheck` 通过（Host/Client，DSH 0.2.1-rc.3）。新 worktree 没有生成的 `lib/typert.*`，Client 检查先报 `dsh-cliworker-now/remote` 缺失；从本次 `build:preview` 隔离包复制 `lib/typert.*`（被 gitignore）后通过。
  - `corepack pnpm build:preview` 通过（隔离包 `.cache/preview-package`）；未运行 `pnpm build`，未更新 Desktop 链接。
  - 关联测试：native-approval-relay 43、native-primary-runners 93、native-acp 36、native-qoder 52、native-zcode 35、native-http 87、harness-service-integration、routing、worker-permissions、followup-queue、agy-run-outcome 均通过。
  - 全量 `corepack pnpm test`：4802 通过、13 跳过、1 失败。失败为 `build-dependencies.test.ts`「keeps Host Typert classes external…」，需要完整 `pnpm build` 生成的 `lib/types/host/index.js`；基线提交 ac288ab 在同环境下同样失败（2 个），与本变更无关。
  - 本变更引起并已修复的回归：`followup-queue`、`agy-run-outcome` 测试的服务桩没有 DSH 权限服务，补 `assertAccessSupported` 桩（与既有 `assertExecution` 桩同一约定）。
  - 2026-10-28 Codex 审查（gpt-6-astra high，只读，范围 `git diff c1e85a3`）的 6 项发现均经我对照代码确认并修复，补测试于 `native-approval-relay.test.ts`：
    1. 去掉只读拒绝也放开了合并隔离副本：`assertExecution` 恢复默认拒绝仅可查看，只有 CLI 派遣及其控制入口（选型、派遣、续聊、排队、引导、中断、重跑、工具桥、Worker 权限设置）传 `dispatch=true`；合并隔离副本与账号登录/输入仍拒绝。
    2. 审批按 `worker.mode` 判定，仅可查看下以规划启动的轮次仍会弹窗：runtime 记录本轮 `launchMode` 并传给 Host 判定。
    3. 停止开始后、进程中止前仍可送达允许：`nativeStopRequested` 或本轮审批撤回信号触发即改为拒绝。
    4. CLI 退出或协议失败时未撤回待决弹窗、`approvalWaiting` 残留：每轮建 `task.approvals`，结束与停止时中止并清除等待计数。
    5. 审批邮箱一轮最多 200 次提交，runner 只限并发：runner 第 201 个请求直接拒绝，不再发出无法应答的请求。
    6. 完全权限下启动的用户轮次子会话策略为 `never`，父会话中途改为询问后子会话直接拒绝：每次子会话审批前同步为 `ask`。
  - 修复后复验：`corepack pnpm typecheck` 通过；`corepack pnpm build:preview` 通过；全量 `corepack pnpm test` 4807 通过、13 跳过，仅 `build-dependencies.test.ts` 同一既有失败（需完整构建产物）。

## 4. 验收

- [x] 4.1 Desktop 实机：三档预设下派遣 Codex，核对弹窗出现与否、批准/拒绝结果、产物与时间线（真实模型调用需已有选型授权）。
  - 2026-10-28 Desktop 实机验收（macOS，DSH Desktop 0.2.1-rc.3，插件链接到本仓库 ac4240b 的构建）。界面经内置浏览器直连 Desktop Host 的 Web UI 操作（与 Electron 窗口同一 Host 与 profile）；Electron 窗口中 Computer Use 点击无效，未在窗口内操作。主 Agent GLM-5.3-Flash Max，Worker Codex `gpt-6-luna`/low；工作区 `cliworker-isolation-test`，工作区外目录 `cliworker-accept-outside-20261028`。证据为 `~/.dsh/cliworker-now/<id>.events.jsonl` 与实际文件（不入 Git）。
  - 工作区内修改：主 Agent 派遣 Codex 写工作区外文件，Codex 请求提权，主页面弹出提问卡「执行命令：/bin/zsh -lc 'printf … > …/allow.txt'」。允许一次 → 事件「授权决定：允许一次（DSH 用户）」，任务完成，allow.txt 内容正确（0600）。拒绝 → 「授权决定：拒绝（DSH 用户）」，工具步骤失败，任务为结果待核实（「Codex 额外授权已拒绝，但 CLI 报告本轮已完成；结果待核实…」），deny.txt 未创建。
  - 仅可查看：以规划模式启动，Codex 回复「approval policy is Never」，无弹窗、未写文件（符合设计）。完全权限：无弹窗，直接写入 full.txt，退出码 0。
  - 发现（未修）：① 授权卡把原因、命令目录、工作目录连成一段显示，没有换行。② DSH 备选工具（如 Pi 的 DSH bash）的审批走 DSH 原生审批，只出现在 Worker 子会话面板；由主 Agent `cliworker_followup` 发起时主页面没有提问卡，任务卡只显示「运行中」，不打开子会话就看不到，任务会一直等待（详见 `scope-harness-bridge-tools` 4.1）。② 由 `relay-harness-tool-approvals` 处理。
  - 未验证：会话级授权（allow-session）真实往返；Electron 窗口内操作；Windows。
- [x] 4.2 至少一个 ACP 系 CLI 与 Claude Code 同类复验；未验证的 CLI 在本任务下列出。
  - 2026-10-28 合并后真实验收（macOS，`.test-data/accept-merged.ts` 用隔离预览包快照的 `WorkerRuntime` 跑真实 CLI 与模型；DSH 审批弹窗由脚本按预设决定并记录，CLI 端、进程退出与产物均为真实；证据在 `.test-data/accept-merged/<场景>-<cli>-*/report.json`，不入 Git）。场景：工作区内修改下写工作区外文件（`printf <标记> > <工作区外>/outside.txt`）。
  - **发现并修复缺陷**：Claude Code 2.1.287 只带 `--permission-prompts host` 时不发 `can_use_tool`，所有需确认的操作被 CLI 自动拒绝（首轮验收任务失败，`approval` 帧 0；直接探测 `curl` 同样）。加 `--permission-prompt-tool stdio` 后发出 `can_use_tool`（直接探测确认）。`nativeClaudeArgv` 在有审批通道时追加该参数，并拒绝重复传入。另：Claude 拒绝后以 `error_during_execution` 退出码 1 结束，传输层原先用「Native process exited unsuccessfully (1)」覆盖了「CLI 额外授权被拒绝，本轮已中断」；改为运行器已报 ERROR 时保留其原因（新增回归测试，修复前失败）。
  - 修复后：Claude `sonnet`/low 允许 → 完成，工作区外文件内容正确；拒绝 → 失败「CLI 额外授权被拒绝，本轮已中断」，文件未创建。Codex `gpt-6-luna`/low 主动请求提权 → 弹出「执行命令…」→ 允许后完成、文件正确（未要求提权时模型在沙箱内失败后直接结束，没有请求审批）。ACP：Qoder `qfmodel`/low、Grok `grok-4.5`/low 允许 → 完成、文件正确。OMP 见 `reenable-native-cli-features` 4.1。
  - 未验证：Kimi、Qoder CN、ZCode、OpenCode、MiMo、Hermes 的真实审批往返；会话级授权（allow-session）真实往返；Desktop 弹窗本身（4.1）；Windows。

## 5. 文档

- [x] 5.1 README（中英）权限说明：三档预设对应的 CLI 行为、完全权限的风险提示；`doc/design.md` 同步。验证记录写在本文件对应任务下。
  - README.md / README.en.md「权限与数据」改写为三档预设对应的 CLI 行为、弹窗位置、本会话始终允许范围与完全权限风险提示；中文功能列表「不越权」改为「权限跟随 Harness」，英文补「Denied authorization」。`doc/design.md` 追加「2026-10-28 CLI 权限跟随 DSH 预设，额外授权交给 DSH」，替代旧的「只读拒绝派遣」「拒绝全部额外授权」。
