# Tasks

## 1. 核实反馈与根因 〔后端｜3h〕

- [x] 1.1 核对用户诊断报告并在 Mac 隔离环境复现
  - 用户报告（Windows 10，Desktop 0.2.2-rc.5）：插件 `link:` 到无 `lib/` 的源码目录；runtime-host 218 个文件与 npm 0.9.2 一致；4 次启用均 failed（operation-error），停用后恢复。只收到 Markdown 报告，未取得其附件与截图
  - Mac 复现（Codex gpt-6.2-astra high，临时 HOME/DSH_HOME 的 rc.5 web profile，经宿主 `pluginManager/installBundle` + `setBundleEnabled`）：`git archive v0.9.2` 源码启用 failed、`changed=true`，启用列表已写入、官方四行禁用，预检与主入口 `ERR_MODULE_NOT_FOUND`，conversation/chat 替代包缺 `@deepseek-ai/schemastery` 导入失败；输入栏 0/0，重启 Host 仍 0/0，停用后恢复 1/1。npm 0.9.2 tgz 热启用、刷新、冷启动均 1/1
  - 更正用户报告两处：替代界面不全是「等待预检」，有两个在导入阶段即失败；前端实际抛出过 `SlotAssemblyError`，只是页面没有提示
  - 证据：`/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-22-unbuilt-link-composer/report.md`、`evidence/observations.json`
- [x] 1.2 定位宿主行为：rc.5 先保存启用选择再验收运行状态，失败不回滚；冷启动按同一选择装配
  - 证据：rc.5 上游 `packages/boot/plugin-manager/src/index.ts` `selectBundle()`（先 `bundleRows()` 读补丁，再 `saveManifest()`）、`packages/boot/app-boot/src/profile.ts` `loadProfileDirectory()`（补丁读取失败整层跳过）、`packages/boot/app-boot/src/index.ts` `loadOverlayPatches()`（读文件失败抛错，空数组合法）；工作树 `cliworker-now-test/test/worktrees/2026-11-19-dsh-rc5-upstream-patched`

## 2. 实现 〔后端｜2h｜前置 1〕

- [x] 2.1 `package.json` 的 `dsh.bundle.patch` 改为 `["./cordis.patch.yml", "./lib/build-complete.patch.yml"]`
  - 证据：`package.json`；`scripts/package-release.mjs` 的 `declaredFiles()` 已支持数组并要求每个文件存在，未修改
- [x] 2.2 新增 `scripts/build-complete-marker.mjs`，`scripts/build.mjs` 在客户端构建后调用 `writeBuildCompleteMarker()`：核对 Host、Client、预检、协议与四个随包界面入口，全部存在才原子写入空补丁，否则构建失败
  - 证据：`scripts/build-complete-marker.mjs`、`scripts/build.mjs`；`--host-only` 在客户端前退出，不生成标记
- [x] 2.3 预览构建与 Windows 远程构建清单加入新脚本
  - 证据：`scripts/build-preview.mjs`、`scripts/windows-remote-common.mjs`（`SOURCE_SCRIPTS`）、`scripts/windows-remote.mjs`（预览后源码变化检查）
- [x] 2.4 文档：README（中英）源码安装段与 `doc/usage-details.md`、`doc/usage-details.en.md` 说明未构建目录不能使用、v0.9.3 起被拒绝启用、误装后冷启动恢复
  - 证据：四个文档文件；按项目格式规则对改动过的六个文件运行了 `prettier --write`（含原有的表格对齐等格式差异）

## 3. 模拟回归测试与最小验收 〔测试｜1h｜前置 2〕

- [x] 3.1 新增 `tests/build-complete-marker.test.ts` 3 项（临时目录夹具，宿主函数为真实 rc.5 `@deepseek-ai/dsh-app-boot`）
  - 补丁声明顺序；缺任一入口不写标记并列出缺失项，全部存在后写入，真实 `loadOverlayPatches()` 解析为空数组
  - 真实 `loadProfileDirectory()`：选中的插件目录缺标记时 `layers` 为空、`skippedBundles` 理由含 `build-complete.patch.yml`；补上标记后整层加载，禁用官方四行
