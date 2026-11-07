## Why

用户希望在 DSH 中派遣腾讯 WorkBuddy。WorkBuddy 没有公开的独立 CLI；桌面应用内置一份 CodeBuddy 派生 CLI，按“桌面端托管的 sidecar”设计，凭据字段加密密钥由桌面端下发，直接启动会卡在初始化（见 [v0.8.8 PRD](../../../doc/prd/2026-11-07-v0.8.8-PRD.md) §四.三、附录 A.2）。用户 2026-11-07 决定以试验性方式走“密钥引导”路径：插件用 WorkBuddy 自带的 Electron 运行时读取本机 at-rest 密钥，经一次性私有 socket 交给插件启动的内置 CLI，不依赖桌面端正在运行，也不采用 sidecar 路径或 Codingns4DSH 的 Magpie 方案。

## 调研与形态判定

形态 D（宿主应用内置 CLI），按[新 CLI 接入流程](../../../doc/knowledge/cli-integration/new-cli-onboarding.md) 1.2 节处理。来源：本机为 2026-11-07 macOS WorkBuddy.app 5.9.3 的只读检查与元数据探测（未发 prompt）；第三方为 Codingns4DSH（GPL-3.0，仅作线索，代码未复制）。

| 项目 | 结论 | 来源 |
| --- | --- | --- |
| 发布方与包 | 腾讯 WorkBuddy 桌面端内置 `Contents/Resources/app.asar.unpacked/cli`，包名 `@genie/agent-cli` 2.165.0，入口 `dist/codebuddy-lite-wb.mjs`；以应用自带 Electron（macOS `Contents/MacOS/Electron`，Windows `WorkBuddy.exe`）加 `ELECTRON_RUN_AS_NODE=1` 运行，须设 `CODEBUDDY_FORCE_LITE_WB_BUNDLE=1` | 本机 |
| 国内版与国际版 | 国内版 WorkBuddy（`product.json`：productName `WorkBuddy`、endpoint `https://www.workbuddy.cn`、dataFolderName `.workbuddy`、bundle `com.tencent.workbuddy.mac`）；国际版 WorkBuddy AI（`workbuddy.ai`）本机未安装，发现路径与配置根待核实 | 本机；第三方（国际版） |
| 判定 | 两个下载入口、两套 product 身份与数据目录，按两个独立安装处理：`workbuddycn`「WorkBuddy」与 `workbuddy`「WorkBuddy AI」 | 本机 product.json；用户决定 |
| 使用门槛 | 需安装并登录 WorkBuddy 桌面端；插件不提供登录 | 本机 |
| 认证 | 凭据字段加密（桌面端 buildPolicy `fields`）；密钥由私有绑定 `electron_browser_workbuddy_storage.loggerGet()` 返回 `{version:1, atRestSecretKey}`，对称密钥为该 base64 文本的 sha256 | 本机（读安装版代码并实测引导成功） |
| 引导 | CLI 监听 `CODEBUDDY_SIDECAR_CREDENTIAL_BOOTSTRAP_SOCKET`（5 秒超时），插件作客户端发一行载荷，键固定为 `bootstrap,pid,sessionId,token,version`，`pid` 须为 CLI 自身 pid；四个 `CODEBUDDY_SIDECAR_*` 变量与 `WORKBUDDY_AT_REST_ENCRYPTION` 必须同时提供 | 本机 |
| 非交互与流 | 只用 stdio `--acp` 时 `initialize` 一直挂起；须加 `--serve --host 127.0.0.1 --port 0 --auth password`，CLI 经 `CODEBUDDY_SIDECAR_READY_SOCKET` 上报 `session.ready`，插件确认后 stdio ACP 才响应；`--serve` 在 stdout 打印含网关密码的非 JSON 横幅 | 本机实测 |
| 会话 | ACP `loadSession: true`；`session/new` 返回会话 ID；会话存于配置根 | 本机 |
| 模型与强度 | 模型来自 `session/new` 的 `models`（账号实际目录）；强度为会话配置项 `thought_level`（minimal/low/medium/high/xhigh/max/enabled），模型 `_meta` 没有 `effortOptions`；无 agentInfo | 本机 |
| 权限 | 原生模式 default（Always Ask）/acceptEdits/plan/auto/dontAsk/bypassPermissions/fullAccess/delegate | 本机 |
| 配置根 | 桌面端给 CLI 设 `CODEBUDDY_CONFIG_DIR` 与 `WORKBUDDY_CONFIG_DIR` 都等于 `~/<dataFolderName>`；不设时 CLI 回落到 `~/.codebuddy`（与独立 CodeBuddy 冲突） | 本机 |
| 代理 | 子进程带 `HTTP(S)_PROXY` 时远端配置拉取报 setProxy 错并退回内置旧模型列表；去掉后由 CLI 自身按配置或系统代理解析 | 本机实测 |
| 副作用 | 桌面端为 CLI 设 `DISABLE_AUTOUPDATER=1`、`CODEBUDDY_DISABLE_CRON=1`；插件同样设置 | 本机 |

