## Context

WorkBuddy 内置 CLI 是 CodeBuddy 派生的 lite 构建，设计上由桌面端托管：桌面端读取本机凭据 at-rest 密钥并经一次性 socket 下发，再通过 ready socket 拿到 CLI 的网关端口。本变更由插件扮演这两个 socket 的对端，不依赖桌面端运行。协议事实全部来自本机安装版（2026-11-07，macOS 5.9.3），细节见 [proposal.md](proposal.md) 调研表与共享笔记 `workbuddy-probe-2026-11-07.md`。

## Goals / Non-Goals

**Goals**
- 两个 CliId（`workbuddycn`、`workbuddy`），路径、配置根、模型目录、会话、transport 完全分开。
- 密钥只存在于“引导助手”子进程内存与一次性 socket；runner、Host、日志、事件、持久化都接触不到。
- 复用 `runNativeAcp`，不改其他 CLI 的行为。
- 失败一律明确报不可用并清理进程与 socket，不回退到 PATH 上的 CodeBuddy 或另一版本。

**Non-Goals**
- sidecar 路径、Magpie、插件代登录或退出、国际版与 Windows 的真实验收、DSH 工具桥（未验证 stdio MCP）、原生分支（initialize 未公开 sessionCapabilities）、运行中引导。

## Decisions

### 1. 模块边界（新增文件）

| 文件 | 职责 |
| --- | --- |
| `src/host/workbuddy-variant.ts` | `WORKBUDDY_CLIS`、`isWorkBuddyCli(cli)`、`workbuddyVariant(cli)`：label、期望 endpoint 主机、默认 dataFolderName、macOS 应用名候选、Windows 安装目录候选、transport。两版差异只在此处 |
| `src/host/workbuddy-installation.ts` | `resolveWorkBuddyInstallation(cli, options)`：按候选列表或手动路径找到应用，核对 `cli/package.json` 的 `name === '@genie/agent-cli'`、入口 `cli/dist/codebuddy-lite-wb.mjs` 存在、`cli/product.json` 的 endpoint 主机属于本版、`dataFolderName` 为单段 `.名称`；返回 `{ cli, appRoot, runtime, entry, cliVersion, productName, endpoint, configDir }`，失败抛 `WorkBuddyUnavailableError(reason)`。只读文件元数据，不运行程序 |
| `src/host/workbuddy-key-helper.cjs` | 由 WorkBuddy 自带运行时以 `ELECTRON_RUN_AS_NODE=1` 执行。stdin 读一行 `{socketPath, token, sessionId, pid}`；调用 `process._linkedBinding('electron_browser_workbuddy_storage').loggerGet()`，校验 `{version:1, atRestSecretKey}`（44 字符规范 base64、非全零）；key = sha256(utf8 文本)，keyId = sha256(key) hex 前 16；连接 socket（ENOENT/ECONNREFUSED 每 100ms 重试，总时限 4.5s），发 `{version:1, sessionId, token, pid, bootstrap:{version:1, policy:'fields', symmetricKey:{keyId, keyBase64}, asymmetricUnavailable:'missing-key'}}\n`，等 `{ok:true, policy:'fields'}`；随后清零所有 Buffer。stdout 只写一行 `{ok:true}` 或 `{ok:false, reason}`，reason 取固定类别：`request-invalid`、`binding-unavailable`、`payload-invalid`、`connect-failed`、`ack-invalid`、`channel-closed`、`timeout`。绝不输出密钥、绑定返回值或异常原文 |
| `src/host/workbuddy-bootstrap.mjs` | `workbuddyChildEnv(base, install)` 生成子进程环境；`createWorkBuddyLaunch({ install, platform })` 建私有目录与 ready 监听，返回 `{ env, deliver(io, pid), ready(timeoutMs), close() }` |
| `src/host/codebuddy-acp-outcome.mjs` | CodeBuddy 系 ACP 的共性处理：缓存 `tool_call` 的 title/kind/locations，补到只带 `rawInput` 的 `session/request_permission`；识别 `stopReason: 'cancelled'` 且 `_meta['codebuddy.ai/outcome'] === 'PERMISSION_DENIED'` 的“因拒绝审批而结束”。合并时与 cb-dev 的同类实现去重 |
| `src/host/native-workbuddy.mjs` | `runNativeWorkBuddy(config, io)` 与 `probeWorkBuddyMetadata(...)`；`workbuddyAcpArgv(config)` |

