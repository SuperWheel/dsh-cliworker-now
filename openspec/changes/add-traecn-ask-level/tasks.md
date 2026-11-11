## 0. 前置调研（无模型调用）

- [x] 0.1 核对 TRAE 原生沙箱与审批开关
  - 2026-11-10，traecli 0.213.1：`--help` 有 `-s/--sandbox`、`-a/--ask-for-approval on-request|never`；自带文档 `permissions.md` 列出 `sandbox_mode`、`approval_policy`、`approvals_reviewer = "user"`。
- [x] 0.2 验证询问档参数能启动并建会话
  - 探测脚本在会话草稿目录 `trae-probe/start.mjs`（不进 Git）。`-c sandbox_mode="read-only" -c approval_policy="on-request" -c approvals_reviewer="user" acp serve`：`session/new` 返回会话 ID，`configOptions` 只有 `model`，无 `modes`。
- [x] 0.3 验证互斥与取值校验
  - 加 `--permission-mode default`：退出 1，`` `sandbox_mode` and `permission_mode` overrides cannot both be set ``。
  - `approvals_reviewer="bogus"`：退出 1，`expected one of user, auto_review, guardian_subagent`。
- [x] 0.4 验证用户配置不冲突
  - 临时 `TRAE_HOME/traecli.toml` 分别写 `permission_mode = "bypass_permissions"`、`sandbox_mode = "danger-full-access"`：`-c` 启动均正常，进入 `Authentication required`（临时目录未登录），无配置冲突错误。

## 1. 实施

- [x] 1.1 `worker-permissions.ts`：TRAE 增加「询问」，改写「仅工作区编辑」说明
  - `LEVELS.traecn.ask = ASK`；`runsUnderViewOnly('traecn')` 随之为 true；`index.ts` 删除仅可查看下的 TRAE 专属拒绝；`i18n-messages.ts` 同步译文、删除两条失效文案。
- [x] 1.2 `native-traecn.mjs`：询问档 argv 与 `editMode`
  - 导出 `TRAECN_ASK_OVERRIDES`；询问档 `editMode` 为 `undefined`，共享 runner 跳过模式块。
- [x] 1.3 `adapters.ts`：去掉询问档报错

## 2. 自动检查

- [x] 2.1 单元测试：三档 argv、询问档不传 `--permission-mode`、规划仍走 `default`+`plan`、询问档跳过模式设置
  - `tests/native-traecn.test.ts` 新增 3 条（询问档 argv 与只设 model；询问档审批允许/拒绝转交 DSH，拒绝显示“因拒绝审批而结束”）；模拟 ACP 夹具在 `-c` 启动时不返回 modes（与 0.213.1 实测一致）。均为模拟，不是真实 CLI。
- [x] 2.2 单元测试：TRAE 菜单三档、仅可查看下可派遣、派遣回执文案
  - `tests/worker-permissions.test.ts` 两条改写：菜单为「询问」「仅工作区编辑」「完全权限」；仅可查看下未选档不拒绝、当前档为 ask、可保存 ask。
  - TRAE 相关 7 个文件（native-traecn、worker-permissions、traecn-integration、native-acp-traecn-options、traecn-accounts、traecn-telemetry、client-i18n）145 条通过（2026-11-10）。
- [x] 2.3 `pnpm typecheck`、关联 vitest、`pnpm spec:check`
  - 2026-11-10：`pnpm typecheck` 通过；全量 `pnpm test` 280 文件通过、4 跳过，6208 条通过、14 跳过；`pnpm build:preview` 通过；`pnpm spec:check` 63 项通过。

## 3. 真实验收（开放条件）

> glm-5.3-flash 被 TRAE 服务端以 400 拒绝（请求带的 `repetition_penalty` 越界，`model_provider` 为 `trae`，与用户配置及插件无关）。2026-11-10 用户同意换模型，3.1–3.3 改用账号默认模型 Doubao-Seed-Code（traecli 0.213.1，macOS，直接启动 `traecli -c sandbox_mode="read-only" -c approval_policy="on-request" -c approvals_reviewer="user" acp serve`，不经插件）。探测脚本与日志在会话草稿目录 `trae-probe/`，不进 Git。

- [x] 3.1 工作区内写文件发出 `session/request_permission`，拒绝后文件不存在，本轮显示“因拒绝审批而结束”
  - 2026-11-10 22:33，Doubao-Seed-Code：写 `probe.txt` 发出 1 次 `session/request_permission`（Edit，选项 `allow_once`/`reject_once`），选 `reject_once` 后 `stopReason: cancelled`，工作区为空。插件侧把拒绝后的 `cancelled` 显示为“因拒绝审批而结束”由模拟测试覆盖，未在 Desktop 实测（见 3.4）。
  - 此前 22:11 glm-5.3-flash 探测：`session/prompt` 返回 `Internal error`，TRAE 服务端 400 `Repetition_penalty should be in (0.0, 2.0]`（重连 5 次均失败），未产生工具调用与审批；工作区为空。阻塞：服务端，用户决定不换模型。
- [x] 3.2 允许后文件按要求写入
  - 2026-11-10 22:33，Doubao-Seed-Code：同一提示 1 次审批，选 `allow_once` 后 `stopReason: end_turn`，`probe.txt` 内容为 `hello-ask-level`。
