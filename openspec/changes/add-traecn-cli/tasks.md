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

- [x] 5.1 图标素材目录与运行图、`icons.tsx`
  - `doc/assets/cli-icons/v5-trae/`：官方 favicon（trae.com.cn CDN，48×48）、manifest、README、preview.html/png；运行图 `src/client/assets/traecn.png`，`icons.tsx` 彩色、缩放 0.8。Desktop 中实际显示未验证（见 7.4）。
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

验收方式：`.test-data/traecn-accept/run.ts`（不入 Git）直接加载 `pnpm build:preview` 产出的隔离包 `.cache/preview-package`，用真实 `WorkerRuntime` + 本机原生子进程后端跑 traecli 0.213.1；`TRAE_HOME` 不改（用户已登录的个人账号），独立状态目录，权限快照固定为「仅工作区编辑」（`workspace-write`），审批处理器按预设队列回答并记录请求。模型只用 `glm-5.3-flash`。证据目录 `.test-data/traecn-accept/run-193537/`（全量）与 `run-193930/`（修正脚本后重跑规划与停止），各含 `report.json`、`state/*.events.jsonl` 与原生 ACP 流 `*.raw.jsonl`。

- [x] 7.1 临时目录：读文件、写文件、续聊、停止（核对事件、退出状态、产物、进程退出）
  - 目录：18 个模型、含 `glm-5.3-flash`，每个模型强度只有原生默认，notice「TRAE CLI CN 原生账号模型目录；不提供强度选择」。
  - 读写：`Read seed.txt` 与 `Edit …/notes.txt` 两个工具均 RUNNING→COMPLETED，回复含随机 nonce，`notes.txt` 实际内容 `ok`，Worker `completed`，transport `traecn-acp-v1`，会话 ID 已记录；结束后 `pgrep traex` 为空。
  - 续聊：同一会话 ID（新进程 `session/load`），回复仍含 nonce；本轮事件中没有上一轮工具或正文的重放，`completed`。
  - 停止（run-193930）：`sleep 60 && echo late > late.txt` 工具 RUNNING 后调用 `runtime.stop`，原生回执 `stopReason: cancelled`（usage 全零，未报告为用量），工具 FAILED，Worker `interrupted`/「已停止」，没有显示为成功；3 s 后 `late.txt` 不存在，`pgrep traex`、`pgrep 'sleep 60'` 均为空。
  - 首次（run-193537）停止步骤脚本按整个 Worker 历史判断“工具已运行”，在新一轮排队时就停了（仍正确显示已停止、无残留），不算有效证据；改为只看本轮新事件后重跑通过。
- [x] 7.2 用户目录下自建、测完即删的目录：工作区外审批允许与拒绝各一次
  - 目录 `~/cliworker-traecn-accept-e667c2`（0700，脚本 `finally` 删除，`outsideRemoved: true`，事后 `ls` 确认不存在）；没有用 `/tmp`。
  - 允许：TRAE 发出 `session/request_permission`，DSH 侧收到 `{kind: file, summary: "Edit …/allow.txt", allowSession: false}`，回答允许一次 → 事件「CLI 请求授权」「授权决定：允许一次（DSH 用户）」「CLI 额外权限请求已批准」，工具 COMPLETED，`allow.txt` 实际内容 `yes`，Worker `completed`。
  - 拒绝：同样转交一次，回答拒绝 → 「授权决定：拒绝（DSH 用户）」「CLI 额外权限请求已拒绝」，工具 FAILED；TRAE 以 `cancelled` 结束本轮，`deniedCancelEndsTurn` 生效：结果 SUCCESS + 诊断「本轮结果说明：因拒绝审批而结束：被拒操作未执行，可续聊继续」，Worker `completed`（不是已取消或 CLI 错误）；`deny.txt` 不存在。随后同一 Worker 继续规划与停止两轮，确认可续聊。
  - 两次授权请求都只出现一次，没有重复弹出。
- [x] 7.3 规划模式一次（确认 `plan` 且未改文件）
  - run-193930：先 `configureWorkerPermission(…, 'plan')`，再续聊。原生流有 `current_mode_update: plan`，之后才发送 prompt；本轮 `end_turn`，有 usage 回执；`plan.txt` 不存在。
  - TRAE 在规划结束时发出「Implement this plan?」授权请求；runtime 以本轮 `launchMode: plan` 交给审批处理器（真实 Host 的 `decideApproval` 对 plan 一律拒绝，来源 `plan`）。验收脚本的处理器同样回答拒绝，TRAE 随后仍以 `end_turn` 正常结束，没有改文件。
  - 首次（run-193537）规划步骤脚本只给 `submit` 传了 `plan`，续聊沿用 Worker 已保存的模式，原生仍为 `default`（脚本错误，非插件问题），不算证据。
  - 验收脚本的权限快照是固定值，所以状态行显示「本轮权限：仅工作区编辑」；真实 Host 在 plan 时显示「规划模式」（`index.ts` 现有逻辑），未在 Desktop 中目视核对。
