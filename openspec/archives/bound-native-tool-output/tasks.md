# Tasks

## 1. 调查

- [x] 1.1 用无模型夹具或已授权的真实运行，记录 Codex app-server 单个 `item/completed` 与 `outputDelta` 的实际最大帧，确定入站单行默认上限。
  - 2026-10-28 本机 codex-cli 0.162.1（standalone 二进制）；只用 `app-server generate-json-schema`/`generate-ts`、`strings` 与无模型 `command/exec`，app-server 在 `sandbox-exec` 禁网、空 `CODEX_HOME` 下运行，未发 `thread/start`/`turn/start`。
  - 结论：协议对 `ItemCompletedNotification` 的 `aggregatedOutput`（`string | null`）与 `CommandExecutionOutputDeltaNotification.delta` 都没有长度上限；二进制中搜不到 `EXEC_OUTPUT_MAX` 等常量；本机没有匹配版本的 codex-rs 源码。**两类目标通知的真实最大帧未核实**（需要真实 turn 或匹配源码）。
  - 旁证（另一条协议路径 `command/exec`）：默认每流保留 1,048,576 字节；流式块最大 65,536 原始字节、整帧 87,550 字节；3 MB U+0001 输出单行 6,291,513 字节（6 倍转义）；`disableOutputCap` 时单行 18,000,057 字节。可见旧的 1 MiB 入站上限对含控制字符的大输出不够。
  - 决定：新增 `maxNativeLineBytes`，默认 32 MiB（33,554,432），属暂定值而非上限证明。完整证据见共享笔记 `bound-native-tool-output-codex-frames.md`。
- [x] 1.2 核对 Client 时间线如何消费 `detail`/`toolCall.output`，列出需改的组件文件，同步 design.md。
  - 聚合在 `src/shared/types.ts` `foldEvents`（Host 视图与 Harness 会话流共用），Client 只有 `src/client/worker-process.tsx`（`Tool`、`Reasoning`）读工具输出与思考正文；`src/host/harness-conversation-stream.ts`、`src/host/harness-observed-tools.ts` 把时间线行转成主 Agent 工具回执。已写入本变更 design.md「Client」一节。
- [x] 1.3 核实用户 `config.toml` 中的 `tool_output_token_limit` 是否作用于插件启动的 app-server 运行（插件未覆盖，需实测确认），结论写入 README 草稿。
  - 源码核对：插件不为 Codex 设私有 `CODEX_HOME`（`src/host` 中只有 `cli-account-binding.ts:198` 读取 `CODEX_HOME || ~/.codex` 做账号绑定）；子进程环境为 `{...process.env, ...config.env, ...options.env}`；`adapters.ts` 只传 `model_reasoning_effort`、`sandbox_mode`、`approval_policy` 三个 `-c`，Harness 工具注入只加 `mcp_servers.*`。
  - 无模型实测：`codex app-server --stdio --strict-config -c tool_output_token_limit=1234` 正常启动（键被识别），`config/read` 返回 1234，配置层为 sessionFlags、user（`<CODEX_HOME>/config.toml`）、system（`/etc/codex/config.toml`）。
  - 结论：插件启动的 app-server 读取 `$CODEX_HOME/config.toml`（未设置时 `~/.codex/config.toml`），因此用户文件中的该项会生效，项目 `.codex/config.toml` 与 `-c` 优先级更高；已写入 README 中英文。
  - 未核实：用户真实 `config.toml` 内容、真实 Host 进程是否带自定义 `CODEX_HOME`、模型侧实际截断效果（需真实模型调用）。

## 2. 实施

- [x] 2.1 `native-transport.mjs`：区分单帧保护、展示预算；展示超限降级为摘要，不抛错。
  - 新增导出 `createEventBudget`（单步预览 `maxToolPreviewBytes`、整轮 `maxRunBytes`，只降级工具与思考事件，整轮超限发一次诊断）、`summarizeNativeRecord`（>64 KiB 字符串只留字节数）、`cutBytes`（按 UTF-8 边界截断）。出站单帧超限先降为摘要再判断；入站累计不再终止；入站单帧改用 `maxNativeLineBytes` 并报告上限。
  - 验证：`tests/native-output-budget.test.ts`、`tests/native-transport.test.ts` 通过（见 3.x）。
- [x] 2.2 Codex runner：增量事件、完成时单份输出、原始帧正文摘要化。
  - `outputDelta` 只发 `delta`，原始帧 `delta` 只记字节数；完成时 `toolCall.output` 一份，`detail` 去掉 `aggregatedOutput`/`result`/`contentItems`/`changes`；思考运行中发 `delta`、完成时一次快照。MCP 进度改为只放 `toolCall.output`。保留 c1e85a3 的 `native-tool-outcomes` 判定与 `notice`。
  - 验证：`tests/native-primary-runners.test.ts`（进度断言改为增量 + 折叠结果）通过。
