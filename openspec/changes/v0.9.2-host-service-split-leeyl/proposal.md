# Proposal

## Why

需求 REQ-0137（PRD：`doc/prd/2026-11-18-v0.9.2-host-service-split-PRD.md`）。

- `src/host/index.ts` 共 3768 行，是仓库最大的源文件。`CliWorkerService` 一个类约 3490 行，含 74 个 `@Remote` 接口方法和约 1370 行内部辅助逻辑，84 条 import。
- 账号、设置、CLI 更新、Worker 管理、消息与续聊等不相干的改动都要改这一个文件，并行开发时最容易冲突，审查与定位问题困难。
- 2026-11-18 目录结构审查把它列为长期维护的首要结构问题；用户同日决定放入 0.9.2。

## What Changes

- `src/host/index.ts` 仍是 Host 入口，只保留 Cordis 注册、74 个 `@Remote` 门面方法与生命周期；门面方法名称、参数、返回类型与调用模式不变，方法体改为委托。
- 方法体按领域移入不带装饰器的普通模块（领域切分在 design.md 中确定），共享状态通过显式传入的上下文对象访问，不新增全局单例。
- Typert 生成的远程契约（`lib/typert.remote-client.d.ts`）与预览包除新增内部模块外逐字节一致。
- 不改任何用户可见行为、文案、`lib/` 输出布局、`cordis.patch.yml`、`package.json` 的 `exports` 与 `files`。

## Capabilities

### Modified Capabilities

- `development-workflow`：新增「Host 主服务按领域分模块」约定，约束今后新增接口的落点。

## Impact

- 代码：`src/host/index.ts` 与新增的 `src/host/` 领域模块；测试只在必要时调整导入路径，不改断言。
- 构建与分发：`vitest.config.ts` 的装饰器转换仍只作用于 `src/host/index.ts`；预览包新增内部模块文件，其余产物不变。
- 不在范围：`src/host/runtime.ts`（WorkerRuntime）拆分、src 目录化、tests 与 scripts 搬迁、整仓 Prettier。