- [ ] 7.4 Desktop 加载 preview 包、连接页与图标明暗 —— 未执行，保留为未验证（本会话未打开 Desktop；登录窗口、设置页目录与 Worker 菜单只有模拟测试）
  - 2026-11-07 部分实机：Desktop 0.2.2-rc.1（macOS）正式 `pnpm build`（`feat/general-settings` 07534bb）后重启，内置浏览器直连 Host Web UI；主 Agent（GLM-5.3-Flash）经 CLI Worker 派遣，工作区 `.test-data/CLI Worker Demo`（正式构建，非 preview 包）。设置页条目与图标明/暗、账号区「已登录」、模型列表显示正常；派遣 glm-5.3-flash（无强度选项），「仅工作区编辑」档，SUCCESS，`v088-trae-check.txt` 实际内容为 `TRAE OK\n`，事件含「TRAE CLI CN 原生模型已确认」，结束后无 traecli 残留。登录窗口未在 Desktop 中验证，本项保持未勾选。
- [ ] 7.5 Windows 发现与初始化 —— 部分完成
  - 2026-11-08：新包识别为「未登录」，可点「登录账号」；登录由用户在浏览器完成。
  - 2026-11-09 Windows 实机（DSH Desktop，Codex Computer Use 操作，工作区 `C:\Users\admin\cw081f1\live-codex`）：派遣 glm-5.3-flash，权限「仅工作区编辑」，事件含「TRAE CN 原生模型已确认」，结果 completed，`v088-traecn-win.txt` 实际内容 `hello-traecn-win`。
  - 与 Mac 不同的原生行为（未改）：default 模式在工作区内新建文件也请求审批，经 DSH 审批卡「允许一次」后执行；TRAE 内置 Read 工具对刚建的文件报「不存在」，模型改用 PowerShell 读回。
  - 回复行用量：Host 回执正确（total 43394 / input 42831 / output 563 / reasoning 276），但回复行不显示。原因是插件给出的 `reported` 账单带了缓存字段，DSH 回复行校验拒收整行；78694c1 去掉缓存字段后复测见下。
  - 复测（2026-11-09 20:15 包 `preview-088-20261109-201532.tgz`，activeWorkers=0，安装退出 0，逐文件 1036 个 0 不一致，Desktop 重启）：在同一 Worker 续聊「1+1 等于几」，回复 `1+1 等于 2。`，回复行「用量 10.9K tok」，详情为本轮 10,897 / CLI 报告输入 10,886 / 输出 11（推理 0），缓存命中「—」；较早一轮回复行同时显示「用量 43.4K tok」（43,394 / 42,831 / 563，推理 276）。Worker 底部统计「10.9K tok · 缓存命中 —」。Host `lastRunUsageSnapshot` 为 total 10897 / input 10886 / output 11，与画面一致。画面由 Codex Computer Use（gpt-6.1-sol）截图核对。新增模拟用例覆盖该形状（`tests/traecn-telemetry.test.ts`）。
  - Mac 上同一问题未在 Desktop 复看（7.4）。

未验证与不在本期范围：企业 SSO / 企业 PAT 登录与「套餐不支持 CLI」真实回执（只有夹具）、退出登录的真实执行（未运行，避免影响用户账号）、完全权限（`bypass_permissions`）真实运行、分支 `session/fork` 经插件的真实运行（0.2 只做了原生探测）、附件、运行中引导与 DSH 工具桥（按设计不声明）、强度来源（TRAE 未公开）。

## 8. 文档

- [x] 8.1 README、README.en、AGENTS.md、usage-details（中英）、design.md、`doc/traecn-protocol.md`

## 共享改动

