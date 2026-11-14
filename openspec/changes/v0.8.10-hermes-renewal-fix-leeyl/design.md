# Design

## Context

见 proposal.md。本机 Hermes 标识 v0.23.1，源码 commit `3b421578588243f920886e6fe79a6faa87ea026e`：`hermes_cli/auth_nous.py:515` 的 `_write_shared_nous_state(state, *, renewal: bool)` 由 `auth.py` 重导出；OAuth 刷新接口及 `on_state_update` 仍存在。插件 `hermes-nous-refresh.py` 的 `persist` 在保存 auth/pool 后无参数调用镜像写入，TypeError 被固定回执转为 unavailable，Host `hermes-renewal.ts:193` 按回执抛错。镜像落后且本地令牌已过期时，修复镜像也会在网络刷新前触发同一错误。

## Goals / Non-Goals

复用参数数组、原生 auth→shared 锁、即时保存轮换、身份/路由核验、输出限额与进程清理。只读诊断仅输出状态、字段名和布尔比较；不改凭据布局，不扩展跨身份 shared adoption，不修改代理环境。

## Decisions

### 决定 1：在兑换前检查共享写入签名
- 最终决定：用 inspect.signature 在 `_run` 前置能力检查处识别明确的 `renewal` 参数并绑定 `(state, renewal=True)`；旧版须能绑定仅一个 state，未知必需参数直接 unsupported。将选定参数复用到 persist。
- 放弃的方案：捕获实际写入 TypeError 后降级重试 —— 错误可能在写入内部发生，此时已消耗单次令牌，重复调用会掩盖故障。
- 影响：当前 0.23.1 使用明确续期语义；旧单参数接口继续使用；所有后续镜像重读与主体检查保留。

### 决定 2：以回归和真实读回分层验收
- 最终决定：模拟当前必需关键字接口、旧接口、未知签名、写入内部 TypeError、镜像落后恢复及旧有边界；真实路径只执行一次，使用 LocalSubprocessRuntime 与 ensureHermesNousFresh，再只读核对账号 state、到期前移、共享状态一致性。
- 放弃的方案：直接调用 OAuth HTTP 或凭据脚本手工覆盖 —— 绕过插件准入和持久化边界。
- 影响：不调用模型、不操作 Desktop；真实失效即停止，不尝试重复兑换或登录。

## Risks / Trade-offs

- 原生私有接口再次变化 → 兑换前绑定检查，未知签名 fail closed；真实 token 有效性由一次请求确认。
- 服务器轮换成功后磁盘写入失败 → 维持原有即时保存与安全失败，不增加补偿写入或重试。
- 模拟不代表 Windows/macOS Desktop 运行 → 本次仅报告 Mac 原生续期与测试，不推定 UI 或模型验收。

## Migration Plan

无需凭据迁移。先关联测试、类型检查、全量 vitest、隔离 preview，再真实续期、读回、严格规格校验并本地提交。正式 Desktop 构建由后续授权流程处理；代码可回退，已轮换的凭据绝不回滚。
