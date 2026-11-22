# 市场热切换白屏隔离调查（2026-10-24）

## 1. 结论与范围

在 `a9d4017`、包版本 0.8.2 上复现了热停用白屏。插件 dispose 后恢复 stock UI 的候选没有解决白屏，未合入运行代码。推荐由 dshmarket 在任何 live mutation **之前**识别需要重启的 bundle，延迟整个配置切换；不能在卸载之后才返回 `restart: true`。

本次没有启动、退出或修改真实 DSH Desktop、官方 DeepSeek Harness、其数据或 `~/.dsh`；没有正式 build、版本变更、提交、推送、真实 CLI 派遣或模型调用。指定的 gpt-6-astra/high 进行了独立生命周期源码审查。仓库只补充调查文档和验证边界，没有新增可发布行为，因而没有创建或归档实施型 OpenSpec change。

实验全部在本次会话 `scratchpad/blank-toggle/` 下：从既有 `ui-test/home-dd` 复制 profile，将副本内插件 symlink 指向 preview 包副本，使用已解包 Host。初始 fixture 的市场状态实际为停用，保留为 `cold-off-*`，另建明确启用的副本用于正向复现。没有把日志、profile、截图或 cookie 放入 Git。

## 2. 实际复现方法

- rc.2：DSH Desktop 解包的 Harness 0.2.1-rc.2，加已解包 Desktop UI/workbench overlay；另用 `dsh-desktop-hmr-fallback` 的 ConfigWatchHmr 路径复验。
- rc.3：官方解包的 Harness 0.2.1-rc.3，最终使用只有诊断插件的原生 overlay。此前两轮误用 Desktop overlay，出现两个缺失插件警告；后续 `rc3native-*` / `rc3nativerestore-*` 已排除此干扰。
- 市场副本为 **dshmarket 1.70.1**。Playwright 使用本机已有 Chromium headless shell；从本次服务打印的 URL 取得登录 cookie，在页面内 POST `/dsh-market/toggle`，发送 `{name:'dsh-cliworker-now', enabled}`，经过市场真实路由、同源检查和变更锁。
- 每阶段等待 2.5 秒，保存 route reply、Loader entries/fiber 状态、ClientModuleRegistry graph/clientPath、settings.describe、页面正文、pageerror/console 和截图；诊断 `onGraphChanged` 另外记录中间图。已查看完整聊天页和全白页截图，未仅凭请求成功判断通过。
- `run-experiment.mjs` 在 finally 中关闭服务，`probe.mjs` 关闭浏览器。首次监听遇到沙箱 EPERM，获准后重跑；最初错误的诊断 logger exporter 造成挂起，修正前已停止该实验进程，未计入通过结果。

## 3. 停用方向：Host 恢复不等于页面恢复

1. bundle 插入六个 `cliworker-*` 条目，同时用顶层 patch 禁用四个 stock `ui-*`；stock 不是插件拥有的 insert id。
2. 市场 `themes.js:130-149,179-219` 只逐个更新本包拥有的条目。撤掉 vendor 时，stock 尚未恢复。诊断观察到四个 UI 包逐步从 graph 消失，而不是原子替换。
3. 浏览器发生 **`SlotAssemblyError: scope 'session-maybe' rendered without an installed adapter`**，正文长度从 rc.2 的 264（rc.3 原生 fixture 的 1027）变成 0；没有打开 CLI Worker 页签也会发生。
4. 市场再移除 bundle、写入 patch；Host 重组后四个 stock UI 已 ACTIVE，图重新完整，但 React 页面仍白。rc.2 默认 HMR、Desktop ConfigWatchHmr 和 rc.3 原生环境都复现。
5. rc.2 实际停用后的 profile 冷启动正常：四个 stock UI ACTIVE、正文 264、pageerror 0。rc.3 停用后仅刷新浏览器也能恢复聊天；这只证明该阶段 Host 图已经恢复，不代表后续启用安全。