- [x] 3.2 运行验证（2026-11-22，`KIMI_CODE_NO_AUTO_UPDATE=1`，保留代理变量）
  - `corepack pnpm vitest run tests/build-complete-marker.test.ts tests/windows-remote.test.ts tests/host-runtime-package.test.ts tests/root-recovery.test.ts tests/build-host-copy-manifest.test.ts`：5 个文件 80 项通过
  - `corepack pnpm typecheck` 退出 0；`corepack pnpm lint` 0 error、334 warning，与改前基线（`4c4b689`）相同；`corepack pnpm format:check` 通过
  - `corepack pnpm build:preview` 退出 0，`.cache/preview-package/lib/build-complete.patch.yml` 已生成

## 4. Mac 实测 〔测试｜2h｜前置 3〕

- [x] 4.1 rc.5 隔离 web profile：未构建源码目录启用被拒绝、启用列表不变、输入栏保持；已选中未构建目录的 profile 冷启动跳过插件、输入栏可见；预览构建包正常启用与冷启动
  - 2026-11-22，macOS arm64，DSH 0.2.2-rc.5，Codex gpt-6.2-astra high 执行；各组独立 HOME/DSH_HOME、回环随机端口；输入栏「1/1」= seat 与 input 各一、contenteditable、实际点击取得焦点
  - A（`git archive 4a8a9c2` 未构建源码）：安装 failed（exitCode=1）；启用 8 ms 返回 failed、`changed=false`，诊断为读取 `lib/build-complete.patch.yml` ENOENT；bundles 与 dependencies 均无插件，官方四行 active；启用后、刷新、冷启动输入栏均 1/1
  - B（预置旧选择后冷启动，做两次：仅写 bundles + 残留链接；离线 `pnpm add` 构建旧 link 依赖与锁文件）：Host stderr 记录 skipping profile bundle 与缺失标记，插件六行未装配，官方四行 active，输入栏 1/1
  - C（测试包 `dsh-cliworker-now-4a8a9c2.tgz`，SHA-256 `e054b5fb…a386a23a`，1,392 个文件与 manifest 一致）：安装与启用均 applied，插件六行 active、官方四行禁用；热启用、刷新、冷启动输入栏均 1/1，右侧栏有 CLI Worker 入口
  - 正对照 v0.9.2 未构建源码：启用 failed 但 `changed=true`，官方四行被禁用，启用后、刷新、冷启动输入栏均 0/0，复现用户故障
  - 观察（不影响本修复）：rc.5 拒绝安装后 `node_modules/dsh-cliworker-now` 仍留有指向源码的链接，dependencies 与 bundles 无插件，未导致启用
  - 证据：`/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-22-v093-fixes-acceptance/mac/报告.md`、`mac/evidence/verified-{A,B,C,control}-*.json`、`mac/evidence/legacy-B-cold-host.log`、`mac/evidence/package-integrity.json`、`mac/evidence/cleanup.json`
- [x] 4.2 Mac DSH Desktop 用正式构建实测：插件正常加载；热启用恢复后 30 秒内停用，页面原地恢复（REQ-0139）
  - 门禁：229 条 Worker 记录非终态 0；备份三份 profile 文件后退出 Desktop；仓库 `corepack pnpm build` 成功并生成标记，Host 入口与标记哈希同测试包
  - 调试端口启动、CDP 连接 `dsh-app://app`：初始「共 6 个 · 6 运行中」；八次开关（两轮 停用→启用→约 5.7 秒内再停用）根子元素均 1→0→1，输入栏 1/1 可编辑，均回到原会话；两次快速停用距启用恢复 5.778 s、5.668 s，停用后 1.410 s、1.236 s 恢复；全程无 `[data-cliworker-restart-notice]`，无「DSH Desktop needs a full restart」
  - 每次热切换仍记录一次 session-maybe 的 `SlotAssemblyError`（随即恢复）；冷启动一次 `[deepseek-account] account read failed`，未定位
  - 收尾：`open -a` 正常启动（无调试参数，端口已关），辅助功能树读到可编辑输入栏与 CLI Worker 面板；bundles 成员与顺序不变，package.json、cordis.patch.yml、cordis.yml 与备份逐字节一致
  - 证据：`/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-22-v093-fixes-acceptance/mac/desktop/switch-summary.json`、`operation-journal.json`、`console-summary.json`、`normal-profile.json`、`normal-final.png`