## What Changes

- 新增两个 CliId：`workbuddycn`「WorkBuddy」与 `workbuddy`「WorkBuddy AI」，标注“试验性：依赖 WorkBuddy 桌面端非公开接口”。
- 发现：只认 WorkBuddy 应用包内的 Electron 与内置 CLI，核对包名、入口与 product 身份，不回退到 PATH 上的 CodeBuddy；两版互不借用。
- 密钥引导：插件自写的引导助手由 WorkBuddy 自带 Electron 执行，读取密钥并直接投递给 CLI 的一次性 socket；runner 只拿到成功或失败类别，不接触密钥。私有目录 0700，完成或失败都删除。
- 通信：复用 `runNativeAcp`，transport `workbuddycn-acp-v1` / `workbuddy-acp-v1`；runner 负责 ready 确认、丢弃网关横幅、清除代理变量与配置根注入。
- 模型目录：用同一引导流程做 `initialize` + `session/new` 元数据查询，不发 prompt。
- 权限三档：询问 `default`、自动审批 `auto`、完全权限 `bypassPermissions`；规划 `plan`。拒绝审批以 `cancelled` + `PERMISSION_DENIED` 结束整轮时显示“因拒绝审批而结束”（共性处理先写成本分支独立模块）。
- 账号：只显示状态（以 `session/new` 是否认证为准），登录与退出指引用户在 WorkBuddy 桌面端操作。
- 泛称“WorkBuddy”按安装分流，两版都装时询问。
- 图标、设置页、i18n、README 等文档同步。

## Capabilities

### New Capabilities
- `workbuddy-cli`：WorkBuddy 两版的身份、发现、密钥引导、原生会话、权限、目录与验证边界。

### Modified Capabilities
- 无主规格改写；跨能力的共享清单（CLI 列表、权限菜单、路由）只追加条目，行为约束写在 `workbuddy-cli` 中，合并时由协调会话决定是否并入主规格。

## Impact

- Host：`types.ts`、`worker-permissions.ts`、`routing.ts`、`native-worker.ts`、`native-bridge.mjs`、`adapters.ts`、`accounts.ts`、`index.ts`、`process.ts`、`runtime.ts`、`cli-native-capabilities.mjs`、`native-attachments.mjs`、`account-links.ts`、`conversation-features.ts`；新增 `workbuddy-variant.ts`、`workbuddy-installation.ts`、`workbuddy-bootstrap.mjs`、`workbuddy-key-helper.cjs`、`native-workbuddy.mjs`、`codebuddy-acp-outcome.mjs`。
- Client：`icons.tsx`、i18n 文案、连接页试验性标注。
- 构建：`scripts/build.mjs` 运行资源清单。
- 范围外：sidecar 路径、Magpie、国际版真实验收（未安装）、Windows 真实验收、真实模型任务（待用户批准模型）、插件代登录。

## Risks

- 依赖逆向得到的私有绑定与引导协议，WorkBuddy 更新即可能失效；失败时明确报不可用，不回退。
- 插件启动的进程经手凭据 at-rest 密钥；限制为引导助手进程内存与一次性 socket。
- `--serve` 在本机回环口开启带密码的 HTTP 网关，存活期与 Worker 进程相同；密码只出现在被丢弃的 stdout 横幅中。
- Worker 会话写入 `~/.workbuddy`，可能出现在 WorkBuddy 桌面端的历史中（待实测）。
- 许可：Codingns4DSH 为 GPL-3.0、codex-host 为 LGPL-3.0，本项目只依据本机安装版的事实自行实现。
