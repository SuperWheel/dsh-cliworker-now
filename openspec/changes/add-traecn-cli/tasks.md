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

- [ ] 2.1 `CLI_IDS`/标签/短名、配置项 `traecnExecutable`、transport `traecn-acp-v1`、runner 映射、构建资源、别名与泛称路由
- [ ] 2.2 只认 `traecli` 的发现、macOS `~/.local/bin` 补查、`--version` 身份核对（自动与手动路径）、Windows 缺失提示

## 3. 账号与目录

- [ ] 3.1 `login status` 解析、三种登录 provider、退出、登录域名白名单、单账号
- [ ] 3.2 `auth.json` 主体摘要绑定（不读令牌），换号后目录失效
- [ ] 3.3 `models --json` 目录：先查登录，未登录与已登录空列表分别报错；不提供强度

## 4. 权限与 runner

- [ ] 4.1 三档映射（无询问档、仅工作区编辑 = `default`、完全权限 = `bypass_permissions`）、规划模式 `plan`、仅可查看拒绝
- [ ] 4.2 `native-traecn.mjs`：argv、身份、模型/模式确认、审批转交、用量、分支
- [ ] 4.3 共享 runner 可选项 `deniedCancelEndsTurn`、`modeLabel`（默认关闭）

## 5. 界面与其他入口

- [ ] 5.1 图标素材目录与运行图、`icons.tsx`
- [ ] 5.2 设置页文案与 i18n、附件、原生能力与 skill 路径、遥测白名单

## 6. 自动化检查

- [ ] 6.1 回归：身份核对（同名链接）、未登录空列表、权限映射（含拒绝询问档）、工作区外审批转交、拒绝结束本轮、取消、恢复、规划模式、遥测
- [ ] 6.2 `pnpm typecheck`、关联 vitest、`pnpm build:preview`

## 7. 真实验收（macOS，`glm-5.3-flash`）

- [ ] 7.1 临时目录：读文件、写文件、续聊、停止（核对事件、退出状态、产物、进程退出）
- [ ] 7.2 用户目录下自建、测完即删的目录：工作区外审批允许与拒绝各一次
- [ ] 7.3 规划模式一次（确认 `plan` 且未改文件）
- [ ] 7.4 Desktop 加载 preview 包、连接页与图标明暗（未执行则保留为未验证）
- [ ] 7.5 Windows 发现与初始化（本期未执行，保留为未验证）

## 8. 文档

- [ ] 8.1 README、README.en、AGENTS.md、usage-details（中英）、design.md、`doc/traecn-protocol.md`

## 共享改动

（实施时逐项记录对共享文件的改动，供合并会话核对。）
