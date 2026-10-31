# Tasks

## 1. 证据与方案

- [x] 1.1 阅读规范、现有实现及旧诊断，完成 proposal/specs/design；以原文件和 help 回执核对。
  - `git status --short`：初始 10 个已跟踪改动及 relay change/模块/测试未跟踪；均属指定迁移范围。
  - `nmem --json t search 'Antigravity ACP' --limit 5`：0 条，不据记忆猜实现。
  - `agy help acp`：退出 0，列 --stdio、--agent、--sandbox、skip，无 --mode。
  - 零模型 initialize/new/set_model/load/set_config_option/list：完成，promptsSent=0；结果 `.test-data/agy-acp-migration/zero-model.json`。set_model 后 load 确认 gemini-3.8-flash-low，thought_level=low；无 modes/promptCapabilities/mcpCapabilities/沙箱状态。
  - list 与既有 stream Mac A3 ID 精确匹配；未实测该旧 ID load。探针结束检测 stderr 权限拒绝，停止进一步真实 agy 探测，不绕过 sandbox；权限拒绝具体来源未保留，不能断言是日志写入。
  - 所有 pnpm 命令均先 export 用户指定 scratchpad/bin PATH。已运行 spec list --json、list --specs、new change 和 proposal/specs/design/tasks instructions，均退出 0。

## 2. 实施及关联回归

- [x] 2.1 实现能力探测、ACP 选型回读与同 ID 恢复后备；模拟测试覆盖成功、拒绝、身份及选型失败。
  - 新增 `src/host/native-agy-acp.mjs`；bridge 路由选择 auto runner，持久化 transport 保持兼容。最终 `native-agy-acp.test.ts` 31 项通过，含探测取消、旧版、规划、模型/强度回读失败、旧 ID 恢复与加载拒绝后备。
- [x] 2.2 迁移 MCP 注入、权限和取消；模拟测试核对 cwd、argv、mcpServers、审批停止/超时及进程退出。
  - Host 不再预建 agy-tools；通用 ACP 可插入选型/恢复校验，识别 CommandLine 并防止迟到允许。模拟 ACP 启动真实 stdio MCP 载体，调用确实到达模拟 Host，载体 PID 退出；这不是实际 agy MCP 验收。
- [x] 2.3 删除命令 relay、专属测试与旧 change，保留 stream 结果修复；关联模拟回归通过。
  - 删除 native-agy-command-relay、专属测试、打包项及旧 change；移除遗留 decisions 关联和仅供 Hook 的测试，agy-run-outcome 原有 37 项保留并通过。stream 的 denied_actions、finished_reason 和无沙箱提示回归保留；旧诊断依据已写入 design。
- [x] 2.4 实现 ACP usage 映射并同步双语 README/design；遥测测试核对本轮字段。
  - cliworker.agy_prompt_usage 投影 input/output/total/cache/thought 到本轮字段，不推算缺失指标；README 双语与 doc/design 已同步 ACP、权限、规划及旧会话后备和未验证边界。
- [x] 2.5 提供权限 0700/0600 的单轮真实验证脚本，node --check 通过，说明分次运行和不重试。
  - `.test-data/agy-acp-migration/validate.mjs`：生产 ACP runner/IO/MCP carrier，模拟 DSH 固定只读工具和精确 pwd -P 单次允许。supervisor 独占进程组，确认范围退出后才输出最终 JSON；每次一个 prompt、无重试、新建空项目，resume 按指定 ID 在本次新项目恢复，结束删除临时目录且不跟随链接。
  - `node --check .test-data/agy-acp-migration/validate.mjs` 和无参数帮助均退出 0，不调用模型。`stat -f '%Lp %N'` 核对目录 700、脚本 600；证据目录文件统一 600。
  - **模拟自检**：`AGY_VALIDATION_BIN="$PWD/.test-data/agy-acp-migration/simulated-agy.mjs" node .test-data/agy-acp-migration/validate.mjs --run new`、`--run resume simulated-validation-session`、`--run stop` 均退出 0，passed=true；每次仅一个模拟 prompt，真实模型次数 0。载体 tools/call=1、进程组退出、目录删除均确认，resume sameSession=true，stop 结果 ERROR。记录 `script-simulated-{new,resume,stop}.json`。模拟可执行夹具运行时 700，结束恢复 600。
  - 真实主控运行：`node .test-data/agy-acp-migration/validate.mjs --run new`；随后另行执行 `--run resume <sessionId>`；停止独立执行 `--run stop`。本次没有执行这三种真实请求。

