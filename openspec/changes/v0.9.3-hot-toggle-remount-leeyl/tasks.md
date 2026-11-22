# Tasks

## 1. 定位根因 〔前端｜2h〕

- [x] 1.1 Windows 实机复现冷启动、热启用、热切换各场景，定位整页重启提示的来源
  - 2026-11-22 Windows DSH Desktop 0.2.2-rc.5 + 插件 0.9.2 正式包，Codex gpt-6.2-astra high 经 `--remote-debugging-port` + SSH 转发 + CDP 直连 Electron 窗口：插件启用时冷启动 2 轮、停用状态冷启动后热启用 2 轮、运行中停用→启用 2 轮均正常；热启用恢复后很快再停用 2 次，2 次整页变为 Desktop 重启提示
  - 12 次启停均捕获 `SlotAssemblyError: scope 'session-maybe' rendered without an installed adapter`（`first-exception.json`）；`recovery-probe.jsonl`：出问题那次 `decision: restart`、`elapsed: 5631`，对照两次 `elapsed` 41099、47110 均恢复
  - 测试前备份 profile，结束时插件 0.9.2 启用、`dsh.profile.bundles` 与三个 profile 文件 SHA-256 与备份一致；测试中在 live-codex 新建了一个空会话（未发送消息）
  - 证据：`/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-22-windows-composer-cold-hot/`（`报告.md`、`recovery-probe.jsonl`、`s3-retest-quick-off.png`）；Windows 端 `%LOCALAPPDATA%\cliworker-now-remote\2026-11-22-composer-cold-hot\`
- [x] 1.2 定位代码：`src/client/root-recovery.ts` 的 `recoverCrashedRoot()` 按根节点记录上次重挂时间，距上次不足 `RELOAD_GAP_MS`（30 秒）即跳过重挂，Desktop 直接显示提示；门槛不区分是否为另一次切换
  - 证据：改前（HEAD `b99bfe4`）第 127–129 行 `previous = remountAttempts.get(root)`、`!previous || env.now() - previous.at >= RELOAD_GAP_MS` 才重挂，否则落入第 145–148 行 `showNotice()`；与 `recovery-probe.jsonl` 中 `elapsed: 5631` 时出现提示一致

## 2. 实现 〔前端｜1h｜前置 1〕

- [x] 2.1 `watchCrashedRoot()` 每次观察创建切换标识并传给 `recoverCrashedRoot(env, watch)`；重挂记录保存标识；不同切换可在 30 秒内各重挂一次，不带标识的调用与同一次切换仍按原门槛；网页刷新节流和 Desktop 提示不变
  - 证据：`src/client/root-recovery.ts`；按项目格式规则对两个改动文件运行了 `prettier --write`（含该文件原有的格式差异）

## 3. 模拟回归测试与最小验收 〔测试｜1h｜前置 2〕

- [x] 3.1 `tests/root-recovery.test.ts` 新增 2 项（模拟页面与模拟 DSH 挂载，真实 Cordis 生命周期）
  - 不同切换标识在 5,631 ms 内各重挂一次、不显示提示；同一标识再次空白不再重挂、显示提示
  - Desktop：热启用原地恢复后 5 秒内停用，停用观察再次重挂（事件 `mount:1, unmount:1, mount:2, unmount:2, mount:3`），不显示提示、不刷新
  - 回退检查：临时还原 `root-recovery.ts` 后这 2 项失败，其余 29 项通过；已恢复
- [x] 3.2 运行验证（2026-11-22，`KIMI_CODE_NO_AUTO_UPDATE=1`，保留代理变量）
  - `corepack pnpm vitest run tests/root-recovery.test.ts tests/client-conversation-features.test.tsx`：2 个文件 52 项通过
  - `corepack pnpm typecheck` 退出 0；`corepack pnpm exec eslint src/client/root-recovery.ts` 0 error；`corepack pnpm format:check` 通过
  - `corepack pnpm build:preview` 退出 0，`.cache/preview-package/lib/client.js` 含修复

## 4. 实机复测 〔测试｜1h｜前置 3〕

- [ ] 4.1 Windows DSH Desktop 0.2.2-rc.5 装入含本修复的构建，复测「热启用恢复后 30 秒内停用」，确认页面原地恢复、不出现重启提示
  - 未执行：需用户安排 Windows 实机与插件安装授权
