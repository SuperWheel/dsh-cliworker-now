# Tasks

## 1. 定位根因 〔后端｜1h〕

- [x] 1.1 读 2026-11-20 实机 raw 记录，确认 agy 转后台的信号与命令去向
  - Worker `b665400a` run `5d6e130e`（`~/.dsh/cliworker-now/…5d6e130e-….raw.jsonl`，只读，未改动）：`run_command`（`WaitMsBeforeAsync: 10000`）只有一条 `tool_call` `in_progress`，之后只有正文「已启动后台计时循环任务……请稍候」与 `stopReason: end_turn`，没有 `tool_call_update`、状态值或输出文本表示转后台
  - 下一轮 run `a109087d` 的 `session/load` 回放：同一 `toolCallId` 为 `status: failed`、`rawOutput.output: ""`；`agy-ticks.txt` 只有 14:38:23、14:38:28 两行（转后台前 10 秒），即命令随插件关闭 agy 进程而中止
  - 同类旧例：Worker `e15ebd2f` run `56a468f1`（`sleep 120`，`WaitMsBeforeAsync: 500`）同样判「CLI 工具缺少终态」；本机其余含该参数的 raw 记录中，该命令都已有终态（本轮内 `completed`，或下一轮回放中的 `failed`）
  - `strings ~/.local/bin/agy`：`WaitMsBeforeAsync` 为 `run_command` 必填参数，说明「Milliseconds to wait for the command to finish before backgrounding it (500 to 10000)」
- [x] 1.2 定位判定：`src/host/native-acp.mjs` 原第 504 行对任何未终态工具判「CLI 工具缺少终态」（v0.8.1 起），不区分 CLI 主动转后台与协议丢失终态
  - 证据：`b7703b2` 之前的 `native-acp.mjs` 第 504–505 行 `if ([...tools.values()].some(...)) fail('CLI 工具缺少终态')`；两次实机失败的 raw 终态行 `error` 均为该文本

## 2. 实现 〔后端｜1.5h｜前置 1〕

- [x] 2.1 `native-acp.mjs`：新增默认关闭的 `settings.backgroundCommand(update)`；工具首次识别后在状态中保留命令文本。本轮 `end_turn`、无其他失败且未停止时，未终态工具全部可转后台 → UNCERTAIN，说明「转入后台、本轮结束时仍未完成、随会话中止、没有结果、请核查产物或续聊要求前台运行」并列出命令（单条截断 200 字符，最多 3 条）；工具行补发 FAILED，输出 `BACKGROUND_COMMAND_TOOL_NOTE`；与后台子 Agent 待核实说明合并
  - 其他未终态工具仍判「CLI 工具缺少终态」；非 `end_turn` 与停止不进入该分支
- [x] 2.2 `native-agy-acp.mjs`：`agyBackgroundCommand` 只认 `name === 'run_command'` 且 `rawInput`/`args` 带数值 `WaitMsBeforeAsync`，返回 `CommandLine`；Antigravity ACP 启用该钩子
  - 证据：`native-agy-acp.mjs` 导出 `agyBackgroundCommand` 并在 `runNativeAgyAcp` 传入 `backgroundCommand`；识别用例见 3.1，实机识别见 4.1
- [x] 2.3 文档：`doc/design.md` 追加 2026-11-20 一节；README 与用户文档未提及该错误文本，无需改
  - 证据：`doc/design.md`「2026-11-20：Antigravity 命令转后台后判待核实」；`grep 缺少终态 README*` 无结果

## 3. 模拟回归测试 〔测试｜1h｜前置 2〕

- [x] 3.1 `tests/native-agy-acp.test.ts` 新增 6 项（模拟夹具按 2026-11-20 raw 的更新形状回放，已在用例与夹具注释标注模拟）
  - 转后台后 `end_turn`：UNCERTAIN，正文保留，说明含「转入后台／仍未完成／随之中止」与命令，不含「缺少终态」；工具帧为 RUNNING → FAILED 并附说明；只发一次 prompt
  - 同轮补发 `completed`：SUCCESS，无后台说明；另有不带该参数的未终态工具：ERROR「CLI 工具缺少终态」；`max_tokens` 结束：ERROR；运行中停止：ERROR 且发出 `session/cancel`；识别函数只认 `run_command` + 数值参数
  - 回退检查：临时注释 Antigravity 的 `backgroundCommand` 钩子后，主用例失败（复现原「缺少终态」），边界用例照常通过；已恢复
