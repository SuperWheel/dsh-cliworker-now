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
- [x] 3.2 Desktop 实机目视（Mac 窄宽与常规宽度）
  - 2026-11-15 用户在 Mac 与 Windows Desktop 复测 da256e5 部署（Mac 正式构建并重启；Windows 安装 1280/1280 文件哈希一致、`lib` 1056 个、Desktop 重启）后反馈全部通过。为用户口头结果，主会话未另截图核对。

## 4. 集成、审查与实机复验 〔测试｜4h｜前置 1,2,3〕
- [x] 4.1 类型检查、关联测试、隔离构建
  - 2026-11-15 主会话复跑：`corepack pnpm typecheck` 通过（DSH 0.2.2-rc.3）；`vitest run --configLoader native` 23 个关联文件（账号生命周期、删除竞态、原生配置删除、账号窗口、设置弹窗、账号终端、Pi/OMP、自定义服务商、Windows 账号终端等）930 通过、1 跳过；`git diff --check` 通过；Codex 报告 `build:preview` 退出 0。
- [x] 4.2 Codex 审查并修复
  - codex-reviewer：0 个 P0/P1、2 个 P2。① 回读失败时无条件回滚会抹掉其他程序在写入窗口内的修改 → 回滚前比对文件仍为本事务写入内容，否则保留外部修改与备份并报「未回滚」（`src/host/custom-provider-files.ts`）。② 删除在终端准备阶段执行，终端启动失败时误报且重试失败 → 改为直接 Host 操作 `deleteAccountConfiguration`（`src/host/accounts.ts`、`src/host/index.ts`），不启动终端，持有账号预留、等待收尾、回读后才报成功；旧终端路径拒绝配置删除。新增 `tests/account-config-deletion-races.test.ts`（修复前 8 失败 1 通过）。
- [x] 4.3 Mac 与 Windows Desktop 实机复验四个问题
  - 2026-11-15 用户在 Mac 与 Windows Desktop 复测 da256e5 部署（Mac 正式构建并重启；Windows 安装 1280/1280 文件哈希一致、`lib` 1056 个、Desktop 重启）后反馈四个问题（OMP/OpenCode 登录后即时刷新、Pi 退出与图形登录、删除自建配置、账号行同排截断）全部通过。为用户口头结果，主会话未另截图核对。

## 5. 实机复验发现：OMP DeepSeek 模型为空、Windows Pi 安装残缺 〔后端｜4h｜前置 4〕
- [x] 5.1 OMP 仅剩 DeepSeek API 凭据时模型与强度目录为空（Mac、Windows）
  - 2026-11-15 用户反馈后主会话以真实插件状态只读调用 `catalogFor('omp')` 复现「OMP 当前账号暂无可用模型」；旧提交 0f36f1c 同状态同样为空，非本变更回归。
  - 根因（Codex gpt-6-astra high）：`src/host/pi-native-catalog.mjs` 的 `builtinAPI` 缺 `deepseek` 默认路由；OMP `models --json` 不带 baseUrl/api，账号范围阶段因此跳过该服务商、0 次 `/models` 请求。OMP 原生有 4 个 DeepSeek 候选。修复后真实只读 `/models`（HTTP 200）交集得 `deepseek/deepseek-flash`、`deepseek/deepseek-v4-pro`，强度 low/high/max，0 次推理。证据与测试见 `openspec/archives/vnext-omp-deepseek-catalog-leeyl/`（`tests/pi-account-availability.test.ts` 9 项模拟，6 项修复前失败）。Pi 自带 DeepSeek 路由，不受影响。
- [x] 5.2 Windows Pi 安装残缺的处置与识别
  - 实机诊断（Windows，DSH 自带 Node 逐步加载插件 `lib/pi-installation.mjs`）：插件路径记录指向 npm 全局 Pi 1.5.2 `%APPDATA%\npm\…\dist\bundle\cli.js`；版本识别通过，但导入 `dist/core/model-runtime.js` 报 `ERR_MODULE_NOT_FOUND @earendil-works/pi-ai`。该安装 11-14 19:35:10 写入后中断：77 个嵌套依赖缺 package.json、18 个零字节文件；C 盘当前余 2.0 GB。插件清理不会产生零字节文件，非插件删除所致。这就是 Windows 上 Pi 账号窗口退回「在原生终端中选择服务商并登录」、模型区「无法读取 Pi/OMP 原生模型目录」的原因。
  - 用户批准后重装：交互会话 `npm install -g @earendil-works/pi-coding-agent@1.5.2`（宿主无代理变量，npm 走 npmmirror），「changed 123 packages」退出 0；复核 15547 文件，仅 `.bin` 无 package.json、`node-domexception/.history` 2 个合法零字节；插件脚本加载 model-runtime 成功、列出 43 个服务商，登录选项脚本退出 0。
  - 插件识别（Codex gpt-6-astra high + 主会话补丁）：`src/host/pi-installation.mjs` 新增只读完整性检查（静态 ESM 导入图、package.json 与非空入口、按入口与 mtime 缓存），用于服务商发现、Pi 模型目录（`pi-omp-adapter.ts`）、账号状态（`AccountStatus.installationNotice` 给出缺失依赖名，不改登录状态、不隐藏已有凭据）、账号窗口提示与英文映射；安装与更新核验在版本命令通过后再查完整性，不完整即判失败、不写路径记录。新增 `tests/pi-installation-integrity.test.ts`（含 Windows 健康树形状）等，修复前 5 项断言失败。
  - 二次审查（codex-reviewer，0 个 P0/P1、4 个 P2，均已修复，Codex gpt-6-astra high）：① 完整性提示曾把账号置 unavailable、隐藏已有凭据 → 改为独立字段 `installationNotice`；② 零字节的普通相对模块被误判残缺 → 只要求包入口与启动入口非空；③ bundle 入口归一化后绕过检查 → 启动入口 `launchEntry` 一并校验并计入缓存指纹；④ `tests/pi-omp-windows-directories.test.ts` 依赖本机 Pi → 改用模拟安装。
  - 2026-11-15 主会话汇总复跑：`corepack pnpm typecheck` 通过（DSH 0.2.2-rc.3）；`vitest run --configLoader native` 34 个关联文件（上述 23 个加完整性检查、原生登录服务商、安装与更新、Pi/OMP 适配器与目录等所有引用 `discoverPiOmp`、`pi-omp-adapter`、`pi-installation` 的测试）1340 通过、1 跳过；`git diff --check` 通过。
- [x] 5.3 部署后 Mac 与 Windows Desktop 实机复验 OMP DeepSeek 模型下拉与 Windows Pi 账号窗口、模型目录
  - 2026-11-15 用户在 Mac 与 Windows Desktop 复测 da256e5 部署（Mac 正式构建并重启；Windows 安装 1280/1280 文件哈希一致、`lib` 1056 个、Desktop 重启）后反馈OMP 模型与强度下拉、Windows Pi 账号窗口与模型目录均正常。为用户口头结果，主会话未另截图核对。
