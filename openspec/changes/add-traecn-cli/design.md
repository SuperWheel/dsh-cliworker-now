# Design

## 1. 形态与身份

只接国内版，一个 CliId `traecn`（形态：独立 CLI、单一版本；国际版未发现）。不建 variant 模块。

| 项目 | 取值 |
| --- | --- |
| `CLI_IDS` / `CLI_LABELS` / `CLI_SHORT_NAMES` | `traecn` / `TRAE CLI CN` / `traecn` |
| 配置项 | `traecnExecutable`，默认 `traecli` |
| transport | `traecn-acp-v1`（发布后不改） |
| runner | `src/host/native-traecn.mjs` 的 `runNativeTraecn`，内部调用 `runNativeAcp`；`native-bridge.mjs`：`traecn: ['native-traecn', 'runNativeTraecn']` |
| ACP 身份 | `agentName: 'traecli-acp'` |
| 别名 | `traecn`、`trae`、`traecli`、`trae cli`、`trae-cli`（仅作别名，不作发现）、`TRAE CLI CN`、`trae 国内版`、`trae 中国版`、`字节 trae` |

泛称“trae”直接路由到 `traecn`（只有一个入口），选型卡片显示「TRAE CLI CN」。

## 2. 发现与启动（阶段 3）

- `executableFor`/`resolveCliExecutable`：手动路径 → 部署配置与自动记录 → 专属发现。专属发现只找 `traecli`：PATH，macOS 与 Linux 再补 `~/.local/bin/traecli`。Windows 走共享 PATH 发现（官方 `install_v2.ps1` 的落点未实测，找不到时提示配置 `traecnExecutable`）。
- 身份核对：对解析结果执行 `traecli --version`（有界 10 s、无 prompt），首行须匹配 `/^traecli \d+\.\d+\.\d+/`，且输出含 `installation:`；否则报“不是官方 TRAE CLI”。结果按可执行文件路径与 mtime 缓存，路径变化重查。`--version` 不触发更新（实测多次后 `current` 链接未变）。
- 名称规则：不按文件名判断同名链接。`~/.local/bin/trae-cli` 若同样指向 `traex`，`--version` 会通过；开源 trae-agent 的 `trae-cli` 会失败。但自动发现从不查找 `trae-cli`/`trae-agent`/`coco`/`ta`。
- 启动 argv（数组）：`[exe, '--permission-mode', launchMode, 'acp', 'serve']`。`launchMode`：规划 → `default`，仅工作区编辑 → `default`，完全权限 → `bypass_permissions`。不附加 `--enable personal_user_login`、`-s`、`-a`、`-y`、`-c`。
- 运行环境：继承 Host 环境（含 `TRAE_HOME`、`TRAECLI_HOST`、`TRAECLI_PERSONAL_ACCESS_TOKEN`），不注入插件私有配置根；macOS 子进程 PATH 补 `~/.local/bin`（TRAE 用 `/bin/zsh -lc` 跑命令，不依赖 PATH 找自身）。

## 3. 账号（阶段 4）

新增 `src/host/traecn-accounts.ts`，`accounts.ts` 只做分派。

- 状态：`[exe, 'login', 'status']`，有界 10 s。`/^Logged in using Trae\s*$/m` → `authenticated`（摘要“已登录 TRAE（CLI 不区分个人与企业账号）”，`verification: 'cli'`）；`/^Not logged in\s*$/m` → `unconfigured`；含 `does not support CLI usage` → `unavailable`，摘要为该原生句子（截断 200 字）；其他 → `unknown`。退出码只作辅助（未登录时为 1）。
- 动作：`login`、`logout`，不提供 `manage`（TRAE 账号管理只有这两个子命令；打开交互 TUI 会带出 `in_app_updates`，不在插件里启动）。
- 登录方式：通过现有 `providers` 机制（`account-guide/providers.ts` 的表），`traecn` 三项：
  - `personal` 「个人账号（依赖 TRAE CLI 开发中特性）」→ `[exe, '--enable', 'personal_user_login', 'login', '--personal']`
  - `enterprise` 「企业 SSO」→ `[exe, 'login', '--enterprise']`
  - `enterprise-pat` 「企业 PAT」→ `[exe, 'login', '--with-trae-pat']`；说明文案：“TRAE 会读取 `TRAECLI_PERSONAL_ACCESS_TOKEN`；未设置时在下方原生终端粘贴令牌，插件不保存。”
  - 没有 provider 的登录请求拒绝（`不支持的登录方式`），不猜默认方式。
