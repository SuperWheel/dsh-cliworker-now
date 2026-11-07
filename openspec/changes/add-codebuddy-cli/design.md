## Context

CodeBuddy Code 2.181.0 是同一 CLI、按站点登录（形态 C）。实测事实见 proposal.md 调研表与 [doc/codebuddy-protocol.md](../../../doc/codebuddy-protocol.md)。最接近的已有实现是 Qoder（ACP、配置项 `mode`/`model`、单账号）。v0.8.8 另有 TRAE 与 WorkBuddy 两个分支并行接入，共享清单的冲突由协调会话合并；WorkBuddy 的内置 CLI 派生自 CodeBuddy，可能复用本变更的 runner 设置。

## Goals / Non-Goals

**Goals:**
- 一个 `codebuddy` 入口，经 ACP 完成新建、续聊、停止、审批转交与拒绝结束的如实显示。
- 模型与强度只来自原生 `session/new`；站点或账号切换后目录失效。
- 不读取凭据内容，不触发自动更新，不改写用户的 CodeBuddy 设置。

**Non-Goals:**
- 不使用 `-p` stream-json，不使用 `_codebuddy.ai/getUserInfo`、`resolveInterruption` 等私有请求。
- 不接入积分计费回执、私有阶段进度与 checkpoint 回滚。

## Decisions

### 1. 模块划分

| 模块 | 职责 |
| --- | --- |
| `src/host/native-codebuddy.mjs` | runner：`codebuddyAcpArgv`、`codebuddyRunnerSettings(config)`、`runNativeCodebuddy`；导出纯函数 `codebuddyModeFor(access, mode)`、`codebuddyToolName(update)`，供测试与 WorkBuddy 分支复用 |
| `src/host/codebuddy-catalog.mjs` | 独立 Node 脚本：启动 `codebuddy --acp --no-session-persistence`，发 `initialize` 与 `session/new`，输出解析后的模型目录 JSON，随后 SIGTERM 并确认退出（照 `grok-catalog.mjs` 的写法） |
| `src/host/codebuddy-account.ts` | 认证文件路径、登录状态（只 `lstat`）、站点声明、`parseCodebuddyModels`、目录查询（经 `captureCatalogMetadata` 运行上面的脚本）、账号绑定材料、单次授权内的目录快照 |
| 共享清单 | `CLI_IDS` 等注册项（见 tasks 2.x） |

runner 启动参数为 `[codebuddy, --acp]`；`config.argv` 由 `workerArguments` 生成，原样交给 runner（与 Qoder 相同）。运行环境追加 `DISABLE_AUTOUPDATER=1`，不设 `CODEBUDDY_INTERNET_ENVIRONMENT`。

### 2. runner 设置

```js
runNativeAcp(config, io, {
  name: 'CodeBuddy',
  argv: codebuddyAcpArgv,
  verifyInitialize: (init) => ...,            // 新增可选项，见第 3 节
  effortId: 'thought_level',
  defaultEffort: 'enabled',                   // 新增可选项
  editMode: codebuddyModeFor(config.access),  // default / auto / bypassPermissions
  fallbackModes: full ? ['auto','default'] : auto ? ['default'] : [],
  modeConfigId: 'mode',
  requireModeCatalog: true,
  sessionOption: (options) => options.find(o => o.kind === 'allow_always' && o.optionId === 'allow_always'),
  encode: (v) => v,
  toolName: (u) => u._meta?.['codebuddy.ai/toolName'] ?? u.title,
  approvalFromToolCall: true,                 // 新增可选项
  deniedCancelEndsTurn: true,      // 新增可选项
})
```

`deniedCancelEndsTurn` 与 TRAE 共用：仅本轮确有 DSH 拒绝、`stopReason === 'cancelled'`、用户未停止且没有其他失败时，以 SUCCESS 和“因拒绝审批而结束：被拒操作未执行，可续聊继续”收尾，空正文不降为 UNCERTAIN；不要求 CodeBuddy 私有 outcome 字段。规划模式由 `runNativeAcp` 的 `config.mode === 'plan'` 选择 `plan`（不降级）。

