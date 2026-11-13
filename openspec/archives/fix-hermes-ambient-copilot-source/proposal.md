## Why

2026-10-25 用户反馈：DSH Desktop「CLI Worker 设置 → Hermes Agent · 登录设置」的账号终端一直空白，下方提示「无法启动账号终端，请检查 CLI 安装」；此前 Hermes 显示账号过期，点「登录」后提示无法续期。其他 CLI 正常。

本机证据（只读检查，未打印任何凭据）：

- Hermes Agent v0.21.7（`~/.local/bin/hermes` → `~/.hermes/hermes-agent/.hermes/bin/hermes`）。插件的入口校验与 `hermesNativeCommand` 均通过，安装本身正常。
- 插件 Hermes 账号目录 `~/.dsh/cliworker-now/accounts/hermes/auth.json` 的 `credential_pool` 中多了 `copilot` 条目：`source: gh_cli`、`auth_type: api_key`，只有 `secret_fingerprint`、没有令牌，写入时间 2026-10-25 14:59（同一时刻 agent.log 有一次 Hermes 进程记录）。
- 原生 `agent/credential_pool.py::_seed_copilot_singleton` 在任何选择器加载 Copilot 凭据池时，只要 `gh auth token` 可用就写入这条记录，不受 `auth.adopt_external_logins: false` 约束；原生 `is_provider_explicitly_configured` 明确把 `gh_cli` 视为“环境借用来源”，不算已配置，未选择 Copilot 时不路由任何模型。
- 插件 `assertHermesOwnAccounts` 把它当作外部账号来源拒绝。账号终端（登录/管理/退出）准备阶段抛出普通 Error，被 `startSession` 统一改写成「无法启动账号终端，请检查 CLI 安装」；状态查询的续期快照同样被拒，`ensureHermesNousFresh` 把它改写成「Hermes 登录暂时无法续期，请稍后刷新」。用户无法通过账号终端移除该记录，形成死锁。
- 在真实账号目录上把原生刷新换成桩函数做干跑：除该守卫外，所有续期前置条件（配置、主体摘要、凭据池一致性、原生锁与 API 签名）均通过，`auth.json` 未改动。

## What Changes

- 守卫只放行原生自动写入、且当前未被选择的环境 Copilot 记录：`copilot` + `gh_cli` + `api_key`，并且 `auth.active_provider` 与 `config.yaml` 任何位置（model、auxiliary、MoA、fallback 等）都没有指定 `copilot`。一旦选择 Copilot，仍按外部账号拒绝。
- `assertHermesOwnAccounts` 的拒绝改为 `HermesAccountSourceError`（固定文案）：账号终端启动、状态摘要、续期与账号绑定显示具体原因，不再误报“检查 CLI 安装”或“稍后刷新”。Client 账号终端启动白名单与英文词典补充这些固定文案。
- 不改变其他外部来源规则；不读取、复制或删除 `gh` 凭据；不修改原生账号文件。

## Capabilities

### Modified Capabilities

- `cli-account-isolation`：新增“Hermes 原生环境记录不阻断自身账号”要求。

## Impact

- Host：`src/host/hermes-models.ts`、`hermes-renewal.ts`、`accounts.ts`、`cli-account-binding.ts`。
- Client：`src/client/account-terminal.tsx`（启动错误白名单）、`src/client/i18n-messages.ts`。
- 测试：`tests/hermes-renewal.test.ts`。
- 无协议、存储或安装入口变化。