- [x] 2.3 Claude、ACP 系、ZCode、OpenCode/MiMo、Hermes、agy runner：去除 detail/toolCall.output/原始帧的三重正文；思考改增量。
  - Codex 子 agent（gpt-6-astra high）实施，主会话逐文件复核：Claude 去掉工具重复 `detail`、思考改增量；ACP（含 Kimi/Qoder/Grok 钩子）、ZCode、OpenCode/MiMo、agy 的累计快照以前缀判断发差量，否则替换；原始记录中的工具正文只留字节数；Hermes 思考改增量、工具结果放入 `toolCall.output`；四个 response tracker 完成回执不再重放最后的 `delta`/工具输出（否则时间线会重复追加末段）。
  - 复核修正：子 agent 删掉了 OpenCode/MiMo 公开思考的「快照冲突即报错、取较长快照」规则，已恢复，只改发送形式；对应夹具改为递增快照。
  - 验证：`tests/native-acp.test.ts`、`native-zcode.test.ts`、`native-qoder.test.ts`、`native-http.test.ts`、`native-primary-runners.test.ts`、`native-response.test.ts` 通过（含新增：Claude/ACP 线性传输与折叠、agy/HTTP 快照替换、Hermes 思考增量、四种 tracker 不重复末段）。
  - 未覆盖：各 CLI 真实协议是否为累计快照未实测；Hermes 工具事件的 `arguments`/`output`/`result` 字段按可选处理，未经真实协议确认；OpenCode/MiMo 思考快照冲突分支本次无专门回归测试（沿用原逻辑）。
- [x] 2.4 `pi-omp-bridge.mjs`：读取 Host 预算，去掉写死的 1 MiB/16 MiB。
  - `extended-adapters.ts`/`pi-omp-adapter.ts` 透传四项预算；桥复用 `createEventBudget` 与 `summarizeNativeRecord`；去掉 16 MiB 累计、1 MiB 单行、2 MiB stderr 终止；单帧按 `maxNativeLineBytes`（缺省回退 `maxLineBytes`）停止并报告上限；工具完成去掉重复 `detail`；思考改增量。
  - 复核修正：子 agent 额外新增的 `tool_execution_update` 进度显示（此前不显示、无重复问题、协议未核实）已移除，相应测试一并删除。
  - 验证：`tests/pi-omp-adapter.test.ts` 通过（预算透传、19 MiB 累计入站不终止、单帧超限报错含上限、预览与整轮截断）。
- [x] 2.5 `native-harness-tools.ts`：按字节判断并预留包装余量。
  - `Buffer.byteLength(serialized) <= maximum - 4096`；超限返回 `工具桥响应超过限制；不会自动重试`。
  - 验证：`tests/native-harness-tools.test.ts` 新增 6000/9000 字节中文结果（字符数低于上限、字节数进入包装预留区或超限），Host 与 MCP 层错误一致，工具桥随后仍可调用。
- [x] 2.6 `runtime.ts`、`bridge-protocol.ts`：Host 接收侧与新预算一致；配置 schema（`index.ts`）新增预算项。
  - `runtime.ts` 原生桥输出累计只统计（非原生通路不变）；`bridge-protocol.ts` 透传 `delta`/`truncated`/`outputBytes`；`storage.ts` schema 新增三字段；`process.ts`/`index.ts` 新增 `maxNativeLineBytes`（32 MiB）、`maxToolPreviewBytes`（256 KiB）；`native-worker.ts` 写入请求、`native-bridge.mjs` 校验。另把 `native-http.mjs` 的 `httpLimits` 累计检查改为只统计、SSE 单帧按 `maxNativeLineBytes`（子 agent 交回的遗留项）。
  - 验证：`tests/core.test.ts`、`tests/native-output-budget.test.ts`（含 SSE 两例）、`tests/native-hermes-readiness.test.ts` 通过。
- [x] 2.7 Client：按 step 聚合增量、显示截断标记，旧记录兼容。
  - `foldEvents` 追加 `delta`；`worker-process.tsx` 工具与思考展开区显示截断标记（中英文案）；`harness-conversation-stream.ts`、`harness-observed-tools.ts` 给主 Agent 的工具回执附截断说明。
  - 验证：`tests/conversation-timeline.test.tsx`（截断标记与旧完整记录）、`tests/harness-conversation-stream.test.ts`（回执附说明）、`tests/native-output-budget.test.ts`（旧累计记录折叠、增量折叠）通过。未在 DSH Desktop 中目视检查。

## 3. 自动检查

- [x] 3.1 复现夹具：400KB 单命令、50×64KB、思考长流、>1 MiB 中文工具桥结果；修复前失败、修复后运行继续且传输量线性。
  - `tests/native-output-budget.test.ts`（模拟 Codex app-server，无账号/模型）。修复前（0e46cbd）5/5 失败：400KB 单命令在传输 16,750,283 字节后 ERROR `Native bridge output exceeds run limit`；50×64KB 在 16,685,198 字节后同样终止；思考长流与整轮降级用例 ERROR；超大入站帧报错未说明入站上限。
  - 修复后全部通过：400KB 单命令传输 < 4×输出量，800KB/400KB 传输比 < 2.5（线性，超过预览后不再增长）；50×64KB 全部完成且每步输出完整；2000×1KB 思考按增量传输并在 256 KiB 处截断标注。
  - 中文工具桥：按 2.5 的 6000/9000 字节用例（等比缩小的上限 8192）验证两层判定一致；未用真实 1 MiB 上限跑一遍。