### 3. 共享 runner 的可选行为（`native-acp.mjs`，默认关闭）

| 设置 | 默认 | 行为 |
| --- | --- | --- |
| `verifyInitialize(initialized)` | 无 | 返回字符串时以该原因拒绝启动。CodeBuddy 回执没有 `agentInfo`，用 `authMethods` 含 `internal` 与 `external` 判定身份 |
| `defaultEffort` | 无 | 偏好强度为 `default` 时显式选择该值（CodeBuddy 为 `enabled`），防止续聊沿用上一轮强度 |
| `approvalFromToolCall` | false | runner 记录每个 `toolCallId` 最近的 `title`/`kind`/`locations`；授权请求缺少这些字段时用记录补全后再生成提问卡（请求字段优先） |
| `deniedCancelEndsTurn` | false | 本轮有 DSH 拒绝、原生 cancelled、未被停止且无其他失败时，以 SUCCESS 和“因拒绝审批而结束：被拒操作未执行，可续聊继续”收尾；空正文不降为 UNCERTAIN。被拒且无终态的工具补发 `FAILED`、输出“已拒绝”的工具事件，并从“工具缺少终态”检查中排除 |

另在 `native-harness-injection.mjs` 的桥工具名候选中追加 `call?._meta?.['codebuddy.ai/toolName']`，并把 `codebuddy` 加入工具桥传输列表（不加入 `nativeHarnessExecutionReady`）。

### 4. 账号、站点与绑定

- 认证目录：macOS `~/Library/Application Support/CodeBuddyExtension/Data/Public/auth`，Windows `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth`，Linux `~/.local/share/CodeBuddyExtension/Data/Public/auth`。文件名由产品 `authentication.id` 派生，2.181.0 为 `Tencent-Cloud.coding-copilot.info`。
- 登录状态：该文件是普通文件（不是符号链接）且没有 `<file>.logged-out` → 已登录；否则未登录。只用 `lstat`/`existsSync`，不打开文件。
- 站点（2026-11-07 用户批准“允许只读站点”，经协调会话转达）：按 CLI 自身的优先级取第一项可用来源：
  1. `~/.codebuddy/settings.json` 的 `env.CODEBUDDY_INTERNET_ENVIRONMENT`（或 `env.CODEBUDDY_COPILOT_INTERNET_ENVIRONMENT`）。该文件可能含网关密码，只在内存中解析并只取这两个键，其余字段不读出、不传递。
  2. 进程环境中的同名变量。
  3. 认证文件 `auth.domain`：只在内存中解析，取出 `auth.domain` 后立即丢弃整份对象；令牌等字段不读出、不传递。按已安装包 `product.json` 的 `authentication.attributes` 域名表匹配（读不到时用 2.181.0 内置表）：`internalDomain` → 中国站，`iOADomain` → iOA，`cloudHostedDomain`（通配）→ 企业域（云托管），`externalDomain` → 国际站；都不匹配时不猜。
  4. 都没有或解析失败：显示“站点未公开”，错误信息不带文件内容。
  - 域名值与文件内容不写日志、事件、持久化或测试快照；绑定只保存站点 ID（`internal`、`external`、`ioa`、`cloudhosted`、`declared:<值>` 或 `undeclared`）。测试使用标注为模拟的夹具文件。
- 绑定材料：`sourceIds = [认证文件路径]`；`entries = [{ provider: 'codebuddy', principal: { site: 站点 ID, catalog: sha256(排序后的 [modelId, credits]) } }]`。站点或目录任一变化，旧目录与偏好校验都失效。认证文件每次启动都会重写，所以不用文件属性做绑定。
- 单次授权内的快照：`authorizedCatalog` 先后两次读绑定，中间读目录。CodeBuddy 照 Qoder 的 `withQoderCatalogSnapshot` 用 `AsyncLocalStorage` 包住一次授权，目录查询只跑一次，绑定与目录都取自同一快照；快照外（设置页刷新等）每次重新查询。
- 账号操作：`login`/`logout`/`manage` 都打开原生交互终端 `[codebuddy]`（环境带 `DISABLE_AUTOUPDATER=1`），提示使用 `/login`、`/logout`；不自动输入斜杠命令。`ACCOUNT_LOGIN_HOSTS.codebuddy` 只列出实际观察到的登录域名（待登录窗口实测时补齐，先列 `codebuddy.cn`、`codebuddy.ai`、`copilot.tencent.com`）。CodeBuddy 进入 `SINGLE_ACCOUNT_CLIS`，不进入 `GUIDED_ACCOUNT_CLIS`。

