# Tasks

## 1. 规划一致性

- [x] 1.1 用 openspec-update-change 修订 `report-denied-permission-as-unverified` 增量中「其他工具失败 MUST 仍为失败」，与本变更一致，并重跑两份 change 的严格校验。
  - 2026-10-28：`report-denied-permission-as-unverified` 的 worker-run-outcomes 与 qoder-cli 增量、proposal、design 已改；新增场景「拒绝后另一个工具失败但本轮正常结束→结果待核实」。两份 change `pnpm spec validate --strict` 均通过。
- [x] 1.2 核对 `native-transport.mjs` result 结构与 `runtime.ts` 展示：确认 SUCCESS 能否携带说明，不能则设计可选 `notice` 字段并同步 design.md。
  - 2026-10-28：原 SUCCESS 帧无法携带说明（runtime 对 completed 不读 error，界面把 error 显示为红色错误）。新增可选 `notice`：`native-transport.mjs` result 第 5 参数（仅 SUCCESS）→ `bridge-protocol.ts` → `ProtocolResult.notice` → `Worker.resultNotice`（storage 可选字段，每轮重置）→ 时间线诊断「本轮结果说明」与主 Agent 结果的 `notice`/`guidance`。runtime 待核实与说明分支改为按 `BridgeProtocol` 判断，使 Pi/OMP 也生效。design.md 已于 5.1 同步。

## 2. 实施

- [x] 2.1 Codex（`native-codex.mjs`）：工具失败改记 `toolFailures`/`lastToolOutcome`，保留被拒条目豁免与 steer 判定；终态按 design 顺序。
  - 2026-10-28 已实施（共用 `src/host/native-tool-outcomes.mjs`，已加入 `scripts/build.mjs` 清单）。
- [x] 2.2 Claude Code（`native-claude.mjs`）：`is_error` 不再写入 `failure`；`permission_denials` 与反向审批中断保持失败。
  - 2026-10-28 已实施。
- [x] 2.3 ACP 系（`native-acp.mjs`，覆盖 Kimi/Grok/Qoder/Qoder CN）：`status==='failed'` 改记工具失败，保留 `deniedTools`。
  - 2026-10-28 已实施。
- [x] 2.4 ZCode（`native-zcode.mjs`）：工具 error/`success!==true` 与批次 `errorCount` 按工具身份去重计数；`turn.failed` 仍失败。
  - 2026-10-28 已实施。
- [x] 2.5 OpenCode/MiMo（`native-session-http.mjs`）、Hermes（`native-hermes.mjs`）：`toolFailed` 改为计数；收尾的「全部工具 completed」检查只针对未完成工具。
  - 2026-10-28 已实施。
- [x] 2.6 Antigravity（`native-agy.mjs`）：拆开 `failedStep` 的工具错误分支，保持 AGY 续聊冲突规则。
  - 2026-10-28 已实施。
- [x] 2.7 Pi/OMP（`pi-omp-bridge.mjs`）：`tool_execution_end.isError` 改为计数，退出码随终态。
  - 2026-10-28 已实施。
- [x] 2.8 SUCCESS 结果说明追加「本轮有 N 个工具步骤失败，CLI 已自行处理」，最后一步失败的 UNCERTAIN 说明与既有「结果待核实」措辞一致。
  - 2026-10-28 已实施。

## 3. 自动检查

- [x] 3.1 各 runner 夹具：工具失败→恢复→completed 为 SUCCESS 且带失败数；最后一步失败直接结束为 UNCERTAIN；工具失败+轮次失败/中断/非零退出/缺终态为 ERROR；工具失败+取消/超时保持中断。
  - 2026-10-28：恢复（`tool-recovered`）与最后一步失败（`tool-failure`）覆盖 Codex、Claude、Antigravity、Kimi（ACP）、Qoder、ZCode（含批次重复上报去重）、OpenCode、MiMo、Hermes、Pi、OMP。工具失败叠加轮次失败、非零退出为 ERROR：Codex/Claude/Antigravity（`tool-failure-turn-failed`、`tool-failure-nonzero-exit`）；Qoder 未完成工具（`tool-pending`）、Codex `inProgress` 收尾为 ERROR。工具失败后取消为 ERROR 且无 `notice`：新增 `tool-failure-cancel`，覆盖 Codex/Claude/Antigravity。
  - 未覆盖：工具失败叠加超时只有通用超时路径的既有测试，没有专门夹具；ACP/HTTP/ZCode/Pi 的工具失败叠加取消未单独构造（它们的取消路径不经过 `settle`）。