| 文件 | 本次追加 |
| --- | --- |
| `src/shared/types.ts` | 追加 traecn ID、TRAE CLI CN 标签、短名。 |
| `src/shared/worker-permissions.ts` | 追加无询问档、仅工作区编辑的权限菜单；保留已有规划默认路径。 |
| `src/shared/account-links.ts` | 追加三个登录域名和单账号入口；不加入 guided。 |
| `src/shared/conversation-features.ts` | 追加最新轮 fork 和 transport；更早轮分支不支持。 |
| `src/shared/native-usage-report.ts` | 追加 reported 输入口径，保留回执缓存/思考字段、不累计成积分。 |
| `src/shared/running-message.ts` | 仅注释说明 traecn 不加入未实测 steering。 |
| `src/host/index.ts` | 追加配置默认、仅可查看专用拒绝提示。 |
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
| `src/client/telemetry.tsx` | 仅注释：TRAE 不走积分显示。 |
| `scripts/build.mjs` | 追加 native-traecn 运行资源。 |

新增实现：`src/host/traecn-accounts.ts`、`src/host/traecn-executable.ts`、`src/host/native-traecn.mjs`。

新增模拟测试：`tests/traecn-integration.test.ts`、`tests/native-traecn.test.ts`、`tests/traecn-accounts.test.ts`、`tests/native-acp-traecn-options.test.ts`、`tests/traecn-telemetry.test.ts`，以及 `tests/fixtures/traecn-acp.ts` / `traecn-metadata.ts`。

既有测试追加：`worker-permissions.test.ts`、`cli-account-binding.test.ts`、`runtime-account-isolation.test.ts`、`windows-accounts.test.ts` 与 `fixtures/legacy-runtime.ts`，只补 TRAE 原生传输/来源夹具。

复核调整（负责会话，2026-11-07）：实施 Agent 最初为“空强度目录”在 `src/shared/models.ts`、`src/client/settings-dialog.tsx`、`src/client/native-cli-model-directory.ts`、`src/client/worker-model-menu.tsx` 及 `src/host/index.ts` 加了 TRAE 特判；为减少共享改动，已全部撤回，改为沿用现有“只有原生默认”的写法（`discoverTraecnModels` 每个模型 `efforts: ['default']`，同 Kimi OAuth/第一方路线），界面与选型无需改动。撤回后 `pnpm typecheck`、33 个关联测试文件 1,357 项与 `pnpm build:preview` 重新通过。

图标、assets、README 与 doc/ 由文档 Agent 完成并经负责会话复核（提交 786658d）。全程未推送、未运行 `traecli update`、未修改 `traecli.toml`、未读取凭据内容。7.4、7.5 未验证，变更保持未归档。

## v0.8.8 集成验证（2026-11-07）

- [x] 12.1 本变更已按 CodeBuddy → TRAE → 豆包顺序合入 `feat/v0.8.8-integration`，各变更目录保留，未归档。
- [x] 12.2 集成类型检查通过；关联回归 20 文件、804 测试通过；全量 268 文件通过、4 跳过，5,838 测试通过、14 跳过、0 失败。
  - 全量命令：`PATH="$PWD/.cache/bin:$PATH" TMPDIR="$PWD/.cache/neutral-tmp" pnpm test`。工作树内临时目录用空 package.json 隔断仓库包类型；本机监听测试在获准环境完成。
  - 首次生成声明缺失、沙箱 localhost 限制、临时目录包类型问题及精确命令/全部冲突处理，见 [CodeBuddy 集成验证](../add-codebuddy-cli/tasks.md#v088-集成验证2026-11-07)；没有修改既有产品行为来规避环境错误。
  - 未运行真实 CLI、账号/模型调用、Windows 实机或 Desktop 验收；原有未完成/未验证项保留，不因合并而勾选。
  - 共享 ACP 统一为 `deniedCancelEndsTurn`；保留 TRAE `modeLabel` 与原生默认强度模式。

- [x] 12.5 最终 `PATH="$PWD/.cache/bin:$PATH" TMPDIR="$PWD/.cache/neutral-tmp" pnpm build:preview` 通过；产物为本工作树 `.cache/preview-package`，日志 `.cache/integration-validation/preview-final.log`。
- [x] 12.6 `PATH="$PWD/.cache/bin:$PATH" TMPDIR="$PWD/.cache/neutral-tmp" pnpm spec:check`（validate --all --strict --no-interactive）：59 项通过、0 失败；日志 `.cache/integration-validation/spec-final.log`。既有其他变更有归档冲突 INFO，本次不归档，也未处理无关规格。

## 13. v0.8.8 验收缺口复查（2026-11-08）

- [x] 13.1 复查与 CodeBuddy 相同的缺口：TRAE CN 回执带 token、有 `usage_update` 上下文、已支持原生分支，均不需修改；按用户要求保持默认 token 显示，不列入积分计费 CLI（`creditBilledCli('traecn')` 为 false，见 `tests/codebuddy-usage.test.ts`）。见 [fix-v088-cli-gaps](../fix-v088-cli-gaps/tasks.md)。
