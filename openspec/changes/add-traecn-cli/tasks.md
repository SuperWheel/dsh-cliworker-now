# Tasks

## 0. 调研与形态判定

- [x] 0.1 核对安装版身份、帮助与账号命令（2026-11-07，macOS，traecli 0.213.1）
  - `which traecli` → `~/.local/bin/traecli`；`~/.local/bin` 下 `traecli`、`trae-cli`、`trae-agent`、`coco`、`ta` → `traex` → `../share/traecli/current/traex`（`releases/0.213.1-aarch64-apple-darwin`）。
  - `traecli --version` → `traecli 0.213.1` / `installation: public`；`login status` → `Logged in using Trae`，退出 0。
  - 临时 `TRAE_HOME`：`login status` → `Not logged in`，退出 1；`models --json` → `[]`，退出 0；目录只生成 `cli/tmp/arg0`，确认凭据根为 `$TRAE_HOME/cli/`。
  - `auth.json` 只看结构（不看值）：`auth_mode`、`last_refresh`、`trae.{access_token,user_id,user_name,expires_at,region,refresh_token,oauth_client_id,personal_device,version,login_method,credential_kind,endpoints}`。
  - `--permission-mode plan` 与未知值启动即报 `invalid value`（退出 2）；`auto`、`bypass_permissions` 启动后 `currentModeId` 与之相同。`--no-daemon` 不能用于 ACP（报 only supported for interactive）。
- [x] 0.2 ACP 握手与事件（元数据与真实任务，模型 `glm-5.3-flash`，用户已批准）
  - `initialize`：`agentInfo.name: traecli-acp`、`loadSession: true`、`sessionCapabilities` list/fork/resume/close/additionalDirectories、MCP 仅 http、`_meta.steering.supported: true`、`_meta.trae.acpBackend: legacy`。
  - `session/new`：4 种模式与 `mode`/`model` 配置项、18 个模型；`set_config_option mode=plan` → `current_mode_update: plan` 与回执 `currentValue: plan`；`set_config_option model` → `config_option_update` 与回执。
  - 真实任务（scratchpad 临时目录 ws1，`--permission-mode default`）：读 `seed.txt`、写 `notes.txt`、执行 `echo probe > cmd.txt`。事件：`agent_thought_chunk`、`agent_message_chunk`（带 `messageId`）、`tool_call`（`kind` read/edit/execute，执行类 `rawInput.command` 为 `['/bin/zsh','-lc',…]`）、`tool_call_update`（completed）、`usage_update`（used/size）；回执 `stopReason: end_turn`、`usage` 与 `_meta._trae/tokenUsage`。产物：`notes.txt` = `ok`、`cmd.txt` = `probe`；退出码 0。
  - 续聊：新进程 `session/load` 先重放上一轮（user/tool/agent 块），再回执；随后 prompt 正确回答上一轮写入内容，`end_turn`。
  - 停止：6 s 后 `session/cancel` → `stopReason: cancelled`，usage 全零；`late.txt` 未生成；进程退出 0，无残留 `traex`/`sleep`。
  - 分支：`session/fork` 返回新 ID，`session/close` 回执 `{}`；`session/load` 新 ID 重放 3 条用户消息，确认带历史。
  - 每次探测后 `pgrep traex` 无残留；`current` 链接仍为 0.213.1。
- [x] 0.3 形态判定、调研表与权限决定写入 proposal.md 与 design.md

## 1. OpenSpec 变更

- [x] 1.1 proposal、design、`traecn-cli` 规格与 `worker-permission-levels` 增量；`pnpm spec status --change add-traecn-cli` 与 `pnpm spec:check` 通过
  - `pnpm spec status --change add-traecn-cli`：4/4 artifacts complete；`pnpm spec validate add-traecn-cli --strict`：valid；`pnpm spec:check`：57 passed, 0 failed（2026-11-07）。

## 2. 注册与发现

- [x] 2.1 `CLI_IDS`/标签/短名、配置项 `traecnExecutable`、transport `traecn-acp-v1`、runner 映射、构建资源、别名与泛称路由
- [x] 2.2 只认 `traecli` 的发现、macOS `~/.local/bin` 补查、`--version` 身份核对（自动与手动路径）、Windows 缺失提示

## 3. 账号与目录

- [x] 3.1 `login status` 解析、三种登录 provider、退出、登录域名白名单、单账号
- [x] 3.2 `auth.json` 主体摘要绑定（不读令牌），换号后目录失效
- [x] 3.3 `models --json` 目录：先查登录，未登录与已登录空列表分别报错；不提供强度

## 4. 权限与 runner