- [x] 3.2 改写既有「工具失败即整轮失败」断言（含 `tests/native-http.test.ts:388,515`、`tests/pi-omp-adapter.test.ts:777-778`），确认撤掉实现时新断言失败。
  - 2026-10-28：把 `native-tool-outcomes.mjs` 的 `settle` 临时改回「有失败即 ERROR」，6 个关联测试文件中 23 个用例失败（`Tests 23 failed | 314 passed`），涵盖 Codex、Claude、Antigravity、ACP、Qoder、ZCode、OpenCode、MiMo、Hermes。Pi/OMP 不经 `settle`，单独把 `pi-omp-bridge.mjs` 终态改回后 4 个用例失败（`4 failed | 71 passed`）。两处均已用备份还原并 `cmp` 核对一致，还原后 75/75 通过。
- [x] 3.3 `pnpm typecheck`、关联测试文件、`pnpm build:preview`。
  - 2026-10-28：`pnpm typecheck` 通过；`tests/native-primary-runners.test.ts`（81）、`native-acp`、`native-qoder`、`native-zcode`、`native-http`、`pi-omp-adapter`（75）、`codex-models`（12）均通过。`pnpm build:preview` 成功，产物在 `.cache/preview-package`；`lib/native-tool-outcomes.mjs` 已打包，8 个 runner 均从预览包内正常加载该模块。未执行全量 `pnpm test`（按日常最小验收）。

## 4. 真实验收（需已有选型授权）

- [x] 4.1 Codex：构造先失败后成功的写文件任务，检查事件、退出状态、产物与 Worker 状态。
  - 2026-10-28（用户授权真实验收）：一次性脚本 `.test-data/outcome-smoke.ts`（不入 Git）加载 `.cache/preview-package` 的真实 WorkerRuntime，任务为「读取不存在的文件（预期失败）→ 写 recovered.txt 为随机标记 → 回复标记」。Codex `gpt-6-luna` low：Worker `completed`，`resultNotice` 与结果帧 `notice` 均为「本轮有 1 个工具步骤失败，CLI 已自行处理」，时间线 commandExecution 一次 FAILED、一次 COMPLETED，产物内容与标记一致，未创建缺失文件。证据：`.test-data/outcome-smoke/codex-SJMKOu/report.json` 及其 worker-state。另有一条与本变更无关的 CLI 诊断：用户 Codex 配置里的某个 MCP 服务需要登录（rmcp AuthRequired）。
- [x] 4.2 至少一个 ACP 系 CLI 与 Claude Code 同类复验；其他 CLI 的未验证项在本任务下明确列出。
  - 2026-10-28 同一脚本：Claude Code `sonnet` low（`claude-XN9kh7`）、Qoder `qfmodel` low（ACP 系，`qoder-5sqNYj`）、ZCode GLM-5.3-Flash low（`zcode-oxNB2n`）、OpenCode GLM-5.3-Flash low（`opencode-5isBNt`）均为完成并附「本轮有 1 个工具步骤失败」，读取 FAILED 后写入 COMPLETED，产物一致。
  - Antigravity `gemini-3.8-flash-low` 首次实测失败（`antigravity-RQZtLI`）：真实 agy 的失败工具步骤为 `state: ERROR` 加 `tool_info.error`（`TOOL_ERROR`），而 2.6 只认 DONE 加 `tool_info.error`，`ERROR` 状态被当成非法步骤，整轮判失败。已修正 `native-agy.mjs`：`ERROR` 加 `tool_info.error` 计为工具失败、不算未完成工具；没有 `tool_info.error` 的 `ERROR` 仍失败。夹具改为实测形状，撤回修正时 2 个 Antigravity 用例失败，修正后 81/81 通过；重建预览包后复验通过（`antigravity-QWmFGh`）。
  - 未做真实验证：Kimi、Grok、Qoder CN、MiMo、Hermes、Pi、OMP；「最后一步失败后直接结束→结果待核实」难以用真实模型稳定复现（模型失败后都会继续回复），只有夹具覆盖。

## 5. 文档

- [x] 5.1 README 结果状态说明与 `doc/design.md` 终态判定段同步。
  - 2026-10-28：`README.md`「特点」与 `README.en.md`「Permissions and data」各加一条结果判定说明；`doc/design.md` 新增「2026-10-28 整轮结果按原生终态判定（未发布）」；本 change 的 design.md 补 `notice` 链路、共用模块、AGY `ERROR` 状态与 `tool_info.error` 的区分、未完成工具与 Pi/OMP 边界。
- [x] 5.2 实际验证命令、结果、证据位置与未验证边界记在本文件对应任务下（缩进子项），不写入 `doc/tasks.md`。
  - 2026-10-28：自动检查记录见 3.x，真实验收见 4.x。