### 2. 子进程环境

`workbuddyChildEnv` 以 `undefined` 值覆盖（Node spawn 跳过 `undefined`，从而删除继承值）：
- 删除：所有大小写的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`（本机实测带代理变量时远端配置拉取报 setProxy 错；CLI 自身按配置或系统代理解析，插件不改用户系统代理）；继承来的 `CODEBUDDY_SIDECAR_*`、`WORKBUDDY_AT_REST_ENCRYPTION`、`CODEBUDDY_GATEWAY_*`、`CODEBUDDY_API_KEY`、`CODEBUDDY_AUTH_TOKEN`、`CODEBUDDY_INTERNET_ENVIRONMENT`、`ACC_PRODUCT_CONFIG_*`。
- 设置：`ELECTRON_RUN_AS_NODE=1`、`CODEBUDDY_FORCE_LITE_WB_BUNDLE=1`、`CODEBUDDY_CONFIG_DIR` 与 `WORKBUDDY_CONFIG_DIR` = `install.configDir`、`WORKBUDDY_DATA_FOLDER_NAME`、`DISABLE_AUTOUPDATER=1`、`CODEBUDDY_DISABLE_CRON=1`（定时任务会越出 Worker 生命周期）、`CODEBUDDY_DISABLE_IDE=1`、`CODEBUDDY_GIT_REPO_SCAN_DISABLED=1`、`CODEBUDDY_PROMPT_SUGGESTION_DISABLED=1`、`WORKBUDDY_AT_REST_ENCRYPTION=fields` 及四个 SIDECAR 变量。
- 引导助手只拿到 `ELECTRON_RUN_AS_NODE=1`、`PATH`、`HOME`/`USERPROFILE`、`SystemRoot`、`TMPDIR`/`TEMP`，不继承其他变量。

### 3. 启动顺序与生命周期

```
createWorkBuddyLaunch  → mkdtemp(os.tmpdir(), 'dshwb-') 0700；b.sock / r.sock（Windows：\\.\pipe\dsh-wb-<随机>-b / -r）
                          token = randomBytes(32).hex，sessionId = randomUUID；ready 服务器开始监听
io.spawn(CLI)          → argv [runtime, entry, --acp, --setting-sources, user, --strict-mcp-config,
                                 --serve, --host, 127.0.0.1, --port, 0, --auth, password]
deliver(io, child.pid) → io.spawn([runtime, helper]) 写 stdin 请求，读一行结果（时限 8s）
ready(20s)             → 只接受一个连接、一行 JSON-RPC `session.ready`，核对 protocolVersion 1、token、sessionId、pid
                          与 port 整数；回 {jsonrpc:'2.0', id, result:{ok:true}}；其他一律断开并失败
