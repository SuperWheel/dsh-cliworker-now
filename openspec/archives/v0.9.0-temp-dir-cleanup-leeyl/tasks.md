# Tasks

## 1. 规格与源码核对 〔后端｜1h〕

- [x] 1.1 核对泄漏路径、mkdtemp 范围、OMP/Pi 能力与正式运行边界，补齐变更产物
  - 已读 AGENTS.md、doc/openspec.md、配置及 host-lifecycle-durability 主规格；四处删除路径与 catalog 失败保留已确认。Pi 1.5.2 dist 350 个 JS 无 PI_NATIVES_DIR，OMP 二进制存在该字符串；Windows 解包量来自用户提供证据。

## 2. 回收与共享缓存 〔后端｜4h｜前置 1〕

- [x] 2.1 实现尽力重试删除、失败/未确认退出边界与关联回归
  - temporary-tree.mjs 统一 rm 的 6 次/150 ms 重试；四处重点路径及 OMP approval、ZCode 临时目录已接入。真实 Node rm 注入 EBUSY/EPERM/ENOTEMPTY 后重试成功；失败返回 false，catalog 成功结果不被锁定删除覆盖，确认拒绝删除/未确认保留均通过。
- [x] 2.2 实现限定范围清扫、节流与 Host 生命周期，验证链接/年龄/名称边界
  - temporary-sweep.ts 按一小时年龄与实际 mkdtemp 名称筛选，lstat 排除 symlink/junction，进程号目录标记保护存活所有者；十分钟节流、在途合并、卸载 abort/join。tests/temporary-cleanup.test.ts 5 项通过；Windows 账号终端关联模拟测试通过。
- [x] 2.3 实现 OMP 探测共享缓存与版本淘汰，验证环境注入并同步存储说明
  - 身份、登录选项、目录与权限帮助探测使用 <state>/omp-natives；保留最新三个真实版本，年轻/锁定版本延后。原生 bridge 模拟进程读回路径一致，正式 Worker 进程未注入该变量（新增定向测试 1 项通过）。README 与 doc/design.md 已同步。

## 3. 验证与交付 〔测试｜2h｜前置 2〕

- [x] 3.1 执行关联 vitest、typecheck、隔离构建与严格规格和差异检查，记录结果
  - `corepack pnpm exec vitest run tests/temporary-cleanup.test.ts tests/extended-catalog-cleanup.test.ts tests/pi-omp-identity.test.ts tests/native-login-providers.test.ts tests/qoder-accounts.test.ts tests/qodercn-accounts.test.ts`：6 文件，190 通过、1 平台跳过。
  - 首次扩大回归时 `tests/pi-omp-adapter.test.ts` 因沙箱 `listen EPERM 127.0.0.1` 失败；原测试不变，提权执行 `corepack pnpm exec vitest run tests/pi-omp-adapter.test.ts tests/pi-omp-windows-directories.test.ts`：2 文件，141 通过。
  - 新增 bridge 子进程读回测试后，提权执行 `corepack pnpm exec vitest run tests/pi-omp-adapter.test.ts -t 'OMP metadata and approval help share natives'`：1 通过，其余 130 按名称过滤跳过。
  - `corepack pnpm exec vitest run tests/temporary-cleanup.test.ts tests/extended-catalog-cleanup.test.ts tests/windows-account-terminal.test.ts`：3 文件，25 通过。最后补充锁定清扫重试场景后重跑 `tests/extended-catalog-cleanup.test.ts`：7 通过。以上分批去重共覆盖 9 文件、345 通过、1 平台跳过，均为合成进程/文件夹测试。
  - `corepack pnpm typecheck`：Host/Client 对 DSH 0.2.2-rc.3 通过。`corepack pnpm build:preview`：最终隔离包 `.cache/preview-package` 构建通过；ESM 辅助模块在包顶层和 types/host 均能 import。仅既有 Client ESM/CJS 打包建议，无构建错误。
  - `OPENSPEC_TELEMETRY=0 node_modules/.bin/pmspec validate v0.9.0-temp-dir-cleanup-leeyl --strict` 与 `/Library/Developer/CommandLineTools/usr/bin/git diff --check` 通过。没有提交、推送、版本变更或正式 Desktop build；原有未跟踪 PRD/video 文件保持不动。