### 5. 目录

`parseCodebuddyModels(state)`：每个模型产出 `{ id: modelId, label, cost, efforts: ['default', ...effortOptions.value ∩ EFFORTS] }`。`label` 用 `name`；同名时加模型 ID。`_meta.credits` 匹配 `x0.00` 为 `free`，大于零为 `paid`，否则 `unknown`。目录为空或格式不对时报错，不发布成功目录。未登录时 `session/new` 返回 `Authentication required`，脚本以专门的退出原因报告，账号显示为认证失效。

### 6. 权限档位文案

`LEVELS.codebuddy = { ask: ASK, auto: { name: '自动审批', description: '使用 CodeBuddy 原生 Auto：由其 AI 审查逐项放行或拦截；被拦截的操作不会再问你。' } }`。`workerPlanSupported` 对 CodeBuddy 返回 true；`runsUnderViewOnly` 为 true（询问档可转交审批）。

### 7. 会话能力

- 分支：CodeBuddy 有 `--fork-session` 与私有 `_codebuddy.ai/modSessions/fork`，但 ACP `sessionCapabilities` 未公开 `fork`，本期 `forkSupport` 为不支持，理由“CodeBuddy ACP 未公开 session/fork”。
- 运行中引导：未核实原生 steer，不加入 `NATIVE_STEERING_TRANSPORTS`，走原生 Inbox。
- 附件：`promptCapabilities.image` 为 true，加入 `native-attachments.mjs` 的 `supported`。

### 8. 遥测

`telemetry.ts` 中 Kimi/Grok 处理 `usage_update` 的分支加入 `codebuddy`，标注“CodeBuddy 原生会话上下文统计”。单次响应 token 与积分本期不接入，保持未知。

### 9. 图标

素材目录 `doc/assets/cli-icons/v5-codebuddy/`（编号若与并行分支冲突，由合并时调整），运行图 `src/client/assets/codebuddy.png`。只用官方页面可追溯的原件，记录 URL、日期、尺寸与透明度检查。

## Risks / Trade-offs

- [读取认证文件] → 用户已批准只读站点字段。解析在内存中完成，只保留站点 ID；`product.json` 域名表随 CLI 更新，读不到时退回内置表，匹配不到显示“站点未公开”。
- [目录查询成本] → 每次授权启动一次 ACP 进程（约 1 秒）。由单次授权快照与现有设置目录缓存降低。
- [拒绝结束的展示] → 无其他失败且未主动停止时以 SUCCESS 和拒绝结束说明收尾；被拒操作没有执行，可在同一 Worker 续聊。其他失败不被覆盖。
- [私有请求] → `_codebuddy.ai/requestSensitiveApproval` 等请求一律以“客户端不支持”回复，可能让 CodeBuddy 视为拒绝。真实验收中观察是否出现。
- [WorkBuddy 复用] → 纯函数与设置工厂独立导出；WorkBuddy 若身份或结束标记不同，可在自己的 runner 中覆盖对应设置。
- [共享文件冲突] → 共享改动全部是追加或默认关闭的可选项，合并时按清单处理。

## Migration Plan

新增 CLI，无数据迁移。回退时从 `CLI_IDS` 移除 `codebuddy` 并删除新增文件；共享 runner 的可选行为默认关闭，不影响其他 CLI。已有 `codebuddy-acp-v1` Worker 在回退后按未知 CLI 只读显示。

## Open Questions

- 国际站真实任务需用户在原生终端切换站点后执行。