initialize → session/new|load → 选型/强度/模式确认 → session/prompt（runNativeAcp）
finally                → close()：关闭服务器、删除 socket 与目录；CLI 与助手由 io 统一停止并确认退出
```

- stdout 过滤：ready 确认之前，非 JSON 行（网关横幅，含密码）丢弃且不写入任何地方，只计数；超过 32 行或 16 KiB 判为失败。ready 之后原样交给 `createLinePeer`，非 JSON 行按现有规则失败。
- stderr：CLI 的 `[CredentialBootstrap]` 诊断不含密钥但含会话标识，仍按现有 stderr 通道上报；助手的 stderr 不上报（`reportStderr: false`）。
- runner 在 `runNativeAcp` 外层用 `Object.create(io)` 覆盖 `openStdio`，在返回 peer 前完成引导与 ready；任何一步失败都先停止 CLI、关闭 launch，再抛出 `WorkBuddy 暂不可用：<原因>`。`runNativeAcp` 本身不改。
- 停止：只停止 io 登记的子进程（CLI 与助手），从不触碰 WorkBuddy 桌面端进程。

### 4. 身份核对

initialize 回执没有 `agentInfo`，`settings.agentName` 不设。改为两道核对：Host 解析安装时核对包名、入口与 product endpoint；runner 启动前重读 argv 中入口同级的 `package.json` 与 `product.json`，核对包名与 endpoint 主机仍属本版，否则拒绝（防跨版与更新后路径变化）。

### 5. 权限与规划

| 档位 | 原生模式 | 回退 |
| --- | --- | --- |
| 询问 | `default`（Always Ask） | 无 |
| 自动审批 | `auto`（AI 分类器代批，风险动作拒绝） | `default` |
| 完全权限 | `bypassPermissions` | `auto`、`default` |
| 规划 | `plan` | 无 |

`fullAccess`（连危险命令检查也跳过）与 `dontAsk`、`acceptEdits`、`delegate` 不映射。`modeConfigId: 'mode'`。`sessionOption` 不提供：`allow_always` 的作用域未核实，不能确认是会话级。询问档的实际审批行为沿用 CodeBuddy 2.181 的实测作初步依据，WorkBuddy 2.165 待真实任务核实。

### 6. 模型与强度

- 目录来自 `session/new` 的 `models.availableModels`（`modelId`、`name`）；`auto` 按原生 ID 保存与显示。
- 强度：`effortId: 'thought_level'`；提供 `thought_level` 选项中与共享 `EFFORTS` 重合的值（minimal/low/medium/high/xhigh/max）；`default` 不设置（保持 `enabled`，即模型默认）；没有关闭值，不提供 `none`。
- 目录查询走同一引导流程（`probeWorkBuddyMetadata`），只发 `initialize` 与 `session/new`，读取后关闭；会话随即丢弃（原生不提供删除，记为已知副作用）。
- 发现自验证：同 Qoder 的 `selfVerifiedDiscovery`，每次查询都经真实引导确认，不读取凭据文件做来源绑定。

### 7. 账号

- 状态：元数据查询成功 → 已登录（站点取 product endpoint）；`session/new` 返回认证错误 → 未登录，提示“请打开 WorkBuddy 桌面端登录后重试”；引导失败 → 不可用并给出类别。
- 登录与退出：不提供插件入口，账号区只给桌面端指引；不读取凭据文件内容。单账号（`SINGLE_ACCOUNT_CLIS`），无引导登录窗口，`ACCOUNT_LOGIN_HOSTS` 不登记。

### 8. 其他能力

- transport：`workbuddycn-acp-v1`、`workbuddy-acp-v1`，一经发布不改。
- 附件：`promptCapabilities.image: true`，加入 `native-attachments` 支持列表，由 `nativeAcpAttachmentPrompt` 按能力处理。
- DSH 工具桥：不启用。CLI 只公开 http/sse MCP，插件的工具服务是 stdio，未验证；`--strict-mcp-config` 下也不加载用户 MCP 以外的配置。原生工具（文件、命令、搜索、网页、skills）照常可用。
- 分支：不支持，理由“WorkBuddy 内置 CLI 未公开原生分支能力”。
- 运行中输入：无原生 steer，沿用 Inbox。
- 子 Agent 与记忆：跟随原生设置；定时任务关闭（理由见第 2 节）。
- 遥测：不新增原生用量事件，用量与上下文保持未知。

### 9. 泛称路由

`workbuddy` 同时是国际版 ID 与泛称，按 Qoder 的办法：泛称时只装一版用该版，两版都装时宿主原生询问，未知不改版；显式“国际版/WorkBuddy AI”与“国内版/中国版”不互相回退。

## Risks / Trade-offs

- 私有绑定、引导与 ready 协议随应用更新可能变化 → 每一步失败都给出类别并清理；transport 不变，已有 Worker 记录保留。
- 网关端口在回环口开放，Worker 存活期间可被持有密码的本机进程访问 → 密码不落地、不记录；进程退出即关闭。
- 元数据查询会在 `~/.workbuddy` 留下空会话记录 → 记入 tasks.md 的已知副作用。
- 国际版的应用名、配置根与 endpoint 只有第三方线索 → 发现以 product.json 的 endpoint 判定版本，配置根取 product.json 的 dataFolderName；验收标为未验证。

## Migration Plan

新增 CLI，无存量迁移。回退：删除两个 CliId 注册即可，已有记录按“未知通信协议”拒绝。

## Open Questions

- 询问档在 WorkBuddy 2.165 的真实审批行为、`allow_always` 的作用域。
- `thought_level` 选项是否随模型变化（需在真实会话里切换模型观察 `config_option_update`）。
- Windows 安装路径与可执行名、国际版 product 身份。
