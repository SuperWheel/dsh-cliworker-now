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
  - 2026-10-29：已列入本日 Windows 全量验收（Windows 全量测试含 `native-worker-windows-env`、`storage-lock`、`storage-torn-tail`，另加 Codex 后台启动的实际环境检查）。
- [x] 3.2 真实 CLI / Desktop 更新验收。
  - 2026-10-29 核对：本变更 2026-10-20 合入当日，Windows 以原生安装器更新 Desktop：636 个 lib 文件一致，正常启动，无活动 Worker（`doc/tasks.md`「2026-10-20 v0.8.1：Windows 实机验收…」）。此后 Mac/Windows 的 Desktop 更新与真实 CLI 运行都基于该代码。停止时持久化失败、断尾恢复等故障路径只能靠测试注入覆盖。

## 4. 文档

- [x] 4.1 在 `doc/tasks.md` 记录命令、结果与未验证边界。
