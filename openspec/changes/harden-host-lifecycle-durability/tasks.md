# Tasks

## 1. 实施

- [x] 1.1 停止先内存撤销资格并启动取消，持久化失败单独记录；卸载隔离同步异常。
- [x] 1.2 `host.lock` 改为唯一候选锁 + 先声明后扫描的独占方案，保留兼容 `host.lock`。
- [x] 1.3 断尾恢复改为 ftruncate 到最后完整换行。
- [x] 1.4 Windows Codex 后台启动只传 `launch.env`。
- [x] 1.5 工具桥 lease 发布失败时关闭并恢复展示模式。
- [x] 1.6 目录查询使用 StringDecoder。

## 2. 自动检查

- [x] 2.1 各项行为回归测试（取消、恢复、权限边界、流解析）。
- [x] 2.2 `node scripts/build.mjs --typecheck-only` 与相关 vitest 文件。
- [x] 2.3 `openspec validate --strict`。

## 3. 未执行（需另行授权或平台）

- [ ] 3.1 Windows 实机验证 Codex 后台启动环境与 `host.lock` 候选锁行为。
  - 2026-10-29 Windows 全量测试中 `native-worker-windows-env`（1/1）、`storage-lock`（4/4）、`storage-torn-tail`（2/2）均通过（`full-vitest.json`）。
  - 2026-10-29 Windows（安装包 Electron SDK）：已安装的启动 helper 真实执行 `codex --version` 退出 0，合成的无关变量未进入 launch.env（只记录变量名）；同一进程中第二个 Storage 实例被 host.lock 拒绝，关闭后候选锁与 host.lock 均已清除。未验证：Desktop 实际 Worker 子进程环境、跨进程 host.lock 竞争。证据在 `.test-data/windows-remote/full-20261029/`（不入 Git）。
- [x] 3.2 真实 CLI / Desktop 更新验收。
  - 2026-10-29 核对：本变更 2026-10-20 合入当日，Windows 以原生安装器更新 Desktop：636 个 lib 文件一致，正常启动，无活动 Worker（`doc/tasks.md`「2026-10-20 v0.8.1：Windows 实机验收…」）。此后 Mac/Windows 的 Desktop 更新与真实 CLI 运行都基于该代码。停止时持久化失败、断尾恢复等故障路径只能靠测试注入覆盖。

## 4. 文档

- [x] 4.1 在 `doc/tasks.md` 记录命令、结果与未验证边界。