证据：`baseline-{initial,disable}-page.json`、`baseline-{initial,disable}.png`、`fallback-home/diag.ndjson`、`restart-*`、`cold-restart-initial-*`、`rc3native-{disable-page,after-reload}.json`。

## 4. 启用方向：失败后的配置层分裂

### 4.1 rc.2 Desktop 解包版

停用并重组后，Loader 已没有该包条目。启用转入 `hotMount`，`hot.js:640-647` 拒绝非纯 insert 的 patch，返回 HTTP 502；市场保留 disabled 状态，却仍重新加入 `dsh.profile.bundles`。

这个 Desktop 解包版的 `dsh-app-boot/lib/index.js:928-935,1047-1055` 会读取 `.dsh-market/state.json` 并跳过停用包，所以本轮 rc.2 仍保留 stock 图。已经白屏的页面不会自行恢复；冷态停用 fixture 保持正常 stock 页面。**本轮没有独立复现 rc.2 从健康 stock 页面启用后新发生白屏，不能把 rc.3 结果冒充真实 Desktop 的该方向验收。**

### 4.2 rc.3 原生 Host

先停用、刷新到健康聊天页，再启用，独立复现第二次白屏：

- live enable 失败，HTTP 502、原因仍是非纯 insert patch。
- `routes.js:901-915` 的 bundle 写入未受 `liveOk` 约束，已经重新加入包。
- `routes.js:934-938` 的 patchGate 因失败为 false，前一次停用写下的六个 `cliworker-* disabled:true` 行继续存在。
- 此 rc.3 解包的 app-boot 没有上述市场 disabled-list 过滤。重组 bundle 时，它禁用四个 stock UI，同时用户 patch 又禁用六个 vendor/guard 条目；最终 **stock 与 vendor 全关，四个 UI 包的 graph 为空，两个原生 settings form 也消失**。
- 这次 guard 根本未启动，无法由 guard 的 dispose 或 startup 补偿修复。第二次停用/启用重复相同分裂。

证据：`rc3native-after-reload.json`、`rc3native-enable-{reply,diag,page}.json`、`rc3native-enable2-diag.json`。`rc3nativerestore-*` 的恢复候选同样失败。

## 5. 候选及结果

| 候选 | 实际实施与证据 | 结果 |
| --- | --- | --- |
| guard dispose 恢复 stock | 仅修改 scratch 包 guard；捕获已验证 Entry，停 vendor，等待捕获 fiber 的 dispose/inertia，再 `stock.update({disabled:false})`。`restore2-server.log` 与 `rc3nativerestore-server.log` 有实际 restored 记录 | rc.2/rc.3 仍报同一 SlotAssemblyError；Host 恢复后页面不恢复。未合入 |
| 首版恢复候选 | `restore-*` 还检查 root fiber uid，实际提前返回 | 无补偿效果，不计作实际恢复验证；随后修正为上一行候选 |
| dispose 关闭 CLI 页签 | 静态审查，未实施；`sidebarRight.close(tabId)` 仅能关闭当前 mounted session 的页签，registry disposer 只删类型 | 无 CLI 页签的基线也白屏，不能解决此根因。跨会话直接改 layout/localStorage 未尝试 |
| 先开 stock、再停 vendor | 未执行；现有 preflight 及 Host registry 明确拒绝同包两个来源 | 不采用，不能恢复旧 stock-id insert 归属错误，也不能绕过来源校验 |
| 市场延迟切换方向 | 只改 scratch dshmarket 的单个 toggle 路由：carrier 提前返回 restart，仅写市场状态，不 live-toggle、不写 bundle/patch | rc.2 两轮 off/on 页面均保留正文 264、0 pageerror、原图不变。冷启动 off 后保持 stock，记录 on 后仍保持 stock，再次冷启动恢复 vendor，均 0 pageerror；只是方向性原型，不是插件修复或可发布上游补丁 |