- [x] 4.1 三档映射（无询问档、仅工作区编辑 = `default`、完全权限 = `bypass_permissions`）、规划模式 `plan`、仅可查看拒绝
- [x] 4.2 `native-traecn.mjs`：argv、身份、模型/模式确认、审批转交、用量、分支
- [x] 4.3 共享 runner 可选项 `deniedCancelEndsTurn`、`modeLabel`（默认关闭）

## 5. 界面与其他入口

- [ ] 5.1 图标素材目录与运行图、`icons.tsx`
- [x] 5.2 设置页文案与 i18n、附件、原生能力与 skill 路径、遥测白名单

## 6. 自动化检查

- [x] 6.1 回归：身份核对（同名链接）、未登录空列表、权限映射（含拒绝询问档）、工作区外审批转交、拒绝结束本轮、取消、恢复、规划模式、遥测
- [x] 6.2 `pnpm typecheck`、关联 vitest、`pnpm build:preview`
  - 2026-11-07：`corepack pnpm typecheck` 通过（Host/Client，DSH 0.2.2-rc.1）。首次因工作树缺少生成的 `lib/typert.remote-client.d.ts` 失败；隔离 preview 构建后将其生成的 `lib/` 复制到当前隔离工作树，重跑通过，没有更新 Desktop 链接。
  - `corepack pnpm build:preview` 通过；包含 `lib/native-traecn.mjs`。没有运行正式 `pnpm build`。
  - `corepack pnpm test <以下 35 个文件>`：35 文件、1,420 测试通过。包括指定关联回归、所有包含 `CLI_IDS` 的既有测试，以及新 runner 选项、遥测、Windows 发现、原生模型菜单测试。首次关联回归 1,400 通过 / 5 失败；修正 TRAE 空目录加载 UI 与 CLI_IDS 夹具后最终全部通过。
  - `corepack pnpm spec validate add-traecn-cli --strict --no-interactive` 通过；实现项共 15/22 完成，保留真实验收、图标及文档项给负责会话核验，不归档。
  - pnpm 11 的 `test -- <文件>` 会把字面量 `--` 传入 Vitest，导致文件过滤失效；首次发现扫描了范围外测试后立即中止，未将该次计入结果。最终使用 `corepack pnpm test <文件>` 传递同一文件列表。
  - 模拟 ACP 进程核对退出；无真实 CLI、登录/退出、凭据读取或模型调用。Windows 仅模拟发现与平台无关账号来源测试，不是 Windows 实机验收。

  关联文件（均在 `tests/`）：
  - `account-terminal.test.tsx`
  - `authorized-catalog.test.ts`
  - `cli-account-binding.test.ts`
  - `cli-executable-paths.test.ts`
  - `cli-settings.test.ts`
  - `dispatch-storage.test.ts`
  - `extended-integration.test.ts`
  - `harness-reasoning-records.test.tsx`
  - `native-acp-traecn-options.test.ts`
  - `native-cli-model-directory.test.ts`
  - `native-fork.test.ts`
  - `native-qoder.test.ts`
  - `native-runtime.test.ts`
  - `native-traecn.test.ts`
  - `panel.test.tsx`
  - `qoder-integration.test.ts`
  - `qoder-routing.test.ts`
  - `qodercn-accounts.test.ts`
  - `qodercn-integration.test.ts`
  - `qodercn-telemetry.test.ts`
  - `routing.test.ts`
  - `running-message-settings.test.ts`
  - `runtime-account-isolation.test.ts`
  - `settings-dialog.test.tsx`
  - `settings-display-cache.test.ts`
  - `storage.test.ts`
  - `traecn-accounts.test.ts`
  - `traecn-integration.test.ts`
  - `traecn-telemetry.test.ts`
  - `windows-accounts.test.ts`
  - `windows-cli-resolution.test.ts`
  - `worker-fork.test.ts`
  - `worker-goals.test.ts`
  - `worker-management.test.ts`
  - `worker-permissions.test.ts`


## 7. 真实验收（macOS，`glm-5.3-flash`）

- [ ] 7.1 临时目录：读文件、写文件、续聊、停止（核对事件、退出状态、产物、进程退出）
- [ ] 7.2 用户目录下自建、测完即删的目录：工作区外审批允许与拒绝各一次
- [ ] 7.3 规划模式一次（确认 `plan` 且未改文件）
- [ ] 7.4 Desktop 加载 preview 包、连接页与图标明暗（未执行则保留为未验证）
- [ ] 7.5 Windows 发现与初始化（本期未执行，保留为未验证）

## 8. 文档

- [ ] 8.1 README、README.en、AGENTS.md、usage-details（中英）、design.md、`doc/traecn-protocol.md`

## 共享改动