- [x] 2.6 主控审查修复：Mac 自动审批与 stream 等价（2026-10-31）。
  - 问题：初版自动档在 Mac 只加 `--sandbox`、不跳过确认。主控用 Mac 真实一轮（`real-mac-new.json`）确认：ACP 只加 `--sandbox` 时，`pwd -P` 仍发 `session/request_permission`。也就是说，原先 Mac 上在沙箱内自动执行的命令会改成逐条问用户，比原 stream 自动审批更严。
  - 零模型探测（`sandbox-probe.mjs`，只发 `initialize` 与 `session/new`，promptsSent=0）：Mac 与 Windows 1.4.11 在三种参数组合下 stderr 都没有沙箱提示，`_meta` 只有账号档位，ACP 不报告沙箱状态。附带发现：Windows 上经 SSH 会话启动时 `session/new` 返回 `Authentication required`，交互式桌面会话里正常，与 Desktop 运行环境一致。
  - 修复：`native-agy.mjs` 新增 `probeAgyHostSandbox`：以 stream 入口 `--mode auto --sandbox` 零输入启动一次，去掉 `--conversation`，不写输入；读取输入前的 stderr 警告或 `init`，确认进程退出后才启动 ACP。判定依据与 stream 降级共用同一正则。`agyAcpArgv` 按结果选择参数：
    - `available`：`--sandbox --dangerously-skip-permissions`；
    - `unavailable`：不加 `--sandbox`、不跳过确认；
    - 无报告：不跳过确认（非 Windows 仅 `--sandbox`）。
    时间线分别说明依据；完全权限不探测。规格增量、design、README 双语与 doc/design 已同步。
  - 模拟回归：新增 5 项，覆盖账号警告、无警告 `init`、主机无沙箱、无报告超时、完全权限不探测。核对探测进程不收输入、不带 `--conversation`、已退出，ACP 参数与时间线说明对应。撤掉 `available` 分支后其中 2 项失败，还原后 36/36 通过。
- [x] 2.7 探测 stderr 不再进 Worker 诊断（2026-10-31，用户要求修掉 Windows 界面复测中看到的问题）。
  - 问题：`native-transport.mjs` 把同一 run 所有子进程的 stderr 都交给 `onNativeStderr`。沙箱探测读到的 `--mode auto is not available …` 因此记进 run 的 stderr，结束时成了时间线最后一条「CLI 诊断」，看起来像 ACP 本轮报的。
  - 修复：`spawn`/`openStdio` 新增选项 `reportStderr: false`。设了它的子进程，stderr 仍交给自己的 `onStderr` 和本地尾部，不转给 run。只有 `probeAgyHostSandbox` 使用它；stream 正式运行（含降级重启）照旧上报。
  - 模拟回归：沙箱报告用例核对 run 的 stderr 不含探测警告；撤掉修复时 `account-auto` 与 `host-sandboxless` 两项失败，还原后通过。stream 降级用例新增断言：本轮自己的账号警告仍进 run 的 stderr。
  - 关联测试：agy、ACP、审批转交、输出预算、主路 runner、Hermes 停止共 10 个文件 400 项通过；native-http、native-transport、qoder、zcode 共 258 项通过；`pnpm typecheck` 通过。没有构建预览包，也没有装到 Windows。

## 3. 集成检查

- [x] 3.1 串行关联 Vitest 全部通过并记录数量。
  - 首次新增 ACP 测试：20/26 通过、6 失败（夹具缺审批 nonce、连接 url/token 形状、错会话未真的错 ID）；修正夹具后关联 11 文件 420/420 通过，`tests.log`。
  - 补充 7 文件：205/206 通过，失败是模拟 Host 回执缺 isError=false 导致按 JSON 包装；补齐规范回执。单文件复验 31/31 通过，`acp-final.log`。
  - 删除失效 Hook 专属结果测试后最终完整命令：`pnpm exec vitest run tests/native-agy-acp.test.ts tests/native-agy-account-permissions.test.ts tests/native-agy-harness.test.ts tests/native-agy-permission-levels.test.ts tests/native-acp.test.ts tests/native-approval-relay.test.ts tests/native-primary-runners.test.ts tests/agy-run-outcome.test.ts tests/native-bridge-time-limit.test.ts tests/native-worker-windows-env.test.ts tests/telemetry.test.ts tests/native-harness-tools.test.ts tests/native-runtime.test.ts tests/native-guidance.test.ts --fileParallelism=false --reporter=json --outputFile=.test-data/agy-acp-migration/final-suite.json`：退出 0，14 文件 **465/465 通过**、0 跳过/失败。
  - 各文件数量：agy-run-outcome 37、native-acp 50、agy-account-permissions 16、agy-acp 31、agy-harness 8、agy-permission-levels 9、approval-relay 72、bridge-time-limit 4、guidance 8、harness-tools 32、primary-runners 156、native-runtime 14、worker-windows-env 1、telemetry 27。全部夹具为模拟，不操作 Windows。
  - 2.6 修复后同一命令（不写 JSON 报告）：退出 0，14 文件 **470/470 通过**。
