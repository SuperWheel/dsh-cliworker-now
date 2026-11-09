## 1. 实现

- [x] 1.1 `src/host/storage.ts`：新增 `TOOL_COMMAND_LIMIT` 与 `clipToolCommand`；`append` 写入前截断 `toolCall.command`，事件 schema 读取时截断而非 `max(32768)` 拒绝。

## 2. 自动检查

- [x] 2.1 `tests/storage.test.ts`：新增 2 个用例（模拟的旧日志含 40k 字符命令可加载；写入时截断、代理对不被拆开、重开后可读取）；撤掉修复时 2 个均失败，修复后通过。
- [x] 2.2 macOS（`88b604c` 同源）：`typecheck` 通过；全量 vitest **250 文件通过、4 跳过；5417 通过、0 失败、14 跳过**；`spec validate --all --strict` 49/49；`git diff --check origin/main` 通过。
- [x] 2.3 Windows 远程（`test:windows:remote`）：run `ddbd58e3`（`88b604c`，0.8.6）与 run `95e2aa14`（同一修复、版本号 0.8.5-rc1）均为隔离 preview、冻结依赖、typecheck、17 个 Windows CI 文件 **302 通过、1 项 POSIX 跳过**、包检查与 Host 加载通过，cleanup 确认，modelCalls 0；另在 run `95e2aa14` 源码目录运行 `tests/storage.test.ts`、`tests/storage-torn-tail.test.ts` 16/16 通过。

## 3. 真实验收（v0.8.6，2026-11-02）

- [x] 3.1 端到端复现（模拟数据，隔离 `DSH_HOME`）：官方 dsh 0.2.1-rc.5 的 web profile 装入插件，写入一个已完成的模拟 Worker，其工具事件带 40,026 字符命令，再启动 `dsh web`。
  - Windows：0.8.5 报 `ZodError too_big`，栈为 `WorkerStorage.history (lib/index.js:15678:31)` → `new WorkerRuntime (24001:32)` → `new CliWorkerService (32230:19)`，与 issue 一致；0.8.6 正常服务，无插件错误。自启进程树清理后 0 残留。
  - macOS：同样 0.8.5 报错、0.8.6 正常。
- [x] 3.2 Windows Desktop：原生安装器装入最终 tgz（SHA256 `bcb5bd67…`），726/726 个 lib 文件一致；正常启动、无调试参数；插件存储锁在启动后取得；CLI Worker 面板正常列出已完成的 Agent。
- [x] 3.3 真实 CLI 产生超过 32768 字符命令后重启（未执行：用模拟事件日志代替，未做真实模型调用）。
  - 2026-11-09：用户决定按已完成关闭；本项没有补做上文所列的真实验收，原记录保留。
- [x] 3.4 macOS Desktop 重启加载正式构建（未执行：正式构建已链接，运行中的 Desktop 仍为旧构建）。
  - 2026-11-09：用户决定按已完成关闭；本项没有补做上文所列的真实验收，原记录保留。