| 文件 | 本次追加 |
| --- | --- |
| `src/shared/types.ts` | 追加 traecn ID、TRAE CLI CN 标签、短名。 |
| `src/shared/worker-permissions.ts` | 追加无询问档、仅工作区编辑的权限菜单；保留已有规划默认路径。 |
| `src/shared/account-links.ts` | 追加三个登录域名和单账号入口；不加入 guided。 |
| `src/shared/conversation-features.ts` | 追加最新轮 fork 和 transport；更早轮分支不支持。 |
| `src/shared/models.ts` | 仅 traecn 空强度目录接受 default 内部哨兵，不虚构强度。 |
| `src/shared/native-usage-report.ts` | 追加 reported 输入口径，保留回执缓存/思考字段、不累计成积分。 |
| `src/shared/running-message.ts` | 仅注释说明 traecn 不加入未实测 steering。 |
| `src/host/index.ts` | 追加配置默认、仅可查看专用拒绝提示、无强度目录选型哨兵。 |
| `src/host/process.ts` | 追加配置字段/default traecli、原生 .trae 目录保护。 |
| `src/host/adapters.ts` | 追加只找 traecli 的发现/身份确认、元数据目录、native-only 参数与协议分派。 |
| `src/host/windows-cli-installation.ts` | 追加 Windows 共享 PATH 命令名 traecli。 |
| `src/host/accounts.ts` | 追加 TRAE 状态、登录/退出动作、provider 必选、原生终端 argv、身份不符提示。 |
| `src/host/account-guide/providers.ts` | 追加个人、企业 SSO、企业 PAT 三项。 |
| `src/host/cli-account-binding.ts` | 追加 64 KiB no-follow 主体字段摘要；路由环境只保留摘要。 |
| `src/host/authorized-catalog.ts` | 仅注释：TRAE 使用普通前后绑定检查，不复用 Qoder SDK 快照。 |
| `src/host/settings-catalog-cache.ts` | 仅注释：TRAE 缓存继续核对文件绑定。 |
| `src/host/native-worker.ts` | 追加 traecn-acp-v1。 |
| `src/host/native-bridge.mjs` | 追加 TRAE runner/fork 自动分派入口。 |
| `src/host/native-acp.mjs` | 仅追加默认关闭的 deniedCancelEndsTurn、modeLabel；其他 CLI 保持原有逻辑。 |
| `src/host/runtime.ts` | 追加普通执行和 fork 的 TRAE 环境；注明 Qoder 规划拒绝不适用。 |
| `src/host/native-attachments.mjs` | 追加 TRAE 附件支持；图片仍依 ACP 能力确认。 |
| `src/host/cli-native-capabilities.mjs` | 追加原生能力和用户/项目的 .trae/skills、.agents/skills 路径。 |
| `src/host/native-harness-injection.mjs` | 仅注释：TRAE HTTP MCP 名称替换语义未核实，不加入注入。 |
| `src/host/telemetry.ts` | 追加两个 TRAE 回执白名单与 CLI/session/model/source 隔离。 |
| `src/host/native-supplemental-context.ts` | 仅注释：不把 TRAE 接到 Qoder 日志比例读取。 |
| `src/host/harness-turn-usage.ts` | 仅注释：TRAE 使用 token 回执，不使用 Qoder Credits。 |
| `src/host/routing.ts` | 追加所有指定 TRAE 别名；泛称直接命中 traecn。 |
| `src/client/i18n-messages.ts` | 追加 25 条中文源文案的英文映射。 |
| `src/client/settings-dialog.tsx` | 仅 TRAE 空强度目录允许保存 default，并隐藏强度控件、显示目录说明。 |
| `src/client/native-cli-model-directory.ts` | 仅 TRAE 允许无强度模型选择，保存 default 哨兵。 |
| `src/client/worker-model-menu.tsx` | 仅 TRAE 无强度模型可保存，移除强度菜单项。 |
| `src/client/telemetry.tsx` | 仅注释：TRAE 不走积分显示。 |
| `scripts/build.mjs` | 追加 native-traecn 运行资源。 |

新增实现：`src/host/traecn-accounts.ts`、`src/host/traecn-executable.ts`、`src/host/native-traecn.mjs`。

新增模拟测试：`tests/traecn-integration.test.ts`、`tests/native-traecn.test.ts`、`tests/traecn-accounts.test.ts`、`tests/native-acp-traecn-options.test.ts`、`tests/traecn-telemetry.test.ts`，以及 `tests/fixtures/traecn-acp.ts` / `traecn-metadata.ts`。

既有测试追加：`worker-permissions.test.ts`、`cli-account-binding.test.ts`、`native-cli-model-directory.test.ts`、`runtime-account-isolation.test.ts`、`windows-accounts.test.ts` 与 `fixtures/legacy-runtime.ts`，只补 TRAE 无强度/原生传输/来源夹具。

图标、assets、README 与 doc/ 由其他 Agent 负责；本次代码实施未修改这些路径。未提交、未推送、未运行 traecli update。第 7 节真实验收尚未执行，变更保持未归档。
