## 1. 实现

- [x] 1.1 `grokAcpArgv` 按任务模式替换 `--permission-mode`（只读 `plan`、可写 `acceptEdits`）。
- [x] 1.2 `runNativeAcp`：`argvModes` 声明的模式在 ACP 完全不列出模式时不要求 ACP 切换；列出模式时照旧确认。

## 2. 自动检查

- [x] 2.1 `tests/native-acp.test.ts`：无模式 ACP 下只读 Grok 以 `--permission-mode plan` 成功且不调用 `session/set_mode`（撤掉修复时失败）；列出模式时仍切换 `plan`；Kimi 无模式仍在提示前失败。
- [x] 2.2 真实只读探针：Grok 1.0.62 以 `--permission-mode plan agent --no-leader stdio` 在临时 GROK_HOME 完成 initialize 与 session/new，不发送提示。
- [x] 2.3 全量 225 文件 4407 通过、13 跳过；`build:preview` 通过；OpenSpec 严格校验通过。

## 3. 真实验收

- [x] 3.1 Desktop 派遣只读 Grok 任务成功；要求其创建文件时不产生文件（需用户授权模型调用）。
  - 2026-10-25 22:52（94bfec4 正式构建，新 Host 17:21），用户授权；Codex gpt-6-astra high 驱动界面，同一请求并行派遣 2 个只读 Grok（grok-4.6·low），同项目 `cliworker-isolation-test`，相隔 0.07 秒创建、22:52:36 同时连接，未出现 `EEXIST` 或 `ACP does not advertise the selected permission mode`，界面访问模式为「规划（只读）」。grok-7 问好：completed，回复「你好。」，无工具调用。grok-8 写文件：Grok 在 plan 模式下仍发起 `session/request_permission`（write，选项 allow-edits-session / allow-once / reject-once），插件记录「CLI 额外权限请求已拒绝」，工具 failed（User rejected the execution for tool `write`），Grok 以 `stopReason: cancelled`（cancellationCategory PermissionRejected）结束本轮，任务 failed「CLI 未成功完成（cancelled）」。项目文件派遣前后 shasum 一致，`grok-readonly-probe.txt` 不存在。
  - 说明：Grok 1.0.62 的 plan 模式不会自行阻止写工具，只读边界由插件拒绝额外权限保证；拒绝后 Grok 取消整轮，因此写入被拒的只读任务显示为失败而非带说明的完成。
  - 后续核实官方文档：`--permission-mode plan` 只是兼容值，不是 Grok 规划模式；`mkdir`/`touch` 在所有模式下免审批，原方案拦不住。用户决定改为 `dontAsk` 加 deny 规则（第 4、5 节）。

## 4. 改为 dontAsk 加 deny 规则

- [x] 4.1 `grokAcpArgv` 只读改为 `--permission-mode dontAsk --deny Bash(mkdir) --deny Bash(touch)`；可写仍为 `acceptEdits`。
- [x] 4.2 只读且 DSH 工具桥就绪、绑定 Grok 时追加 `--allow MCPTool(dsh_worker_tools__*)`；抽出 `nativeHarnessReadyConnection` 与 ACP 审批共用判断。
- [x] 4.3 `tests/native-acp.test.ts`：只读完整 argv、可写不含 deny/allow 且只有一个权限模式、工具桥 allow 仅在就绪且绑定 Grok 的只读运行出现；插件拒绝审批兜底测试保持通过。
- [x] 4.4 真实无提示探针：Grok 1.0.62 以只读参数（含/不含工具桥 allow）及可写参数在临时 GROK_HOME 完成 initialize 与 session/new。
- [x] 4.5 全量两次：4403/4405 通过、13 跳过，分别有 6/4 项失败且每次不同（`native-zcode`、`native-harness-tools` 的子进程用例，机器负载约 22）；两文件单独运行 56/56 通过。类型检查、`build:preview`、OpenSpec 严格校验通过。

## 5. 真实验收（用户已授权）

- [x] 5.1（由 6.6 取代）Desktop 并行派遣 4 个只读 Grok：问好、写文件、`touch`、`mkdir`；核对事件、退出状态与项目文件。
  - 2026-10-25 23:33（ef10d44 正式构建，新 Host 23:31:59），用户授权；4 个任务同时创建、并行运行。grok-12 问好 completed（「你好。」）。grok-9 写文件：仍发起 `session/request_permission`，插件拒绝，Grok cancelled，任务 failed，文件不存在。grok-10 `touch grok-probe-touch.txt`、grok-11 `mkdir grok-probe-dir`：`run_terminal_command` exit 0，无审批请求，任务 completed，项目中实际出现 0 字节文件与空目录。
  - 结论：未通过。`dontAsk` 下不应再有审批请求，`deny` 也未拦住 touch/mkdir，说明 `grok agent stdio` 不采用 `agent` 之前的全局 `--permission-mode`/`--deny`；官方 agent 模式文档只列 `--model`、`--always-approve` 等选项，权限经 `session/new` 的 `_meta`（yoloMode/autoMode）或配置文件设定。本节改动目前对 Grok 行为无效（只读仍依赖插件拒绝审批，touch/mkdir 缺口未补上）；可写 `acceptEdits` 是否生效同样未证实。探针产物保留在测试项目，待用户决定是否删除。