- [x] 3.2 Windows 实机复验 native 复用、锁定清理及磁盘占用
  - 2026-11-15 Windows：隔离包 `rc3-859bcee-20261115` 安装 1259/1259 一致，退出时无活动任务。安装前基线 catalog 残留 grok 82、hermes 17、opencode 14、pi 30、zcode 4，Temp `cliworker-*` 4 个，C 盘 4.64 GB；Desktop 重启后数秒内全部为 0，C 盘 5.07 GB。
  - OMP 共享 native：`<state>/omp-natives/18.20.0`（05:45 首次探测解包一次，131988480 B）与 `18.20.2`（05:51 更新后，132542976 B）各一份；探测不再在 Temp 留 `cliworker-omp-identity-*`。05:55 Qoder/Qoder CN 元数据探测目录在探测结束后已删除。
  - 未覆盖：Defender 锁住文件的真实场景未刻意复现；Temp 下 Bun 单文件程序每次启动解出的 `.<16 位十六进制>-00000000.dll`（每个 1144200 B）累计 235 个、256 MB（最早 11-12，当日 96 个），来自未改 TEMP 的 CLI 探测，本变更未处理，另行跟进。

## 4. Windows 短时进程私有 TEMP 〔后端｜4h｜前置 2〕

- [x] 4.1 为短时探测、目录、账号、元数据和版本查询统一注入私有 TMP/TEMP，并接入退出清理与过期清扫
  - 复用 owner marker 和 temporary-tree 删除辅助器；进程范围未确认退出保留。Worker 和官方更新不使用新入口；不扫描共享 Temp 的 DLL 名称。
  - spawnProbe 统一接入 captureCatalogMetadata/captureReadOnly 与源码检索出的直接短时 backend.spawn（Antigravity models、通用账号状态、Codex account/models、Claude OAuth catalog、TRAE metadata、Qoder/CN、ZCode help、Grok/Hermes 有界续期）。WorkBuddy native IO 元数据路径复用同一环境工厂；无新定时器/进程观察器。Worker managed-agent/runtime、交互终端及官方更新 executor 未接入。
  - prepareProbeTemporaryEnvironment 创建 0700 的 cliworker-probe- 和 .cliworker-owner-PID；只覆盖 TMP/TEMP，保留代理和其他键。waitForExit true 才释放，done 不授权；false/throw 保留标记，启动失败释放。前缀纳入既有一小时/当前 uid/活 owner 排除清扫，不扫描共享 DLL 文件。
- [x] 4.2 补充模拟 Windows 环境/退出边界回归，执行指定检查并同步文档
  - probe-process 新增 7 项、workbuddy-probe-temporary 新增 3 项合成测试；核对 Windows TEMP/TMP 与代理、DLL/owner 生命周期、成功/失败/启动失败/退出未确认、POSIX 原环境、Worker 和官方更新不注入。temporary-cleanup 原混合清扫测试增加旧 probe 目录回收和旧共享 DLL 保留。
  - 首轮关联回归发现异步准备导致 POSIX 立即取消发生在 spawn 之前，已保留非 Windows 同步启动时序；Codex models、Claude OAuth、TRAE 的既有取消回归随后 85/85 通过。WorkBuddy 在沙箱内 ready-listen-failed，沙箱外原测试 39/39 通过。
  - 扩大沙箱回归 53 文件：1730 通过、1 平台跳过、6 失败，失败来自 Pi 环回 listen EPERM（及下游断言）与 native-process /bin/ps EPERM；未改测试以绕过环境。
  - 最终沙箱外命令：`corepack pnpm exec vitest run tests/cli-management* tests/cli-update-page.test.tsx tests/temporary-cleanup.test.ts tests/probe-process.test.ts tests/workbuddy-probe-temporary.test.ts tests/adapters.test.ts tests/extended-catalog-cleanup.test.ts tests/pi-omp-identity.test.ts tests/native-login-providers.test.ts tests/qoder-accounts.test.ts tests/qodercn-accounts.test.ts tests/codex-account.test.ts tests/codex-models.test.ts tests/traecn-accounts.test.ts tests/zcode-grok-accounts.test.ts tests/claude-native-oauth.test.ts tests/grok-renewal.test.ts tests/hermes-renewal.test.ts tests/accounts.test.ts tests/core.test.ts tests/native-process.test.ts tests/native-workbuddy.test.ts`：55 文件、1782 通过、1 平台跳过，25.82 秒。
  - `corepack pnpm typecheck` exit 0（DSH 0.2.2-rc.3）；`OPENSPEC_TELEMETRY=0 node_modules/.bin/pmspec validate v0.9.0-temp-dir-cleanup-leeyl --strict`、同命令校验 `v0.9.0-cli-update-dual-channel-leeyl` 及 `/Library/Developer/CommandLineTools/usr/bin/git diff --check` 均 exit 0。双通道仅主任务 9/10 子项过多的建议警告。
  - README/doc/design 与两个变更的 design/spec/tasks 已同步；doc/design 顺手纠正旧通道记忆描述为「残留清理不删除 channel-memory.json，接管失败/取消仍按既有逻辑清除」，实现不变。没有正式构建、Desktop 部署、真实 CLI 更新、提交、版本变更或真实临时文件删除。历史共享 Bun DLL 不归插件所有，用户可确认无占用后手动删除。
