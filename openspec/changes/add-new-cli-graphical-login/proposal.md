# Proposal

## Why

v0.8.8 新接入的 CodeBuddy Code、TRAE CLI CN 与 WorkBuddy 两版尚未接通完整图形账号引导：前两者主要依赖原生终端，WorkBuddy 只有桌面端登录提示。需要复用既有窄窗口与状态确认机制，使用户能找到登录入口、完成换号并明确看到未完成原因。

## What Changes

- 为 CodeBuddy 单入口增加隐藏 PTY 引导：识别真实 TUI 后进入 `/login`、选择站点、完成原生授权；「切换账号」先自动 `/logout`，确认退出并完成清理后才开始登录。没有独立非交互 login/logout 子命令，不编造参数。
- 为 TRAE CN 增加单账号换号与登录方式卡片，沿用已实现的个人、企业 SSO、企业 PAT argv。个人流程按真实画面组合模板；企业 SSO/PAT 首期保留原生接手，不擅自扩大 PAT 输入和保存范围。
- 为 `workbuddycn` / `workbuddy` 增加桌面端账号引导页：显式打开正确的桌面应用、有限自动刷新状态，登录、退出与换号均在桌面端完成。没有 CLI 登录命令，不创建伪终端，不自动退出桌面账号。
- 复用 `LoginWindow` 的步骤、结果、淡色提示、480px 窗口及两列账号选择卡片；补齐 Host 固定文案的中英文映射、生命周期与对应模拟测试。
- 编写 [图形化登录开发指南](../../../doc/knowledge/cli-integration/graphical-login.md)，补齐接入流程的登录阶段与交付核对项。
- 初次规划只交付文档和方案；2026-11-07 获授权继续实施 WorkBuddy 桌面管理 Host/Client 与模拟测试，证据写 tasks.md。CodeBuddy/TRAE 由其他工作树实施；真实画面采集和 Desktop 验收仍是独立未完成任务。

## Capabilities

### New Capabilities

无。复用既有账号连接能力域，不另建重复能力。

### Modified Capabilities

- `cli-connection-health`：新增上述 CLI 的图形引导、桌面托管账号入口、严格状态确认和取消/回退场景。保留已落实的账号隔离与刷新契约；仅新增需求，不复制其他活动变更尚未归档的通用模板需求。

## Impact

- 现状证据：`src/host/accounts.ts` 的 `instructionFor`、`argumentsFor`、`startSession`；`src/host/account-guide/{engine,flows,providers}.ts`；`src/shared/account-links.ts`。`codebuddy`、`traecn` 已在 `SINGLE_ACCOUNT_CLIS`，但没有对应 flow，也不在 `GUIDED_ACCOUNT_CLIS`；WorkBuddy 的 `actionsFor` 返回空且 `start` 拒绝账号操作。
- 后续 Host 落点：账号管理器、CodeBuddy/TRAE flow、`codebuddy-account.ts`、`traecn-accounts.ts`、WorkBuddy 安装解析与元数据查询；Gateway 在 `src/host/index.ts`，共享协议在 `src/shared/accounts.ts`，客户端兼容 API 声明在 `src/client/workers.ts`。桌面打开/观察需要显式能力与受约束请求。
- 后续 Client 落点：`settings-dialog.tsx`、`account-terminal.tsx`、`account-login/{login-window,accounts-window}.tsx`、`i18n-messages.ts`、`operation-error.ts`；沿用 `styles.ts` 和 [设置规范](../../../doc/settings-ui-design.md)。产品显示名沿用 `CLI_LABELS`，不干涉并行的名称调整。
- 关联活动变更：`add-cli-login-templates`、`add-codebuddy-cli`、`add-traecn-cli`、`add-workbuddy-cli`。WorkBuddy 原文“无登录/退出入口”及旧模板“来源下拉框”的表述需在后续实施同步为桌面管理引导和卡片选择，详见设计；本轮不修改这些目录。
- 范围外：新 CLI/站点拆分、凭据读取扩权、企业 SSO 自动化、桌面端自动退出、模型调用、任务协议/权限/安装迁移、版本号与发布。CodeBuddy 认证内容只允许投影 `auth.domain`，不读取或输出 token，不调用会返回 `accessToken` 的 `_codebuddy.ai/getUserInfo`。
- 不新增依赖或账号持久化。真实屏幕、Windows/ConPTY、完整账号与 Desktop 结果尚待验证，严格规格校验只证明文档格式。
