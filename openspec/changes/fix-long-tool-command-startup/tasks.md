## 1. 实现

- [x] 1.1 `src/host/storage.ts`：新增 `TOOL_COMMAND_LIMIT` 与 `clipToolCommand`；`append` 写入前截断 `toolCall.command`，事件 schema 读取时截断而非 `max(32768)` 拒绝。

## 2. 自动检查

- [x] 2.1 `tests/storage.test.ts`：新增 2 个用例（模拟的旧日志含 40k 字符命令可加载；写入时截断、代理对不被拆开、重开后可读取）；撤掉修复时 2 个均失败，修复后通过。
- [x] 2.2 `tests/storage.test.ts`、`tests/storage-torn-tail.test.ts`、`tests/core.test.ts`、`tests/worker-management.test.ts` 共 83 个用例通过；`pnpm typecheck`（DSH 0.2.1-rc.5）通过。

## 3. 真实验收

- [ ] 3.1 Windows 上用 issue 中的超长 PowerShell 命令复现并确认重启后正常（未执行：本次只做单元测试与类型检查）。
- [ ] 3.2 隔离构建 `pnpm build:preview` 后在 DSH 中加载含超长命令的事件日志（未执行）。