- 退出：`[exe, 'logout']`，原生终端结束后刷新状态、绑定与目录。
- 登录域名白名单 `ACCOUNT_LOGIN_HOSTS.traecn`：`['trae.cn', 'www.trae.cn', 'api.trae.com.cn']`（程序字符串与 PRD A.3 观察到的个人登录端点，0.213.1，2026-11-07）；企业 SSO 的域名随企业配置变化，不列入，由原生浏览器流程打开。`SINGLE_ACCOUNT_CLIS` 加入 `traecn`；不加入 `GUIDED_ACCOUNT_CLIS`（没有逐步引导，用原生终端）。
- 来源绑定（`cli-account-binding.ts` 的 `material`）：读取 `${TRAE_HOME ?? ~/.trae}/cli/auth.json`（拒绝符号链接、限 64 KiB），只取 `auth_mode`、`trae.user_id`、`trae.region`、`trae.login_method`、`trae.credential_kind`、`trae.endpoints.api_base_url`，组成 `{ provider: 'trae', principal: { kind: 'trae', subjectHash: sha256(...) } }`；`sourceIds` 含 auth.json 路径，并把 `TRAECLI_PERSONAL_ACCESS_TOKEN`、`TRAECLI_HOST` 的 sha256 摘要（存在时）放入 route。文件不存在 → `CliAccountBindingError('TRAE CLI CN 未登录')`。不读取、不记录 `access_token`、`refresh_token`、`personal_device`。字段名经只看结构（不看值）的核对得到。

## 4. 模型目录（阶段 5）

- `catalogFor('traecn')`：先跑状态；非 `authenticated` 时抛出对应原因。再跑 `[exe, 'models', '--json']`（有界 20 s）。解析数组，每项要求 `config_name` 为非空字符串；`id = config_name`，`label = name ?? config_name`，`efforts` 为空（不提供强度）。已登录但为空 → `TRAE CLI CN 当前账号暂无可确认模型，请刷新或检查套餐`。目录 notice：“TRAE CLI CN 原生账号模型目录；不提供强度选择”。
- 不用 ACP `session/new` 做目录：它会在 TRAE 会话库里留下空会话。
- 执行时 runner 通过 `selectOption('model')` 选择并核对 `config_option_update`/回执。`preference.effort` 只能是 `default`；其他值在 runner 中拒绝（`TRAE CLI CN 不支持强度选择`）。

## 5. 权限（阶段 6）与理由

| 档位 | 名称 | 原生模式 | 降级 |
| --- | --- | --- | --- |
| ask | 不提供 | — | runner 收到 `read-only` 且非规划时拒绝启动 |
| auto | 仅工作区编辑 | `default` | 无（`default` 不可用即拒绝启动） |
| full | 完全权限 | `bypass_permissions` | 回退 `default`，时间线写“本轮按仅工作区编辑运行” |
| 规划 | — | `plan`（以 `default` 启动后切换） | 无 |

为什么中档用 `default` 而不是 `auto`：

