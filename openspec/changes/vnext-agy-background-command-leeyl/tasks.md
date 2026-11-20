# Tasks

## 1. 定位根因 〔后端｜1h〕

- [x] 1.1 读 2026-11-20 实机 raw 记录，确认 agy 转后台的信号与命令去向
  - Worker `b665400a` run `5d6e130e`（`~/.dsh/cliworker-now/…5d6e130e-….raw.jsonl`，只读，未改动）：`run_command`（`WaitMsBeforeAsync: 10000`）只有一条 `tool_call` `in_progress`，之后只有正文「已启动后台计时循环任务……请稍候」与 `stopReason: end_turn`，没有 `tool_call_update`、状态值或输出文本表示转后台
  - 下一轮 run `a109087d` 的 `session/load` 回放：同一 `toolCallId` 为 `status: failed`、`rawOutput.output: ""`；`agy-ticks.txt` 只有 14:38:23、14:38:28 两行（转后台前 10 秒），即命令随插件关闭 agy 进程而中止
  - 同类旧例：Worker `e15ebd2f` run `56a468f1`（`sleep 120`，`WaitMsBeforeAsync: 500`）同样判「CLI 工具缺少终态」；本机其余含该参数的 raw 记录中，该命令都已有终态（本轮内 `completed`，或下一轮回放中的 `failed`）
  - `strings ~/.local/bin/agy`：`WaitMsBeforeAsync` 为 `run_command` 必填参数，说明「Milliseconds to wait for the command to finish before backgrounding it (500 to 10000)」
- [x] 1.2 定位判定：`src/host/native-acp.mjs` 原第 504 行对任何未终态工具判「CLI 工具缺少终态」（v0.8.1 起），不区分 CLI 主动转后台与协议丢失终态

## 2. 实现 〔后端｜1.5h｜前置 1〕

- [x] 2.1 `native-acp.mjs`：新增默认关闭的 `settings.backgroundCommand(update)`；工具首次识别后在状态中保留命令文本。本轮 `end_turn`、无其他失败且未停止时，未终态工具全部可转后台 → UNCERTAIN，说明「转入后台、本轮结束时仍未完成、随会话中止、没有结果、请核查产物或续聊要求前台运行」并列出命令（单条截断 200 字符，最多 3 条）；工具行补发 FAILED，输出 `BACKGROUND_COMMAND_TOOL_NOTE`；与后台子 Agent 待核实说明合并
  - 其他未终态工具仍判「CLI 工具缺少终态」；非 `end_turn` 与停止不进入该分支
- [x] 2.2 `native-agy-acp.mjs`：`agyBackgroundCommand` 只认 `name === 'run_command'` 且 `rawInput`/`args` 带数值 `WaitMsBeforeAsync`，返回 `CommandLine`；Antigravity ACP 启用该钩子
- [x] 2.3 文档：`doc/design.md` 追加 2026-11-20 一节；README 与用户文档未提及该错误文本，无需改

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
  - 未新建仓库外测试或备份目录；临时文件只在会话 scratchpad

## 4. 真实验收 〔测试｜0.5h｜前置 3〕

- [ ] 4.1 Mac Desktop 真实 agy：让 Antigravity Worker 前台跑约 60 秒循环，核对 agy 转后台时任务卡为「结果待核实」、说明与命令行一致、工具行为失败附说明，事件与 raw 记录相符
  - 未执行：需要用户授权真实模型调用；隔离构建（`pnpm build:preview`）与 Desktop 链接更新也未做
- [ ] 4.2 Windows 与 Antigravity stream 后备：未执行，stream 后备不在本变更范围
