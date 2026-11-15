# Tasks

## 1. 账号终端启动与登录后刷新 〔后端｜6h〕
- [x] 1.1 查清 OMP 账号终端偶发启动失败的根因并修复（Mac、Windows）
  - 根因（Codex gpt-6-astra high，模拟复现）：① 取消的账号查询被当成已完成，终端在旧查询清理前启动（`src/host/accounts.ts` 约 597/638/970）；② 作废缓存只发取消信号，没有等待同一 CLI 的模型目录读取通道（`SettingsConnectionCache.cliReads`）收尾，OMP 账号终端可能在目录读取进程仍存活时启动。
  - 修复：终端启动前等待旧查询与目录通道收尾（`settleConnections`，`src/host/settings-connection-cache.ts` 新增 `settle(cli)`），再复查清理隔离状态；终端占用期间拦截新的展示查询与目录读取，终端清理成功后恢复、清理失败保持拦截。实机未复验。
- [x] 1.2 登录结束后作废账号缓存并立即刷新账号窗口与连接页摘要，覆盖所有带账号窗口的 CLI
  - 根因：登录前基线在 PTY 启动后才读取，快速登录会被当作原有凭据（`accounts.ts` 约 1122 改为启动前取基线）；成功按钮与关闭回执在进程清理、目录释放、缓存作废之前发布（约 1425/1635 改为先清理后发布）；查询队列 `whenIdle` 不等待已取消未结束的请求（`src/client/account-query-queue.ts:28`）。共用生命周期，覆盖 OMP、Pi、OpenCode、Kimi、Hermes、ZCode 多账号窗口与单账号引导；WorkBuddy 桌面端流程不变。
  - 前端（主会话）：账号窗口在登录结束、返回列表、保存服务商后直接做一次带操作句柄的新读取并替换窗口状态，不经过按 CLI 排队的展示读取；关闭或重开窗口后迟到的读取丢弃（`src/client/settings-dialog.tsx` `refreshWindow`/`endWindowReads`）。新增 `tests/settings-dialog.test.tsx`「the open account window lists a new login right after its terminal finishes…」，该用例在旧代码上也通过，只作覆盖，不作为复现证据。实机未复验。
- [x] 1.3 回归测试（模拟）
  - `tests/account-lifecycle-races.test.ts` 16 项（模拟），竞态用例修复前失败、修复后通过；Codex 报告 `vitest run tests/account-lifecycle-races.test.ts tests/accounts.test.ts tests/settings-connection-cache.test.ts tests/account-settings-start.test.ts tests/settings-connection-preload.test.ts` 5 文件 201 项通过，typecheck、build:preview、diff --check 退出 0。主会话汇总复跑见 4.1。

## 2. Pi 退出、Pi 账号窗口与自建配置删除 〔后端｜6h〕
- [x] 2.1 Pi 1.5 定向退出可确认完成
  - 根因（Codex gpt-6-astra high，模拟复现，未确认即用户机器上的原因）：退出前后的核对会解析所有来源的模型配置，任一无关文件解析失败即判「未确认」；旧助手调用 `ModelRuntime.logout()` 顺带触发模型同步。Pi 1.5.2 的 auth 路径、格式与 `zai-coding-cn` ID 未变。
  - 修复：只读所选来源的 auth.json，用 Pi 原生 `AuthStorage.delete()` 删除并以新实例回读（`src/host/pi-login.mjs`、`src/host/pi-omp-native.ts`、`src/host/pi-omp-logout.ts`）。实机未复验。
- [x] 2.2 Pi「账号」打开图形化登录窗口
  - 根因（模拟）：登录准备先复制并解析完整账号与模型配置，坏的模型文件会阻断服务商发现，只剩原生终端入口。修复：Pi 登录直接用插件账号目录、`modelsPath: null`，来源列举失败时退回凭据来源（`src/host/pi-omp-accounts.ts`）。本机 Pi 1.5.2 在空 HOME 下列出 43 个服务商（含 `zai-coding-cn`），未执行真实登录。实机未复验。
- [x] 2.3 自建与原生配置文件中的服务商可在账号窗口删除，环境变量来源保持只读
  - 核实：用户截图中的 `api.po1nt9.me` 位于 `~/.omp/agent/models.yml`（2026-08-04），插件目录只是快照副本，并非插件表单写入。用户决定允许删除并修改原生文件（决定 3）。
  - 实现：表单写入记录归属回执（`src/host/custom-provider-managed.ts`）；原生配置文件服务商行 id `native.config`，按钮「删除」→「确认删除」（`src/host/custom-provider-native.ts`、`src/client/account-login/accounts-window.tsx`、`src/host/accounts.ts` 条目校验）。备份 `<stateDirectory>/account-config-backups/<pi|omp>/<时间>-<uuid>/`，0600；YAML 节点位置编辑、保留注释与 CRLF；原子替换保留权限；链接、硬链接、重复键/别名拒绝；失败回滚；快照仅一致时同步删除。实机未复验。
- [x] 2.4 回归测试（模拟）
  - `tests/pi-account-isolation-regression.test.ts` 6 项（前 4 项修复前失败）、`tests/custom-provider-managed.test.ts` 16 项、`tests/native-config-provider-delete.test.ts` 24 项（前 12 项实现前 9 失败）、`tests/accounts-window-managed.test.tsx` 4 项，均标模拟。Codex 报告 16 文件 432 通过、2 项 Windows 专属跳过。

## 3. 账号行同排截断 〔前端｜1h〕
- [x] 3.1 多条凭据摘要与「账号」「账号终端」按钮同排，超出以「…」截断，悬停显示全部
  - `src/client/styles.ts`：账号行含 `data-provider-logins` 摘要时不换行，摘要 `flex:1 1 0` 占剩余宽度，状态行不换行；凭据列表沿用 `.cwn-account-logins` 省略号截断与 `title` 全文。`doc/settings-ui-design.md` 写入规则。
- [ ] 3.2 Desktop 实机目视（Mac 窄宽与常规宽度）

## 4. 集成、审查与实机复验 〔测试｜4h｜前置 1,2,3〕
- [x] 4.1 类型检查、关联测试、隔离构建
  - 2026-11-15 主会话复跑：`corepack pnpm typecheck` 通过（DSH 0.2.2-rc.3）；`vitest run --configLoader native` 23 个关联文件（账号生命周期、删除竞态、原生配置删除、账号窗口、设置弹窗、账号终端、Pi/OMP、自定义服务商、Windows 账号终端等）930 通过、1 跳过；`git diff --check` 通过；Codex 报告 `build:preview` 退出 0。
- [x] 4.2 Codex 审查并修复
  - codex-reviewer：0 个 P0/P1、2 个 P2。① 回读失败时无条件回滚会抹掉其他程序在写入窗口内的修改 → 回滚前比对文件仍为本事务写入内容，否则保留外部修改与备份并报「未回滚」（`src/host/custom-provider-files.ts`）。② 删除在终端准备阶段执行，终端启动失败时误报且重试失败 → 改为直接 Host 操作 `deleteAccountConfiguration`（`src/host/accounts.ts`、`src/host/index.ts`），不启动终端，持有账号预留、等待收尾、回读后才报成功；旧终端路径拒绝配置删除。新增 `tests/account-config-deletion-races.test.ts`（修复前 8 失败 1 通过）。
- [ ] 4.3 Mac 与 Windows Desktop 实机复验四个问题
