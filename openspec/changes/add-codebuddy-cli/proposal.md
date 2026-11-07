## Why

用户希望在 CLI Worker 中派遣腾讯 CodeBuddy Code，并覆盖中国站与国际站（v0.8.8 PRD 需求 5.2、5.3、5.9–5.13）。经 2026-11-07 查证与本机实测，两个站点是同一个 CLI 的不同登录站点，用户已确认只做一个入口。接入需要按 [新 CLI 接入流程](../../../doc/knowledge/cli-integration/new-cli-onboarding.md) 完成注册、发现、账号、目录、权限、协议、审批、遥测、图标、设置页与验收。

## 调研结论与形态判定

形态判定为 **C（同一 CLI，一次只登录一个站点）**。

| 项目 | 结论 | 来源 |
| --- | --- | --- |
| 包与命令 | npm `@tencent-ai/codebuddy-code` 2.181.0，命令 `codebuddy`（另有 `cbc`）；本机 `/opt/homebrew/bin/codebuddy` | npm、本机 |
| 站点 | 登录菜单为 Chinese Site（`internal`）、International Site（`external`）、Enterprise Domain（`selfhosted`）、iOA；ACP `authMethods` 同样列出四种；配置根同为 `~/.codebuddy` | 官方文档、本机 `initialize` 回执、程序字符串 |
| 凭据 | 认证文件按 HOME 存放：macOS `~/Library/Application Support/CodeBuddyExtension/Data/Public/auth/<id>.info`，Windows `%LOCALAPPDATA%\CodeBuddyExtension\Data\Public\auth\`；退出时写 `<file>.logged-out` 标记；文件每次启动都会重写 | 程序字符串（`getAuthSavePath`、`getLogoutMarkerPath`）、本机文件时间 |
| 登录与退出 | 没有 login/logout 子命令；交互界面内使用 `/login`、`/logout` | 本机 `--help` |
| 站点判断 | CLI 自身依据认证文件中的 `auth.domain` 或 `CODEBUDDY_INTERNET_ENVIRONMENT` 判断站点；ACP 回执不公开站点。`_codebuddy.ai/getUserInfo` 的响应会附带 accessToken，**不得调用** | 程序字符串、本机回执 |
| 通信 | ACP `codebuddy --acp`（stdio）；`-p` 的 stream-json 不支持把审批转交宿主 | 官方 headless 文档、本机实测 |
| 会话 | `session/new` 返回会话 ID；`loadSession: true`，`session/load` 先重放历史再返回模型与配置项；续聊可读到上一轮上下文 | 本机实测（2026-11-07） |
| 模型与强度 | `session/new` 返回 17 个模型，每个模型 `_meta.effortOptions` 不同（如 `hy4free` 只有 high），`_meta.credits` 给出积分倍率；强度经配置项 `thought_level` 设置，另有 `enabled`（模型默认） | 本机实测 |
| 权限 | 7 种模式：`default`（Always Ask）、`acceptEdits`、`plan`、`auto`（AI 审查代批，失败只拦截该动作、不回退为询问）、`dontAsk`、`bypassPermissions`、`fullAccess`（连危险命令检查也跳过） | 本机实测 |
| 审批 | `session/request_permission` 选项 `allow_always`/`allow`/`reject`；`toolCall` 只有 `toolCallId`、`rawInput` 与 `_meta['codebuddy.ai/toolName']`，标题与类型在此前的 `tool_call` 事件中 | 本机实测 |
| 拒绝 | 拒绝任一审批后本轮立即以 `stopReason: cancelled` 结束，`_meta['codebuddy.ai/outcome']` 为 `PERMISSION_DENIED`；被拒工具没有终态事件。用户取消时同字段为 `CANCELLED` | 本机实测 |
| 进程 | 关闭 stdin 后进程不会自行退出，SIGTERM 后以 0 退出 | 本机实测 |
| 副作用 | 默认自动更新，`DISABLE_AUTOUPDATER=1` 关闭；`--no-session-persistence` 可让目录查询不留下会话文件 | 官方文档、本机实测 |
| 用量 | `usage_update` 给出上下文 `used`/`size`，`_meta.usage` 给出单次响应 token；没有每轮积分回执 | 本机实测 |

## What Changes

- 新增 CliId `codebuddy`，名称「CodeBuddy Code」，短名 `codebuddy`，配置项 `codebuddyExecutable`（默认 `codebuddy`），transport `codebuddy-acp-v1`。
- 新增 ACP runner `native-codebuddy.mjs`，复用 `runNativeAcp`；新增目录查询脚本 `codebuddy-catalog.mjs`（`--acp --no-session-persistence`，只发 `initialize` 与 `session/new`）。
- 三档映射：询问 → `default`，自动审批 → `auto`，完全权限 → `bypassPermissions`；规划模式 → `plan`；`fullAccess` 不映射到任何档位。
- 审批卡片标题取自同一 `toolCallId` 的 `tool_call` 事件；拒绝后整轮结束时显示“因拒绝审批而结束”，与用户停止区分。
- 账号：只看认证文件与退出标记是否存在，不读取内容；站点只在用户显式声明 `CODEBUDDY_INTERNET_ENVIRONMENT` 时显示，否则显示“站点未公开”。账号绑定由站点声明与原生模型目录摘要组成，站点或账号切换导致目录变化时旧目录与偏好失效。
- 共享 runner `native-acp.mjs` 增加三个由 runner 设置控制的可选行为（默认关闭）：审批请求补全工具标题、拒绝即结束本轮、`default` 强度显式选择原生默认值。
- 中英文别名、品牌图标、设置页条目、遥测上下文、README 与设计文档同步。

## 范围外事项

- 企业域与 iOA 的真实验收（PRD 允许记为未验证）。
- 国际站真实任务：本机账号只登录了一个站点，切换站点需用户在原生终端重新登录，记为待用户操作。
- 读取认证文件中的 `auth.domain` 显示站点：需用户另行批准（已向协调会话提问）。
- Windows 真实验收：本期只做离线回归与发现逻辑。
- 积分计费回执：CodeBuddy ACP 不提供每轮积分，保持未公开。
- WorkBuddy、TRAE、豆包：分别在其他变更中处理。

## Capabilities

### New Capabilities

- `codebuddy-cli`：CodeBuddy Code 的身份、发现、账号与站点、模型与强度、权限三档、ACP 会话、审批与拒绝结束、遥测、图标与验证边界。

### Modified Capabilities

- `worker-run-outcomes`：新增“原生拒绝即结束本轮”的终态规则（只对 runner 声明的 CLI 生效）。
- `native-permission-relay`：新增审批请求缺少标题时从同一工具调用的事件补全的规则。

## Impact

- 共享：`src/shared/types.ts`、`worker-permissions.ts`、`conversation-features.ts`、`account-links.ts`。
- Host：`routing.ts`、`index.ts`、`process.ts`、`adapters.ts`、`accounts.ts`、`cli-account-binding.ts`、`authorized-catalog.ts`、`runtime.ts`、`native-worker.ts`、`native-bridge.mjs`、`native-acp.mjs`（可选行为）、`native-attachments.mjs`、`native-harness-injection.mjs`、`cli-native-capabilities.mjs`、`telemetry.ts`、`windows-cli-installation.ts`。
- 新文件：`src/host/native-codebuddy.mjs`、`src/host/codebuddy-catalog.mjs`、`src/host/codebuddy-account.ts`、`src/client/assets/codebuddy.png`、`doc/assets/cli-icons/v5-codebuddy/`、`doc/codebuddy-protocol.md`。
- Client：`icons.tsx`、i18n 文案。
- 构建：`scripts/build.mjs` 运行资源清单。
- 不改动其他 CLI 的行为；共享 runner 的新行为默认关闭。