- [x] 5.2 只读运行调用 DSH 工具桥（未授权，未执行）。
  - 2026-11-09：用户决定按已完成关闭；本项没有补做上文所列的真实验收，原记录保留。

## 6. 改为私有 config.toml（用户决定）

- [x] 6.1 `prepareGrok` 只读写入 `[ui] permission_mode = "dontAsk"`、`[permission] deny = ["Bash(mkdir)", "Bash(touch)"]`，工具桥就绪且绑定 Grok 时加 `allow`；可写写回基础配置。`extendedLaunch` 传入工具桥连接。
- [x] 6.2 `grokAcpArgv` 只读去掉无效的全局权限参数；`argvModes` 更名 `launchModes`。
- [x] 6.3 测试：`tests/grok-adapter.test.ts` 只读/可写配置内容、工具桥 allow 仅在就绪且绑定 Grok 的只读运行；`tests/native-acp.test.ts` 只读 argv 不含 `--permission-mode/--deny/--allow`、可写仍为 `acceptEdits`。
- [x] 6.4 离线核对：`grok inspect --json` 读回 `prepareGrok` 生成的配置，只读 loaded 2、带工具桥 loaded 3、可写 loaded 0，均无 skipped；以新 argv 在临时 GROK_HOME 完成 initialize 与 session/new（不发提示）。`[ui] permission_mode = "dontAsk"` 无离线证据（inspect 不显示模式，日志对 dontAsk 与无效值均无警告）。
- [x] 6.5 全量 225 文件 4410 通过、13 跳过（负载约 9，无失败）；类型检查、`build:preview`、OpenSpec 严格校验通过。
- [x] 6.6 Desktop 并行 4 个只读 Grok（问好、写文件、`touch`、`mkdir`）真实复验。
  - 2026-10-26 00:09（f7b4002 正式构建，新 Host 00:07:52），用户授权；4 个任务 0.6 秒内创建并行运行，grok-4.6·low。4 个运行的私有 config.toml 均含 `permission_mode = "dontAsk"`、两条 deny 及工具桥 allow（Desktop 中工具桥已就绪）。grok-13 问好 completed（「你好。」）。grok-15 `mkdir grok-probe-dir`、grok-16 `touch grok-probe-touch.txt`：无审批请求，工具返回 `Denied by permission policy: deny rule on bash matching "mkdir"`/`"touch"`，任务因工具失败证据为 failed「CLI 工具执行失败」。grok-14 写文件：仍发起 1 次 `session/request_permission`，插件拒绝，Grok cancelled，任务 failed。项目文件派遣前后目录清单与 shasum 完全一致。
  - 结论：deny 规则经私有配置生效，touch/mkdir 缺口已补上；`[ui] permission_mode = "dontAsk"` 未生效（写文件仍询问），只读的其余写入仍依赖插件拒绝审批，被拒后 Grok 取消整轮。

## 7. 去掉 dontAsk，加 Edit/Write deny（用户决定）

- [x] 7.1 只读私有配置改为 `[permission] deny = ["Edit", "Write", "Bash(mkdir)", "Bash(touch)"]`，不再写 `[ui] permission_mode`；工具桥 allow 不变。
- [x] 7.2 `tests/grok-adapter.test.ts` 改为断言四条 deny 且无 `permission_mode`；离线 `grok inspect --json` 读回只读 4 条、带工具桥 5 条，无 skipped。
- [x] 7.3 全量 225 文件 4410 通过、13 跳过；类型检查、`build:preview`、OpenSpec 严格校验通过。
- [x] 7.4 Desktop 只读 Grok 写文件任务真实复验（用户已授权 1 个）。
  - 2026-10-26 00:16（d0ecd63 正式构建，新 Host 00:16:10）：首条消息「请调用 1 次 CLI Worker 派遣工具，使用 Grok（Grok Build）…」未派遣任何任务——插件 `invocationResolution` 把「1 次」当作 CLI 名，返回 unknown，提示主 Agent 不启动（另行处理的路由缺陷，与本变更无关）。改为「用 Grok CLI 派遣 1 个只读任务…」后（离线确认解析为 grok）派遣 grok-17（grok-4.6·low，规划（只读））。私有配置含四条 deny 与工具桥 allow；`write` 未发审批请求（`session/request_permission` 0 次），工具返回 `Denied by permission policy: deny rule on edit`，Grok 未取消本轮，如实回复写入被拒且未绕过；任务因工具失败证据显示 failed「CLI 工具执行失败」。项目目录清单与 shasum 前后一致。
  - 结论：通过。写文件、touch、mkdir 均由 Grok 按私有配置的 deny 规则直接拒绝；其余需审批的调用仍由插件拒绝。被拒的只读写入任务显示为失败。
