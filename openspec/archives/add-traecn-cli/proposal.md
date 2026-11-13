# Proposal

## Why

v0.8.8 要把字节官方 TRAE CLI 2.0（命令 `traecli`）接入为新的 Worker 入口（[v0.8.8 PRD](../../../doc/prd/2026-11-07-v0.8.8-PRD.md) §四.四、需求 5.6、5.7、5.9–5.13）。用户已在本机安装 0.213.1，并经开发中特性用个人账号登录；官方文档写明 TRAE CLI 仅对企业版旗舰版套餐开放。现有 13 个入口中没有 TRAE，且 TRAE 的参数与 Codex CLI 很像，容易被误套 Codex 的协议和权限开关，需要按安装版逐项核对后单独接入。

## 调研表（2026-11-07，macOS，traecli 0.213.1）

来源分四类：**官方文档**（docs.trae.cn）、**本机帮助**（`--help`、`features list`）、**本机实测**（命令、ACP 握手、真实任务，见 tasks.md 0.x）、**PRD 附录 A.3**（同日前置实测）。

| 项目 | 结论 | 来源 |
| --- | --- | --- |
| 发布方与包 | 字节 TRAE CLI 2.0，原生二进制 `~/.local/share/traecli/current/traex`（362 MB，arm64）；npm 无对应包 | 官方文档、本机 |
| 命令名 | 官方命令 `traecli`。安装脚本在 `~/.local/bin` 另建 `trae-cli`、`trae-agent`、`coco`、`ta`，都链接到 `traex`；`trae-cli` 与开源 bytedance/trae-agent（Python）同名 | 官方文档、本机 |
| 身份确认 | `traecli --version` 输出 `traecli 0.213.1` 与 `installation: public`；ACP `initialize` 的 `agentInfo.name` 为 `traecli-acp` | 本机实测 |
| 安装 | `sh -c "$(curl -fsSL https://trae.cn/trae-cli/install_v2.sh)"`（Windows `install_v2.ps1`）；境外出口返回 403 `denied by region block` | 官方文档、PRD A.3 |
| 国内版与国际版 | 只找到国内版；docs.trae.ai 没有 TRAE CLI 页面。判定：**只接国内版，一个 CliId `traecn`**；国际版不提供入口 | 官方文档站（2026-11-07） |
| 使用门槛 | 官方：仅企业版旗舰版套餐。实测：个人账号经开发中特性登录后可执行真实任务 | 官方文档、PRD A.3 |
| 配置根 | `TRAE_HOME`（默认 `~/.trae`），运行数据与凭据在 `$TRAE_HOME/cli/`（`auth.json` 0600）；配置文件 `$TRAE_HOME/traecli.toml` | 官方文档、本机实测（临时 `TRAE_HOME` 只生成 `cli/`） |
| 登录 | `traecli login status`（已登录 `Logged in using Trae` 退出 0；未登录 `Not logged in` 退出 1，不区分个人与企业）；个人 `traecli --enable personal_user_login login --personal`（特性 under development，`--enable` 只对当次命令生效）；企业 SSO `traecli login --enterprise`；企业 PAT `traecli login --with-trae-pat`（读 `TRAECLI_PERSONAL_ACCESS_TOKEN`，未设置时读 stdin）；退出 `traecli logout` | 本机帮助、本机实测 |
| 非交互与流 | 选用 ACP：`traecli --permission-mode <mode> acp serve`（stdio JSON-RPC）。`exec --json` 不用 | 本机实测 |
| 会话 | `initialize`：`loadSession: true`，`sessionCapabilities` 含 list、fork、resume、close、additionalDirectories；`session/new` 返回会话 ID；`session/load` 先重放历史（`user_message_chunk`、`tool_call`、`agent_message_chunk`）再回执；`session/fork` 返回带历史的新会话 ID | 本机实测 |
| 模型与强度 | 模型来自 ACP `model` 配置项（`modelId` 等于 `traecli models --json` 的 `config_name`，默认 `Doubao-Seed-Code`，共 18 个），`session/set_config_option` 切换并回执；ACP 不返回强度，模型 `_meta.trae` 只有 `supportsMaxMode`；`-c model_reasoning_effort` 无可见效果。**不提供强度选择** | 本机实测 |
| 权限 | `--permission-mode` 只接受 `default`、`auto`、`bypass_permissions`（`plan` 与未知值启动即报错）；带该参数时 `session/new` 才返回 `modes` 与 `mode` 配置项：`default`（Workspace Edit）、`plan`、`auto`（自动审查子 Agent 代批）、`bypass_permissions`（Full Access）。`default` 下工作区内读写与命令、`/tmp` 都自动批准，只有工作区外才发 `session/request_permission`（选项 `approved`/`abort`），拒绝后工具 failed、本轮 `cancelled`。`-a untrusted` 被拒绝，`-s/-a` 被 `--permission-mode` 覆盖 | 本机帮助、PRD A.3 |
| 规划模式 | ACP 模式 `plan`：以 `default` 启动后用 `session/set_config_option mode=plan` 切换，回执 `current_mode_update` 与 `currentValue: plan` | 本机实测 |
| 工具与扩展 | 原生读写、命令（`/bin/zsh -lc`）、联网、子 Agent（`multi_agent` 默认开）、记忆（`$TRAE_HOME/cli/memories_1.sqlite`）、skills（`~/.trae/skills`、`~/.agents/skills`）、MCP（ACP 只声明 http；`_meta.trae.options.mcpServers` 声明取值为“已配置的 MCP 服务名”、语义为替换） | 本机实测、程序字符串 |
| 用量 | `session/prompt` 回执 `usage`（input/output/total/thought/cachedRead/cachedWrite）与 `_meta["_trae/tokenUsage"]`（turn、sessionTotal、last、contextWindow）；`usage_update` 给 `used`/`size`；取消时为全零 | 本机实测 |
| 副作用 | 程序含 `in_app_updates`（stable，默认开）与 `traecli update`；本期所有探测与真实任务后 `~/.local/share/traecli/current` 仍指向 0.213.1。插件不调用 `update` | 本机实测 |