- [x] 3.2 入站超大单帧仍停止并报告具体原因；展示超限不改变终态。
  - Codex stdio、Pi/OMP、HTTP/SSE 三条入站路径各有超帧用例，错误为「原生 CLI 单个入站协议帧超过上限（N 字节），已停止运行」；`maxRunBytes`=1 MiB 下 50×64KB 仍 SUCCESS、50 个工具全部 COMPLETED、出现整轮上限诊断。
- [x] 3.3 旧时间线记录渲染回归；`pnpm typecheck`、关联测试、`pnpm build:preview`。
  - 旧记录：见 2.7 两项回归。
  - `corepack pnpm typecheck`：通过（Host/Client，DSH 0.2.1-rc.3）。注：本 worktree 原无构建产物，Client 检查依赖 `build:preview` 生成并复制到被忽略目录 `lib/` 的 `typert.remote-client.d.ts`。
  - `corepack pnpm build:preview`：exit 0，隔离包 `.cache/preview-package`；未运行 `pnpm build`、未更新 Desktop 链接。
  - 全量 `corepack pnpm test`（关联测试之外的回归参考）：238 个文件中 234 通过、3 跳过、1 失败；4765 项中 4750 通过、13 跳过、2 失败。失败的 2 项都在 `tests/build-dependencies.test.ts`（`Cannot resolve entry module lib/typert.remote-client.js`），需要正式构建产物；在基线 0e46cbd 的临时 worktree 中同样失败，与本变更无关。

## 4. 真实验收（需已有选型授权）

- [x] 4.1 Codex 读取 1MB 以上文件并连续读取多个文件，检查运行未终止、事件、退出状态与界面截断标记。
  - 2026-10-28 合并后真实验收（macOS，`.test-data/accept-merged.ts` 用隔离预览包快照的 `WorkerRuntime` 跑真实 CLI 与模型；DSH 审批弹窗由脚本按预设决定并记录，CLI 端、进程退出与产物均为真实；证据在 `.test-data/accept-merged/<场景>-<cli>-*/report.json`，不入 Git）。Codex `gpt-6-luna`/low：三个各 1.99 MB 文件以 `cat a.txt && cat b.txt && cat c.txt` 一次读出（约 6 MB），任务完成，回复为 c.txt 末行；工具完成事件标记 `truncated`，单事件约 285 KB，原始记录共约 297 KB。`seq 1 300000`（约 1.9 MB）同样完成并截断展示，回复末行 300000（模型侧拿到完整输出）。
  - 2026-10-28 Desktop 实机补验界面截断标记（DSH Desktop 0.2.1-rc.3，插件链接到本仓库 ac4240b 的构建；内置浏览器直连 Desktop Host 的 Web UI，非 Electron 窗口）。主 Agent 派遣 Codex `gpt-6-luna`/low 执行 `seq 1 300000`：工具完成事件 `truncated: true`、`outputBytes: 1048606`，任务完成，回复 300000。Worker 子会话中该工具步骤的输出共 262185 字符（默认上限 262144 字节加标记），末尾显示「[输出已截断（共 1.0 MB），完整内容见 CLI 原生会话或实际产物]」。
  - 发现（未修）：子会话里该工具块的标题显示为「commandExecution · cliworker:<runId>:exec-…」，看不到命令本身。原因是 Codex 命令条目只带 `command`、不带 `input`，`harness-conversation-stream.ts` 写入的工具参数为空。由 `close-approval-relay-gaps` 处理。
  - 未核实：Codex 入站单帧真实最大值仍未测出上限。
- [x] 4.2 至少一个其他 CLI（Claude 或 ACP 系）同类复验；未验证的 CLI 在本任务下列出。
  - Claude `sonnet`/low 读取同样三个文件：Read 先因 CLI 自身大小限制失败 3 次，随后分段读完，任务完成并附「本轮有 3 个工具步骤失败，CLI 已自行处理」，回复正确。
  - 未验证：Kimi、Qoder/Qoder CN、Grok、ZCode、OpenCode、MiMo、Hermes、Antigravity、Pi、OMP 的大输出真实运行。

## 5. 文档

- [x] 5.1 README（中英）新增「输出预算」：插件传输预算与 CLI 模型可见预算的区别、Codex 原生配置位置、gpt-6.x 原生同样使用代码模式 exec/wait。
  - README.md / README.en.md「常见问题」新增对应条目。gpt-6.x 使用代码模式的依据为提案中对本机 Codex 0.162.1 模型目录的核对，本次未重新核实。
- [x] 5.2 `doc/design.md` 同步事件形状；验证记录写在本文件对应任务下。
  - `doc/design.md` 新增「2026-10-28 原生工具输出预算（未发布）」；本变更 design.md 已按实施决定更新（不另设 `maxDisplayBytes`、不保留 sha256、截断字段放事件顶层、未实现调试原文日志）。