- [x] 3.2 pnpm typecheck 通过。
  - 实施后与最终源码均执行，退出 0；Host/Client against DSH 0.2.1-rc.5 通过。
- [x] 3.3 pnpm spec validate migrate-agy-acp --strict 通过。
  - 实施后严格验证退出 0，Change is valid；最终记录更新后再次核对。不归档未完成验收。
- [x] 3.4 指定 Git diff --check 通过。
  - 首次发现 native-agy-harness.test.ts 尾部空行，移除后 `/Library/Developer/CommandLineTools/usr/bin/git diff --check` 退出 0。只检查/修改本任务文件，未 commit/stash/reset/切分支。
- [x] 3.5 pnpm build:preview 通过；不正式 build。
  - 2.6 修复后重新构建，退出 0；打包为 `preview-20261031-020458`（基于 `ef090e1` 加本 change 未提交改动，lib 726 个文件，sha256 `d2f73d76c5007f346a69398b2039fb185e7dc733531c0431d0d9eec1ae9541c8`），用于 Windows 复测。未执行 `pnpm build`，Mac Desktop 链接未更新。
  - 实施后及移除失效 relay 结果关联后的最终源码各构建一次，均退出 0；隔离产物 `.cache/preview-package`，Host/Client 成功。构建仅有既有 CommonJS/依赖打包建议，无错误；未执行 pnpm build，未操作 Desktop。

  - 隔离包读回：`lib/native-agy-acp.mjs` 存在且 `runNativeAgyAuto` / `runNativeAgyAcp` 可动态导入，旧 relay 文件不存在；package.json 仍为 0.8.4。最终 apply instructions 显示 11/15 完成，4 项真实验收保留未勾选。

## 4. 主控真实验收与未验证边界

- [x] 4.1 主控在沙箱外验证真实 MCP 启动、tools/call 到达、命令实际 cwd、同会话续聊和停止清理（Mac，agy 1.4.11，Gemini 3.8 Flash Low，每次一轮，无重试；证据 `.test-data/agy-acp-migration/real-mac-*.json`）。
  - `real-mac-new.json`（2.6 修复前，逐条审批）：DSH 收到一条 `command` 审批，`detail` 正是 `pwd -P`，选允许一次；输出为本次项目目录；MCP 载体启动，`tools/list` 与 `tools/call` 均到达模拟 Host；结果 SUCCESS。runner 返回瞬间仍有一个 PID 存活，验证脚本补发 SIGTERM 后退出，整个进程组已退出；当时未记录是哪个 PID。
  - `real-mac-new-skip.json`（修复后）：沙箱探测为 `available`，没有审批请求，`pwd -P` 实际执行，本轮输出为项目目录；MCP 加载并调用；结果 SUCCESS。runner 返回时仍存活的是 MCP 载体，3 秒内自行退出，未强制清理。
  - `real-mac-resume-same.json`：同一项目续聊会话 `4ee0675e…`，加载后 ID 一致，沙箱探测为 `available`、无审批，`pwd -P` 仍为同一项目目录，MCP 再次加载并调用，结果 SUCCESS；临时目录已删除。
  - `real-mac-stop.json`：发出 prompt 3 秒后停止，结果 ERROR，进程范围退出，没有强制清理，临时目录已删除。
  - 额外观察 `real-mac-resume.json`：续聊会话 `99a5c4ab…` 改用另一个新建的临时项目（原项目已删除），会话 ID 一致、命令执行、MCP 正常，但本轮输出不等于新项目。当时没有记录输出，无法判断命令实际在哪个目录执行。生产中续聊总在同一项目，此情形不影响结论，记录备查。
