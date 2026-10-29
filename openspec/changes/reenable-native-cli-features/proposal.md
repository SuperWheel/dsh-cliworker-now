## Why

插件在接入部分 CLI 时关闭了一些原生功能。其中一部分有明确理由（两层任务树、账号隔离、权限约束），另一部分是初次接入时的保守设置，源码与文档中没有记录理由。2026-10-28 用户确定「CLI 原生工具优先、DSH 工具作为备选」（`scope-harness-bridge-tools`），被关闭的原生能力越多，CLI 越依赖备选工具，偏离原生体验。用户同意按以下建议重新评估。

现状（源码核实）：

- Grok：`--disable-web-search`、`GROK_WEB_FETCH=0`、`--no-memory`、`--no-subagents`（`src/host/grok-adapter.ts:131-133,164-166`），引入于 `bc69490`，无记录理由。
- OpenCode/MiMo：`OPENCODE_DISABLE_EXTERNAL_SKILLS=1`、`OPENCODE_DISABLE_PROJECT_CONFIG=1`、`OPENCODE_DISABLE_CLAUDE_CODE=1`、`plugin: []`、`mcp: {}`，且 `XDG_CONFIG_HOME` 指向插件私有目录（`opencode-adapter.ts:92-124`）。
- Pi：`--tools` 白名单为 read/grep/find/ls（写任务加 write/edit），无 bash（`pi-omp-bridge.mjs:419-421`）；OMP 同类且 `approvalMode: 'write'`（`:300`）。
- ZCode：禁用 Agent、Task、Skill、工作流等（`zcode-adapter.ts:30-48`）。
- Hermes、OMP：关闭记忆（`native-hermes-home.mjs:276`、`pi-omp-bridge.mjs:299`）。

## What Changes

**本次重新启用：**

- Grok 网页搜索与网页抓取：去掉 `--disable-web-search` 与 `GROK_WEB_FETCH=0`。规划模式与仅可查看下照样可用（只读能力）。
- OpenCode/MiMo 用户 skill：让 CLI 读取用户自己的原生 skill（OpenCode 自身 skill 目录及其兼容的外部 skill 目录，以实际版本行为为准）；账号相关的 provider 配置与外部插件仍隔离。
- Pi 的 bash：跟随 DSH 权限预设——完全权限下启用 Pi 原生 bash；工作区内修改与仅可查看下不启用 Pi 原生 bash（Pi 没有可接 DSH 审批的原生审批协议），由 DSH 命令执行工具作为备选提供，经宿主沙箱与审批执行（`scope-harness-bridge-tools` 能力表自动处理）。OMP 原生 `approvalMode` 能否接 DSH 审批先核实，能则按同样规则启用，不能则同 Pi。

**保留（账号隔离类）：** 外部插件、项目级/全局 provider 配置导入、导入其他 CLI 配置与凭据的入口（OpenCode `OPENCODE_DISABLE_CLAUDE_CODE`、OMP `disabledProviders`、Hermes `plugins`、Pi/OMP `--no-extensions`）。LSP 保持关闭。

**用户决定（2026-10-29）：**

- CLI 内部子 Agent（Grok subagents、ZCode Agent/Task/工作流，及随之关闭的 ZCode Skill）：不启用，按两层任务树保留关闭。Claude Task 与 Codex 多 Agent 不在本次调整。
- CLI 记忆：跟随用户原生 CLI 的设置——用户开过就启用，没设置过就取该 CLI 默认值（Grok、ZCode 默认关，Hermes 默认开）。启用时 Worker 与用户直接使用该 CLI 共用同一份原生记忆，不复制。ZCode 记忆（原清单漏列）一并处理。OMP 记忆保持关闭：它按 Worker 私有、含账号的会话库整理并整份重写记忆文件，共用会互相覆盖。

## Capabilities

### New Capabilities

- `cli-native-features`：插件对 CLI 原生功能的启用与关闭规则，以及关闭的理由类别。

### Modified Capabilities

（无）

## Impact

- Host：`grok-adapter.ts`、`opencode-adapter.ts`（及 MiMo 对应配置）、`pi-omp-bridge.mjs` 的启动参数；与 `relay-native-approvals-to-host`（读取 DSH 预设）、`scope-harness-bridge-tools`（能力表）联动。记忆：`cli-native-capabilities.mjs`（原生开关读取与记忆目录链接）、`grok-adapter.ts`、`native-hermes-home.mjs`、`zcode-adapter.ts`、`native-zcode.mjs`。
- 测试：各 adapter 参数测试。
- 文档：README 支持范围中各 CLI 的已关闭功能及理由。