- [x] 3.2 运行验证（2026-11-20，`KIMI_CODE_NO_AUTO_UPDATE=1`，保留代理变量）
  - `corepack pnpm vitest run tests/native-agy-acp.test.ts`：51 项通过
  - ACP 及原生运行器相关 10 个文件（`native-acp`、`native-agy-acp`、`native-codebuddy`、`native-acp-traecn-options`、`native-attachments`、`build-host-copy-manifest`、`native-primary-runners`、`agy-run-outcome`、`native-agy-harness`、`native-agy-permission-levels`）：397 项通过
  - `corepack pnpm typecheck`：通过（DSH 0.2.2-rc.5）
  - `corepack pnpm lint`：0 error；改动的两个源文件无 warning（测试目录被 lint 忽略）
  - `corepack pnpm format:check`：新规格已格式化；`native-acp.mjs`、`native-agy-acp.mjs`、`tests/native-agy-acp.test.ts` 在改动前（HEAD）就不符合 Prettier，属存量，按约定不整文件格式化
  - `corepack pnpm spec validate vnext-agy-background-command-leeyl --strict`：通过
  - 3.x 阶段未新建仓库外测试或备份目录；临时文件只在会话 scratchpad（4.1 实机证据目录见下）

## 4. 真实验收 〔测试｜0.5h｜前置 3〕

- [x] 4.1 Mac Desktop 真实 agy：让 Antigravity Worker 前台跑约 60 秒循环，核对 agy 转后台时任务卡为「结果待核实」、说明与命令行一致、工具行为失败附说明，事件与 raw 记录相符
  - 2026-11-20 用户授权（经主会话转达）真实 agy 调用与 Mac Desktop 测试。确认无运行中/排队 Worker 后 `corepack pnpm build:preview`（隔离包含 `agyBackgroundCommand`）→ osascript 退出 Desktop（4 秒内退出）→ `corepack pnpm build` → 带无障碍与三项防节流参数重启 DSH Desktop 0.2.2-rc.5（main `67c2b7e`，含 `b7703b2`）；之后无新崩溃日志
  - 操作：Codex CU（gpt-6.2-sol high，完整路径绑定、只用 paste）在已有工作区 `ws` 新建对话「派遣 Worker 追加时间戳任务」，派 Antigravity（gemini-3.8-flash-low，自动审批档）执行「前台每 5 秒向 agy-bg-ticks.txt 追加时间、共 12 次、跑完报告行数」。Worker `b8184daa-65df-4af5-b197-f356c40cf0c5`（显示名 `agy-bg-ticks`）
  - run `57f9fe78`：agy 发起 `run_command`（`WaitMsBeforeAsync: 10000`，另带新参数 `IsDaemon: false`）后只回「已启动循环任务……将等待」并 `end_turn`。raw 终态行 `status: UNCERTAIN`，`error` 为「Antigravity ACP 把命令转入后台后结束了本轮：命令在本轮结束时仍未完成，Worker 关闭会话后随之中止，没有结果。请核查实际产物；需要结果时续聊并要求在前台运行。命令：for i in {1..12}; …」；events.jsonl 工具帧 RUNNING → FAILED，输出「已转入后台，本轮结束时仍未完成，随会话关闭中止」，状态行 `state: uncertain` 同文说明
  - 主 Agent 读到说明后自行续聊：run `9ddc48d3` 又把同一 60 秒命令转后台，结果同上（UNCERTAIN、同文说明）；run `f897f525` 主 Agent 要求拆成每条 ≤10 秒的命令，agy 前台逐条执行，SUCCESS，报告 18 行
  - 界面（CU 抄录）：首轮任务卡「结果待核实」及上述说明全文，命令步骤「失败」附说明；卡片、Worker 详情与任务通知均未出现「CLI 工具缺少终态」；三份 raw 与 events.jsonl 中「缺少终态」计数均为 0
  - 退出状态：两次后台轮次的终态保持 UNCERTAIN（未被进程非零退出改判 ERROR）；三轮 raw 各有一次 `stopReason: end_turn`
  - 进程与产物（`process-watch.log` 每 2 秒采样）：run 1 循环进程 87232 在 16:26:30–16:26:44 写入 3 行，结果 16:26:44.5 发出，16:26:46 循环进程与 agy 进程 87066 同时消失；run 2（88120/87954）写入 3 行，结果 16:27:35.9，16:27:36 均消失；`agy-bg-ticks.txt` 共 18 行 = 3 + 3 + 12，与说明「随之中止」和 Worker 报告一致；16:31:39 复查无残留 `agy acp` 与循环进程
  - 证据：`/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-20-agy-background-command/`（events.jsonl 与三份 raw 副本、`agy-bg-ticks.snapshot.txt`、`process-watch.log`、`process-watch-2.log`、`start-time.txt`）；原件在 `~/.dsh/cliworker-now/b8184daa-…` 未改动
  - 未改任何设置；Desktop 保持运行，Worker 详情窗口留在打开状态
