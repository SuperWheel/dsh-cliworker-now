## Why

2026-10-25 Desktop 复验（`fix-parallel-account-waits` 4.2）中，3 个只读 Grok 任务均在原生会话建立后失败：`ACP does not advertise the selected permission mode`。

本机证据：

- 失败任务原始帧：Grok 1.0.62 的 ACP `session/new` 只返回 `sessionId`、`models`、`configOptions`（仅 `model`、`reasoning_effort`）和 `_meta`，`modes` 为空；会话详情 `kind` 为 `build`。插件只读时要求 ACP 列出并切换 `plan` 模式，因此在发送提示前失败。
- `grok --help`（1.0.62）的 `--permission-mode` 可选值包含 `plan`。在临时 GROK_HOME（仅登录链接）以 `--permission-mode plan agent --no-leader stdio` 启动，只做 initialize 与 session/new、不发送提示：会话正常建立，同样不列出模式。
- 可写任务已按同一方式由原生启动参数 `--permission-mode acceptEdits` 设定，从不虚构 ACP 模式。只读原先传 `--permission-mode default` 并依赖 ACP 切换。

- 首版以 `--permission-mode plan` 修复后，Desktop 复验中 Grok 对写文件仍发起审批请求（由插件拒绝）。随 1.0.62 安装的官方文档 `~/.grok/docs/user-guide/22-permissions-and-safety.md` 说明：`plan` 只是为兼容 Claude 设置而接受的值，不是 Grok 的规划模式；`dontAsk` 只运行预先允许的工具与内置只读处理，其余直接拒绝；`mkdir`、`touch` 在包括 `dontAsk` 的所有模式下都免审批，只能用 `deny` 规则阻止，`deny` 优先于所有模式与 allow 规则。

- 第二版把 `dontAsk` 与 deny 规则作为 `agent` 之前的全局参数传入；2026-10-25 23:33 复验中写文件仍发起审批、`touch`/`mkdir` 仍成功，说明 `grok agent stdio` 不采用这些全局参数（官方 agent 模式文档只列 `--model`、`--always-approve` 等选项）。
- 官方配置文档：`config.toml` 的 `[permission] deny/allow` 为原生规则；`grok inspect --json` 可离线读回已加载规则数。`[ui] permission_mode` 文档只列 `default/ask/auto/always-approve`，`dontAsk` 在二进制中存在（`prompt_policy is dontAsk (Deny)`）但未写入该键的文档，是否生效须真实运行确认。

## What Changes

- 第三版私有配置中的 `[ui] permission_mode = "dontAsk"` 经 2026-10-26 00:09 复验未生效（写文件仍询问），deny 规则生效；用户决定去掉 dontAsk、改加 Edit/Write deny。
- 只读 Grok 运行在本次私有 `GROK_HOME/config.toml` 中写入 `[permission] deny = ["Edit", "Write", "Bash(mkdir)", "Bash(touch)"]`；DSH 工具桥已就绪且绑定 Grok 时追加 `allow = ["MCPTool(dsh_worker_tools__*)"]`，每次执行仍由 Host 审批。可写运行写回不含这些段的基础配置。
- 原生 ACP 启动参数中，只读不再传无效的全局权限参数（替换掉原 `--permission-mode`）；可写仍传 `--permission-mode acceptEdits`（其是否生效不在本变更范围）。
- ACP 完全不列出模式时，只有启动时已由私有配置确定只读的 CLI（Grok）可跳过 ACP 切换；列出模式时仍须确认 `plan`，其他 CLI 照旧失败关闭。
- 插件继续拒绝非工具桥的额外权限请求作为兜底；不新增操作系统沙箱，不写用户或项目配置。旧非原生路径同样使用该私有配置。

## Capabilities

### Modified Capabilities

- `platform-runtime`：新增“Grok 只读任务使用私有配置中的拒绝规则”“Grok 原生 ACP 只读启动与兜底”。

## Impact

- Host：`src/host/grok-adapter.ts`、`src/host/extended-adapters.ts`、`src/host/native-grok.mjs`、`src/host/native-acp.mjs`、`src/host/native-harness-injection.mjs`。
- 测试：`tests/grok-adapter.test.ts`。
- 测试：`tests/native-acp.test.ts`。