- [x] 3.3 只读命令（`ls`）不发审批
  - 2026-11-10 22:33，Doubao-Seed-Code：执行 `/bin/zsh -lc ls`，0 次审批，工具 completed，回复输出 `existing.txt`，与目录实际内容一致。
- [x] 3.4 Desktop 中以询问档派遣 TRAE，审批卡片出现位置与来源一致（主 Agent→主页面，Worker 框续聊→子会话）
  - 2026-11-10 22:37–22:40，macOS DSH Desktop（`pnpm build` 后重启，内置浏览器连 Host Web UI），项目 `.test-data/CLI Worker Demo`，主对话「仅可查看」、TRAE 未选档，模型在设定卡片中改选 Seed-Code（Doubao-Seed-Code）。
  - 主 Agent 派遣：回执“权限为‘询问’，跟随主对话预设”；Worker 事件 `本轮权限：询问`；主页面出现「CLI 授权 traecn-1（TRAE CN）请求授权 Edit …/ask-desktop-main.txt」卡片（允许一次/拒绝）；选拒绝后事件 `授权决定：拒绝（DSH 用户）`、工具 FAILED、提示「因拒绝审批而结束：被拒操作未执行，可续聊继续」，`ask-desktop-main.txt` 不存在。
  - Worker 窗口：权限菜单为「询问 ✓」「仅工作区编辑」「完全权限」。在 Worker 框内续聊写 `ask-desktop-worker.txt`：审批出现在子会话内的「等待审批」面板（不在主页面），点「允许一次」后事件 `授权决定：允许一次（DSH 用户）`，Edit COMPLETED，随后 Read 未发审批；文件内容 `hello-desktop-worker`（20 字节）。
  - 已知未改：Worker 列表对拒绝结束的轮次仍显示「已完成」（v0.8.8 验收发现②，不属本变更）。
- [x] 3.5 Windows：未验证只读沙箱，发布说明中写明
  - 2026-11-11 19:02–19:09 Windows Desktop 实测（候选包 `preview-089-20261111-185643.tgz`，原生安装器装入，825 个 lib 文件与清单一致；Codex Computer Use gpt-6.1-sol high 操作；工作区 `C:\Users\admin\cw081f1\live-codex`；主对话「仅可查看」；Seed-Code）：主 Agent 派遣回执写明「询问」；主页面出现「rc089-trae（TRAE CN）请求授权 Edit …\rc089-main-win.txt」卡片，拒绝后事件 `授权决定：拒绝（DSH 用户）`、提示「因拒绝审批而结束」，`rc089-main-win.txt` 不存在；Worker 菜单三档「询问 ✓」。Worker 框续聊：审批出现在子会话「等待审批」面板（主页面无卡片），允许后 Edit COMPLETED，`rc089-worker-win.txt` 19 字节。
  - Windows 与 macOS 不同：同轮 TRAE 原生 Read 报 `File does not exist`（文件已落盘，TRAE 自身问题），随后改用 PowerShell `Get-ChildItem` 只读命令，只读沙箱下也发 `session/request_permission`（内容含 `Proposed Amendment: …powershell.exe`）。测试按单次审批规则拒绝，该命令未执行；因同轮已有非拒绝的工具失败，插件按既有规则显示「CLI 未成功完成（cancelled）」而不是「因拒绝审批而结束」。安全边界成立（未经批准无写入、无命令执行），已在 README、使用说明与协议文档写明 Windows 只读命令也会询问。

## 4. 文档

- [x] 4.1 `doc/traecn-protocol.md` 权限表与启动参数
  - 同步更新 `doc/usage-details.md` 与 `doc/design.md` v0.8.9 小节。
- [x] 4.2 README 权限说明（TRAE 第一项、仅可查看下的派遣）

## 5. 发布验收（v0.8.9，2026-11-11）

- [x] 5.1 macOS Desktop 实操（正式构建 9ba35f1，Desktop 带无障碍与防节流参数重启；Codex Computer Use gpt-6.1-sol high；项目 `CLI Worker Demo`；主对话「仅可查看」；Seed-Code）：回执「权限：询问」；主页面授权卡片拒绝后事件 `授权决定：拒绝（DSH 用户）`、「因拒绝审批而结束」、`rc089-main-mac.txt` 不存在；Worker 菜单「询问 ✓／仅工作区编辑／完全权限」；Worker 框续聊审批在子会话面板，允许后 Edit 与 Read 均 COMPLETED（Read 未询问），`rc089-worker-mac.txt` 内容 `hello-rc089-worker`。
- [x] 5.2 Windows Desktop 实操：见 3.5。
- [x] 5.3 推送、GitHub CI、GitHub Release 与 npm 发布（用户 2026-11-11 批准）：
  - `main` 推送 9cf0d9d..538cf16；tag `v0.8.9` 指向 538cf16。
  - GitHub CI run 43011147053（Windows native runtime）通过：21 个文件，437 通过、4 跳过。
  - GitHub Release「dsh-cliworker-now v0.8.9」附 tgz 与 SHA256SUMS；下载回读 SHA256 `358c2630…aef0` 与本地包一致。
  - npm `dsh-cliworker-now@0.8.9`（2026-11-11T12:40:57Z）由同一 tgz 发布，registry 元数据 `latest`=0.8.9、1045 个文件；用户要求不做 `npm pack` 下载哈希回读（未执行）。Release 正文 npm 一行仍为「待发布后回读」。