- [x] 4.2 Windows Desktop 真实 agy：同样的前台约 60 秒循环，核对转后台时的判定、说明、进程与产物
  - 2026-11-20 用户要求「测 Windows」。Windows DSH Desktop 0.2.2-rc.5，插件为 main `b7703b2` 构建（安装与哈希核对见 `v0.9.2-dsh-rc5-adapt-leeyl` 4.4）。内置浏览器经 SSH 端口转发访问 Windows Host Web UI，在已有工作区 `live-codex`（`C:\Users\admin\cw081f1\live-codex`）新建对话「派 agy 前台循环追加时间」，主模型 DeepSeek-V4.1-Flash High，标准模式；问题卡片沿用 Gemini 3.8 Flash · Low。Worker `e72fe38a-e551-43c4-bdff-7420527f9bfa`（`agy-1`，自动审批档）；agy 报告此主机没有终端沙箱，原生命令逐条经 DSH 审批，均选「允许一次」
  - run `6e10844e`：第一条命令（外层 `powershell -Command` 引号嵌套）0.7 秒结束，未写出文件；第二条 `run_command`（`WaitMsBeforeAsync: 10000`）08:42:49Z 获准，08:43:03.6Z 工具帧 FAILED，输出「已转入后台，本轮结束时仍未完成，随会话关闭中止」；08:43:03.9Z raw 结果 `status: UNCERTAIN`，`error` 与 Mac 同文（含「转入后台／仍未完成／随之中止」及命令）；08:43:04.9Z 状态 `uncertain`；raw 有一次 `stopReason: end_turn`
  - 界面：右侧 Worker 卡片状态为「结果待核实」。主 Agent 读到说明后核实文件只有 3 行，自行续聊 run `7b976b3a` 要求分段补齐；agy 改为每条 1～2 次的短命令前台执行（逐条授权），08:48:33Z SUCCESS，08:48:34Z completed
  - 进程与产物（`process-watch.log`，Windows 侧每约 2 秒采样）：循环进程 powershell 6100 在 16:42:50–16:43:03 存在，写入 3 行；16:43:05 循环进程与 agy 进程 10900 同时消失（结果发出后约 1 秒）；续聊结束后文件共 12 行（3 + 9）；收尾复查 agy 与循环进程数为 0
  - 「缺少终态」在两份 raw 与 events.jsonl 中计数为 0
  - 证据：`/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-20-windows-agy-background/`（events.jsonl、两份 raw、worker.json、`agy-bg-ticks.snapshot.txt`、`process-watch.log`、采样脚本）
  - 附带发现（不属于本变更）：Windows 授权卡片把命令中的 `$…$` 片段按数学公式渲染，部分文字显示为斜体、反斜杠被转义，命令可读性下降，Mac 未核对
  - 未执行：Antigravity stream 后备通路（不在本变更范围）