- [x] 4.3 Windows/Mac 实机复验 OMP 备份回收及短时探测临时目录与 Bun DLL 增长
  - 主会话本地提交 `34133b9` 复核：`corepack pnpm typecheck` 通过；关联回归 90 文件 2299 通过；两个变更 strict 校验 valid；`git diff --check` 通过。
  - Windows 实机（11-15，隔离包 `rc3-34133b9-20261115`，1262 文件，已装插件 `lib/index.js` 含 `cliworker-probe-`）：安装前 Temp 共有 241 个 `.<16hex>-00000000.dll`（263 MB），最新一个 06:15:47 由旧包产生。06:17:43 启动新包，06:23 后台检查与 06:24:28 手动「检查更新」（sol 点击，13 秒完成，16 行显示版本）均已执行探测（共享 omp-natives 06:23:32 被使用，状态文件 06:24:35 写入）。06:26:23 复查：DLL 仍 241 个、最新仍为 06:15:47，Temp 中无 `cliworker-`/`cwn-`/`dshwb-` 目录残留。结论：Windows 短时探测不再向共享 Temp 新增 Bun DLL，私有目录已在退出后回收。
  - OMP 备份回收已于 Windows 实测：把 OMP 回退到 18.20.0 后，在插件页更新到 18.20.2（官方超时，插件接管完成）。输出为「更新清理：已删除 插件临时文件 2 项、OMP 原生备份 1 项」，复核时 `.bak` 已不在，更新后 Bun DLL 没有新增。详细记录见双通道变更 10.13。
  - 用户同意后，删除了 Windows Temp 中 226 个超过 1 小时的旧 Bun DLL，释放 246.6 MB，没有遇到被占用的文件。另有 15 个是 1 小时内旧包产生的，未删。
  - Mac 实机（11-15，含 7044b0b 的 macOS OMP 备份规则，07:43 正式构建并重启 Desktop）：先把 `~/.local/bin/omp` 用同目录旧备份回退到 18.20.0（另存 18.20.2 安全副本），07:45 在「更新 CLI」页点 OMP 更新，官方 `omp update` 补丁更新成功，输出末行「更新清理：已删除 OMP 原生备份 1 项，释放 223369360 B。」。复核 `~/.local/bin` 只剩 `omp`（224277648 B，`--version` 18.20.2，sha256 前缀 e2de0974ce581bfc，与官方输出及安全副本一致）和 0 字节 `omp.lock`；原 `omp.1794698897770.88878.0.bak` 已不在。插件只报删除 1 项：官方更新过程中是否另行生成并替换了备份未单独观察。插件 cli-management/downloads 为 0 项；安全副本已删除。
  - Mac 短时探测：非 Windows 不注入私有 TEMP（设计如此）。Host（pid 85470）运行期间 TMPDIR 中没有其 owner 的 `cliworker-probe-*`；现存的 `cliworker-probe-*` 均标记为已退出的 vitest 进程（81857、88870、91774 等），属测试遗留，另由全量测试修复任务处理；Bun DLL 增长只存在于 Windows。
  - Windows 与 Mac 均已覆盖，勾选。未覆盖：Defender 锁定文件的真实场景、Linux（OMP 规则不启用）。
