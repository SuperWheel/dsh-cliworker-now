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

- [ ] 4.1 rc.5 隔离 web profile：未构建源码目录启用被拒绝、启用列表不变、输入栏保持；已选中未构建目录的 profile 冷启动跳过插件、输入栏可见；预览构建包正常启用与冷启动
- [ ] 4.2 Mac DSH Desktop 用正式构建实测：插件正常加载；热启用恢复后 30 秒内停用，页面原地恢复（REQ-0139）

## 5. Windows 实测 〔测试｜2h｜前置 3〕

- [ ] 5.1 Windows DSH Desktop 0.2.2-rc.5 装入含两项修复的构建：插件正常加载；热启用恢复后 30 秒内停用页面原地恢复；未构建源码目录启用被拒绝、输入栏保持