- [x] 4.2 核实 ACP 工作区编辑是否请求权限、Mac 自动审批等价行为、无沙箱与账号不支持时的原生报告；零模型不足以证明。
  - Mac 自动审批等价：已由 2.6 与 4.1 实测确认（探测为 `available` → 跳过确认，命令在沙箱内执行，无审批）。Mac 的探测依据是账号不支持 `auto` 的那句警告，这也是账号不支持时的原生报告。
  - 无沙箱时 ACP 的原生报告：零模型探测显示 ACP 自身不报告；Windows 实际依据为 stream 零输入探测读到的主机警告，runner 与界面两轮都判定 `unavailable`，见 4.3。
  - 工作区编辑是否请求权限：Mac 跳过确认时无从观察。Windows 两轮真实结果不同：runner 一轮中项目内 `write_file` 没有发 `request_permission`，由 agy 自行放行；界面一轮中同样是项目内 `write_file`，却发了 `kind: edit` 的 `request_permission`（选项只有 allow_once/reject_once），经 DSH 卡片允许一次后写出。所以是否询问由 agy 决定，时间线「由原生请求决定」的说法成立，插件两种情况都能处理。
- [x] 4.3 Windows 升级获准后补验。
  - 2026-10-31 用户批准升级并复测。Windows 自带 `agy update` 下载超时失败（`Download interrupted: context deadline exceeded`），版本仍为 1.4.7。改为按官方 install.ps1 的方式手动替换：在 Mac 下载官方 manifest 指向的 1.4.11 Windows 版并校验 SHA512，传到 Windows 后再次校验；确认无 agy 进程，备份 1.4.7，用 `Copy-Item` 覆盖 `%LOCALAPPDATA%\agy\bin\agy.EXE`。`agy --version` 为 1.4.11，`acp --help` 列出 `--stdio`。
  - 预览包 `preview-20261031-020458` 已装入 Windows Desktop：确认 Harness 下没有 CLI 子进程后从应用菜单退出；installerExit 0，lib 726/726 一致，runtime 0.2.1-rc.5；以 `--force-renderer-accessibility` 重启。
  - 零模型 ACP 探测（`sandbox-probe-win*.json`）：Windows 1.4.11 只发 `initialize`/`session/new`，三种参数下都没有沙箱提示。经 SSH 启动时 `session/new` 返回 `Authentication required`；在交互式桌面会话中正常（账号档位 Google AI Pro）。
  - Desktop 界面复测未完成：Codex Computer Use 02:09 尝试时 Windows 处于锁屏（`LogonUI` 在运行），点击与置前均返回 `GetCursorPos failed: 拒绝访问 (0x80070005)`，截图为黑屏，未派遣、未见审批卡片（`.test-data/windows-desktop-20261031/cu-run-agy-acp.json`）。未尝试解锁，待用户解锁后重测 DSH 审批卡片。
  - 生产 runner 实测（02:13，交互式桌面会话，直接调用安装包内的 `runNativeAgyAuto`，模拟 DSH 审批与一个只读 MCP 工具；Gemini 3.8 Flash Low，一轮，空临时项目；证据 `.test-data/windows-desktop-20261031/runner-agy-acp.json`）：
    - 沙箱探测以 stream 入口零输入启动（不带 `--conversation`），判定 `unavailable`；时间线为「agy 报告此主机没有终端沙箱，原生请求逐条经 DSH 审批…」。随后 ACP 以 `acp --stdio` 启动，不加 `--sandbox`、不跳过确认。
    - MCP 载体启动，`tools/list` 与 `tools/call` 到达模拟 Host。
    - `write_file` 没有请求审批，状态 COMPLETED，文件 17 字节，内容为 `WIN-ACP-RUNNER-OK`。
    - `run_command` 只来了一条 `command` 审批，`detail` 正是该命令，`allowSession` 为 false，选允许一次。命令 COMPLETED，exit_code 0，输出 `PWD=C:\Users\admin\AppData\Local\Temp\agy-acp-win-D2CuAR\project`，即项目目录。脚本的 `cwdVerified` 为 false，是比对 bug：输出被 JSON 转义，反斜杠成双，没有匹配上；原始输出与项目路径一致。
    - 结果 SUCCESS，回复包含三步输出；进程在 `io.close` 时已全部退出（`aliveAfterClose` 为空）；临时目录已删除。
    - 结论：Windows 自动审批档的命令经审批后在项目目录实际执行，修复了 4.5（`fix-runtime-permission-fallback`）记录的「命令被拒、无最终回复」。DSH 界面上的审批卡片仍待解锁后验证。
  - Desktop 界面复测（08:22–08:25，用户解锁后；预览包同上，主模型 GLM-5.3-Flash Low、访问模式工作区内修改，均未改动；证据 `.test-data/windows-desktop-20261031/ui-agy-acp.{events,raw}.jsonl`、`ui-agy-acp.worker.json`、`ui-agy-acp.raw.stderr`）：
    - 解锁后 Computer Use 两次截到 DSH 窗口全黑（`cu-run-agy-acp-retest{,2}.json`，均未发送消息）；同时在交互桌面用 GDI 截屏有画面。中继是 02:08 锁屏期间启动的，停止并重启后截图正常。之后由主控直接驱动 Computer Use，不经模型。
    - 在 live-codex 的空新会话发送派遣请求；问题卡片「是否沿用 Gemini 3.8 Flash · Low · 不使用角色预设？」选沿用。Worker 档位为默认的「自动审批」，未改动。
    - 时间线第 5 条诊断为「Antigravity ACP 自动审批：agy 报告此主机没有终端沙箱，原生请求逐条经 DSH 审批，仅允许一次；工作区编辑是否询问由原生请求决定」，Worker 记录 `mode: accept-edits`。
    - 主对话页先后出现两张「agy-1（Antigravity）请求授权」卡片，都带工作目录 `C:\Users\admin\cw081f1\live-codex`，选项只有「允许一次」「拒绝」：
      - 第一张是 `File cwn-win-20261031-agy.txt`，路径在 live-codex 内，原生帧为 `write_file` 的 `kind: edit`；
      - 第二张是命令 `Get-ChildItem`，原生帧为 `run_command` 的 `kind: execute`。
      - 两张都选允许一次。事件记为「授权决定：允许一次（DSH 用户）」，随后是「CLI 额外权限请求已批准」。
    - 三步工具全部 COMPLETED：`write_file`、`read_file`、`run_command`。命令退出码 0，输出标题为 `C:\Users\admin\cw081f1\live-codex`。
    - 结果 SUCCESS，Worker 已完成（1 分 11 秒），回复含三步结果；主 Agent 回复一致。主 Agent 自己调 pwsh 复核时仍报 0xC0000142，改用文件工具，这是 Harness 核心的已知问题。
    - SSH 回读：文件 15 字节 `WIN-ACP-agy-OK\n`，用户目录下只有这一份；结束后 Windows 没有 agy 进程残留。
    - 结论：Windows 上命令与需确认的编辑都以 DSH 审批卡片到达主对话页，允许一次后在项目目录实际执行。
