## Why

Worker 默认 30 分钟后被强制终止（「任务超时」/`Native task timed out`）。原生 CLI 没有这个上限，长任务（全面审查、大规模重构）在插件中必然被截断。

现状：`DEFAULT_CONFIG.timeoutMs = 1_800_000`（`src/host/process.ts:67`）是从准备阶段起算的总时限，持续有输出也不续期；同一值在三处计时（`runtime.ts:2167`、`native-bridge.mjs:103-106`、`native-codex.mjs:250,262`），agy 另传 `--print-timeout`（`process.ts:141`）。Cordis 配置可改到 24 小时（`index.ts:244`），但 CLI Worker 设置页没有入口（`src/client/general-settings.tsx:34`、`src/shared/cli-settings.ts:16`），用户只能手改 DSH 插件配置文件。

## What Changes

- 「CLI Worker 设置」通用页新增「任务时限」：总时限（默认 30 分钟，可选更长或不限制）与空闲时限（一段时间内无任何原生事件才终止，默认关闭）。
- 运行时统一一个截止时间：Host 计算一次 deadline 传入桥与 runner，三处计时改为读同一 deadline，不再各自从零计时。
- 空闲时限按原生事件（回复、工具增量、思考、心跳）续期。
- 运行中修改设置只影响新任务，不改变正在运行任务的 deadline。
- 超时仍按既有流程停止，并在进程范围退出后才报告。

范围外：不改变 15 秒控制 RPC 等短请求超时（另行评估）；不改变停止与清理语义。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `worker-management`：新增「任务时限可配置」。

## Impact

- Host：`process.ts`、`runtime.ts`、`native-worker.ts`（请求写入 deadline）、`native-bridge.mjs`、`native-codex.mjs` 及其他 runner 的 `timeoutMs` 使用处、`adapters.ts`（agy `--print-timeout`）、设置持久化。
- Client：通用设置页新增分组，遵循 `doc/settings-ui-design.md`。
- 协议：桥请求新增 deadline/idle 字段；旧请求仍按 `timeoutMs` 兼容。