Cordis 注意事项：`Entry.update({disabled:true})` 不等于等待卸载完成；Loader `lib/index.js:402-405` 调用 disposer 后即返回，fiber 引用还在，市场按 `fiber !== undefined` 判断存活不可靠。直接 Entry.update 不持久化，但 Loader.update 会写树。disposer 内不得等待含自身的 `loader.await()`；同一 fiber 的独立 effects 并行清理，不能假定注册顺序即清理顺序。

没有公开的 Host 模块图批量交换与浏览器 renderer 暂停事务可供该 guard 使用。局部补偿无法控制市场后续逐条更新、配置 watcher 重组和 React adapter 卸载；启用时 guard 自身被停用的路径甚至没有补偿执行点。

## 6. 上游所需修改

以下行号均为本次副本 dshmarket 1.70.1 的 `lib/`，没有修改已安装市场：

1. 在 `routes.js:3110-3126` 调用 `setPluginEnabled` **之前**识别 carrier/不支持热替换的 bundle；同样覆盖 `:3497-3504` 的分组切换。`hot.js:146-178,640-647` 的非纯 insert 门槛不能只约束“条目不存在时”的热挂载，已有条目的热停用/启用也需先判断。
2. 需要重启时保存明确的待应用决策，保持当前 loader/client graph 不变；在下次 Host 组成 graph 前统一应用 bundle、owned-row patch 和市场状态。UI 显示“待重启”，不能报告已热停用。`routes.js:3149` 在操作后设置 restart 太晚。
3. `switchPluginLayers` 的 bundle 写入也必须受失败门控或完整回滚；不能只在 `:934` 阻止 patch 写入，却让 `:903-905` 先重新加入 bundle。
4. 延迟状态不能在普通设置保存触发的 live recompose 中生效。scratch 原型直接利用 rc.2 Desktop 读取市场 disabled-list 的现状，只验证本轮切换和冷启动；它不是跨宿主方案，其他配置刷新仍可能读取新状态。该后续刷新风险来自源码分析，本轮没有实际触发；生产方案应使用独立 pending intent/宿主重启协调，并覆盖已移除 bundle、已有 user overrides、分组切换和取消待重启决策。
5. 如果上游仍要支持完整热切换，需要 Host 与浏览器共同提供可验证的批量模块替换/renderer 生命周期边界，而非由一个正在销毁的插件模拟。

## 7. 检查与待验证

命令统一前缀：`PATH=/opt/homebrew/lib/node_modules/corepack/shims:$PATH pnpm --config.verifyDepsBeforeRun=false`。

- `build:preview`：通过；只更新隔离 preview，未执行正式 `build`。
- `typecheck`：通过（开发 SDK rc.3）。
- `test tests/host-runtime-package.test.ts tests/client-registration.test.ts tests/build-dependencies.test.ts`：**3 文件、30 项通过**；TMPDIR 定向到指定 scratch。包含真实 Loader 的来源/冷启动校验，以及原生 SettingsForms 的设置写入、revision、reset 和适配释放测试；不等同于浏览器手工设置验收。
- baseline/restore2/fallback/rc3native/rc3nativerestore/deferred：均经实际市场 HTTP 路由，各两轮 off/on。已保存页面、graph 和错误证据，失败如上如实保留。
- 没有新增运行行为，因此没有新增行为测试、全量 suite 或 OpenSpec 完成勾选。
- 下一步真实 Desktop 验证仍未执行：获准后需保留 Host/HMR 与浏览器错误证据，分别验证健康 stock→启用、vendor→停用、冷启动、原生设置、打开/未打开 CLI 页签、两轮切换及后续设置保存。须先有经过隔离验证的上游方案，不能把此次失败的恢复候选安装进真实 Desktop。

全部已完成实验的精简机器索引为 scratch 下 `summary.json`；最终进程检查确认没有本次 Harness/probe/run-experiment 进程遗留。