- [ ] 4.4 真实旧 stream ID load/续聊与换号恢复，附件及实际模型执行待验收。

## Workflow follow-up

- 未完成真实验收保留本 change，不以严格格式校验替代业务验证，不归档隐藏缺口。

## 5. 其他观察

- 本次 `ps -o pid,ppid,etime,command -p 42276,42388` 被 sandbox 拒绝，未提权；没有用全机进程列表作为清理证据。模拟验证使用自身 PID/进程组的退出读回。
- 真实 ACP sandbox/auto 报告仍未知，当前保守逐条确认可能比旧 Mac auto 更严格；不能宣称原生等价已验收。旧 stream 工具桥仍有默认目录排序风险，时间线已提示。（2026-10-31 已由 2.6 修复，Mac 等价见 4.1。）
- 真实模型调用：Windows runner 1 轮（Write-Output 当前目录、写测试文件）。主控 Mac 共 5 轮（new、resume 换项目、new --keep、resume 同项目、stop），均为 Gemini 3.8 Flash Low、空临时目录、命令仅 `pwd -P`，无重试。Windows 界面复测 1 次派遣：Worker 为 Gemini 3.8 Flash Low 1 轮，主 Agent 为用户原有的 GLM-5.3-Flash Low 2 轮，无重试。
- Windows 界面复测中 agy 原生 `run_command` 输出把中文控制台的 GBK 字节按 UTF-8 解码，「目录」显示为 `Ŀ¼`。原生帧里已经是这样，插件只是原样转交；属于上游 agy，未处理。
- 同一轮结束时，时间线最后有一条「CLI 诊断」，内容是 `--mode auto is not available …` 的主机警告。ACP 启动参数里没有 `--mode`，这条来自同一 run 的 stream 零输入探测：`native-transport.mjs` 把本 run 所有子进程的 stderr 都经 `onNativeStderr` 记入 run 的 stderr，结束时由 `runtime.ts` 汇总成「CLI 诊断」。内容属实但出现位置容易误解，已由 2.7 修复。
