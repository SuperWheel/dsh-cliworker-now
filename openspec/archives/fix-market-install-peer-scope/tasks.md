# Tasks

## 1. 修复安装与构建契约

- [x] 1.1 移除 store peer、内联官方 store 及其状态引擎，保留宿主外部单例；用真实 Harness 闭包正反例、嵌套解析夹具、实际 Client 内存打包与模型目录回归验证。
- [x] 1.2 更新 `doc/design.md` 和 `doc/tasks.md` 的 v0.8.3（未发布）说明；核对 README 安装要求、市场文案来源及版本字段未变。

## 2. 集成验收

- [x] 2.1 执行 typecheck、关联 Vitest 及合理时长内的全量测试，记录通过/失败与环境限制。
- [x] 2.2 执行隔离 build:preview，与同次修复前基线比较大小并检查 store/状态引擎不再外部导入、宿主单例仍外部；在 preview 使用禁用生命周期的 npm pack dry-run 核对包清单与 peer。
- [x] 2.3 核对规格、实现与实际证据，执行 `pnpm spec status --change fix-market-install-peer-scope`、`pnpm spec:check` 及差异检查，更新验收记录并保持变更未归档。

## Workflow follow-up

- 本次禁止 Desktop 市场实装、正式 build、真实模型、提交、推送、发布和归档；真实 Desktop/平台安装验证留待后续授权，不能以本地回归替代。