## 5. Windows 实测 〔测试｜2h｜前置 3〕

- [x] 5.1 Windows DSH Desktop 0.2.2-rc.5 装入含两项修复的构建：插件正常加载；热启用恢复后 30 秒内停用页面原地恢复；未构建源码目录启用被拒绝、输入栏保持
  - 2026-11-22，Codex gpt-6.2-astra high 执行；门禁 Desktop 进程 0、85 条 Worker 记录活动 0；备份 profile 文件与旧插件目录（1,391 个文件）到 `%LOCALAPPDATA%\cliworker-now-remote\2026-11-22-v093-fixes\profile-before\`
  - 安装：Desktop 自带 `dsh.cmd plugin --profile desktop add --save-exact <tgz>` 退出 0，测试包 SHA-256 同 Mac，安装目录 1,392/1,392 一致，构建标记存在
  - 冷启动（CDP 经 SSH 转发）：插件页「共 6 个 · 6 运行中」；默认、已有、新建会话与 Worker 子窗口输入栏均可见可编辑。首次启动因 C 盘写满出现主组件 `ENOSPC`，回收本轮临时副本后重新冷启动通过
  - REQ-0139：两轮快速停用距启用恢复 5,144 ms、5,123 ms，根子元素 1→0→1，停用后 1,526 ms、1,260 ms 原地恢复原会话输入栏；八次切换均 settled/applied，采样与截图中重启提示 0，`console.jsonl` 中「needs a full restart」0；停用态冷启动后热启用也通过
  - REQ-0140（Windows Host `dsh.cmd --profile web`，独立临时 HOME/APPDATA 等，Mac 无头 Chromium 经回环转发访问）：未构建源码（2,316/2,316 文件回读一致）原生安装 failed；用 pnpm 建立真实 `link:` 依赖后启用返回 failed、`changed=false`，诊断为标记 ENOENT，bundles 不变，官方四行 active，输入框点击获焦；只向 bundles 加入插件名后冷启动，Host 记录 `skipping profile bundle "dsh-cliworker-now"`，官方四行 active、输入框获焦；完整 tgz 对照安装与启用 applied、六行 active
  - 收尾：真实 Desktop 保留测试包且插件启用，bundles 与备份逐项同序一致，经「应用 → 退出」关闭，进程、测试监听、辅助计划任务均为 0；C 盘剩余约 31.6 MiB
  - 清理（2026-11-22，用户授权）：删除 `cliworker-now-remote` 下 6 个 v0.9.1 预览目录、`v092-b7703b2-20261120`、`v092-release-20261120\profile-before`、`2026-11-22-composer-cold-hot`、本轮 `built-run`/`source`/`source-run`，以及 DSH 更新器中已安装的 rc.5 安装包两份（共 1,083 MB）；DSH 自带 pnpm `store prune` 再腾出 254 MB；C 盘可用 35 MB → 1,372 MB。保留本轮 `profile-before` 与测试包、0.9.2 正式包；回读已装插件 1,392 个文件、构建标记在、启用列表不变
  - 观察（与 Mac 相同）：每次热切换一次 session-maybe `SlotAssemblyError` 后自动重挂；原生安装拒绝未构建源码后 `node_modules` 仍有源码符号链接，再次启用仍被拒绝
  - 证据：`/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-22-v093-fixes-acceptance/windows/报告.md`、`windows/evidence-index.json`、`round1-quick-off-transition.json`、`round2-quick-off-transition.json`、`source-declared-enable.json`、`stale-declared-host.log`、`built-enable.json`、`final-readback.json`