立项条件（接入流程 1.5 节）均满足：有结构化 ACP 流、真实会话 ID 与 `session/load`、`session/cancel` 后本轮以 `cancelled` 结束且进程随 stdin 关闭退出、登录走 CLI 原生浏览器流程。

## What Changes

- 新增 CliId `traecn`（名称「TRAE CLI CN」，短名 `traecn`），配置项 `traecnExecutable`（默认 `traecli`），transport `traecn-acp-v1`，runner `native-traecn.mjs` 复用 `runNativeAcp`。
- 发现：只认 `traecli`，macOS 补 `~/.local/bin`；自动发现与手动路径都以 `--version` 确认身份，不认 `trae-cli`/`trae-agent` 等同名程序。
- 账号：状态读 `traecli login status`；登录窗口提供个人账号（标注依赖开发中特性）、企业 SSO、企业 PAT 三种原生登录；退出走 `traecli logout`。来源绑定取 `auth.json` 中的稳定主体字段摘要，不碰令牌。
- 模型：先确认已登录，再读 `traecli models --json`；空列表在已登录时报“暂无可确认模型”，未登录时报未登录。不提供强度。
- 权限：不提供「询问」档；中档「仅工作区编辑」映射原生 `default`（工作区外请求转 DSH 审批）；完全权限映射 `bypass_permissions`；规划模式映射 ACP 模式 `plan`。仅可查看且未选档位时拒绝派遣。
- 共享 runner 增加两项默认关闭的选项：拒绝审批后 CLI 以 `cancelled` 结束本轮时显示“因拒绝审批而结束”；降级诊断使用 CLI 自己的档位名称。
- 别名、图标、设置页、i18n、遥测白名单、文档与回归按接入流程附录 B 补齐。

## 范围外

- TRAE 国际版（未发现官方 CLI）、开源 bytedance/trae-agent、TRAE CLI 1.0、TRAE IDE/SOLO 的借用登录。
- `traecli update` 与任何自动升级；修改用户 `traecli.toml`。
- 强度选择（核实前不提供）；运行中引导（`_meta.steering` 已声明但未实测）；DSH 工具桥注入（ACP `mcpServers` 语义与标准不同，待核实）。
- Windows 实机验证（本期只做源码层面的发现线索与回归，实机记为未验证）。

## Capabilities

### New Capabilities

- `traecn-cli`：TRAE CLI CN 的身份与发现、原生账号、模型目录、ACP 会话、权限映射、审批转交与验证边界。

### Modified Capabilities

- `worker-permission-levels`：三档菜单加入 TRAE CLI CN 的命名（不显示第一项，中档叫「仅工作区编辑」）。

## Impact

- Shared：`types.ts`、`worker-permissions.ts`、`conversation-features.ts`、`account-links.ts`、`native-usage-report.ts`、i18n。
- Host：`routing.ts`、`index.ts`、`process.ts`、`adapters.ts`、`accounts.ts`、`account-guide/providers.ts`、`cli-account-binding.ts`、`native-worker.ts`、`native-bridge.mjs`、`native-acp.mjs`（可选项）、新增 `native-traecn.mjs`、`traecn-accounts.ts`、`runtime.ts`、`telemetry.ts`、`native-attachments.mjs`、`cli-native-capabilities.mjs`。
- Client：`icons.tsx` 与运行图；构建：`scripts/build.mjs`。
- 不改 Harness 核心、不升版本、不推送发布；真实任务只用用户批准的 `glm-5.3-flash`。