1. 对应关系。跟随主对话的中档来自 DSH「工作区内修改」，含义是工作区内放行、工作区外先问。TRAE `default` 正是这样：工作区内读写与命令自动批准，工作区外的写入发 `session/request_permission`，可以转给 DSH。`auto` 会把这些工作区外请求交给 TRAE 自己的审查子 Agent 代批，DSH 看不到，也问不到用户，比主对话档位更宽。
2. 规格。`worker-permission-levels` 规定“插件 MUST NOT 以更宽的模式代替”，并要求名称按实际能力。`default` 不是 CLI 判断放行的“自动审批”，按 ZCode、OpenCode 的先例命名为「仅工作区编辑」。
3. 可验证。工作区外审批的允许与拒绝已在实测中观察到，`auto` 的审查行为没有可核查的回执。

因此 `auto` 不映射任何档位。没有第一项，参照 Hermes：`LEVELS.traecn = { auto: 仅工作区编辑 }`；`runsUnderViewOnly('traecn')` 为 false；`index.ts` `assertAccessSupported` 增加 TRAE 专用提示；`workerPlanSupported` 为 true。

## 6. runner（阶段 7、10）

`native-traecn.mjs` 传给 `runNativeAcp` 的设置：

- `name: 'TRAE CLI CN'`，`agentName: 'traecli-acp'`，`argv: traecnAcpArgv`（见第 2 节；`config.access === 'read-only' && config.mode !== 'plan'` 时抛出“TRAE CLI CN 不支持询问档，请在 Worker 菜单选择仅工作区编辑或完全权限”）。
- `editMode`：`danger-full-access` → `bypass_permissions`，否则 `default`；`fallbackModes`：完全权限 `['default']`，其他 `[]`；`modeConfigId: 'mode'`（同时校验 `config_option_update` 中的 mode）。
- `encode: (v) => v`（实测接受标量字符串）；`effortId` 不设，runner 前置拒绝非 `default` 强度。
- `sessionOption: () => undefined`：TRAE 只给 `approved`（allow_once）与 `abort`（reject_once），没有会话级选项，DSH 不显示“本会话始终允许”。
- `toolName`：`update.title`；执行类工具 `rawInput.command` 为数组（`['/bin/zsh','-lc',cmd]`），审批详情由 `title` 与 `locations` 给出，共享 `acpApprovalRequest` 已能处理（数组命令不当作字符串）。
- `onResult`：`end_turn` 且 `usage` 通过校验（非负整数、`totalTokens === inputTokens + outputTokens`、总量非零）时发 `cliworker.traecn_prompt_usage`（`inputTokens`、`outputTokens`、`totalTokens`，`thoughtTokens` 与缓存字段原样附带但口径记为 reported）；`_meta['_trae/tokenUsage'].contextWindow` 合法时发 `cliworker.traecn_context`（`used`、`size`）。取消时的全零回执不发。
- 新增的共享 runner 选项（默认关闭，其他 CLI 行为不变）：
  - `deniedCancelEndsTurn: true`：本轮有过 DSH 拒绝（现有 `denied` 标志）、回执 `stopReason === 'cancelled'`、用户未停止（`!io.signal.aborted`）、无其他失败时，结果为 `SUCCESS`，正文照常，notice 为“因拒绝审批而结束：被拒操作未执行，可续聊继续”；正文为空也不改判 UNCERTAIN。
  - `modeLabel(candidate)`：降级诊断中的档位名，未提供时保持现有“询问/自动审批”文案。
- 恢复：`config.conversationId` → `session/load`；重放发生在回执之前，runner 尚未 `active`，不进入正文（实测顺序：重放 → 回执）。
- 分支：`forkNativeTraecn` 调用共享 `forkNativeAcp(config, io, traecnAcpArgv(...))`，实测 `session/fork` 返回带历史的新 ID，`session/close` 成功；`conversation-features.ts` 声明 `traecn: { latest: true, earlier: false }` 与 `expectedTransport`。
- 取消：共享 runner 已在 abort 时发 `session/cancel`；Host 负责进程范围退出核对。

## 7. 其他入口（阶段 8–14）

