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

## 3. 真实验收（开放条件，glm-5.3-flash）

- [ ] 3.1 工作区内写文件发出 `session/request_permission`，拒绝后文件不存在，本轮显示“因拒绝审批而结束”
  - 2026-11-10 22:11 探测：`session/prompt` 返回 `Internal error`，TRAE 服务端 400 `Repetition_penalty should be in (0.0, 2.0]`（重连 5 次均失败），未产生工具调用与审批；工作区为空。阻塞：服务端，用户决定不换模型。
- [ ] 3.2 允许后文件按要求写入
- [ ] 3.3 只读命令（`ls`）不发审批
- [ ] 3.4 Desktop 中以询问档派遣 TRAE，审批卡片出现位置与来源一致（主 Agent→主页面，Worker 框续聊→子会话）
- [ ] 3.5 Windows：未验证只读沙箱，发布说明中写明

## 4. 文档

- [x] 4.1 `doc/traecn-protocol.md` 权限表与启动参数
  - 同步更新 `doc/usage-details.md` 与 `doc/design.md` v0.8.9 小节。
- [x] 4.2 README 权限说明（TRAE 第一项、仅可查看下的派遣）
