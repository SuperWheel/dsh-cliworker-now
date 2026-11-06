# Proposal

## Why

2026-11-06 Windows 现场：OMP、Pi、OpenCode 共用的智谱 key 返回 401（「身份验证失败。」）。`account-models.mjs` 已把 401/403 判为 `denied('authentication')`，但 Pi/OMP（`pi-native-catalog.mjs` 交集）和 OpenCode（`opencode-adapter.ts`）丢掉了这个原因，设置页只显示「当前账号暂无可用模型，请登录或刷新」，用户无从得知是凭据失效。用户换了新 key 后，OMP 里同时存在旧凭据（401）和新凭据（200），而保守交集规则要求每条凭据都支持，结果一个模型都不显示。用户要求修复这两个问题并入本版本。

## What Changes

- Pi/OMP、OpenCode 的目录为空且原因是服务商拒绝凭据时，报出认证失败及处理方式，不再显示泛化的「暂无可用模型」。
- Pi/OMP 同一服务商有多条凭据时，**明确被服务商拒绝认证**（401/403 或认证错误码）的凭据不再参与交集，其余凭据全部确认支持时，按它们的交集显示模型，并提示已跳过几条认证失败的凭据、可在账号窗口退出。范围未知、网络失败等其他情况保持原有的保守规则。
- OpenCode 部分服务商认证失败但仍有其他服务商的模型时，同样给出提示。
- 设置页显示上述提示；补中英文。

## Capabilities

### Modified Capabilities

- `cli-model-discovery`：修改「按账号与执行路由筛选」的多账号池规则，增加认证失败的原因说明。

## Impact

Host：`pi-native-catalog.mjs`、`pi-omp-bridge.mjs`（account-scope 阶段输出改为带统计的对象，兼容旧数组）、`pi-omp-adapter.ts`、`opencode-adapter.ts`、`extended-adapters.ts`、`adapters.ts`。Client：`settings-dialog.tsx` 显示条件、`operation-error.ts` 与 `i18n-messages.ts`。无新依赖、无持久化迁移。

## Out of Scope

不改 Codex（已有认证失败提示）、Hermes、Grok、ZCode 等其他 CLI 的目录规则；不自动退出或修改任何凭据；不改变任务执行时 OMP 原生选用凭据的方式。