- `native-attachments.mjs`：加入 `traecn`（ACP 图片能力由 `promptCapabilities.image` 判定）。
- `cli-native-capabilities.mjs`：`traecn: mode => ['file-read', ...write(mode), 'search', 'shell', 'web', 'skills']`；`nativeSkillPaths`：用户 `~/.trae/skills`、`~/.agents/skills`，项目 `.trae/skills`、`.agents/skills`（项目路径来自程序字符串，待真实验证）。
- 工具桥：本期不加入 `nativeHarnessExecutionReady` 与注入列表。理由：ACP 只声明 http MCP，`_meta.trae.options.mcpServers` 声明值为“已配置的 MCP 服务名”、语义为替换，与标准 ACP 的服务定义不同，未核实前注入可能失效或覆盖用户 MCP。`session/new` 照常传 `mcpServers: []`（与其他未注入 CLI 相同）。
- `running-message.ts`：不加入 `NATIVE_STEERING_TRANSPORTS`（`_meta.steering.supported` 已声明但未实测），续聊消息走原生 Inbox。
- 子 Agent、记忆：跟随原生（不改 `TRAE_HOME`，不传关闭开关）。子 Agent 作为该 Worker 的工具步骤显示。
- 遥测：`telemetry.ts` 白名单加 `cliworker.traecn_prompt_usage`、`cliworker.traecn_context`，核对 CLI、会话与来源；`native-usage-report.ts` 中 `traecn` 的输入口径为 `reported`（是否含缓存未公开）。不是积分口径。
- 图标：`doc/assets/cli-icons/v5-trae/`，运行图 `src/client/assets/traecn.png`，按 v4-qoder 的 manifest 记录来源。
- 设置页：由 `CLI_IDS` 驱动自动出现；账号区复用现有组件；新文案进 `i18n-messages.ts`。
- `scripts/build.mjs`：加入 `native-traecn.mjs`。

## 8. 兼容性、存储与生命周期

- 新 CliId 与 transport 只对新 Worker 生效，不迁移旧数据；未知 transport 仍拒绝。
- 不新增持久化目录；账号与目录缓存沿用现有 0700/0600 存储。
- 账号与目录查询、ACP 进程都经现有 ProcessBackend，有超时与进程范围清理。

## 9. 风险与回退

- 个人登录依赖开发中特性：后续版本移除时，`--enable personal_user_login` 会报错；个人入口失败时显示原生错误，已有登录按 `login status` 显示。回退：从 providers 表删除 `personal`。
- `acpBackend: legacy`：TRAE 切换后端可能改变事件形态。runner 只消费标准 ACP 字段，遇到缺字段按失败处理。
- `--permission-mode` 只接受三值：若新版本改名，启动即报错，runner 显示原生错误，不回退其他参数。
- `in_app_updates`：本期未见 ACP 模式触发升级；若出现，记录并在后续版本加关闭参数。
- 回退方式：从 `CLI_IDS` 移除 `traecn` 即可隐藏入口；不影响其他 CLI。

## 10. 共享改动

| 文件 | 改动 | 对其他 CLI 的影响 |
| --- | --- | --- |
| `src/host/native-acp.mjs` | 新增可选 `deniedCancelEndsTurn`、`modeLabel` | 无（默认关闭） |
| 共享清单（`types.ts`、`worker-permissions.ts`、`routing.ts`、`native-worker.ts`、`native-bridge.mjs`、`account-links.ts`、`conversation-features.ts`、`native-attachments.mjs`、`cli-native-capabilities.mjs`、`telemetry.ts`、`native-usage-report.ts`、`icons.tsx`、`scripts/build.mjs`、`index.ts`、`process.ts`、`adapters.ts`、`accounts.ts`、`account-guide/providers.ts`、`cli-account-binding.ts`、`runtime.ts`、`i18n-messages.ts`） | 只追加 `traecn` 条目或分支 | 无 |
