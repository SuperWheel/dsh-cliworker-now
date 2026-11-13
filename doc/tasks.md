# 实施任务与验证记录

## v0.8.3（未发布）

### 2026-10-24：完成市场 UI 行归属修复与 canonical 设置兼容

- 修复：四个 vendored Loader id 改为 `cliworker-ui-*`，四个 stock id 仅在本 bundle 的顶层 disabled rows 出现；官方客户端包名和资源不变。新增可释放的 ConfigEditor.entries 设置视图，让 `ui-chat`／`ui-conversation` 继续使用 stock id/name/raw config，借用经预检的活跃 vendored schema。实际 Loader、SettingsForms、ConfigEditor.edit 与 Harness 文件不改；原生锁、revision、重置、层次校验、原子写入和回滚继续由宿主负责。
- 配置与清理：原有 canonical profile/home 配置直接读取，不复制、不迁移；新写入的 name 断言仍指向 stock 包，移除插件后可继续使用。预检拒绝 private id 上的第二份 config、外部来源和丢失的 isolate/intercept/inject；session/subagent 保持原配置丢失检查。按 fiber 身份释放旧展示策略；卸载恢复原方法属性描述符，后置包装存在时不覆盖它且旧闭包停用。旧版本写入的 vendored 路径 name 断言仍明确报冲突，不擅自迁移。
- 方案验证：先在 `ownership-audit/alias-experiment.mjs` 用真实官方服务验证 alias 视图，读取既存 canonical 值并成功 update。原生 configure 仅支持展示策略，没有独立 namespace/schema 注册接口；非 insert name 仍是断言，没有 replace 语义。未采用改客户端 namespace、复制配置或规避市场文本解析的形状。
- 最终自动检查（均使用指定 PATH 和 `pnpm --config.verifyDepsBeforeRun=false`）：`typecheck` 通过；`test tests/host-runtime-package.test.ts` 最终 **10 项通过**；`build:preview` 通过。测试覆盖包完整性、无 stock-id inserts、市场所有权模型、预检接受/拒绝、真实 Loader 启动/恢复、SettingsForms canonical 值/revision/重置、卸载及后置包装。单元测试中配置编辑持久化投影明确为模拟；以下集成使用真实 ConfigEditor 和 scratch 文件。测试 TMPDIR 均限定指定 scratchpad。
- 最终隔离集成来自 `.cache/preview-package` 原样复制的包，不再修改副本 guard/patch：① Desktop disabled 副本 stock 四行 ACTIVE、disabled=false，无插件客户端；② Desktop enabled 副本 stock disabled、四个 vendored ACTIVE、ready=true；③ npm 官方 Harness 的新 home 同②。三者原生 `settings.update('ui-chat')` 都成功，旧 revision 被拒绝，mutate/replace 重置有效；最终写入 `transcriptView=verbose`、`busyEnter=steer`。官方宿主随后冷重启与移除 bundle 冷启动，偏好均保留，移除后四个 stock ACTIVE、插件客户端消失。
- HTTP/模块证据：五次运行均 HTTP 200，解析 `__DSH_BOOT__.entries` 后四个官方包各一次，插件条目仅出现在启用态；Loader registry 的实际 clientPath 在启用态来自 runtime-host，在禁用/移除态来自 stock。正文均无 `Failed to load plugins`。未执行浏览器脚本，不把 HTTP 清单称为完整 GUI 激活证据。五服务均经 SIGINT 退出 130；启动器 finally 清理，无强杀或遗留服务。
- 主会话独立复核（浏览器，Chromium 内置浏览器，非 Electron 窗口）：从 `home-dd` 新复制 `home-vA`（市场 disabled 含本插件）与 `home-vB`（仅移除本插件），换入当前 `.cache/preview-package`，用 Desktop 提取的 Harness 0.2.1-rc.2 + `desktop-only.patch.yml` 启动。A 页面完整渲染宿主首页，四个 `@deepseek-ai/dsh-client-ui-*` 各一次、无插件入口、无 `Failed to load plugins`；B 同样完整渲染，入口含 `dsh-cliworker-now`，右侧栏出现「CLI Worker」卡片，点击后 CLI Worker 面板（搜索、状态筛选与空态）正常显示，重载后控制台无错误。修复前同一副本复现为 `required client modules failed to activate`，诊断插件显示 stock 四行 disabled。关联 `pnpm test tests/host-runtime-package.test.ts tests/market-install-peers.test.ts` 2 文件 / 13 项通过，typecheck 通过，preview 中 patch 与 guard 与源码一致。
- 真实 DSH Desktop 0.12.1 窗口验收（2026-10-24，用户批准安装预览包与测试期间自动退出/打开 Desktop；Codex gpt-6-astra high Computer Use 操作，主会话核对日志与 profile）：用户实际 profile 先移除旧 0.8.2 并备份至 `harness/profiles-backup-20261024-cliworker`，Desktop 正常启动。随后经「插件 → 添加插件 → 安装第三方插件」安装 `.test-data/dsh-desktop-fix-ba4b42a/dsh-cliworker-now-0.8.2.tgz`（sha256 `42287d55…6e1ef9`，generation `dsh-cliworker-now+0.8.2+a83713abcb6e`）。① 启用并重启：主窗口、既有会话与输入框正常，右侧栏「CLI Worker」卡片可打开面板（标题、搜索、四个筛选与空态正常），设置弹窗打开后未修改关闭。② 停用并重启（关键回归）：主窗口与既有会话正常，未出现「Harness 暂时无法启动」，CLI Worker 卡片消失。③ 重新启用并重启：卡片与面板恢复；最终保持启用。harness.log 显示 04:38、04:42（停用）、04:44 三次启动均为 `Harness is ready`，04:27 安全模式之后无 `frontend plugin recovery`／`required client modules`。观察项：每次切换插件开关后窗口变空白，需重启生效（与市场「非纯 insert 需重启」一致，体验待改进）；停用后旧「CLI Worker」标签页显示「这类内容还没有可用的查看方式。」，不崩溃。未完成：约 900px 窄窗与交通灯遮挡检查（窗口拖拽缩放失败）、深色模式、Windows。测试中 Codex 在过期元素索引上误点，出现过 ZCode／Pi 账号终端，未输入任何账号信息；插件在 Desktop 数据目录新建了 `accounts/zcode*`、`accounts/pi`（Pi `auth.json` 为空对象）与 OMP receipt，均 0600，未读取内容，测试结束后无残留登录进程。
- rc.3 构建的真实 DSH Desktop 0.12.1（Harness 0.2.1-rc.2）验收（2026-10-24 15:52–15:58 CST，用户要求用子 agent 测安装与兼容；Codex gpt-6-astra high Computer Use，主会话核对 profile 与日志）：从 `072dcdb` 重建 preview 并打包 `.test-data/dsh-desktop-rc3-072dcdb/dsh-cliworker-now-0.8.2.tgz`（sha256 `cc583101…bfe0bc48`，runtime-host upstream `0.2.1-rc.3`／`1f81c047`）。经「插件 → 添加插件 → 安装第三方插件」覆盖安装：无报错，`pnpm add` 完成并 `promoted to dsh-cliworker-now+0.8.2+bd0ee336ac7b`；日志仅有 pnpm `missing peer` 警告（宿主提供，非失败）；界面提示「已安装的插件包解析到了另一个目录，或者更改替换了 DSH 安装自带的包」为 Desktop generation 覆盖链接的通用说明，未阻止安装。profile 的 generationProjection 与 pnpm override 指向 `bd0ee336ac7b`，其 manifest 为 rc.3。启用：主窗口、会话、CLI Worker 卡片与面板、面板设置、Harness 设置正常；会话头「更多操作」仅有「下载 Session 日志」「反馈」，无 rc.3 置顶项——该入口依赖 rc.3 宿主侧消费者，rc.2 宿主下缺失属预期。停用与重新启用后各重启一次均正常，无修复页；harness.log 07:54、07:56（停用）、07:57 三次 `Harness is ready`，全日 `frontend plugin recovery` 仅为 02:50/02:52 修复前两次。遗留：切换开关后窗口空白需重启；旧 CLI Worker 标签停用后显示「这类内容还没有可用的查看方式。」；未测窄窗、深色、Windows、真实任务与模型。
- 与下方「显示问题调查」的关系：用户反馈的「Desktop 中无法很好展示」实际由本节的市场行归属问题导致整页插件加载失败，而非样式缺陷；当前未观察到额外的 Desktop 专属样式问题。真实 Electron 窗口、Windows 标题栏与深色/窄窗矩阵仍未验收。
- 私有证据：指定 scratchpad 的 `ownership-final/`，含 `run.py`、诊断插件、五份日志/HTML/JSON 与 `results.json`。另用断言脚本核对所有行状态、模块路径、settings 值、revision 拒绝、HTTP 清单和退出码；当前源码、preview 和三份 scratch 包的 guard/patch 字节一致，package 版本均为 0.8.2。首轮 runner 仍遇沙箱 listen EPERM，获准后完成上述运行。
- 文档同步 README 中英文、doc/design.md 与 OpenSpec；保留上轮失败候选作为历史证据。正式 `pnpm build` 未执行：生成 guard 仅在 preview 中更新，避免影响可能链接仓库 lib 的真实 Desktop。没有改变版本、用户安装、应用数据、真实 profile 或模型任务；没有提交、推送或发布。真实 Desktop GUI、市场热切换往返、Windows 仍未验证。
- OpenSpec 收尾：7/7 任务完成，归档前 `spec:check` 25/25 通过；`spec archive fix-desktop-market-row-ownership --yes` 同步 package-distribution 的两条新增要求并归档至 `2026-10-24-fix-desktop-market-row-ownership`，主规格原有标题、Purpose 与要求保持。归档后 `spec:check` 24/24 通过；既有 release-v078-latest-install 的重复 ADDED 提示仍保留，本次未修改。`git diff --check` 通过。

### 2026-10-24：市场 UI 行归属候选调查（设置兼容阻塞，未实施产品修复）

以下为首轮历史记录，设置阻塞已由上节后续实现解决。

- OpenSpec：`fix-desktop-market-row-ownership` 已建立 proposal、规格增量、设计和任务清单，3/7 项完成，严格校验通过；产品实现与最终验收未完成，不归档。版本仍为 0.8.2，没有提交、推送或发布。
- 候选仅在指定 scratchpad 的 `ownership-audit/` 内修改：四个 insert id 改为 `cliworker-ui-*`，添加四个 stock id 顶层 `disabled: true`，副本 guard 接受新 id。仓库 `cordis.patch.yml`、guard、runtime-host 均未改；README/doc/design.md 未宣称新安装行为。
- 关键阻塞：两个宿主的原生设置固定使用 `ui-chat`／`ui-conversation`，SettingsForms 又按活跃 Loader id 提供表单并通过 configEditor 写回 profile。候选只提供 `cliworker-ui-chat`／`cliworker-ui-conversation` 表单，实际 `settings.update('ui-chat', {transcriptView:'compact'})` 在 Desktop 启用副本和 npm 官方副本均失败：`No configurable plugin entry "ui-chat"`。复制旧 config 或仅更换 namespace 不能保证实时编辑、重置、重启和卸载后的等价行为，不能合入这份候选。
- 市场源码与实际函数检查：候选 `bundlePatchInsertedIds` 仅返回六个 `cliworker-*` id；`carrierRowIds` 返回四个 stock id；`parseSimplePatch` 返回 null。市场切换路径会按 disable-carrier 移除／恢复 bundle，boot replay 本身只调用行禁用。给定 asar2 的 app-boot 还包含 `readDisabledProfileBundles`，会先跳过 state 中禁用的 bundle；仓库 npm app-boot 未发现该额外函数，不把两者视为逐字相同。
- 隔离运行 A：从给定 home-dd 新复制 home-a，重定位副本内 symlink、换入 preview 后施加候选，保留市场 disabled 列表；四个 stock fiber ACTIVE 且 disabled=false，没有插件客户端。B：另建 home-b，只从市场 disabled 列表移除本插件；ready={verified:true}，四个 vendored fiber ACTIVE，stock disabled=true。官方：使用仓库 npm Harness 0.2.1-rc.2、新 home-official、scratch 插件副本及仓库依赖图链接；得到同 B 的模块状态，但同样出现设置写入失败。
- HTTP 证据：从打印的 token URL 登录并保留重定向 cookie，三页均 HTTP 200；解析 `globalThis["__DSH_BOOT__"]` 的 entries，四个官方客户端包各恰好一次，插件入口 A 为 0、B/官方为 1；响应正文均无 `Failed to load plugins`。这是服务端引导清单证据，未运行浏览器 JavaScript，不代表 GUI 完整激活或设置等价通过。
- 实际验证命令均使用 `PATH=/opt/homebrew/lib/node_modules/corepack/shims:$PATH pnpm --config.verifyDepsBeforeRun=false`：`typecheck` 通过；`test tests/host-runtime-package.test.ts` 基线 6 项通过，加入真实 Loader/SettingsForms 设置边界回归后 7 项通过（configEditor 投影明确为模拟，模型未调用）；`build:preview` 通过，产物为未改产品实现的 `.cache/preview-package`；`spec validate fix-desktop-market-row-ownership --strict --no-interactive` 通过。测试 TMPDIR 指向指定 scratchpad；未执行全量测试或正式 build。
- 实验修正记录：首轮服务端口和 HTTP 读取被沙箱 EPERM 阻止，获准后重试；诊断插件最初漏声明注入、随后误用 inject 对象格式，修正为实际 Cordis 注入声明后重跑；官方 scratch 插件最初缺依赖解析链接，补上隔离副本的 node_modules 链接后重跑；首次 HTTP 请求未保留 cookie 得到 401，修正后为上述 200。这些均不作为产品验收失败或成功证据。
- 收尾：`pnpm spec:check` 为 25 项通过、0 失败；既有 `release-v078-latest-install` 仍提示模型目录 ADDED 与主规格重名，本次未处理。`git diff --check` 通过；格式通过不代表本次行为修复完成。
- 证据留在指定 scratchpad 的 `ownership-audit/{a,b,official}.log`、对应 HTML、`pages.json`、`shape.json` 和 home 副本；不入 Git。最终三服务均 Ctrl-C 退出（130），此前失败进程退出 1，未留测试服务。未触碰真实 Desktop、官方客户端 home、系统安装或用户 profile，未调用真实模型。待完成：原生设置兼容设计与实现、最终产品 A/B 和官方等价复验；真实 Desktop GUI、市场热切换往返、Windows 均未验证。


### 2026-10-24：DSH Desktop 0.12.1 显示问题调查（浏览器验收受阻）

- 范围：先读取 `AGENTS.md`、`doc/settings-ui-design.md`、`doc/openspec.md` 与 `openspec/config.yaml`；只检查提取到 `/private/tmp` 的 Desktop 代码、仓库与指定隔离环境。未操作 `/Applications`、用户 Application Support 或运行中的 Desktop；版本保持 0.8.2，未提交、推送或发布。
- 静态核实：preload 公开 `window.dshDesktop`；Windows 设置 `html[data-windows-titlebar]`、`--dsh-windows-titlebar-height:40px` 与 `body.dsh-desktop-windows-titlebar-layout`，另有菜单条、no-drag 和弹窗跟踪；main 使用 40px 高透明 titleBarOverlay。preload 的 140px 是 drag-region 的 CSS fallback，不是实测窗口按钮宽度。只加载 client-ui/workbenches 的 Web 环境缺少这些 preload 行为，后续窗口遮挡模拟必须考虑这一层。
- 尚不能判定缺陷：Desktop client-ui 的 56px padding selector 为 `[data-plugin-panel] > header[data-window-drag]`；插件 `.cwn-head` 没有这两个属性，不能仅凭该全局样式断言列表或设置受影响。宿主侧栏本身已有 Windows/fullscreen/macOS 标题栏规则；须以实际渲染确认额外留白是否必要。
- 浏览器阻塞：Playwright 的独立 Chromium 启动在沙箱内失败（SIGABRT / kill EPERM），提权请求被拒绝；Tabbit CLI 连接返回 `BROWSER_RUNTIME_CONNECT_DENIED`，其提权请求也被拒绝；CUA in-app browser 返回 `Browser is not available: iab`。本轮没有取得截图、注入 populated 夹具或完成浅深色/900px/宽屏/90%/110% 对照；不能把静态推断记为观察到的显示缺陷，也不能声称无缺陷。
- 已执行：`PATH=/opt/homebrew/lib/node_modules/corepack/shims:$PATH pnpm --config.verifyDepsBeforeRun=false typecheck` 通过；同前缀 `pnpm --config.verifyDepsBeforeRun=false test tests/client-registration.test.ts tests/panel.test.tsx` 为 2 文件 / 131 测试通过。未修改产品代码，未增加仅猜测检测条件的测试，未重建 preview、重启现有隔离服务、全量测试或创建/归档行为变更。后续观察到实际问题后再建立 `fix-dsh-desktop-display` 并实施。
- 私有证据：`.test-data/dsh-desktop-ui-0824/investigation.json`；该目录已由 `.gitignore` 忽略，临时安装的 `playwright-core` 仅位于其 `tools/` 下。待完成：双客户端 populated 列表、子会话原生输入框、设置入口与页头按钮截图矩阵；按观察结果修复并比较 native 前后像素/结构。真实 Electron、Windows 与真实账号均未验收。

### 2026-10-24：修复市场安装的宿主 peer 校验

- 根因（依据 Desktop 0.12.1 / Harness 0.2.1-rc.2 安装日志与解包源码核实）：市场安装器安装后检查所有必选 `react`、`react-dom`、`@deepseek-ai/*` peer，要求它们位于从 Harness app manifest 沿 dependencies + peerDependencies 得到的宿主可见范围。官方包把 `@deepseek-ai/dsh-client-store` 放在 devDependencies 并内联，插件却声明为必选 peer，导致 `generation peer validation failed: @deepseek-ai/dsh-client-store does not resolve from the installation closure`。
- 修复：移除 store peer（不改成可选），保留构建 devDependency；客户端内联官方 store 及 Zustand vanilla/middleware/shallow、Immer。相较重写本地 store，这只改构建配置并保留同步通知、订阅异常隔离与冻结语义；React、React DOM、Cordis、UI primitives 继续 external。Client 编译时将 `process.env.NODE_ENV` 和 `import.meta.env` 固定为 production 常量，避免新内联依赖在浏览器读取 Node/Vite 全局。
- 闭包差异：本地 `node_modules/@deepseek-ai/dsh@0.2.1-rc.2` 的 npm manifest 闭包另缺 `react`、`react-dom`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-slots`，经解包 Desktop 0.12.1 app.asar、按安装器规则复算宿主可见范围（611 个包），确认这四项在其中，测试据此以显式 allowlist 处理；计算器保持原始闭包，不填种子、不跟随 devDependencies，其他必选单例越界严格失败。store 有独立的闭包缺失负例，且硬性断言不在 peerDependencies/peerDependenciesMeta。
- 关联测试覆盖真实 npm SDK 闭包、旧 store peer 失败、嵌套声明者/循环/隐藏 package.json/可选 peer，以及实际模型目录打包内联引擎且宿主单例不被打包；无 process 的 VM 内运行实际打包 store，核对快照引用、同步通知、同引用去重与取消订阅，宿主单例探针明确模拟。测试不涉及真实模型。
- 已执行：`pnpm typecheck` 两次通过；`pnpm test tests/market-install-peers.test.ts tests/build-dependencies.test.ts tests/native-cli-model-directory.test.ts` 最终 3 文件 / 22 测试通过。新增回归在修复前确认失败；编写测试期间修正了闭包解析方式、入口探针与 VM 的宿主模拟。无 process 的 VM 首次暴露 Immer 初始化依赖 Node 全局，加入 production 常量后通过。
- 全量：沙箱内 `pnpm test` 执行完毕（150.77 秒），204 文件通过、10 失败、3 跳过；4092 测试通过、188 失败、13 跳过、17 个错误，日志包含 `listen EPERM 127.0.0.1` 和超时。单跑 `pnpm test tests/native-harness-lease.test.ts` 复现 2 失败 / 1 通过及 `listen EPERM`。按沙箱规则获准后运行 `pnpm test --bail 1`：第一次在新增 VM 的 process 依赖修复前失败；最终重试完成全部 217 文件（94.14 秒），214 通过 / 3 跳过、4280 测试通过 / 13 跳过、零失败。日志分别为 `.cache/market-peer-full-tests.log`、`.cache/market-peer-full-tests-unsandboxed.log`、`.cache/market-peer-full-tests-unsandboxed-final.log`；不把沙箱失败写成通过。
- 隔离构建：`pnpm build:preview` 共三次通过（同次修复前基线、初版内联、最终 production 常量版）。初版出现 Zustand `EMPTY_IMPORT_META` 警告；最终该警告及 Node/Vite 环境引用均已消除，仅保留既有 CJS 建议与 onlyBundle 提示，未改变 Harness 的 CJS module factory 封装。
- 最终 bundle 检查：`.cache/preview-package/lib/client.js` 无 store、Zustand、Immer 的 require/import；React、React DOM、UI primitives 保持外部引用，完整 sourcemap 无这些宿主单例及 Cordis 的打包源码。完整 Client 无 Cordis 运行时引用，内存打包探针另验证其 external 策略。无 `process.env`/`import.meta`，根目录既有 `lib/client.js` SHA-256 与修复前相同。客户端从 8,783,882 到 8,809,386 字节（+25,504，约 +0.29%），gzip 从 5,325,049 到 5,332,652 字节（+7,603）；证据 `.cache/market-peer-baseline.json`、`.cache/market-peer-bundle-verification.json`、`.cache/market-peer-preview-final.log`。
- 打包：在隔离 preview 执行 `npm pack --dry-run --ignore-scripts --json`，禁用 prepack，未运行正式构建。沙箱首次因 npm 缓存 `EPERM` 失败；获准重试后初版和最终版均通过，不修改缓存所有权。最终清单 845 文件，压缩大小 18,100,421 字节；包含 package.json 与 lib/client.js，待打包 manifest 与根清单 peer 完全一致（38 项），store 无 peer 或 peer meta，版本 0.8.2。dry-run 不生成实际 tgz；证据 `.cache/market-peer-pack-dry-run-final.json`、`.cache/market-peer-pack-verification.json`。
- OpenSpec：`pnpm spec context --json`、`pnpm spec list --json` / `list --specs`、`show package-distribution --type spec --json --no-scenarios`、`new change fix-market-install-peer-scope`、`status`、各产物 `instructions proposal/specs/design/tasks/apply` 均通过；已读取 package-distribution 完整主规格。`pnpm spec status --change fix-market-install-peer-scope` 为 4/4 规划产物完成；`pnpm spec:check` 严格校验 24 项通过、0 失败，另有其他既存变更 `release-v078-latest-install` 的归档重复需求 INFO，不在本次范围。Git 差异检查通过。
- 环境：shell 未暴露 pnpm，使用现有 Corepack shim（11.25.0），命令前置 `PATH=/opt/homebrew/lib/node_modules/corepack/shims:$PATH` 并传 `--config.verifyDepsBeforeRun=false`。首次裸 `pnpm spec list --json` 未找到命令；首次 `corepack pnpm spec context --json` 触发依赖自动校验，因无 TTY 中止，另有更新元数据联网失败。后续未重装依赖或改系统配置。
- 文档：README 中无需要调整的 peer 安装要求，因此中英文均未改。仓库未找到“适用于 … DeepSeek Harness 0.2.0-rc.2”的市场卡片源文案；相近旧基线见 `AGENTS.md:5`、`openspec/config.yaml` context 和 `doc/design.md` 历史基线，均不作为市场卡片来源修改。仓库无独立 CHANGELOG，发布说明流程见 `doc/release-template.md`，本节承载未发布记录。
- 独立复核：以 `.cache/preview-package/package.json` 对照 Desktop 0.12.1 app.asar 复算的 611 个宿主可见包，全部必选 peer 均在范围内；预览 `lib/client.js` 外部引用仅剩 `react`、`react-dom`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`，与旧产物相比仅移除 store；旧产物本无 `process.env`/`import.meta`，新增 define 不改变既有代码。
- 版本与边界：所有实际版本号保持 0.8.2；OpenSpec `fix-market-install-peer-scope` 不归档。本次未执行真实 Desktop 市场安装、Windows 平台实装、真实 CLI/账号/模型调用、正式 `pnpm build`、提交、推送或发布；未触碰 Desktop 安装、用户会话或 Application Support。

## 阶段 1：基础准备
- [x] 核验 Harness 0.2.0-rc.2、agy 1.2.16 和真实模型列表（规划阶段只读核验）。
- [x] 建立 AGENTS.md、设计文档和任务清单。
- [x] 初始化 main、提交基础文档、建立 feat/antigravity-mvp。
- [x] 建立锁定依赖及构建脚本。

## 阶段 2：原生接入
- [x] 独立 bundle 可安装、加载、卸载。
- [x] 原生右侧栏与 Host/Client RPC 可用。

## 阶段 3：执行闭环
- [x] 项目级模型选择与继承。
- [x] 流式解析、持久化、并发与会话互斥。
- [x] 停止、续聊、失败与中断恢复。
- [x] 后台完成结果回传父 Agent。

## 阶段 4：体验整合
- [x] 明确调用意图路由及四个模型工具。
- [x] 两层任务树、状态、模型标签、实时记录。
- [x] 明暗主题、窄侧栏、长路径与工具日志展示；滚动位置按贴底状态保持。

## 阶段 5：交付验证
- [x] 类型检查、测试、构建。
- [x] 隔离 Harness profile 集成验收。
- [x] 真实 Antigravity 运行、停止和续聊。
- [x] 安装到本机 Desktop profile 并验证。
- [x] README 安装、使用和卸载说明。

## 实际验证记录

2026-10-04：

- Git：`main` 基础提交 `51e08e0`；开发分支 `feat/antigravity-mvp`；本地身份 SuperWheel，无远程。
- 使用官方 0.2.0-rc.2 包与 Typert 生成器构建，Host/Client 类型检查通过。
- `vitest` 20 项通过：UTF-8 任意分片、畸形与超长输出、会话 ID 冲突、重复最终事件、未知事件、私有权限、锁与崩溃恢复、项目配置隔离、调度、并发互斥、排队取消、停止、认证/非零退出/缺结果、超时与输出限制。
- 真实 smoke：`gemini-3.8-flash-low / low`；首次读取随机 nonce 成功，同 conversation_id 续聊复述成功；另一个真实 CLI 在收到 init 后被停止，已 await 原生管理器的整个进程范围退出。证据 `.test-data/evidence/real-smoke.json`，原始记录留在 `.test-data/real-smoke/`，不入 Git。
- 隔离 profile：`.test-data/harness-home/profiles/cliworker-test`，官方 `dsh plugin add` 安装成功，宿主无插件激活告警，右侧栏及 Gateway 流可用。
- 原生模型问题卡片实际选择 `gemini-3.8-flash-low / low`；确认前没有 worker 进程，等待选择时终止宿主得到 ASK_ABORTED，未创建 worker。
- UI 测试父消息由明确标注的测试夹具创建。子 CLI 为真实调用，首轮返回 `CLIWORKER_UI_OK`；从侧栏续聊返回 `CLIWORKER_UI_OK FOLLOWUP_OK`。Harness Jobs 完成通知与父 Agent 总结实际出现。
- 随后在主对话实际输入“用 Antigravity CLI 新建另一个子 Agent…”，主 Agent 正确调用插件并沿用默认模型，无第二次选择；第二 worker 返回测试目录与 `SECOND_WORKER_OK`。任务树切换后记录互不混淆。
- 真实页面浅色、深色主题均已检查，约 360px 侧栏中模型标签、长路径和输入框可读。暗色截图 `.test-data/evidence/sidebar-dark.png`。

后续验证记录追加于此。

- 最终补充：原生 terminal 的 PID + 启动身份追踪，修复普通 pipe 进程组停止无法覆盖 CLI 工具另建进程组的问题。模拟 detached 子进程回归与真实 agy → Node 工具子进程回归均通过；真实 PID 36433 停止后返回 ESRCH，证据 `.test-data/evidence/real-stop-regression.json`。早期 shell/Python 夹具未产生 PID 标记，不计为通过。
- 增加最终聚合响应去重测试；20 项自动测试、构建、Host/Client 类型检查通过。
- 隔离 profile 官方 remove → add 成功。Desktop 原配置已私有备份，官方 add 完成；Desktop 插件页面显示 v0.1.0 已启用、1 个组件运行中，截图 `.test-data/evidence/desktop-installed.png`。Desktop profile 由 Electron 独占，CLI dump-config 不适用，改用原生插件管理页验收。
- 早期测试驱动手工写入的两份父会话日志不满足 Harness 回放契约；插件 worker 记录正常恢复。驱动已改为仅注册测试命令，不再写入任何父会话日志。旧夹具不计入完整恢复验收。

- 最终原生恢复验收：通过 Harness UI 全新创建会话“Antigravity CLI 恢复验证指令”，真实派遣得到 `NATIVE_RECOVERY_OK`。关闭并重启宿主，父历史正常回放、worker 记录恢复且无重复；侧栏续聊返回 `NATIVE_RECOVERY_OK RESUMED_OK`（页面恰有 1 条），证明保留原 CLI 上下文。截图 `.test-data/evidence/sidebar-recovered.png`。
- 界面显示来自 CLI 的原始公开粒度；不会承诺逐 token、未公开思维链或拦截任意外部 CLI。系统级双重 fork 后瞬时脱离祖先链等极端情况不在本轮验收覆盖内。

- 干净构建与打包通过；安装包 `artifacts/dsh-cliworker-now-0.1.0.tgz`，不包含测试夹具、凭据或运行数据。源码链接安装已完成，源码目录需保留原位。

## 阶段 6：体验与稳定性（v0.1.1）

用户选择优先完善体验与稳定性，继续保持 Antigravity 单 CLI、两层任务树。

- [x] 修复切换任务草稿丢失及异步操作结果串到其他任务的问题。
- [x] 断线保留记录、提供重新连接按钮；切换时不短暂展示其他任务的数据。
- [x] 保持历史阅读位置并提供回到最新消息入口。
- [x] 显示持久化错误和无法续聊原因；结束后不再把未完成工具显示为运行中。
- [x] UI 交互与宿主状态回归测试、原生侧栏验收、版本与文档同步。

### v0.1.1 实际验证（2026-10-04）

- 28 项测试通过（21 项 Host/协议/进程与 7 项 React 交互回归），Host/Client 类型检查通过。新增覆盖草稿隔离、延迟成功/失败归属、断线保留与重订阅去重、滚动位置、缺失会话 ID、父会话切换；恢复中断事件只追加一次。
- 完成结果改为独立快照，并验证续聊不改变已完成轮次的 runId/status/response。
- 在隔离 profile 安装预览包，已有 v0.1.0 历史正常读取。原生 UI 创建真实第二 worker“体验验收”，返回 `UI_STABILITY_OK`；两个 worker 的未发送草稿切换后分别保留。
- 真实 CLI 续聊生成 30 行记录，原生滚动至顶部出现“回到最新消息”；点击后距底部 0.5px。截图 `.test-data/evidence/sidebar-v0.1.1-history.png`。
- 观察到父 Agent 曾复述旧轮摘要，而侧栏实际内容正确。因此通知补充本轮任务/runId、续聊标签和读取当前结果的指引；不以模型自述作为验证依据。
- 自动重连失败入口使用受控断流的 React 测试验证；未以伪造数据充当真实 CLI 输出。

- 最终真实续聊返回 `V011_FOLLOWUP_OK`；磁盘状态 completed，runId `a8bc3b31-7b26-40a8-86ce-17b096efeac7`；父 Agent 实际引用了本轮结果与新运行编号。证据 `.test-data/evidence/v0.1.1-acceptance.json` 和 `sidebar-v0.1.1-final.png`。
- 正式干净构建、类型检查和 `pnpm pack` 通过，安装包 `artifacts/dsh-cliworker-now-0.1.1.tgz`。确认 Desktop 无活动 CLI worker 后更新链接包；原生插件页显示 v0.1.1 已启用、1 个组件运行中，截图 `desktop-v0.1.1-installed.png`。隔离验收服务器已停止。

## 阶段 7：历史浏览与任务查找（v0.1.2）

- [x] 原生分页读取已保存的完整逻辑记录，支持向前/向后翻页和返回实时。
- [x] 历史阅读期间保留当前位置，运行中的实时更新不覆盖历史页。
- [x] 按标题/模型/强度与状态筛选子 Agent，筛选不停止任务、不丢草稿。
- [x] 复制具体回复或本轮结果，明确成功/失败反馈。
- [x] 分页边界、身份隔离、并发新增事件及 UI 交互测试；隔离原生验收后升级 Desktop。

### v0.1.2 验证记录（2026-10-04）

- 35 项测试通过；新增覆盖 1,250 行记录完整回读、双向分页无重叠、实时追加不移动页边界、非法/跨任务游标、历史页对抗新快照与迟到请求、筛选保留选择和草稿、复制原文及拒绝写入的反馈。
- 隔离 profile 以 `maxTimelineItems: 10` 的仅测试 overlay 验收，使用已有真实 CLI 记录而非写入模拟对话；Desktop 正式默认仍为 1000。
- 原生侧栏中“体验验收”共 12 条逻辑记录：实时显示末 10 条，向前读取 1–2，向后读取 3–12，再返回实时。筛选标题及“进行中”状态符合预期，清除筛选后恢复列表。
- 点击复制最新结果显示成功；直接粘贴到未提交的输入框核对 `V011_FOLLOWUP_OK\n` 完全一致，随后清空，未派发新任务。浏览器自动化的虚拟剪贴板读接口返回空值，因此以真实 UI 粘贴验收为准。
- 隔离预览、正式构建、Host/Client 类型检查和打包通过；安装包 `artifacts/dsh-cliworker-now-0.1.2.tgz`。更新前确认 Desktop 无活动 worker，插件管理页已显示 v0.1.2 启用且 1 个组件运行中。
- 原生历史页截图 `sidebar-v0.1.2-history.png`、安装截图 `desktop-v0.1.2-installed.png` 和验收摘要 `v0.1.2-acceptance.json` 留在 `.test-data/evidence/`，不入 Git。隔离服务器与临时验收页面已关闭。本轮使用已有真实 CLI 记录验收，没有新增 CLI 推理调用。

## 阶段 8：多 CLI（v0.2.0）

- [x] 识别 CLI 与项目偏好隔离，兼容旧 Antigravity 数据。
- [x] Codex / Claude / Kimi / 官方 MiMo 的参数、协议和模型目录适配。
- [x] 侧栏 CLI 标识、独立默认设置与模型实际映射显示。
- [x] 模拟协议、配置隔离、能力限制与 UI 交互回归。
- [x] 隔离 Harness 原生界面验收、正式构建与 Desktop 更新。
- [ ] 四种新增 CLI 均完成真实首轮、续聊和停止验收。

### v0.2.0 验证记录（2026-10-04）

- 本机版本：Codex 0.160.0、Claude Code 2.1.176、Kimi Code 0.42.0。官方 MiMo 0.1.15 仅安装在项目缓存用于帮助与模型目录核验，不是全局安装或登录。
- 用户已选定真实验收配置：Codex gpt-6-luna / low，Claude sonnet / low，Kimi kimi-code/k3-256k / CLI 默认强度。
- Codex 与 Claude 的首轮随机标记回复及原会话续聊均通过，证据 `.test-data/evidence/multi-smoke.json`。Claude 本机 sonnet 别名实际映射为 glm-5.2[1M]；不能把本次成功表述为 Anthropic Sonnet 模型验收。
- Kimi 真实运行返回订阅访问权限 403、状态 failed；没有完成首轮或续聊，不重试消费，不修改订阅。
- MiMo 官方缓存 CLI --help 与模型目录解析通过（7 个模型）；没有执行真实推理，尚待安装/认证及用户模型选择。
- 模拟协议与回归测试目前 54 项通过；模拟数据不替代真实 CLI 验收。

- 用户随后安装官方 MiMo 0.1.15，路径 `~/.mimocode/bin/mimo`。插件识别官方用户目录安装位置，解决 Desktop 未加载 `.zshrc` 时找不到新命令的问题；该真实安装的模型目录已在原生侧栏读取。
- 最终 57 项测试通过，包含混合 CLI 同目录写任务排队、续聊不可换执行器、Kimi tool-only EOF 不误报成功、原生按钮提交类型与设置失败处理。Host/Client 类型检查、隔离构建、正式构建和 pack 通过。
- 原生 UI 暴露旧设置按钮默认为 type=button，已显式改成 submit；实际保存 Codex gpt-6-luna/low 后重新打开读取一致，磁盘偏好与旧 Antigravity 偏好分别存在。
- 原生混合任务树使用实际 smoke 的 worker/event 文件，导入到隔离 profile 的已存在父对话；标题明确“真实记录导入验收”，只调整插件测试数据中的父关联，未写入 Harness 主对话日志，不计为主 Agent 自然语言派遣的真实验收。
- 原生 UI 验证 Claude 实际模型、Kimi 默认强度与 403 错误、Codex/Kimi/MiMo 模型目录。截图 `.test-data/evidence/sidebar-v0.2.0-multi.png`。Desktop 无活动 worker 后更新，插件管理页显示 v0.2.0 已启用、1 个组件运行中。
- 安装包 `artifacts/dsh-cliworker-now-0.2.0.tgz`。Kimi 真实成功与续聊仍被账户权限阻止；MiMo 真实首轮和续聊已通过。各新增 CLI 的真实停止尚未分别验收，共享原生进程清理回归已通过。不可将这些未验收项写成已完成。

- MiMo 用户选定 `xiaomi/mimo-v2.5 / low` 后，真实随机标记首轮、同 sessionID 续聊均 completed 且回复匹配，证据 `.test-data/evidence/multi-smoke-mimo.json`；没有改为自动选模或其他模型。

- 最终原生页面展示六个直接 worker（含旧 Antigravity 与三种新增 CLI 的真实结果、Kimi 失败），MiMo 回复与模型/强度标签正确；Kimi 无会话 ID 时续聊禁用。最终截图 `sidebar-v0.2.0-mimo.png`、安装截图 `desktop-v0.2.0-installed.png`、验收摘要 `v0.2.0-acceptance.json` 均位于 `.test-data/evidence/`。隔离服务器在验收后关闭。

## CLI 卡片图标设计（2026-10-04）

- [x] 核验五类 CLI 的官方素材或本机官方应用图标。
- [x] 使用内置 image_gen 生成五组扁平图标，共六张 PNG（Kimi 分亮暗主题）。
- [x] 核查六张 PNG 均为 1254 × 1254 RGBA，四角完全透明；记录透明像素与主体边界。
- [x] 浏览器实看亮暗卡片中的 24px／32px 图标，保存 `doc/assets/cli-icons/v1/preview.png`。预览服务与临时页面已关闭。
- [x] 素材、来源说明、完整提示词和预览页保存到项目。
- [x] 图标已在 v0.3.0 接入正式父级页面并跟随 Harness 主题。

本轮没有修改业务代码或安装版本，没有调用真实 CLI，也没有重跑业务测试。验收范围为图标素材、透明通道和浏览器视觉展示。

### 项目独立图标（2026-10-04）

- 使用内置 image_gen 生成 CLI Worker Now 独立扁平图标，保存于 `doc/assets/project-icon/v1/`。
- 已目视检查图形，核查 PNG 的 RGBA 与四角透明；完整提示词和透明通道检查随素材保存。未接入运行界面，未运行业务测试。

### 项目图标第二轮（2026-10-04）

- 用户否定 v1 与 Codex 过于相似；已在素材说明中标记否定状态，保留历史文件。
- 使用内置 image_gen 新生成 A 会话气泡、B 任务分派、C Worker W 三张扁平透明 PNG，保存于 `doc/assets/project-icon/v2/`。完整提示词与 alpha 检查随素材保存。
- 已目视检查三张生成图并确认 RGBA 与四角透明；尚待用户选择，没有替换插件图标，没有进行业务代码变更或业务测试。

### 项目 Logo 会话可见方案（2026-10-04）

- [x] 根据项目的多 Agent 对话可视化特点，使用内置 image_gen 生成新设计稿 v3：打开的会话窗口、三条并列会话、实时状态圆点。
- [x] 原图、完整提示词、设计说明、HTML 预览和浏览器截图保存至 `doc/assets/project-icon/v3/`；未覆盖此前方案。
- [x] 检查 1254 × 1254 RGBA 原图的透明通道，并在浏览器实看亮暗背景及 24px／32px／48px 尺寸。
- [x] 用户已通过素材包选定 v3；v0.3.0 接入插件（此前设计稿阶段未修改业务代码）。

## 阶段 9：B 桌面侧栏设计（v0.3.0）

- [x] 父级按 CLI 分组卡片，子级独立对话与返回按钮；状态在话题后，元数据无“思考”前缀。
- [x] 桌面式消息与续聊框、子级标题去除模型/强度行；实际模型信息保留在任务选项。
- [x] 接入用户提供的七张透明原图，Kimi 随宿主主题切换。
- [x] 搜索、折叠、状态筛选、草稿、历史与停止交互回归。
- [x] 正式构建、打包、Desktop 更新；提交在本地开发分支，不推送远程。

### v0.3.0 实际验证（2026-10-04）

- 59 项测试通过（新增分组/折叠、两页导航、标题元数据与停止入口覆盖）；Host/Client 类型检查和隔离构建通过。
- 隔离 Harness 使用已保存的真实 CLI 记录验证五种 CLI 分组、搜索、返回保留草稿、异常筛选、历史 1–2/12 与返回实时；没有新增 CLI 推理调用，也不把导入记录当成本轮自然语言派遣证据。
- 亮暗主题在 Harness 原生设置内切换，七张 1254px 原图加载成功，Kimi 对应主题图片显示；约 365px 侧栏无横向溢出。
- 发现并修复屏幕阅读器隐藏标签导致的外层滚动溢出；输入框聚焦后标题仍位于侧栏顶部（y=38），长记录只在内部滚动。
- 页面证据保存在 `.test-data/evidence/sidebar-v0.3.0-*.png`，不入 Git。Kimi 原有账户 403 及新增 CLI 单独真实停止验收边界未改变。

- 最终隔离构建、正式构建、Host/Client 类型检查与 pack 通过。pnpm 11 在包版本变更后触发依赖自动重装检查，本轮依赖和锁文件未变，使用 `--config.verify-deps-before-run=false` 执行既有脚本，避免无关重装。
- 正式更新前确认 Desktop 状态目录无 worker 文件/活动任务；插件页刷新后显示 v0.3.0 已启用、1 个组件运行中。原生 Desktop 从侧栏引导打开新版总览空态成功；没有创建虚假任务。
- 安装包 `artifacts/dsh-cliworker-now-0.3.0.tgz`；安装与页面截图、验收摘要位于 `.test-data/evidence/`。隔离主题恢复原深色，验收服务器及临时页面已关闭。

## 阶段 10：原生控件与样式统一（v0.3.1）

- [x] 任务标题与元数据靠卡片左侧 12px 对齐，CLI 标题与任务列表添加分隔线。
- [x] 搜索直接使用原生 Input；筛选使用原生 Button 标准 36px 高度，不覆盖其字体和描边。
- [x] 自定义文字引用宿主字体尺度；对话与续聊响应原生字号设置；圆角、边框和阴影引用宿主参数。
- [x] 隔离亮暗主题/365px 侧栏验收，正式构建与 Desktop 更新，本地提交。

### v0.3.1 实际验证（2026-10-04）

- 16 项 React 页面回归通过；Host/Client 类型检查、隔离构建、正式构建与 pack 通过。本轮未重复运行未改动的 Host/CLI 进程测试，也未新增模型调用。
- 原生搜索输入“体验”仅显示对应任务，进入子页正常；365px 侧栏无横向溢出。标题与元数据实际左边距均为 12.5px（含半像素卡片边框）。亮色卡片和标题分隔线为 0.5px rgba(0,0,0,0.1)，暗色同样使用宿主语义色。
- 在隔离 Harness 设置将字号 14→15，插件正文与续聊框均实时变为 15px，恢复后均为 14px；恢复原深色主题。输入框圆角与主 composer 相同，读取宿主 panel=28px 与 elevation-soft 阴影。
- 更新前 Desktop 无活动 worker；插件管理页显示 v0.3.1 已启用、1 个组件运行中。返回主页面后新版总览正常，未创建模拟任务。隔离服务器和验收页面已关闭。
- 证据 `.test-data/evidence/sidebar-v0.3.1-light-overview.png`、`sidebar-v0.3.1-dark-overview.png`、`sidebar-v0.3.1-dark-conversation.png`、`desktop-v0.3.1-installed.png`；安装包 `artifacts/dsh-cliworker-now-0.3.1.tgz`。

## 阶段 11：消息与 composer 对齐（v0.3.2）

- [x] CLI 入口浅色扁平背景；原生设置、复制、发送图标；搜索框 38px 且移除聚焦蓝圈。
- [x] 原生安全 Markdown 回复，时间/复制操作置于消息下方，24 小时制时间。
- [x] 原生 composer 几何/发送按钮/底栏，取消拖高，内容自动增高。
- [x] 原生模型菜单与强度子菜单，严格区分当前会话固定配置和新任务默认配置。
- [x] 隔离及 Desktop 验收、构建打包和本地提交。

### v0.3.2 实际验证（2026-10-04）

- 17 项 React 交互回归通过；新增验证菜单只写项目/CLI 默认配置，不触发 followup、不更改当前 worker 模型。Host/Client 类型检查、隔离构建、正式构建和 pack 通过。
- 同一个隔离原生页面测量：主 composer 与插件空输入框都高 98px、圆角 28px；插件发送按钮高 34px，背景 rgb(65,118,230)。搜索框高 38px，focus 后 outline=none、shadow=none，描边为 0.5px rgba(0,0,0,0.12)，CLI 入口背景为白色。
- 四行未提交草稿令 textarea 自动变为 100px，resize=none，根侧栏 top 仍为 38px；清空恢复。子会话 Markdown、时间、复制按钮、模型菜单、CLI 真实模型与强度子菜单正常呈现；亮暗主题验收通过。
- 使用既有真实记录；没有新增推理调用，没有修改已保存模型偏好。隔离主题恢复深色，浏览器尺寸恢复，测试页面和服务器关闭。
- 正式更新前 Desktop 有 1 个历史 worker、0 个活动 worker。插件页显示 v0.3.2 已启用、1 个组件运行中；用户已有“说一句你好”对话实际加载新版时间/复制/模型菜单和 composer。
- 安装包 `artifacts/dsh-cliworker-now-0.3.2.tgz`。截图位于 `.test-data/evidence/`：`sidebar-v0.3.2-overview.png`、`sidebar-v0.3.2-conversation.png`、`sidebar-v0.3.2-model-menu.png`、`sidebar-v0.3.2-dark-conversation.png`、`desktop-v0.3.2-installed.png`、`desktop-v0.3.2-conversation.png`。

## v0.3.3 — 模型选择、真实耗时与 Desktop 404 修复（2026-10-05）

- [x] 根因复现：旧 Desktop Host 未重新加载新增 Remote 接口，Client 的 `catalogForCli` 返回 HTTP 404。完整退出并重新打开 v0.3.2 后，同一实际会话设置页恢复模型及强度；由此确认并更新安装说明，不能以插件页刷新/版本号作为接口验收。
- [x] 实际 `agy models` 核验：Flash 3.8/3.7/3.6 各 low/medium/high；Pro 3.1 仅 low/high；GPT-OSS 120B 仅 medium；Claude 型号未公开等级，保守沿用 CLI 配置。
- [x] 按真实目录合并家族名称、保留执行 ID 映射；支持旧 raw ID 偏好，禁止未知强度；默认设置和当前会话配置分别保存。
- [x] 新 `configureWorker`：校验归属、CLI、目录与空闲状态；更改下一轮型号/强度，保留会话 ID 和历史；运行中拒绝变更。
- [x] 模型菜单采用原生 Menu/Input 与 ModelSelect 的模型/强度两项入口；模型可检索。发送按钮采用原生 InputBar 的准确 SVG 路径与 34px 几何，不再使用不同的线条图标。
- [x] 基于完整事件的每轮耗时，分页后仍可展示；展开公开状态、工具及诊断，明确不补写未公开思考。原始 transport 报错改为可操作的中文提示与重试。
- [x] `pnpm test`：4 个文件、64 项通过，含真实子进程组清理。`pnpm build:preview`、`pnpm build`、`pnpm typecheck`、打包均成功。
- [x] 隔离真实 UI：模型菜单 7 个去重选项；切换 Pro 后只有 low/high；切换 Flash low→medium 持久化成功。真实续聊 run `5dd9bfa8-6ccf-48fb-b0a1-d2eb362ec5e4` 返回 `MODEL_SWITCH_OK`，状态 completed；原始 init 实际模型 `gemini-3.8-flash-medium`，conversation ID 仍为 `30229a34-d379-4b19-a844-fae0c0470a5b`。这是新真实请求，不是模拟记录。
- [x] 隔离暗色窄侧栏视觉核验：工作过程显示 13 秒、菜单等级与原生发送图形；证据 `.test-data/evidence/v0.3.3-pro-efforts-dark.png`。
- [x] 正式更新前确认 Desktop 活动 worker 为 0；已生成 `artifacts/dsh-cliworker-now-0.3.3.tgz`。
- [ ] 正式 Desktop 最终交互验收：更新后已执行正常退出，重新打开时 Mac 锁屏，等待用户解锁；不得将此阶段标为已验证。

### 项目 Logo Cli 字形修订（2026-10-05）

- [x] 内置 image_gen 按用户标注修改，原图与提示词保存至 `doc/assets/project-icon/v4/`，保留之前版本。
- [x] 目视检查 Cli 构形与内容移除，核验 PNG 的 RGBA、透明像素与四角透明；原样复制一份到本地素材包文件夹。
- 此次仅修改设计素材，未接入插件，未运行业务测试。

### 项目 Logo 紧凑等高版（2026-10-05）

- [x] 内置 image_gen 编辑 v4，统一 C 主体、l 与 i（含圆点）的上下边界，缩窄 C 与留白。
- [x] 目视检查形状，核验透明通道；原图、提示词和检查结果保存至 `doc/assets/project-icon/v5/`，另复制到本地素材文件夹。
- 本轮未修改业务代码或安装版本，未运行业务测试。

### 项目 Logo 柔和人文版（2026-10-05）

- [x] 用户认可 Cli 基本样式；使用内置 image_gen 优化曲线、比例和双蓝色，并再调整字母间隔以便缩小显示。
- [x] 原图、两步提示词和 alpha 检查保存至 `doc/assets/project-icon/v6/`；保留之前版本。
- [x] 浏览器实看亮暗背景中的 24／32／48px，保存 HTML 与截图。24px 可辨识，推荐标题旁采用 32px 以更清楚呈现间距与尾部。
- 本轮为设计素材迭代，未接入插件，未运行业务测试。

## v0.3.4 — 菜单返回与按钮悬停（2026-10-05）

- [x] 模型及强度子菜单共用顶部返回项；按钮去除静态描边，使用宿主主题色与 180ms 颜色过渡，保留键盘焦点及减少动画偏好。
- [x] 类型检查、18 项 React 界面测试、隔离构建、正式构建及打包通过；安装包 `artifacts/dsh-cliworker-now-0.3.4.tgz`。
- [x] 隔离暗色页面验证模型目录、顶部返回及强度选项；实测按钮 border 为 0px、transition 为 0.18s。截图 `.test-data/evidence/v0.3.4-effort-preview.png`。
- [x] 正式更新前活动 worker 为 0；Desktop 热加载后实际打开模型和强度菜单，均显示顶部返回、真实目录与 low/medium/high，无 404。截图 `.test-data/evidence/v0.3.4-desktop-model.png`、`v0.3.4-desktop-effort.png`。
- 本轮没有新增 CLI 推理或修改会话模型配置。此前锁屏造成的 Desktop 菜单验收阻碍已解除；本轮验证范围为菜单交互和外观。
- 已关闭本轮隔离浏览器页面及测试服务器，保留 Desktop。

### 项目 Logo 近正方形版（2026-10-05）

- [x] 内置 image_gen 在 v6 基础上调整纵向比例，保留原有设计语言。
- [x] 第一轮主体宽高比 1.382:1，继续修订后实测约 1.004:1；验证透明通道，原图与两步提示词保存至 `doc/assets/project-icon/v7/`。
- 此轮仅交付设计素材，未接入插件，未运行业务测试。

### 项目 Logo 舒展比例版（2026-10-05）

- [x] 根据用户要求放宽整体比例，使用内置 image_gen 从 v7 调整；两步提示词和透明原图保存至 `doc/assets/project-icon/v8/`。
- [x] 第一轮实际约 1.499:1，进一步调整后约 1.379:1；按实际测量记录比例，不将提示词目标当作结果。
- [x] 浏览器查看亮暗背景与 24／32／48px 效果，图片等比显示，保存预览页与截图。
- 仅更新设计素材，保留历史版本；未修改业务代码、安装版本或运行业务测试。

## v0.3.5 — 回复与底栏真实用量（2026-10-05）

- [x] 回复栏增加真实 Token 用量与原生日历格式；输入框底栏按左侧状态、中间 Token、右侧上下文圆环排列，复用原生数据库/仪表图标与 13px 次级字号。
- [x] 从私有原始日志只读增量恢复旧记录，区分回复、任务与 CLI 会话统计口径；同一快照不重复计数、历史分页不影响当前底栏；无记录时显示 `—`。
- [x] Antigravity 实际输出只有用量、没有当前上下文占用/容量；显示未知值和解释，不以累计用量生成虚假百分比。
- [x] 灰色/禁用按钮及 summary 增加平滑 hover，保留 disabled 操作限制与减少动画偏好。
- [x] 类型检查通过；全套 5 文件 72 项测试通过（首次沙箱内的进程清理测试被 ps 权限阻止，在批准的执行环境中重跑全套通过）。之后日期/读数边界微调，26 项相关回归与类型检查再次通过。
- [x] 隔离构建及暗色窄侧栏检查通过：旧 Antigravity 两次回复分别 21.5K、5.4K tok，底栏会话累计 26.9K tok；三项底栏同为 y=951、13px 字号。按钮 border=0px，transition=0.18s。截图 `.test-data/evidence/v0.3.5-preview-usage.png`。
- [x] 正式更新前活动 worker 为 0，构建、打包后完整重启 Desktop。原有“说一句你好”回复真实用量 20851 tokens 显示为 20.9K tok，日期显示 10月4日 22:19，底栏同样显示 20.9K tok。截图 `.test-data/evidence/v0.3.5-desktop-usage.png`。
- [x] 安装包 `artifacts/dsh-cliworker-now-0.3.5.tgz`；关闭隔离页面与服务器。本轮未新增 CLI 推理、未修改用户会话或偏好。


## v0.3.6 — 原生交互与上下文占用（2026-10-05）

- [x] 分隔线改用 Harness WorkStatus 的 border-l2。隔离暗色界面实测原生与插件均为 0.5px solid rgba(255,255,255,0.12)，高度 33px、100ms 颜色过渡。复制按钮均为 28px、8px 圆角，使用原生 Tooltip；菜单复用原生 Menu、原生箭头/选中图标及对应尺寸。
- [x] 回复与底栏的用量改为可点击详情，上下文使用原生定位/外部点击关闭能力、264px 详情面板；隔离验收确认 Esc 和点击外部关闭，两级菜单返回均在顶部。底栏状态恢复彩色圆点。
- [x] CLI 1.2.16 的模型目录和流式输出缺少上下文容量；核验其嵌入 protobuf 描述和插件所管理会话的 SQLite 元数据，增加只读可选适配。真实“说一句你好”读数为 28,757 / 256,000，显示 11%，明确为最近一次请求的 CLI 估算。
- [x] 新增 5 项模拟 protobuf/SQLite 测试：字段解析、非法值与未知字段、只读不修改数据库、归属与路径校验、最新元数据与缓存失效。类型检查及 6 文件 77 项测试通过；首次普通沙箱测试的 ps EPERM 在获准的执行环境中重跑通过。
- [x] 隔离构建、暗色界面验收、正式构建和打包通过。更新前 Desktop 活动 worker 为 0；完整重启后，在真实 Desktop 会话打开上下文详情并核验数值、日期、Token 与绿色圆点。最后修复无用量日志时仍可提供上下文，类型检查、77 项测试及两种构建再次通过。
- [x] 截图：.test-data/evidence/v0.3.6-preview-menu.png、v0.3.6-preview-context.png、v0.3.6-desktop-context.png。安装包 artifacts/dsh-cliworker-now-0.3.6.tgz。
- 本轮没有新建 CLI 推理、改动会话模型偏好或修改原始 Antigravity 数据库。主题和原生组件仍以 Harness 0.2.0-rc.2 为适配基线；CLI 未提供有效上下文时保留未知值，不承诺所有 CLI 都有该数值。

## v0.3.7 — 暗色卡片、悬停反馈与 v8 Logo（2026-10-05）

- [x] 暗色分组卡片与未选中筛选按钮共用 interactive-bg-hover；隔离界面实测两者均为 rgba(255,255,255,0.08)，取代过亮的 elevated-fill。
- [x] 顶部入口移至原生 header.utilities 尾部，移除 CLI 文字及计数，仅保留 Logo、无障碍名称与原生 Tooltip；Desktop 实际点击入口正常。
- [x] 项目入口、侧栏标题、空状态使用 v8 透明原图，SHA-256 与设计源文件一致，object-fit:contain 保持比例；侧栏图标槽实测 32 × 32px。各 CLI 品牌图标不变。
- [x] 恢复灰色按钮 180ms ease 的背景色、字体颜色及透明度过渡；实际 DOM 计算样式确认生效；禁用控件保留 disabled，减少动态效果设置保留。
- [x] 类型检查、18 项 React 界面回归、隔离及正式构建、打包通过。更新前活动 worker 为 0；Desktop 自动加载新 Client，实看亮色布局与右侧图标入口。
- [x] 验收截图：.test-data/evidence/v0.3.7-preview-dark.png、v0.3.7-desktop-light.png；安装包 artifacts/dsh-cliworker-now-0.3.7.tgz。
- 本轮仅界面/资源变化，没有启动新的 CLI 推理或修改用户会话配置；关闭隔离页面与测试服务，保留 Desktop。

## v0.3.8 — 白天灰色按钮悬停修复（2026-10-05）

- [x] 定位：亮色默认灰底与 hover-solid 视觉近似，只有 transition 并不能产生可见变化。亮色灰色筛选按钮、返回及禁用灰色控件悬停改用原生 interactive-bg-active，保留 180ms ease 和减少动态效果偏好；不改变暗色与已选筛选按钮。
- [x] 隔离构建后切到浅色实际验证：未选中“进行中”按钮 aria-pressed=false，默认 rgba(38,49,72,0.06)，真实 :hover=true 时最终为 rgba(38,49,72,0.1)，捕获到动画中间色，transition 为 0.18s。截图 .test-data/evidence/v0.3.8-light-hover.png。
- [x] 本轮仅 CSS 与版本文档变化，未新增或重复业务测试。隔离及正式构建、打包通过；更新前活动 worker 为 0。安装包 artifacts/dsh-cliworker-now-0.3.8.tgz。

### 项目 Logo 饱满对话版（2026-10-05）

- [x] 使用内置 image_gen 编辑 v8：放大对话尾部、明显缩小 C 留白并调整字母比例。
- [x] 目视检查变化并核验 RGBA、透明通道和复制一致性；原图与提示词保存至 `doc/assets/project-icon/v9/`。
- 本轮仅交付设计素材，未接入插件，未重新进行浏览器小尺寸验收或运行业务测试。

### 项目 Logo 收窄协调版（2026-10-05）

- [x] 内置 image_gen 调整 C 占比和字母比例，保存 `doc/assets/project-icon/v10/`；按用户要求不另存或展示提示词。
- [x] 目视检查形状，核验透明通道；未接入插件，未运行业务测试。

### 选定 Logo 与整体效果图（2026-10-05）

- [x] 用户选定 v10 Logo；设计记录已同步。
- [x] 内置 image_gen 制作四栏整体概念图，包含父子页面与亮暗主题，已目视检查并保存至 `doc/assets/overall-preview/logo-v10/overview.png`。
- 本轮未修改业务代码或安装版本，图中对话与状态均为示例。

### 项目 Logo 草图整理版（2026-10-05）

- [x] 内置 image_gen 根据用户新草图制作蓝色透明 Logo；保留草图来源，未另存提示词。
- [x] 目视检查短上沿、长底边和内部 li，核验透明通道，保存至 `doc/assets/project-icon/v11/`。
- 本轮仅修改设计素材，未接入插件，未运行业务测试。

### 项目 Logo 紧凑扁平版（2026-10-05）

- [x] 按用户澄清去掉笔绘风，改用平滑规则轮廓并收紧内部间距；保存至 `doc/assets/project-icon/v12/`。
- [x] 内置 image_gen 编辑，目视检查形状并核验透明通道；未另存提示词。
- 仅更新设计素材，未接入插件，未运行业务测试或浏览器小尺寸验收。

## v0.4.0 — 原生设置弹窗、账号管理与局部加载（2026-10-05）

- [x] 工具栏入口使用原生 utilities、order=-20，位于 Finder(-10) 左侧；24px 小按钮、16px Logo。隔离 DOM 实测入口24×24px，Finder含外框高24px。取消侧栏标题下分隔线。
- [x] 设置复用 Harness Modal/Menu/Button/StateDot，5个CLI导航、账号区、项目默认区，继承亮暗主题。目录、账号、保存分别异步加载；切CLI/关闭取消并隔离迟到响应，不再使用Panel全局busy锁。
- [x] 账号管理使用经过本机核验的各CLI原生参数与PTY，安全状态摘要、登录/切换/退出入口；AGY与Kimi部分操作由用户在TUI输入原生斜杠命令。账号操作与同CLI任务互斥；主会话/插件关闭、中途取消和断流清理；超时和有界内存，无账号日志持久化。
- [x] 119项测试通过（9文件）：25项账号后端、7项账号终端、7项设置、19项Panel及原有协议/进程测试。覆盖跨父会话隔离、启动竞争、关闭与迟到启动、旧CLI响应、真实进程组清理和未确认清理后阻止改账号。初次普通沙箱ps被拒绝，使用获准环境运行完整测试通过。
- [x] 类型检查、隔离构建、正式构建及打包通过。完整更新前确认Desktop活动Worker为0；Desktop重启后实际点击设置，Codex真实状态显示“已通过ChatGPT登录”，模型和强度可选择，无404。
- [x] 隔离界面真实只读验证Codex、Claude、Kimi、MiMo状态；未知/配置存在与已认证严格区分。模型原生菜单、加载圆圈、切CLI、关闭、亮暗主题可用。
- [x] 独立模拟CLI真实PTY验收：界面明确显示“模拟账号终端”，输入ping收到ECHO: ping；关闭终端以及关闭设置两种路径后检查PID均不存在。深色终端跟随主题；修复亮色viewport黑底条。未运行真实登录/退出、未改用户账号或模型默认值。
- [x] 截图 .test-data/evidence/v0.4.0-settings-light.png、v0.4.0-settings-dark.png、v0.4.0-account-terminal-dark-fixture.png、v0.4.0-desktop-settings.png；安装包 artifacts/dsh-cliworker-now-0.4.0.tgz。隔离测试服务器和页面已关闭。


## v0.4.1 — 独立 CLI 开关与稳定设置页面（2026-10-05）

- [x] 每个 CLI 使用 Harness 原生 Switch 独立持久化；关闭后灰化，本次不移动，重新打开/页面刷新后稳定排到末尾。内容顶部始终显示该 CLI 图标与名称。
- [x] 已登录绿色、明确失败红色、未核验灰色；模型目录失败单独记录，不再混成“尚未检测”。不把本地凭据当作认证成功。
- [x] 固定弹窗高度700px并受原生最大可用高度限制，右侧独立滚动；账号摘要/按钮/选择器/说明预留固定空间，spinner位于标题固定槽。控件加载前后DOM和实际坐标不变。
- [x] 原生md按钮统一36px；原生Switch保持36×20px；下拉框及展开菜单实测300px。修复通用hover选择器覆盖active底色的问题，灰按钮实测静态rgba(38,49,72,0.06)，真实hover rgba(38,49,72,0.1)，180ms过渡保留。
- [x] Host在异步选择前后及最终提交校验开关；禁用后不能派遣/续聊/查询目录/探测账号/修改配置/开启账号终端。运行或排队任务与账号终端阻止关闭；历史/任务状态/停止保留。取消信号在读写开关前检查。
- [x] 142项测试通过（10文件），含10项开关持久/竞争/取消约束、20项设置状态和加载布局、19项Panel、25项账号管理及原进程/协议测试。Host+Client类型检查、隔离构建、正式构建、pack均通过。
- [x] 隔离原生Harness真实UI验收：加载前后modal700px、账号按钮/模型选择器/保存按钮位置完全相同；Codex单独关闭后灰化且原位，重开排末，恢复开启成功；亮暗主题、真实目录与账号状态可读。测试开关已恢复全开；未执行登录/退出或修改模型默认值。
- [x] 更新前确认Desktop活动worker为0；重启后实际打开新设置页，开关和模型查询可用，无新增RPC404。证据见 .test-data/evidence/v0.4.1-settings-light.png、v0.4.1-settings-dark.png、v0.4.1-settings-disabled-dark.png、v0.4.1-desktop-settings.png。安装包 artifacts/dsh-cliworker-now-0.4.1.tgz。


## v0.4.2 — 原生设置层次与登录身份（2026-10-05）

- [x] 原生设置页排版：40px品牌图标、24px CLI大标题与副标题；左说明/右控件、细分隔线，导航188px、弹窗800px，模型/强度控件240px；保持36px按钮、固定高度、独立滚动与灰色悬停过渡。
- [x] 账号区显示绿色点+“已登录”及安全邮箱；API只显示“API 登录”。本地会话与CLI状态明确区分来源；读取中、失败及关闭后隐藏旧邮箱。摘要固定52px，不因有无身份跳动。
- [x] AGY按已安装CLI格式读取本地OAuth元数据，仅投影邮箱并标明未远程验证。Codex使用自身account/read获取有效账号源，拒绝通过可能过期的auth.json猜测；4秒/64KiB限制并等待进程范围清理。Claude仅投影已登录claude.ai邮箱，MiMo只显示API方式，Kimi配置仍不是已登录。
- [x] 167项测试（12文件）与Host/Client类型检查通过。新增账号投影/过期/异常/密钥排除、Codex RPC握手/取消/清理及客户端状态边界测试。独立复核44项账号相关测试通过。
- [x] 隔离构建通过；真实Harness浏览器验证AGY绿色状态+邮箱+本地来源、Codex邮箱来自CLI、MiMo API标签无账号字段。未执行真实登录/退出、没有更改账号或模型偏好。
- [x] 隔离亮暗主题验证通过。1280×720窗口modal受限为672px；加载前后摘要Y=242、模型按钮Y=442.5不变，控件240px、摘要52px。浅色按钮实测default rgba(38,49,72,0.06)，hover rgba(38,49,72,0.1)，transition 0.18s。截图 .test-data/evidence/v0.4.2-settings-light.png、v0.4.2-settings-dark.png。
- [x] 正式构建、构建后类型检查与打包通过；更新Desktop链接前确认活动worker=0。安装包 artifacts/dsh-cliworker-now-0.4.2.tgz。隔离服务与测试页已关闭，测试主题恢复。
- [x] 用户解锁后完成Desktop重启验收（2026-10-05 13:12）：确认链接当前0.4.2、活动worker及账号终端为0，重启成功。AGY显示大标题、绿色已登录及邮箱和本地来源说明；Codex显示实际账号，MiMo仅显示API登录；模型目录可加载，原生模型菜单可展开并关闭。未登录/退出或修改账号、开关及模型偏好。截图 .test-data/evidence/v0.4.2-desktop-settings.png。


## ZCode 隔离可行性验证（2026-10-05）

- [x] 本机 ZCode 3.14.4 / CLI 0.16.9 的真实帮助、NDJSON capabilities、反向 runtime preferences 请求与空会话验证；实现 scripts/probe-zcode.mjs，不修改正式执行器。
- [x] 最终离线复测三项 sandbox 边界通过：测试目录可写、目录外拒写、plan 工作区拒写；空闲 app-server SIGTERM 退出及进程组清理通过。证据 .test-data/zcode-probe/run-o2uMDT/report.json；未发送 prompt。探针语法、Prettier 与 git diff --check 通过。原始事件、退出状态与哈希不入 Git。
- [x] 用户明确选择 GLM-5.3-Flash；根据官方目录选择 low 进行短任务验证。首次复用桌面账号的首轮报 Select a model before continuing，当时未执行续聊；后续独立授权结果见下。
- [x] 临时构建官方完整 CLI：独立 Node 24.14.0 / pnpm 10.33.2、冻结锁文件、跳过安装脚本；17 个相关 workspace 构建及完整 CLI 离线探针通过。未替换桌面安装。
- [x] 完整 CLI 原生 BigModel 登录可生成授权链接；首次等待超时并清理退出；续接重新授权成功，见下。探针与接入门槛记录在 doc/zcode-probe.md。
- [x] 续接完成独立 BigModel 原生授权；GLM-5.3-Flash / low 的首轮、同会话续聊、Write JSON 产物和真实流式输出中 SIGTERM 取消均通过。证据 .test-data/zcode-probe/run-4XC18i/report.json；取消退出 143、无最终 result，进程组退出确认通过。
- [x] 只读核验 CLI 数据库：真实选型 GLM-5.3-Flash / low；规划为 mode=build 且 planEnabled=true，文件任务为 edit 且 planEnabled=false。脱敏证据 run-4XC18i/runtime-verification.json。
- [x] build 模式 Write 产生 permission.requested 与 permission.resolved(deny)，目标文件不存在；证据 run-r9wKpm/report.json。CLI 仍退出 0，正式适配必须单独判断权限拒绝。
- [x] 后续已完成正式适配与隔离插件验收；本条仅为探针阶段记录，最终结果见 v0.5.0。


## 六项 CLI 验证汇总（2026-10-05）

- [x] Grok 1.0.0 离线帮助、目录、ACP 与空闲停止/沙箱通过；按用户要求不做订阅模型调用，见 doc/grok-probe.md。
- [x] OMP 16.4.4、Pi 1.0.2 复用用户授权的智谱 GLM-5.3-Flash / low，真实首轮、原会话续聊、Write 产物、沙箱拒写和流中取消通过；OMP 显式 write 审批并关闭模型回退，见 doc/pi-omp-probe.md。
- [x] Harness 0.2.0-rc.2 同一智谱选型的真实首轮、续聊、Write 与只读拒绝通过；独立原生 sandbox 下已观察真实 sleep 后代启动、SIGTERM 后完整清理。双层 Seatbelt 的失败记录保留，见 doc/harness-probe.md。
- [x] OpenCode 1.18.21 的免费 MiMo 原生 run/serve 均远端403；经用户改选智谱后，首轮、续聊、实际文件、SSE中取消和原生权限询问拒绝通过，见 doc/opencode-probe.md。
- [x] ZCode 探针加强 Write 的调用ID/路径/成功结果关联，以及权限 requestID/toolCallID 对应；已有真实事件离线复核通过，没有为此追加模型调用。
- [x] 五个新增探针语法/格式检查和原始报告复核完成。凭据与运行数据均留在忽略目录；未修改原账号配置。
- [ ] 统一接入在隔离 worktree 开始；本次验证提交不代表插件已构建或 Desktop 已更新。


## v0.4.3 — 正式 Logo、紧凑账号操作与登录弹窗（2026-10-05）

- [x] 已确认 official-v1 为最新选定原图，逐字节复制到运行素材，SHA256 `1dab209b70d93af5571dfc24663b6be2b746e48b61d2093f94fddd2cb6156318`；字标与NOW标记使用原生字体/主题，工具栏同步新标志。
- [x] 账号/退出/切换入口同行、红色退出紧邻账号；按用户追加要求恢复切换账号和账号终端的原生浅描边按钮。刷新图标化，移除3条正文说明；账号来源仍可悬停查看。
- [x] 独立原生账号弹窗；初始化失败、20秒等待、12秒清理等待、30秒Host分配上限、重试、迟到终端与取消/断流清理均有明确反馈与互斥。只读复审未发现阻止交付的问题。
- [x] 全套189项测试（12文件）通过；最后描边样式改动后额外设置测试37项及Host/Client类型检查通过。两次隔离构建均成功。
- [x] 隔离Harness真实UI验证亮暗设置页与标题；原生描边实测0.5px、浅色 rgba(0,0,0,0.12)，按钮36px，颜色过渡0.18s。模型查询、设置关闭与局部加载可用，保存按钮在可视范围内。
- [x] 明确标注“模拟账号终端”的真实PTY：点击登录即出现独立弹窗，输入ping得到ECHO: ping；关闭账号弹窗后设置仍可操作，PID5513已不存在。未触发真实登录/退出或修改默认模型/账号。截图 `.test-data/evidence/v0.4.3-synthetic-account-terminal.png`、`v0.4.3-settings-light.png`、`v0.4.3-settings-dark.png`、`v0.4.3-overview-light.png`。
- [x] 隔离预览标签/服务器已关闭，测试主题恢复深色。Desktop更新前活动worker为0、无打开的账号终端。
- [x] 正式构建、构建后类型检查及pack通过；Desktop重启后实际确认新Logo字标、账号同行操作、浅描边按钮、刷新图标与目录加载。截图 `.test-data/evidence/v0.4.3-desktop-overview.png`、`v0.4.3-desktop-settings.png`；安装包 `artifacts/dsh-cliworker-now-0.4.3.tgz`。正式环境未触发登录/退出，设置页留供用户检查。


## v0.5.0 — 六个 CLI 统一接入（2026-10-05）

- [x] 共享 CLI 列表扩展到 11 项，新增 ZCode、Grok Build、OMP、Pi、Harness、OpenCode 独立目录与执行适配器；复用项目偏好、首次选型、两层任务列表、停止、同会话续聊与持久化恢复。原生 RPC/JSONL 分别解析，不混用协议，不静默回退。
- [x] Pi/OMP/Harness/OpenCode 按用户授权复用原生 credentials 服务中的智谱引用，只经子进程环境传递；ZCode 使用本次新授权的独立私有目录。Pi 官方 1.0.2 运行时已固定安装；ZCode 实测 Desktop 内置 CLI 无头入口可用。
- [x] 真实 WorkerRuntime 集成验收：Pi run-lYyKgY、OMP run-js51Io、OpenCode run-0ArlRb、Harness run-Ygfv7g、ZCode run-snDbO7；五个 CLI 各首轮、原会话续聊、JSON 文件任务，共15轮通过。核对原生会话ID、实际模型、工具事件、文件内容/哈希和重开Storage后的时间线。证据位于隔离 worktree 的 .test-data/extended-smoke/。
- [x] Grok 仅完成离线原生目录、参数、协议和取消验证；没有订阅任务验收。OpenCode 免费 MiMo 两次403保留，不规避免费层限制；经用户改选智谱后真实验收通过。
- [x] 私有目录逐层拒绝软链、写配置原子替换，避免 Host 在沙箱启动前越界。进程范围确认退出后权限收敛，跳过软链并拒绝硬链接；目录查询使用独立 query 状态。旧验收数据收敛后共498文件，密钥泄漏0、文件权限异常0；原始宽权限审计保留，366项为ZCode公共插件缓存资源。
- [x] 隔离原生 Harness UI 实测11个导航、六个新增目录查询、模型/强度菜单、原生账号按钮禁用及灰色待确认状态。未保存模型偏好、未执行账号登录/退出。截图 .test-data/evidence/v0.5.0-settings-eleven-cli.png；新增CLI品牌暂用主题文字缩写。
- [x] ZCode明确禁用原生子代理、Skill、工作流/跨会话调度及node_repl。源码与无模型调用反证确认：CLI仍加载用户全局插件/MCP，plan可直接允许未标注破坏性的MCP，edit显式授权也可放行；无头broker仅拒绝ask分支。文档和目录提示保留这一实际边界，不声称完全MCP隔离。
- [x] 最终隔离回归：18文件249项测试、Host与Client类型检查通过；build:preview成功，逐文件哈希确认预览src与最终源码一致。新增测试包含分流协议、原生目录、权限拒绝、取消、状态迁移、凭据引用、并发查询、软硬链接边界；真实停止证据沿用前述原生探针，不追加未授权Grok调用。
- [x] 与 v0.4.3 界面修改完成三方合并，保留其他图标归档改动；主目录18文件271项测试、类型检查、隔离构建、正式构建和pack通过。安装包 artifacts/dsh-cliworker-now-0.5.0.tgz 核验142项，桥脚本齐全且无私有运行数据。更新前Desktop活动worker=0；仅添加本插件智谱凭据引用/ZCode独立目录，其他配置未变。Desktop重启后11个CLI导航与Pi原生目录查询可用，未启动新模型任务或保存偏好。

## v0.5.1 — 六个新增 CLI 的账号入口修复（2026-10-05）

- [x] 根因：扩展 CLI 的任务协议已接入，但 AccountManager 仍统一返回空 actions 并拒绝启动账号终端。移除此占位限制，按真实能力分流。
- [x] ZCode/Grok 使用经原生 help 核验的登录、退出及管理入口；ZCode 完整 0.16.9 离线运行时安装到稳定 managed 路径，3424 文件 SHA256 校验、75包、零符号链接，实际 import TUI 通过。账号与 worker/catalog 共享同一指定来源。
- [x] Pi/OMP/Harness 和有 zaiCredentialRef 的 OpenCode 通过本版原生共享 Store 桥复用原生模型设置；不伪造独立 OAuth 登录或无效退出。Harness 本版无 TUI，管理入口为原生设置。账号状态只显示本地配置事实，不伪称远程验证成功。
- [x] Pi/OMP/OpenCode 原生管理 TUI 沿用同一 API 来源；OpenCode CN模式固定已验证提供商/模型，无ref则使用私有共享原生账号。独立临时目录在失败、取消、进程退出后清理；账号刷新失败不会让已开的原生设置误切成终端。
- [x] 实际隔离页面打开 Harness 原生模型设置；Pi、ZCode、OMP、OpenCode TUI 均已目视确认。OMP首次向导与全局MCP自动发现已修正；无网络、模拟凭据的原生PTY复验确认无向导、无MCP连接、模型可见、0模型任务、最终进程范围为空。证据 `.test-data/omp-account-native-probe/tui-report.json`。
- [x] ZCode/Grok账号终端通过私有launcher使用umask077；在父进程umask022的实际模拟子进程验证中，新目录0700、新文件0600。
- [x] 未执行真实登录/注销或提交凭据，未发送模型任务。Grok 保持离线命令与协议验证范围，没有进行付费/订阅调用。
- [x] 全套21文件331项测试通过，Host/Client 类型检查、隔离构建、正式构建和pack通过；Desktop更新前活动worker=0。
- [x] 解锁后定位并修复 Desktop Client 加载故障：插件重复声明宿主 `settings.section`，触发原生 SlotCore 所有权冲突。改为由框架管理生命周期的共享 Store 桥，关闭插件弹窗后进入原生「模型」设置。新增覆盖两种加载顺序、卸载、能力缺失的回归；本轮3文件68项针对性测试、Host/Client类型检查、隔离/正式构建及重新pack通过。
- [x] 修复后在真实 Desktop 确认11个CLI导航和六个新增管理入口；Harness API入口打开完整原生模型设置，OMP、OpenCode、ZCode原生账号终端均成功显示。OMP/OpenCode展示已配置智谱模型，关闭后相关进程与临时目录已清理；未触发登录、退出或模型任务。截图 `.test-data/evidence/v0.5.1-desktop-native-models.png`、`v0.5.1-desktop-omp-terminal.png`、`v0.5.1-desktop-opencode-terminal.png`、`v0.5.1-desktop-zcode-terminal.png`。正式包 `artifacts/dsh-cliworker-now-0.5.1.tgz` 已重新生成。


## v0.5.2 — 原生登录菜单、账号识别与六款图标（2026-10-06）

- [x] OMP/Pi/OpenCode 登录设置改为原生终端，无 API 凭据前置要求，无模型任务或按键注入；私有账号目录保留，临时终端数据清理。
- [x] ZCode/Grok 原状态只检查文件存在；现按本机格式解析原生本地身份，真实只读检查两者均 authenticated、accountLabel 非空，未输出凭据。
- [x] 用户给出的 ZIP 为旧款；找到并接入项目内 v2-extended 六款PNG，按素材清单统一光学大小和亮暗表现。
- [x] Harness 0.2.0-rc.2 无原生 TUI/登录命令，保留明确禁用说明；未伪造页面、升级 CLI 或跳转原生设置。
- [x] 无网络私有PTY验收中，Pi显示原生认证方式菜单，OMP显示提供商设置页，OpenCode显示 Select provider 登录列表。未提交认证、未请求订阅模型；各进程组退出为空。证据 `.test-data/v052-native-login/`。OpenCode探针使用单层等效文件限制与禁网沙箱，避免macOS禁止嵌套sandbox-exec，不把探针描述成生产沙箱链验收。
- [x] 全套22文件336项测试、Host/Client类型检查通过；隔离构建、正式构建与pack通过，安装包158项、含Pi原生UI入口、无私有运行数据。
- [x] 隔离Harness页面实际打开Pi原生认证方式菜单，关闭终端后设置仍可操作；Grok显示绿色已登录和账号，六款图标暗色可读。证据 `.test-data/evidence/v052-preview-pi-login.png`、`v052-preview-grok-settings.png`。
- [x] 更新前Desktop活动worker=0，隔离worker均终态；预览标签与服务已关闭，未提交认证或保存模型偏好。
- [x] 解锁后重启Desktop加载0.5.2：ZCode/Grok均实际显示绿色已登录和账号，六款新图标在亮色设置页可见；Pi/OpenCode/OMP均打开原生认证菜单后关闭，未选择提供商、提交凭据、退出账号或发送模型任务。Harness显示本版无终端登录界面，按钮禁用。
- [x] Desktop验收额外发现OMP原生向导在300px终端中截断提供商列表；仅OMP终端改为520px，小屏由原生弹窗滚动。2文件55项针对性测试、Host/Client类型检查、隔离/正式构建及重新pack通过；Desktop再次重启确认完整提供商列表。此前受限沙箱内误跑全套测试的3个权限失败（sandbox-exec/ps）保留日志，不视为代码回归。
- [x] Desktop证据：`.test-data/evidence/v052-desktop-zcode-settings.png`、`v052-desktop-pi-login.png`、`v052-desktop-opencode-login.png`、`v052-desktop-omp-login-final.png`。账号临时目录已清理；正式包 `artifacts/dsh-cliworker-now-0.5.2.tgz` 已更新。


## 智能体角色预设与命名（2026-10-06）

- [x] 读取七份用户小说技能，整理为默认角色；保留审稿、规划、修订和草稿授权边界，不执行原技能任务。
- [x] 实现角色库私有持久化、模板 CRUD、每个 worker 的独立快照和临时提示词。
- [x] 原生派遣新增角色问题；稳定命名、重命名、同父会话按名称续聊／状态／停止。
- [x] 标题字标、NOW 对齐与留白调整；设置新增角色卡片；列表与对话显示智能体名称。
- [x] 集成工作区 31 文件388项测试通过；为遵循 Hermes 尚未更新 Desktop 的范围，本轮从 HEAD 8783e5e 单独构建角色功能 0.5.3，未带入 Hermes 或图标归档改动。
- [x] 独立发布目录 `.cache/roles-release` 的26文件354项全套测试、Host/Client类型检查、build:preview、build与pack通过。独立测试首次发现快照夹具漏传自定义worker列表，补回后全套通过；日志保留在其 `.test-data/`。
- [x] 七份默认提示词经独立来源复核；真实隔离Harness页面显示七个卡片，并完成模拟预设新增、搜索及重新打开回读。文件0600；模拟预设只存在隔离profile，不进入Desktop。
- [x] Desktop更新前活动worker为0；备份并更新本插件生成文件后重启，实际确认“智能体名称｜主题”、列表名称/模型/强度、重命名对话框、七个默认卡片及完整提示词编辑表单。未改变原会话名称、模型、登录或任务内容；正式角色库7项、0600。
- [x] 亮色Desktop与暗色隔离页面均目视检查；角色搜索框修正为使用原生Input的span容器铺满可用宽度。生成Host/Remote合同均包含4个新增RPC，未出现404。
- [x] 独立包 `artifacts/dsh-cliworker-now-0.5.3.tgz` 170项，无运行数据或凭据；验证摘要同目录JSON。本轮不发送真实模型任务、不测试小说产出质量。专用隔离预览服务已停止。
- [x] 仅提交本轮角色功能、说明和独立版本号，保留工作区其余并行改动；不推送远程。


## 2026-10-06 — Hermes Agent 隔离接入（v0.6.0）

- [x] 用 Hermes Agent / `hermes` 替换外部 Harness CLI；使用用户 `v3-hermes/hermes.png` 原图。保留 DeepSeek Harness 宿主和旧 Harness 只读历史；旧 session ID、偏好不映射到 Hermes。
- [x] 按用户授权安装官方固定提交 `4787e4d56fc8d9265d4c7d3c0fe5accee86b4078`，实际版本 `v0.21.5+7527.g4787e4d`、Python 3.14.7；跳过浏览器与电脑控制依赖，不安装 Hermes Desktop 或启动 gateway。
- [x] 原生 `model` 登录向导、`auth` 账号菜单、当前服务商/模型目录、stream-json、session_id 续聊、真实 tokens 投影；按原生已公开能力提供强度，未公开能力不猜测。
- [x] 任务/目录查询使用窄范围 Seatbelt 写入白名单；原生账号、config、.env、源码与依赖保持只读。修复并行目录查询的原生安装锁竞争、连续文本分片重复，以及空安装配置被误判为已配置登录。
- [x] 独立工作树 `feat/hermes-integration` 构建与类型检查通过：`pnpm --config.verify-deps-before-run=false build`、`typecheck`、`build:preview`。未将并行“制作智能体”任务的角色实现和文档混入本包。
- [x] 同工作树完整回归：27 个测试文件、371 项通过，包含 7 项实际 macOS Seatbelt 测试，以及取消/进程清理、流式解析、模型目录、账号读取、历史迁移与 UI 用例。日志位于工作树 `.test-data/final-test.log`。
- [x] 真实 CLI 目录验证：默认 provider=auto 时明确要求选型；私有模拟配置经真实 CLI 返回 fixture/model。配置值为模拟，进程与沙箱真实，未调用模型。最终窄策略真实读取 provider 成功退出 0。
- [x] 最终隔离包在 cliworker-test profile 的设置页中显示 Hermes 新图标与未登录状态，不再显示可选 Harness。真实点击“登录设置”显示提供商列表，“账号终端”显示原生凭据管理菜单；均关闭并确认对应进程退出。截图在主工作区 `.test-data/evidence/hermes-final-login.png` 与 `hermes-final-auth.png`。
- [x] 遵照用户“暂时只完成 Hermes 隔离验证，不更新 Desktop”：没有构建主工作区 lib、更新 Desktop 链接或重启 Desktop；隔离测试 profile 使用后恢复原链接。
- [ ] 真实模型运行、续聊和任务停止：本轮未选模型、未提交凭据、未发送模型请求，留待用户选型后验收。协议夹具与登录菜单验证不等同于真实任务通过。


## 2026-10-06 — Hermes 合入当前角色版本（v0.6.0）

- [x] 用户要求将 Hermes 加入当前版本。基于 `6de1b25` 的智能体预设与命名功能，核对隔离提交 `2469f84`：Hermes 独立实现完整，共享 Host/Client/Storage 逻辑保留角色选择、快照、七个默认角色、重命名与按名称续聊。
- [x] 主工作区 31 文件、389 项测试通过，含实际 macOS 沙箱/进程清理测试；组合版本 `build:preview` 与生成合同后的 Host/Client 类型检查通过。未执行模型任务、登录或退出账号。
- [x] 隔离 UI 同时显示 Hermes 设置、新图标与七个智能体预设；旧 Harness 无可选入口。当前 Hermes 尚未明确选择原生服务商/模型，按设计提示先完成登录设置，不伪造目录。
- [x] 组合安装包为 `artifacts/dsh-cliworker-now-0.6.0.tgz`，与先前仅 Hermes 的隔离包分开；保留现有 Desktop 构建备份 `.cache/desktop-before-hermes-060`。
- [x] 用户明确回复“开始吧”允许退出并重启后，完成主目录正式 build 与 Host/Client typecheck，完整退出并重新打开 Desktop，加载组合版本 0.6.0。更新前活动 worker=0、账号终端=0。
- [x] 本机 Desktop 设置显示 Hermes Agent 新图标与入口，旧外部 Harness 无可选入口；点击“登录设置”实际打开 Hermes 原生服务商选择菜单，关闭后无账号进程残留，account-runtime 为空。未选择服务商、提交凭据或发送模型请求；仍需用户明确选择原生服务商与模型后使用。
- [x] 本机七个智能体预设与原有会话完整保留；更新前后 worker、CLI 开关、项目偏好与角色库四份持久化文件 SHA256 均一致。证据 `.test-data/evidence/hermes-desktop-060-login.png`、`hermes-desktop-060-roles.png`；构建及类型检查日志 `.test-data/hermes-desktop-final-build.log`、`hermes-desktop-final-typecheck.log`。


## v0.6.1 字标、设置层级与控件统一（2026-10-06）

- [x] 原生品牌字体、舒展字距、标题与设置按钮居中；模型后紧跟点分隔及思考强度。
- [x] 智能体设置与 CLI 连接同级，联系人图标与缩进子项；平滑收展，隐藏项不可聚焦，当前配置/终端不重建。
- [x] 普通按钮与单行输入统一为原生 MD 36px；返回/取消描边，删除预设红底白字，保留确认与悬停效果。
- [x] 72 项针对性界面测试、31 文件390项完整测试、Host/Client类型检查通过。首次受限环境全套检查中的进程权限错误和缺失图标 mock 已分别通过授权环境运行及补齐夹具解决；不将首次失败记为通过。日志 `.test-data/ui-refine-tests.log`、`ui-refine-typecheck.log`。
- [x] 先完成隔离构建，在 Safari 中实际验证暗色标题、模型排列、联系人导航、CLI 收展及角色编辑按钮；隔离服务停止，profile 包链接恢复。仅查看既有角色，未保存或删除。
- [x] 更新前 Desktop 两个 worker 均 completed，账号终端为0；备份 `.cache/desktop-before-ui-061` 后正式构建、pack，重启 Desktop 加载0.6.1。亮色实际复核字标和 gear 对齐、搜索/新增等高、CLI 收起与角色编辑的红色删除/描边取消；取消编辑返回原会话。
- [x] Worker、偏好、角色库及 CLI 开关文件更新前后 SHA256 一致，七个默认预设仍可见。正式包 `artifacts/dsh-cliworker-now-0.6.1.tgz` 含175项、无测试运行目录或凭据；本轮未发送模型任务。


### 2026-10-06：v0.6.2 标题与卡片优化

- [x] 标题切回 Harness 默认界面字体；NOW 高度 21px → 18px；标题 Logo 改为浅色黑、深色白。
- [x] 浅色 CLI 卡片增加淡灰底色；收起/展开加入宿主动效与箭头旋转，折叠内容无法聚焦或点击，详情返回后保持折叠状态。
- [x] `pnpm typecheck`、面板与设置定向测试 67 项、`pnpm build:preview`、`pnpm build`、打包全部通过。pnpm 使用 `--config.verify-deps-before-run=false` 保留当前依赖安装。
- [x] 隔离 Harness 深色预览核对标题、白色 Logo、卡片收展；本机 Desktop 更新 0.6.2 后核对默认字体、黑色 Logo、NOW、淡灰卡片及收起/展开。未进行逐帧性能测量。
- [x] 更新前确认 2 个 worker 均已完成、账号终端数为 0；更新后 5 个会话/偏好/角色/CLI 设置文件的哈希一致。没有发起真实模型任务。


### 2026-10-06：v0.6.3 卡片悬浮样式

- [x] `Cli Worker` 改为 `CLI Worker`，Logo 与标题的间距减半至 6px。
- [x] 浅色卡片恢复白底，增加原生柔和阴影；深色取消灰底，用同色底面、细轮廓和增强底部阴影表达层次。
- [x] 面板定向测试 23 项通过（同步修正原大小写断言）；`pnpm typecheck`、隔离构建、正式构建及 0.6.3 打包通过。pnpm 保持 `--config.verify-deps-before-run=false`。
- [x] 隔离 Harness 深色页面与本机 Desktop 浅色页面均已目视验证字标、间距、同色卡片和投影；保持收展实现不变。
- [x] 更新前 2 个 worker 均已完成、账号终端为 0；重启后 5 个 worker/偏好/角色/CLI 设置文件哈希未变。未发起真实模型任务。


### 2026-10-06：v0.6.4 正式 Logo 替换

- [x] 三张用户原图接入：浅色标题黑色、深色标题白色、工具栏/空状态/新标签页引导蓝色。归档和运行资源 SHA256 均与 Downloads 原图一致；旧正式版本标记为历史。
- [x] 面板和客户端注册定向测试 27 项通过，Host/Client 类型检查、隔离构建、正式构建和打包通过。pnpm 使用 `--config.verify-deps-before-run=false`。日志 `.test-data/ui-logo-tests.log`、`ui-logo-typecheck.log`、`ui-logo-preview-build.log`、`ui-logo-build.log`、`ui-logo-pack.log`。
- [x] 隔离 Harness 深色界面实际显示白色新 Logo 与蓝色工具栏入口；重启本机 Desktop 后实际显示黑色新 Logo 和蓝色工具栏入口，标题排版与悬浮卡片保持正常。隔离服务已停止并恢复原 profile 包链接。
- [x] 更新前 2 个 worker 均 completed、账号终端为 0；更新后 5 个 worker/偏好/角色/CLI 设置文件哈希一致。未发起模型任务。原构建备份 `.cache/desktop-before-ui-064`。
- [x] `artifacts/dsh-cliworker-now-0.6.4.tgz` 共177项，三张原图均内联并原样打包，不包含测试数据或缓存目录。


### 2026-10-06：v0.6.5 定稿 Logo 接入

- [x] 按用户强调，唯一采用其指定黑色定稿原图；运行文件与归档、原始生成文件逐字节一致。三种配色共享 alpha 蒙版，不使用重新生成的轮廓。
- [x] 27项面板/注册测试、Host/Client typecheck、build:preview、正式 build、pack 通过，日志 `.test-data/logo065-*.log`。
- [x] 隔离 Harness 深色界面验证白色定稿与蓝色入口；正式 Desktop 重启后验证黑色定稿和蓝色入口。隔离服务已停止，测试 profile 链接恢复。初次受限启动未能监听，后以授权的回环服务完成验证。
- [x] 更新前2个worker均completed、账号终端0；更新后5份worker/偏好/角色/CLI设置哈希不变。未执行模型任务。备份 `.cache/desktop-before-ui-065`。
- [x] 包 `artifacts/dsh-cliworker-now-0.6.5.tgz` 共175项，包含定稿原始PNG和配色代码，不包含废弃换色稿、旧蓝白Logo或测试数据。


### 2026-10-07：公开首页整理与 Harness 原生截图

- [x] README 按项目定位、特点优势、界面效果、支持范围、安装更新、使用方法、边界与常见问题、开发验证、文档反馈编号整理；历史逐版本说明移至 `doc/version-notes.md`，保留追溯入口。
- [x] 2026-10-06 晚在真实 DeepSeek Harness Desktop 新建干净演示会话。用户批准 Antigravity / gemini-3.8-flash / low / 无角色预设的单次欢迎语任务；完成原生三项选型，worker 为 completed，结果事件 SUCCESS，无工具事件，回复符合要求。
- [x] 直接拍摄原生任务总览、子对话、角色预设与 OMP 设置四张截图。收起私人会话列表，避开含邮箱的账号页，逐图检查无账号标识、密钥、本机路径或私人内容；来源说明见 `doc/assets/readme/README.md`。未发布独立 React 演示页。
- [x] 相对链接与图片文件检查、公开文本敏感信息扫描、`git diff --check` 通过；核对 GitHub Release 附件和宿主安装入口。此轮仅文档与截图，未重跑业务构建或测试，未变更运行版本。


### 2026-10-07：v0.6.6 天蓝平切 Logo 与同轮廓三色

- [x] 用户选定 `exec-1f96a1dc-5099-4e6e-949c-6b37a295db1d.png` 原图进入运行时；源码、归档、隔离包、正式构建与安装包内 PNG 均逐字节一致。蓝色直接显示原图，黑白共用 alpha 蒙版。
- [x] 面板/客户端注册定向测试 27 项、Host/Client 类型检查、隔离构建、正式构建和打包通过；日志 `.test-data/logo066-*.log`。本轮无业务逻辑改动，未新建镜像式测试或执行模型任务。
- [x] 三色原生 CSS 预览检查 24/32/48px，保存 `doc/assets/project-icon/official-v4/preview.png`；隔离 Harness 深色界面显示白色标题及蓝色入口，正式 Desktop 重启后显示黑色标题及蓝色入口。截图在 `.test-data/evidence/logo066-isolated-dark.png`、`logo066-desktop-light.png`。临时预览页和服务器均已关闭。
- [x] 更新前 3 个 worker 均 completed、账号终端数 0；备份 `.cache/desktop-before-ui-066`。重启后 7 份 worker/偏好/角色/CLI 设置文件 SHA256 未变。未更改其他配置。
- [x] 安装包 `artifacts/dsh-cliworker-now-0.6.6.tgz` 共 175 项，包含选定 PNG；无旧黑色 PNG、测试数据或缓存目录。只本地提交，不推送或发布远程。


## 2026-10-07：OpenSpec 开发流程接入

- [x] 核查 OpenSpec 官方资料、本机发布版与当前源码，固定开发依赖 `@fission-ai/openspec@1.14.1`；新增 `pnpm spec`、`pnpm spec:list`、`pnpm spec:check`。Node v22.23.1、pnpm 11.25.0；`pnpm install --frozen-lockfile --offline --ignore-scripts` 通过。
- [x] 官方 `init --tools codex --profile core --language Chinese --no-animation` 生成六个项目级技能，未改用户全局技能；中文 context、各产物 rules 和 apply/archive guidance 注入检查通过。项目入口关闭本次命令遥测。
- [x] 完成 `adopt-openspec-workflow` 的提案、设计、development-workflow 增量规格与任务；`status` 四类规划产物齐全，严格校验通过。新增 `doc/openspec.md`，同步 AGENTS、README 和设计入口。业务能力域只提供提取索引，不宣称全部完成规格迁移。
- [x] `pnpm typecheck`、`pnpm test`（31 文件 / 390 项）、`pnpm build:preview` 通过；自动测试因本机进程与沙箱夹具需求在获准的本机执行环境运行，不调用真实模型。日志在 `.test-data/openspec-adoption/{typecheck,test,build-preview}.log`。
- [x] 指南相对链接、运行时依赖/exports/安装元数据保持不变、六个生成技能版本、`git diff --check` 检查通过；正式 `lib/` 的 172 个文件 SHA256 前后完全一致。检查报告与指令快照在 `.test-data/openspec-adoption/`（忽略目录）。
- 本次不执行正式 build、Desktop 更新或真实 CLI 模型任务，不提升插件版本；Kimi/Grok/Hermes 以及其他历史真实验收边界继续保留，未虚勾历史任务。原有 Logo 归档和历史文档整理与本次改动分别保留。
- [x] 本次 change 已归档为 `openspec/archives/adopt-openspec-workflow/`；主规格 development-workflow 含 4 条需求。归档后 `pnpm spec:check`、`pnpm spec validate --archived --strict --no-interactive` 通过，活动变更为 0。

## 2026-10-07：v0.6.7 CLI 路由、原生模型目录与连接状态

- OpenSpec：`fix-cli-routing-model-catalog-health`，覆盖 worker-dispatch、cli-model-discovery、cli-connection-health；规划提交 `dff43bf`，路由提交 `fa5bc7c`，后续实现及交付按阶段本地提交，不推送。
- 路由：统一 agy→Antigravity、glm／zhipu／智谱→ZCode、harmes→Hermes；长名称唯一轻微误差可解析，短名称、歧义、普通讨论、否定与引用不自动派遣。当前步提示通过原生 pre-step 的 accepted human messages 生成；真实 Cordis／SystemPrompt／ToolRuntime 装配、生命周期、角色与权限门槛有回归。原有 skill 和宿主核心未修改。
- 模型：ZCode 原生 builtin＋personal 合并、隐藏／禁用与 manual 覆盖、原生推理参数及完整 ID；本机纯读取目录 21 个模型、9 个 provider。Pi／OMP 读取全局及插件账号、模型配置、缓存和原生环境，同 provider 插件来源优先；Host CN 引用仅用于对应 provider。默认数据目录的账号读取同时覆盖发现和任务启动，新增无子进程参数准备回归，原账号文件未变。
- Pi／OMP 原生离线查询（禁止网络）：仅原生来源 OMP 29 项、Pi 无账号 0 项；明确标注合成 CN 凭据做 metadata 查询时 OMP 39 项、Pi 4 项。源文件前后哈希相同，0 模型请求。证据 `.test-data/model-catalog-health/offline-catalog.json` 与同目录 `offline-check.ts`。原生目录可读不证明远端订阅。
- 续聊：Pi／OMP 精确 provider/model/effort 与 observed 核验、原生 env 和刷新 OAuth 保留、同会话改选和查询取消；ZCode 先原生 metadata resume／setModel／read／close，完全退出后才 headless。真实已安装 ZCode 在全新私有数据、合成 API 配置和原生导入的一条明确模拟历史下，改选 high 后重启恢复相同 session/model/options；仅允许本机 IPC、拒绝外网、没有 send 任务。证据 `.test-data/cli-fixes-067/zcode-native-metadata.json`。探针早期超时来自独立客户端未处理反向 RPC 与空 metadata 会话不持久化，修正探针后通过，未据失败误判生产 wrapper。
- 状态：unconfigured 灰、明确认证失效或配置／读取错误红、unknown 灰、可读原生配置或登录绿；绿灯说明本地或原生 CLI 证据不代表远端验证。导航与账号摘要共用映射，未配置优先于空目录错误；刷新恢复不写模型偏好。脚本路径须为可读普通文件，Node 脚本不要求执行位。
- 最终 `pnpm test`：34 文件、495 项通过；`pnpm typecheck`、`pnpm spec:check`、`pnpm build:preview`、`pnpm build` 与 `pnpm pack --out artifacts/dsh-cliworker-now-0.6.7.tgz` 通过。preview/src 与最终 src 逐文件哈希一致，Host／Remote 合同已重新生成。日志 `.test-data/cli-fixes-067/{full-tests-final,typecheck,preview-build,production-build,production-typecheck,package}.log`。初轮过时目录夹具及取消签名已修正；原生沙箱测试在支持 sandbox-exec 的环境重验，未把受限外层沙箱的失败计为通过。
- 隔离渲染：Tabbit 实际检查灰／红／绿和 ZCode／OMP 多模型，标签显示型号＋provider，保存仍用完整 ID。模拟夹具有独立包元数据，避免误注册原生产 Client；最终截图包含“模拟”标签：`.test-data/cli-fixes-067/ui-health-zcode-multimodel-simulation-final.png`、`ui-omp-multimodel-simulation.png`。该证据不冒充真实模型对话。
- Desktop：更新前全部后台 Worker 已结束、账号终端为 0；旧生成文件备份 `.cache/desktop-before-cli-fixes-067/lib`。本地源码链接加载新构建，重开后在实际设置菜单目视核对 ZCode 多服务商模型、OMP 的原生接口和列表末端 zhipu-coding-plan 模型、Pi 的 4 个 CN 模型；没有选择／保存新默认、提交登录或发送模型任务。CUA 的原生截图在本次聊天工具记录中；摘要 `.test-data/cli-fixes-067/desktop-verification.json`。既有 10 份 worker／preference／CLI 开关／角色文件前后 SHA-256 全相同。
- 安装包共 183 项，新增两个 runtime 脚本齐全，yaml 固定 2.9.1，无 `.test-data`、`.cache`、账号或运行数据。SHA-256：`06a90c50a8be869c6512d14ed6c43ba81bb5c3f95e2bb5e09d9ac8f108829eae`。交付摘要 `artifacts/dsh-cliworker-now-0.6.7-verification.json`。
- 测试隔离事件：一项旧账号测试的失败断言意外把本机自定义 provider 的 API key 带入工具输出。已隔离临时 HOME、账号来源和子进程环境，观察文件仅记录合成值匹配／存在布尔，新增父环境凭据不导入回归；本轮验收及自建临时目录检查匹配文件为 0。未写入 Git，未修改或轮换用户凭据。该事件已经向用户说明，避免将测试成功描述成从未发生过暴露。
- 未做：本轮未用主模型新对话验收自然语言服从，也未发起真实 CLI 模型任务或验证所有 provider 的订阅／远端凭据；已有 Kimi／Grok／Hermes 等历史未验证项继续保留，不能由目录／元数据／模拟回归推断成功。

## 2026-10-07：v0.6.8 账号可用模型、简化名称与免费优先

- 用户反馈后取回并重开 `fix-cli-routing-model-catalog-health`。上一版“原生 available 目录”不能代替当前账号权益，历史验证保留；本轮新增 5.1–5.8 单独记录。规划提交 `3accb39`，展示与 Host 选型提交 `83991ed`，账号筛选与两阶段查询提交 `42e296d`。
- Pi／OMP／OpenCode 将原生候选与当前账号支持范围相交；过期 OAuth、未登录、范围未知、公共大全和仅在自定义配置中声明的模型隐藏。OAuth Codex 检查 supported_in_api 与当前额度允许，OpenRouter 使用账号模型端点；多账号池按共同权限和全部身份费用投影。配置本身与未绑定当前账号的旧成功记录不是权限证据。
- 设置、首次询问、Worker 改选和卡片统一只显示模型名；去掉路由前缀及括号附注，按确切原生型号去重，原始完整 ID 和有效旧偏好保持精确。仅有明确免费价格或免费额度且可用的模型在新选择中优先；unknown、SDK 缺省零值、附加费用和付费订阅额度不当免费。不可用旧偏好要求重选，不自动改默认或转付费。
- 原生账号与配置安全只读，发现与执行采用相同来源和原生认证优先级。Host CN 密钥只在对应子进程 env 使用；不写入请求文件、账号副本或报告。不执行 OAuth 刷新或 shell 密钥命令，不复制用户会话。账号 HTTP 查询限时、限响应体、只读 GET，错误固定去敏。
- 本机真实只读范围核对：仅原生账号 OMP 筛后 5 项，当前免费额度证据为 free；Pi 原生来源没有确认范围，0 项。Desktop 的显式 Host CN 来源下 Pi 确认 GLM-5.3 与 GLM-5.3-Flash 两项。OpenCode 当前账号／原生 CN 交集 6 项：GLM-4.7、GLM-5-Turbo、GLM-5.1、GLM-5.2、GLM-5.3、GLM-5.3-Flash，成本均 unknown。原账号／配置文件哈希不变；0 模型生成、0 OAuth 刷新。证据 `.test-data/model-catalog-health/strict-account-metadata.json`、`.test-data/cli-fixes-068/opencode-metadata.json`。
- 隔离 Harness 渲染已完成：每个 CLI 的 3 个明确模拟路由投影为 2 个模型名，已确认免费路由排前；历史卡片去前缀、括号和去重一致。截图 `.test-data/cli-fixes-068/ui-cards-simulation.png`、`ui-opencode-menu-simulation.png`，摘要 `ui-verification.json`。模拟 UI 不作为真实账号可用性证明；临时服务、页面及浏览器控制租约已结束。
- 实际 Desktop 初次复核发现 OMP 目录失败：外层 Host Seatbelt 与新增内层 sandbox-exec 重复 sandbox_apply，被系统拒绝。独立 native 查询成功不能覆盖已安装路径；当前修复把断网原生候选读取和受控账号 GET 拆为两次单层沙箱查询，任务准备复用同一私有快照，执行继续原生 setModel＋observed 核验。准备元数据进程无法确认退出时使用固定类型清理错误，阻塞后续任务并保留状态目录，不报告停止成功。
- 最终完整回归：39 文件／564 项通过，Host／Client 类型检查、严格规格校验、preview 构建、正式 build 与 pack 通过。源码 75 个文件与隔离 preview 逐个哈希相同；Gateway 合同重新生成。日志 `.test-data/cli-fixes-068/{full-tests-final-3,typecheck-final-3,spec-check-final-3,preview-build-final-3,production-build-final,package-final}.log`。初轮两项旧 OpenCode 集成夹具因未隔离全局大缓存失败，现已使用明确模拟账号和 nativeHome 修正，不把首次失败计为通过。
- 真实 OMP＋合成 Host 引用的生产装配探针通过：候选外层断网、scope 阶段允许受控 GET、同一私有快照，5 个已确认原生账号模型；源账号／配置哈希不变，生成和 OAuth 刷新均 0。最终候选文件仅保留身份／路由／强度及 header 名称，0600，合成 Host key 扫描不匹配；准备阶段清理边界与队列回归通过。证据 `.test-data/model-catalog-health/managed-omp-two-phase.json`。
- Desktop 在全部 7 个 Worker 已结束、账号终端 0 后重建并重启，原构建备份 `.cache/desktop-before-cli-fixes-068/lib` 保留。真实 Host 引用下设置菜单：OMP 14 个去重模型，已确认免费额度的 5 项排前；Pi 2 项；OpenCode 6 项。OMP／OpenCode 的实际 Worker 改选菜单分别与设置的 14／6 项一致，公共 Ling 已不在可选项中。原不可用 gpt-5／Ling 偏好提示重选，均未保存；卡片已显示 GLM-5.3-Flash／gpt-5／ling-3.0-flash-fin-free 等纯名称。CUA 原生截图保存在本次聊天工具记录，未冒充模型生成成功。
- 正式包 `artifacts/dsh-cliworker-now-0.6.8.tgz` 共 192 项，账号查询 helper、类型配套与 OpenCode native 模块齐全；无测试数据、缓存、账号或运行文件。SHA256 `b0d6d94f4f8e37f72f55efc6e1aacddf5d86341189dbf2bef5ff364e4ad7ca2b`，生产链接指向当前仓库。14 份既有 Worker／偏好／角色／CLI 设置文件检查中均未改变；最终验收摘要见 `.test-data/cli-fixes-068/desktop-verification.json` 和 `artifacts/dsh-cliworker-now-0.6.8-verification.json`。
- OpenSpec 收尾：21／21 任务有对应实施与验收记录，三个能力域逐需求核对后同步主规格；重新归档至 `openspec/archives/fix-cli-routing-model-catalog-health/`。归档后严格主规格 4／4、归档变更 2／2 通过，活动变更为 0；本地分阶段提交，不推送，既有无关工作区改动保留。
- 未做：没有提交新默认选型、登录操作或真实模型请求；主模型自然语言服从、所有 provider 的远端任务成功及未来余额／服务状态仍无本轮验收证据。未知账号范围继续隐藏，不通过付费模型请求试探权限。


## 2026-10-08：v0.6.9 六款 CLI 设置加载、登录证据与独立身份

- OpenSpec `repair-cli-settings-discovery`：规划提交 `026b7ad`，实现提交 `8a9f673`。统一账号先查、模型随后加载；刷新/失败清旧目录，跨 CLI 或过期响应拒绝，模型与强度按原生能力联动。仅原生认证成功证据显示绿色，本地凭据及 Host 引用保持待验证。导航与摘要一致，账号来源说明完整换行。
- OMP/Pi 的工具指引、程序身份及入口分离；同模型不互换 CLI。Pi 原生 1.0.4 优先，1.0.2 兼容安装须核验；两个版本均完成离线 SDK/login API 与 RPC `get_state`/`get_available_models` 核对，fetch/prompt/login 均为 0，进程在有意 SIGTERM 后以 143 退出。错误身份、取消及清理未确认边界有回归。证据 `.test-data/cli-settings-069/pi-native-offline-results.jsonl`。
- 六 CLI 本机只读检查：初轮 ZCode configured/local，Grok 明确失效，OMP configured/local，Pi/OpenCode 原生未配置但显式 Host 来源可发现模型，Hermes 真实入口失效。OMP 14、Pi 2、OpenCode 6 个筛后模型；42 份原始账号/配置/运行文件 hash 不变，0 生成、0 登录提交。证据 `native-check.json`，不把目录结果当真实模型成功。
- ZCode 初轮因原生大写 canonical ID 与账号 API 小写 ID 的差异得到空目录。生产凭据 GET 的详细诊断曾被自动审批拒绝，随后用户明确授权一次只读查询；批准后仅对绑定 BigModel 原生 `/api/anthropic/v1/models` 发出 1 次 GET，HTTP 200、11 个小写模型，0 刷新/生成，4 份源文件 hash 不变。未再次发送真实请求。报告 `zcode-authorized-model-list.json`。
- 修正仅限精确官方 individual provider/accountType/Anthropic endpoint，采用 installed ZCode 明确的有限官方 GLM 别名表；其他路由继续 exact 匹配，执行保留 canonical ID。原生目录与该次授权响应的完整离线重放得到 GLM-5.3、GLM-5.3-Flash，均 low/high/max；4 次本地 transport 中只有对应账号匹配，其他返回模拟 404，网络/意外出站/生成均 0，5 份源文件 hash 不变。证据 `zcode-recorded-models-replay.json`，重放不冒充第二次实时查询或生成。
- ZCode 加密口令显式只传对应子进程；当前 identity 的 key、目录发现、login/manage/logout、headless/resume 一致，密钥不进入 argv、文件或响应。Anthropic 原生双认证头仅该路由启用。Hermes 账号范围按原生优先级与账号池交集，拒绝 disabled provider、外部 Codex app-server 身份、未知端点/secret 命令；Grok 公共 ACP 目录不冒充账号权限。
- 最终 `pnpm test` 42 文件 / **631 项通过**，`pnpm typecheck`、严格规格校验、`pnpm build:preview`、正式 `pnpm build`、`pnpm pack --out artifacts/dsh-cliworker-now-0.6.9.tgz` 通过。pnpm 使用 `--config.verifyDepsBeforeRun=false`，完整测试在获准的本机沙箱环境执行；子任务一次误用测试参数导致全套嵌套沙箱失败已停止，不计为通过。日志 `.test-data/cli-settings-069/{full-tests-final-with-alias,typecheck-final,preview-final,production-build-final,package-final}.log`。
- 隔离 Harness 实际渲染六款账号语义、加载/失败/重试、换模型后强度变化；Pi/OpenCode 有 Host 模型仍保持未原生登录灰点。说明区域 height 与 scrollHeight 均 36px，无截断。截图 `.test-data/cli-settings-069-ui/final-opencode-host-source-simulation.png` 明确标注模拟；只读 fixture 事件仅 account/catalog，账号动作、偏好写入、真实模型任务均 0；自有页面与18749服务已关闭。
- 正式 Desktop 更新前9个worker全部结束、账号终端0；旧lib备份 `.cache/desktop-before-cli-settings-069/lib`。完整重启后原生设置确认账号/模型加载禁用状态、ZCode/OMP/Pi/OpenCode中性、Grok/Hermes错误状态及Hermes明确原因；没有保存偏好或提交登录。17份worker/preference/开关/角色文件集合和SHA256均不变。原生截图在本次CUA工具记录，摘要 `desktop-verification.json`。ZCode实时诊断仅使用上述一次用户授权GET，未为Desktop截图重复触发它。
- 包共207项，81份源码与最终preview逐字节相同，正式入口与包内容相同，包含新增原生安装解析helper，无测试/缓存/账号数据。SHA256 `bbfa34a46e1e78bc56c4758a11e4b691e0d14172205997e6ed8fb1daeb549829`，交付摘要 `artifacts/dsh-cliworker-now-0.6.9-verification.json`。
- 保留边界：未发起六CLI真实生成/续聊、未提交登录或刷新OAuth，主模型实际工具服从未新增生成验收。Grok 尚无可核验的当前账号 Worker 模型权益接口，故未确认候选不供选择；Hermes 未知provider/账号池仍不放行。本机Hermes原源码根已改名，旧shim失效；虽facts.json能定位完整构建环境，官方要求源码launcher优先，不能以snapshot替代其安装身份和生命周期，需另行恢复原生安装。本轮没有改全局launcher或恢复用户已改名目录。历史Kimi/订阅等缺口保持可见。
- OpenSpec 主规格已逐条核对并同步，9/9实施与验收任务完成；归档 `openspec/archives/repair-cli-settings-discovery/`。归档前严格校验5项、归档后主规格4项与全部归档3项均通过，活动变更0；仅本地提交，不推送。


## v0.6.10 — 原生登录识别与简洁账号文案（2026-10-08）

- [x] 按用户新截图修正 Antigravity/ZCode 的已登录误判，并统一各 CLI 设置的一行账号信息。OpenSpec `correct-login-status-and-settings-copy` 的提案、增量规格、设计及任务先行；实现提交 `e4e5167`，不推送远端。
- 根因：v0.6.9 客户端把 `verification=local` 当成未验证身份，将 Antigravity 的原生可续用会话降级。ZCode 则仅将当前原生账号绑定标为配置。当前按原生状态显示登录，ZCode 还核对受支持 active provider、当前 identity、原生用户记录及该 identity 的绑定 key；普通 API fingerprint、旧/孤立 key、身份不符及未知 provider 不升为已登录。未改变模型权限筛选或执行参数。
- 设置移除正常账号的长 detail、重复 tooltip 和远端验证/隐私声明，只显示短状态、必要身份及操作；真实错误保留短原因。Hermes 启动入口错误统一为“启动入口不可用，请修复安装”；终端关闭失败仍阻止提前重启。
- [x] `pnpm typecheck`、42 文件／656 项完整模拟测试及严格规格检查通过。最后仅精简 Hermes 两条安装错误文案，相应15项回归再次通过；最终 preview/build 均含 Host/Client 编译，81个源码文件与 preview 完全一致。日志 `.test-data/cli-settings-0610/{typecheck,full-test,hermes-copy-test,spec-check-final,preview-build-final,production-build,package}.log`。
- [x] 本机原生账号离线检查：Antigravity 和 ZCode 均为 `authenticated / oauth / local`，3份原文件哈希不变；网络、刷新、登录、生成和子进程均为0。脱敏证据 `.test-data/cli-settings-0610/native-login-check.json`。本轮未重复前次已授权的 ZCode 模型 GET，也未重新执行模型任务。
- [x] 隔离 Harness 以明确模拟数据覆盖6种账号界面，AGY/ZCode绿色、OMP已配置、Pi/OpenCode未登录、Hermes错误；账号文本高度均22px，detail为0，错误与按钮不重叠，不通过省略长段落伪装单行。刷新后旧成功消失、模型禁用，失败重试和模型强度联动通过。证据 `.test-data/cli-settings-0610-ui/ui-verification.json` 及3张 `*-simulation.png`；自有页面0、服务正常退出、18750端口无监听。
- [x] 正式更新前9个worker均已结束、账号终端0，旧lib备份 `.cache/desktop-before-cli-settings-0610/lib`；重启 Desktop 后实看 Antigravity/ZCode 绿色、Hermes短错误单行。打开 AGY 时正常模型查询仍加载，切换 Hermes 后取消，未作为新模型验收。17份既有worker/偏好/开关/角色文件集合与SHA256均不变，未保存偏好或提交账号操作。CUA原生截图在本次工具记录，摘要 `.test-data/cli-settings-0610/desktop-verification.json`。
- [x] 正式包 `artifacts/dsh-cliworker-now-0.6.10.tgz` 共207项，与本机构建逐项一致，无凭据、测试或运行文件；SHA256 `933283004984885e4495c5a57ca70ade8c6c4e52a6753536e586d61326c4de96`。Desktop链接仍指向本仓库。验收摘要 `artifacts/dsh-cliworker-now-0.6.10-verification.json`。


## v0.6.11 — 全部 CLI 自身账号与模型隔离（2026-10-08）

- [x] 按已批准方案覆盖全部 11 个 CLI；OpenSpec `isolate-cli-account-models` 先行，规划提交 `a3db50f`，实现分阶段提交 `1703dd5`、`be73f58`、`d47a61f`、`6679d71`。移除 Harness 凭据解析和注入、父进程通用 API 密钥、跨 CLI 自动读取及可确认的插件合成路由；保留本 CLI 原生账号、插件登录目录、自有配置中的 API Key 和限定目录的私有 `.env`。旧 Host 引用仅兼容解析，不再使用。
- [x] 模型与强度按本 CLI 原生能力和当前自身账号范围求交，前五 CLI 同样不接受公共目录、旧缓存、Claude 固定别名或无账号免费模型作为可调用依据。Host 私有账号绑定覆盖保存、新建、出队及续聊，任务准备后再次核对；换号、退出、撤权、模型或强度失效均拒绝。无绑定的升级前历史保留查看，但要求新建任务，不替旧会话认领当前账号。
- [x] Pi/OMP 独立核验安装身份和账号优先级，OAuth 续期以稳定主体、当前来源和原生锁／SQLite 条件更新约束；Host 租约只在进程范围确认退出后释放。Hermes 的交互导入入口也受跨 CLI 凭据读取禁令保护。MiMo 在原生配置初始化前拒绝未经核验的环境／文件插值、托管远程配置及外部 provider 导入，检查覆盖目录和执行；账号状态只读自身 Auth，登录终端使用隔离的配置上下文。
- [x] 最终源码 `pnpm typecheck`、`pnpm test`（52 文件／869 项）、`pnpm build:preview`、`git diff --check` 通过。测试使用明确模拟的账号、模型服务和临时目录，覆盖全部 CLI 的外部账号拒绝、自有范围、旧缓存／快照、账号切换／退出、相同模型、无效强度、取消和进程清理失败；真实本机 PTY、Seatbelt 和回环测试在允许环境中执行。日志 `.test-data/cli-isolation-0611/{typecheck-restored-final,full-test-restored-final,preview-restored-final}.log`；最终源码与 preview 逐字节相同，受测源码／测试／构建输入另存 SHA-256 核对。
- [x] 较早阶段的本机离线来源审计未发起原生子命令、网络、登录刷新或模型生成。Antigravity、Codex、ZCode、Grok、OMP 的本地来源绑定可确认；Pi、Hermes、OpenCode 未确认自身可用账号；Claude、Kimi、MiMo 需原生命令的部分跳过，未冒充真实成功。脱敏记录 `.test-data/cli-isolation-0611/native-source-audit.json`。
- 保留能力边界：Grok 尚无已核验的当前账号模型范围；Claude/Kimi 的未支持 OAuth、Codex 未支持的凭据存储或自定义路由、无可核验稳定主体的 Pi/OMP OAuth 均不放行。OpenCode 1.18.21 OAuth 原生续期没有安全的版本条件写回，不能保证外部退出不被旧进程恢复，因此保留真实登录状态，但模型与执行暂不开放；自身 API 配置可按范围使用。Hermes 本机原启动入口仍失效，本轮未修复其安装。未知范围显示空列表及简短原因，不以模型生成探测补证。

- 用户实机反馈后修复 Antigravity/MiMo 回归：账号显示与模型目录状态解耦；Antigravity 恢复自身 consumer 原生 models 目录；MiMo 安全读取自身 Auth、隔离账号终端免受项目模型配置影响，保留网页登录 API metadata.base_url，并解析原生 verbose 头部 window/compacts 信息。身份确认不必等待模型列表；重复在途状态读取合并但不缓存结果，Codex 先单次原生 account/read，OMP 仅缓存按真实安装版本绑定的能力检查。
- 本机恢复证据：Antigravity 原生 models 单次查询 4.578 秒返回 14 个原生变体，0 生成；用户明确授权的 MiMo 官方 GET /v1/models 仅 1 次，HTTP 200、688 毫秒、9 个账号模型，与 6 个原生代码候选相交保留 5 个，剔除账号未支持的 mimo-v2.5-pro-ultraspeed 与不适用的音频条目。证据 `.test-data/cli-isolation-0611/{agy-native-model-metadata,mimo-native-models,mimo-authorized-model-scope}.json`。此前 MiMo 网络诊断被自动审批拒绝，取得专门授权后才执行，没有绕过。
- 本机账号状态读取各测 10 次：Antigravity 首次 4.26ms／中位 0.28ms，MiMo 首次 0.45ms／中位 0.17ms，两者 authenticated；0 子进程、0 网络、0 生成。该耗时仅指 Host 本地账号读取，不当作整页或远端模型加载耗时。证据 `login-load-benchmark.json`。

- [x] 最终隔离界面验收覆盖全部 11 CLI：无账号灰点／空模型／禁用保存；自身 API 模型与强度切换；模型刷新失效、失败和恢复；Antigravity/MiMo 模型待加载或失败仍保持已登录；账号刷新保留身份直到新结果；Pi/OpenCode 原始异常类前缀移除。账号行实测均为 22px，4 张截图实看。最初 fixture 缺少独立包名，曾解析到旧 Client；修正后全部重跑，并从浏览器网络层下载实际脚本，核对与最终 preview 的可执行字节完全相同。证据 `.test-data/cli-settings-0611-ui/ui-verification.json`，Client SHA-256 `81224fef478bc740f7f3bb40f2e9ae8c61554a8066b0fd0fcf7e5ed51f80fa75`；旧轮次只作历史记录，不作为最终通过依据。模拟服务、浏览器页及 18751 监听已清理。
- [x] 最终更新前确认 10 个历史 Worker、0 活动任务、0 账号／任务桥进程；保留原 0.6.10 lib 备份，正式构建后重启 Desktop。实机 Antigravity 在模型加载时已显示登录与一行身份，随后下拉菜单出现 7 组模型（14 个原生强度变体）；MiMo 导航为绿色，自身账号读数与唯一授权模型查询另有证据。为避免重复远端查询，未打开真实 MiMo 详情页，详情布局由隔离模拟覆盖。Pi/OpenCode 均未登录且模型／强度／保存禁用，原因保持一行。关闭设置回到原会话，未登录／退出、未保存偏好、未生成模型内容。证据 `desktop-verification.json`，原生界面截图保留在本次 CUA 记录。
- [x] 数据核对：最终更新前基线的 44 份账号、配置、历史、偏好文件全部哈希不变；另行核对 MiMo 原生账号／配置／Git exclude 的前后哈希及早于本次任务的修改时间。较早首次基线有 2 份配置（Codex/Hermes）在首次正式更新前发生变化，归因未确定，保留当前内容未回滚；该阶段凭据、历史和偏好均未变。记录 `original-state-check-pre-release.json`、`post-update-state-check.json`、`post-final-update-state-check.json`、`mimo-native-source-check.json`，不将最终基线结果扩大为整段会话所有配置从未变化。
- [x] 正式包 `artifacts/dsh-cliworker-now-0.6.11.tgz` 共 237 文件，SHA-256 `8db29b1dddd050d6f4b813724fe413b199823bad0a2ba758ab3531bcf2259523`。包内容与构建核对一致，动态辅助模块相对导入完整，无测试／账号／缓存／运行数据。Host 与 preview 逐字节相同；Client 仅构建位置产生的 node_modules 区域注释路径不同，可执行文本完全相同。验证报告 `artifacts/dsh-cliworker-now-0.6.11-verification.json`；真实模型生成 0。

- [x] 3 个能力域的 8 条增量需求逐条同步主规格并核对文本一致；归档前 6 项严格校验、归档后 5 项主规格严格校验通过，任务 9/9，活动变更 0。归档为 `openspec/archives/isolate-cli-account-models`；能力限制和未做模型生成的边界保留在本记录及规格中。源码、文档和归档分阶段本地提交，不推送。


## 2026-10-08：v0.6.12 原生登录入口与 Grok 账号目录

- OpenSpec：`repair-native-cli-login-entrypoints`；规划提交 `952cd76`，实现提交 `d7d7c92`。本轮修复 Kimi、OMP、Hermes 登录入口及 Grok 目录，不取消全部 CLI 自身账号隔离。设置继续只显示必要单行信息；详细诊断留在聊天与本记录。
- Kimi：原生当前 provider OAuth 引用必须对应自己的有效或可续用令牌，缺失、撤销、过期不能续期与普通 API 配置分开。已有账号的 `kimi login` 会直接复用并退出，没有原生 force 参数；改为“管理登录”打开原生 TUI，由用户明确 `/logout`、`/login`，插件不自动退出。全部账号操作使用 0700 独立空目录，设空 Git/MCP 边界阻止上溯用户项目，退出后按 inode 清理。实际 Desktop 已见“已登录”、管理按钮及独立目录的原生 Trust 提示；未接受 Trust、未输入退出/登录、未生成，关闭后临时目录已移除，原令牌哈希不变。不能将到达 Trust 菜单写成已完成账号切换。
- Kimi 版本：本轮早先本机为 0.42.0，原生 TUI 随后显示更新通知；最后对 Host 实际解析的执行文件在禁写、禁网沙箱仅运行 `--version`，返回 2.1.1，前后哈希相同。当前二进制与早先哈希不同，README 按 2.1.1 记录；之前 0.42.0 的生成 403 仍是历史证据，本轮未重新执行生成或主动运行升级命令。
- OMP：原生 `setup` 会写 `agent` 同级 `logs`，只给规范化的自身日志子目录补写权限。16.4.4 空账号禁网原生菜单及实际 Desktop 提供商菜单均打开，原日志 EPERM 消失；未选提供商或提交认证，退出后进程范围清理。实际 Desktop 关闭菜单后的首次状态读取曾失败，手动刷新恢复“已配置”；之后两次只读原生/Host 检查成功，没有可识别的 SQL 锁或读取竞态诊断，未可靠复现根因，未加入猜测性重试。该瞬态问题仍保留观察，不计为已根治。基线覆盖的三份 OMP 配置未变；基线不含数据库，原生菜单更新了插件自身数据库，不能声称数据库字节不变。
- Hermes：显式账号操作建立插件独立原生目录及目录外来源标记，状态、目录、账号绑定和执行统一来源，退出不回退全局旧账号。精确允许原生 source/provider，继续阻断其他 CLI 导入、安装源码 `.env`、旧全局环境及外部密钥命令；自身 `.env` 禁插值和账号上下文重定向。复用已安装官方 checkout `6c80c32734` 的既有 venv，原生锁内核验 committed facts 并持 generation lease；不触发新账号目录下的依赖重装。最终源码禁网菜单和 Desktop 的 Select provider 菜单可见，未选提供商、未提交认证，关闭后仍未登录；全局原账号/配置/历史保留。
- Grok 官方只读核查：分别严格使用用户一次授权 GET `/v1/models` 和一次授权 GET `/v1/settings`，均 HTTP 200、账号文件未变，没有重试、刷新账号或生成。模型返回 `grok-4.7`、Grok 4.7，强度 `low/medium/high/xhigh`；独立 Build 门禁返回 `allow_access: true`。因此不能将此账号空列表归因于没有订阅；模型目录可读也不能单独证明调用权限。旧插件没有接通自己的认证目录查询，且原生匿名 fallback 的 `grok-4.5` 与新目录不一致。现在先确认同账号官方门禁，再取官方模型与当前原生能力交集，换号/退出/取消丢弃结果，错误不混为无权益，不向设置页加入长说明。
- Grok 原生能力：实际安装 `1.0.0 (3cd0d0cbcebe)` 在禁外网、空 HOME、合成 key 的本机回环模拟 metadata 服务下，原生 ACP 返回 `grok-4.7` 及四档强度，确认该精确版本支持动态目录；其他版本保留原生候选交集。该证据是原生协议的模拟元数据验收，不是当前账号真实生成。实际 Desktop 更新后未重开 Grok 详情，以免超出两次只读授权；尚未验证实际生成、额度消耗和服务端生成限制。
- 最终自动验证：`pnpm typecheck`、`pnpm test` 通过，55 文件／932 项；`pnpm build:preview`、`pnpm build` 及 `pnpm pack --out artifacts/dsh-cliworker-now-0.6.12.tgz` 通过。命令使用 `--config.verifyDepsBeforeRun=false`；完整测试在支持原生 PTY、Seatbelt 和本机回环的环境运行。覆盖令牌缺失/撤销、外部账号拒绝、菜单权限、来源贯通、门禁、错误/取消、账号变更与清理；0 真实模型生成。主要日志 `.test-data/native-login-0612/{typecheck-final,full-test-final,preview-final-build,production-build,package}.log`。
- 隔离界面：Tabbit 加载隔离 Harness 页面和明确模拟账号/目录，核对 Kimi 已登录+管理登录，OMP/Hermes 未登录+登录设置，Grok 已登录但未知权限时空目录禁用；账号行均为 22px、无附加说明段。浏览器实际加载的 Client 与最终 preview 逐字核对，仅 Gateway 封装分隔及 source map 不同；正式 Client 与 preview 仅构建路径注释不同，执行代码一致。截图 `ui/kimi-login-simulation.png`、`ui/ui-verification.json`；浏览器任务、临时服务和端口已清理。模拟页面不替代真实账号授权验收。
- Desktop：更新前保留旧构建备份并确认 10 份 Worker 记录中活动任务 0、账号/任务桥接进程 0；先完成隔离 preview，再正式构建更新本地链接并重开 DeepSeek Harness 0.2.0-rc.2。实际菜单见本轮 CUA 截图/辅助功能记录，摘要 `.test-data/native-login-0612/desktop-verification.json`。44 份既有账号/配置/历史/偏好基线文件哈希全部不变，另对最终 Kimi 菜单前的 1 份令牌核对不变；未将未基线的 OMP 数据库纳入此结论。新增 Hermes 私有来源目录/标记是显式登录入口需要的状态，未复制旧账号。结束时账号终端与设置已关闭，Desktop 留在正常面板。
- 包验证：251 个文件，98 个源码文件与最终隔离 preview 相同；Host 完全相同，两处 `hermes-native-entry.py` 资产与源码相同，包内文件逐个匹配构建，pnpm 仅规范化移除 `packageManager`。无测试、账号、私有日志或运行数据入包。SHA-256 `428db572f4a4d2180665dc0702c89e6dc3bac39826130213625390b8cdc097d0`；摘要 `artifacts/dsh-cliworker-now-0.6.12-verification.json`。最后的 README 版本校正后已重新打包和校验；未改执行代码，无需重复 Desktop 更新。
- 未验证/保留事项：未提交任何 CLI 登录、未执行 Kimi Trust 后的切换、未新建真实模型任务；Grok 的 Build 许可及目录不等于额度或生成成功。OMP 关闭菜单后的瞬态状态失败仍按上述现象记录。本轮私有证据位于 `.test-data/native-login-0612/` 和 `.test-data/grok-account-probe-0612/`，不提交 Git；用户原有图标整理及既有文档改动不纳入本轮提交，不推送远程。
- 归档前严格校验：`pnpm spec:check` 的 5 个主规格和本变更共 6 项全部通过。实现、自动检查、隔离/原生菜单、Desktop 与交付文档共 7 项任务均有上述对应证据；模型生成、登录提交及 OMP 瞬态读取的边界保持可见。
- 最终规格复核将新增的“退出不回退全局账号”明确限定为 Hermes 独立来源；Pi/OMP 原有全局与插件自身来源合并未被文档误写成已改造。三个新增要求已同步至主规格且逐块核对，使用 `--skip-specs` 避免归档时重复合并；变更归档于 `openspec/archives/repair-native-cli-login-entrypoints/`，7/7 任务，归档后 `pnpm spec:check` 的 5 个主规格通过，活动变更为 0。

## 2026-10-08：v0.6.13 服务商登录与 Hermes Nous 修复交付

- OpenSpec：`fix-provider-login-status-and-hermes-catalog`；计划提交 `b1487be`，实现提交 `7a7005c`。原因已确认：四个 CLI 的自身认证投影固定返回 configured，Client 因而正确显示灰点；Hermes 的 Nous 扁平 OAuth、账号绑定和目录实现缺失，已授权账号无法进入模型查询。
- Pi/OMP/OpenCode：79 项专项及类型检查通过；只读本机状态为 authenticated。Pi、OpenCode 均显示 zai.cn API 登录；OMP 分别显示 OpenAI 账号登录及其独立 API 服务商，不混淆认证方式。66 项来源存在性/哈希检查中 24 个现存文件均不变；该探针 0 网络、0 原生登录、0 续期、0 生成。
- Hermes：7 文件 147 项专项通过；最后统一 TTL、恢复非 Nous 查询顺序及原生强度交集后，Nous/集成 2 文件 45 项通过。覆盖匿名/过期/退出/换号、pool 不一致或未初始化、原生路由与自身环境配置、无付费过滤、未知/额外费用、无 tools/图像模型、取消/超时/重定向/体积限制、途中源及冷却改变、同源并发旧取消和有效期跨门槛。原生证据版本 `6c80c3273468`；真实查询不调用原生命令或刷新器。
- 用户明确授权 Hermes 自身 Nous 凭据访问两个官方只读 GET 后，诊断读取到账户无付费访问权和 430 条模型元数据；最终 Host 验证 `/api/oauth/account` HTTP 200（606ms）、`/v1/models` HTTP 200（468ms），过滤为 10 个明确免费模型，其中 3 个提供显式强度，其余仅 default。绑定稳定，auth/config/来源标记 3 项哈希不变，临时运行目录已清理；无生成、无续期。约 1.1 秒仅为此次两请求耗时，不是启动总耗时承诺。
- 自动验证：最终 `pnpm typecheck`、`pnpm test`、`pnpm build:preview`、`git diff --check` 通过；全量 58 文件 1014 项。首轮全量仅失败于非 Nous 原生 scalar 查询顺序，恢复原顺序后全量重跑通过。未以修改测试期待掩盖回归。
- 隔离 UI：Tabbit 本地独立 profile 使用明确模拟账号和目录，四个 CLI 显示绿点与服务商登录类型，登录文字高度 22px；混合/长服务商单行省略且不遮按钮。API 身份标记不渲染，稳定目录失败仍保留有效登录，缺账号灰点且禁用模型。浏览器实际返回的 Client 与最终 preview 逐字核对，仅 Gateway 分隔符/source map 注释不同；关闭自建页、释放任务、停止模拟服务器。模拟未读真实凭据、未生成、未保存偏好。
- Desktop：确认 10 个历史 Worker 中 0 活动、0 账号/任务桥接进程，备份旧 lib 后退出并正式构建更新。实际安装仍链接当前仓库；重启后四个 CLI 侧栏绿点，Hermes 显示 Nous 账号登录及自身身份，模型下拉顶部/底部可见的 10 项与 Host 实测一致。其余三个服务商细项由本地 Host 与隔离渲染核验，本次未打开它们的远端目录。未点保存、未退出/切换账号、未生成；59 份基线账号/配置/Worker/偏好文件前后哈希完全不变。
- 包：`artifacts/dsh-cliworker-now-0.6.13.tgz`，257 文件、100 源文件与最终 preview 对应，Host 相同、Client 可执行内容相同，包内逐文件匹配，pnpm 只移除 packageManager 元数据；无账号、测试或私有日志入包。SHA-256 `7eb2b43abd94cdf6f063c428e7fce7780ac7155a816fc06c935a6f09882e1939`。验收摘要 `artifacts/dsh-cliworker-now-0.6.13-verification.json`，私有证据 `.test-data/provider-login-0613/` 不提交 Git。
- 边界：未执行真实模型生成或续聊，元数据成功不写作推理成功；既有 OMP 原生菜单关闭后偶发状态失败、本轮范围外订阅/权限限制不宣称已根治。保留用户既有图标及文档改动，只提交本次范围，不推送。
- 规格交付：三个能力域新增 3 条要求并修改 1 条既有状态要求，原 Purpose 与既有场景保留；同步前后严格校验共 6 项通过。6/6 任务均有上述证据，归档于 `openspec/archives/fix-provider-login-status-and-hermes-catalog/`；使用 `--skip-specs` 避免重复同步，归档后 5 个主规格通过、活动变更为 0。

## 2026-10-09：v0.6.14 账号摘要与退出入口交付

- OpenSpec：`unify-account-actions-and-summary`，规划提交 `9f3d782`，实现提交 `41edf53`。OMP/Pi/Hermes 原先缺少 logout 动作，导致共享按钮变为禁用浅色；现接原生退出入口。OAuth 账号行只保留订阅服务商，完整安全方式放在悬浮详情；Kimi 从当前原生令牌的 `kimi-auth` 稳定主体投影简短账号 ID，本机未保存邮箱或昵称，不远程查询或刷新令牌。
- 退出实现：原生/插件多个自身来源先选择，Host 重读当前来源；Pi 直接使用所选 auth 文件，OMP 仅链接所选真实认证 DB、SQLite sidecars，配置/缓存/会话私有。Hermes 当前 home 不迁移，原生 auth Remove 只允许认证/环境文件的精确写路径，退出进程禁网；`suppressed_sources` 同时约束状态、模型及绑定，避免保留配置值恢复已退出账号。环境/模型配置 API 不在 Pi/OMP 原生删除范围，需原配置管理；未声称一键清除全部来源。
- 自动验证：Host 专项 5 文件 116 项，Hermes 状态/模型/绑定等 5 组 137 项；最终根目录与隔离 preview 的 `pnpm typecheck`、`pnpm test`、`pnpm build:preview`、正式 `pnpm build`、`git diff --check` 通过。全量 60 文件 1078 项。首轮仅 Hermes 特殊字符路径临时写权限失败，修正 SBPL regex escaping 后保留原测试重跑全部通过；没有放宽整个目录写权限。
- 原生临时验收：已安装 Pi 1.0.4、OMP 16.4.4 在假账号目录出现 Select provider to logout 和模拟 Anthropic 凭据，禁网、拒读真实账号、未选择凭据；退出码 143、进程组已退出，临时目录清理完成。真实 Seatbelt 测试另证 Pi auth 写入/锁和 OMP 链接数据库的 WAL 删除落在所选来源，其他来源/配置不可写，Hermes 原子临时文件可写但配置/历史/兄弟目录/网络不可用。Hermes 原生菜单能力经安装源码核对，本次未在真实账号内打开或移除凭据。
- 隔离 UI：Tabbit 模拟 profile 检查 OMP/Pi/Hermes/OpenCode/Kimi 五行，账号文字均 22px 单行；五个退出按钮 class、65×36px 尺寸及可用状态一致。OMP 可见“OpenAI账号登录”，不拼接 API 或邮箱；安全详情保留；Kimi 模拟 ID 可见。未选/取消来源零启动，选择 plugin 才发送 `accountStartForSource`；假 Host 拒绝操作后显示简短通用错误并可关闭。浏览器资源与最终 preview 可执行文本相同，最后 Host 修复后 Client SHA-256 未变。自建网页关闭、任务释放、服务器停止，0 真实账号操作/偏好写入/生成。
- Desktop：更新前 10 个历史 Worker、0 活动、0 账号/任务桥进程，备份旧 lib；正式构建后原生退出并重启。实看 OMP“OpenAI账号登录”、Pi“zai.cn API 登录”、Hermes“Nous账号登录”、Kimi“已登录 + 当前脱敏 Kimi ID”，退出按钮可用且一致。仅查看，不点击真实退出、保存或提交登录；页面正常模型加载随切换/关闭取消，不将此写作模型调用验收。回到原会话后 59 份账号/配置/Worker/偏好基线哈希全不变，无账号/任务进程残留。
- 包：`artifacts/dsh-cliworker-now-0.6.14.tgz`，263 文件、102 源文件与最终 preview 对应；Host 字节相同，Client 仅构建路径区域注释不同，可执行内容相同，包内逐文件匹配且无账号/测试/私有日志。SHA-256 `5a0dc4d2e8cedbd694f456e04da4f15a36e6cf14e642dad9173a77ffd821104b`；验收摘要 `artifacts/dsh-cliworker-now-0.6.14-verification.json`，详细证据 `.test-data/account-actions-0614/` 不入 Git。用户原有图标及文档整理保留，真实模型生成和真实账号退出均为 0，不推送。
- 规格交付：1 条既有摘要需求更新、2 条新需求同步主规格，原 Purpose 和既有场景保留；4/4 任务有对应证据。同步前后各 6 项严格校验通过，归档于 `openspec/archives/unify-account-actions-and-summary/`，归档后 5 个主规格通过，活动变更为 0。

## 2026-10-09：v0.6.15 原生保护、Windows 与双语 GitHub 发布

- 用户明确取消插件附加 OS 沙箱，改用各 CLI 自身保护；账号边界改为 Host 仅识别自身来源、不注入 Harness/其他 CLI 凭据。OpenSpec `native-cli-protection-and-windows-release`，方案 `b9e9d49`、实现 `d28817b`；已合并远端用户两个 README 改动（`c452d5c`），不强推或覆盖。所有 sandbox-exec/SBPL 包装和专用 OS 限制测试退役，保留原生工具模式、宿主规划/只读拒绝、账号版本、模型/强度、互斥和取消。Hermes 原生无只读派遣能力，和 Kimi 一样明确拒绝。
- Windows 实现：官方固定 Node/Bun npm shim及 Hermes Python fallback 参数数组执行，未知 runtime/batch 拒绝，不拼 cmd /c；任务使用 Host Win32 Job，交互保留 ConPTY。盘符/UNC根、Claude ProgramFiles、MiMo 当前原生认证直连、OMP 子进程配置根/真实退出源、文件身份前后核对、Windows非秘密环境与POSIXmode/目录fd差异均修正。MiMo/OMP不复制认证恢复旧账号；保留 model/catalog/account 来源一致。
- 本机验证：最终 macOS 61 文件，60 通过、1 个 Windows专属文件跳过；1112 项通过、7 项跳过。首次仅4个Hermes旧plan fixture失败，按新明确拒绝规则改为accept-edits测试账号/TTL，独立plan拒绝保持；57项相关回归通过。后续Grok/账号读取和Node/Bun启动6文件124项通过、1项跳过。类型检查、隔离 preview、正式 build、pack和diff检查通过，真实生成0。
- 真实 Windows CI：[37878883989](https://github.com/SuperWheel/cliworker-now/actions/runs/37878883989)，Windows x64、Node22.23.3、Bun1.3.14，99项通过、1项POSIX测试跳过。真实Job后代停止/AbortSignal、ConPTY echo关闭且保留无关进程、真实Python固定fallback、11CLI临时自身来源/他CLI与Harness不能冒充/换号退出均通过。官方Codex0.160.0、Pi1.0.4、OMP16.4.4版本/帮助及实际PiSDK查询通过；空auth候选数0。首轮OMP缺平台optional native叶包，恢复完整官方依赖；第二轮Pi空fixture models.json缺providers，修正为原生schema后通过，不跳过SDK或移除版本sentinel。无真实凭据、登录或模型生成，不把此记作逐模型推理验收。
- 双语首页：默认中文README.md、完整README.en.md，各22个本地链接/全部锚点、4张相同历史真实截图通过；主安装代码块只一行无上下注释，额外步骤折叠。Tabbit线上实际点击中文→English→中文，两页22标题和全部截图/平台标记加载正确；默认分支已更新至b18dcb2。关闭自建页并释放任务，未更改用户网页。源码及历史截图版本范围保留，不将旧v0.6.5图片写成新版截图。
- Desktop：更新前10个历史Worker、0活动/账号桥进程，备份旧lib，确认原生退出后正式构建并重启。实看原会话/任务恢复、Antigravity自身账号、OMP“OpenAI账号登录”、Pi“zai.cn API 登录”，关闭设置且无残留进程；不点真实登录/退出/保存，不生成。59份更新前账号/配置/历史/偏好基线哈希全部不变。Client渲染逻辑与v0.6.14已验收版本相同，仅21处Typert Host诊断源码行号变化，保留对应比较证据。
- 包：`artifacts/dsh-cliworker-now-0.6.15.tgz`，267文件、105源码文件对应最终preview；Host相同，Client仅构建位置区域注释不同，包内逐字匹配，无账号/缓存/测试/运行日志。SHA256 `53940b097ee37c930c35dacf0b0eef1aa522d6c5b287845df0f6860a4b50334d`；包含README.en和全部动态helpers。公开Release为 [v0.6.15](https://github.com/SuperWheel/cliworker-now/releases/tag/v0.6.15)，最新稳定版，目标提交b18dcb2530843899647921c5ecc067c95925b60c，附tgz、SHA256SUMS.txt、verification.json。首次短target SHA被API拒绝，改完整SHA；16MB上传HTTP/2停滞，保留草稿后用仍保持TLS校验的HTTP/1重试。三项远端资产回下载逐字节匹配且服务端digest一致，未替换任何旧Release。
- URL安装：独立DSH_HOME、自建release-install-check profile执行公开Release URL；pnpm第一次下载重试后正常完成，包0.6.15、profile.bundles注册和6个关键文件与正式包一致。用户Desktop原链接/原profile未被验证安装覆盖。详细证据 `.test-data/windows-release-0615/` 私有不入Git；本轮只推送明确授权的代码/双语首页与验证记录，保留86项用户原有素材/文档整理。
- 规格归档：cli-account-isolation更新1条自身账号需求，新增platform-runtime的3条和package-distribution的2条；既有Purpose/场景保留。8/8任务真实完成，归档前严格校验6项、归档后7个主规格通过，活动变更0，归档路径 `openspec/archives/native-cli-protection-and-windows-release/`。


## 2026-10-09：v0.6.16 派遣询问流程简化

- [x] 项目与 CLI 保存模型、实际支持的思考强度、角色及账号绑定；主对话另存已确认快照。首次完整选型，新主对话询问沿用或重新选择，同对话后续派遣不重复提问；旧版仅含模型/强度的偏好需补做一次完整选型。
- [x] 删除问题卡的灰色选项描述、项目路径与说明段落，统一为选型和沿用两类询问；更新工具指引、Client 等待文案、中英文 README 和角色文档。设置页默认模型说明改为“新对话沿用的默认模型”。
- [x] 回归覆盖所有 CLI 的设定隔离、账号/模型/强度失效、Host 重启、无角色、预设快照、跨对话默认更新、查询取消、并发等待者取消、发起者取消、关闭清理及写入失败。全量测试 **62 文件通过、1 文件跳过；1164 项通过、7 项 Windows 专项在 macOS 跳过**；最终一行 Client 文案调整后另跑 3 文件 49 项通过。根目录和 preview 类型检查通过，严格规格校验 8/8 通过。
- [x] 最终隔离构建与当前 105 个源码文件逐字一致。在真实 Harness 原生问题卡中使用明确标注的模拟账号/模型/角色，完成首次选型、同对话免询问、新对话沿用、新对话重选四条路径；事件记录分别验证问题顺序及无 detail/description，四次 launch 均被夹具截断，**本轮模型生成 0 次**。四张界面截图已检查，浏览器实际加载的插件模块与 preview 可执行内容哈希一致。模拟页面、服务器和子进程已清理，activeRuns=0。
- [x] 更新前核查 12 条 Worker 记录，无 running/queued/stopping 或账号/任务桥接进程，Desktop 两个后台任务均已结束。退出后正式构建并打包，重启后插件页实际显示 **v0.6.16、运行中**，原来的 Hermes/Pi 子任务和主对话可见。
- [x] 原账号、配置与 Worker/偏好基线 64 文件中 63 文件逐字不变；另一个 Codex 全局配置差异在更新前已存在，本轮未修改或恢复。8 个额外主会话历史文件中 7 个逐字不变；当前会话原始 87592 字节完整保留，宿主重开时仅追加 81 字节的 session/end-seed 记录。未退出账号、未替换历史数据。
- [x] 本地包 `artifacts/dsh-cliworker-now-0.6.16.tgz` 共 267 文件，逐项匹配正式构建；Host 与 preview 完全一致，Client 仅构建位置的 node_modules 区域注释不同、可执行内容一致。SHA-256：`fe266c100c186b2508dfa54213c516e3b3ef66cbea8554211313981078e78805`。私有日志、界面证据和校验记录位于 `.test-data/dispatch-flow-0616/`，不纳入 Git。仅提交本轮源码、测试、规格和文档追加，不包含既有素材归档及历史文档整理，不推送。


## 2026-10-09：v0.6.17 派遣指引源头修复交付

- 根因核对：真实会话第一步自建角色问题，第二步才收到当前 agy 指引；对照 Harness 0.2.0-rc.2 AgentLoop 源码确认 assemble 早于 pre-step。修复同次请求上下文与工具入口说明，未采用问题拦截。
- `pnpm typecheck` 通过；定向测试 62 项通过；`pnpm test` 62 文件通过、1 文件跳过，1165 项通过、7 项跳过。严格规格检查 8 项通过。pnpm 使用当前已安装依赖（`pnpm_config_verify_deps_before_run=never`），未自动重装依赖。
- `pnpm build:preview`、`pnpm build` 与打包通过。267 个包文件核对，105 个源码文件与预览一致；Host 完全一致，Client 仅构建路径 region 注释不同。包哈希及结果见忽略目录 `artifacts/dsh-cliworker-now-0.6.17-verification.json`。
- 原生 UI 隔离验收：辅助插件补独立 package.json 后重跑，确认实际客户端来自 `.cache/preview-package`。首次依次显示模型和强度／角色；新对话仅沿用问题；同对话零新增问题。三次 assemble→pre-step 均在同次准入消息中得到正确 agy 指引，原生通用提问工具可见，原用户消息未改。模拟目录与启动替身，不访问真实账号、不生成内容。
- Desktop 更新前 15 个 Worker 中活动数 0，账号／任务桥接进程 0；退出后构建更新本地链接，原生插件页确认 v0.6.17 已启用、1 个组件运行，恢复原会话页面。核对 4151 个基线文件，其中 4150 个账号、偏好和历史等文件哈希不变，仅正常重启更新 `host.lock`。
- 隔离服务器与浏览器验收任务已清理。实际结果、日志、截图及数据保护核对位于忽略目录 `.test-data/dispatch-question-0617/source-*` 和 `source-ui/ui-verification.json`；撤回拦截草案的早期记录不作为本次完成证据。
- 本地提交、不推送；原有文档图片和历史文档改动保留，未混入本次提交。OpenSpec 变更 `fix-dispatch-guidance-timing` 完成后同步并归档。


### v0.6.18：修复 Hermes 漏参误派 Antigravity（2026-10-09）

- 根因证据：真实会话 seq103 请求 Hermes，seq104 已提供 cli=hermes 提示，seq108 工具参数只有 prompt/title，seq109 被旧默认值派为 Antigravity；后续模型停止错误任务并显式传 Hermes 才成功。未修改此历史记录。
- 修改：cliworker_start 原生参数 cli 必填，删除处理器的 Antigravity 缺省值；同步同请求路由提示、工具说明及中英文 README。保持历史记录兼容，不新增拦截或询问。
- 验证：Host/Client 类型检查通过；针对性测试 64 项通过；完整回归 1167 项通过、7 项跳过（62 文件通过、1 文件跳过）；严格 OpenSpec 校验通过；预览构建、正式构建、打包与源码/包一致性校验通过。
- 隔离原生界面模拟：先在同对话放入 Antigravity 选型、项目放入 Hermes 选型，漏参没有目录查询/问题/启动副作用；显式 Hermes 的沿用卡显示模拟 model-a/high/模拟审校员，提交仍为 Hermes。采用真实 Host 选择流程与原生问题卡，阻断真实进程及远端账号访问；模拟退出后 activeRuns=0。
- Desktop 更新：更新前 17 个 Worker、0 活动任务、0 账号/任务桥进程；更新后插件页显示 v0.6.18、已启用、1 组件运行中，并返回原对话。更新前 4163 个基线文件中 4162 个未变，仅 host.lock 随重启更新；原生账号、偏好与历史保留。
- 本轮没有发起真实模型生成。私有证据保存于忽略目录 `.test-data/hermes-dispatch-0618/`（根因、测试、模拟截图、包校验、数据保留记录），不入 Git。打包 SHA256：bf693240d3a66094dd7ca6893498fb33914666d16613df69c33c74afeef7f54d。
- 按 OpenSpec 完成核验后同步规格和归档；只提交本轮变更，不包含原有文档/资源修改，不推送。


## v0.7.1：原生聊天交互与 Desktop 验收（2026-10-09）

- OpenSpec `align-native-chat-interactions`；本轮限定子对话返回最新按钮、消息功能条、续聊键盘交互。原生私有组件无独立公开入口；公开图标及主题直接复用，私有规则按 rc.2 实现。新增 `composer-keymap.ts`，保留所选 Worker 身份、现有权限/续聊限制、成功清稿和失败留稿。
- `pnpm typecheck` 通过；键盘/面板定向 2 文件 63 项通过；全量 Vitest 63 文件通过、1 文件跳过，1201 项通过、7 项跳过。首轮受限环境测试有单 worker 无进展并手动中断，不计成功；同一源码在可用本机环境重跑完成。证据 `.test-data/native-chat-071/{typecheck-final,targeted-final,tests-final}.log`。
- `pnpm build:preview` 先完成并验收。Tabbit 在独立 HOME/DSH_HOME、真实 preview 插件和原生 Harness UI 上使用明确标记的模拟对话：亮暗主题 34px 圆球及 shadow/hover 与原生计算样式逐项相同；历史整条功能区 opacity 0/80ms、hover/focus、真实末条常显；即时回底、历史阅读遇新消息保持位置；Enter/Ctrl/Cmd 发送、Shift 换行、IME/229/确认短窗口、空白/repeat、防重复、失败草稿保留和重试一次均通过。早期验收脚本的跨环境数组比较、元素选择及 IME 窗口时序已修正后重新核对，不冒充产品通过；回执 `ui/ui-verification.json`、截图 `ui/circle-comparison-light.png`。只调用夹具模拟续聊，真实 CLI/模型生成 0，夹具进程、浏览器页和任务已关闭。
- 严格规格校验归档前 8 项通过。确认 Desktop 的 20 个 Worker 中活动数 0、账号/任务桥进程 0，退出应用后正式 `pnpm build`、`pnpm pack --pack-destination artifacts`，包逐文件及 preview 源码/Host/Client 一致性核对通过。Client 仅构建位置的 node_modules region 注释路径不同，执行文本相同。包 270 文件、106 源码文件；SHA-256 `56889e7cdf6d86400dbb6bdf33dec529353809e84a633d5296ee6e23adf76df7`；摘要 `artifacts/dsh-cliworker-now-0.7.1-verification.json`。
- 原生 Desktop 辅助功能 UI 确认 v0.7.1 启用、1 组件运行，原会话和子对话恢复、续聊框可见；没有在生产会话发送测试消息。更新前 4182 文件基线中 4181 个哈希不变，仅 `host.lock` 随重启变化，无文件丢失；账号、偏好和已记录历史保留。证据 `idle-before-update.json`、`desktop-verification.json`、`state-preservation.json`。本轮不新增远端查询或真实生成验收，不修改 Harness 核心；原有图标整理及文档改动继续保留，不推送远程。

- 交付收尾：实现提交 `1b06c77`，OpenSpec 4/4 任务完成；新建 `worker-conversation-interaction` 主规格的 3 条要求，Purpose/场景与增量逐块核对。同步后严格校验 9 项通过，归档后 8 个主规格通过、活动变更 0；归档 `openspec/archives/align-native-chat-interactions/`。仅本地提交，保留原有未提交改动。


## v0.7.2：智能体管理与 Desktop 验收（2026-10-09）

- OpenSpec `polish-worker-management` 覆盖后台弹层、短名称、大写强度、历史缺绑定新建、原生右键管理及名称复制；补充进程清理未确认在重启后继续阻塞。保留账号隔离、原生权限、两层任务和原始历史。
- 最终 `pnpm typecheck` 通过；完整 Vitest 67 文件通过、1 文件跳过，1270 项通过、7 项跳过。清理持久化新增 14 项模拟回归；Host 管理、迁移、重建、磁盘失败、取消、账号变化及 Client 管理/复制/草稿均覆盖。严格规格归档前 9 项通过。证据 `.test-data/worker-polish-072/{typecheck-final,test-final,spec-final}.log`。
- `pnpm build:preview` 后使用独立 HOME/DSH_HOME、最终真实 Host/Client 与原生 Harness 界面模拟验收：22 项检查通过，含原生 jobs 菜单跨侧栏命中/点击、关闭还原；短名不截断、100ms 悬停复制、不误开卡片；右键/Shift+F10、标题独立编辑；删除重载恢复同 ID；旧会话发送前禁用、明确新建/Enter、新 Worker、旧历史保留；Low/High 选项。最终 Host 重启再次核对持久标题/历史/菜单/缺绑定入口。账号、模型和新建执行接收方为明确模拟，未运行 CLI 或模型。早期夹具 Jobs API 和验收标签/布局帧等待已校准，失败脚本不计产品通过。证据 `ui/ui-verification.json`、`ui/menu.png`、`ui/new-dialog.png`。模拟服务与自建浏览器任务均已退出并清理；信号退出码130，实际进程已核对消失。
- Desktop 更新前 21 个 Worker、0 活动任务、0 账号或任务桥进程；退出后正式构建、打包和逐文件校验通过。包 282 文件、110 源码文件；源码和 Host 与 preview 相同，Client 仅 node_modules region 注释路径不同，执行文本一致。SHA-256 `f578bb199d50a9e0e864204f230c9a492436558a24b5359ed31094ec9b05445d`；报告 `artifacts/dsh-cliworker-now-0.7.2-verification.json`。
- 原生 Desktop UI 确认 v0.7.2 启用、1 组件运行，原会话恢复，agy/codex/hermes 短名与 Low 可见，右键菜单及真实旧 9cffdf 的「新建对话」/禁用续聊可见；未在真实会话提交消息或管理修改。数据基线 4189 文件：4174 哈希不变、13 Worker 只改名称/来源/别名、host.lock 重启变化，无文件丢失。`~/.codex/config.toml` 于17:10在正式构建及更新前出现外部配置变化，单列保留；本轮代码不写该路径，其账号认证文件与插件偏好/事件/历史均未变。证据 `desktop-verification.json`、`state-preservation.json`。
- 本轮无真实模型生成或远端账号查询，不修改 Harness 核心或用户 skill。仅本地提交本轮范围，保留原有图标/文档修改，不推送远程。规格核验及归档在交付收尾完成。

- 交付收尾：实现提交 `1a3cafb`，OpenSpec 7/7 任务完成；新建 `worker-management` 主规格的6条要求，Purpose/要求/场景与增量逐块一致。同步后严格校验10项通过，归档后9个主规格通过、活动变更0；归档 `openspec/archives/polish-worker-management/`。仅本地提交，原有未提交修改保留。


## v0.7.3：总览和编辑布局验收（2026-10-09）

- OpenSpec `refine-panel-layout`；固定搜索/四筛选及淡红垃圾桶、独立卡片滚动、紧凑两种编辑弹窗、无图标名称文字复制、标题下历史提示横条和无图标两行空页。只改 Client，保留原 Host/协议、账号隔离、草稿与历史；README 及设计同步。
- `pnpm typecheck` 通过；完整 Vitest 68 文件通过、1 文件跳过，1295 项通过、7 项跳过；严格规格10项通过，preview 构建通过。组件专项覆盖复制hover/leave/keyboard/慢结果/销毁、编辑保存失败/取消，以及筛选/恢复/旧任务新建，未以CSS断言代替视觉验收。证据 `.test-data/layout-polish-073/{typecheck-final,test-final,spec-final,preview-final}.log`。
- 最终真实 preview Host/Client + 原生 Harness 界面的隔离模拟验收30项通过。两输入/保存右缘误差0px，标题Modal164px、名称196px；滚动前后搜索/filter坐标相同，列表滚动起于filters下；trash淡红alpha.09、四筛选保留、恢复同ID；名称SVG0、到分隔符7px；hover1300ms保持已复制、leave1018ms恢复，pointer焦点不阻碍。1000/760px窗口无横向溢出，宿主实际右栏仍约543.5px，未冒称验过320px。历史横条位于标题下、不在输入区，显式新建/取消草稿及原事件不变；空页无图标，只有约定两行。最早弹窗截图处于原生进场动画，已在opacity1后重拍，不改core。证据 `ui/ui-verification.json` 和五张最终截图。
- 模拟账号、目录和followup/restart接收方阻断真实生成/CLI/外网请求；存储管理RPC使用实际插件。18774服务wrapper/Host均退出，自建Tabbit页/任务清理完成，残留页0。实际模型生成、远端账号查询及真实CLI均为0。
- Desktop更新前只读核对21个Worker、活动任务0、账号/任务桥进程0；原生界面工具随后报告Mac锁定，已请求用户手动解锁。当前仅preview验收完成，正式build/pack与Desktop更新及更新后数据核对仍待解锁；不将该交付任务标为完成、不归档隐藏此缺口。

### v0.7.3 Desktop 交付补验（2026-10-09）

- 用户解锁后再次核对21个Worker、活动任务0、账号/任务桥进程0；通过原生菜单正常退出Desktop，并确认主进程已结束，再运行正式 `pnpm build` 和 `pnpm pack --pack-destination artifacts`，均通过。
- 包 `artifacts/dsh-cliworker-now-0.7.3.tgz` 含285个文件，SHA-256 `7a0a357cadec7421c90322446dece474034372c3cce7d1b5da939c792fae9f56`。包逐文件匹配正式构建，111个源码文件与preview一致；Host逐字相同，Client仅构建目录产生的node_modules区域注释路径不同，所有可执行内容匹配此前30项原生UI验收。记录 `artifacts/dsh-cliworker-now-0.7.3-verification.json`。
- 原生Desktop插件详情显示v0.7.3、启用、1组件运行中；安装后核对两种编辑弹窗的全宽及紧凑布局（仅打开与取消）、异常右侧淡红垃圾桶、名称到分隔符间距及无图标、固定搜索筛选和下方独立滚动、标题下历史圆角提示条与新建入口、输入区无重复提示、两行无图标启动页。保留旧任务禁用发送行为，未实际新建或发送，最后回到原“你好问候开场”会话。
- 更新前后4189个原账号、配置、偏好和历史文件哈希核对：4188个完全相同，仅允许重启生成的 `host.lock` 改变；缺失0、意外变化0。更新后21个Worker、活动0、账号/任务桥进程0；本轮真实模型生成0、远端凭据查询0。记录 `.test-data/layout-polish-073/{desktop-verification,state-preservation}.json`。
- 先前Mac锁定的交付缺口已补齐；实现已按阶段提交为 `b4db1a2`，保留原有未提交改动；本轮不推送。现可完成OpenSpec最后交付任务，随后同步和归档本change。

- OpenSpec最后交付任务已核对完成（5/5）；主worker-management规格完整替换2块、增加3块，Purpose和其余4块及全部旧场景保持。同步后严格10/10，归档到 `openspec/archives/refine-panel-layout/` 后严格9/9、活动change0。本次交付补验和归档另作阶段提交，不推送。

## v0.7.4：卡片与回收站修复实施（2026-10-09）

- OpenSpec `fix-worker-overview-regressions`，对应用户六项回归：首卡顶部边缘、名称按钮包围、整行箭头和移除省略号、回收站四筛选返回及选中颜色、多层模型名称、默认强度文字。源头分别为列表顶部零内边距、filter与showArchived转换缺失、箭头仅属于标题行、名称水平padding为0，以及展示函数只去掉一层路径。
- Panel/name-copy专项72项通过，覆盖四种筛选从回收站返回、query与旧筛选保留、右键/键盘菜单、独立复制、删除恢复。模型展示/Worker管理/设置/派遣展示专项181项通过，覆盖多层Hermes tuple与同名不同组织ID/能力不变、default标签和保存值；不以CSS断言替代最终视觉验收。日志 `.test-data/card-regressions-074/{targeted-tests,presentation-tests}.log`。
- README中英及设计同步；前三项实施已完成，完整集成检查、preview原生UI及Desktop更新仍需实际完成后追加记录，不将专项结果当作整体交付完成。

- 集成检查：`pnpm typecheck`通过；完整Vitest 68文件通过、1文件跳过，1304项通过、7项跳过；严格规格10/10通过；`pnpm build:preview`通过。独立源码审查确认显示清理不改原生分组身份/执行ID，Menu实际anchor保留原生焦点恢复。
- 最终preview+原生Harness隔离UI35项通过：首卡顶缘8px留白、名称左右4px、整行箭头中心差0、无省略号；回收站四筛选正确返回且query保留，浅暗主题深红白图标；右键/键盘菜单与Escape还焦、正常打开和复制隔离；复制hover1250ms保留、leave1029ms恢复；Hermes卡/详情/菜单/设置只显示ling-3.1-flash和默认，两次模型选择RPC都保留完整tuple及default，原模拟Hermes/legacy Worker和events四文件不变；长列表scrollTop500进入/返回保持500，滚回顶部仍完整，旧缺绑定任务仍禁发。1000×780px窄窗口实际右栏543.5px、宽窗口右栏656.5px，无横向溢出且固定控件不动，未冒称320px已验。
- 18775隔离wrapper/Host均退出，自建Tabbit页面0、任务finish无issues。启动时一次subprocess尝试被guard拒绝，真实CLI、远端请求和模型生成均0。原账号/偏好/历史4189文件更新前哈希全部相同。证据 `.test-data/card-regressions-074/ui/{ui-verification,model-id-verification,cleanup-verification}.json`及六张截图。

### v0.7.4 Desktop 交付（2026-10-09）

- 原生Desktop更新前21个Worker、活动0、账号/任务桥0；通过原生菜单正常退出并确认主进程已结束，正式 `pnpm build`、`pnpm pack --pack-destination artifacts`及包验证通过。实现阶段本地提交 `d403b9b`，未推送。
- 包 `artifacts/dsh-cliworker-now-0.7.4.tgz` 含285文件，SHA-256 `e5d276c0bf7c994c6f3daf881566efd663c0b4fcc0a06e56958f9c6f92ad1a1a`；111源码与最终preview相同，Host逐字一致，Client仅node_modules区域注释相对路径不同，所有可执行内容与35项最终UI验收一致。
- 重启后的原生插件详情显示v0.7.4、启用、1组件运行中。安装后实际查看Antigravity完整顶缘、名称留白、无省略号及整行居中箭头、Hermes显示ling-3.1-flash和默认；实际进入已删除视图，查看灰色四筛选和深红白图标，并逐一通过全部/进行中/已完成/异常返回正常列表及对应选中态。恢复原“调用Antigravity工具说你好”会话的全部列表，没有新增、删除、改名或发送实际任务。
- 原账号/配置/偏好/历史4189文件中4188逐字不变，仅重启的host.lock允许改变，缺失0、意外变化0；更新后21个Worker、活动0、账号/任务桥0。真实模型生成0、远端凭据查询0。证据 `.test-data/card-regressions-074/{desktop-verification,state-preservation}.json`与 `artifacts/dsh-cliworker-now-0.7.4-verification.json`。

- OpenSpec最后交付任务已核对完成（5/5）；主worker-management规格完整替换4块、增加1块，Purpose和其余5块及全部旧场景保持。同步后严格10/10，归档到 `openspec/archives/fix-worker-overview-regressions/` 后严格9/9、活动change0。本次交付和归档另作阶段提交，不推送。

## v0.7.5：状态条与名称字距（2026-10-09）

- 已核查原生rc.2展开新会话按钮38px；Client状态条由32px调整为38px。无会话输入区说明从JSX移除，原草稿、历史、错误以及输入/按键/表单阻塞保持。
- 名称按钮扩大但文字起点保持，首个全角分隔符改细线；名称与模型到线的距离按文字边缘等距，左右留白及长名省略保留。名称复制16项与Panel56项定向回归通过。
- 后续集成、隔离渲染与Desktop交付结果将按实际执行追加；默认不发起真实CLI/模型请求。

- 集成检查实际通过：pnpm typecheck、pnpm test（68文件/1304通过、7跳过）、pnpm spec:check（10/10）、pnpm build:preview。隔离真实原生UI21项通过，banner与原生按钮均38px；v074→v075名称字起点不变，按钮增加8px，两侧字距11px、button到线3px；短/长名及实际543.5px窄pane均完整。无会话提示节点0且输入/发送禁用；新建取消保留草稿，复制离开1037ms恢复，原生右键及回收返回通过。所有消息/账号/目录为模拟，真实CLI/模型/远端请求0，临时Host/Tabbit页面已清理。证据：.test-data/card-polish-075/ui/ui-verification.json及4张截图。

- 正式交付：更新前21 Worker/活动0/账号或任务桥0，原生退出Desktop后正式pnpm build、pnpm pack及包完整性核查通过；v0.7.5共285打包文件，111源码与preview一致，Client仅构建路径注释不同、执行文本一致。包SHA-256 dbc77e03ffa6a257d3384038c34a615accbdfcbdc8e6a5dc0ac97285bbbc115f，artifacts/dsh-cliworker-now-0.7.5-verification.json记录结果。
- 已安装Desktop原生核对v0.7.5、启用及1组件运行；原标题下状态条加高，卡片名称与细线字距正常，agy-3无会话说明已删除但输入和发送仍禁用；返回原“调用Antigravity工具说你好”总览/全部。真实任务、发送、新建、删除及改名0。4189份原文件核对4188份完全一致，仅重启host.lock变化，账号/历史/偏好保持；交付后活动仍0。实现提交7b523ab，未推送。

- OpenSpec 4/4任务按实际结果完成；worker-management主规格完整更新2块并增加无会话输入区1块，Purpose及其余8块和旧场景保持。同步后严格10/10；归档到openspec/archives/polish-worker-name-and-notice/后严格9/9、活动change0。本次交付及归档阶段提交，不推送。

## v0.7.6：简洁筛选区（2026-10-09）

- 已删除生成匹配说明及清除筛选的完整JSX和无用CSS，同步双语README。三类状态正向/空结果、搜索恢复、草稿保持回归通过：Panel59项，全套68文件/1307项通过、7跳过；Host/Client typecheck、严格规格10/10和preview通过。
- 隔离UI及正式Desktop交付按本次实际结果继续记录；不发起真实CLI、凭据查询或模型生成。

- 隔离原生UI实际核对13组筛选/搜索状态：三类正向、空结果及清空恢复；全部搜索正向/空结果与恢复，匹配数量/空结果说明/清除筛选均不存在，首卡与控件位置正常。最终Client hash与served一致，截图empty-filter.png已查看。独立HOME/DSH_HOME，临时Host/wrapper及自建页面已清理，真实CLI/生成/远端请求0；首次访问缺少临时token返回401，使用本服务临时URL后解决，不是账号阻塞。

- 正式交付：更新前22 Worker/活动0/账号或任务桥0，Desktop原生退出并确认主进程退出后正式build、pack及包核查通过。v0.7.6包共285文件，111源码与preview相同，Client执行内容一致；SHA-256 35a3f9c395d9aa3afae2ccbcf1dd0b763f7ee69ba2859a74a8288c1c14ffea4f，artifacts/dsh-cliworker-now-0.7.6-verification.json保存核查。
- Desktop原生插件页确认v0.7.6、启用及1组件运行；原会话三状态都没有匹配说明/清除文字，最终恢复原“进行中”视图，截图核对空白正确。原4210文件核对4208完全一致，仅重启host.lock及一份宿主session_projcache投影缓存检查点变化；已查rc.2原生SessionProjectionCache在会话释放时重写检查点的源码，原始日志/账号/历史/偏好文件保持，交付后活动0。未发送、新建、删除或改名任何真实任务，凭据查询和模型生成0。实现提交5d5b38c，本地不推送。

- OpenSpec 3/3任务均实际完成；主worker-management完整更新固定筛选需求1块，保留Purpose、其余10块及旧场景。同步严格10/10，归档到openspec/archives/simplify-worker-filter-view/后严格9/9、活动change0；交付与归档阶段提交，不推送。

## v0.7.6：npm预构建分发（2026-10-10）

- 用户本轮明确授权GitHub提交及npm公开发布。18个既有提交已正常快进推送main至86e4232，Windows native runtime CI成功（37952678662）；原未提交86项不进入push。
- npm官方网页登录由用户完成，仅临时私有userconfig保存；凭据不输出、不入Git。发布目录285文件、运行lib280文件与原已验收包一致，SDK peers/exports保留，根private:true、公开private:false、无消费侧脚本。node语法及3项隔离错误输入拒绝通过，npm发布dry-run通过；README短安装为发布候选，远端发布及实际安装仍按后续证据记录。

- GitHub公开v0.7.6 Release，完整commit741495a21cafe8952155739f06e24ad232e033d3；下载包与本地公开包一致，SHA256 654d5f128fd7aff6f24bb7e37a5cf4091461c77cdb322fb2572ce7f3acd20f7e。Windows CI 37956748796成功。独立profile实际GitHub URL安装/版本列表及全新Host graph通过，280 lib/19 helper一致，Agent/模型/CLI/账号查询0，服务18780已清理；这不是npm registry验收。
- npm官方登录已成功。首次发布EOTP；旧CLI大上传超时；npm12标准web流程和gzip传输均维持二次验证，gzip将首次PUT401响应缩短至4885ms，tarball不变。网页停在Security key，用户尚未完成安全密钥验证，各验证链接最终过期（done接口404）。registry对应包仍404；未重复覆盖已发布版本，临时userconfig和日志留在0700/0600私有目录且不入Git。
- 本次仅任务1.1实际完成。任务2.1的npm发布、2.2的registry实际安装及3.1的npm推荐/页面验收待账号安全密钥验证；活动OpenSpec保持，不归档或虚勾。GitHub README中英临时推荐使用已验证v0.7.6 Release URL，56字符npm短命令仅留私有候选，原131字符推荐不宣称已缩短。用户完成验证后继续相同公开包发布和registry验收。

- 2026-10-10续办：用户准备完成验证后，自动在同一PTY控制器中打开npm官方链接，安全密钥验证成功，普通publish返回PUT202；短时公开元数据仅占位0.0.0-stage而owner元数据已见0.7.6/latest。官方stage list和网页待审批均空；显式stage请求拒绝已有版本，未重复写入。随后匿名元数据更新为0.7.6/latest，匿名tarball下载SHA256/SHA512与GitHub相同，确认实际公开，不再误把CLI受理当公开成功。
- 公开npm0.7.6与GitHub Release共用同一包，SHA256 654d5f128fd7aff6f24bb7e37a5cf4091461c77cdb322fb2572ce7f3acd20f7e。独立无认证HOME/DSH_HOME/profile真实执行native add固定包名、native ls、全新Host图与退出：依赖和resolved来源为registry，280lib/19helpers全匹配，Agent/Worker/模型/CLI/账号查询0，端口18780及进程和锁清理完成，未改Desktop。证据install/install-verification.json和registry-cleanup.json。
- 中英README推荐改为56字符 dsh plugin --profile desktop add dsh-cliworker-now@0.7.6，原命令131字符，单行无上下备注，Web及GitHub备用保持折叠段。npm/root源码版本未改，原开发manifest仍private:true。前述待安全密钥事项已解除；后续页面核对与最终规格同步按实际结果追加。

- GitHub默认中文首页实际渲染推荐命令56字符，npm官方页面实际显示0.7.6、完整README及同一短命令，截图github-install-proof.png/npm-install-proof.png已查看。npm标题包含TypeScript图标替代文本，调整可访问名称匹配后核对成功，不将先前选择器超时当发布失败。Host/Client typecheck与严格规格检查通过；仅发版元数据/说明/打包脚本改变，运行lib仍与原已验包逐字相同，未再次宣称重跑1307项。

- OpenSpec四项任务4/4均完成，package-distribution主规格完整更新2块并保留Purpose/旧场景；同步后严格10/10，归档到openspec/archives/publish-prebuilt-registry-package/后严格9/9、活动change0。主页/包页、远端字节及真实registry profile安装均验证完成；本地提交并按本轮授权推送GitHub，原未提交修改继续排除。


## 2026-10-10：Mac 到个人 Windows 的隔离远程验收

- 用户授权接通 Windows 测试环境和流程；OpenSpec `add-windows-remote-test-workflow`，规划提交 `4c2d2e8`。新增 `scripts/windows-remote.mjs`、common/runner、27 项边界用例与 `test:windows:remote` 开发入口。中英 README 开发段和专用指南同步，安装区保持原单条命令；不新增运行时依赖或版本发布。
- 本机执行 `pnpm --config.verifyDepsBeforeRun=false typecheck`、新增测试 27/27、隔离 build:preview/pack、严格规格 10/10、git diff --check。现有回归在受限环境的真实进程用例失败并停滞，终止该次自身 Vitest 后用实际进程权限复查通过；完整回归 1300 通过、7 个权限夹具因本次命令 umask 077 不符而失败、7 个 Windows 专属跳过，标准 022 下两文件 44 项全过，合并核对 1307 通过/7 跳过。无产品/夹具源码改写。
- 实际命令：`pnpm --config.verifyDepsBeforeRun=false test:windows:remote --config .test-data/windows-remote/config.json`。Windows 11 x64、Node 24.15.0、固定 pnpm 11.25.0；专用 tools 非全局安装，SDK 与 Harness 0.2.0-rc.2 在本次依赖目录内，独立空配置执行 Harness --version 退出 0。
- 成功 run：冻结锁文件安装、归档列表/特殊文件核验、Mac 协议声明准备、类型检查、七个现有 CI 文件、原 Mac 包 Host 入口加载九阶段退出码全部 0。101 项通过、1 项明确 POSIX Pi launcher 场景跳过、0 失败；真实 Windows Job/取消、ConPTY、Python 用例通过，其余账号与 launcher 数据为合成夹具。Host 实际导出 CliWorkerService/default，在 Windows 本机 SDK 依赖中 import 成功。
- Mac/Windows 包 SHA-256 相同：`775bae13cb1dd5a1b1135be204ef5025de494f171ededd1a74d90d028dfc6b58`。报告、阶段日志及原始 Vitest JSON 回传，测试 JSON 哈希及计数/七文件/必要阶段/运行 ID 校验通过，正常运行两端锁释放并确认清理。
- 初次真实试跑分别暴露 PowerShell Get-Item 隐藏 AppData 需 -Force、gitconfig 文件误作目录、冷源码缺生成 remote 声明三项准备问题，逐项修正并保留失败/回传证据；最终成功不遮蔽这些记录。另在实际安装阶段主动 SIGINT：流程非零退出、两端 interrupted、报告回传、Windows 自有进程范围清理及两端锁释放确认。
- 私有证据在 `.test-data/windows-remote/runs/`、mac-regression-summary.json、cancellation-check.json、harness-version.json；原报告/日志/配置和个人机器信息不入 Git。最终 Mac 当前 lib 281 文件哈希与开始前完全相同，未正式 build 或更新 Desktop。模型调用为 0；官方 CLI 额外版本/帮助探针、真实模型、Windows 全量矩阵和 Desktop 界面均未验收，不以本次结果代替。
- 交付：实施提交 `b171f24`；OpenSpec 6/6 有实际证据，新增主规格 4 条需求，归档前后严格 10/10、活动变更为 0，归档到 `openspec/archives/add-windows-remote-test-workflow/`。只本地阶段提交，不推送；用户原有素材和文档改动保留。


## 2026-10-10：Windows 插件运行复验与实际 Harness 安装启动

- 用户要求在 Windows 重新跑插件测试。执行现有 `test:windows:remote`：Mac 当前隔离构建包上传、Windows 冻结本机依赖、类型检查、七个定向测试、原包 Host import 及证据回传均通过；101 通过、1 项已知 POSIX Pi launcher 跳过、0 失败。Windows x64 / Node 24.15.0 / pnpm 11.25.0。
- 补做真实 Harness 0.2.0-rc.2 验收：在本次 run 空 HOME/USERPROFILE/APPDATA/DSH_HOME 与管理配置目录中，使用原生 `plugin --profile windows-plugin-acceptance add --save-exact <Mac tgz>` 安装；原生 ls 退出 0，profile bundle 注册正确，安装后全部 280 个 lib 文件与 Mac 原包逐文件哈希相同。非用户 Desktop profile，无现有会话和账号写入。
- 在真实 web Host 内通过验收夹具读取 cliworker 服务及客户端 graph，注册、版本、客户端 bundle 哈希均匹配；Agent 和 Worker 为 0。夹具封锁真实生成、账号查询、外部 CLI 和外网 fetch，未把模拟对话或任务当成真实运行。
- 实际 HTTP 验收：认证根页返回 200，序列化 `globalThis["__DSH_BOOT__"]` 含插件；插件 JavaScript 返回 200，实际模块加载包装有效。向 `/api/cliworker/cliSettings` 发送缺少 parentSessionId 的请求，得到 HTTP 200 的 server-response 与预期 `gateway/arguments-invalid`，证明生成 endpoint 与参数校验注册正确，不将该错误响应写作真实任务成功。
- 首次私有验收夹具误用不存在的 ready 事件及字面 window.__DSH_BOOT__ 判断，分别超时/误拒真实正常 HTML；改用 appReady.onReady 与实际 globalThis 序列化形式后通过，未修改插件代码，各轮诊断保留。全部实例通过 Host 内 SIGTERM 正常 dispose，最终退出 0、fixture cleanup receipt 存在；再读 Windows 核对该 run 进程 0、18790 监听 0、host.lock 0、远程 run.lock 不存在。
- 报告和私有日志保存在 `.test-data/windows-remote/runs/` 对应 run 的 remote/ 与 harness/；连接令牌/Cookie 未输出或入 Git。当前结论仅为 Windows 安装、启动、插件注册/资源/Gateway及原生进程链路通过；真实 CLI 模型任务、账号权限和 Windows 原生 Desktop 画面未验证。模型调用 0，未更新 Desktop 或发布版本。


## 2026-10-10：实际 Windows Desktop 登录与功能验收

- 用户授权直接操作其实际 Windows Desktop，所有已登录且有额度的 CLI 沿用已保存模型做最小测试；MiMo 无默认值时单独明确选择 MiMo-V2.5/default。对象为 Windows 本机 DeepSeek Harness 0.2.0-rc.2 / 插件 0.7.6，不把此前隔离 Host 测试当成实际 Desktop 证据。
- 11 个 CLI 设置逐一检查。Kimi 本次原生终端登录、用户授权及刷新 authenticated 通过；Claude 识别已有 OAuth；两者模型目录仍拒绝确认自身账号，未执行真实任务；这涉及当前版本 OAuth 绑定/目录能力，尚不能归因为 Windows 特有故障。Antigravity 浏览器授权后未观测 CLI 完成，刷新仍未登录，且等待流程被本次验收关闭，需要完整复测，不能独断供应商失败。ZCode 管理终端启动失败；OMP 管理及登录立即退出；Grok 管理终端关闭后进程残留并阻塞后续登录。
- MiMo 模型目录、默认模型/强度保存、首次选型/角色卡、主对话派遣、过程与结果回传通过；首次任务真实创建测试文本，独立实读内容与哈希匹配。续聊保持同一原生会话，正确回忆文件名。两轮停止分别保留证据：提前停止未捕获运行前进程，不宣称运行中终止；另一轮在实际 UI 运行中且 MiMo/启动器进程存在时停止，三进程消失、状态 interrupted。Worker 无持久化 exitCode 字段，completed 按实现的退出 0/协议成功/退出确认判定并结合事件及产物核验。
- 实际 UI 通过临时角色增改删且原 7 个预设完全不变、MiMo 启用切换恢复、标题/名称独立改回、删除恢复同 Worker/native session、搜索及状态筛选、概览/子对话导航、运行时输入禁用。正常重启后会话和插件任务卡存在，模型偏好保存。未宣称注销重登、全部 CLI 真任务、跨项目继承、全部并发/权限/迁移路径完成。
- 实际安装包复现 Pi/OpenCode Windows launcher 拒绝而误报未安装，文件真实存在；Pi 已装 1.1.0 与插件只接受 1.0.2/1.0.4 是独立限制。Codex/Hermes 未找到可用 CLI，登录按钮禁用。没有重装 CLI、注销既有账号或修改产品代码。
- Grok 残留在正常退出整个 Desktop 后仍存在；核对本次 helper/父子关系后仅清理本次进程树。源码审阅发现外层账号弹窗关闭异步卸载并吞清理错误的恢复缺口，底层终止失败原因尚未确定。Desktop 已无调试参数重启，临时端口/SSH 隧道关闭、临时计划任务清空；测试会话和文本保留。
- 私有白名单结果、运行事件摘要、进程与截图证据及完整中文报告保存在 `.test-data/windows-remote/desktop-audit/`，不含凭据导出、不入 Git。此次只补充真实验收记录，不新建行为变更或发布；后续修复需单独按 OpenSpec 实施并复测，当前不判定全功能通过。

## 2026-10-10—11：Windows 登录修复与 MiMo 性能阶段验收

本段保留各阶段证据，当前结论以末尾最终 Desktop 复验为准。账号终端及 Antigravity 真实任务已通过；Claude 官方登录和 Kimi 额度边界仍单独保留，变更尚不归档。

- [x] Pi/OpenCode Windows 入口：实际 Windows 静态解析成功，Pi 指向官方 `@earendil-works/pi-coding-agent` 1.1.0 的固定入口，OpenCode 指向官方 npm 原生 exe。中文、引号、百分号、`&` 与空参数保持字面值。另用明确标记的模拟安装验证附加命令、错误包身份、损坏 PE、版本路径越界、未知版本及启动器改变均被拒绝。证据：`.test-data/windows-remote/launcher-fix/probe-result.json`、`rejection-result.json`。
- [x] Pi 1.1.0 原生契约：无凭据、无网络请求、无模型调用的实际 SDK/RPC 探针通过，包含 SDK 空会话/UI 方法、RPC `get_state` 与 `abort`、会话 ID 和退出码 0。原生登录菜单可显示并清理；该菜单被主动终止的退出码为 1，不能描述成完成登录。README 与设计文档已纳入 1.1.0，仍明确真实账号登录与模型任务未验收。
- [x] MiMo 能力缓存及隔离：仅在 Host 内存复用不含明文凭据的解析能力，30 秒、最多 16 项。账号、配置、项目、环境、入口及实际运行时/脚本变化使缓存失效；退出账号、取消和远端授权撤销不会因热缓存放行。实际 Windows 回归包含热缓存逐次重查远端模型权限、取消 paths/config/models、读取期间快照变化与失败不缓存等用例。
- [x] MiMo 真实元数据对比：同一 Windows、MiMo 0.1.15，旧实现三次为 6,899/5,267/5,085 ms，每次 3 个原生元数据进程；修复 Preview 首次未命中为 5,061 ms、3 个进程，随后命中 88/92 ms、0 个进程，解析能力均为 3 项。旧中位数 5,267 ms 对比热读平均 90 ms，元数据阶段约减少 98.3%。首次仍约 5 秒，不把此结果当完整任务耗时或服务端响应提速。证据：`.test-data/windows-remote/desktop-audit/mimo-metadata-benchmark.json`。
- [x] MiMo 实际 Desktop 完整目录：安装包 run `82132c8d-09dc-4c9e-acc6-b4e1736431c2` 后，首次目录查询 7,849 ms、连续热读 754/670 ms，包含当前账号及在线目录检查。元数据缓存 88/92 ms 与完整目录 754/670 ms 是不同测量范围，不混用。
- [x] MiMo 真实写文件：沿用原验收 Worker 与原生会话，使用用户明确选定的 `xiaomi/mimo-v2.5/default`。提交前检查 694 ms，queued→completed 14.723 秒，总计约 15.4 秒；协议 `SUCCESS`、持久状态 `completed`。原生首次写工具报错后自行修正，再次写入成功。读取实际 `cwn-windows-fix-82132c8d.txt`，内容等于 `WINDOWS_FIX_OK\n`，SHA-256 为 `FE1180B698337661D29E3314A13385EE1BD3A98532A28EF84A6D8336EC1C18A8`。不是只采信模型完成自述。
- [x] MiMo 同会话续聊：未再次提供文件名，原生会话正确回复上一轮文件名，协议 `SUCCESS`、状态 `completed`。提交前检查 7,320 ms（缓存已过期），queued→completed 7.154 秒，总计约 14.5 秒。前轮约 61/30 秒与本轮任务内容、会话缓存、网络条件不同，不能将全部差异归因于本次优化。
- [x] MiMo 运行中停止：实际启动 MiMo、启动器、PowerShell 等待及两个控制台，共 5 个按 PID/创建身份核对的进程；停止返回耗时 137 ms、状态 `interrupted`，同创建身份的五个进程全部退出。未按进程名称批量终止。完整目录、文件、续聊及停止摘要：`.test-data/windows-remote/desktop-audit/fix-mimo-live-summary.json`；人工核对说明：`Windows-修复与性能复验.md` 的“实际 MiMo 全链路复验”。这覆盖 Worker 停止；账号终端清理的独立验收见末尾。
- [x] 阶段自动回归：本地完整 Vitest 结果为 75 文件通过、1 文件跳过，1,488 测试通过、8 跳过，总计 1,496；原始日志 `.test-data/windows-remote/desktop-audit/fix-full-test-approved.log`，开始时间 2026-10-10 23:52:09。Windows 定向 `node node_modules/vitest/vitest.mjs run … --maxWorkers=4 --reporter=json` 覆盖 10 个测试文件，256/256 通过、0 失败、0 跳过；命令载于 `windows-new-regression-82132c8d.ps1`，最终原始报告为 `windows-new-regression-82132c8d.json`。中间 `*-platform-fixtures.json` 为 254 通过/2 失败，不能当最终通过报告。此阶段通过不覆盖其后的终端改动，最终源码仍需由主任务补回归结果。
- Claude 认证边界已纠正：旧验收把原生 `authMethod=oauth_token` 简称“官方 OAuth 已登录”不准确，实际令牌来自该 CLI 自身的本地代理设置。代理可连接时保持代理；关闭时使用临时原生官方配置，认证失败不切换来源。现有真实官方账号未登录，不能把代理认证或公共能力列表当作 Claude 订阅授权。原生 2.1.296 在未登录时也返回 5 个带 `resolvedModel` 的能力选项；controls-only 探针没有 prompt/模型事件，设置及凭据状态不变。新目录模块在真实 Host backend 下正确拒绝未登录。`get_usage` 可以使用 CLI 自身按账号绑定、年龄小于 60 秒的快照；插件不新增额度缓存，并拒绝缺少原始 limits 的失败 fallback。正向官方登录与任务仍未通过。证据：`.test-data/windows-remote/claude-route/native-route-safe-result.json`、`overlay-isolated-result.json`，以及 `.test-data/windows-remote/oauth-research/claude-readonly/native-control-safe-result.json`、`claude-native-module-result.json`。
- Kimi 当前真实限制：原生 TUI 已自行续期，随后同源 `/models` 返回 HTTP 200 与 4 个原生别名对应模型；`/usages` 返回 HTTP 200、完整空对象 `{}`。官方原生界面对空套餐窗口显示无用量信息，不能解释成无限额或断言用户没有订阅。插件提示剩余额度无法确认并拒绝派遣，不绕过门槛、不手工刷新令牌，不宣称真实模型调用通过。仅确认默认强度。证据：`.test-data/windows-remote/oauth-research/kimi-preview-after-native-refresh.json`。
- [x] Windows 账号终端：实际 Desktop Electron 控制台归属、窗口关闭及后代清理的最终修复和现场验收通过，详见末尾；模拟回归、Node 探针或 Worker 停止不替代该验收。
- [x] Antigravity：实际 Desktop 原生 Credential Manager 账号状态和真实模型任务均有独立证据，Gemini 3.8 Flash Low 文件任务的事件、结果及产物见末尾。
- [ ] 最终集成交付：最新源码完整回归、最终 Desktop 包与源码一致性、活动进程清零、规格严格校验和阶段提交以主任务最终记录为准；OpenSpec 按实际子项记录，Claude/Kimi 边界保留，不归档、不推送。

私有日志与运行证据保留在忽略目录，文档仅记录可核查的结果和边界，不提交凭据、账号原文或用户运行数据。

### 最终安装与 Windows 原生终端复验（2026-10-11）

- [x] 最新源码类型检查及完整回归：1,505 通过、8 跳过；Windows Electron 专项 94/94，覆盖真实三路 TTY、输入、Unicode/空串/引号/元字符参数、停止、自然退出码 7、后代及控制台回收、61 秒后终态关闭与失败重试。仅生命周期夹具明确标为模拟，不冒充模型调用。
- [x] 最终 run `2b637e3f-54b7-4f9f-991d-19709bd62416` 的 Windows 类型检查、107 项通过/1 项 POSIX 专用跳过、原 Mac 包 Host 加载通过；源码与 preview 核对、清理和锁释放确认。
- [x] Windows 无活动 Worker 时正常退出 Desktop，使用安装版自身 `runtime/cli/bin/dsh.cmd` 更新；308 个 lib 文件与包一致。包 SHA-256 `2d9056b725d1d0b9c35468f0ce096df8c7f9a3f8b9ab9897ece0f752061d3a4f`；Host SHA-256 `aaf3205ef88ded62cafd22f7b88b8b2c5958c1827e68c56f62c8a9e98177b1b5`。Mac 正式构建后恢复应用，Host 哈希相同。
- [x] 真实 Windows OMP 输入 `/login` 显示提供商菜单，黑色块状光标与焦点边框可见；外层关闭无错误，三个已记录 PID/创建身份均退出。Pi 1.1.0/OpenCode 原生认证菜单、ZCode Z.AI 登录提示、Grok 原生授权入口均能打开、获得输入焦点并正常关闭。未提交新账号凭据或退出既有账号。
- [x] 根因修复以实际 Electron 为准：固定 PowerShell 等待 GUI helper；账号专属 `CONIN$` 恢复输入，仅预加载本次 Electron CLI，不改共享 Host/任务输入。`cleanupConfirmed` 仅在全范围及私有资源释放完成后发出，修复终态过期后关闭误报。
- 派遣路由增量 81 项通过：排除插件/工具说明，归一同 CLI 括号别名和重复指令；未知/不同目标仍拒绝。实际 Antigravity 派遣成功见下一节；Claude 原生进程虽启动，但终端空白，尚不确认官方登录流程正常。
- 证据为 Git 忽略目录 `.test-data/windows-remote/desktop-audit/` 中 `final-full-test.log`、`windows-electron-final-regression.json`、`electron-host-final-tty-result.json`、`final-install-result.json`、`final-desktop-ui-summary.json`、`final-omp-cursor-input.png`。前述中间包失败作为历史保留，以本段及后续记录为当前结论。

### Antigravity 真实最小任务通过（2026-10-11）

- 用户明确选定 Gemini 3.8 Flash、Low；在专用 Windows 验收聊天通过真实插件选型，未附加角色预设。原失败句含 `CLI Worker` 与 `Antigravity（agy）CLI`，更新后成功进入选型和执行。
- Worker `ba82f9d8-a2ac-419f-b6ff-aea6b74a32f0`，run `91a5c33f-9c9c-441f-b91d-988008a22526`，原生会话 `a7763d79-f6d3-4ec6-8ddc-4883e6d3ea24`。原生选型 ID `gemini-3.8-flash-low`，思考强度 low。queued 到 completed 约 22.0 秒；事件包含 write_to_file DONE、result SUCCESS 和最终 completed。
- 实际 `cwn-windows-agy-fix.txt` 的内容严格等于 `AGY_WINDOWS_OK\n`，SHA-256 `57FF6AF8ED1A0D68189F378DCD137658D6E57CD1AAE2D2FE80F1FC23760B0F0C`。独立读取核对，不以模型自述代替验收。证据 `final-agy-worker.json`、`final-agy-events.jsonl`。
- Claude 仍单独待验：官方登录进程已启动并监听本地回调端口，但真实 xterm DOM 无输出（非 Canvas），尚未确认浏览器授权页面或账号登录成功；不据此宣称官方登录全链路通过。

### Claude 官方登录对照与重试（2026-10-11）

- 已结束先前空白终端，三个精确归属进程均退出。同一已安装 helper/Electron Host 的 `--version` 正常输出 2.1.296、退出 0；`auth status --json` 的内联 JSON/私有配置文件对照均正确识别官方未登录、退出 1，清理确认，未启动模型。
- 相同官方配置的 Windows 原生可见控制台出现完整浏览器/备用链接/回填码提示，随后仅清理该次进程和非秘密临时配置。没有据此认定已经登录。
- 实际插件再次启动，恢复 Desktop 窗口前台后已看到上述三项提示，xterm 输入聚焦，未显示登录错误；源码/安装包未变。首次空白时未确认窗口可见性，不能据此断言 CLI OAuth 挂死或 stdin/stdout 故障；准确原因仍未确定。当前等待用户完成官方授权，未计为 Claude 真实模型通过。
- 安全证据：`claude-version-probe-result.json`、`claude-status-inline-file-result.json`、`claude-native-console-control-result.json`、`claude-desktop-login-retry.json`；仅保存固定提示布尔值、身份及退出结果，不保存授权 URL/验证码。

### 阶段交付与待用户授权

- 已本地提交 `d416b44`、`db5d9a7`，未推送、未发新版本。当前安装包与最终源码对应；严格规格 11/11 通过。原有素材移动及文档改动未混入提交。
- 实际 Windows 三个 Worker 均已结束（两个 completed、一个 interrupted）；本次临时 UI 计划任务为 0。当前只保留用户待授权的 Claude 账号终端，故不重启 Desktop 以免取消授权。正式关闭账号终端及恢复无调试参数启动仍待后续完成。
- 修正首次空白的证据解释：xterm 6 的 DOM 绘制与输出缓存分离，不可见时可推迟刷新，空 DOM 行不能证明没收到输出；同代码恢复前台后已显示完整提示。首次现场缺少可见性/缓冲证据，不断言具体根因。账号授权与模型执行仍以真实成功状态核对。
- Claude 官方账号授权需用户完成；Kimi 同源额度响应为 `{}`，没有可核验剩余额度，继续保留未验收边界。其余已完成的 UI、MiMo 文件/续聊/停止、Antigravity 文件任务和自动测试不受影响。OpenSpec 保持活动，不通过归档隐藏缺口。

- 已关闭本次 Mac→Windows 调试 SSH 转发，Mac 19487 监听为 0；Windows 当前登录终端继续等待用户操作，应用的本机调试参数将在账号终端结束后正常重启清除。

### 用户跳过 Claude 官方调用后的收尾（2026-10-11）

- 用户明确没有 Claude 官方账号或额度，要求跳过真实调用；不再要求其完成官方授权。保留已有代理/原生官方来源选择规则及登录入口验证结果，不将“已显示授权提示”记成官方登录成功或模型执行成功。本轮没有发起模型调用或新的登录。
- 实际待授权终端窗口已关闭，外层设置退出；原账号 scope 已释放，不按旧 PID 操作后续复用该编号的进程。三个 Windows Worker 全为终态，活动数 0。通过应用自身退出菜单关闭旧调试实例，随后无调试参数正常启动 Desktop。
- 收尾实测：旧 GUI/Host 已退出；Windows 19487 监听为 0；ready 账号 scope 为 0；临时 UI 计划任务为 0。新的 Desktop 已运行且无 remote-debugging 参数；Mac 本次 SSH 转发已关闭，19487 监听为 0。未退出用户已有账号或修改代理设置。
- 安全证据：`.test-data/windows-remote/desktop-audit/claude-skip-final-cleanup.json`。Kimi 的同源额度未知仍单独保留；Claude 官方正向账号/模型验收按用户要求跳过，OpenSpec 保持未验收边界，不归档。


### 共享终端精简与 Windows 追加回归（2026-10-11）

- [x] 按用户追加要求删除所有账号终端粗黑外框、粘贴按钮、单独的网页登录按钮及底部粘贴快捷键小字，Mac/Windows 共用同一 React/xterm 实现。Windows 实际 focus outline 为 none，终端仅保留关闭按钮；Mac Pi 1.0.4 新版终端同样无多余控件、中文系统粘贴可见，未回车提交模型。Mac OMP 18.4 提供商搜索未显示粘贴文字，Pi 的相同共享通路成功；未将该菜单差异当成共享粘贴失败或宣称原生 CLI 所有菜单均兼容。
- [x] Windows OMP 18.8.7 实际 Ctrl+V 中文只进入一次。双击形成真实 xterm 选区后，以原生 Ctrl+C 复制，系统剪贴板与受控中文字符串精确一致，终端保持运行；无选区 Ctrl+C 仍进入 CLI 原生中断流程。原剪贴板只在 Windows 临时内存保留且恢复，未导出。右键粘贴在同源共享输入改动的前一安装包已实测，最终版复制/右键分支及迟到读取另有定向回归；不以模拟键盘逐字输入替代系统粘贴验收。初次自动拖拽未形成选区，原因未确认，以实际双击选区复制结果为准。
- [x] ZCode 0.16.9 根因实证：原生终端网址有 client_id/redirect_uri/state/response_type，旧 Windows 浏览器仅收到 client_id。修复后登录自动打开 chat.z.ai/auth 正常登录页，四个参数名齐全，无错误提示；终端原网址悬停为 pointer，点击重新打开也保持四参数。保留原生授权轮询，关闭后清理；本轮未完成账号授权，不把网页正常当成登录成功。证据不记录 URL 参数值。
- [x] Codex 官方 Windows Store 固定入口真实版本 0.162.0-alpha.17.2；插件 installed=true、authenticated 且 verification=cli，Desktop 显示已登录，原生账号终端出现 OpenAI Codex 和输入提示，关闭无异常；本轮没有提交模型任务。
- [x] 用户批准的 Hermes 官方原生安装完成，固定提交 c57331677d7fc46298a7159cf3a650853f0966c5，版本 0.21.6+607.gc573316，version 命令退出 0；官方安装 receipt 标记 success，未安装可选浏览器/计算机控制依赖。安装器 GUI wrapper 没有可靠进程退出码，不能据此声称安装器 exit 0。实际 Desktop installed=true、unconfigured。
- [ ] Hermes 原生登录终端实测发现隔离 home 下依赖选择缺失，提示 no dependency environment is committed；正在把 Windows 入口接入已有依赖 pin 流程。安装完成/版本命令正常不等于登录终端完成，待后续证据补齐。
- [x] 最终共享终端代码全量 1627 passed/8 skipped（81 文件通过、1 文件跳过）；Windows 实装 Electron(asNode) 专项 10 文件，189 passed/2 POSIX-only skipped/0 failed，进程退出 0。原默认沙箱完整测试挂起，按本轮 PID/创建身份清理后授权环境重跑通过；不将首次挂起解释成业务测试失败。类型、严格规格 11/11、隔离 preview 与 Windows run 2c16676d-21c6-4bb6-b5b7-e780a8430cb3 原包加载通过。
- [x] 两端无活动 Worker 时更新：Windows 使用原生安装器，唯一文件名避开同路径 tarball 缓存，317 个 lib 文件与包逐项匹配；包 SHA-256 92dea5e01532a40072189ab7eb2dd217d34e40698ec19d8204373f1be8ffef46。Mac 正式构建并重启，实际新版 Pi 终端验收通过；账号终端已关闭。最终 Windows 无调试重启与 Hermes 后续包另行记录。
- 私有证据：terminal-ux-live-safe.json、terminal-ux-windows-final.png、terminal-ux-final-tests-approved-results.json、windows-electron-user-terminal-2c16676d-utf8-summary.json；位于 .test-data/windows-remote/desktop-audit/。Hermes 安装回执位于同级 hermes-install-review/。既有 Claude 官方账号/额度跳过、Kimi 额度未知等边界保持；未推送、未归档。


### Hermes Windows 依赖修复与本轮最终交付（2026-10-11）

- [x] 修复上一阶段待办的 Hermes 隔离账号目录依赖定位：共享 Mac 的已提交官方 venv/lease 机制，Windows 仅补充固定 distlib/cmd 入口解析和原生文件锁。6 项新测试覆盖合法入口、拒绝伪造/不一致记录及环境边界；没有启动 bootstrap 或复制其他账号凭据。
- [x] Windows 实际 Desktop 最终包显示 Hermes 提供商菜单、`Choice [default 1]` 和 Leave unchanged，无 `no dependency environment` 或 traceback。后续原生流程显示 Nous Portal 网页授权提示；未完成授权，已取消账号终端并关闭本次临时网页。Hermes 当前仍未配置账号，本轮没有模型调用。安全记录只保留状态/提示布尔值，不保留授权码截图。
- [x] 最终本地完整回归 1633 通过、8 跳过、0 失败；类型检查和隔离 preview 通过。最终 Windows run `ae2dbcd8-0777-4780-a25b-461089dfe5c4`：类型/Host 加载通过，基础测试 107 通过、1 项 POSIX 跳过；实际 Desktop Electron 11 文件专项 195 通过、2 项 POSIX umask 跳过、0 失败，进程退出码 0。模拟协议测试与实际界面证据分开，不将其计为全部 CLI 真实模型成功。
- [x] 在活动 Worker/账号终端均为 0 时安装最终包：SHA-256 `14f8d8f258220d5846dcd9a9598905a8ab32979b45acc6ca7c76c5113c4d7d01`，Windows 320 个 lib 文件与 preview 包逐项一致。Mac 正式构建 Host 与该 preview 相同并已正常加载。共享 UI、ZCode 四参数自动/手动网页链接、Codex 原生账号终端的上一阶段实证继续有效，详见上节。
- [x] 首次最终远程测试 `fd6e9167-9c46-4523-aafe-d8a60d3f041b` 因 C 盘空间耗尽失败，原始失败报告保留。仅清理本任务 owner 标识且进程已退出的构建依赖缓存后重试通过；最终 run 又清理约 0.82 GB 可重建依赖，887 个源码/产物/证据文件前后哈希一致，保留 2c16676d 备份依赖。未清理用户数据或 Hermes 安装，收尾磁盘空闲约 7.02 GB。
- [x] Windows 已无调试参数正常启动；Windows/Mac 19487 监听均为 0，账号 ready scope、临时 UI 计划任务、活动 Worker 均为 0，三条历史 Worker 记录保留。证据：私有 `.test-data/windows-remote/desktop-audit/hermes-final-{live-menu,install-result,cleanup}.json`、`windows-electron-final-hermes-ae2dbcd8-*`、`final-run-dependency-cleanup.json`，不入 Git。
- 边界仍保留：ZCode 仅证实网页登录正常，未完成授权；Hermes 原生安装和登录终端可用，尚未配置账号；Claude 按用户要求跳过官方账号/真实调用，Kimi 同源额度仍不可核验。OpenSpec 3.1/3.3 继续未勾选，不通过归档掩盖缺口。阶段提交，不推送。


### Windows 模型目录、首次检测和加载优化（2026-10-11）

- [x] 修复 Pi/OMP Windows 目录 fchmod EPERM。实际 Windows Desktop 读取 OMP 11 个模型、Pi 2 个模型；界面下拉分别按模型显示原生强度（Pi GLM-5.3 为 Low/High/Max）。OMP 重新打开设置实测从“正在读取登录信息”约 1.376 秒进入已识别状态，没有误报未安装；原始首次误报本轮基线未复现，不能据此声称确定了所有首次检测失败原因。
- [x] Codex Windows 原生 app-server 返回 6 个受支持模型及强度，远端额度响应 allowed=false/limit_reached=true。实际界面改为“Codex 当前账号额度已用尽，请等待额度恢复后刷新”；没有伪造可用模型，也没有消耗模型额度。
- [x] OpenCode 两条原生启动路径显式隐藏额外控制台。实际 45.084 秒窗口观察覆盖模型读取、刷新、登录启动，新增可见控制台为 0；嵌入式原生 Add credential 菜单显示正常，方向键选项移动成功，关闭后账号终端退出。基线 45 秒也未复现用户描述的窗口，参数回归和修复后观察不能证明所有短暂闪窗已被捕获。
- [x] 设置页账号检测以当前项优先、最多两个请求并发，取消/重新启用/过时结果回归通过；Kimi/Claude 能力复用与账号/入口/配置变化、失败、取消安全边界回归通过。Antigravity 同一目录查询减少一次 Windows 身份读取；当前实测 6.394/6.147 秒、均为 7 个模型，旧观察 10.847/11.707 秒仅作参考，网络及系统负载不同，不据此计算固定加速比例。
- [x] MiMo 保留既有有界能力复用，当前同一账号连续读取实测 10.311 秒→0.262 秒，均为 2 个原生模型。旧包已可 6.572 秒→0.277 秒热读，因此这不是本轮新增的冷启动加速；本轮没有改变原生串行初始化，也不承诺全部 CLI 首次秒开。
- [x] 追加成功目录回收：旧 OMP 每次成功查询留下约 121 MB 临时目录。最终包实机连续 OMP→Pi→OMP→OpenCode 返回 11/2/11/5 个模型，耗时 7.591/1.567/5.748/2.784 秒；查询前后对应目录完整名称集合和计数一致（15/8/11），新成功查询均已移除，旧失败现场保留。
- [x] 自动验证分阶段保留：主要修复本地 1696 passed/8 skipped；Windows 实际 Electron 20 文件 366 passed/1 POSIX-only skipped/0 failed，Host 加载和两端类型通过。随后目录回收补丁定向 5 文件 90/90；最终本地完整 89 文件、1702 passed/8 skipped/0 failed，类型、preview、正式构建和严格规格 11/11 通过。Windows 366 项属于追加回收前的包，最终追加补丁使用前述真实目录与回收验收，未虚称重跑全部 Windows 单测。
- [x] 本地默认沙箱完整测试因 detached-child fixture 进程控制限制挂起；按本次 PID/创建身份结束两个测试进程组后，允许进程控制的环境完整重跑通过。Windows 一次合成 OMP worker SQLite 路径达 271 字符，缩短隔离 TEMP 后同测试 6/6 及 20 文件回归通过，未更改生产数据库路径来伪造通过。
- [x] 最终 preview 包 SHA-256 `d88f9a0d88c11ec905c062ffc205a47e324e864215930e952e122b0d7c02bd8b`，无活动 Worker/账号终端时使用 Windows 原生安装器更新，326 个 lib 文件逐项匹配。Mac 正式构建 Host SHA-256 `1d7db6ac0836fe95247ced4bb762f7dd09302a876d8cfcd87b19eeb3698cf685` 与 preview/Windows 一致；Client 仅构建路径注释及 source map 有差异，执行代码相同。Mac 共享设置实际渲染 Pi GLM-5.3 的 Low/High/Max 下拉正常。
- 环境干扰已核查：一次 OMP 重读失败时 C 盘空闲为 0。此前远程验收的 agy models PowerShell 孤儿进程占约 55 GB 私有内存；核实确属本任务脚本后结束，确认退出，分页文件自动缩小，空间恢复约 26 GB。同一个未更改的插件包随后 OMP→Pi→OMP 全部成功。仅清理本任务可重建依赖/native 缓存，保留报告和哈希；未清理用户数据、账号、安装或修改分页设置。不能把这一环境故障当作账号问题或本次代码回归。
- 证据保存在 Git 忽略的 `.test-data/windows-remote/desktop-audit/`：`models-windows-accepted-report.json`、`models-cleanup-local-full-approved.json`、`models-after-*.json`、`omp-after-first-detection-ui.json`、`opencode-console-after.json`、`opencode-after-terminal-ui.json`、`models-final-live-repeat.json`、`models-query-cleanup-verified.json`、`models-cleanup-install-result.json` 和下拉画面。仅记录安全模型能力、计数、耗时及状态，不保存授权码或令牌。
- 边界：本轮真实模型调用为 0；Kimi 当前凭据已过期，未验证正向账号热读；Claude 官方账号/额度按用户要求跳过，历史 OpenSpec 3.1/3.3 保留未勾选，不归档。ZCode 继续官方默认流程。此阶段本地提交、不推送。
- [x] 收尾：Windows 已无调试参数正常启动，Windows/Mac 19487 监听为 0；账号 ready scope、临时 UI 任务及任务归属 PowerShell 为 0；3 条历史 Worker 为 interrupted/completed/completed，活动为 0。Mac 最终正式包已正常加载，当前无登录终端。清理结果见 `models-final-cleanup.json`。


## 2026-10-11 ZCode 国内/海外授权选择与后台终端窗口复核

- [x] 按最新要求增加 Mac/Windows 共用的“中国智谱 BigModel / 海外 Z.AI”原生登录选择。选择前不创建终端，关闭后重置；Host 单独验证 ZCode/login/provider，旧 Host 明确提示更新，不回落到另一来源。既有原生账号、项目偏好及凭据未迁移。
- [x] Windows Desktop 附带的 0.16.9 仅声明 Z.AI；官方完整 CLI 同版本号支持 `login [zai|bigmodel]`，不能只看版本判断。部署官方完整源树 `29628c9acdb81b703bbd4080c207a0e7ce5e276e` 和对应 Windows x64 原生依赖到插件 managed runtime，3,872 个文件哈希核验通过。完整运行时 ZIP SHA-256 `28930bcb9fcc6689ed28a78f488974d63f60eb286582e5c71e8101aab3e94be4`；没有覆盖 ZCode Desktop。
- [x] 实际 Windows 两选项分别打开 `bigmodel.cn/login` 和 `chat.z.ai/api/oauth/authorize`（原生跳转 `/auth`），原始参数完整，URL 不写入报告或 Git。中国授权等待用户交互期间原生 CLI 先退出，未获授权完成确认，未判断具体退出原因；海外入口核验后主动关闭。两者均不计作账号授权成功或模型执行通过。Mac 实际共享选择界面和选择前取消已验证，原账号保留。
- [x] 插件普通后台进程统一 GUI bootstrap + `windowsHide` + 独立 stdio 管道，修复只隐藏包装进程、继承数字 fd 导致缺少 CREATE_NO_WINDOW 的路径。独立原生退出回执与 SDK Job 的范围退出分离，真实 CLI 退出后仍持有输出的后代必须确认清理。未修改 Harness 核心、ConPTY 技术栈或用户默认终端设置。
- [x] 最终源码完整测试 90 文件通过、1 文件跳过，1,788 passed / 8 skipped；Host/Client typecheck、preview 与严格规格 11/11 通过。Windows 实际 Electron 44/SDK Job 合成验收 9/9：参数及环境保留、二进制 stdin、分离输出/非零退出、收集输出、每路 2 MiB 背压/EOF、提前退出关闭输入、ENOENT、停止/取消 detached 后代，以及经 private launcher 的自然退出但后代仍持有管道；无 Job 降级，所有范围退出、无残留 fixture PID。合成测试不冒充真实模型调用。
- [x] 无活动任务时经 Windows 原生插件安装器更新最终 preview 包，334 个 lib 文件逐项匹配，包 SHA-256 `ec0657cc5c1b61d42b3437440dfcda1f13ebd8088f7bc707a06f0befeed69817`，Host SHA-256 `96b9150e58639a1da318ee4597a615376a20b11824ad45edee9a2189341d419f`。早期验收清单误含构建缓存 tsbuildinfo 时校验拒绝；后续清单对实际打包内容重建并通过，保留失败记录。
- 窗口观测保留方法边界：最早 PowerShell 观察器启动可能引入自身窗口；改为 GUI 子系统、CreateNoWindow 启动。v3 的 PID 单值父链会受编号重用影响，不能用于归属；其全局窗口 SHOW 事件仍有效，其中一轮 150 秒观察有一次未解释的可见 Windows Terminal。v5 改为进程创建/退出时间和 PID 实例关联，保留全量进程名与时间，不记录命令行/原始窗口标题。最终结果及边界见后续追加。
- 本轮真实模型调用为 0。实际目录刷新中 Codex、MiMo、OMP、Pi、OpenCode、Antigravity 模型及强度控件可用；Claude 无官方账号/额度、Kimi/Hermes 账号过期、Grok 未配置、ZCode 授权未完成的边界如实保留。历史 OpenSpec 3.1/3.3 不勾选，不归档。
- Mac 已验证本轮 ZCode 共享 UI，但最终 Windows pipe 补丁的根目录正式构建尚未更新：Mac 锁屏，无法通过应用菜单正常退出 Harness，已请求解锁；未在宿主运行期间覆盖链接包。此项不计为两平台最终安装完成。
- 私有证据位于 `.test-data/windows-remote/desktop-audit/`：`zcode-console-acceptance.json`、`zcode-provider-ui-evidence.json`、`windows-hidden-process-pipes-result.json`、`zcode-console-pipes-tests.log`、`zcode-console-pipes-typecheck.log`、`zcode-console-pipes-spec.log`、最终包与逐文件清单、v3/v5 窗口和动作时间报告。
- 最终 v5 实机观测：已运行实例重开设置并刷新全部 11 个 CLI，120.906 秒窗口事件为 0；再次正常重启后首次打开设置、全部 11 个 CLI 刷新、OpenCode 原生 Add credential 登录菜单和关闭，141.629 秒窗口事件为 0，hook 均确认结束。两轮动作 UTC 与报告对应；这两次通过不抹去前述 v3 未归属事件，不宣称所有系统状态下绝无闪窗。
- [x] 收尾：Windows 正常无调试参数启动，两端 19487 监听为 0；账号 ready scope、观察器/临时 UI 计划任务、本轮 PowerShell 和 GUI launcher 均为 0，3 条既有 Worker 状态仍为 interrupted/completed/completed，活动 Worker 为 0。清理证据为 `zcode-final-cleanup.json`；阶段提交仅包含本轮代码/规格/新增记录，不包括用户原有图标及文档改动，不推送。


### ZCode BigModel 授权与两平台最终构建收尾（2026-10-11）

- [x] 用户确认已完成 BigModel 网页授权后，对 Windows 生产安装插件做只读核验：状态为 authenticated / oauth / local，当前来源与终端保存来源均为 bigmodel，原生 BigModel 绑定存在；读取前后凭据摘要未变化。由此确认授权已落盘且插件能够识别，不推断远端额度或真实任务成功。Z.AI 仍只有原生入口及网页跳转验证，本次没有退出账号、重新登录或模型调用。
- [x] 用户确认早期窗口观察期间手动打开过终端或运行命令。此前 v3 有效 SHOW 事件保留为“人工操作干扰期内、来源未证实”，不强行归属用户或插件。最终 v5 热态 120.906 秒、冷态 141.629 秒均无额外控制台事件，动作覆盖设置、全部 11 个 CLI 刷新及 OpenCode 原生登录菜单关闭；以此完成本次已执行路径和观察时段的验收。已定位的插件后台启动路径已修复，不宣称所有第三方 CLI 在所有环境下绝不创建窗口。
- [x] 用户解锁 Mac 后，确认 22 条既有 Worker 均为终态（18 completed、3 failed、1 interrupted），活动数 0；通过原生界面正常退出 Harness 后执行 `pnpm --config.verifyDepsBeforeRun=false build`，退出 0，再正常打开 Desktop。正式 Host SHA-256 为 `96b9150e58639a1da318ee4597a615376a20b11824ad45edee9a2189341d419f`，与 Windows 最终验收包一致；三个启动 helper 的 source/lib/preview/types 文件分别一致，Client 除构建路径 region 注释外完全相同。
- [x] Mac 最终实际界面显示 ZCode 已登录、模型与强度控件可用；点击登录后显示中国智谱 BigModel／海外 Z.AI 共用选择界面，选择前未创建账号终端，取消后保留原账号，最后关闭设置。Windows 本次仅只读核验授权，未再次启动调试实例；前一阶段的无调试重启和清理证据继续保留。
- [x] 本次正式构建、实际 UI 与授权核验、差异检查通过；`pnpm --config.verifyDepsBeforeRun=false spec:check` 为 11/11，OpenSpec 本次 9.2/9.4 完成。源码未更改，完整 1788 passed / 8 skipped 与 Windows 合成生命周期 9/9 为前一实现阶段结果，本次没有重复运行或新增模型调用。历史 3.1/3.3 的 Claude 官方账号/额度跳过及 Kimi 验证边界继续保留，change 为 28/30，不归档。
- 私有证据：`zcode-bigmodel-auth-verified-20261011.json`、`zcode-mac-final-build.log`、`zcode-mac-final-equivalence.json`、`zcode-mac-final-ui-verified-20261011.json`、`zcode-console-final-followup-20261011.json`，均在 Git 忽略的 `.test-data/windows-remote/desktop-audit/`。此前授权未确认及 Mac 锁屏是历史时点状态，由本节补齐；原报告保留。仅阶段提交本次验收记录，不混入已有文档/素材改动，不推送。


### Hermes Nous 登录续期修复与双平台验收（2026-10-11）

- [x] 确认共同缺口：插件在 Nous 短期 invoke JWT 到期前 120 秒及到期后拒绝目录/任务，但没有让已保存的原生刷新凭据续期。Windows 当前原生访问令牌寿命为 3,600 秒；诊断时两端访问令牌仍有效，没有伪造过期现场。已有登录之后的陈旧 terminal error marker 不再单独否定仍有凭据的账号。
- [x] Mac/Windows 共用 `hermes-renewal` 与固定原生 Python 入口，状态、目录、任务绑定和直接准备均接入；健康状态无额外子进程。短期令牌允许同账号自动续期，网络/服务暂时异常保留登录并允许刷新重试；明确失效或缺少续期凭据才要求重登。主体、组织、client、路由不猜测，外部账号、guest、登录网页和模型生成均不进入续期路径。
- [x] 续期并发合并，账号操作与最后订阅取消等待有限原生事务落盘和完整范围退出。原生 auth→shared 锁内重核 source/pool；轮换回调先保存，再做后续原生有效性检查。只同步认证字段，保留池 ID、标签、优先级、停用、额度及冷却；同主体较新 shared 可以采用，身份不符及同到期但不同链拒绝。
- [x] 最终 Host/Client typecheck、完整回归 1,847 passed / 8 skipped（93 文件）、`build:preview` 通过。新增合成用例覆盖过期/临近过期、状态集成、稳定任务绑定、并发取消、账号终端互斥、轮换后失败仍保存、共享来源校验、额度冷却、私有入口及实际解析器依赖。初次 Mac 原生验收揭示 PyYAML 缺失，改为官方 `hermes_yaml` 并补无 PyYAML 回归；失败报告保留，最终实机结果见下。
- [x] Mac 已安装 Electron 44 + 宿主 SDK 实测原生续期：2026-10-11 07:05:18–07:05:21 UTC，1,070 ms 返回 ready/exit 0，访问与刷新令牌均真正轮换，剩余有效期 1,433→3,599 秒；主体/任务绑定及池元数据不变，provider/pool/shared 一致。健康状态再次检查 0 子进程；实际目录 11 模型、4 模型支持显式强度、8 种强度，1,236 ms。SDK 有一次 Mac 原生平台既有 containment fallback 提示，正常退出已确认，不冒充 Windows Job 级隔离。
- [x] Windows 已安装 Electron 44 + 真实 SDK Job 在交互会话实测：2026-10-11 07:10:35–07:10:39 UTC，2,085 ms 返回 ready/exit 0，访问与刷新令牌均真正轮换，剩余有效期 487→3,600 秒；主体/任务绑定及池 ID/元数据/数量不变，provider/pool/shared 一致。健康状态 0 子进程；真实目录 11 模型、4 显式强度模型、8 种强度，1,761 ms。仅 1 个受管进程范围，全部退出，SDK 无降级。v5 交互桌面观察覆盖此次动作，90.582 秒 windows=0，hookStopped=true。
- 真实验收使用仅子进程生效的提前续期阈值触发一次官方 refresh；没有修改用户配置、系统时间或伪造真实令牌到期。过期及并发场景由明确合成夹具验证。两端登录调用 0、模型任务 0；目录成功不代表真实生成通过。
- [x] Mac 确认 22 条既有 Worker 的活动数为 0、账号/任务桥进程 0，通过应用菜单正常退出后正式构建再启动。Host SHA-256 `f775fa7d4815c5ca3e00c0481c05f12636494e76561eac1dfa20596ba131d23d` 与 preview 一致；四个关键 helper 的 source/lib/preview/types 一致，Client 仅构建路径 region 注释不同。实际设置显示 Nous 已登录、模型下拉和强度控件可用，刷新后仍正常，未保存更改模型，最后关闭设置。
- [x] Windows 确认活动 Worker/账号终端为 0，正常退出后经原生插件安装器部署最终 preview 包，exit 0，339 个实际打包 lib 文件逐项匹配；包 SHA-256 `aba632b0049ad9eb844acb2a10297478730a93460f1bae59c1f45fcf93d6b3fd`，Host 与 Mac 正式构建相同。正常重启后真实设置显示 Nous 已登录、11 项模型及当前模型 3 项强度，状态刷新正常，最后关闭设置。
- [x] 最终 Windows v5 观察完整覆盖设置打开、Hermes 模型/强度菜单、状态刷新和关闭：动作 07:20:12.626–07:20:52.144 UTC，观察 07:19:46.938–07:21:17.641 UTC，共 90.703 秒，新增控制台窗口事件 0，hookStopped=true。此前一次观察漏掉最后 2.49 秒，不作为完整覆盖证据；重新执行后的本轮报告为最终依据，不宣称未执行路径永远无窗口。
- [x] Windows 正常无调试参数运行；活动 Worker、ready 账号 scope、账号 owner、原生 Hermes/auth、观察器任务/launcher、UI/验收临时任务均为 0。Mac 设置已关闭，活动 Worker/账号桥进程为 0；本轮 Mac 未打开调试通道，Windows 使用原生 UI Automation，未开 CDP。未清空历史 Worker、账号或不相关配置。
- [x] 实现已阶段提交 `d342fc2`；本轮验收记录单独提交，保留用户原有文档/素材改动，不推送。严格规格 11/11；Hermes 10.1–10.4 完成，活动 change 为 32/34。历史 3.1/3.3 的 Claude 官方账号/额度跳过与 Kimi 验证边界不变，不归档整个 change。
- 私有证据均在 Git 忽略的 `.test-data/windows-remote/desktop-audit/`：`hermes-renewal-full-tests-v2.json`、`hermes-renewal-typecheck.log`、`hermes-renewal-preview-build-v2.log`、`hermes-renewal-mac-parser-actual.json`、`hermes-renewal-mac-formal-equivalence.json`、`hermes-renewal-mac-ui.json`、`hermes-renewal-mac-preflight.json`、`hermes-renewal-windows-parser-native-preview-20261011.json`、`hermes-windows-final-delivery-20261011.json`、`hermes-renewal-windows-final-install-20261011.json`、`hermes-final-complete-ui-actions-20261011.json`、`hermes-final-complete-ui-v5-20261011.json`、`hermes-windows-final-normal-startup-20261011.json`、`hermes-windows-final-cleanup-20261011.json`。账号秘密不写入报告或 Git。


## 2026-10-11：小红书 v0.6.5 → v0.7.7 更新日志素材

- 完成 1 张独立封面及 7 张内容页，统一 1200×1600（3:4），沿用既有米白纸感、黑字、黄色强调与宽松截图留白。目录 `doc/assets/xhs/2026-10-11-update-065-to-077/`（2026-10-20 移至本机 `promotion/xiaohongshu/`，不进 Git）。
- 按用户最新要求全部在 Mac 的 Harness 实装插件拍摄：公开演示总览与右键菜单、已有问候子对话、ZCode 状态/授权来源、OMP 原生登录菜单、Hermes Nous 设置。账号标识已用不透明实色遮盖，私人会话列表与无关内容裁去；原始截图只在忽略目录，不入交付 ZIP。未新派遣模型任务，未提交账号凭据，拍摄后关闭终端与设置。
- 对照 v0.6.5 标签、当前源码、公开 Release 和实际验收记录，内容聚焦 Windows、右键管理/回收站、聊天交互、选型复用、账号/终端/加载修复及 npm 短命令。未将旧角色/命名/侧栏能力写成新增，未声称全部 11 CLI 已实机生成。
- 用户要求按 v0.7.7 上架后口吻制作。提供 17 字标题、876 字符正文及标签、固定 0.7.7 安装命令和内部发布提醒；本轮不执行发版或推送。
- 浏览器逐页渲染核对加载、无横向溢出、内容与页脚间距；目视检查账号遮挡及安装字符。`sips` 核验 8 图均 1200×1600，ZIP 完整性检查通过（8 JPG + TXT/MD 文案，10 文件）。没有重跑运行时测试或重新验收 Windows；仅生成推广素材，不改产品行为。

## 2026-10-11：v0.7.7 发布前最终验收

- [x] 版本清单与中英文固定 npm 安装示例统一为 `0.7.7`；个人 Windows 详细复用手册保存在 `/doc/local/`，`.gitignore` 验证生效，Git 索引和公共包均不含个人手册、连接配置或运行日志。
- [x] 发布 CI 定位新版 Windows 伪控制台 HWND 归属差异，修复实际 conhost 身份解析。保留全部父进程、创建身份、系统映像和 Job 范围退出门禁，没有跳过失败用例。
- [x] 最终源码 `pnpm typecheck`、`pnpm test`、`pnpm build:preview`、`pnpm spec:check` 通过（命令均使用 `--config.verifyDepsBeforeRun=false`）。完整回归 1847 passed / 8 skipped，严格规格 11/11；Mac 跳过的平台专属用例由 Windows 单独执行。
- [x] [Windows CI 38123998760](https://github.com/SuperWheel/cliworker-now/actions/runs/38123998760) 在系统 build 26100 全流程通过：107 passed / 1 skipped，含真实 Host Job 与 ConPTY 停止/自然退出、后代清理和无关进程保留；官方 Codex 0.160.0、Pi 1.0.4、OMP 16.4.4 安装入口/帮助与原生元数据 smoke 通过，零模型调用。
- [x] 实际 Windows 22631 / Electron 44 / Harness SDK 双生命周期合成用例通过，TTY、Unicode/元字符 argv、输入输出、自然退出码7、分离子进程和 conhost 清理均核验。181034ms 交互式观察无额外可见控制台。仅精确分类宿主固定的 ConPTY 提示，未知告警与普通 Job fallback 仍失败。
- [x] 两平台无活动任务后正常退出 Harness，正式构建/原生安装并正常重启；实际界面均确认 v0.7.7、1 个组件运行。Windows 最终安装的 339 个 lib 文件逐项匹配，全部测试、观察器、账号范围与临时任务清理，无调试启动。
- [x] 最终公共包 344 文件，逐项匹配发布暂存，npm dry-run 通过；SHA-256：`fef207b47caab4f853fd2b1c8a04584dce0f99848281728647d4a48591d86559`。Client 可执行文本与前次两平台 UI 验收一致，preview 差异仅构建路径注释/源映射；新增 owner helper 与本次真实验收快照完全相同。
- 以上安装/进程检查不代表所有第三方账号、额度和真实模型生成全部通过。本轮没有新增账号登录、续期或模型调用，既有 Claude/Kimi 等真实账号/额度边界继续保留；活动 OpenSpec 不以发布为由归档。

## 2026-10-11：市场收录申请同步 v0.7.7

- [x] 现场确认原收录 PR [#6795](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6795) 仍为 OPEN、未合并；原提交的 PR check 和 Submission gate 曾通过。因此直接更新原分支，保留申请与审核历史。
- [x] 更新 `data/plugins/SuperWheel__cliworker-now.yml`：预构建包从固定 v0.6.5 链接改为 v0.7.7；中英文简介同步 macOS / Windows。更新提交 `ac1a1145573a3592f3b965a781a60f7dac34aa4e` 仅修改该文件的 3 行；PR 对上游仍仅新增自己的一个条目。标题和说明同步为当前版本，没有手改生成的 README 或其他插件。
- [x] 只读核验 GitHub/npm 公开 v0.7.7 安装包：字节一致，SHA-256 均为 `fef207b47caab4f853fd2b1c8a04584dce0f99848281728647d4a48591d86559`；校验文件、npm integrity、仓库关联、manifest、Cordis patch、编译入口及 344 文件清单通过。npm 映射由目录自动采集，不添加无效的 `npm` 字段。
- [x] 在当前精选列表的独立副本运行 `validateEntries`（4490 条）、`node scripts/generate-readme.mjs`、`git diff --check` 和 `SKIP_PUBLISH_CHECKS=1 node scripts/build-site.mjs`，中英文生成及官网本地构建通过；构建使用 CommandLineTools Git。未部署精选列表官网。
- [ ] 当前新提交的自动检查及维护者审核/合并：本次快照为 PR check IN_PROGRESS，仍未正式收录；原提交的绿灯不作为新提交已通过的证据。
- 本轮为目录元数据及发布记录更新，没有改动插件运行时、重新打包/安装插件或调用模型。公开发布报告中的回归及两平台验收未重跑。可复核证据保存于忽略目录 `.test-data/market-submission-6795/v0.7.7/`；源插件仓库只记录本地提交，不推送。

## 2026-10-11：小红书更新配图按用户标注修订

- [x] 平台、右键菜单、聊天、终端、优化与安装六页按标注修改；登录页同步补全表达。说明直接写明操作及结果，去掉重复快捷键与 ZCode 说明、抽象术语；优化页四点编号分布，安装单列终端、添加插件与 AI 协助三种方式。
- [x] 七张内容页使用既有 macOS 实拍与已遮盖账号的安全素材重新渲染；封面保留。DOM 检查无文字横向溢出，内容距页脚至少 40px；八张 JPG 均为 1200×1600。
- [x] 推文正文与标签 998 字；用户已打开的解压目录与 ZIP 同步，逐文件字节一致，ZIP 的 10 个条目校验完整且不含原始截图。
- 本轮仅修改营销文案和排版，未新增截图、模型调用、账号操作或插件运行时改动，没有重跑产品测试或执行公开发布。

## 2026-10-11：小红书配图裁切、居中与安装提示词修订

- [x] 01/02/03/04清理宿主竖分隔线；05/06清理弹窗背景界面碎片，保持完整弹窗、正常内部线条和账号遮盖。04三列快捷键等宽居中，图标与说明中心轴偏差小于0.01px；安装提示词改为“帮我安装最新版插件”。
- [x] 七张受影响图片重新渲染，八张JPG尺寸均为1200×1600；无文字横向溢出，页脚间隔至少36px。已有解压目录（含用户当前“发布包 2”）逐图片字节同步；ZIP10条目CRC与图片内容校验通过。正文除匹配的安装提示词外保留当前内容。
- 本轮仅营销排版修订，无新增截图、模型调用、账号操作、产品测试或公开发布。

## 2026-10-11：X推荐推文与真实功能截图

- [x] 只读核查Conductor、Claude Code子智能体与Agent Swarm三条原帖的官方公开嵌入赞数，分别为3583/1659/117（缓存值，非实时排名）；参考简短用途说明和真实演示的结构，撰写原创中文主帖及可选回复。主帖按twitter-text v3规则核算为272/280。
- [x] 在macOS Desktop实拍任务总览、已有Codex问候独立对话、角色预设和OMP独立设置四张图；只裁切与添加48px留白，私人列表、主对话个人背景和页面外账号信息均不进入最终图片。截图保持原生UI比例，尺寸与ZIP逐文件内容校验通过。
- [x] 关闭设置后恢复原来的Antigravity展开和主对话底部位置；发布包只有四张正式截图、主帖、可选回复和说明。本轮无新增模型任务、账号登录/退出、角色/配置保存、测试重跑或公开发布。

## 2026-10-11：AGY扩写X连续推文与整窗截图

- [x] 按用户明确调用cliworker-agy，通过包装脚本默认sandbox在公开资料独立目录派遣。agy1.3.3，脚本退出0、SUCCESS；两份约定草稿存在，四个输入文件哈希未改，仅增加约定文件。保留原工作树改动。
- [x] 用户确认普通X账号，最终八条连续推文按twitter-text v3核算为258/277/273/268/272/263/255/271，含序号与尾随换行均不超过280。浏览器读完用户指定Fei2411主帖及串帖；独立核对功能和按名字续聊的主会话范围。
- [x] 重拍四张macOS Harness完整2560×1640原始JPEG，多CLI列表、独立聊天、角色预设、OMP设置。无裁切/缩放/重绘，私人会话目录收起，画面未含个人账号或凭据；采集与交付逐字节匹配，JPEG签名/尺寸/ZIP15条目完整性检查通过。关闭弹窗后恢复会话目录、列表展开和主对话底部位置。
- 文案派遣消耗Antigravity配额。本轮没有新增产品模型演示、账号操作、配置保存、产品测试重跑或发帖。私有AGY状态与采集备份留在忽略目录。

## 2026-10-12：v0.7.8 开发调整，Claude Code 与 CC Switch

- [x] 修复 Claude 自身路由被继承环境误判、Fable 原生字段被拒绝、`[1m]` 模型筛选及官方登录入口被路由前置检查阻塞的问题。状态与任务使用同一私有来源快照，mapping/top-level model 纳入账号绑定；managed 来源与目录重定向继续拒绝。用户 Claude/CC Switch settings、原生账号和历史不被插件改写。
- [x] 自定义网关未实现 `/models`（404/405）时，仅开放该路由明确配置模型，费用未知且说明远端可用性未核验；401/403、网络/无效响应、取消不回退。官方 API 与其他 CLI 不开放此配置例外。
- [x] 用户指定当前开发版本为 v0.7.8；已同步 package.json、AGENTS.md、OpenSpec 配置和中英文说明。只有用户批准后才增加后续版本号或上传 GitHub；日常仅关联最小验收，全量验收用于获准的版本发布。公开安装示例保留已发布 v0.7.7。
- [x] Mac 最小回归：`pnpm --config.verifyDepsBeforeRun=false exec vitest run tests/claude-own-route.test.ts` 为 39 passed；六文件 `accounts.test.ts / cli-account-binding.test.ts / first-party-models.test.ts / claude-native-oauth.test.ts / runtime-account-isolation.test.ts / account-models.test.ts` 使用 `-t 'Claude|claude|declared models|custom model declaration|failed 200|metadata requests'` 为 91 passed、187 项被标题过滤排除。共 130 个相关用例；没有跑全量测试。
- [x] Host/Client `typecheck`、隔离 `build:preview`、严格 `spec:check`（归档前 12/12）、`git diff --check` 通过。格式检查不作为真实模型验收。
- [x] Mac 原生只读检查：官方状态正常返回未登录、`auth login --help` 支持 `--claudeai`；当前自身路由状态正常，模型目录 GET 200，13 个目录选项含 3 个配置模型。原 settings 哈希保持不变，私有临时文件清理确认。未启动登录、退出或模型生成。
- [x] Mac 确认无活动 Worker/账号桥进程，正常退出 Harness 后正式 build 更新原本链接；正常重启，实际插件页显示 v0.7.8、共 1 个组件且运行中。正式 Host 可执行文本与 preview 相同（排除构建路径 region 注释）；本地包 344 文件，不含私有数据。
- [x] Windows 按原远程手册恢复连接：用户提供重启后 IPv4，新目标通过已固定旧公钥严格校验，仅增添同公钥的新地址别名及更新私有 config.host，原记录/其余字段保留，私有文件 0600。通用重连规则写入 `doc/windows-remote-testing.md`；机器地址和账户材料不入 Git。
- [x] Windows 原生 Claude 2.1.296 合成最小检查：自身 API settings 状态 exit 0，官方 overlay 状态 exit 1/未登录，官方登录帮助 exit 0 且支持 `--claudeai`；无实际账号读取、授权、模型调用，合成目录清理确认。
- [x] Windows 对应最小回归 39 + 91 = 130 passed、0 failed；187 项仅为标题过滤排除，选中用例无跳过。测试源码快照和两份原始 JSON 哈希核对，冻结依赖恢复后仅执行两组上述用例。本次合成账号、依赖、缓存及测试进程均清理确认。
- [x] Windows 安装前无活动 Worker/账号终端且 Harness 已退出；原生安装器 exit 0，本地 v0.7.8 的 339 个 lib 文件及 Host/包哈希与 Mac 构建完全一致。正常启动后 5 个 Harness 进程、调试参数 0；本次原生 Claude、账号授权、测试 run、UI 任务/观察器进程均为 0。不追加 UI 全量验收。
- 私有证据：`.test-data/claude-078/mac-minimal.json`、`mac-install.json`、`package.json`、`windows/native-probe-report.json`、`windows/minimal-report.json`、`windows/claude-own-route.json`、`windows/claude-related.json`、`windows/install-report.json`、`windows/delivery-summary.json`。本地开发包 `.test-data/claude-078/dsh-cliworker-now-0.7.8.tgz`，SHA-256 `0a6391816d4030435645b7531a5980f53619768422e3071928c2674cd497f953`。不提交凭据、私人远程配置、运行报告或用户既有素材改动；未推送、未发布 GitHub/npm。
- [x] 本次 OpenSpec 8/8 任务按最小证据核对完成，同步三项主规格后归档至 `openspec/archives/fix-claude-cc-switch-routing/`；归档后严格校验 11/11，原 Windows/MiMo 活动变更仍保留 34/36 的真实账号验收边界。实现本地提交 `45f95c1`，无远程推送。


## 2026-10-12：v0.7.8 Windows 桌面发现与本机 CLI 路径管理

- 复用 OpenSpec `discover-windows-desktop-clis`：Windows ZCode/OpenCode 读取默认位置、安装登记、已运行产品位置和有界快捷方式线索；DisplayIcon 是注册表元数据，桌面无图标仍可发现。自定义中文/空格/非系统盘路径核验实际 CLI 及配套文件；多安装拒绝猜选，GUI 不冒充 CLI。
- 全部 11 个 CLI 首次解析保存本机路径；手动指定优先于部署配置和自动记录。自动文件消失重新发现，手动错误保留并显示配置问题。Host Gateway 的路径、账号、模型和任务共用解析器，revision 防止迟到探测覆盖新选择；活动任务/账号终端时拒绝修改。
- 每个 CLI 页独立的同级“高级设置”默认折叠，展开后显示“CLI 路径管理”、预填/输入、刷新、恢复自动识别；不置于“项目默认设置”内部。应用后清除旧账号/模型显示并刷新，路径按机器及平台保存、跨项目共用。
- 关联自动检查：Windows 发现 helper 94 项、resolver 24 项通过；路径 store 45 项、resolver/Host API 30 项通过（最终三文件合跑 99/99）；settings-dialog 150/150 通过。账号状态专项 `-t 'missing manual path|Windows desktop discovery'` 为 3 通过、76 标题过滤。仅使用相关测试，未运行全量套件。
- 第一阶段 Windows 原生发现 16/16：真实安装查询、ZCode/OpenCode 实际文件核验、无 shortcut 的 registry/default 独立来源、中文空格合成自定义目录/真实 .lnk、歧义、GUI 拒绝、取消及所属进程退出；fixture 与 shortcut 已清理。运行中进程位置只做了合成解析覆盖（实机两款桌面均未运行，未主动启动）。私有证据 `.test-data/desktop-cli-078/native-report.json`、`run-707518dc-281d-4aee-b8fa-6f7791d332d1/`。
- 第一阶段 v0.7.8 本地包已在 Mac/Windows 核对安装；后续路径管理新增功能的最终包与界面验收记录另列如下，避免把前一阶段包误作最终交付。
- 边界：安装发现、文件可读、模拟状态和设置界面通过不等于真实账号授权或模型生成；此次未调用模型、未登录/退出真实账号。无 metadata、PATH、已知目录和运行中产品线索的任意便携目录仍需手动输入。未升版本、未推送 GitHub、未发布 npm；保留其他活动变更的真实账号/模型未验收事项。
- 第二阶段 Windows 原生 Node/文件系统路径管理 14/14：真实 store/resolver/Host API，禁止 spawn 的模拟 backend；覆盖自动保存重载、失效重找、中文空格手动路径、无效手动保留、reset/revision/迟到拒绝、API 忙碌门禁和清理阻塞。报告 `.test-data/desktop-cli-078/path-management-native-report.json`；远程 fixture 已清理。
- 最终 Host/Client 类型检查与 `build:preview` 通过，新增 Gateway 契约由原生生成器生成。Mac 更新前 22 条历史 worker、0 活动/排队任务、0 账号桥进程；正常退出后 `pnpm build` 更新现有链接并正常重启。实际 UI 已核对同级独立高级标题、默认折叠、Antigravity 与 ZCode 展开自动预填、Antigravity 路径刷新成功、切换 CLI 恢复折叠，以及右栏滚动后输入/按钮完整可用；未修改项目模型/强度。
- 最终本地包 `path-management-078-final.tgz` 为 v0.7.8，SHA-256 `29bcc4ce7eb8ac6780d59260c787a700d409132f2228bc82e2e32455ab278739`；Host `6687fe257d20fb6afe1dac9811541598bb711bf02fede56ea0551d762121991c`。Windows 原生安装 348/348 库文件哈希一致；Mac Host 相同，346/348 字节一致，两个 Client 差异经规范化核实仅为依赖路径注释及 source-map 路径。证据 `path-package.json`、`path-mac-install.json` 及 Windows `path-*` 私有报告。
- Windows 最终实际 UI：ZCode 高级设置初始 Collapsed，路径输入与管理标题未挂载；展开自动预填实际 managed CLI 文件、来源自动识别，刷新一次返回“CLI 路径已刷新”，路径保持，随后关闭设置。证据 `path-windows-ui-zcode-collapsed.json`、`path-windows-ui-zcode-expanded.json` 及本轮刷新/清理报告；未进行真实登录或模型任务。
- 已核对 11/11 任务、同步 7 项新增需求并归档 OpenSpec 为 `2026-10-12-discover-windows-desktop-clis`；归档前后严格校验均 12/12 通过，差异检查通过。其他活动变更保留 34/36 的原有未验收边界。


## 2026-10-12：v0.7.8 设置自动保存及截图细化

- `polish-cli-settings-autosave`：删除保存默认值按钮，模型/强度的用户选择自动保存；初始化/刷新不写偏好，连续选择串行保存最新组合，失败可重选重试，关闭/切 CLI/账号变化取消旧请求。
- 高级设置为独立静态 h3 + 右侧箭头按钮，默认折叠并保留 grid/opacity 过渡和 reduced-motion。路径管理改普通标签，与模型/强度一致；删除重复可见 CLI 路径与来源文字，保留输入可访问名称、说明和操作。
- 继续按截图去掉思考强度末行底边，避免与高级分区线重复；模型和强度菜单移除固定 300px，使用按钮实际宽度，保持原生 Menu portal/start 定位，ResizeObserver 随关闭/卸载清理。
- 最小自动检查：最终 `vitest run tests/settings-dialog.test.tsx` 158/158 通过；Client 类型检查、Host/Client typecheck 及最终 `build:preview` 通过；仅 NativeChoice 变更后重跑相关 UI 文件，不重跑 Host 原生发现或全量套件。最终报告 `.test-data/settings-polish-078/settings-final-tests.json`、`preview-final.log`。
- 最终本地包 `settings-polish-078-layout-final.tgz`，v0.7.8，SHA-256 `735d45ba8373262f83513475138d69abc64f201c37fb9f7d4aeeb04f43c21994`；Host 未改，SHA `6687fe257d20fb6afe1dac9811541598bb711bf02fede56ea0551d762121991c`。Mac 更新前 22 历史 worker、0 活动、0 账号桥，正常退出/构建/重启。346/348 库文件与 preview 字节一致，两个 Client 差异仅为依赖路径注释/source-map 路径，规范化对比通过。
- 自动保存 Windows 实机中间包证据：原模型及 Low 原强度分别重选，均显示默认设置已保存；偏好内容哈希保持不变，mtime 分别前进，确认写入。未调用模型、未变更账号。最终样式包的实际检查另记如下。
- Mac 最终实机：模型与强度菜单均目测与各自选择框左右对齐；只剩一条高级分区线。原 GLM-5.3-Flash/Low 分别重选，均出现“默认设置已保存”；8 份偏好内容哈希全部保持，仅对应偏好 mtime 两次依次前进。高级设置初始折叠，点击静态标题不切换，右箭头展开/折叠正常；普通路径标签、说明、输入及两按钮可见，无重复标签/来源。已关闭设置。证据 `.test-data/settings-polish-078/mac-layout-ui-report.json`；未额外检查窗口缩放。
- 用户继续要求统一排版，前述 layout 包及其 UI 证据改记本阶段中间结果；最终交付另以统一参数包为准。新增 `doc/settings-ui-design.md`，将字号/行高/字重、16px 行留白、8px 标题后距、4px 文字组间距、单条边界及反馈规则固定成共同规范，并接入 AGENTS/README。
- 统一排版最终纯 CSS：`build:preview` 与正式 `build` 均通过（含必要编译），不重复运行已通过的 158 项交互回归。最终包 `settings-polish-078-uniform-final.tgz`，v0.7.8，SHA-256 `fe5226b5c8632335e3a8f666b36dd7daa27013061cd24bcc4beed319bde905f8`；Host 不变，348 个 lib 文件，Mac 346 个字节一致、两个 Client 仅构建路径差异。
- Mac 统一排版实机已核对：项目/高级标题到首个文字组的距离一致、标题和标签层级一致、模型/强度及分区均单条分隔线、路径输入和按钮滚动后完整可见、折叠后内容留白一并收起，强度菜单仍与选择框等宽。设置已关闭；8 份偏好文件哈希及 mtime 与前一次自动保存检查后完全一致。证据 `mac-uniform-idle.json`、`mac-uniform-install.json`、`mac-uniform-ui-report.json`。
- Windows 统一排版包原生安装 348/348 文件哈希匹配，正常启动。UIA 测得项目标题与模型标签顶部差 109 屏幕像素，高级标题与路径标签顶部差也为 109；两处标题高度均 44、普通标签高度均 37，初始折叠。证据 `uniform-windows-ui-layout-final.json`；数值为当前缩放后的屏幕物理像素，并非 CSS 参数。
- Windows 统一排版最终 UI：完整路径输入/恢复/刷新可见可操作，高级区展开前与收起后高度均 121 屏幕像素，无额外折叠留白；模型及强度菜单均 480px，与选择框一致。设置已关闭，无新增偏好写入或模型/登录调用。证据 `uniform-windows-ui-layout-final.json`、`uniform-windows-ui-states.json`、`uniform-windows-ui-menus-final.json`。远程通道继续用于用户随后反馈的 OpenCode 识别问题，相关诊断和最终清理单独记录。
- 设置页 OpenSpec 4/4 完成；已同步两项主规格，再归档到 `2026-10-12-polish-cli-settings-autosave`。严格校验归档前 13/13、归档后 12/12。原 Windows/MiMo 活动变更继续保留 34/36 未验收边界；未增版本、未上传 GitHub，未跑全量验收。


## 2026-10-12：v0.7.8 Windows OpenCode 识别回归修复

- 用户补充 v0.7.7 能正常识别；Git 对比确认 `021441b`（0.7.7）无桌面归档 helper，`1b12366`（0.7.8）首次新增。不是用户安装丢失：Windows 普通 Node 已核实 npm 原生 CLI 为 PE subsystem 3，桌面另有可用独立 CLI，无手动/部署覆盖或 `.local/bin` 抢占。
- 真实 Electron 44.0.0 / Node 24.18.1 Host 一次可逆诊断：实际选中 npm `opencode.exe`、explicit=false，却因其旁侧不存在 `resources/app.asar` 抛无 code 的 `Invalid package`。恢复原 bundle 后 SHA-256 与 `6687fe257d20fb6afe1dac9811541598bb711bf02fede56ea0551d762121991c` 一致；没有修改账号/配置。私有证据 `.test-data/opencode-diagnosis-078/actual-host-error.json`、`host-diagnostic-restored.json`；原始路径不入 Git。
- Windows 安装 helper 改为局部懒加载物理 FS：Electron 内置 `original-fs`，普通 Node `node:fs`。不修改全局 noAsar、不吞异常字符串；继续拒绝损坏 PE、目录假文件、权限错误和显式 GUI。
- 最小自动验收：`pnpm test tests/windows-desktop-cli-installation.test.ts tests/windows-cli-resolution.test.ts tests/native-launch.test.ts tests/windows-desktop-cli-electron-fs.test.ts` 144/144 通过，新增 Electron synthetic 专项 11/11（执行时修复已落盘，未声称单测 red；真实 red 来自上述 Host 证据）。`pnpm typecheck`、`pnpm build:preview` 通过；最终 bundle 保留局部 runtime `createRequire(import.meta.url)("original-fs")`。日志在该私有目录 `regression.json`、`typecheck.log`、`preview.log`。
- 修复包 `opencode-electron-078-final.tgz`，v0.7.8；SHA-256 `82134a8f7f870208a8bf90b1a40c92a943f8fa2e8d7a65b9fbe9807d79f77613`，Host `d893e4e321217c2d9a38c51af075fb91698e7a7b7af34508d232472983bf103a`。没有全量验收、登录或模型生成，未升号、未推送。
- Mac 更新前确认 22 条历史 worker、0 活动、0 账号桥，正常退出后 `pnpm build` 通过并重启。Desktop 链接仍指向本项目、Host hash 与 preview 相同，346/348 库文件字节一致，差异仅限此前已有的两个 Client 构建路径文件。正常重启后 CUA 确认 CLI Worker 面板、三个历史子 Agent 正常显示；本次未打开账号/改偏好或生成，证据 `mac-install.json`、`mac-loaded.json`。
- Windows 正式安装 348/348 库文件 hash 匹配，实际账号区显示 Z.AI API 登录，入口错误消失，原生目录列出 5 个模型（仅展开未选择）。高级设置自动预填原 npm CLI，store 从 revision 2 无 entry 变为 revision 3 / mode:auto；关闭重开后路径、revision、文件 hash/mtime 均不变。两个模型偏好 hash/mtime 全部未改，无登录/模型生成。证据 `windows-delivery-summary.json`、`fix-store-first.json`、`fix-store-reopened.json` 及 settings 私有目录的 `opencode-fix-ui-*`。
- 本轮诊断清单 99 文件及额外运输脚本、25 个 UI 任务已清理；正常 Desktop 进程 5、debug 0、活动任务 0。当前安装依赖引用的新 tgz 保留；更新过程发现 pnpm 会重读旧本地 tgz，已从同 hash 副本恢复旧源后成功更新，清理不再删除当前依赖引用的包。Mac 失败的独立探针未产生 fs 结果，不作为验收证据，生成 app/链接已清理。用户随后反馈设置操作弹终端窗口，另立后续调查，不将入口识别通过描述为窗口行为已验收。
- OpenSpec 6/6 完成，已归档为 `2026-10-13-fix-electron-windows-opencode-detection` 并同步物理安装识别主规格；严格校验归档前 13/13、归档后 12/12。既有 Windows/MiMo 变更保留 34/36 未验证边界。


## 2026-10-13：v0.7.8 Windows 设置后台终端弹窗修复

- 调用链核对：首次设置并发查询全部启用 CLI 账号；模型／强度自动保存重新读取账号绑定和原生目录。后台路径均使用 nativeProcessBackend，SDK PATH 查询本身不创建进程。自有 native/PowerShell/Python/Bun 启动均已有隐藏边界；Pi/Hermes 的第三方内部派生不以静态审查当作已实测。
- 实机旧包：冷首开捕获 Codex 和 AGY 关联标题的 CASCADIA 窗口；第二次可逆 Host 安全日志完整观察 120.9 秒，仅复现 Codex。Codex npm 0.162.1 脚本内部继承句柄派生 exe、没有 windowsHide；实际父链为 Host→SDK Electron→脚本 Electron→平台包 codex.exe→conhost，并与 Windows Terminal 窗口对齐。Antigravity 原生 `models` 与账号 PowerShell 均 relay=true，后续完整观察未复现其窗口；首次 AGY 标题事件无法唯一归因，仍保留线索，未编造根因。证据 `.test-data/settings-console-078/{cold-observer,effort-observer,spawn-diag-observer,spawn-log-final,codex-live-process,agy-live-process}.json`。
- 可逆诊断只保存固定操作分类、时间和程序路径，不记录完整 argv、环境或凭据。已恢复旧正式 Host SHA-256 `d893e4e321217c2d9a38c51af075fb91698e7a7b7af34508d232472983bf103a`，正常退出／重启，无调试参数；观察工具使用 GUI launcher，与产品进程分开归属。旧用户 Codex Desktop 进程未被误作插件子进程或清理对象。
- 修复范围：已核验 Codex wrapper 指纹后台转同安装原生 exe，保留原 argv、包管理器环境与 SDK Job／退出回执，未知脚本保持既有行为；不修改已记忆路径、账号终端或 macOS 分支。失败继续短错误，不静默换安装。
- 最小自动验收：模块 29/29、后台集成 10/10、`tests/native-launch.test.ts tests/windows-hidden-process.test.ts tests/native-spawn.test.ts tests/launcher-console.test.ts` 42/42，共 81 项通过。模块首跑失败为 synthetic 测试删目录未加 recursive，修正夹具后通过，未声称生产修复的 red 单测。`pnpm typecheck`、最终 `pnpm build:preview` 通过，最终 preview 源码 hash 与当前模块一致；没有全量测试或真实生成。
- 隔离包 `settings-console-078-final.tgz` SHA-256 `ebfd9164c8e5e3c55bf09f94a22b62059a6b664616569d40aa25bc18ceff6d54`，Host `3edb7e766078aed65d22f603889963af8108cbd64375ff71eaf4a16196b5140d`，351 个 lib 文件，版本 0.7.8。Mac 只读确认 22 历史 worker、0 活动、0 账号桥；随后 CUA 报 Mac 锁屏，未更新当前 Mac Desktop 链接的正式 lib、未声称本轮 Mac UI 验收，保留先前已安装的 OpenCode 修复包；本次 Windows 专用变更通过 Mac 类型检查、构建和非 Windows 分支回归。
- Codex 修复包安装后 351/351 文件哈希一致；301.384 秒冷开与设置观察中 Codex 不再弹窗，但在 16:29 UTC 冷首次设置后仍捕获 AGY 标题的可见 CASCADIA 窗口。该结果为部分通过，不能把前次 15 分钟内的热读无窗口记成全部修复。冷 AGY 3036→28472→31232 自派生，热查询没有同名后代；证据 `.test-data/settings-console-078/final-observer.json` 与 `final-codex-live-process.json`。
- 针对 AGY 继续核查：官方更新器使用 15 分钟 TTL，禁用值须为 `true`；增加 Windows 后台模型／任务的子进程环境开关，保留显式账号终端。后续验收须确认 updater 日志／冷观察，且不修改用户 updater 时间标记以掩盖问题。
- AGY 根因实证：原生日志 `cli-20261013_002930.log` 第 68 行 `auto_updater.go:334` 在 00:29:32.068622（UTC+8）记录启动后台更新进程 PID 28472，与本轮窗口链一致；00:06 另有同类派生，00:09/15/20/30/31/32 则记录 TTL skip。二进制含官方禁更新变量及 Windows updater 字符串。仅保存固定类别／PID 的脱敏投影 `.test-data/settings-console-078/agy-updater-log-projection.json`，不保存完整用户日志到 Git。
- AGY 最小补充回归：`tests/agy-background-environment.test.ts tests/authorized-catalog-windows-agy.test.ts tests/runtime-account-isolation.test.ts tests/accounts.test.ts -t "AGY background"`，9/9 通过，117 项按名称过滤未执行。覆盖当前／旧目录、任务启动、Windows exact true、macOS/Linux 不注入、MiMo 环境与父环境、显式账号终端和清理；加上先前 81 项，本次累计 90 项定向通过。Host tsc 及最终 `build:preview`（含 Host／Client 类型构建）通过，无全量测试和真实生成。证据 `agy-background-tests.json`、`preview-agy.log`。
- AGY 最终隔离包 `settings-console-078-agy-final.tgz` SHA-256 `15b5ec33741185103a63ed8d3a82c41cbc982742b397ed17747a6f5a3071e651`，Host `08e9b9abbb9eddf2ae9494f62caa4d6c0b19b6be16544446a3be8218eefda3d5`，354 lib 文件，版本仍 0.7.8。
- 最终 Windows 安装 354/354 lib 哈希匹配，正常冷启动后首开 AGY 模型／强度就绪；`00:48:05 auto_updater.go:247` 明确记录环境开关禁用自动更新。updater marker 始终为 `16:29:32.0686222Z`，冷首开已超过 15 分钟，排除 TTL 内热读造成的假阴性；未删除或改写 updater 文件。
- 最终实机窗口验收：`agy-final-observer.json` 覆盖 16:47:53.166–16:51:54.552 UTC（241386 ms），全部新增 Console／CASCADIA／WindowsTerminal 窗口事件为 0，未按父链过滤遗漏系统激活的终端。四次 AGY 查询均无同名自派生，四份日志均明确 updater disabled。AGY 首读就绪，原模型与 Low 同值重选真实触发自动保存并成功（无错误）；刷新在 7 秒快照时仍等待，随后模型菜单可用并完成保存，不把中间快照当作完成。Codex 页面／刷新正常，未创建新的 Codex 偏好；原 AGY／MiMo 偏好内容哈希保持一致。未发起模型生成或登录。
- 其他入口核对：任务初次／恢复／续聊共用普通 launch；账号状态、目录、安装发现和自有 Node/Bun/Python/PowerShell 引导器已有后台隐藏设置。AGY Windows 账号身份只读固定 PowerShell，不启动 AGY；用户显式账号终端保持交互。先前同包 Codex 修复观察覆盖 11 个 CLI 页，未捕获第三种后台窗口；部分 CLI 的认证／目录未就绪仅记录原状态，不宣称所有账号与模型端到端通过。未知 Codex wrapper 版本及第三方任意内部派生未获得普遍窗口保证。
- 收尾核对：Windows 仍为正常 Desktop 启动，正式 Host 哈希匹配最终包、无诊断参数；0 活动 worker、0 账号 owner、0 查询 helper、0 observer task／launcher。只清理本轮登记的临时脚本／诊断任务，保留当前依赖引用的安装包、用户终端及历史数据。完整私有汇总 `.test-data/settings-console-078/windows-delivery-summary.json`；本次增量规格同步、严格校验及归档，本地阶段提交，无 GitHub 推送或版本增加。旧登录／MiMo change 的 34/36 与真实模型缺口保持可见。

## 2026-10-13：v0.7.8 获准发布验收与模型目录修复

- 用户授权调用 GPT-6.1 Sol 执行全量验收及 GitHub、npm、dshmarket 提交。本次保持 v0.7.8；三个 Sol 验收分工分别核对 Mac、Windows 及安装/模型来源，不以子 Agent 自述替代日志和实机结果。
- 隔离 HOME/DSH_HOME 与临时 profile 的真实安装验证：首次无版本名得到当时 latest 0.7.7，但已装 `^0.7.6` 或固定 `0.7.6` 后使用无版本名均保持旧版；`@latest` 能升级并重复执行。双语 README 因此统一使用 `dsh plugin --profile desktop add dsh-cliworker-now@latest`，明确命令触发升级、宿主启动不自动升级。原始输出与版本/lock/config 核对保留于 `.test-data/release-078-sol61/install-command/`。
- Windows Claude：经用户明确授权向当前本机 CC Switch 执行一次只读模型 GET，确认 HTTP 200 且原始数组为空。修复保留原生配置角色模型，标签与执行 ID 分离；只适用于自身 loopback 原始空目录，filtered-empty、远端空目录、401/403/网络失败均有拒绝回归。未执行模型生成、登录或账号切换。
- Codex：确认旧固定目录查询版本漏掉 GPT-6 模型，改从 app-server 握手获取当前 CLI 版本，再按自身账号返回的 ID 和思考强度补充原生陈旧缓存。正式界面检查又发现新加入的 NUX 过滤误删 GPT-6.1-Sol；官方只读元数据显示它可见、支持 API、最低版本满足，NUX 是推荐提示。删除错误过滤并保留明确 deny/hide 规则，重新冻结与全量验收，没有将中间通过结果当作最终结果。
- 新设置缓存覆盖首次识别、重复打开、重启同内容不写、内容变化更新、项目隔离、手动刷新、账号/路径变化、取消及并发、错误不回退、恶意文件/目录链接和有效默认值保留。设置页手动刷新改为独立 Gateway 方法，旧测试夹具同步，229 项关联测试通过。
- 首次 Windows 全量实际出现 132 项失败，已保留失败报告并逐项分解。修复控制管道自然退出、OMP SQLite/请求目录超长路径、Hermes/OpenCode/Pi 文件链接与竞态检查；跨平台夹具使用原生路径与 Windows Python，POSIX mode/SIGTERM 专属断言按平台限定，未用整套跳过掩盖业务失败。7 文件针对性 Windows 复验 173 通过、2 POSIX 跳过。
- 中间 Mac 全量曾有 4 项设置刷新夹具失败和 3 个未处理模拟拒绝；修复后 `final-freeze-2` 为 2190 通过、8 跳过，但真实 UI 检查发现上述 NUX 缺陷，因此最终结论以后续 `final-freeze-3` 与 Windows 最终记录为准。所有中间失败证据保留，不覆盖。
- 最终同一运行时代码：Mac 完整 101 文件，2190 通过、8 平台跳过、0 失败；Windows 完整 101 文件，2179 通过、19 平台跳过、0 失败。最终 3 个跨平台夹具分别核验无 Appx 安装的只读查询、Grok 原生 GROK_AUTH_PATH 以及 Hermes 合成终端提供者；没有新增整套跳过。最终 JSON 位于 `.test-data/release-078-sol61/mac-final-after-platform-fixtures.json` 和 `windows/final-full-tests.json`。
- 隔离 preview、Host/Client 类型检查、Windows 新生成 Gateway 类型检查和 Host import 全通过。139 个源码文件与 preview 一致；最终构建 357 个 lib 文件，Client 仅构建位置 region 注释/映射与 preview 不同，可执行内容相同；源码与两份 account-models helper 的哈希一致。严格 OpenSpec 校验 13/13 通过。
- Mac 正式构建前确认 Harness 已退出、22 个历史 Worker 中活动数为 0、无账号/任务 bridge。真实 Desktop 看见 Codex 7 项含 GPT-6.1-Sol/GPT-6-Astra/GPT-6-Luna，原 GPT-5.6-Luna Low 保留；Claude 自身 API 路由显示 13 项及配置候选边界说明。重复打开与手动刷新同目录不改 inode/mtime，重启后 Antigravity 重识别同值不写，Codex 6→7 项变化更新；8 个偏好文件哈希不变，缓存文件均 0600。设置分隔线、标题、折叠路径区、菜单等宽已实际渲染核验。
- 待发布候选包共 362 个文件，公共清单 `private:false`、无生命周期脚本/开发依赖/私有资料/链接；开发清单仍 `private:true`。tgz SHA-256：`e2eebaebcb0e3cdcd503d070428de668add7288f7eaf8756cb43a8677f4a0f51`。Host：`31914eb59a1439b72e53e2416a8d266ae35516bcd08cf34d413a55b05da1f7aa`；Client：`bb57da4ca8df6416b5c65f08711f9ab9f330ece075932c6d098176b697ad6f5e`。此阶段完成自动检查和 Mac UI；Windows 最终包 UI、远端 CI 与公开分发回下载将在后续记录，不能提前视为完成。

## v0.7.8 发布收尾（2026-10-13）

- 用户已明确批准使用 GPT-6.1 Sol 全量验收，以及 GitHub、npm、dshmarket 提交更新；当前发布版本仍为 v0.7.8，没有增加后续版本号。
- 最终源码提交 `220cd8896be0340eb2b980e8866d034e82e9e424`。Mac 全量 101 个文件、2198 项断言中 2190 通过、8 个平台跳过、0 失败；Windows 2179 通过、19 个平台跳过、0 失败。类型检查、隔离构建及 Windows Host 加载通过。跳过项是平台权限、shebang、文件链接及 POSIX 信号语义等，不计入通过数。
- Mac 正式 Desktop 核验模型/强度菜单、统一样式、默认折叠高级设置、关闭重开、宿主重启及手动刷新：Codex 显示 7 个当前账号模型（含 GPT-6.1-Sol、GPT-6-Astra、GPT-6-Luna），Claude 显示 13 个自身路由候选。目录变化时更新，同内容刷新不重写；8 份项目偏好哈希保持不变，缓存权限为 0600。
- Windows 最终公开候选包经原生安装器安装，357 个 lib 文件逐一匹配，11 个 CLI 设置页中 9 个目录就绪，Kimi 凭据过期和 Grok 账号无法确认保持明确不可选原因。Codex 7 个模型及真实强度、Claude 4 个原生配置 ID、OpenCode/ZCode 路径管理均已实机读回。同宿主重复打开复用目录；首次重新识别期间保留加载状态。
- Windows 最终包全局窗口观察持续 602704 ms，补充保存反馈观察 90641 ms，两段均自然停止且可见终端事件 0。最终包重选原 Antigravity 模型验证自动保存反馈（此前基线对 MiMo 也作一次同值重选），没有选择其他模型或强度；两份偏好内容哈希保持不变，仅同值保存更新时间。关闭设置发生在观察结束后，不将关闭动作计作被窗口观察覆盖。
- 实际 Windows Electron 44 / 宿主 SDK 下的合成 ConPTY 停止和自然退出（退出码 7）均通过：真实 TTY、参数字面值、stdin 往返、原生 PID、后代退出和无关进程保留均核实；没有应急杀进程，1 条已知 SDK 提示、0 条意外提示。最终活动 Worker、ready 账号 scope、账号 owner、测试任务、观察器及所属辅助进程均为 0；保留现有持久账号目录、历史和正常 Desktop。
- GitHub CI [38333156799](https://github.com/SuperWheel/dsh-cliworker-now/actions/runs/38333156799) 对上述精确提交成功。公开 tgz 有 362 个普通文件，无符号链接、私有日志或生命周期脚本；root manifest 保持 private，公开 manifest 为可发布预构建包。SHA-256：`e2eebaebcb0e3cdcd503d070428de668add7288f7eaf8756cb43a8677f4a0f51`；Host `31914eb59a1439b72e53e2416a8d266ae35516bcd08cf34d413a55b05da1f7aa`，Client `bb57da4ca8df6416b5c65f08711f9ab9f330ece075932c6d098176b697ad6f5e`。
- GitHub v0.7.8 Release 已公开，三项资产经匿名回下载匹配。npm 发布命令成功退出并返回 PUT 202，但截至 2026-10-13 02:41:56 UTC，公开 0.7.8 元数据仍返回 404、latest 仍为 0.7.7；未重复发布、未撤包，公开传播待完成。
- 旧版独立安装已验证无版本安装不能保证升级、@latest 可以升级至当时公开的 0.7.7。由于 0.7.8 尚未公开，本版 npm 回下载与 0.7.7→0.7.8 升级没有执行，继续保留待办，不能声称通过。
- 市场沿用 [PR #6795](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6795)，最新提交 `68a970fcfaef364663a13f510e594373b291c3ac` 同步新仓库名、条目名与 v0.7.8 固定 tarball；已推送并读回远端，状态 OPEN，市场审核状态单独记录，不声称官网已经上架。
- 真实账号登录及模型生成均未执行。Claude 本机辅助目录的授权独立 GET 返回成功原始空数组；配置候选只表示用户路由配置，不能声称已通过生成。Kimi/Grok 账号受阻不计为目录就绪；平台层、合成验收与真实第三方生成严格分开。
- 本地私有证据保存在 `.test-data/release-078-sol61/`：`mac-final-after-platform-fixtures.json`、`mac-final-ui-verification.json`、`windows/final-delivery-summary.json`、`windows/final-platform-skips.json`、`github-ci.json`、`publish-assets/package-verification.json` 及公开安装下载报告。凭据、机器连接信息和原始运行记录未入 Git。
- Release 标题按用户新增要求改为 `dsh-cliworker-now v0.7.8`，正文沿用 v0.7.7 的 `## 版本`、简介、`### 更新`、`### 安装或更新`、`### 验证` 层级；通过 GitHub API 读回精确核对。规范和可复制 Markdown 模板保存至 `doc/release-template.md`，并加入 `AGENTS.md` 的交付约定，提交 `f24f5f3`。
- 主规格已按最终实现同步，严格校验通过；npm 公开下载/升级仍未完成，因此发布变更保持活动，不提前归档。

## 2026-10-13 外部分发改名与安装界面保留

- 用户要求仓库及外部插件名称统一为 `dsh-cliworker-now`，随后明确 DSH 中已安装插件的界面名称全部不改。最终只保留分发文档、打包元数据、GitHub/Release 和目录提交修改；准备中的全部运行时、界面及关联测试改动已逐字节恢复至本次改名前 HEAD，正式 Desktop 未被覆盖。
- GitHub 仓库已改为 `SuperWheel/dsh-cliworker-now`，repo ID 保持 `1407409202`、Stars 保持 4，本地 origin 已同步；5 个 Release 标题均为 `dsh-cliworker-now v<版本号>`。旧仓库 API 自动指向新名，旧新 v0.7.8 tgz 下载均为 HTTP 200、16395067 字节、同一 `e2eeba…f51` SHA-256。完整哈希见前述发布记录。
- npm 包原本已名为 `dsh-cliworker-now`。当前 package、未来公开包生成器的 repository/bugs/homepage 指向新仓库，开发 private 标志仍为 true；没有覆盖已冻结包、修改版本或改变账号/会话路径。Release 模板按新外部名称更新，安装界面原名要求写入 AGENTS.md。
- 市场沿用 PR #6795，新文件为 `data/plugins/SuperWheel__dsh-cliworker-now.yml`，只有一个本插件条目；条目/PR 名称、仓库与包链接均回读匹配。全目录 schema 4415 条、双语生成和站点构建通过，远端审核保持 OPEN，不声称已上架。
- dshfind 原条目安装探测停留 0.6.5；下载采集需站点维护权限。只读快照 npm 官方 462、npmmirror 25（2026-10-10 至 2026-10-13），按目录 npm 渠道为 487，GitHub 全部 Release 资产 29 单独记录；这些不是独立用户数，也没有写死进页面。
- 已提交 [dshfind PR #51](https://github.com/hikariming/dshfind/pull/51)，提交 `bd643d647c3f51ab86938bc3c983c1b9ee0f880f`，仅修改三文件：本插件旧新名映射、经核验的历史 npm 回链兼容和回归；44 项辅助函数测试通过。没有改变其他别名策略、全站下载门槛或工作流；没有 D1 写入/部署权限，因此主键迁移与公开页面刷新仍待维护方完成，保留未勾选任务。维护步骤见 `doc/dshfind-sync.md`。
- 名称预览曾执行 318 项关联检查及 typecheck，但用户澄清后对应实现已撤回，不将这些当作当前新增功能。最终运行时/测试零 diff，139 个源码文件与重新生成的隔离 preview 全部一致，冻结包哈希不变；浏览器复查恢复 CLI Worker NOW。此次外部分发修改未重复全量或真实模型调用。
- 私有证据：`.test-data/dshfind-078/` 中 repository-rename、redirect-verification、release-names-after、ui-preserved-final、dshfind-pr-receipt，以及市场 canonical-market-update-receipt；均未作为运行数据提交 Git。


## 2026-10-13 npm v0.7.8 公开后核验与链接延期

- 用户确认 npm v0.7.8 已成功公开并取消删除重传。03:00:53 UTC 匿名读取固定版本及 latest 均为 0.7.8；npm 记录的发布时间为 02:58:52.809 UTC。此前维护者状态为 validating，现已结束；未撤包、未重复发布，未改版本或冻结资产。
- npm 与 GitHub Release 公开 tgz 逐字节一致，SHA-256 为 `e2eebaebcb0e3cdcd503d070428de668add7288f7eaf8756cb43a8677f4a0f51`，npm integrity 匹配。隔离 profile 显式安装 npm 0.7.8、原生命令列包/导出配置通过，362 个安装文件全部与冻结包匹配。
- 新发现：开发 pnpm 11.25.0 与真实 Desktop 自带 pnpm 11.7.0，在独立 0.7.7 profile 中执行 `@latest` 均退出 0 但仍为 0.7.7，与 pnpm 11 默认 1440 分钟的新版本等待策略一致。当前 0.7.8 按 npm 时间约在 2026-10-14 10:58:53（北京时间）满足默认年龄条件，实际仍须届时查询核验；没有提前报告升级成功。固定版本安装由 pnpm 原生在测试 profile 写入仅针对该精确版本的年龄例外，之后再执行 latest 保持 0.7.8，不能以此代替无例外的默认升级验收。
- 两次独立 Host 加载夹具均检测到 Client 解析到开发仓库而非 registry 安装目录，主动拒绝该来源；未计为公开包 Host/Client 加载或自然退出通过。超时后仅向测试进程范围发送 SIGTERM，两个观测端口关闭，测试 Host 进程全部退出。没有修改用户 Desktop、账号或安装器策略，账号查询和模型生成均为 0。
- 用户明确选择保留 v0.7.8，Repository/Homepage 留待下一次批准发布时同步。源码及未来打包清单的 repository/bugs/homepage 已指向 `SuperWheel/dsh-cliworker-now`，但已发布 0.7.8 包保留冻结时的旧字段；GitHub 旧链接仍重定向。此要求写入 `doc/release-template.md`，不擅自升号。
- 双语安装说明、Release 和分发规格已补充安装器等待规则及实际版本核对，不改变主安装行。v0.7.8 Release 已通过 API 精确回读；三个原资产保留。规格严格校验 14/14，通过 diff 检查；运行时代码和版本无改动，未重复全量测试。发布变更为 11/12，4.2 默认 latest 升级保留待办，不归档；npm Host 来源检查失败也保留在本记录中。
- 市场 PR #6795 的两项检查均成功但仍 OPEN；dshfind PR #51 仍 OPEN、无检查结果，页面迁移继续待维护方处理。私有证据：`.test-data/release-078-sol61/install-078/final-acceptance-receipt.json`、`desktop-install-078/carrier-installed.json`、`release-after-npm-public.json`。

## 2026-10-13：小红书素材同步外部分发名与最新版安装入口

- [x] 八张配图外部标题、07管理体验标题、08品牌名/搜索词/新GitHub地址及包内文案统一为dsh-cliworker-now；终端与添加插件入口改为@latest，AI提示词使用“帮我安装最新版插件”。实拍界面名称依照项目约定保留，源截图及隐私遮盖未改写。
- [x] node build.mjs、浏览器DOM及目视排版通过；新名称与命令完整，长标题保持两行、无文字溢出、页脚间隔至少36px。sips确认8张1200×1600，安全截图源SHA-256逐项不变。已有解压目录（含发布包2）图片逐字节同步，新旧ZIP均为10条目且CRC校验通过。
- 本轮只编辑营销素材与文档，未修改产品版本/运行时、执行安装命令、发布到GitHub、调用模型或重跑产品测试。


## 2026-10-13 npm 安装夹具来源纠正

- 前述两次 Host 验收失败的原因是独立夹具缺少自己的 package.json，SDK 的最近包查找向上归属到开发仓库，从而注册了仓库 Client；不是 npm 包缺少 Client。新增只有唯一 name/private/type 的夹具清单后复验通过，保留原失败记录。
- 原生 Desktop 独立安装的 npm 0.7.8，362 个文件匹配；Host/Client 均解析到安装目录，appReady 后 appExit(0) 自然退出，未发送终止信号，端口关闭且 PID 消失，清理回执通过。账号/CLI/模型调用为 0。证据 `.test-data/release-078-sol61/desktop-install-078/verified-host/` 三份 host-graph、host-lifecycle、host-cleanup 回执。此结果不替代仍待验证的默认 @latest 年龄等待后升级。


## 2026-10-13 GitHub 源码安装最小验收

- 版本保持 0.7.8。新增开发清单 `prepack: node scripts/build.mjs`，用户明确批准后将源码入口提交 `0c68753a70098c3bed4ca36f1c2bc5350510fa56` 推送 main；本次后续说明只修改文档与规格，不改变该提交已验收的构建或运行代码。
- `pnpm_config_verify_deps_before_run=never pnpm build:preview` 通过。开发清单没有 prepare；冻结 npm/tgz 清单仍无 scripts，SHA-256 保持 `e2eebaebcb0e3cdcd503d070428de668add7288f7eaf8756cb43a8677f4a0f51`。没有正式重建用户 Desktop，也没有重发 npm 或替换 Release 资产。
- macOS 使用 Desktop 内置 dsh 和独立命名 profile，实际执行不带 `#` 的 GitHub 简写，解析到上述提交；首次被 `ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED` 拒绝，仅按当次确切来源键追加独立 profile 的 allowBuilds 后重试退出 0。prepack 生成 357 个 lib 文件，原生 bundle 登记正确；Host/Client 均从安装目录加载，appReady 后自然 appExit(0)，端口关闭、PID 消失，未发送终止信号。证据 `.test-data/github-source-078/mac/final-receipt.json`。
- Windows 使用 Desktop 内置 dsh 和独立命名 profile，实际执行固定同一完整 SHA 的 GitHub 简写。外层安装器 pnpm 11.7.0；源码构建要求 PATH 可调用固定 pnpm 11.25.0。首次构建拒绝、缺少 pnpm 命令及后续 `readStream must be readable` 均保留失败回执，不能将这些尝试计为安装通过。
- Windows 合成对照中，相同环境和 cmd，100 字符 cwd 可正常启动，实际存在的 299 字符 cwd 则 spawn ENOENT 且管道不可读；该目录明确为模拟，不是已被安装器删除的原失败现场。仅将本轮隔离根及缓存移至较短路径、保持依赖/构建脚本和包管理器版本不变后，原生命令退出 0，prepack 完成，357 个 lib 文件及 Host/Client/协议/辅助资产齐备，bundle 原生登记成功。长路径是结合对照与复验支持的原因判断，不把合成探针写成原现场直接证据。成功与失败记录位于 `.test-data/github-source-078/windows/`。安装后的真实 Desktop profile 三项配置哈希保持不变，顶层安装器 close/exit 0 已确认；最后 SSH 超时导致额外 exports 导入探针未上传、未执行，最终全进程退出观测未完成，不能声明 Windows 完整加载或全部后代清理通过。远端隔离安装及缓存保留。
- 双语 README 和发布模板补齐 Desktop/Web 命令、Node/pnpm 前置条件、精确构建授权、固定 commit、旧 v0.7.8 Tag 限制及 Windows 路径注意事项。主规格同步 GitHub 源码安装需求；`pnpm spec:check` 严格校验通过，相关差异检查通过。
- 本次仅最小构建/安装验收，真实账号查询、登录和模型调用为 0。未运行全量回归、Web profile 独立实装、全部 CLI 生成或 Windows 完整 Host/UI 生命周期；用户实际 Desktop profile 与全局构建保护未修改。默认 npm @latest 年龄等待后的升级仍保持原待办。

## 2026-10-15：v0.7.9 GitHub #1/#2 AGY 修复（最小验收）

- 用户本轮明确定位开发版本 v0.7.9，正式提交 GitHub 前不额外升号；bug 修复只做最小验收，全量验收留在获准正式提交 GitHub 之前。包清单、AGENTS、OpenSpec 配置/流程和双语 README 已同步；已发布 v0.7.8 下载地址保持有效版本。
- [Issue #1](https://github.com/SuperWheel/dsh-cliworker-now/issues/1)：保存本轮实际回复与独立汇总错误；AGY 续聊仅在退出、会话身份、完整 DONE 步骤、非空 DONE 回复和无本轮错误/清理异常等证据同时满足时显示 uncertain（结果待核实），不宣称成功或已证明旧 EOF。宿主 job 外层仍保守 failed，JSON 独立返回 response/error/guidance。旧 AGY ERROR 汇总读取时不覆盖实际正文，其他 CLI 折叠规则不变。
- [Issue #2](https://github.com/SuperWheel/dsh-cliworker-now/issues/2)：完成的空/纯空白 assistant 不生成消息块，过程区保留其 Token、时间、步骤耗时；活动流式、工具和错误保留。最后可见回复功能条跳过隐藏空步骤，本轮时间与 CLI 会话累计耗时/用量分别展示，不重复相加。
- 最小回归（命令均加 `pnpm --config.verifyDepsBeforeRun=false`，避免现有 pnpm 环境触发依赖重装）：`test tests/agy-run-outcome.test.ts tests/core.test.ts tests/adapters.test.ts` 85/85；`test tests/telemetry.test.ts` 10/10；`test tests/conversation-timeline.test.tsx` 10/10；`test tests/panel.test.tsx -t 'uncertain AGY|keeps .* filtering|leaves the recycle view'` 8/8（53 项名称过滤未执行）；Panel 原生历史/streaming tail 两项定向 2/2（59 项过滤未执行）。合计 115 个不同的相关用例通过，没有运行全量测试。
- Host/Client `typecheck` 通过；最终 `build:preview` 通过，preview 的 139 个源文件与当前 src 字节一致，版本 0.7.9。Host SHA-256 `95cd82fd8ce63381fdae3229eafc90f233f8a019f6ff04d403a447a7612653c0`；Client `1f93222f6c95b57670c902f34983541588c74d3a40ed393f7b2c497f464b537f`。仅隔离包 `.cache/preview-package`，未运行正式 build。
- Tabbit 实际渲染使用真实 ConversationTimeline、MarkdownText、UsageIndicator 和生产样式，输入全部明确标注模拟。六模式覆盖完成空步骤、空流式、正文流式、失败空输出、结果待核实、历史页：完成模式 2 个 article/0 空 assistant、过程 3 个统计行；步骤 Token 23/11/7 可查看，本轮 5 秒与累计 4100 秒独立，最终总用量保持 410 tok；末条 tail=always，流式及历史 tail=hover。截图逐张视觉核查通过。证据 `.cache/agy-issues-v079/{verification.json,completed.png,process.png}`；可复现夹具 `.cache/issue-2-ui/`。
- 中间检查如实保留：pnpm 初次自动检查依赖因无 TTY 中止，改为既有配置开关，无安装/清理依赖；新测试初跑两处断言使用不当已修正（undefined 的 not.toContain 和两个同类统计控件的选择范围），重跑通过；隔离 UI 初次 bundle 缺少 automatic JSX 导致 React is not defined，修正夹具构建并补齐生产样式后刷新，无脚本错误。独立审查发现空/纯空白 result 会话 ID 可能进入 uncertain，已在 parser 严格拒绝并在 runtime 二次比对，补协议及运行时回归，复审无剩余确定问题。
- `spec:check` 归档前后均 15/15 通过，差异检查通过；本 change 的规格、实现和最小验收完成后同步归档，既有三个未完成 change 保持原状态。没有 Windows 实机、真实 CLI/模型、正式 Desktop 更新、全量验收、GitHub 推送/评论/关闭 issue 或发布；浏览器模拟不等同于这些实机验收。既有图标归档、宣传资料与历史文档改动保留。

## 2026-10-15：v0.7.9 轮后续聊与模型快选最小验收

- 已实现 Host 持久待发送队列、正常结束后 FIFO 续聊、取消/暂停/显式恢复，失败/停止/uncertain/重启保留未发送内容。停止等待发送前原生查询清理；真正执行前重新核验账号/模型及父会话权限。输入运行中可编辑，成功响应不覆盖后来草稿；用户最终要求的单一动作按钮已落实：空草稿停止，有文本发送，二者不并排。
- 已实现首次派遣保存目录、Worker 同来源缓存读取、菜单预取复用及选择时本地保存。原生会话 ID 保持；没有依据添加“换模型必然丢失上下文”弹窗。发送时原生授权继续，失效不静默回退。
- 公开过程接入 Codex、Claude、Pi、OMP、Grok，协议来源及未支持范围见 [public-process.md](public-process.md)。只显示原生公开文本与计划，不提取隐藏推理。
- 所有命令加 `--config.verifyDepsBeforeRun=false`，避免 pnpm 触发与本次无关的依赖重建。缓存/设置/core 三个关联测试文件 69 项通过；Panel 全文件在初版测试按钮名修正后 66 项通过，随后新增 metadata 取消用例通过，并对最终单按钮行为定向回归 3 项通过（最终文件共 67 项；未把重复运行累加成新增覆盖）。
- `tests/followup-queue.test.ts tests/runtime.test.ts tests/agy-run-outcome.test.ts tests/storage.test.ts tests/cleanup-persistence.test.ts` 共 69 项通过，其中队列新增 15 项覆盖 FIFO、身份/账号、去重、停止清理、重启、uncertain、取消、执行前拒绝保留、目录等待后权限变化及文件边界。
- `tests/public-process.test.ts tests/conversation-timeline.test.tsx tests/grok-adapter.test.ts tests/adapters.test.ts` 共 47 项通过；Pi/OMP 相关定向测试 4 项通过（其余 52 项按名称未运行）。首次 Pi/OMP 合成回环服务器受沙箱 EPERM 阻断，获准本机监听后重跑通过；没有真实模型请求。
- 独立审查修复了：停止在元数据查询中提前返回、outbox 读取链接边界、runtime 等待后权限变化、metadata 准备阶段 UI 无取消出口。最终没有剩余确定性 Host 问题。
- `pnpm ... build:preview` 最终通过；在隔离包内运行 `pnpm ... typecheck`，使用本次生成的 Remote 声明，Host 和 Client 均通过。全部 src 与最终预览源逐字节一致。正式 lib 不修改，避免热更新已安装插件。构建仅保留既有 CommonJS 建议提示。
- Tabbit 使用真实 Panel/ConversationTimeline/原生控件、明确模拟 Gateway：运行中打字与 Enter 入队、继续草稿、暂停/显式恢复/取消、模型及强度快选（目录读取 1 次、偏好保存 2 次、任务启动 0 次）、公开摘要安全文本、无摘要提示均已实际渲染核对；最终按钮数始终为 1。320 px 窄栏 clientWidth/scrollWidth 均为 320，按钮可见。夹具与证据在 `.cache/followup-ui/`，`single-action.png` 为最终界面，`verification.json` 记录范围与哈希。模拟渲染不等于安装后的 Desktop 验收。
- 版本仍为 0.7.9。未执行真实账号/模型、Windows 实机、正式 Desktop 更新、全量测试、GitHub 推送或发布。全量验收只在获准的正式 GitHub 提交前执行。


## 2026-10-15：v0.7.9 运行中发送方式与待发送折叠最小验收

本次属于 v0.7.9 未提交 GitHub 的迭代，未增加版本号。高级设置按项目/CLI 保存引导、插队、排队；Pi/OMP 接原生 steer，其余默认排队；待发送卡片可插队、取消，标题下有分隔线并支持带动效折叠；输入框仍只有一个动作按钮。

已执行（命令统一使用 `pnpm --config.verifyDepsBeforeRun=false`，以下均为对应变更的关联验收）：

- `exec vitest run tests/running-message-settings.test.ts tests/storage.test.ts`：7 项通过；另 `tests/cli-settings.test.ts -t 'running message preference Gateway'` 2 项通过。验证能力默认、项目/CLI 隔离、重启恢复、私有权限、无 CLI 查询的读写，以及非法方式/链接文件拒绝。Gateway 参数经运行时枚举校验，使用现有字符串 Remote 边界。
- `exec vitest run tests/panel.test.tsx tests/settings-dialog.test.tsx`：240 项通过；之后只对新增折叠/单按钮/卡片插队等 6 项及“保存方式不重读目录”1 项做定向检查，通过。未再次执行全套。
- Host 的 `tests/followup-queue.test.ts`、`tests/runtime.test.ts`、`tests/cleanup-persistence.test.ts` 关联回归：3 文件 53 项通过，验证三模式、原生回执与用户事件、相同请求跨模式去重、明确未发送失败重试、未知结果不重投、插队等待清理、停止/取消竞争、保留其他队列顺序/原暂停状态、权限及账号变化和清理异常全局封闭。
- `exec vitest run tests/pi-omp-control.test.ts`：8 项通过；`exec vitest run tests/pi-omp-adapter.test.ts -t 'native guidance'`：6 项通过、56 项按名跳过；另与既有公开过程、恢复、工具失败、Pi 终止及 SIGTERM 清理相关的 8 项通过。全部使用明确模拟处理器或 RPC 子进程，未调用真实账号/模型。
- 原生控制确定性回归覆盖：成功 receipt 已写入后立即 close/abort 仍确认成功；明确拒绝允许最多三次新 attempt，每次有独立文件和原生 id；终态先于回执、超时及未知接收结果不自动重投。Windows 盘符/UNC 的 namespace 等价只做离线单元验证。
- 最终 `build:preview` 成功；在 `.cache/preview-package` 执行 `typecheck`，Host 与 Client 通过。核对全部源码与预览副本字节一致，新增 control helper 位于 `lib` 和声明输出目录。第一次构建暴露 Remote 不能直接使用未导出的 CliId 类型，改用现有字符串边界加枚举校验后通过。未执行正式 build，未更新 Desktop 链接。
- Tabbit 加载实际 Panel/高级设置/原生菜单与明确模拟 Gateway：三项文字、Codex 禁用引导及默认排队、Pi 默认引导、按 CLI 恢复选择、三模式提交、卡片插队顺序、单按钮均通过。折叠高度从 108.5px 到 0、标题线 0.5px、inert 生效，过渡 220ms/180ms；reduced-motion 下为 0s。360px 视口内对话内容宽与滚动宽同为 340px，折叠期间新消息仍保留、计数更新。证据在 `.cache/running-modes-ui/verification.json`、`settings-and-queue.png`、`narrow-layout.png`；测试页已关闭、服务已停止。
- `spec:check` 归档前 16 项、归档后 15 项均通过、0 失败；本 change 的 9 项任务完成，规格同步并归档为 `2026-10-15-add-running-message-modes`；已有 `release-v078-latest-install` 的重复 ADDED 信息保留，本轮未修改该旧 change。`git diff --check` 通过。

未执行：真实 CLI 模型引导/跨模型上下文、Windows 实机、已安装 Desktop、全量测试、GitHub 推送或发布。原生语义来源和能力边界见 `doc/running-message-protocol.md`；回执仅表示 CLI 接收，不等于模型执行完毕。独立审查发现的回执与结束竞态、确定未发送失败重试问题已修复并回归。


## 2026-10-15：v0.7.9 已安装 macOS Desktop 最小验收

- 用户明确要求放到桌面端测试。更新前 24 个 Worker 全为终态、无本插件任务/账号桥接进程；正常退出 Desktop 并确认主进程结束后执行 `pnpm --config.verifyDepsBeforeRun=false build`。372 个 lib 文件核对，正式 Host 与此前通过的 preview 相同，Client 仅构建路径 region 注释/源映射不同，去除 region 注释后的执行文本相同。新增控制 helper 齐备；没有重复安装或修改 profile 链接。
- 实际 Desktop 插件详情确认 v0.7.9、已启用、1 个组件运行中。高级设置下拉三项文案正确；Codex 默认排队且引导禁用，Pi/OMP 默认引导。Codex 保存插队、切换 CLI 后回读保持，测试后恢复排队。实际运行中输入可编辑，唯一动作按钮随草稿切换发送/停止。
- 沿用 Codex 的 GPT-5.6-Luna / Low 真实执行 5 轮：4 轮完成、1 轮按插队操作中断。`sleep 60` 的原生工具退出码 0；其完成后排队消息自动执行。第二组 `sleep 120` 被停止，原第二条卡片先回复 `DESKTOP_INTERRUPT_ONE`，其余消息随后回复 `DESKTOP_AFTER_INTERRUPT`。同一原生会话，事件顺序为 completed 后新 user、interrupted 后新 user，没有并发轮次或剩余待发消息；没有文件读写工具。原生 CLI 进程数值退出码未单独持久化，Host completed 路径要求退出码 0 且清理已确认，不能把模型自述当退出证据。
- 已安装界面可见待发送标题下分隔线；实际展开/收起正常，收起后卡片操作不出现在辅助功能树，标题保留；折叠期间继续发送，数量从 1 更新为 2，展开内容完整。Desktop 未做逐帧过渡计时；前轮隔离组件的 220ms/180ms 与 reduced-motion 验证仍单独保留。
- Pi 历史记录缺少账号绑定，沿原 GLM-5.3 / Low 选型通过 UI 的新建对话建立独立验收 Worker，旧历史保留。共 3 轮：前两轮因无 shell 工具/模型简短回复而很快结束，未发送引导，不计为引导通过；第三轮在输出期间成功接收原生引导，持久 receipt 为 steer/acknowledged，原生会话也有同一引导消息。一个 runId、一个原生 conversationId、一个连接事件，无工具/重启；当前 2205 字正文继续输出完成后，原生下一条 assistant 精确回复 `PI_STEER_OK`，Host completed，队列为空。证明同轮原生引导，不表示立即截断正在生成的内容。
- 最终 25 个 Worker、活动 0、待发 0，本次桥接与 sleep 进程 0。更新前 4633 份文件中最终 4622 份未变；153 份 profile、账号绑定/凭据及设置文件哈希未变，Codex 原有事件日志前缀也匹配原哈希。变化为本次 Codex 会话、宿主两份对话日志、host.lock 及 OMP 目录查询的数据库/日志；OMP 自身保留最近 5 份日志的轮转移除了 10月9日调试日志，不能宣称全部原始文件不变。测试记录和新 Pi 对话保留，已返回原“用AGY进行问候对话”及 CLI Worker 总览。
- 私有核查结果位于 `.cache/desktop-v079/`，含 build-verification、state-before/after-restart/final、cleanup、codex-run-audit、pi-run-audit 和 verification JSON；屏幕与辅助功能核查记录在本次工具轨迹。部分 Codex 原生日志有 MCP 502 和中断后的缺失前一工具输出诊断，未阻止上述成功轮完成，本轮不扩大排查范围。
- 只补正式构建、安装界面和相关真实交互验收，没有重跑全量测试；未做 OMP 真实模型引导、Windows Desktop 或跨模型上下文验收。保持 v0.7.9，不推送 GitHub、不发布。

## 2026-10-15：v0.7.9 正常停止、即时提交与待发送外观最小验收

- OpenSpec：`fix-conversation-stop-and-send-feedback`。版本保持 `0.7.9`，未推送或发布 GitHub。
- Host：正常停止及插队停止记录 `interruptionReason: user`，不再把取消原因写成错误；已有会话沿原 ID 续聊，会话建立前正常停止允许原 Worker 新建原生会话；真实失败、超时、结果待核实及清理隔离保留。准备阶段纳入 Runtime 停止等待和同 Worker 互斥，并防止准备期间改选模型。
- Client：按 Worker 保存待确认消息，提交即显示并清空当次草稿，不等待 metadata；连续提交串行且对账不重复，失败不覆盖新草稿，正常停止不归入异常。普通续聊的运输结果未知时保留待确认内容并禁止盲目重发，只有 Host 停止确认未准入后才恢复。
- 关联 Host 回归：`pnpm --config.verifyDepsBeforeRun=false exec vitest run tests/followup-queue.test.ts tests/agy-run-outcome.test.ts tests/runtime-metadata-cleanup.test.ts tests/storage.test.ts`，4 文件 101 项通过，含准备阶段取消清理、晚到查询、改选互斥、先失败后停止、无 ID 恢复与真实 AGY 协议终态保护。
- 时间线回归：`pnpm --config.verifyDepsBeforeRun=false exec vitest run tests/conversation-timeline.test.tsx`，12 项通过。
- 样式：复用输入框主题，标题线全宽、内部线内缩、操作居中。Tabbit 实际渲染的是明确标注的模拟队列 DOM，使用真实原生 Button 和 Harness 主题：960/360px × 浅/深色四组合半径均 28px、背景/阴影/描边完全一致，标题线与外框左右边缘重合，按钮与内容中心差 0px，无横向溢出；折叠 220/180ms，高度归零且 inert，减少动效为 0s。证据 `.cache/queue-surface-check/verification.json`，不当作真实 CLI 或 Desktop 验收。
- Panel 回归：`pnpm --config.verifyDepsBeforeRun=false exec vitest run tests/panel.test.tsx`，86 项通过（新增 11 项行为回归）。本次关联自动回归共 199 项，未运行全套测试。
- `pnpm --config.verifyDepsBeforeRun=false typecheck`、`build:preview` 和最终 `build` 通过。最后运输未知草稿修复后重新执行以上三项；正式构建前确认 25 个 Worker 无活动任务，正常退出 Desktop，主进程退出后再更新链接包。最终 lib 376 文件，Host 与 preview 字节一致，Client 去掉构建目录 region 注释后一致；差异仅 region 注释、source map 和 TypeScript build info。
- 已安装 macOS Desktop 真实验收：沿当前 AGY `Gemini 3.8 Flash · Low` 选型，共四轮（2 次正常停止、2 次完成），每轮恰好一个 user 事件。停止和插队均显示“已停止”且无错误横幅，原生结果的 interrupted 保留为过程证据；插队消息返回 `AGY_INTERRUPT_OK`，其后普通续聊返回 `AGY_AFTER_STOP_OK`，两轮原生 `SUCCESS`。四轮沿同一原生 conversation_id，无重复执行已取消的队列文本。使用等待命令的两轮被停止，检查无残留 sleep 进程。
- Desktop UI 核对：提交尚在准备时立即显示“正在发送…”且输入已清空；运行中输入草稿可编辑，单按钮随有无文本在发送/停止间切换；两条长短卡片圆角、背景和阴影匹配，标题线贯穿左右、内部线内缩、操作居中；折叠只留标题和数量，再展开可操作；卡片取消及插队成功。工具观察与本地原生审计 `.cache/stop-send-v079/verification.json` 相互核对，不以主 Agent 的完成描述作为证据。
- 保留性核对：4669 个基线文件中 4662 未变、7 个预期变化、无丢失；变化为 AGY Worker/事件/待发送记录、原生 AGY session、host.lock，以及两份旧正常停止 Worker 的精确迁移。337 个匹配账号/认证/偏好/配置的基线文件均未变化；原事件文件前缀哈希保持。结束时活动 Worker 0、待发消息 0，Desktop 保留在最新 AGY 结果。
- 边界：本轮未执行 Windows Desktop、其他 CLI 真实执行、新无ID真实会话（由自动回归覆盖）、全量验收或 GitHub 推送/发布。真实 Desktop 验证只覆盖现有 AGY 选型；模拟主题渲染不冒充真实 CLI 验证。
- OpenSpec 严格校验通过；归档前后复核主规格与增量一致，保留上述未测边界。历史文档/assets的既有未提交修改保持原样，仅提交本次修复范围。


### v0.7.9：插队即时展示、无发送提示与平滑退场（2026-10-15）

- [x] 去除用户消息下“正在发送…”及等待同步文字；卡片插队不占全局等待，立即展示用户消息并退场，保留后续草稿编辑与单按钮。
- [x] 队列事件精确身份及回执水位对账；覆盖临时暂停、准备失败、同文后续消息、丢失回执、显式停止、关闭侧栏与历史截断，不把本地展示当作原生成功。
- [x] `pnpm --config.verifyDepsBeforeRun=false exec vitest run tests/panel.test.tsx`：93/93；`... vitest run tests/followup-queue.test.ts tests/core.test.ts`：76/76；`... vitest run tests/storage.test.ts -t 'restores exact outbox admission identity'`：1 通过、8 跳过；`... vitest run tests/followup-queue-presence.test.tsx`：6/6。合计 176 项关联测试通过；未执行全量测试。
- [x] `pnpm --config.verifyDepsBeforeRun=false typecheck`、`build:preview`、空闲时 `build` 通过。Desktop 插件链接仍指向本仓库；Host 和生成协议与 preview 一致，Client 仅构建来源路径注释不同，归一化后完全一致。
- [x] 标注模拟的真实组件逐帧验收：中间行高度 72.5→0，最后区域连同间距 114.5→0，透明度同步下降；重复快照不重建剩余 DOM；70ms 内失败恢复保留节点并反向平滑展开；切换 Worker 不串卡片，减少动态效果立即移除，360px 无横向溢出。证据 `.cache/interrupt-feedback-v079/animation/verification.json`；浏览器动效测量不冒充真实 CLI。
- [x] macOS 已安装 DeepSeek Harness 0.2.0-rc.2：确认无活动 Worker/队列后正常退出并更新构建；使用原已选 Antigravity / gemini-3.8-flash-low / low，真实等待轮→卡片插队。点击后用户消息直接显示，待发送区域退出，未显示发送中提示，继续输入未发送测试草稿并清除；最终显示 SMOOTH_INTERRUPT_OK 一次且无错误。
- [x] 原生证据核对：等待轮 interrupted / native ERROR interrupted；插队轮 completed / native SUCCESS，用户事件 queuedFollowupId 与被选卡片一致，未调用工具；同一原生会话、历史前缀不变、队列与活动 Worker 均为 0，测试 sleep 无残留；24 个账号/配置相关文件哈希未变。私有证据 `.cache/interrupt-feedback-v079/verification.json`，不入 Git。
- [x] 同步中英文 README、设计与 OpenSpec；归档前严格校验 16/16、同步主规格 12/12、归档后严格校验 15/15 通过；本轮版本仍为 v0.7.9，不推送或发布 GitHub。未做 Windows Desktop、其他真实 CLI 和全量验收；失败/未知等异常路径使用自动回归，不额外消耗真实账号调用。


### v0.7.9 补充：连续插队即时转移与后一次优先（2026-10-15）

- OpenSpec：`replace-pending-interrupts-with-latest`。每次插队立即转气泡并移出卡片；Host 即时持久受理、后台处理停止和准备。连续请求按侧栏来源及点击序号防乱序，尚未发起原生进程的旧请求保留为“已被后续插队取消”，已启动前轮正常停止；最新请求和普通队列均等待实际清理确认。
- 本地尚未回执或尚未 dispatch 的普通排队可直接转为插队，原 RPC 的晚成功、晚失败及过时快照不再恢复卡片或覆盖新草稿。稳定提交 ID 合并原生 user，覆盖 user 先于 submission 的转移情况。受理后的失败、取消、重启记录均留对话，重启不自动重发。
- 显式 Stop 只作用于其捕获范围；后点插队先显示，RPC 等该次停止确认。停止回执未知时保留屏障，可再次停止确认；再次停止取消的等待消息不会在屏障释放后发出。输入框与单动作按钮不依赖旧插队 RPC 完成。
- Host 关联回归：`pnpm --config.verifyDepsBeforeRun=false exec vitest run tests/followup-queue.test.ts tests/storage.test.ts tests/core.test.ts`，3 文件 94 项通过（56/10/28）。覆盖 A/B/C、metadata 晚拒绝、准入后未 spawn、spawn 异步窗口、其他普通消息顺序、请求乱序、迟到 queue、幂等、崩溃恢复与双向去重。
- Client：`pnpm --config.verifyDepsBeforeRun=false exec vitest run tests/panel.test.tsx`，96 项通过；`tests/conversation-timeline.test.tsx` 12 项通过。停止与原生结果保护：`tests/agy-run-outcome.test.ts tests/runtime-metadata-cleanup.test.ts` 47 项通过。本次合计 249 项关联回归，未执行全套测试。
- 隔离 `build:preview`、preview 和 root `typecheck`、最终 `build` 均通过；首次 preview 指出默认 UUID 推断类型过窄，显式标注 string 后通过。Desktop 构建前无活动 Worker/队列/账号终端，正常退出并确认主进程退出后更新。Host 和 Remote 声明与 preview 字节一致；Client 仅规范化构建路径 region 注释后相同。版本保持 0.7.9。
- 实际 Panel 显式模拟验收 3 场景通过：连续 A/B/C 气泡数 1/2/3、取消数 0/1/2，普通 D 保持同一 DOM 节点；本地未 ACK 排队转移后迟到回执不回卡、新草稿不变；重挂载保留 3 气泡/2取消且不新增 RPC。单发送按钮，无横向溢出。使用最终源码、原生控件、Harness 主题及 mock Gateway，真实 CLI 调用 0；证据 `.cache/latest-interrupt-panel/verification.json` 和源码哈希。未重复此前已验收且本次未改动的纯动画用例。
- macOS 已安装 Desktop 真实 AGY 验收：原 `Gemini 3.8 Flash · Low` 选型，等待轮 `d6a362dd-63e5-4f68-968b-2781470cf10a` 正常停止，原生结果 `ERROR/interrupted`；A 在准备阶段被 B 替换，A 原生 user 事件 0、持久气泡 1 且 superseded；B 原生 user 事件 1、气泡 1，轮 `ebb1df87-de90-4d90-b74e-d0aabb15e2da` 原生 SUCCESS，实际响应 `LATEST_INTERRUPT_OK`。两次点击即时退卡，A 取消文字留在实际对话，B 完成后无待发送卡片或“正在发送”。
- 原生会话 ID 保持；测试结束活动 Worker 与队列均为 0，等待/任务进程已退出；历史前缀 hash 不变，33 个既有偏好、会话选型和账号绑定文件 hash 不变。实际事件读取并经 `foldEvents` 复核；私有证据 `.cache/latest-interrupt-v079/native-verification.json`。桌面随后正被其他工作流插件安装操作占用，未额外进行桌面重开；重挂载验收只归为上述显式模拟，不冒充真实重启。未做 Windows、其他 CLI 真实模型、全量验收或 GitHub 推送/发布。
- OpenSpec 严格校验归档前 16/16、同步并归档后 15/15 通过；仅归档本次 `2026-10-15-replace-pending-interrupts-with-latest`，其余既有变更保持。主规格标题、Purpose 和其他需求未改。


## 2026-10-15：v0.7.9 macOS / Windows 全量发布验收

- 用户明确授权连接 Windows，在两个平台全量验收合格后提交 GitHub、npm 和 dshmarket；版本继续固定 0.7.9。使用隔离构建、专用 profile 与私有远程目录，未覆盖用户现有 Desktop 配置、账号或会话；既有素材整理和历史文档差异未带入提交。
- macOS arm64 全量最终 108 文件、2392 通过、8 个 Windows 专属用例跳过、0 失败；Windows x64 / Node 24.15.0 全量 2400 用例、2381 通过、19 个 POSIX/macOS 专属用例跳过、0 失败。全部新增排队、插队、停止、持久恢复用例均执行。命令统一使用 `pnpm --config.verifyDepsBeforeRun=false`；平台 skip 明细保留于本轮私有报告。
- 修正两类测试预期而未更改运行时代码：设置用例按已落实的准备阶段忙碌协议拒绝禁用，显式 stop 后恢复操作，另用外部配置写入保留禁用竞态；outbox 的 0600 只在 POSIX 断言，两个平台都核验拒绝硬/符号链接且目标实际权限和字节不变。macOS 和 Windows 已在最终修正后重新跑完整套。
- macOS 首轮受限执行因进程管理/回环监听限制未完成，改在获准的正常执行环境重跑；Windows 首轮 2378 通过/3 失败/19 跳过，三个失败均为 POSIX mode 数值断言。保留首轮原始日志，不将其计作通过。两平台类型检查、隔离构建及 OpenSpec 16/16 严格校验通过。
- 唯一冻结包 `dsh-cliworker-now-0.7.9.tgz`：383 文件（378 lib），SHA-256 `0d183d7c1649c756e4d6c5ff62dbaa2ea276b7bc4ace13f8c6a25633de52f949`。开发清单仍 private；公开清单去除 scripts/devDependencies，并指向 canonical 仓库；包边界、辅助资源和模块图检查通过，无凭据、连接配置、账号绑定或运行日志。两系统安装目录均 383 文件逐字节匹配。
- 两平台使用实际 dsh 安装器和隔离 profile 加载最终包；Host/Client 来源、Gateway 空 watch/取消订阅/非法 interrupt 参数拒绝均通过；appReady 后 appExit(0) 自然退出，PID/端口清理确认。macOS 初次验收夹具缺少独立 package 边界使 self-reference 解析到仓库，修正私有夹具后同包重验通过；Windows 初次隔离 PATH 缺固定 pnpm、诊断连接提前断开导致 runner 后续 stdout 断管，保留失败并仅清理所属进程/锁后恢复余下阶段。
- macOS 实装 Codex 0.162.1、Pi 1.0.4、OMP 16.4.4 的空 HOME 版本/帮助检查与 Pi 离线 SDK 元数据通过；Windows 固定官方 CLI 入口及真实 Electron/SDK ConPTY stop/natural-exit、Job 后代清理和窗口观察结果见本轮报告。Windows 真实官方入口 Codex 0.160.0、Pi 1.0.4、OMP 16.4.4（Bun 1.3.14）及空账号 Pi SDK 元数据通过；原生窗口观察完整覆盖 stop/natural-exit，新增可见控制台 0。合成子进程与真实模型分开；自动化全量阶段新增 CLI 登录、CLI 账号查询与模型生成均为 0，未更新全局 CLI。
- UI 证据沿用同一 v0.7.9 开发阶段实际 macOS Desktop：最新连续插队已核对真实 AGY 事件、原生退出、同一会话和持久气泡。最终 Host 与已验收部署字节一致，Client 仅构建路径 region 注释不同，执行文本相同。自动化阶段未操作当时被其他工作流占用的生产 Desktop；随后按用户要求补做正式桌面验收，见下方追加证据。没有全 CLI 真实模型或所有订阅覆盖结论。
- 私有证据集中于 `.test-data/release-079/`；macOS 最终全量 `mac/full-tests-final-after-platform-fix.json`、安装/Host/Gateway及生命周期、公开 0.7.8 升级基线已保存。Windows 原始和最终报告、同包清单、SDK/窗口及清理证据分阶段保留。本条记录为发布前验收，公开下载、npm 和市场状态在下方另记，不能将本地准备视为公开发布。

- 用户随后指出 Windows 正式 Desktop 未见新版。核实该处仍为 0.7.8；以上 0.7.9 是隔离 profile 安装，不属于正式桌面更新。已暂缓发布，追加正式 Desktop 更新及最新交互验收，完成证据另记。

- macOS 正式 Desktop 最新补验：CUA 打开原 AGY 子对话确认重启后 A 取消/B 完成历史保留；真实等待任务仅执行 `sleep 60`，点击停止后显示“已停止”且无 error 事件；随后普通续聊在前轮终态后准入，同一原生会话、用户事件恰好一条、无工具，原生 SUCCESS 精确返回 `RELEASE_AFTER_STOP_OK`。两次提交均即时出现消息并清空可编辑输入框，无“正在发送”。原生事件、UI 观察与清理回执分别保留于 `mac/desktop-final-stop-resume.json` 和 `mac/desktop-final-ui-observation.json`；活动/待发/本轮进程最终均 0。此补验包含两次真实 AGY 任务，宿主另自动生成状态回报，不能将整次发布阶段表述为零模型调用。

- Windows 正式 Desktop 补验：确认无活动 Worker 后通过原生应用菜单正常退出，使用同一冻结 tgz 从 0.7.8 升级至 0.7.9；安装器 exit 0，383 文件及 Host SHA 一致，安装前后 cordis 配置、3 条历史 Worker 和账号元数据一致。正常启动后沿用既有 AGY / gemini-3.8-flash-low / low 选型：即时消息、运行中输入、自动排队、待发送折叠/展开通过。连续插队 A2 只有 pending→superseded、无 user/admitted；B2 恰好一个 user，最终 SUCCESS 返回 `WIN079_LATEST_B2_DONE`。真实 UI 保留 A2 取消气泡，约 540ms 后待发条目 0、输入仍可用，无“正在发送”。显式停止得到 interrupted/user 且无错误，普通续聊成功返回 `WIN079_AFTER_STOP_DONE`。
- Windows 真实桌面过程保留工具调整的未通过尝试：首次中文 IME 改写文本由精确校验拦截未发送；首次连续插队脚本误按 Invoke 操作 ExpandCollapse 控件，停止后旧排队自然出队，因此不将该轮算连续插队通过。修正私有测试工具后对更长等待重新验证，上述 A2/B2 事件和截图才是通过证据。无产品源码改动，未改发送模式；动效只核对真实折叠与退卡状态，不声称逐帧或帧率测量。证据在 `windows/evidence/desktop/`，不是合成模型回复。

- Windows 最终只读收尾（14:25:56 UTC）：活动 Worker、账号就绪作用域、账号所属进程、认证进程、observer/验收/UI 任务及调试参数进程均 0，run.lock 不存在；正式 Harness 正常进程保留运行。双平台本地及正式桌面发布前门禁至此通过，未将等待公开渠道的事项提前标为完成。


## 2026-10-15：v0.7.9 公开发布与安装回验

- 发布前两端全量和正式 Desktop 门禁通过后，提交 `a31f35e69e68b9bead471edf551ce8302802d132` 已推送 main；该提交的 [GitHub Windows CI](https://github.com/SuperWheel/dsh-cliworker-now/actions/runs/38751781428) 成功。v0.7.9 注释 Tag 固定到该提交，[Release](https://github.com/SuperWheel/dsh-cliworker-now/releases/tag/v0.7.9) 标题为 `dsh-cliworker-now v0.7.9`，包含冻结 tgz、SHA256SUMS.txt 与去除私人路径的 package-verification.json。未重新打包或增加版本号。
- npm 正常登录及本次发布网页验证由用户完成，官方发布进程 exit 0；匿名公共仓库在传播完成后确认固定版本与 latest 均为 0.7.9。GitHub 与 npm tgz 匿名下载逐字节相同，SHA-256 均为 `0d183d7c1649c756e4d6c5ff62dbaa2ea276b7bc4ace13f8c6a25633de52f949`；registry integrity 及 repository/homepage/bugs 指向核对通过。两条原 issue #1、#2 已关闭为 completed。
- macOS 与 Windows 分别以原生 DSH 安装器在隔离 profile 安装公开 npm 固定 0.7.9：383/383 文件与冻结包一致、lock 记录公共 registry integrity，Host/Client 实际来源、Gateway、appExit(0) 自然退出及进程/端口清理通过。此阶段没有模型、CLI 登录、账号查询或正式 Desktop 修改。两个安装器自行在各自隔离 profile 加入仅针对 `dsh-cliworker-now@0.7.9` 的 minimumReleaseAgeExclude；没有手工放宽全局策略。Windows 最终正式 Desktop 5 个原 PID 保持不变。
- 默认升级单独验证：macOS 独立 0.7.8 profile 执行 `@latest` exit 0，但实际仍为 0.7.8；仅备份刷新本包隔离 metadata 后，已读取 latest 0.7.9，重新执行仍保留 0.7.8。workspace 前后相同，没有版本年龄例外，符合默认等待期边界，不能计作已升级到 0.7.9。README 与 Release 保留等待说明及固定 GitHub tgz 入口。Windows 没有额外执行默认 latest 升级，不把固定版本安装当成该项验证。
- 原 [dshmarket PR #6795](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/6795) 已定向更新唯一插件 YAML 至固定 v0.7.9 tgz，提交 `2ed68bff64e12391d727698487a0dc67a9c4009f`，无其他条目或生成 README 差异；标题、正文及远端条目均回读一致。[市场 CI](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/actions/runs/38754058024) 已完成且成功，包括目录/README 校验及完整站点构建；PR 仍待维护者审核合并，不能称已经上架。
- 公开安装原始记录保留于私有 `.test-data/release-079/mac/public-install-final-verification.json`、`mac/upgrade/latest-verification.json`、`windows/evidence/public-npm/`；公开下载与市场回读分别位于 `public-downloads/`、`market-submission-receipt.json`。macOS 固定安装首尝试遇到隔离 store 路径不匹配，复用同一 profile 原 store 后通过，失败日志保留；全量自动、模拟终端和正式桌面真实 AGY 的范围沿用上一节，不扩称所有提供商、订阅或跨模型上下文组合。
- 仅本轮发布验收 OpenSpec 变更完成后归档；归档前严格检查 16/16 通过，归档后剩余活动变更与主规格 15/15 通过；其他历史未完成变更保留。本阶段没有运行时代码变化，因此不重复整套测试或改动正式安装。

## 2026-10-16：v0.7.10 全 CLI 原生协议迁移

版本归属按用户后续指令调整为 v0.7.10；以下实际验收当时使用 v0.7.9 的构建与哈希证据保持原样。

- OpenSpec：`migrate-native-cli-protocols`。新 Worker 固定 transport：Codex app-server；Claude/Antigravity 双向 stream-json；Kimi/Grok ACP；ZCode app-server；OpenCode/MiMo HTTP+SSE；Hermes Runs HTTP API；Pi/OMP 保持原生 RPC 并在停止时先发送 abort。未更新全局 CLI、增加版本或推送/发布 GitHub。
- 历史 Worker 缺少 transport 时保留旧执行器和原会话；未知绑定拒绝启动。Client 仍经 Harness Gateway，原生交互请求默认拒绝。每轮进程/服务在 Host 原范围内清理；控制回执只证明送达，最终停止仍等整个范围退出。新桥有输入/输出、单帧、请求与握手限额，明确区分终态、退出和 uncertain。
- HTTP 实例仅使用回环地址和本轮随机认证，先确认自有监听再发送认证；完整日志行确认端口，不跨 stdout/stderr 拼接。Hermes 私有 API home 不导入用户定时任务/其他消息平台，覆盖外部共享认证目录并在结束时清理本轮材料；官方空定时线程随自有 gateway 退出。失败/取消轮次仍保留已验证身份的原生用量，不能推导为成功。
- 零 prompt 安装版核验：Codex 0.162.1 app-server initialize、Claude 2.1.287 control initialize、Kimi 2.1.1 ACP initialize、Grok 1.0.50 ACP initialize、ZCode 0.16.9 runtime/capabilities 均接受；Antigravity 1.3.6 help 确认双向 stream-json。独立 HTTP 实例确认 OpenCode 1.19.0 与 MiMo 0.1.15 的实际 health/provider/空 session/SSE，以及 Hermes API-only capabilities。MiMo 0.1.15 `/doc` 漏列子路由仅对准确版本和已核实 schema 形态兼容，未知不完整 schema 拒绝。Grok EOF 后需 TERM、Hermes 退出需 KILL 的实际行为保留，不记作自然退出；各次均确认范围已清理。证据 `.test-data/native-primary-offline/`、`native-acp-offline/`、`native-http-offline/`、`native-zcode-startup/`，均不入 Git。
- 关联回归第一轮 31 文件：30 通过、1 平台文件跳过；579 项通过、6 项跳过。旧运行器夹具显式继承 legacy Runtime，保留旧协议回归；新的 `native-runtime` 验证默认路由、持久恢复、未知绑定拒绝和 uncertain。后续新增共享帧/取消、Pi/OMP 原生 abort、HTTP 端口分块/失败用量及 Codex 工具终态回归，结果在下方收尾记录；不把重复运行相加为独立测试数量。
- `scripts/smoke-native.ts` 默认 help/list 不启动 CLI；真实验收仅沿用户明确授权的项目已保存模型/强度，使用隔离 preview 和新私有项目/WorkerStorage。首轮需实际工具及精确文件产物，续聊核对同一原生 ID 且不读文件仍记住随机标记，取消需真实输出后 stop/done 及范围清理。报告的 modelTurns 是提交尝试数，不等于成功生成数。
- 第一轮 `.test-data/native-smoke/run-wuH6V1/report.json`：Antigravity、Codex、OMP、OpenCode 各首轮/续聊/取消三项通过；保存的模型和强度未替换。Pi 首轮/续聊通过但取消分类竞态未通过，修复后新 preview 的 `.test-data/native-smoke/run-K76pqb/report.json` 三项全部通过。ZCode 前两次启动参数与账号初始化问题均保留失败报告，不把 runtime/capabilities 或模型自述当生成成功；后续定向结果另记。
- Hermes 保留当前 Nous `stepfun/step-5-preview:free` / Low：真实 Runs/SSE 已接入，原生 stop 返回 200；指定模型持续返回上游 HTTP 429 容量不足，首轮没有工具产物，未通过生成/续聊/取消全链验收。未盲目重试或改换模型。Claude、Kimi、MiMo、Grok 缺少当前项目已保存选型，未猜测模型或发生成请求。Windows 本次仅关联平台/入口回归，尚无新协议 Windows 实机或全 CLI 真实模型结论。
- ZCode 最终 `.test-data/native-smoke/run-2vguaa/report.json` 三项通过：`zcode-app-v1` 首轮实际文件/公开工具与 102 个原生 envelope、同一原生 session 的无工具续聊、当前输出期间取消后 stop/done 均核对。修复为 app-server 的当前单账号原生 overlay 与严格路由鉴权、完整原生 model/强度设置；0.16.9 create 会丢 reasoning options，故先用已准备的私有 default selection 创建，再 setModel/readback，确认后才发送 prompt。当前 Worker key 只在该轮专用子进程 env 和匹配的原生 headers 响应传递，桥在启动 ZCode 前移除专用 env。该轮 9 份 raw/公开事件/原生日志及报告中密钥明文命中 0、范围进程残留 0；前面模型前失败报告单独保留。
- 模型与工具收尾：AGY 精确核对原生 model；Claude 使用同进程 initialize 的官方 value/resolvedModel 和当前路由明确候选，未确认/冲突映射在 user 输入前拒绝，主循环回复继续核对；原生子代理的明确独立模型不误判为主模型替换。Codex 中断协作调用、失败/未完成图片工具均阻止成功。Primary 模拟回归 39/39。
- Hermes 强制退出兜底由 Host 在完整范围退出后清理固定 auth/.env/config/shared/backups/config，保留原生 DB/session；准备半途失败也清理，目录真实身份、私有权限与祖先链接逐项核对。最终 HTTP 40 项及绑定记录竞态 6 项通过，含真实 Node SIGKILL 夹具、外部链接保护、读取中原子替换丢弃后重新取证。真实零 prompt gateway 通过 capabilities/API-only，自有进程 TERM 后需 SIGKILL 并收到 close；认证材料含原生配置备份全部清除，源假凭据未变。证据 `native-http-offline/hermes-host-cleanup-final-acceptance.json`；首轮官方状态文件原子替换导致 nlink=0 的未通过记录保留。握手现在丢弃变化中的证据并继续有界只读轮询，仍拒绝硬链接、符号链接与超限文件，不向未确认监听发送 bearer。
- 最终回归前的 12 文件尝试有 272 通过/2 失败：新 Host 清理夹具漏 mock 一个上下文依赖，另一 AGY 合成子进程在并行负载下超过 1 秒夹具等待；修正夹具并将其等待调为 3 秒后，两文件 40/40 通过，没有放宽生产协议判定。首次加入 Host 清理 helper 的 preview 类型构建发现缺少声明，补 `.d.mts` 及 emitted helper 依赖后构建通过。
- 最终冻结源码关联回归：`pnpm --config.verify-deps-before-run=false exec vitest run tests/native-hermes-host-cleanup.test.ts tests/native-primary-runners.test.ts tests/native-acp.test.ts tests/native-zcode.test.ts tests/native-http.test.ts tests/native-hermes-binding.test.ts tests/native-runtime.test.ts tests/native-stop.test.ts tests/native-transport.test.ts tests/zcode-adapter.test.ts tests/pi-omp-adapter.test.ts tests/telemetry.test.ts tests/windows-codex-launch.test.ts tests/windows-hidden-process.test.ts --maxWorkers=4`：14 文件、295 项全部通过。最后绑定文件读取收紧后另 6/6 通过。Host/Client `typecheck`、最终 `build:preview` 均通过；源码与 preview/src 逐文件完全一致。
- 正式更新前 26 个 Worker 全为终态，确认 Desktop 无草稿/运行任务后正常退出；主进程退出确认后 `build` 通过。400 个 lib 文件核对，Host 与 preview 完全一致，Client 唯一执行文件差异为 region 来源路径注释，删除该注释后字节相同；source map/build info 差异单列。正式 profile 的原符号链接仍指向本仓库，无重装或配置替换。私有证据 `.test-data/native-desktop/build-verification.json`。
- 已安装 macOS Desktop 冷启动后保留原总览/历史；另从真实新主会话明确派遣 Antigravity，并在原生选型卡片选择沿用保存的 Gemini 3.8 Flash / Low。新 Worker 确认 `agy-stream-v1`，原生 init.model 与保存 ID 一致，native/bridge 都为 SUCCESS，Host completed；真实 UI 显示 `NATIVE_DESKTOP_20261016_OK`（原生正文带终止换行），user 事件恰好 1 条、工具 0。未用主 Agent 完成描述代替子对话、raw 与持久状态核查。本阶段含 1 次真实 AGY 调用及主 Agent 派遣/状态处理，不算零生成验证。
- 正式状态收尾：27 个 Worker、活动 0；本轮受管桥参数匹配进程残留 0。491 份基线账号绑定/账号材料/偏好/原 Worker 与事件及 profile 配置全部哈希不变，无缺失；新验收会话单独保留。证据 `.test-data/native-desktop/live-worker-verification.json`、`state-after.json`、`process-exit-verification.json`。实际 UI 过程在本次 CUA 轨迹，不冒称所有 CLI 或 Windows Desktop 已验收。
- 严格 OpenSpec 校验 16/16 通过，`git diff --check` 通过。当前实现和本地 macOS 部署完成；真实全链通过 6 个 CLI，Hermes 上游容量及 4 个无保存选型的真实生成缺口和新协议 Windows 实机缺口继续公开保留，变更保持活动、不归档隐藏。未运行全量套件，不推送或发布 GitHub，版本仍为 v0.7.9。


## 2026-10-16：v0.7.10 排队流程 V1 与原生引导能力更新

版本归属按用户后续指令调整为 v0.7.10；以下实际验收当时使用 v0.7.9 的构建与哈希证据保持原样。

按用户给出的流程 V1 实施；用户额外明确授权沿当前保存模型/强度进行最小真实验收，并将现有项目发送方式一次性按能力更新。没有增加版本、推送或发布。

### 已落实行为

- 点击时同步登记消息 ID、发送方式、direct/running 与展示位置；统一 `submitMessage` 在第一个异步父会话查询前登记 Host reservation。忙碌覆盖受理、准备、排队、运行、优先请求和清理。直接续聊也带精确 ID；同文不同点击独立，同一次请求重复受理去重。
- 普通队列准备期间仍是卡片，原生 spawn 准入才转换一次为气泡。即时卡片插队保留同一 ID；原 queue RPC 未回执时允许显式升级到 interrupt，引用计数 reservation 防旧 RPC 释放新占用。未执行的连续插队仅最新能启动，spawn 已尝试的旧轮先确认退出。
- 主动停止切换队列代际，撤销停止前未执行提交并暂停旧队列；新一轮及新增 pending 独立执行，旧 paused 保留，迟到旧 cleanup/job.cancel 不影响新轮。Host 重启恢复内容并暂停。存在任何待发送卡片（含 paused）时须先发送/取消，才能更改模型与强度，避免改变旧消息选型；发送方式可以修改，只影响之后提交。
- 正文独立计算气泡宽度；尾部时间/复制/实际错误独立布局。移除正常发送、被后续插队取代和正常停止的文字及占位，保留未知/失败恢复。一个动作按钮按正文与清理状态切换。精确 Host 对账会解除曾丢回执的未知锁；原生投递后回执未知通过结构化 `deliveryUnknown` 保真，禁止新 ID 盲重投。
- 确认并接通 Codex、Hermes、Pi、OMP 当前运行引导，其他七项默认排队，具体原生限制及官方依据见 `doc/running-message-protocol.md`。能力按 Worker transport 核对，历史通路不偷换；policy 1 项目发送方式仅迁移一次，后续 policy 2 手动选择保留，模型/强度/账号/历史不迁移。

### 定向离线与模拟验收

- Host 最终关联 9 文件 **196/196**：其中 followup-queue 73 项；覆盖 early reservation、首 await Stop、fixed mode、稳定 ID、未 ACK queue→interrupt、清理竞争、旧 paused 与新 pending、spawnAttempted、unknown receipt 跨运行重试、权限/账号与元数据清理。Host TypeScript 检查通过。
- Client 首轮扩展 129 项通过，随后结构化 unknown 与精确对账解锁修复后 131 项通过；最终数量及浏览器渲染证据在下文追加。所有夹具明确为模拟，不代替真实 CLI。
- 原生协议关联 7 文件 **128/128**：native-guidance、primary-runners、transport、http、pi-omp-control、native-stop、native-runtime。包含真实 bridge 进程搭配模拟 native peer、独立私有邮箱，核对接收/明确拒绝/未知、重复 ID、同 chunk ACK→终态顺序、终态关闭与清理。
- 设置定向 **7/7**，证据 `.test-data/running-message-settings-final.json`：只一次迁移、未来人工选择、项目/CLI隔离、模型保留、损坏身份和 symlink/hardlink 文件不被改写。另 worker-management/cleanup-persistence/runtime-metadata-cleanup+设置合并 **68/68** 通过。
- `pnpm --config.verify-deps-before-run=false build:preview` 已通过；preview 独立生成 Host/Remote/Client 声明与包，不直接覆盖 Desktop。严格校验当前变更通过。普通根 typecheck 在新 Remote 生成前曾报旧生成声明缺少 submitMessage，preview 生成后两侧编译通过；正式构建后将再运行根 typecheck。

### 当前保存选型的真实引导验收

真实 evidence 汇总：`.test-data/native-steering/acceptance-summary.json`；只沿用保存配置，没有替换模型/强度或凭据。各运行使用独立私有 Worker/项目目录，无会话覆盖。

| CLI | 保存选型 | 实际结果与证据 |
| --- | --- | --- |
| Codex | gpt-5.6-luna / low | 同 run/原生 session、重复 ID 仅 1 user、无待发送、最终 marker 精确一致；`run-roPXXt/report.json`。用原生工具作一次有界等待后提交引导。 |
| Pi | zai-coding-cn/glm-5.3 / low | 无工具流式回复期间原生接收引导，原 run/session 保持；下一个 assistant step 精确 marker，重复 ID 仅 1 user；`run-NiECXa/corrected-report.json`。最初验收器将聚合 lastResult 误作最后一条回复，后从既有事件按最后 step 独立重建并校正，无额外模型调用。 |
| OMP | openai-codex/gpt-5.6-luna / low | 无工具流式回复期间引导通过，同 run/session、单 user、最后 assistant step 精确 marker；`run-aUrm7s/report.json`。 |
| Hermes | 原保存 Nous/Step 5 free / low | 前一协议验收已返回上游容量 429，本轮没有盲目重试或改选。原生 steer HTTP/mailbox fixture 通过；真实模型引导仍未验证。 |

Pi/OMP 最初有界 shell 等待夹具因原生不开放 shell 提前完成，不计引导通过；OMP 另一次在模型启动前元数据超时，不计通过，单独重试后取得上述成功证据。保留失败报告。结束后进程检查未发现本轮 smoke/bridge 残留。

Claude/Kimi/MiMo/Grok 没有此项目保存模型与强度，本轮没有模型调用；AGY/ZCode/OpenCode 无严格当前轮引导入口，保留排队。Windows 本轮未实机验证；此前协议迁移的历史证据和未闭合项继续保留，不据本次 macOS 验收宣称跨平台完成。


### 用户追加：引导独立于排队

- 发现前端原生引导仍复用普通提交的 admission predecessor，按用户纠正拆成 Client、Gateway、Runtime 三处独立 `steerMessage`。当前轮引导不进入 queue、不受旧 paused 或普通 queue 回执阻挡、不等待普通 stop barrier 后发送新轮；多条引导独立等待自己的原生 ACK。保留旧 Remote 兼容派发。
- 追加 Host 3 项验证旧 paused 不影响当前引导、不同 ID 在前一 ACK 未决时已到 native、授权中终轮竞争明确拒绝不建队列；与 native-stop/native-runtime 合并 **87/87** 通过。root 又追加专用 Remote 的 unknown 详情保真及 parent await 中终轮竞争 2 项；最终 followup-queue **78/78**（`.test-data/host-scheduling-final.json`）通过。
- Client 独立路径初轮 **139/139**，追加旧引导 unknown 不锁新 run 的准入/迟到回执验证后 **142/142**；最后关于旧轮恢复内容与重试禁用的断言单独复验记录在后续。保留旧 unknown 原义，只有 Host 实际新 runId 或明确 Stop 回执才标识旧轮退出，迟到 ACK 不改新消息。
- 实际普通 queue 的准备状态会早于 user 事件到达；追加时间线投影，使该轮开头用户消息排在其准备过程之前，中途引导顺序不动。时间线渲染 **20/20** 通过，不改历史事件序号。

### 浏览器与正式 Desktop 验收

- 隔离浏览器夹具明确为模拟，禁止真实 CLI/外部生成，证据 `.test-data/message-scheduling-v1/ui/acceptance.json`。核对 served Client 真实来源为 preview 并比对 hash 后，短正文宽 46px、尾部 65.76px，300px 窄栏长文/反馈不溢出；原空格空行保持。卡片逐帧淡出/缩高与相对补位、最后整区收起、inert、迟到快照不闪回、reduced-motion 均通过。首次错误引用 root bundle 的结果已拒收并保留，不冒充新代码验收。
- Desktop 无活动 Worker 时退出后正式 build 并冷启动；重启前后 Worker 均为27，抽查156个偏好/账号绑定等受保护文件 hash 均不变，旧 Codex policy1 queue 按授权变为 policy2 steer。证据 `.test-data/scheduling-desktop/{before,after-restart,build-provenance}.json`。
- 正式桌面沿已保存 AGY gemini-3.8-flash-low / low、原生 agy-stream-v1 会话，连续点击发送 A/B：A立即气泡、B立即卡片。A running 后主动停止，B为paused；明确新发 E并连续排队F：E完成精确 `E_OK`，F随后沿同session完成精确 `F_OK`，旧B一直paused且没有user/native执行事件。三次新 user 有独立精确ID，F准备期间仍卡片，实际启动才转一次气泡。证据 `.test-data/scheduling-desktop/live-queue-verification.json`，没有用父智能体自述当验收。
- 最后独立steer与菜单提示调整将再隔离构建、空闲冷启动确认；真实 CLI 协议桥未因这次入口拆分改变，保留前述 Codex/Pi/OMP 同run真实证据，不额外重复消费模型。

- Client 收尾三套件最终 **143/143**（`.test-data/client-v1-steer-separate-final.json`），最后按钮配套 Panel 单套 **118/118**（`.test-data/client-v1-panel-final.json`）。时间线随后新增 queued 开头位置回归后独立 **20/20**。均为定向最小验收，未宣称全量测试。
- 最终 preview 已成功并逐一比对 message-submissions/panel/worker-model-menu/conversation-timeline/runtime/index 六个源码文件与 preview 一致；其中包含专用 steerMessage、旧 unknown 不锁新轮、paused 模型锁定和过程排序。

- 最终 `build:preview`、空闲正式 `build` 和冷启动完成，根 `pnpm --config.verify-deps-before-run=false typecheck` 通过。最终 Host 与 preview hash 完全相同，Client 仅36行 bundler region 路径注释差异，生成 Remote 同时包含 submitMessage/steerMessage。
- 最终 Desktop 确认旧B重启后仍paused且标“Host已重启”，模型/强度按钮禁用并准确说明先发送/取消；普通F user气泡已在其过程区之前。核对后显式取消本次测试B，待发送区收起、选型按钮重新可用，无额外模型启动。实际设置只读核对 Codex 已选“引导”、AGY显示“排队/不支持引导”。全部27 Worker保留、活动0，抽查156个受保护文件hash仍一致；最终证据 `.test-data/scheduling-desktop/final-desktop-verification.json`。
- 最终严格规格校验与同步归档记录见本变更归档目录；Hermes真实容量、四个未保存选型CLI及Windows缺口继续保留在上表和此前原生协议迁移变更，不将其当作通过。没有push/publish或版本升级。

- OpenSpec已同步本次6项MODIFIED、1项ADDED到worker-conversation-interaction，保留Purpose/标题与未涉及需求；主规格严格校验12项通过、全部规格/活动变更17项通过。完整11/11任务核对后归档至`openspec/archives/stabilize-message-scheduling-and-native-steering/`，此前原生协议迁移13/14的外部验收缺口仍为active，没有归档隐藏。

## 2026-10-16：当前开发版本统一为 v0.7.10

- 用户明确将本次原生协议、排队、独立引导等未提交修改归为 v0.7.10，下一次正式提交之前继续按此版本迭代。已同步 package.json、AGENTS.md、OpenSpec 当前约束/相关变更与双语 README、协议说明及原生握手版本。
- 已发布 v0.7.9 下载地址、历史发布日志和实际构建哈希未替换为未发布版本。未提交、推送或发布；本次只调整版本及归属，不调用真实模型。
- 本次最小检查：package/当前版本规则/两处原生握手值一致性及已发布下载地址保留检查通过；关联 native-primary-runners/native-acp **59/59** 通过，严格规格校验 **16/16** 通过，`git diff --check`通过。只更新当前源码与版本归属文档，没有重建或重启 Desktop，也未重跑真实模型/全量验收。

## 2026-10-16：v0.7.10 原生回复、过程与上下文集中修复

- OpenSpec：`fix-native-message-streaming-and-inspection`。完成 11 CLI 原生消息边界与指标来源审计，见 `doc/native-inspection.md`；不改变已完成的队列代际、独立引导、保存选型、账号或 Worker transport，不增加版本号、不推送或发布。
- OpenCode/MiMo 以真实 messageID/partID 关联 delta、完整快照和最终读取，补尾并拒绝冲突。Hermes 连续增量使用稳定片段，ACP/ZCode 在明确工具边界后分段。终态 resultScope 区分本轮汇总和最后回复，修复重复前缀误删、开头空白被 trim 和不完整汇总擦除末段。公开思考继续排除签名、加密与 redacted；未知 delta 字段不写作公开文本。
- 工具真实调用 ID、明确父调用、输入、输出、命令及退出码经 Bridge 白名单、持久化 schema 和 timeline 完整保留。没有 ID 不用 step 冒充，没有父字段不从调度依赖造树。原生 TerminalBlock 与合法局部统一补丁 DiffBlock 使用真实内容；未确认 read schema 保留通用 JSON，不读取磁盘凑结果。
- 截图旧 Worker `887dadd0…` / run `d81b9c8a…`：有界只读 helper 证明一个原生 assistant message、一个 text part、22个增量与终态完全一致，恢复为 **1条42字符** 回复。root 以正确 CLI 参数独立复核，events/raw SHA256 前后不变。多 part、跨 run、未知边界、超限、链接或读取中变化均不盲合并；证据 `.test-data/native-inspection/historical-readback.json`。
- 上下文逐 CLI 核对，避免累计当占用、缓存/reasoning 重复相加及跨会话/子 Agent 污染。AGY 原生元数据增加三项估算；Codex 用 last.totalTokens；Claude 只消费主请求且可选 summary；Kimi/Grok 接实际 ACP usage_update；ZCode 接原生压缩后 projection 和主请求/本轮分桶；Pi/OMP 接可选 session stats。OpenCode 用 input+cache.read+cache.write，MiMo 0.1.15 独立原生口径为 input+cache.read，不套同一公式。Hermes Runs API 未提供窗口，继续未知。
- 真实既有元数据只读核对：OpenCode 本轮总用量 6027、当前占用5943；旧 raw 没有容量，菜单显示约5.9K/未知并说明缺失。AGY 当前29704/256000，原生三项14769/12950/1985，分类总数一致且标估算。没有借用父会话或其他 Worker 的容量/分类。
- 过程使用公开原生 DisclosureRow、Markdown、状态及结果 primitives，跟随只读 ui-chat 四种工作详情模式，保持思考/工具/正文的真实顺序。核对原生组投影后保留 reasoning 的父分组，仅将外层标题精确改为“已完成分析/正在分析请求”，内层为“思考”。完整内部组件未导出，不深导入或伪造 session。菜单沿原生264px/padding12/12px字/4px条及三项颜色，未知不填0/假比例。
- 关联回归分组记录，不将重跑或重叠项目相加：native 主回归6文件 **227/227**，后续 HTTP 多消息64/64、公开字段筛选3/3、Pi/OMP stats拒绝/超时4/4及字符流2/2；Host7文件 **181/181**，MiMo独立公式后两文件50/50；Client最终三文件 **162/162**，减少动态效果最小回归22/22；额外队列/引导/停止关联5文件 **104/104**。`pnpm typecheck`与隔离preview、正式build均通过。初次受限环境的合成本机监听报EPERM，已在允许回环监听的验收环境重跑；不把它记作模型失败或测试通过。
- 隔离浏览器为明确模拟，原生CLI/模型/外部请求均为0。实际查看 Markdown、惰性HTML、24px行、22px子调用缩进、Terminal/Diff、四模式、264px菜单与300px窄栏；Escape/外点关闭通过。实测发现减少动态效果 selector 特异性不足，修后新served bundle复验header/group均0s；报告 `.test-data/native-inspection-0710/ui/acceptance.json`。最后仅reasoning分组标题文案另有162项回归及正式Desktop核对；未把旧浏览器hash说成新文案的渲染来源。
- 沿授权保存选型，各仅 **1次**真实模型调用，无重试：OpenCode `run-4vuKqf` 21增量→1条、write调用ID/input/output与真实JSON产物匹配、当前6182/1000000、累计12378；Pi `run-dT7twb` 20增量→1条、真实write/产物、原生context2083/1000000与累计4135；OMP `run-cpRuRD` 15增量→1条、真实write/产物、原生context9464/272000与累计18921。三个原生scope结束；OMP实采24个所属PID全部退出；Pi完成及无范围残留，但未抓到运行中子PID，保留该采样限制。证据均为 `.test-data/native-smoke/<run>/report.json` 及对应 verification。
- Claude 2.1.287 实际 **0 prompt** initialize→get_context_usage(summary)成功，返回numeric total/max及System prompt/System tools/Skills等原生分类；未请求full计数、未发送user/生成。零prompt进程未自行退出，结束时SIGKILL后close，未记为正常任务退出；证据 `.test-data/native-inspection/claude-zero-prompt/report.json`。Claude/Kimi/MiMo/Grok仍无保存选型，不猜模型做生成；Hermes原保存免费模型此前429，本轮不盲重试。Windows实机和全量发布验收本轮未执行，历史原生迁移变更13/14继续保留。
- 正式 Desktop 更新前28个Worker、0活动；隔离preview先验后正式build并冷启动。重开截图OpenCode Worker，实见单条完整回复、原生“已完成分析→思考”展开/Markdown、旧日志约5.9K/容量未知菜单及三项未知值；没有原有灰卡/COMPLETED标签。最后Client预览hash `b12f8430…`，正式 `fae9c021…`，两者仅构建region路径注释不同，去该注释字节完全一致；Host `5285983e…` 和native bridge `69d578d6…` 与真实验收相同。最终28Worker/0活动，4717份既有状态文件中4711份未变；6份变化为已授权OpenCode/OMP自身CLI日志及OMP派生运行目录的模型数据库/SQLite sidecar，用户events/raw/Worker/选型/绑定/发送设置均未变。证据 `.test-data/native-inspection-desktop/final-verification.json`，没有新增正式会话或重发用户消息。
- 本变更11/11完成后同步3个能力域：新增上下文检查4项、回复结果新增2项、公开过程修改1项，保留既有Purpose和未涉及需求。主规格严格13/13、全部严格17/17通过，归档至 `openspec/archives/fix-native-message-streaming-and-inspection/`。原生迁移及其他活动变更的外部验收缺口仍保持原状态，未用归档隐藏；没有全量测试、GitHub提交、推送或发布。


## v0.8.1 原生会话迁移：备份（2026-10-16）

- 用户明确将本次迁移版本改为 v0.8.1；此前 v0.7.10 源码、未提交文件和 lib 在项目旁私有备份。
- 路径：`../cliworker-now-backups/v0.7.10-before-v0.8.1-20261016-145635/`。归档共1440条，逐文件SHA-256及符号链接逐项验证通过；归档100423142字节，SHA-256 `b658dbad9f3b366ec818215161fad1f15fb362c054ae01d38506f581ca5d9e0e`。
- manifest记录Git HEAD、未提交状态、已删除路径；RESTORE说明优先解压至新目录，不覆盖会话与凭据。备份排除node_modules、Git忽略的个人运行数据及本次新OpenSpec骨架。此备份不代表迁移功能验收。

## v0.8.1 原生子会话预览交付（2026-10-16）

### 实现与明确边界

- 使用真实 continuable 子 Agent、独立 Harness Session ID 和官方 `conversation.content`；`origin: subagent` 关联主对话，普通会话列表不新增根条目。实际 CLI Agent、选型、账号、原生会话和任务协议不更换。较早历史保留原 WorkerStorage，通过只读旧历史读取，不批量覆写。
- 首轮只挂接已准入运行；旧 Worker 入口的新轮、普通队列及已确认的引导消息都仅投影，不再次 launch。官方 JSONL 冷恢复、工具声明/结果生命周期、同 RPC 身份去重、队首 spawn 前等待真实 user、旧投影 Stop 不误停新 run 均有对应回归。真实 Host constructor / WorkerRuntime / 官方 AgentLoop 的纵向夹具证明清理 gate 未完成前不报完成；首轮建立同步 Stop 没有死锁或多余 spawn。
- 完整宿主核验暴露 rc.2 原生发送的 detached 连发丢稿窗口，且无公开提交前 admission / 可替换 sink。本次 `send=false`，Host 拒绝普通原生输入；公开 `conversation.composer` chain 只接管当前子会话的普通输入，保留官方审批/提问。Worker 原有输入框是唯一发送入口，保留原子预占、排队、独立引导及停止清理，不 monkeypatch 核心。
- 原生命令通过真实 child scope 的公开 commands 注册拒绝；两层指令 popup 用公开 child controller 关闭，草稿不消费，主对话不受影响。不可用模型/权限/附件/分支/上下文控制有具体说明；没有真实 CLI 数据时不显示 DSH 的估算为 CLI 占用。
- 工具桥仅回环、run 级随机私有连接，经真实 `tools.execute` 权限链；规划时 child 为只读，一般工具目录为空，仅有界技能读取。生产普通工具正向集合为 read/write/edit/bash，派遣、未知第三方及 DSH 通用 MCP 转发不开放；CLI 自己的 MCP 和工具保留。text/isError 忠实投影，图像/其他内容明确尚未接通，回执不明不自动重试。逐 CLI 支持见 `native-harness-tools.md`。
- 运行参数、request.json、账号快照和公开 DTO 不携带桥令牌；三个新 mjs helper 在 bundle 根与声明输出目录齐备。公开技能 list/get 的真实 rc.2 API、Pi 1.0.4 真实 extension loader 均零模型核过。OMP 16.4.4 隔离启动忽略显式 extension，保持不可用；Hermes/AGY 保留原因，ACP/ZCode 的工具执行未准入。

### 最小自动与渲染验收

- 最终关联回归 **27 个不重复文件、578/578**：tools/runtime 5 文件40、conversation 7文件166、popup 1文件3、scheduling 14文件369。JSON 位于 `.test-data/native-conversation-081/{tools-runtime-regression,conversation-regression,popup-regression,scheduling-regression,regression-summary}.json`；不把代理重复回归累加。最初缺构造字段的旧测试夹具已补齐；一次受限沙箱的 Pi/OMP 模拟服务器监听等待已停止、补 error listener，在允许回环监听环境重跑通过，不算模型失败。
- `pnpm --config.verify-deps-before-run=false typecheck` 与 `build:preview` 通过；最终186个 src 文件与隔离副本逐字节一致。Host `0d9df7b4266b21b2f5ff88e4372abf82cfe16709f9490dcc6601c22790552dad`，Client `19473896c6ac09f157104592c3205fcd35f9e19999882f0d6c888fb6d0c3d07f`。Gateway生成声明含 ensure 入口，helper 齐备。记录 `build-verification.json`。
- Tabbit 使用完整真实 Harness UI / SessionReference / 子 Agent 与明确标注的模拟 Worker 数据。最终第四 preview 核对实际 served 路径及以上 Client hash后，正文/Markdown/公开思考/Read 输入输出、1用户+1回复、无内部 continuation/sentinel 外漏、native editor 0 / Worker textarea 1、草稿保空格且清除不发送、只读旧历史无 form、主对话未变、普通列表仅父会话均通过。证据 `.test-data/native-conversation-081/fourth-ui/`；截图 `native-process-and-sole-input.png`、`legacy-history-readonly.png`。模拟不等同于 Desktop 或真实模型验收，自有服务均已退出。
- UI夹具在 parent.followup 方法入口直接抛错，因此记录的1次函数 attempt 发生在 inbox / pre-step 保护之前，不能当作生产模型调用失败。新鲜 profile 复核保留该边界：非CLI stream / 实际生成0，另1次后台 subprocess attempt 被入口阻止但缺 argv/stack、来源不确证。真实官方 AgentLoop 回归保留 parent 方法，验证 owned settled/drain/dispose 不触发父 llm/stream；正常 parent human 和非 owned 子通知仍各触发一次模拟 stream。没有用 monkeypatch 抹掉报告。

### 已授权真实 CLI 验收

- 全部使用默认工作区已有精确保存选型，私有新 workspace/Worker/runtime，不保存新偏好，不猜模型或更换强度。本迁移合计6轮：OpenCode早期1轮工具未注入的失败证据保留，修漏传后3轮；Codex/Pi各1轮。未执行额外模型重试或全 CLI 发布验收。
- OpenCode `zhipuai-coding-plan/glm-5.3-flash / low`：`opencode-tools-run-F8wzq6/report.json` 首轮真实只读 canary 成功，Host 工具与真实 tools/pre-execute 各1次、回复精确、原生工具 COMPLETED。另两轮同一 Worker/native session/Harness child：短标记续聊成功；工具收到请求后取消，Host signal abort、Stop/done interrupted、lease端口关闭、4个 owned ranges全部退出，取消原生 exit143。早期 `gA8Sp8` 为配置漏传造成 calls0，不计工具通过。
- 以上续聊阶段第三 preview 曾出现1次 subagent-settled 唤醒父 provider 尝试，被测试护栏阻断，真实 DSH API=0。原 `continuation-report.json` 的 passed=false 不改写。修复后第四 preview 的精确 owned 通知与空唤醒保护通过真实宿主零模型回归；模型 runner / MCP helper 没变，没有为 UI/通知修复再追加模型调用。不混称为同一最终包的全链真实模型验收。
- Codex `gpt-5.6-luna / low`：`codex-tools-run-PWpkRB/report.json`，Pi `zai-coding-cn/glm-5.3 / low`：`pi-tools-run-OxJqGt/report.json`，各一次真实 canary，Host execute/policy各1、精确正文、真实原生工具完成、fallback/API0、lease关闭。Codex2个、Pi5个 managed handles均exit0/signal null/范围空。证据固定第三 preview Host `5dd7f0a6…` 及每个 runner/helper SHA，不能替代最终第四 preview 的 UI 验收。
- Claude/Kimi/MiMo/Grok 未具备本项目保存选型；本轮没有生成。Hermes此前免费模型429不盲重试，OMP/Hermes/AGY工具桥不可用，ZCode/ACP额外工具权限未准入；这些不伪记真实工具通过。Windows实机、全部CLI/订阅及全量发布验收未执行。

### 交付与保留事项

- 用户明确选择保留正式 DSH 的另一个工作流插件安装窗口，仅交付预览。不执行正式 build/重启/安装，不更改该窗口。正式 `lib/index.js` 与 v0.7.10 备份内同文件SHA一致，证明没有热更新正式Host。
- 本地预览包 `artifacts/dsh-cliworker-now-0.8.1-preview.tgz`：16818393字节、465文件、SHA-256 `dca31757907b1b415ba58fb52c58a44f8766b0fc9233feb3f24e1ff6a869c1df`。在隔离包通过 `pnpm --config.verify-deps-before-run=false --config.ignore-scripts=true pack --out <path> --json` 生成；关键入口和helper与preview内容一致，不含账号、运行日志、测试目录或node_modules。附校验文件、verification和预览说明。
- `spec:check` 严格18/18、差异检查通过；已有release-v078变更的重复header提示属于旧变更信息，本次未处理或隐藏。新 change **13/14**，正式Desktop更新4.3按用户选择保留未完成，不归档隐藏。此前其他活动变更和未验收平台保持原状。没有Git提交、推送、发布或Mem写入。

## 2026-10-16：接手纠偏——完整原生子会话、真实 Inbox 与 DSH 工具目录

用户要求复用完整 DSH 对话界面和交互，保留 CLI Agent/模型，通过原生直接子 Agent 绑定主对话并从普通会话列表隐藏。本节覆盖此前“只嵌消息区”、内部 InputBar/QueueDock 适配以及 `send=false` 的交付结论；较早测试保留为历史，不能据此认定本轮通过。

### 当时实现（被下节侧栏纠偏替代）

- 对话入口改用公开 `uiWorkspace.openSession(SubagentAddress)`，目标是 Host 返回的 `parentSessionId + childSessionId + continuable`；原生主 frame 拥有标题、视图、正文、过程、输入、队列与停止。Worker 面板保留管理与只读旧历史，不再承载第二套输入/队列或 `conversation.content` 嵌入后备。
- Host 从真实 Inbox 接收输入；原生 next-step 在完整 CLI run 结束且清理完成后进入同一 CLI 会话，不宣称 CLI 运行中即时注入。原生编辑、删除、停止的执行入口保留；`nativeSubmissionId` 阻止 preparation 再次投影并启动同一输入。
- 逐条持久化 `requestId/promptHash/batchId/accepted`：先记意图，收到运行回执后记受理；冷恢复以 Worker 批次持久回执消解中间状态。批次拆分重试不重复执行，回执未知保留消息；写盘失败后停止并排空。任务已受理而 job 绑定保存失败时同样取消并等待清理，不能留无回执的运行。
- 工具桥读取子 Agent 实际可见 schemas，支持已注册 DSH MCP 工具，经 `tools.execute` 执行；每次 list/call/回执重放和技能依赖读取重核目录。权限撤回、原生 pre-execute、取消、精确请求去重与 DSH 模型回退防护保持有效。规划模式继承真实只读 scope，不以静态空目录代替权限链。

### 本轮已执行验收

- Host：`vitest run tests/harness-conversation-inbox.test.ts tests/harness-conversation.test.ts tests/harness-conversation-official.test.ts tests/harness-conversation-stream.test.ts tests/harness-conversation-store.test.ts tests/harness-service-integration.test.ts --exclude '**/*.tsx'`，**6 文件 / 47 项通过**。包含真实 DSH AgentLoop/Session/Inbox 的 FIFO、编辑/删除、next-step、停止、重复消息推进、批次冷恢复和故障注入；CLI 进程/模型为明确标注的模拟。
- 工具桥：`vitest run tests/native-harness-tools.test.ts tests/native-harness-extended.test.ts tests/harness-model-guard.test.ts`，**3 文件 / 32 项通过**；使用真实 ToolRuntime/MCP adapter 加模拟 transport，未连接真实外部 MCP 服务、未调用模型。
- 上述 JSON 证据为 `.test-data/native-conversation-081/correction-{host,tools}-tests.json`。本轮不执行全量发布验收，不推送或发布，版本仍为 v0.8.1。
- 初次浏览器夹具发现 Host 加载 preview 而 Client 解析到正式旧 lib，故 `native-session-ui/` 的画面不计本轮通过。后续 `native-frame-ui/` 显式链接 preview，并要求实际 served Client SHA 与 preview 一致后才进行验收。

## 2026-10-16：v0.8.1 侧栏与完整原生交互纠偏

### 当前实现

- 按最新截图恢复 CLI Worker 原有返回、Worker 名称/标题和任务操作；删除侧栏额外的原生主页面包头、父会话面包屑、对话/轨迹页签及页头按钮。子对话始终在右侧栏，父对话保持原位，普通会话列表不新增 Worker 根条目。此要求覆盖前节全页导航及完整原生 Header 的历史方案。
- 正文、过程、输入、队列、菜单和输入下方统计直接使用 DSH 公开注册的原生组件。通过公开 `conversation.content` 的 embedded 变体与固定 chat 视图接入真实子 Session；不深导入内部 InputBar/QueueDock，不另造输入框或统计弹层，不用插件样式覆盖原生组件。
- 原生模型/强度和权限入口读取实际 CLI 目录、支持模式及持久化选型。运行中、原生/兼容待发队列（包括暂停项）、账号记录缺失时保留精确锁定原因；迟到快照不能覆盖新保存的选择。原生 `+` 与 `/model`、`/permission`、`/plan` 接同一公开指令控制器，打开/关闭和焦点沿用原生行为。
- 运行统计、Token/缓存、上下文均复用原生组件及详情菜单，仅映射该 Worker 的真实遥测。缺失容量、分类或用量时遵循原生隐藏规则，不借父会话或其他 Worker 数据补齐。Codex/Hermes/Pi/OMP 已确认通路的 next-step 接真实运行中引导，持久化请求身份和实际受理回执；拒绝、未知回执、重复消息和取消不自动改成下一轮执行或重启。
- DSH skill、MCP 和工具桥沿用上节真实子 Agent 授权目录与 `tools.execute` 权限链；实际 CLI Agent、模型、账号及会话协议保留。未接通的附件、分支及特定 CLI 工具能力仍给出原生禁用说明，不宣称全部 CLI 能力齐全。

### 本轮验收与证据

- 关联回归最终主组 **22 文件 / 322 项**通过，另原生注册结构 **1 文件 / 1 项**通过；最后原生 `+` 展开状态修复的指令与统计 **32 项复验**通过，该 32 项包含在主组范围内，不重复相加。证据 `.test-data/native-conversation-081/sidebar-correction/{related-tests,slot-mirror-tests}.json` 和 `correction-native-launcher-scope-tests.json`。
- `pnpm typecheck`、`pnpm build:preview` 和空闲检查后的正式 `pnpm build` 通过。预览与正式 Host 完全一致，Client 仅构建源路径 region 注释不同，去注释后一致；SHA 证据保留在 `sidebar-correction/build-verification.json`。更新前正式 Worker 活动数为 0，正式 lib 已备份至 `desktop-before-sidebar/`；版本仍为 v0.8.1。
- 隔离浏览器使用真实 DSH AgentLoop/Session/Inbox 和原生 UI，CLI 执行、模型、外部请求为明确模拟。实际验证原生 Enter 发送、连续排队、编辑/移除、next-step、停止及清理、权限/模型/强度保存、`+` 开关、斜杠指令、三项统计及详情、420px 侧栏无水平溢出、父主页面保持原位、最新顶栏无多余页头/页签；最终无浏览器脚本错误。三项统计采用显式模拟遥测，不作为真实 CLI 的指标证据。记录 `sidebar-correction/browser-verification.json`，截图 `sidebar-correction/sidebar-top-final.png`。
- 正式 Desktop 已冷启动核对：原 Worker 顶栏和右侧栏正确；账号记录完整的 Antigravity 历史 Worker 可打开原生模型目录与规划/编辑权限菜单，未修改其保存选型、未发送任务。原截图的历史 OpenCode Worker 真实用量 5984 Token 已使用原生用量入口呈现；普通根会话列表仍只有父会话。记录 `sidebar-correction/desktop-verification.json`。
- 最后追加冷历史权限修复：已结束子 Agent 未驻留时，以公开 Session writer/Store/Query 同步真实 `plan/mode` 和 sandbox 投影，全程持有 Worker 准备票据与原生写锁，flush/close 后释放 Session，不恢复 Agent、不生成输入。真实日志存在未结束轮次、待发输入或未完成计划命令时明确拒绝；读取期间绑定或父授权变化亦拒绝。Worker 保存失败不写计划；原生 flush 失败明确返回错误，保留已保存 Worker 值并释放资源，不伪称跨存储原子提交。
- 冷权限关联回归 **24/24**，另引导与真实 Inbox 关联 **28/28** 复验通过；与上面主组存在重叠，不累加成独立总数。根 typecheck、最终 Host 类型检查及重新 preview 通过，最终 Host 源码哈希 `658d5368…` 与隔离副本一致。浏览器在无驻留 Agent 的历史 Worker 实测原生提示切到“描述你的任务以生成计划”，退出后恢复默认；`+` 原生开关再次通过，没有新输入、Agent/CLI/模型启动。证据 `sidebar-correction/{cold-plan-tests,cold-admission-tests,cold-plan-browser-verification}.json`；随后空闲正式重建，最终包哈希见 build-verification.json。
- 最终正式包再次冷启动，实见原 Worker 顶栏、子会话侧栏及可打开的原生模型/权限菜单；未修改真实选型或发出新任务。28 个 Worker、活动 0；本次前后 208 个受保护文件中 207 个哈希未变，仅打开的 AGY Worker 记录变化，其全部原执行字段与此前完整快照一致，差异仅原生会话绑定元数据。events/raw、账号绑定、偏好、待发记录均未变。最终 `spec:check` 严格 **18/18** 和差异检查通过，隔离服务与浏览器任务已清理。

### 保留边界

- 原截图 `opencode-hello` 历史任务缺少账号绑定，按原逻辑禁止续聊及修改选型；没有猜测账号或重绑。该历史 raw 没有当前上下文占用/容量，原生 ContextMeter 因缺失数据隐藏。此前将截图 AGY 的缺组件判断为“历史记录缺遥测”不准确，后续查到真实用量与上下文数据，见下节；不得继续据此声称该截图已验收。
- 本轮纠偏未新增真实 CLI/模型调用，真实外部 MCP、Windows 实机、全部 CLI/订阅和全量发布验收未重跑。前节真实协议/工具调用记录保留其原包哈希和限制，不能冒称最终包全链路真实验收。没有 GitHub 提交、推送、发布或版本升级。

## 2026-10-16：AGY 真实统计与原生权限外观再纠偏（已完成本截图验收）

- 用户新截图指出 AGY Worker 仍缺 Token/缓存及上下文组件，权限按钮没有原生图标。撤回上一阶段针对这两项的完成判断，不能用模拟数据正常显示代替真实 Worker 验收。
- 权限入口使用的是实际原生 PermissionSelect，但此前传入 CLI `plan/accept-edits`，原生组件按自定义 preset 处理而不绘制内置图标。应仅映射原生 `read-only/workspace-write` 值，保存反向映射 CLI 模式，让原生组件负责图标、布局和菜单。
- 精确 AGY 会话 `ea4876c2-5218-4908-9bf1-eb972bff7b9f` 的历史读取已发现本轮用量：未缓存输入 44403、输出 23、缓存读取 19296；其 CLI reported total 44426 不含缓存，不能当成原生四桶总量或把缓存再从 input 扣除。原生上下文元数据为 29704/256000，分类 14769/12950/1985；这些定位阶段的独立读取没有被算作通过，最终正式 Desktop 验收见下节。


### 最终修复和真实验收

- 直接复用原生 PermissionSelect，CLI 模式与原生 preset 双向映射后，原生图标、按钮、菜单及窄栏布局恢复；公开父会话权限/规划投影变化会使旧可写回执立即失效，重新询问 Host 并取消旧读/保存。普通父对话不受影响，未新增全权限选项。
- AGY 用量修复后的原生明细为总量 **63,722 Token**、未缓存输入 **44,403**、缓存读取 **19,296**、输出 **23**，缓存命中 **30%**。CLI reported total **44,426** 不含缓存；原生总量按独立桶汇总，两者口径分别保留。
- 实际 Desktop 读取诊断确认上下文已解码，却因只读 SQLite 连接更新 SHM 时间戳而被一致性检查丢弃。现仅排除 SHM 的 mtime，仍校验身份/大小/链接及 main/WAL 完整戳。真实合成冷 WAL 的旧版失败、新版通过；读取期间 main/WAL 真正变动仍拒绝。另保留跨 realm 字节数组健壮性修复，但其不是这台 Desktop 的实际根因。
- 最终无诊断正式包在 **28 个 Worker、活动 0** 时构建并冷启动；精确原截图 `agy-1` 真实侧栏显示 **1 轮 1 步 / 63.7K tok · 缓存命中 30% / 上下文 12%**。点击原生上下文弹层显示 **~29.7K / 256K**，分类 **系统提示词~14.8K、工具定义~13K、对话消息~2K**；原生 Token 弹层与权限菜单均已实际打开。原 Worker 顶栏、父对话主页面和普通会话列表保持原要求；未发送新任务或改变真实选型。
- 定向回归 **7 文件 / 97 项通过**：权限/目录/指令/注册 **47**，原生统计映射 **17**，AGY 上下文与用量 **33**。根 `pnpm typecheck`、最终 `pnpm build:preview` 和 `pnpm build` 均通过。一次中间正式构建碰到并行编辑中的 Client 类型未就绪而失败，已先恢复完整已通过 preview，再在源码冻结后重新构建通过；该中间失败未计作成功。
- 隔离浏览器复核真实原生权限图标与主对话 SVG 一致、可用状态以及三项模拟统计；它只证明组件装配。真实数值的完成依据为上面的最终 Desktop。临时诊断已全部从源码和包移除；浏览器任务正常 finish，独立模拟服务按精确 PID 清理。
- 证据目录：`.test-data/native-conversation-081/agy-statistics-correction/`，含定向测试 JSON、SQLite 新旧复现、真实 Desktop 诊断和最终组件/弹层记录、类型检查、最终包哈希及状态完整性检查。Windows、最终包真实模型与外部 MCP 全链路未重跑，活动 OpenSpec 第 7 节仍保留；没有推送、发布或版本升级。

最终状态完整性复核：28 个 Worker、活动 0，208 个受保护文件哈希全部未变；本次未改变真实 Worker 的账号、偏好、任务记录或会话执行数据。最终 OpenSpec 严格校验 18/18 与 diff 检查通过；模拟服务 wrapper/child PID 均已退出。

## 2026-10-16：v0.8.1 完整原生侧栏与授权宿主扩展（自动验收阶段）

### 本轮实现与范围

- 用户进一步明确要求把整个 DSH 原生对话放入 CLI Worker 侧栏，不能逐组件拼装。现直接注册官方 `sidebar.chat.conversation` 的原 entry，保留其组件、注入、store 和 locale，由真实子 SessionProvider 提供标准会话数据；原生侧栏自身管理阶段、完整 content factory、正文、过程、输入、队列和统计。原 Worker 顶部与父对话位置保持原要求。本节替代此前通过统计 leaf wrapper、slot mirror 和菜单 launcher wrapper 装配的实现说明；前节 Desktop 截图属于当时包的历史验收，不能替代本轮验收。
- 用户已明确授权必要的宿主扩展。基于官方 `dsh-v0.2.0-rc.2` 增加 `uiSession.provideProjections(reference, sources)`，按真实 SessionReference 的 binding 代际提供 `tokenUsage`、`contextPressure`、`contextBreakdown` 三个标准 observable；原生组件仍使用自己的 projection、布局、弹层和交互。插件统计管理器不再包装 bar/dock 或自造 `useProjection`，旧 slot mirror 与菜单 launcher 模块已删除。
- 统计来源逐次核对 parent、child、Worker 和 continuable 绑定；同一 binding 代际多处使用共享一次 Gateway watch，并引用计数释放。断连、错误回执或归属变化将来源置为未知，保留对原生估算的覆盖直到引用释放，避免回退到 DSH 文本估算或其他会话统计；换代、关闭和卸载清理订阅。缺少扩展接口明确报错，不用零值或假数据维持显示。
- 宿主原生侧栏新增可选 `composerPresentation: 'main'` 和 `commandSource` 透传，插件只传实际 CLI 指令来源。输入框、原生 `+` 菜单控制器及键盘流程继续由原生组件负责，不修改子会话身份、Inbox、权限或默认父会话行为。
- Host 在 run 切换前和结束时保存已验证的同一 CLI conversation 累计回执，新 run 尚无新统计时保留该回执；新累计值替换旧值，不把历史 run 求和。会话/CLI 身份变化不沿用，未声明 session scope 的用量不提升为累计。AGY 历史 raw 的 envelope/result/step 身份纳入核对，错误 conversation 的 result 即使先落盘也不能被保存为当前会话用量；合法失败回执仍可保留可信用量。单次模型响应的 usage、响应分组及工具回执采用各自真实身份，不从会话累计值猜分配，也不重新执行已观察的 CLI 工具。

### 已核查的自动验收

以下为分组结果，组间存在重叠或重跑，不相加为独立测试总数。JSON 均在 `.test-data/native-conversation-081/native-whole-sidebar/`。

| 范围 | 实际结果 | 证据文件 |
| --- | --- | --- |
| 宿主扩展的原生 ui-session、InputBar、skeleton、注入及子侧栏 | 5 文件，196/196 通过 | `host-extension-ui-tests.json` |
| 插件原生侧栏、统计来源、会话及相关协议定向回归 | 11 文件，139/139 通过 | `regression-tests.json` |
| 最终 Client 注册和原生会话集成 | 2 文件，29/29 通过 | `final-integration-tests.json` |
| CLI 设置与 native transport 旧契约断言修正 | 2 文件，40/40 通过 | `correction-stale-contract-tests.json` |

- 196 项在隔离官方源码目录运行，使用真实原生组件及模拟数据，不调用真实模型。原报告为 `/tmp/dsh-host-extension-ui-tests.json`，已复制到上表证据目录。插件 Host/Client 类型检查和最终隔离 preview 构建通过，日志为同目录 `typecheck-final.log`、`preview-final.log`；此处不表示正式 Desktop 包已更新。
- 宿主扩展隔离构建证据为 `.test-data/native-conversation-081/host-extension-build-verification.json`：上游 commit `639ed015397290b3745d163aafe02ffee4aa3f84`，补丁 SHA-256 `42c53fa63c5128c4b82ebf42743b82297b9f8c6655b318730b6dcc12fa8e3259`。三个 UI 包使用官方 preset 构建，105 个产物文件核查通过；独立输出的 Client 与 sourcemap 一致，补丁反向检查通过，已安装基线哈希未改变。扩展完整声明文件尚未重新生成，产物继承官方 rc.2 声明，插件使用局部兼容接口；不把此结果写作新机器完整安装验收。
- 一次 `pnpm test -- <files>` 未实现预期筛选，意外运行全量：146 文件中 7 失败、138 通过、1 跳过；2999 项中 156 失败、2835 通过、8 跳过，进程失败。日志为 `regression.log`。失败包含受限环境的回环监听 `EPERM`、`/bin/ps EPERM`，以及两处确实陈旧的断言：仍期待 Codex 引导不支持、native result 精确匹配遗漏 `resultScope: 'run'`。两处按当前真实协议修正后定向 40/40 通过；环境失败没有在本轮重新完成全量验证，不能声明全量通过。

### 待完成验收与保留边界

- 本节落笔时，最终隔离浏览器交互验收仍在进行，正式 Desktop 安装与冷启动尚未执行。`.test-data/native-conversation-081/native-whole-sidebar-final/` 的进行中材料不能提前算作通过；后续按实际 served 包、交互和安装证据追加结果。
- 本轮没有新增真实 CLI/模型调用，没有 Windows 实机或新机器复现，也没有重跑全部 CLI/订阅及外部 MCP 全链路。保留较早真实调用的包哈希及适用范围，不移用为本轮宿主扩展的端到端验收。
- 版本仍为 v0.8.1；未因本轮修改推送、发布或升级版本，未用自动测试通过提前勾选浏览器、安装及外部平台验收项。

### 安装前浏览器验收补记

- 最终隔离浏览器已完成验收。`native-whole-sidebar-final/served-bundles-verified.json` 同时核对真实服务路径和 SHA-256：插件来自 `.cache/preview-package`，三个原生 UI 包来自 `artifacts/dsh-host-extension-rc2`。不存在仓库旧 `lib` 或 npm 原版客户端误代测试包的情况。
- 原父管理页、Worker 返回/名称/操作栏和主对话位置保持；子会话继续绑定同一父会话，根会话列表只显示主会话。返回管理页再打开时原生草稿保留，模型/权限修改只作用于模拟 Worker。
- 原生过程标题可展开，再展开原生“已完成分析”后显示明确标注的模拟公开过程。原生消息尾显示每轮 `2.6K tok`，详情按未缓存输入 2000、缓存读取 500、输出 100 核对。真实 CLI 未公开的过程及旧消息缺失的单次 usage 不回填。
- 运行中空输入仅有原生“停止生成”；输入草稿后主按钮变为“排队发送”，没有旁设第二个停止按钮。累计 `14K tok / 缓存命中 62%` 和上下文 `25%` 在运行期间保持；完成后为 `16.6K tok / 55%`。下一轮主动停止后保持已确认累计值，原生模型和权限恢复可选。
- 验收原生模型/强度选择、权限及规划切换、原生指令候选与 `/model` 选项、队列创建和移除、启动前取消、CLI 已启动后的停止。私有绑定检查确认 child/parent 不变，原生 Inbox 最终无待发消息；模拟停止事件存在。没有启动真实 CLI 或调用真实模型。
- 证据：同目录 `browser-acceptance.json`、`browser-receipts.json` 及对应成功回执、`running.png`、`completed.png`。浏览器任务正常结束，隔离服务已关闭。一次 `/model` 检查预期为菜单而实际为原生 listbox，读取实际状态后正确选择并验证；这是验收定位器修正，不是产品失败。
- 原生用量详情中的提供方/模型仍来自执行路由，可能显示 `cliworker-native/worker/<id>`；rc.2 无独立响应来源接口，本次不改写路由或臆测上游提供方。附件、分支及各 CLI 未验证能力继续保留真实禁用说明。
- Desktop 仍待空闲安装；用户已授权与「介绍项目亮点」任务协调共享宿主的安装顺序。已生成只读 `desktop-install-plan.json`，包含精确配置行、候选哈希、私有备份及回滚要求；未因预览通过提前声明 Desktop 通过。
- 构建交付补充隔离依赖目录的独立 `pnpm-workspace.yaml`，避免新机器按说明安装时进入根工作区；构建脚本同时核对持久 package、lock 和 workspace 输入。重建后 106 个产物文件通过校验，三个 Client 与三个 sourcemap 哈希仍与已验收浏览器包完全一致；仅增加可复现构建输入和说明，未改生产源码或根锁文件。证据为 `native-whole-sidebar-final/build-workspace-verification.json`，最终 manifest 为 `c2197c5d0cd4bade6256693cbef85e4ce07eb2c285e1b99476e573cc5970bba8`。

### 正式 Desktop 安装与只读验收补记

- 经用户授权协调，待「介绍项目亮点」报告桌面操作结束后接手；确认 28 个 Worker 无活动任务，正常退出 DSH 并确认旧进程已退出。保存私有原 profile/旧 lib 备份，488 个旧 lib 文件逐一校验。运行正式 `pnpm --config.verify-deps-before-run=false build` 成功，再以 CAS 核对原 profile 哈希并追加三个原条目的 disabled 操作及三个独立扩展 ID；原 8 条配置逐项保持，应用安装包、账号和会话格式不修改。
- 正式包与 preview 均为 491 个文件：488 个逐字节一致；Client 仅 18 个 region 注释路径差异，严格限定归一化后执行代码全文件一致；map 除 18 个解析到同一源文件的路径外其余字段相同。tsbuildinfo 的相对路径和内部引用索引排序不同，展开后的 499 项引用关系相同。不把两包表述为逐字节一致。正式 Client SHA-256 为 `841d6077d7a3bd36a85ff2435be53cf4c6bca0913fa23467dff9b2c5390fafbb`，Host 与 preview 同为 `e825797150a27545f9ecab55c378a3aa668b37029d2e74f96dc81299b266e22b`；完整证据为 `formal-build-equivalence.json`。
- 冷启动新 Desktop 进程后，通过实际桌面界面打开原父管理页的 `agy-1`，保持 Worker ID、父会话和 child 绑定不变。原 Worker 返回/标题/任务栏保留；原生模型菜单展示 Antigravity 的实际目录，权限菜单可打开规划/允许编辑；未修改保存模型或权限，未输入或发送新消息。
- 真实原生统计显示 `3 轮 4 步`、`132K tok / 缓存命中 46%`、上下文 `12%`。用量详情为 131,774 = 71,389 未缓存输入 + 60,018 缓存读取 + 367 输出；上下文详情约 31.1K/256K，并显示系统、工具和消息分类。父对话仍为 GLM-5.3-Flash Low、260K/71%/2%，没有借用子会话数据。返回父管理、重新打开、根列表隐藏均核对；工作流插件继续启用，原有两个工作流仍可见。
- Desktop 冷启动、profile 路径和磁盘候选哈希及真实界面已核验；本轮未通过运行时调试接口直接提取 Desktop 的 `clientModules.clientPath`。精确 served 路径/哈希的直接检查在隔离浏览器完成，不将两种证据混称。
- 225 个 Worker 持久数据文件最终与安装前全部哈希一致，没有新增文件、运行或重放。退出时一个既有失败 Worker 的暂停队列临时刷新关闭原因；正常启动后恢复为安装前字节，消息始终暂停未发送。Host 锁属于进程生命周期数据，单独排除。原子绑定及旧会话日志未改写；历史消息缺失的单次 usage 和未公开过程不回填。
- 证据集中在 `native-whole-sidebar-final/desktop-backup.json`、`desktop-profile-install.json`、`desktop-acceptance.json`、`state-before-install.json`、`state-after-normal-shutdown.json`、`state-after-install.json`。已通知另一任务释放 Desktop 操作窗口；应用留在原主会话的 `agy-1` 侧栏。本轮未新增真实模型或外部 MCP 调用、未做 Windows 实机验证、未推送或发布；第 7 节保留范围继续可见。

## 2026-10-17 v0.8.1 十一 CLI 通信与数据复查（隔离候选）

### 实际范围与结果

- 按用户要求由三组 GPT-6.1-sol 分别复查 Antigravity/Codex/Claude、Kimi/Grok/ZCode、MiMo/OpenCode/OMP/Pi，主任务复查截图 Hermes 并统一接线。核对源码分派、已安装 lib 的 transport 映射、本机协议类型和模拟进程；新建 Worker 已使用新协议，旧 Worker 缺省/legacy 保留原协议。完整十一项矩阵见 `doc/cli-native-data-audit.md`。
- 保留整个官方 `sidebar.chat.conversation` 和真实子 SessionProvider。候选 ui-chat 增加可选整轮用量来源，原生 TurnTailNodeView/TurnUsagePanel 消费精确 turn/run 账单；与原生每响应账单二选一，不伪造响应、不重复累计。原生 StatsPills 详情解释本轮、最近已确认运行或已公开响应范围；新 run 无新数据时保留同一 CLI 会话的可信快照。
- 补齐各 CLI 已公开的响应身份、缓存、reasoning 数值子桶、终态/迟到 usage 和工具/过程映射；Codex 恢复运行必须有真实确认的历史终态基线，Grok 模型容量必须精确匹配所选模型及实际窗口。OMP 的 reported total 不等于完整四桶时保持未知。过程只显示 CLI 公开内容，没有公开块就不能展开。
- 截图 Hermes 确认仍为 legacy stream-json。本轮 3901 = 未缓存输入 3673 + 输出 4 + 缓存读取 224 + 缓存写入 0；同一会话累计 8669 = 8160 + 93 + 416 + 0。按 accepted nativeInputs、Worker run/batch 和原生 user.source.rpcId 唯一恢复 turn 3 的内存映射；不重写历史。该轮缺公开过程、单次响应用量和可核实上下文容量，仍未知。9 个相关用户源文件读取前后哈希一致，证据为 `.test-data/native-turn-usage-hermes-readonly/combined-real-hermes-usage-report.json`。
- 修正只读 SQLite 也可能修改 SHM 的问题：有 WAL 时只查询私有 DB/WAL 快照，查询后销毁；无 WAL 使用 immutable 只读 URI。文件身份/大小/戳、精确 home/session/cwd 和数值边界均验证，不输出会话正文或凭据。
- 已定向核对 codex-host `1aa9f65d6abf8f15b3a390f10de0b97ad85ae847`、Codingns4DSH `e136681d753061d6e409ccd390c664da19c2ce15`，未执行外部仓库代码。采纳经本机协议确认的 Claude thinking_tokens、Grok 模型容量及账单范围区分；没有复制缺字段补零、累计差 clamp、空白过程占位或 DOM 修补。Hermes TUI gateway 需要活跃 runtime，不用于无副作用读取任意历史会话。

### 本轮实际验收

以下均是分组结果，存在重叠/重跑，不能相加为独立测试总数。证据根目录为 `.test-data/cli-native-audit-20261016/`。

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 协议、进程和 HTTP/RPC 回归 | 14 文件，292/292 通过 | `protocol-tests-loopback.json` |
| 最终统计、映射与集成 | 9 文件，125/125 通过 | `final-integration-tests.json` |
| 前一阶段统计回归 | 5 文件，48/48 通过 | `final-statistics-tests.json` |
| 原生宿主 ui-chat 及关联组件 | 5 文件，196/196 通过 | `/private/tmp/cwn-ui-chat-turn-source-final-tests.json`；`verification.json` |
| Host / Client 类型检查 | 通过 | `host-typecheck.log`、`client-typecheck.log` |
| 插件隔离 preview | 通过 | `preview-build.log` |
| 四包宿主扩展 | 204 文件校验通过 | `artifacts/dsh-host-extension-rc2-audit/manifest.json` |
| 完整原生视图浏览器 | 明确模拟 CLI 验收通过 | `browser-acceptance.json`、`browser-receipts.json` |

- 协议测试首次在受限命令环境因回环监听 EPERM 失败；保留 `protocol-tests.json`，获准本机监听后同组 292 项通过。不是实际 CLI 账号/模型验收。最后两项参考补充另有 Claude 3 文件 76 项、Grok 3 文件 42 项定向复验通过；不将这些重叠分组累加。
- 浏览器实际加载最终 preview 和四包原生扩展，`served-bundles-final.json` 已核对每个真实路径与哈希。原父管理页/主对话、Worker 返回和标题保留，子会话不进入根列表。原生每轮用量显示 3.9K tok，原生详情为 3901、缓存命中 5.7% 和四桶；公开过程经原生两层展开显示明确模拟文本。
- Enter 发送明确模拟消息后，运行中只有一个原生停止按钮；已有 3.9K/缓存 6% 保留，原生详情显示“最近已确认运行”。点击原生停止后状态为已停止，模型/权限恢复可选。模拟上下文 25% 仅验证原生组件，不是实际 Hermes 上下文数据。两张已查看截图为 `native-process-turn-usage-simulation.png`、`native-running-statistics-simulation.png`。
- 初始隔离服务 18788 的一次未认证导航记录 HTTP 401；最终 18789 测试配置正常并完成全部验收。首次过程检查只展开外层而未展开分析层，读取真实 UI 后展开两层通过，属于定位修正。验收回执已保存，Tabbit 正常 finish（非 forced cleanup）；仅任务自建页关闭，隔离服务 wrapper 正常退出。
- 最终 preview Host SHA-256：`6d54c7dbd8d8e666d1691af7b8a10bbbeb9e12f553a48db43410581b686be6d0`；Client：`e68318d7668030eb32fb065e587c3d6218bd1702dd69fa7f9788581f95868cbe`。候选源码补丁：`e2f6c0fd2e54a0653e1dae49f5f7cdb8e268ca3c7ab398f0b8d234a07e4162b0`；四包 manifest：`d3e9648c2a76ffa0cdb9cb28e6b9de347e109b33a3184742677bbdb5563fa0a9`。产物继承官方 rc.2 声明，未宣称生成完整新版 SDK 声明或完成新机器安装。

### 仍待验收的边界

- 按用户“安装前先验收”，本轮正式 Desktop、profile、根 lib 与原三包扩展均未替换；仅交付隔离候选及证据。原正式 Host/Client 和三包 manifest 哈希仍与上节安装记录一致。后续正式安装需确认无活动任务、保存备份、更新四包清单并做冷启动验收。
- 本轮没有真实模型/账号调用、外部 MCP 全链路或 Windows 实机验收。尚无来源的数据继续未知；不以模拟截图证明所有 CLI 都能给出 token、缓存、上下文或思考。
- 版本保持 v0.8.1，未提交 GitHub、未推送/发布、未归档活动 change。OpenSpec 第 10.1–10.6 节完成离线复查与候选验收，第 10.7 节安装和第 7 节完整真实验收继续可见。

## 2026-10-17 v0.8.1 补充数据接口与实际验收（第 11 节，安装进行中）

### 实施与最终候选

- 按用户授权继续参考固定 codex-host、Codingns4DSH 及当前安装版官方接口，补齐 Kimi 同一 ACP session 的 durable 用量回执、Hermes 原进程官方 request hooks、OMP 原生 /context 分类与显式 orchestration 桶、OpenCode GET session.tokens counter。具体版本、来源、完整性条件与未提供字段见 `doc/cli-native-data-audit.md`、`doc/kimi-durable-usage-audit.md` 和 `doc/native-http-rpc-data-interfaces.md`。保留官方完整侧栏和原 CLI Agent／选型／transport，不补造过程、缓存零或分类。
- OMP get_session_stats 仅覆盖当前保留 state.messages，明确 reported／native-active-context，不持久成完整 session；正额外桶不能塞进普通四桶。OpenCode 原生 session 快照覆盖替换，允许下降／清零，不累加或取最大。原生 ContextMeter 保留 partial 分类、来源与估算，原生用量详情可保留 total-only／extra 和 unknown；普通 DSH 会话无外部来源时默认行为不变。
- 最终 `build:preview` 已成功，包含最后 ZCode 工具输入形态修复，源码冻结。候选四包目录为 `artifacts/dsh-host-extension-rc2-data/`；旧 `rc2-audit` 为前一阶段候选，不代表本轮最终包。Desktop 已完成安装与冷启动原生侧栏验收；具体数据、范围及回退记录见本节末的安装记录。

### 自动检查与原生浏览器

以下分组有重叠或复验，不能累加为独立测试总数。私有证据根目录 `.test-data/cli-native-data-20261017/`。

| 范围 | 实际结果 | 证据／限制 |
| --- | --- | --- |
| 最终插件集成 | 17 文件、295/295 通过 | `integration-tests.json` 的 testResults 长度为 17；numTotalTestSuites=40 是 suite 数 |
| 原生宿主 partial/usage 及关联 | 6 文件、211/211 通过 | `/private/tmp/cwn-ui-chat-partial-usage-final-tests.json` |
| 原生上下文补充 | 11/11 通过 | 与上行分开，不作 222 项合并结论 |
| Hermes 最后定向复验 | 12/12 通过 | hook／错误及完整性边界；与集成组可能重叠 |
| ZCode 最后工具输入修复 | 3 文件、29/29 通过，Host 类型检查通过 | `real-cli-summary.json.postSmokeZcodeFix`、`zcode-tool-input-replay.json`；真实 raw 离线重放，未再次调用模型 |
| 最终 preview 与四包 | 通过，源码冻结 | 最终路径 `artifacts/dsh-host-extension-rc2-data/`；安装状态单独记录 |
| 完整原生视图浏览器 | 明确模拟数据通过 | `browser-acceptance.json`；不是全部 CLI 真实数据或 Windows 验收 |

- 浏览器核对官方完整侧栏、父管理和顶栏保持、子会话根列表隐藏、两层公开过程、原生模型／权限菜单、单停止按钮、运行期间已确认用量保留、停止后恢复选择。原生每轮 3901、total-only 总量 43／输入 35／输出 8、上下文 35/1000 均为明确模拟；未知缓存不补零，source 与非估算标记保留。
- partial 每轮用量分支由原生组件回归覆盖；浏览器临时快照覆盖没有替换 service-level 每轮回执，不把该浏览器操作写成 partial 每轮分支的独立通过。定位器修正为实际“新建会话”、带空格的卡片名及“停止生成”可访问名，没有改 UI 绕过验收。

### 沿保存选型的真实隔离单轮

`real-cli-summary.json` 记录用户授权的同 CLI／保存模型与强度验证，工具只写隔离 workspace 的 artifact，返回随机标记；不改保存偏好、不换模型、不额外发送续聊或取消轮次。

| CLI | 结果 | 已核实边界 |
| --- | --- | --- |
| Antigravity、OMP、Pi、OpenCode、ZCode | 五个 CLI 通过 | 工具执行回执、原始 wire、实际 artifact 内容／哈希及终态核对；不等于全部工具、续聊或停止通过 |
| Codex | 账号额度阻塞 | 准入前拒绝，nativeProcessStarted=false、realProviderGenerationStarted=false；无重试、无模型切换 |
| Hermes | 所选模型上游容量阻塞 | 两次已授权隔离轮次均 HTTP 429；每次 3 次官方内部请求错误、0 模型响应；observer ready 与 session 绑定已验证，截止清理完成；不是账号额度结论 |
| Kimi | 未启动 | 无订阅，未调用 |
| Claude、MiMo、Grok | 未启动 | 无保存选型，未猜模型调用 |

- 实际是五个 CLI 通过、两个阻塞、四个未启动；八次脚本准入尝试包含 Codex 未启动和 Hermes 两次阻塞，不是八次成功生成。extraFollowupOrCancelTurns=0，所有实际启动进程已结算。真实 OMP 读到 /context 原生分类及 9471/272000，reported 18938；这些读数不证明完整历史账单或 extra 场景已真实出现。
- ZCode 真实工具产物通过后发现输入可能是 JSON 字符串／少量原生 envelope，最后修复仅针对公开工具输入规范化；29 项和原 raw 重放验证后重建 preview，没有再次真实模型轮次。不能将 smoke 阶段包与最后修复包写成逐字节相同或称修复后已重跑真实模型。
- Runtime 在完成前检查进程 exitCode，另外核 smoke 退出状态、bridge terminal、工具和产物；这些报告未逐个持久保存嵌套 CLI 直接退出码，不声称已直接提取。真实检查期间 Desktop profile、Hermes 配置及九项保存偏好哈希未变，preview 运行输入哈希保持；正式安装后的配置变化另行记录。
- Windows、真实续聊／停止、全部 CLI 外部 MCP 和所有订阅全链路未在本轮验证。Kimi durable、Hermes 成功响应／usage／context、OMP 正 extra 等未由这些真实成功样本覆盖的分支继续保留离线／受阻边界。版本仍 v0.8.1，未推送、发布或归档隐藏缺口。

### 第 11 节最终 Desktop 安装与冷启动结果（2026-10-17）

- 已按授权完成安装；版本仍为 v0.8.1。确认 28 个 Worker 无活动任务并退出全部 Desktop 进程，备份 4 份 profile 文件和旧 lib 后正式构建。与 preview 比较：Host 字节一致；Client 仅 18 处生成依赖来源路径注释不同，运行代码一致；77 个 sidecar 一致。最后 3 文件 36 项 backend 定向复验通过（覆盖 Hermes 身份与 ZCode 输入，不与前述组数相加）。
- 四包候选 `artifacts/dsh-host-extension-rc2-data/` 共 204 文件按 manifest 核验；官方 rc.2 commit `639ed015397290b3745d163aafe02ffee4aa3f84`，源码补丁 SHA-256 `1fadffe5db8988323838e0a791f2bf746b703bbbe2baad13b191db60e76a6126`。只替换三个旧扩展路径并加入 ui-chat 扩展，保留原 ui-chat 配置与其他 profile 字节，未修改 app.asar。工作流和依赖配置哈希未变。
- 真实 Electron Desktop 冷启动后，沿原父管理列表打开截图对应的 `hermes-1`：原生本轮用量弹层为 **3901 = 3673 + 224 + 0 + 4**；原生会话用量为 **8669 = 8160 + 416 + 93**；权限与模型原生弹层可打开。该旧轮无公开过程和上下文容量，继续不可展开／不显示未知上下文，没有伪造历史。Desktop UI 这一步未发送模型请求。
- 原有 `agy-1` 侧栏显示运行统计、132K Token／缓存命中 46%、上下文 12%；原生上下文弹层显示约 31.1K/256K、三类占用及“Antigravity 最近一次请求的本地上下文估算”。父会话模型和统计保持；原 Worker 标题/返回、管理列表及根会话隐藏通过；工作流页仍可打开，3 个既有流程可见。
- 安装前记录的 228 个 Worker 数据文件有 226 个最终哈希不变。两个变化为打开 Hermes 时原有 ensure 路径重存的 Worker 绑定元数据，以及 Host 重启后仍处于 paused 的旧队列说明；队列没有发送。原始事件／日志、账号绑定、偏好及会话身份保持；正常启动新增 host.lock。不把这两次运行时写入描述为全部文件逐字节未变。
- 验收采用仅本机临时 CDP 观察实际 `dsh-app://app` 页面；结束后正常退出，再不带调试参数启动。5 个正常 Desktop 进程存活、19389 调试端口和 18790 模拟服务均关闭、活动 Worker 为零；本任务浏览器页面已关闭。已向授权协调的“介绍项目亮点”任务告知安装窗口释放。
- 私有证据：`.test-data/cli-native-data-20261017/desktop-acceptance.json`、`desktop-profile-install.json`、`formal-build-equivalence.json`、`data-final.json`、`desktop-hermes-turn.png`、`desktop-agy-context.png`。备份及 CAS 回退脚本在同目录；不入 Git。
- 五个 CLI 的真实验证仍是隔离单轮，按 `real-cli-summary.json` 保留各自包哈希；最终 ZCode/Hermes 后端修复由回归和原 raw 重放验证，未额外调用模型。Codex 额度、Hermes 容量 429、四个未启动 CLI、Windows 和外部 MCP 全链路边界不变；OpenSpec 第 7 节仍未完成，不归档。

## 2026-10-17 v0.8.1 首轮未知状态、实时过程与 Hermes 收尾回归

- 本次截图发生于新 Hermes 首轮尚无响应时。已核查 Client 原样复用官方 `sidebar.chat.conversation` 的 component/inject/store/locale/options，真实 child SessionProvider 管理整棵视图；缺模块来自原生无数据隐藏分支，缺过程还涉及 SSE 静默和桥接等待响应结束。此前历史/完成态验收未覆盖此状态，不能作为本次首轮通过证据。
- 已授权宿主扩展新增可选 `telemetryAvailability` 与 `externalRequestState` 来源。三项统计由原生组件保留未知态和原生详情；普通 DSH 不提供来源时行为不变。Hermes 同进程官方请求观察通过精确 session/native run/sequence 独立串行刷新，错误仅白名单类别/HTTP，不推断重试延迟。真实 append-only reasoning 和确认身份的 tool-start 立即交给原生流；工具参数/回执/账单保留真实边界。
- 只读真实记录证明截图 run 随后于 01:26 收到公开思考、回复、`run.completed` 和最终 HTTP completed，输入4063/输出8/总量4071；9次错误、10次请求、1次响应不能证明所有尝试的提供方账单完整。公开 reasoning 与桥接/持久化逐字一致，恰好与回复相同也是原生事件如此。旧桥随后发送 SIGTERM；Hermes 官方将无 planned marker 的 SIGTERM 视为意外中止并 exit1，插件因此覆盖成功。现仅 Hermes 使用官方 SIGINT 计划停止，保留其他 CLI SIGTERM、异常退出拒绝、超时强杀及确认退出边界。
- Hermes HTTP、legacy、CanonicalUsage/DB 都丢失了原始缓存字段存在信息。无证据的缓存0现在冷读为未知，真实total/input/output及正缓存保留；旧快照和 Session DB 同步清洗返回副本，无需改用户记录。真实raw只读重放证明4071进入原生 partial usage，而非伪造四桶；原始文件SHA不变。

### 实际执行的验收

下列为各阶段结果，存在重叠，不相加为独立测试总数。使用项目已有测试命令及显式模拟，未新增真实模型调用。

| 范围 | 结果 |
| --- | --- |
| Hermes 观察与原生协议阶段 | 7文件127项通过；最后 post hook retry_count 修正后3文件53项通过 |
| 请求状态、Provider、统计、持久化、入口 | 5文件50项通过；独立状态链复核5文件49项通过 |
| 原生流/真实 AgentLoop 的实时过程 | 3文件66项通过 |
| 原生宿主 UI | 6套件182项通过；两 UI 包 Client 类型检查通过 |
| Hermes 计划停止 | 4文件83项通过，真实本地合成子进程覆盖计划0、默认TERM、自然1、stop后1、自然signal退出、超时强杀及未确认退出；没有调用实际Hermes或模型 |
| Hermes 缓存存在性 | 7文件109项通过，含旧快照冷读和其他CLI明确0；既有真实run只读回放通过 |
| 最终集成 | Host/Client typecheck、build:preview、正式build通过；四包manifest 204文件校验通过 |

- 隔离浏览器仍为官方 DSH AgentLoop/Session/UI/Inbox，CLI输入明确标注模拟并禁止真实外调。验收覆盖新首轮三项未知模块与原生弹层、HTTP429失败与下一真实请求替换、请求终态清除、运行中思考展开、工具输入展开、完成过程双层展开与工具输出、消息尾3901用量弹层、三项已知统计，以及父主页面保留/child不进入根列表。3901等均为夹具，不能代表实际模型用量。
- 四包来源为官方rc.2 `639ed015397290b3745d163aafe02ffee4aa3f84`；补丁SHA `cbec993c67742ea8ea52b610a91e21c2688f304f5686c54bd102182acae8e4a3`。隔离浏览器实际served四包hash与冻结候选一致。候选包含runtime/source扩展，声明仍继承官方基线，不称为发布后的新SDK。
- 经已授权协调，在29个Worker无活动、Desktop全部退出后，备份6份profile与原lib531文件，安装 `artifacts/dsh-host-extension-rc2-first-request` 四包；只替换原扩展路径，其他profile字节、工作流及依赖配置保留。后续Hermes收尾/缓存修复先preview再正式build并二次冷启动，四包UI和Client未变化。最终Host与preview字节一致，Client仅依赖来源region注释路径不同，48个直接Host helper source/preview/formal逐一一致。
- 最终实际Desktop打开同一个 `hermes-hello`，原Worker管理/标题、父主页面保持。原生“已完成分析”可展开真实思考；原生消息尾弹层为4071、输入（含缓存）4063、输出8，没有无证据缓存0。底部三个模块显示1轮3步、4.1K、上下文0%；原生上下文详情为4.1K/1M，精确值4063/1048576约0.3875%，0%是原生四舍五入。历史失败标记保留，未重写当时结果或重试该任务。
- 235个安装前顶层数据文件中233个哈希保持，变化仅一份打开时重存的Worker元数据和host.lock；没有新增/删除文件，原始事件与日志保留。最后后端更新前后该Worker字段无变化。其他5份profile文件哈希与备份相同。最终5个正常Desktop进程存活、活动Worker0、临时19389/18791端口关闭；本任务模拟页面关闭并释放协调窗口。
- 私有证据：`.test-data/cli-first-request-20261017/acceptance.json`、`preview-complete.json`、`request-state-review.json`、`hermes-cache-presence-report.json`、`hermes-cache-presence-real-replay.json`、`final-build-equivalence.json`、`final-state.json`，以及首轮未知截图和 `desktop-hermes-final-usage.png`。备份未删除。版本仍v0.8.1，无推送、发布或新模型调用；本次修复后的真实模型首轮/停止、Windows及全部CLI工具桥仍未补验，不归档隐藏第7节边界。


### 2026-10-17 v0.8.1 第13节：完成正文空白、原生过程顺序及上下文核查

- 用户截图对应真实 `hermes-1｜说你好`。旧桥接将正文、晚到公开推理、空清理等待拆成三个 step；官方最终答案策略只认末 step，故正文被折叠，而消息用量仍存在。相邻且无独立响应身份的叙述现在使用同一原生请求，保留独立 text/reasoning block；等待清理不制造空成功末 step，真实工具、用户和响应边界仍保留。
- 旧记录通过 Host 严格父子会话/run/turn/成功结果/连续历史证明，只投影既存答案 seq/step/messageId/endSeq；官方 ChatView 再校验，不复制正文、不重跑 CLI、不重写 Session。消息头、折叠组和正文使用同一原生状态。
- 第一候选 `rc2-answer` 安装后，真实正文恢复、消息用量及三个底部模块可见；但用户随后指出过程展开位于正文下方。此前仅检查存在/展开不足，不能认作最终通过。追加 `rc2-answer-order` 在原生有效条目序列中重排已验证的同轮过程，保留原节点/分组/key/store；普通 DSH 无来源时保持默认。
- 插件关联回归7文件146项、Host/Client类型检查、preview和正式build通过。第一候选原生回归173项通过；追加顺序修复的原生回归168项和ui-chat类型检查通过，组间有重叠，不累加。新旧两种原生DOM顺序、候选自身含text/reasoning、单份正文均有断言。
- 隔离浏览器明确模拟、无真实模型或CLI。新流真实AgentLoop只形成1个step；旧记录夹具为3个step。展开两层原生过程后，新流思考底部325低于答案起点337，旧日志思考底部604低于答案起点616，两个过程均在对应答案上方。截图人工核对通过；父管理页、消息用量及三个底部模块保留，child未进入根列表。实际served四包hash与冻结候选一致。
- 截图同一Hermes上下文读链已实际验证：原始观察、Host提取、Client投影均为4046/1048576，约0.3858566%；来源是Hermes同一请求输入和实际context_compressor窗口，所选模型目录缓存亦匹配。rc.2原生Math.round显示0%，不是缺失或真实零；本轮不改变原生取整格式。缓存canonical零缺少原始字段证据，仍未知，不伪造命中率。
- 顺序候选上游commit `639ed015397290b3745d163aafe02ffee4aa3f84`，patch SHA `bcf6f6cd5e2c05f64d0e3415d9cee166ec91f72facd0f64dfd6adb0e690531fe`，manifest SHA `89eea5c1e4694cbfa2941f59b34d4bbbd2576e069fbc3e874992c9f8ca606f38`，204文件校验通过。该追加只改宿主UI，插件源码和已验收正式lib未变。
- 私有证据：`.test-data/cli-empty-reply-20261017/`保留原始缺陷、真实Session回放及第一候选安装；`.test-data/cli-native-order-20261017/`保存顺序模拟、截图、context-proof与最终安装资料。第一候选Desktop观察前后，原Session压缩日志、Worker事件及绑定文件hash不变；一份Worker元数据被正常冷读重存，不宣称全部文件字节不变。
- 顺序候选已在与「介绍项目亮点」协调释放的窗口安装。确认活动Worker为0、Desktop完全退出后，只更新四个宿主扩展路径至 `artifacts/dsh-host-extension-rc2-answer-order`；保留工作流、原配置及插件正式lib。安装后profile SHA为 `3e3f40cc3eb8618f36f2d5836c2e873940f5adbfaad3e5733eec11ca619210e9`；其他5份profile文件及4份历史证据安装前后哈希保持。
- 正常冷启动后的真实Desktop，沿父管理列表打开截图同一 `hermes-1｜说你好`：折叠时正文直接可见；展开“已完成，用时37秒”及“已完成分析”后，公开思考在正文上方；原生消息用量弹层为4050（输入含缓存4046、输出4），底部三个模块保留。原生上下文弹层实际显示 `0% · 4K / 1M` 和“**Hermes 官方请求输入 / 模型窗口**”，证实0%来自原生取整而非丢失值。原Session压缩日志及raw再次核对哈希不变。证据见 `.test-data/cli-native-order-20261017/desktop-acceptance.json`。
- 已向「介绍项目亮点」释放Desktop并说明保留最新四包路径。未调用新的真实模型，Windows和全CLI工具桥未新增验收，保留第7节边界，不归档。


### 2026-10-17 v0.8.1 第14节：低占用取整与原生上下文分类完整性

- 用户最新截图是 hermes-2 新会话；独立核查同一 Worker/run，不沿用 hermes-1 旧记录。原始观察第20行 input4091/context_length1048576 = 0.390148%；账单4101=4091+10。4次429后1成功，观察摘要不冒称完整账单。旧请求未保存分类快照，不能从累计账单、DSH镜像或当前TUI倒推。
- 根因一：共享原生contextOccupancy取整结果同时驱动数字和几何，低占用既显示0%又画空条。现footer/header/ARIA统一，0—1%保留最多两位小数，极小正值<0.01%，真零0%；环/条用未取整比例。非法计数未知，超窗口图形封顶且分子保留；普通DSH同样应用这一共享修复。
- 根因二：外部分类路径曾取代原生三行。现原生ContextMeter保留系统提示词/工具定义/对话消息；部分分类透过可选metadata传入同一组件，缺项—并说明，全分类沿用三色条；额外Skills/Buffer/Free只补充，free/buffer不参与已用占比。分类估算标记独立于精确总量。
- 新Hermes请求：官方pre_api_request的真实Chat Completions request_messages及完整tools调用Hermes原生估算器，数值通过精确pre/post、run/turn/request/session/provider/model配对发布。只保存数值、不保存请求内容、不追加模型调用；系统提示去重、截断/脱敏/未知协议工具不补零。离线本机官方原语模拟22/20/14通过。独立复查另发现新成功回执context缺失时沿用旧值，已修复清used/breakdown并保留同模型已证实容量，相关回归通过。
- 插件定向验收：6文件124项通过（含Hermes observer50项）；跨CLI分类与会话遥测另7文件108项通过。共享ui-conversation全关联41文件579项通过，Host/Client及原生包typecheck通过。使用项目已安装二进制执行，pnpm自动依赖重装入口未采用。OpenSpec严格校验、diff检查通过。
- 先隔离build:preview；四个官方UI候选artifacts/dsh-host-extension-rc2-context/共204文件核验。patch SHA256 `fb9c2b1af9898831b6d2c5bc65321fee5ab0d661dd6d01d5eb0b1ad50800d061`；manifest `d604c25cfaf56bf200c0084f3920f43798892780f84ea0a7d9f99cfdf72417f6`。
- Tabbit完整原生侧栏明确模拟：unknown、zero、small、partial、full、normal、overflow、missing-capacity八场景，running/completed共22次切换；数字/ARIA/环条、完整/部分/未知分类、清旧值通过。公开过程y301+24≤正文y337、正文仅一份、消息用量与三个footer保留，子Agent不入根列表。实际served四包与冻结hash相同；最终截图已人工读取。测试定位曾因按钮名称空格不一致失败，改用实际可访问标签后断言通过；不把失败尝试记作通过。
- 其他任务已释放Desktop；32Worker、0活动后备份，正常退出后正式build，Host与preview一致，Client仅region路径注释不同，去注释字节一致。正式Host `7a72d5518ec39b43f12673bb59bd52859b609ec2aedff7f2b46313d21bd64952`，Client `32b9c84ec1603c428bb473e3fa45104e6560241e4d26107a9743dfd51e007337`。CAS只替换四个扩展路径，profile由`3e3f40cc…`变`5832b9a1…`；版本仍0.8.1。
- Desktop冷启动PID34477，打开截图同一hermes-2实见0.39%/4.1K/1M和非空条，三行—及“当前记录未提供分类统计。”，消息与底部用量4.1K、2轮2步；原生公开过程在正文上方可展开。普通父会话实见2%/~17.4K/1M，三桶~2.1K/~7.3K/~4.8K与三色条正常。父级管理及原顶栏保留。
- 保存检查：1291份用户记录中1290份哈希不变；父会话原66049字节压缩前缀哈希与安装前完全相同，仅正常退出追加78字节session/end-seed（seq133），没有改历史。2651份工作流文件中2650份不变，host.lock随冷启动更新PID34488；无关5份profile文件全同。私有证据`.test-data/cli-context-review-20261017/`含原始审计、两组测试、模拟矩阵/截图、preview marker、备份/CAS、Desktop验收和保留证明；测试浏览器/服务均已释放。
- 边界：本轮0次新增真实模型调用；未来Hermes分类通路已做官方原语离线/协议回归，未冒称真实生成验收；旧记录缺失分类保持未知。Windows、全部CLI/订阅及外部MCP全链路仍是OpenSpec7.1/7.2待办，不归档、不推送、不发布。

## 2026-10-17 v0.8.1 第 15 阶段：其余十 CLI 对齐与上下文弹层清理

### 实施与范围

- GPT-6.1-sol 分三组复查 Antigravity/Codex/Claude、Kimi/Grok/ZCode、OpenCode/MiMo/Pi/OMP，沿原始协议→安全遥测→官方 AgentLoop/Session→完整原生侧栏检查。具体数据通路和真实上游限制见 `doc/ten-cli-native-parity.md`。
- Codex 补命令增量、MCP进度和动态工具内容；终帧未携带输出时保留已接收输出，过滤跨thread/turn及终态后迟到事件。Claude隔离主/子Agent流，主响应完成前不让子流打断主响应归属；异常或取消先确认peer关闭再排空已收到的公开事件，不伪造完成或usage。
- Kimi/Grok ACP与ZCode修复正文→公开思考→后续正文的分段顺序。Pi/OMP在确认选型后投影真实容量，首轮前和响应间使用独立ID、有界750ms、最多一个在途的只读stats查询；终态后不覆盖结算。HTTP两协议分别区分初始全零占位、确认完成的真零、完成时缺字段以及错误帧，缺失当前输入不沿用旧占用。
- 用户随后要求去掉所有“分类来源／数据来源”。在原生 ContextMeter 中统一删除来源行及重复英文/额外分类行；已知、部分、未知、等待和不可用状态均覆盖。保留占用比例、分子/分母、占用条、系统提示词/工具定义/对话消息三行及缺失说明。内部来源和OMP额外分类仍用于诊断，不在该弹层展示。此前第14阶段“显示来源与额外分类”的界面描述由本阶段替代。
- 插件父级管理、Worker标题和侧栏导航保持；仍直接运行官方完整 `sidebar.chat.conversation` 及Session/Inbox状态，未改成逐组件拼接。插件版本仍为0.8.1。

### 实际验收

| 范围 | 结果与证据 |
| --- | --- |
| 最终插件关联回归 | 14文件280项通过，见私有 `integration-tests.json`；包括真实官方AgentLoop和明确模拟协议/过程数据 |
| 类型及隔离构建 | Host/Client类型检查、`node scripts/build-preview.mjs`通过；223个src文件和45个Host mjs与preview内容一致 |
| 原生弹层清理 | ContextMeter关联39项、ui-conversation Client类型检查通过；候选四包204文件manifest验证通过 |
| 最终干净候选浏览器 | 10 CLI×等待/生成中/完成=30状态通过；`browser/matrix.json`、`matrix-complete.json`、`final-clean-events-audit.json` |
| 正式Desktop | 空闲安装与冷启动，现有AGY/Hermes及普通父会话原生统计只读核对通过；`desktop-clean-acceptance.json` |
| 规格 | 第15阶段严格校验通过；第7节全CLI真实账号/订阅/外部MCP/Windows边界未完成，未归档 |

- 最终插件回归命令为 `node node_modules/vitest/vitest.mjs run tests/harness-conversation-stream.test.ts tests/primary-response-audit.test.ts tests/native-primary-runners.test.ts tests/codex-run-usage.test.ts tests/native-acp.test.ts tests/native-zcode.test.ts tests/acp-zcode-usage-audit.test.ts tests/http-rpc-response-audit.test.ts tests/pi-omp-native.test.ts tests/ten-cli-native-parity.test.ts tests/cli-telemetry-audit.test.ts tests/native-context.test.ts tests/harness-native-telemetry.test.tsx tests/conversation-telemetry.test.ts --reporter=json --outputFile=.test-data/ten-cli-parity-20261017/integration-tests.json`。分阶段测试不累加为无重叠总数。
- 浏览器使用新的隔离HOME和真实官方视图/AgentLoop，所有CLI正文、公开思考、工具均明确标注模拟；禁止真实后端/进程/非本机外调。最终运行10个turn/end均为completed，0个bootstrap/control错误；启动时1次subprocess.spawn被阻断，没有实际执行。中间夹具错误与修正记录保留，不能把失败尝试称为通过。
- 逐CLI验收单停止按钮、生成中三统计持续存在、正文不被折叠隐藏、过程位于最终正文上方、原生两层展开、消息尾usage弹层、上下文三分类及未知态、完成后权限/模型控件可用、父管理返回以及全部10子会话不进入根列表。已操作原生权限/模型菜单打开，未选择新模型或发送任务。
- Pi/OMP浏览器两响应21+22=43及AGY两响应20+20=40均为明确模拟回执，调用各自生产usage适配器；其余CLI没有精确响应身份的run账单保持run范围，没有虚构逐请求用量。AGY模拟未提供精确本地上下文元数据，因此显示未知；真实Desktop历史已另核12%。未知分类不补零。

### 安装、真实历史与保留核查

- 32个Worker均无活动任务，正常退出Desktop后先更新插件；正式Host与preview一致，Client仅构建来源region注释不同，运行代码相同，543个运行/类型/map文件按对应路径验证（排除构建根相关的tsbuildinfo缓存）。正式Host SHA256为 `0ad6016f4f82ac76741cd37a463d20a28ad2ec50f3481819feab5150e0c7a4de`，Client为 `32b9c84ec1603c428bb473e3fa45104e6560241e4d26107a9743dfd51e007337`。
- 最终上下文清理候选 `artifacts/dsh-host-extension-rc2-context-clean` 在隔离验收后安装。官方rc.2基线 `639ed015397290b3745d163aafe02ffee4aa3f84`；源码补丁SHA256 `efce7a54270ec7a9b9d8b837d81fc6ae155c4cfa541bbc49ad7debb5b3476bca`，manifest SHA256 `5b9cf8fa3824f90adef6c0485f502d7f9cc0dc2414153b50f8b02aba24324c70`。私有备份6份profile文件，仅CAS替换session/conversation/subagent/chat四条扩展路径，其他原字节不变；不改app.asar。
- CUA只读核对“用 agy 打招呼实现”父会话现有 `agy-1`：正文“你好”、消息与底部21.7K tok、缓存0%、上下文12%、约29.7K/256K，原生三分类约14.8K/13K/2K，来源说明消失。此读数不同于另一父会话此前132K的AGY记录，没有混为同一个Worker。
- 同一父会话 `hermes-2｜说你好（新会话）`：正文可见，原生过程位于正文上方，消息和会话4.1K tok、2轮2步、上下文0.39%、4.1K/1M；旧分类未知显示三行“—”和缺失说明，来源说明消失。主会话仍256K、缓存82%、上下文2%，原生三分类正常。没有新增真实模型调用。
- 最终保留核对：6031个用户记录文件仅CLI host.lock因重启变化，其余6030哈希不变；2651个工作流数据文件仅其host.lock变化，其余2650不变；原205个宿主扩展文件不变；6份profile中仅授权四路径所在的cordis.patch.yml改变，其余5份不变。最终profile SHA256为 `9e7669b8dca3a5bf78500b7e9ce309f29a0c2050b2bbf5ea84035b23cf60c752`。本次安装未覆盖会话、凭据、偏好或工作流。
- 证据与备份在私有 `.test-data/ten-cli-parity-20261017/`，不入Git。仅关闭本任务Tabbit页面和18793隔离服务；正式Desktop保留正常运行，安装窗口已释放并通知获授权的“介绍项目亮点”任务。未推送、发布或增加版本号。
- 本轮十CLI全面性指源码、关联协议回归和模拟原生视图；不等于十CLI全部真实模型、Windows或外部MCP验收。Kimi无订阅等既有边界保留，不补造上游未公开的数据。

## 2026-10-17 v0.8.1 第 16 阶段：七张真实截图回归

本节处理用户真实截图中的 ZCode/Grok 启动失败、Pi/AGY/OMP 无过程展开，以及 Pi/MiMo/OpenCode 三类上下文未知。保留第15节当时的模拟验收结果，不以其替代此次真实运行证据；版本仍为0.8.1。

### 根因与实现

- ZCode：macOS 长临时目录加官方 UUID Unix socket 超过路径长度，官方进程 EINVAL 后断开。运行目录改为短 `/tmp` 根，不改原生会话和权限；自然崩溃仍失败。Grok 1.0.50 的实际 ACP 配置值为标量字符串，原 `{value}` 格式被拒绝；现在按当前协议设置并核对模型/强度。有效协议终态后的自身清理信号仅在实际成功发送时容许对应退出码，未确认退出不算成功。
- Pi：官方 RPC 在扩展加载前重定向 stdout，前两次真实分类采集失败。最终使用同一1.0.4安装的 `context_with_system` 与官方估算原语，经单独 fd3 输出数值；nonce、模型、session和连续请求序号验证、有界输入、停止后迟到拒绝均覆盖。最后补充“当前新请求无法分类时清旧分类”，该末项做离线回归，不另发模型。
- MiMo/OpenCode：PURE 模式下试验的外部插件观察器未被加载，因此没有把该方案作为成功结果。最终从原生 server 读取实际 provider SDK/端点，在 prompt 前串行重启至本轮 loopback relay，保持 HOME/PURE/cwd/权限/数据路径，原字节透传到实际上游。按精确主请求计算原生 chars/4 三类估算；不统计标题/摘要、不落盘原始请求和凭据，不将估算代替账单或压力。
- Antigravity：`user_input`/`checkpoint` 中性元数据曾被误判成 FAILED，已修复；未知中性帧保留覆盖诊断，真实 `tool_info.error` 和非法字段仍失败。截图同轮 Pi、OMP、Antigravity 原始记录只有最终正文、未公开思考块，AGY明确 thinking_tokens=0。原生无展开按钮符合这些实际样本，不能把正文或“正在思考”状态补成推理。
- 所有改动仍位于后端协议/遥测及既有整视图投影，没有组装新对话界面；分类来源／数据来源及额外分类行继续不显示。旧轮次未采集的三分类不倒推补写。

### 真实选型与证据

全部使用原先保存的 CLI、模型和 Low 强度，隔离运行目录及账号副本，未重发用户原会话任务。检查实际输出、事件、退出/范围清理与原账号资料哈希，不采信完成自述。

| CLI | 实际选型 | 本轮通过的证据 |
| --- | --- | --- |
| ZCode | `account:bigmodel-individual-coding-plan/GLM-5.3-Flash` | `zcode-muRDym/report.json`，原生新会话完成且精确标记匹配 |
| Grok | `grok-4.6` | `grok-live-VxPvab/report.json`，标量配置及原生任务完成、精确标记匹配；较早自身收尾143误判记录保留 |
| Pi | `zai-coding-cn/glm-5.3-flash` | `pi-live-lRcgdK/report.json`，三分类714/1108/29，独立上下文1974/1000000；5个所属Host进程均退出且范围确认，前两次分类失败未隐去 |
| MiMo | `xiaomi/mimo-v2.6-flash` | `http-mimo-4EkKKR/report.json`，三分类3868/16987/38，上下文21125/1048576；先前回复成功但观察为0的记录保留 |
| OpenCode | `zhipuai-coding-plan/glm-5.3-flash` | `http-opencode-erdy4T/report.json`，三分类2294/4113/39，上下文6041/1000000 |

路径均相对私有 `.test-data/seven-cli-regression-20261017/`，数据不入Git。Pi/MiMo/OpenCode 经完整 WorkerRuntime；ZCode/Grok 本轮实际执行证据为适配器与原生 runner，不冒称全部Runtime取消/恢复已实测。MiMo/OpenCode 每个最终运行只有1个用户turn和1个主请求；真实工具调用均为0。Pi官方fd3和两HTTP官方CLI路由另有零模型本机探针；详细范围见 `doc/cli-native-data-audit.md`、`doc/ten-cli-native-parity.md`。

### 自动与原生界面验收

- 最终关联12文件259项通过：`node node_modules/vitest/vitest.mjs run tests/http-context-observer.test.ts tests/http-context-relay.test.ts tests/native-http.test.ts tests/pi-context-observer.test.ts tests/request-context-telemetry.test.ts tests/native-primary-runners.test.ts tests/native-transport.test.ts tests/native-acp.test.ts tests/native-zcode.test.ts tests/extended-integration.test.ts tests/harness-native-telemetry.test.tsx tests/harness-native-telemetry-provider.test.ts`。分阶段测试有重叠，不累加。
- Host/Client `tsc --noEmit` 均通过；`node scripts/build-preview.mjs` 完成冻结包。pnpm入口的本机版本冲突未触发依赖重装，使用项目锁定的本地二进制。
- 本机18795隔离DSH加载正式原生侧栏、AgentLoop和同一context-clean宿主扩展，全部执行/账号查询/非本机外调被禁用。七组均明确标注“真实记录回放，非新运行”；最终读取修复后新运行的Pi/MiMo/OpenCode/ZCode/Grok记录及原AGY/OMP记录，未伪造过程或统计。用户明确允许本次临时本机token交由Tabbit验收。
- `browser/real-ui-matrix.json` 七组通过：正文仅在原生正文区、MiMo/OpenCode公开过程可在正文上方展开，其他无公开过程的完成条不制造展开；消息用量、底部原生统计、权限/模型按钮可用、完成态一个发送按钮、无额外停止按钮。根列表始终只有父会话和工作区，不含子会话。Pi显示~714/~1.1K/~29，MiMo~3.9K/~17K/~38，OpenCode~2.3K/~4.1K/~39；分类和已知压力独立。无来源行或英文重复分类，MiMo最终截图已人工读取。
- 真实回放不代表发生了新的模型调用；七个输入样本均无真实工具事件，不能据此声称工具交互完成真实验收。AGY此次仅重放raw，未带用户原DB上下文，隔离显示未知；其原Desktop12%已在第15节单独核实。
- 已关闭本任务两个18795回放页并完成Tabbit释放；原18792页面保留。隔离服务已SIGTERM并确认退出0，临时入口关闭。

### 安装、Desktop 冷启动与数据保留

- 与获用户授权协调的“介绍项目亮点”确认窗口，42个Worker活动数为0后备份正式lib；正常退出Desktop再 `node scripts/build.mjs`。Host与preview字节一致，Client去构建region来源注释后一致，546个sidecar/类型/map逐项匹配。正式Host SHA256 `d1486a463750761cd8190bf4a65ef72d93c4be80a2b31ae82ee046d204485fad`，Client `32b9c84ec1603c428bb473e3fa45104e6560241e4d26107a9743dfd51e007337`。
- 本次只更新插件lib，不改6份profile或205份context-clean宿主文件。停止态核对6205份原记录：6203份哈希完全相同；另1份已暂停followups仅“Host已重启”变为“Host已关闭”，反向替换该单句后哈希完全相同，没有发送队列；host.lock正常退出删除。2659份工作流文件除已退出host.lock外2658份不变。
- 首次冷启动UI验收被Mac锁屏阻止；用户解锁后，已读取冷启动Desktop（PID1552），核对加载的正式插件哈希。父管理页保留12个子Agent；退出侧栏原有全屏状态后恢复并核对主会话与侧栏并排，未发送消息或恢复队列。
- 真实原会话 `hermes-2`：原生两层过程在正文上方展开，消息/底部4.1K tok、2轮2步、上下文0.39%和4.1K/1M正常；第一次停止的轮次保留。`agy-2`：正文、消息/底部21.7K tok、缓存0%、上下文12%及约29.7K/256K正常，三类约14.8K/13K/2K。`pi-1`：正文、消息/底部8.7K tok、缓存0%、上下文0.87%及约8.7K/1M正常。Pi与AGY截图轮次未公开思考，没有伪造展开；Hermes/Pi旧轮次缺失分类继续三行“—”，此次新采集分类另由前述真实运行回放验证。所有来源说明仍移除。
- Desktop验收后的保留快照：6份profile与205份宿主扩展全部哈希不变；6205份用户记录中6202份不变，变化为两份打开过的AGY/Pi Worker元数据和host.lock。两份元数据长度不变，但没有原文备份用于逐字段比较，因此不宣称它们完全未改；原始会话日志、运行事件与raw均哈希不变。2659份工作流文件除随冷启动更新的host.lock外2658份不变。对应 `preservation.json`、`desktop-acceptance.json`；核查结束后已释放Desktop窗口供已协调任务使用。
- 第16.1–16.6已按实际证据完成并核对严格规格校验。Desktop只读验收没有新增模型调用；Windows、真实工具/取消/原会话续聊及全CLI订阅边界仍保留第7节，不归档、不推送、不发布。

## 2026-10-17 v0.8.1 第 17 阶段：五图续聊、新版宿主兼容（验收中）

- 真实五图逐样本只读核查：Grok 1.0.62 精确历史为 1477/256000；公开状态零模型握手另为1344/500000，不能混用。ZCode 0.16.9 三轮账单15731/15753/15784，原生分类估算 system2192、tools18751、messages148/204/324；估算和压力口径独立。只有第二轮有公开思考，首/第三轮无公开内容。
- OMP 16.4.4 真实生产 bridge 接本地模拟 SSE，验证实际请求 low、summary detailed、sequential_cutoff 与公开摘要done事件通路；真实截图run无公开摘要。AGY 实际保存记录无thinking/rawThinking/redactedThinking，只有signature；实际print类型不输出公开思考。未把最终正文或签名改成推理。
- 已补 Grok 状态订阅/模型更新/精确持久上下文及 ZCode 原生完整请求分类、当前模型身份约束；上下文检查点区分 pending、真零、unknown，ZCode bootstrap全零不覆盖旧统计。交叉审查新增模型切换失效及文件竞态/白名单加固回归。
- 用户已升级 Desktop 至0.2.1-rc.1；实际应用build stamp为ed75efeffee65f9fe93625bbd76a68cb219aaaf9，官方源码tag commit为1600d8a1e140dcde43a1a0941940a0480712c011，两者分别记录。官方npm四包与安装包一致（仅生成CSS命名/路径差异），原rc2覆盖已不存在。
- 新版已授权四包候选220文件校验、514项宿主关联回归及四包类型检查通过。插件关联回归15文件145项、rc.2真实SDK子代理相关4文件69项、0.2.1-rc.1真实AgentLoop/Subagent/Session/Tools完整测试1项分别通过；各组有重叠，不相加。插件新旧Host及新版Client类型检查通过，根40个SDK链接与2份metadata未变。
- 新版隔离浏览器首次实际加载发现生成的Remote客户端将 `@deepseek-ai/dsh-typert-protocol/remote-info` 留为external，官方模块表没有该纯helper。已按新版官方 `INLINE_SAFE` 将typert-protocol及其子路径加入最终Client的alwaysBundle，保留真实SDK描述符功能；构建相关2文件4项测试通过，含未内联故障对照与真实helper执行。修复后的Node 24隔离preview构建通过，没有修改用户SDK或重装根依赖。
- DSH 0.2.1-rc.1官方SDK与新版四包候选的完整原生侧栏浏览器回放已通过。所有页面明确标注“真实记录回放，非新运行”；true-zero与unknown另标“模拟边界”。界面fixture没有经过新的WorkerRuntime任务执行，真实WorkerRuntime另用受控离线子进程完成三轮pending／有效采样／续聊初始零、真实零、显式unknown不复活及冷恢复回归，不把这两类证据混用。
- ZCode第二轮pending保留上一轮15.7K tok、缓存0%、上下文8%，见 `browser/zcode-second-pending-ui.json`；第二轮公开thinking在原生过程区展开且位于正文上方，见 `browser/zcode-second-expanded-ui.json`。第三轮pending最终复验保留15.8K tok、缓存99.7%、上下文8%，对应 `browser/pass2-third-pending-ui.json`、`browser/pass2-third-pending-state.json`，真实渲染截图已读取；第三轮complete的第一pass证据 `browser/zcode-third-completed-ui.json` 显示15.8K tok、缓存99.5%、上下文8%，对话消息分类约324。两个pass按各自状态记录，不将完成态缓存比例套给pending。
- Grok回放原生上下文0.58%，精确数值1477/256000；没有公开thinking，三分类继续未知。OMP回放无公开reasoning，原生三类约2.4K／4.6K／756；AGY回放正文正常且无公开reasoning，本fixture未带原生DB，所以上下文未知，真实Desktop数据另待验收。`browser/true-zero-ui.json` 验证真零显示0%，`browser/unknown-ui.json` 验证未知显示“—”；根会话列表只保留父级，子Agent留在原生层级。弹层仍仅原生三行分类，不显示来源说明或重复英文分类。
- 私有证据位于 `.test-data/five-cli-followup-20261017/` 的grok、zcode、omp-agy、host-upgrade及browser；关联日志含 `combined-tests-final.log`、`preview-final-node24.log`。阶段17.2按上述Runtime和浏览器证据完成；17.6仍待最终插件／四包候选安装到Desktop、冷启动与只读验收，不勾选，不宣称本阶段Desktop成功。真实模型调用0，旧日志只读；Windows、全CLI真实调用及新增工具执行未复验，第7节不归档。
- 两次隔离服务均已停止，任务浏览器页已关闭并释放，验收汇总为 `browser/acceptance-report.json`。安装前只读检查49个Worker、活动0、未知状态0；桌面控制超时后核实Mac再次锁屏，已等待用户手动解锁，正式lib/profile尚未安装或更新。另一任务“调整功能”也准备安装，跨任务协调授权另待用户确认。
- 严格校验最终通过：`pnpm --config.verify-deps-before-run=false spec validate integrate-native-cli-conversations --strict --no-interactive`。此前裸pnpm触发新版依赖预检查并因无TTY退出，未允许清理根依赖；此次仅禁用自动安装预检查，继续调用项目锁定OpenSpec。`git diff --check`通过。

## 2026-10-17 v0.8.1 第 18 阶段：当前 Desktop 的构建与接口适配

### 实施与已完成验收

- 用户已手动更新 Desktop。实际应用为0.2.1-rc.2、构建标记 `332895e0f7c9d4dbfb29729f5eb367fa263ff986`；官方源码 tag `dsh-v0.2.1-rc.2` 对应 `687f282e8625c6b8d11ff58211a90524be2e4317`。两种来源分别核对，未把应用构建标记当作公开源码提交。
- 插件40项SDK开发依赖使用 `.cache/cliworker-build-deps-021rc2` 的完整独立依赖图及独立store，禁用安装生命周期脚本；根既有SDK链接及依赖metadata保持。SDK开发输入固定用于可复现构建；用户要求不再以宿主版本白名单限制加载，DSH peer使用 `*`，运行时继续检查实际生命周期方法、SessionReference/代际、原生侧栏Slot合同和 `provideProjections`。支持版本仅在Release按实际验收事实说明，不由放宽peer推定。
- 已授权四包形成 `host-extensions/dsh-0.2.1-rc.2` 与 `artifacts/dsh-host-extension-021rc2-data`，旧rc.1目录和证据保留。官方两次release在四包与slot文档范围仅package版本变化；移植后229个生产源码文件与前一候选完全一致，保留新版原生flow。补丁另更正一项遗留测试为实际原生UsagePill。四包manifest的220文件完整验证通过。
- 插件Host/Client类型检查、四包类型检查通过；四包定向8文件268项与插件构建关联2文件11项分别通过，不将重叠测试相加。构建修复仅Client的Typert helper从选定SDK解析并内联；Host保留官方SDK external，不复制宿主Remote类。证据为私有 `.test-data/dsh-021rc2-compat/sdk/`、`.test-data/dsh-021rc2-20261017/`。
- 完整原生侧栏隔离浏览器10项检查通过，见 `.test-data/five-cli-followup-20261017/browser-rc2/acceptance-report.json`。ZCode首轮完成、二轮pending/展开、三轮pending/完成，以及Grok、OMP、AGY和明确模拟zero/unknown均核对；ZCode公开思考y=542.5、正文y=574，顺序正确。模型调用0、真实CLI进程0。数据为已保存协议回放和明确模拟边界，未经过新的真实RuntimeTask；AGY夹具未带原生DB，因此不能以其未知context替代真实Desktop历史的验收。失败的脚本作用域、初始折叠、身份不完整夹具及过期页面尝试保留，不计作通过。

### 正式安装进行中与保留边界

- 首次正式构建按严格比较门禁中止：81个文件仅存在构建根不同产生的源码路径注释差异；脚本已恢复原lib，profile未改。后续只对已核明的路径注释采用窄白名单规范化，运行代码、类型声明、脚本和静态资源仍须按文件集合与内容比较；差异不能泛化为忽略任意代码或字符串。
- 本记录写入时，根任务正在按最终preview验收、停机、私有原lib/profile备份、正式构建、窄白名单比较及profile CAS门禁重试安装。**正式安装完成与Desktop冷启动尚待根任务报告，未记为通过。** 不运行模型、不改选型，后续只读核对旧历史统计、原生模型/权限菜单、父子隔离和资料保留。
- 插件版本保持0.8.1。本阶段不涉及其他插件的兼容改造；不推送、不发布。旧阶段的Windows、全部CLI真实账号/订阅、外部MCP、真实工具执行及第7节其他未验收项继续保留，未以本次隔离浏览器替代，不归档掩盖边界。


## 2026-10-17 v0.8.1：Qoder CLI 原生接入

- 新增第十二个独立 CLI `qoder`，纳入明确派遣、项目偏好、开关、路径管理、账号终端、原生侧栏、排队/停止及结束后续聊；现有 CLI 和历史 Worker 的 transport 不迁移。版本保持 0.8.1，未推送或发布。
- 核验官方 npm CLI 1.1.73（官方网页更新日志暂到 1.1.72），选择其 ACP v1：stdio JSON-RPC 2.0/NDJSON、session/new/load/prompt/cancel、真实 configOptions 模型/强度/权限回执。CLI `accept_edits` 与 ACP `acceptEdits` 分开处理；当前 ACP 未公开 plan，界面和运行前均拒绝规划。工具保留 `_meta.qoder.toolName`、rawInput/rawOutput 和公开思考；额外权限拒绝、工具失败/缺终态及进程退出异常不能标成功。
- 浏览器账号使用同一安装 CLI 的官方 stream-json `initialize → account_info → end_session`，SDK qodercli 只读认证描述文件为私有 0600，不解密原生账号、不引入 SDK 运行时依赖。稳定 userId/organization、Qoder 自身 PAT 及 user/project/local 的 provider/modelConfigs/auth 和原生 BYOK customs 密文摘要进入账号版本；拒绝未绑定的 QODER_PAT 别名、动态凭据引用及未支持的 CN/job/service/自定义服务路由。真实账号续期留给原生账号终端，查询不刷新或回写凭据。
- 模型目录使用独立 ACP 元数据会话，取得完整模型 ID 后逐模型读取实际 reasoning_effort；不从 --list-models 显示表格猜 ID。只关闭并删除本次新建的空查询会话；关闭失败仍尝试删除，清理未确认时保留私有状态并报错。
- Qoder 整轮 prompt usage 的 input/output/total 作为 run 账单，重复快照不相加；未知的单次响应、cache、context 与 Credits 不补零。DSH MCP 桥复用临时 ACP 注入与现有授权链；真实工具调用仍未验收。
- 官方透明 PNG 已下载并原样打包；SHA-256 `b0a3c6959fca7d07d5e840bd4fb23e5e8c1a9b5a528700d683476e2bfddd3900`。复用既有单色明暗主题和光学大小，22/24/32px 对照已实际浏览器渲染并读取截图；运行资源见 [Qoder 图标](../src/client/assets/qoder.png)，来源为 [Qoder 官方 PNG](https://img.alicdn.com/imgextra/i4/O1CN012JUQmkuk4LH0cGga_!!6000000004828-2-tps-304-304.png)；独立预览素材不属于本次发布交付集合。

### 实际验证

| 命令/检查 | 结果与范围 |
| --- | --- |
| `pnpm --config.verify-deps-before-run=false test --maxWorkers=2`，18 个关联文件 | **694 项通过**；覆盖 Qoder、ACP、账号绑定/隔离、目录授权、路由、存储、设置、路径、账号终端、工具桥及权限。完整文件列表和输出见私有 regression.log。 |
| Qoder 专项 `tests/native-qoder.test.ts` / `tests/qoder-accounts.test.ts` | 稳定回归时各 **30 项通过**，包含在上述 694 中；最终 stdin 防护后账号专项 **34 项通过**，不与前组相加。全部明确模拟，未使用真实模型和账号。 |
| 三项 `panel.test.tsx` 队列动画隔离复跑，`--maxWorkers=1` | **3 项通过**。首次并发运行错过现有 252ms 退出动画窗口；未修改生产队列逻辑或既有测试。另两项 Qoder 首轮失败来自测试启动后代码继续修改，稳定源码定向重跑已通过；工具桥 stdio 初次并发超时在最终低并发回归通过。 |
| `pnpm --config.verify-deps-before-run=false typecheck` | Host/Client 通过，实际开发 SDK 为 DSH 0.2.1-rc.2。 |
| `pnpm --config.verify-deps-before-run=false build:preview` | 最终隔离构建通过；565 个 lib 文件，全部 src 与已接受的 preview 一致，Qoder transport、runner 及官方 PNG 实际进入 bundle。 |
| `pnpm --config.verify-deps-before-run=false spec:check` | 归档前 19 项通过；既有 release-v078 的重复增量 INFO 属其他变更，不在本次处理。 |
| `node --import tsx scripts/smoke-native.ts --help` / `git diff --check` | 通过；help 不启动 CLI；未全量验收、未真实模型调用。 |
| 官方 1.1.73 隔离探针 | 非模拟 initialize、明确模拟空 ACP 会话配置/关闭，以及明确模拟 SDK 账号元数据查询通过；真实无账号 SDK 返回 auth_required/exit41。没有发送 user/prompt。 |

私有结果与独立已接受构建保存在 `.test-data/qoder-cli-20261017/`：verification.json、regression.log、account-tests.log、typecheck.log、preview.log、panel-isolated.log、spec-check.log、accepted-package/。这里的日志和产物不会进入 Git。协议、版本、精确 wire 和官方来源见 [Qoder 原生协议核验](qoder-protocol.md)。初始裸 pnpm 触发依赖自动检查并因无 TTY 退出，后统一关闭该自动检查，未重新安装根依赖。

### Desktop 协调及未验证边界

- 已只读核对 49 个已保存 Worker，活动为 0。发现另一聊天正在同一 Desktop 做冷启动和 ModelSelect 兼容验收，因此未自行覆盖其正式 lib/profile 或重启应用。
- 用户已明确授权与「确认是否能读取其他会话」协调并更新 Desktop，协调消息已发送；本节写入时，等待合并安装窗口，正式 Qoder Desktop 更新和界面核对尚未记为通过。
- 本机未发现已安装的 qoder/qodercli；没有全局安装、没有用户登录或选型，没有真实账号/模型请求、真实文件产物、同会话续聊/取消验收，Windows/Linux 实机未验证。上述边界保留，不以模拟回归、初始化或规格归档替代。

- Qoder 变更 `add-qoder-cli` 的 7 项实现与定向验收任务完成，已同步 `openspec/specs/qoder-cli/spec.md` 的 4 项需求并归档至 `openspec/archives/add-qoder-cli/`；归档后严格校验仍为 19 项通过。Desktop 安装和真实模型等上述边界不因归档改变。
- 用户授权协调后，合并源码已包含另一聊天的原生 ModelSelect 标签子槽修复。最终复核补充账号与目录两类元数据进程的 stdin `error` 监听，防止 CLI 提前退出时 EPIPE 成为 Host 未捕获异常；失败使用固定安全文案，等待受管进程和读取完成后移除监听。新增四项明确模拟回归，分别覆盖单独 error 事件和真实 Writable write-callback/EPIPE 事件；修复后账号专项 **34/34**、Host/Client 类型检查通过。此前 18 文件 694 项为此窄修复前的稳定结果，各组不累加；日志为私有 stdin-error-tests.log、final-typecheck.log。
- 按安装门禁使用普通 Node 24.19.0 与 `.cache/cliworker-build-deps-021rc2` 一次重建最终 preview 通过。全部 src 与 preview 逐文件一致；565 文件的 lib 清单（相对路径到文件 SHA-256 的排序紧凑 JSON）SHA-256 为 `49d0e09c8e57a5075cf0237ff3150f40d14f7078d11f5104dfae5cbfa3f12aca`，Host 为 `191536ae4fd0677d1997912795a8e024cea1fd88a2995169274d810377949b15`，Client 为 `6c60b6f60e3098675f78f915bb14ebb0c1f0f153f3d732bb9e928dbf7fd74c36`。独立 accepted-package、final-lib-manifest.json、final-source-manifest.json 和 verification.json 已同步；源码与构建输入真正冻结，正式构建/重启窗口交还该聊天，本聊天不并行写根 lib 或操作 Desktop。
- 用户随后明确要求将本聊天全部任务交给负责合并的 agent，交接后结束。剩余正式安装、冷启动、Qoder Desktop 入口/官方图标/未安装提示的只读验收、证据与记录更新，全部转交「确认是否能读取其他会话」统一接续，无需再向本聊天交回 GUI。完整私有交接为 `.test-data/qoder-cli-20261017/handoff.md`；本条不表示 Desktop 已通过，未验证边界保持。

## 2026-10-17 v0.8.1 第 19 阶段：Qoder 合并、元数据隔离与设置加载优化

本节接续前述交接，只记录本轮已经取得的证据；此前“本机未安装 Qoder”“等待合并窗口”等为当时状态。当前已观察到原生 Qoder CLI 1.1.73、`~/.qoder/entry/qoder` 及既有浏览器登录，本轮没有代用户安装 CLI、登录、续期或变更账号。用户限定继续验收 Desktop，保留在用独立 Web；本轮未继续联系其他聊天。最终安装、冷启动、设置加载和资料保留已完成，结果及仍未验收的真实调用范围见本节末尾。

### 元数据失败定位与隔离修复

- 初始真实目录查询已收到 17 个模型，但清理采用 `session/close → session/delete`，close 释放内存会话后 delete 转查不存在的 transcript，返回 `-32602`，使整个目录查询失败。直接删除本次空查询会话的窄修复并不构成最终验收：随后编译 preview 探针仍失败，且原生 `.models/default` 发生变化。官方 bundle 静态核查确认该文件是初始化重写的 server-default cache；ACP `setModel` 默认临时选择，`persisted:true` 属遥测字段，不能将该缓存变化描述为用户保存模型选型被改写。
- 官方 ACP 入口会重设认证存储策略，因此不能只给 ACP 增加 SDK 环境变量就承诺原账号只读。目录查询改用同一已安装 CLI 的 SDK stream-json `initialize.models`；账号仍用 `initialize → account_info → end_session`。每次查询单独创建 0700 临时配置根，保留必要的 user settings、`.env`、原生加密 customs；通过 `QODER_SDK_AUTH_CONFIG_DIR` 和 `type=qodercli` 使用原账号只读策略，不复制浏览器凭据、不刷新登录。自定义 provider 使用官方 SDK gate，模型/强度来自原生公开字段，不套用别的 CLI 选项。
- 官方 settings 初始化存在 user/project/local 旧字段自动迁移，故保留真实 cwd 时先拒绝需要迁移的项目设置，并检查 `.env` 路由边界；不静默迁移用户配置、不用隐藏项目设置来掩盖模型来源。机器身份缺失时要求原生 CLI 修复，不让只读浏览器查询生成共享机器身份。正常结束须收到 `end_session` 回执并确认进程范围退出；仅能将本次已拥有的正常终止与官方 143 行为关联，自然异常退出、提前强杀及退出未确认不能冒称成功；已确认 end_session 后由 Host 发起的本次终止仍须按归属及完整范围退出判定。
- 隔离修复的 Qoder 关联回归 **3 文件 94 项通过**，独立静态复核通过；这是明确模拟回归，不与前述 694 项或后续性能回归相加。最终隔离 preview 的真实元数据探针收到 **17 模型、2 个控制请求**，`end_session` 确认、exit0、进程范围退出、私有根移除均通过；共享保护文件前后哈希一致，没有新建持久会话或遗留本次产物。没有发送 user/prompt，模型调用为 0。
- 失败与修复证据保留在 `.test-data/qoder-catalog-cleanup-20261017/`：`source-review-summary.json`、`preview-check/verification.json`、`preview-final-check/verification.json`、`targeted-tests-final.txt`、`official-metadata-evidence.json`、`static-config-evidence.json`。失败探针的 `protectedUnchanged:false` 和非零退出结果保留，不以之后成功覆盖历史。

### rc.2 已安装基线与 Desktop 历史界面

- 隔离修复版已于 `2026-10-17T14:29:44Z` 安装并冷启动，后续性能优化以此版为冻结基线。实际 Desktop 为 **0.2.1-rc.2**，应用 build `332895e0f7c9d4dbfb29729f5eb367fa263ff986`，对应四包公开源码 tag commit `687f282e8625c6b8d11ff58211a90524be2e4317`；两种标记分别核实。只更新 root `lib`，六项 Desktop profile 哈希与安装回执一致，四包 **220 文件**及实际绝对入口通过核验，app.asar 未改。
- 此版正式树 SHA-256 为 `184ed2ec7d4f8d908aac1fcdeb68abe41fb6320bf60572e3d8aa4853d87d558d`，源码与 preview 一致。565 个构建文件中 563 个字节一致；差异仅 `client.js` 的 81 个已审查 region 来源路径和 `client.js.map` 对应 sources，严格白名单外内容及 sourcesContent 相同，不泛化为忽略所有注释或 map。普通 Node 24.19.0 用于构建与比较。证据为 `.test-data/desktop-acceptance-20261017-final/install/installed.json`、`final-integrity-verification.json`。
- 安装基线只读检查时共 **49 个 Worker，活动 0、未知 0**；账号终端进程、临时账号目录及活动 lease 均为 0。独立 Web 通过完整 argv 精确识别，PID 45302 及其两项配置哈希保持，未关闭或替换。该检查只说明对应时间点；性能版最终保留结果另待追加。
- 12 个 CLI 的设置导航均实际呈现；以下 **9 个 CLI 的既有会话界面**在 21:26 安装基线、Qoder 目录修复前已逐项检查，未发送新任务。该历史矩阵不等同于性能候选已完成全部冷启动复验，也不代表全部模型菜单或当前账号均可执行。

| 历史 CLI | 实际 Desktop 核对 | 保留的限制 |
| --- | --- | --- |
| ZCode | 三轮历史、正文上方公开过程、三类上下文、原生权限菜单；约 15.8K/200K、8% | 当前账号绑定已变化，模型菜单正确拒绝；没有重写旧选型或宣称目录可用 |
| Antigravity | 原生模型菜单及子菜单，Gemini 3.8 Flash / Low 保留；约 29.8K/256K、12%及分类 | 样本无公开思考，不伪造可展开过程 |
| OMP | 历史正文、原模型、三类上下文；约 7.9K/272K、3% | 样本无公开思考，不伪造展开 |
| Grok | 历史正文和低占用百分比；约 1.5K/256K、0.58% | 未公开的分类继续未知 |
| Hermes | 原停止/完成轮次保留；4.1K/1M、0.39% | 旧轮次缺失分类继续未知，不重写历史失败/停止状态 |
| OpenCode | 两轮历史、原模型和三类上下文；约 12.7K/1M、1% | 未新增真实执行验收 |
| MiMo | 历史正文、原模型和三类上下文；约 27.8K/1M、3% | 未新增真实执行验收 |
| Pi | 历史正文、分类及低占用；约 8.7K/1M、0.87% | 未新增真实执行验收 |
| Claude Code | 历史正文、原模型与默认强度、原生用量及 23% 上下文 | 未新增真实执行验收 |

- Codex 设置显示既有原生登录和额度耗尽提示，模型/强度控件禁用；Kimi 显示既有账号及过期或临近过期凭据提示，模型/强度控件禁用。未刷新登录或尝试模型请求，这两项仍属账号/订阅限制，不计作运行通过。Qoder 初始目录错误时安全禁用未选控件；隔离修复版冷启动后已看到既有登录及默认模型/强度控件，未替用户选择模型，最终性能版需另复验。
- 父会话留在主区域、子会话在侧栏、切换父级更新子列表、根列表排除 Worker 子会话，以及附件/分叉不支持原因均已核对；保存的模型/权限未改。原生控件关联 **1 文件 18 项**回归通过。界面证据为同目录 `ui-baseline-report.json`、各 CLI 的 `.ax.txt`/截图，以及 `qoder-final-settings-ready.ax.txt`；界面核对没有新 Worker run 或真实模型调用。

### 设置加载优化与实测性能

- 原设置目录冷查询和强制刷新各启动 4 个原生元数据进程，冷页另有 1 次账号状态查询。新实现仅在 Qoder 的设置路径启用 `selfVerifiedDiscovery`：一个元数据 scope 合并账号与模型目录，并在 scope 前后比较本地认证/配置来源摘要；没有引入账号 TTL、没有复用已完成的远端认证结果，也没有放松真实 Worker 的执行前授权。缓存命中仍执行 1 次原生账号核验。
- 性能修复的 **5 文件 158 项**回归、Host/Client 类型检查、普通 Node 24.19.0 隔离 preview 构建及独立源码复核通过。回归包含冷查询、刷新、命中/重开、取消、账号/来源变化与清理边界；测试均为模拟，和前述 94 项存在重叠，不累加。
- 主线程用同一已安装 Qoder 1.1.73、同一项目 cwd 和既有浏览器登录，对冻结的 `baseline-package/lib/types/host/` 与新 `.cache/preview-package/lib/types/host/` 分别执行一次顺序元数据计时。脚本动态导入所选构建，未导入当前 src 替代基线；缓存仅写私有测试目录，stdin 仅允许 `initialize/account_info/end_session`。以下均为 **Host 阶段耗时，包含进程范围清理，不是 Desktop 整页加载时间**；没有把账号与目录耗时相加冒充 UI 耗时。

| 阶段 | 冻结基线 | 优化 preview | 原生元数据进程数 |
| --- | --- | --- | --- |
| 冷页账号状态 | 7.640 秒 | 5.849 秒 | 1 → 1 |
| 冷目录查询 | 22.241 秒 | 9.227 秒 | 4 → 1 |
| 同 Host 缓存命中 | 8.922 秒 | 8.149 秒 | 1 → 1 |
| 强制刷新目录 | 30.419 秒 | 8.667 秒 | 4 → 1 |

- 冷目录和刷新单次样本分别减少约 58.5%/71.5%，可确定的结构变化是 4 个元数据进程合并为 1 个；冷页账号加目录的进程总数由 5 降至 2。每阶段/构建只有一次样本，网络与原生服务波动仍会影响耗时，不声称稳定延迟或普遍加速比例。账号状态和缓存命中进程数没有减少，尤其 **8.922 → 8.149 秒的 warm 差异不归功于本次优化**，仍保留一次原生验证成本。
- 两版均返回 17 个模型，保护文件哈希保持，所有已启动元数据进程收到结束回执、确认范围退出且私有根删除；真实模型调用为 0。证据在 `.test-data/qoder-settings-performance-20261017/`：`comparison.json`、两版 `*-measure/verification.json`、`targeted-tests.txt`、`source-review-summary.json`、`typecheck.log`、`preview-node24.log`。这是实际 CLI 元数据查询，不是生成任务、工具执行或订阅可用性证明。

#### 性能版首次 Desktop 复验发现的查询预算问题

- 第一版性能候选于 `2026-10-17T14:53:13Z` 完成更新，源码摘要 `2512e8424baad916d3dbfbaa90bf004c0850aa43a3a144cdb14763856d420200`。冷启动恢复父管理页，Qoder 账号与模型菜单可用，既有 Qwen3.8-Flash 保留；菜单和官方图标已截图核对。Client 相对隔离修复版只有 16 处生成 Remote 调试位置的行号变化，已逐差异验证；未改设置布局或历史界面逻辑。
- 此轮 Desktop 父项目为默认工作区，与 Node 阶段计时使用的插件仓库项目不同。截图轮询观察到显式刷新在 15.036–17.409 秒之间完成；冷开在 15.133 秒尚加载、49.589 秒再观察已完成，中间没有连续采样，**不能将 49.589 秒当作准确加载耗时**。重开于 12.253 秒已出现模型入口，但账号显示暂不可用，未把该次判为通过。证据 `performance-ui-first-pass-summary.json` 和完整 AX 时间序列保留。
- 原因是 AccountManager 外层通用 10 秒截止预算可能在 Qoder 已取得元数据、仍等候范围退出时先行取消，而其自身原生查询已有 15 秒预算。只将 Qoder 外层预算对齐为 15 秒，其他 CLI 保持 10 秒；15 秒是工作截止时间，取消之后仍须等待清理完成，不能硬切断退出检查。
- 两次只读元数据实验分别在结束回执后关闭 stdin、关闭 stdin 并等 1 秒自然退出；两次仍进入 Host 的终止升级，未证明提速。没有把这些实验合入源码，也没有缩短 5 秒进程清理宽限。实验有独立保护哈希、结束回执及范围退出证据，模型调用 0。
- 最终窄修复 **6 文件 241 项**回归、独立复审、普通 Node 24 的 Host/Client 类型检查与隔离 preview 通过。模拟时钟真实走 AccountManager/Qoder transport，验证元数据 6 秒加清理 5 秒在 11 秒才返回 authenticated；15 秒仍无元数据时取消、用户主动取消均先触发终止并等待范围退出，不发布账号成功。
- 最终 preview 再做实机冷开阶段复验：账号 9.379 秒、目录 5.488 秒，合计两个原生元数据进程；17 模型、来源保护哈希不变、范围退出与私有根清理通过。这个补测仍不是 Desktop 整页耗时，差异包含原生退出/网络波动。证据 `preview-final-measure/verification.json`、`targeted-tests-status-budget.txt`、`typecheck-final-node24.log`、`preview-final-node24.log`。

### 最终安装、Desktop 复验与资料保留

- 最终候选于 `2026-10-17T15:06:13Z`（北京时间 23:06）完成更新并冷启动，源码摘要 `1ae699191ef8a079978b545a5743069b41c0b4ae4f17d0d38b606a4d51199191`；正式树 `5b814e592d909d8ce89682131615272a87ecb6099db8e5a78c87bd207062ae0b`，preview 树 `116d00aff9acdf4733ae9a043034425d87b91e2b325c1a801643028a21605e0c`。独立备份保留，565 文件通过前述严格路径注释比较。旧阶段失败、初版性能安装和超时异常证据均保留，不覆盖成成功。
- 最终 Desktop 用实际默认工作区连续复验：Qoder 首次打开在 **7.224–7.432 秒**之间就绪，手动模型刷新在 **8.893–9.817 秒**之间就绪，关闭设置后重开在 **7.418–7.619 秒**之间就绪。三次均显示已登录、模型/强度入口可用；这是单次 AX/截图采样区间，包含采集开销，不保证所有网络条件下的固定延迟。与前述 Host 阶段计时分别记录。
- 官方 Qoder 图标、统一设置文字/控件布局、模型菜单及现有 **Qwen3.8-Flash / Low**已目视核对；性能验收没有选择新模型、修改权限、登录/退出或发送任务。最后返回原父会话管理页。九 CLI 历史矩阵沿用本节实际 Desktop 证据，模型状态阻断及无公开思考边界保持，不宣称新的真实生成/工具运行通过。
- 最终只读安装核验通过：6 项 Desktop profile 字节保持、4 个宿主扩展包的 220 文件及实际引用保持、独立 Web 的 PID 45302/完整 argv/两项配置保持、49 个 Worker 活动 0/未知 0、无账号终端或活动 lease。Qoder 保护快照与实际进程检查通过：原账号 user/machine_id、用户配置/默认缓存/所测项目来源及既有原生会话文件哈希不变，无 Qoder 元数据进程、无私有元数据根残留。此保护快照的项目树范围为探针仓库，Desktop 默认工作区不据此冒充全树逐文件比对。
- 长窗口插件状态 before/after：原 21249 个普通文件中 **21246 个哈希相同、0 缺失**，31 项链接哈希保持；119 份 raw、39 份 stderr、49 份 events、39 份账号绑定及49份 Worker 全部保持。3 项变化为 host.lock 和两份 Hermes 账号状态文件；只有原哈希，没有两份凭据原文基线，故不声称全部凭据逐字未变，也不猜测或回滚其内容。2 个新增文件为 Qoder 偏好和授权目录缓存，创建于 14:31Z、早于性能优化基线；性能版保留该选型，没有覆盖已有偏好。
- 完整证据：`.test-data/desktop-acceptance-20261017-final/final-acceptance.json`、`performance-final-integrity-verification.json`、`preservation-final.json`、`final-qoder-ui-timing.json`、`final-qoder-*.ax.txt/png`、`install-performance-final/installed.json`，以及 `.test-data/qoder-settings-performance-20261017/desktop-protection.json`。私有证据不进入 Git。
- 仍未验收 Qoder 的真实模型生成、工具/MCP、同会话续聊/运行中取消、PAT 实机与 Windows/Linux；其他 CLI 的订阅限制及全部真实工具链路保留在整体 OpenSpec 第7节。版本保持 **v0.8.1**，本轮模型调用 0，未推送或发布。只归档 Qoder 查询隔离/性能修复，整体原生会话及协议迁移的未验收任务继续可见。

- 收尾严格校验：归档前 `spec:check` **20/20**，主规格独立 strict 校验通过；同步 Qoder 两项新增需求（主规格共6项）并归档 `2026-10-17-fix-qoder-catalog-cleanup` 后 **19/19**。整体集成保持92/94，原生协议迁移保持13/14，未完成真实验证未勾选。`git diff --check`通过。

## 2026-10-17～18：v0.8.1 三张真实截图回归

- 主模型目录：内部 `CliConversationAdapter.listModels()` 不再公布 Worker 实例模型，精确 `resolveModel()` 保留。官方主目录过滤空组，CLI 侧栏继续使用当前 Worker 的独立目录；没有修改 Harness 核心或父会话选型。
- Qoder：官方 1.1.73 在隐藏计数时返回全零。新旧账单、消息脚注和旧 `lastRunUsageSnapshot` 均不再把该占位当作真实零；非零输入仅标“CLI 报告输入”，缓存未知。按真实 ACP `userMessageId` 对应的原生 user UUID、parentUuid 链及精确项目／会话／模型读取 `context_usage_ratio`。截图历史可核对比例为 **17.617777…%**，原生界面显示 **17.6%**；Token 数、容量和分类仍未知。轮／步及 TTFT 弹层说明 Harness 调用 CLI 的统计范围。
- Grok：截图轮次公开了 21 reasoning token，但没有可读思考事件，只有正文、用量和不应提取的 signature。新增原生 turnTail 说明“Grok 本轮未提供公开思考内容”；有真实公开思考时继续原生展开，工具不受影响。首次完整浏览器检查发现官方 producer 不提供类型中可选的 `requestConfig`，原手写夹具误带该字段；已改为严格 Host 绑定、父子地址和真实 finalized message 的轮次／步骤／序号范围，新增实际官方 producer 形状回归。初次失败不计通过。

### 定向验证与证据

- 首次 `pnpm` 自动依赖检查尝试联网安装并因 TTY 拒绝；随后使用 `pnpm --config.verify-deps-before-run=false` 调用既有锁定工具，没有更新或替换根 `node_modules`。根已安装 SDK 仍为 0.2.0-rc.2；实际目标 0.2.1-rc.2 的类型／构建使用既有隔离 SDK，完整原生浏览器和 Desktop 也使用 0.2.1-rc.2，分别记录，不混称同一依赖图。
- 最终普通 Node **24.19.0** 执行 `node_modules/vitest/vitest.mjs run` 的关联回归 **19 文件、328 项通过**，文件清单及原始 JSON／日志在 `.test-data/native-cli-regressions-20261017/combined-tests.json`、`combined-tests.log`。Qoder 定向 **118 项**、最终原生组件 **73 项**、Grok 真实 producer 形状 **35 项**分别有独立记录；分组重叠，不相加。
- 同一 Node24 执行 `scripts/build.mjs --typecheck-only`、`scripts/build-preview.mjs` 通过，目标 DSH **0.2.1-rc.2**。四包 Client 类型检查通过，`scripts/build-host-extension.mjs --target 0.2.1-rc.2 --out artifacts/dsh-host-extension-021rc2-regressions` 构建及 `--verify` 通过：**4 包、220 文件**，补丁 SHA256 `c6e406fa80f64e2e44de903308725f4a0eae1dc9ffafae635a0ec4271d86b6bd`。
- 完整原生隔离浏览器 **10 项通过**：主模型隔离、Qoder 三项统计及子模型菜单、Grok 公开思考展开、无公开思考说明与工具展开共存、子会话不进根列表。全部文本／统计场景明确模拟，真实模型、CLI 和工具执行为 0。工具夹具初次错误使用小写 `completed`，被生产代码正确判为缺失终态；修为内部 `COMPLETED` 后真实持久回执仅1条、`isError=false`、固定结果一致，保留前次失败。浏览器测试令牌传递曾被自动审批拒绝，用户明确允许本次本机模拟验收后执行；临时 Host 与浏览器任务均已清理。
- 隔离证据位于 `.test-data/native-cli-regressions-20261017/browser/`，最终 `final-ui-acceptance.json`、`final-native-ui-receipt.json` 与 `preview-input.json` 绑定实际输入哈希，原生截图已读取核对。真实历史只读协议核查分别见 `qoder/verification.json`、`grok/screenshot-run-evidence.json`。私有原日志、凭据和测试产物不进入 Git。

### Desktop 更新与资料保护

- 更新前 **51 个 Worker 均空闲、无账号终端／租约**，正常退出 Desktop，保留独立 Web 服务。已备份原 lib、四包及六份 profile 只读快照；正式 Node24 构建与预览比较 **571 文件中569份字节相同**，仅两份 Client bundle／map 的已审查构建根路径差异，运行内容及映射内容均等价。随后更新现有链接的 lib 和四包产物，**profile 六文件未写且哈希保持**。安装器具有候选／源码／预览／Node／App／profile CAS 门禁，候选绑定已验收 manifest，lib 和四包独立回滚。实际回执与备份在 `install/installed.json`、`install/backup-1792252464284/`。
- 冷启动实际 Desktop **0.2.1-rc.2** 六项核对通过：主目录仅 DeepSeek／zai-coding-cn，Qoder 原有 Qwen3.8-Flash／Low 保留，三弹层可打开，未知用量、17.6% 及来源／分类边界正确；Grok 原有23:19轮次出现缺失说明，正文及 **14.2K** 用量保留。实际截图和 AX 记录在 `desktop/`，总结为 `desktop/final-acceptance.json`。未发送消息或修改模型／权限。
- 资料基线 **17,823 文件**中 **17,820 份字节保持、0缺失**；另3份变化已精确证明：Grok Worker 仅属性顺序规范化；Qoder Worker 仅顺序变化及清除无效全零快照，内存重构两份原哈希均完全匹配；父会话原压缩记录前187,475字节完整匹配，仅追加82字节／1条宿主正常恢复 `session/end-seed`。没有新增模型／任务事件或原对话改写，账号、偏好、raw／events 和绑定均保持。证明为 `worker-preservation-proof.json`、`session-preservation-proof.json`、`protection-after.json`；没有恢复覆盖用户文件。
- 本轮真实模型调用、真实工具运行、真实续聊／取消及 Windows/Linux 未新增验收；整体原生会话和协议迁移未完成事项继续可见。版本保持 **v0.8.1**，未提交、推送或发布。
- 收尾：按本次已实现范围同步 Qoder 1项、会话交互2项增量需求，保留主规格原正文和 Purpose；归档前严格校验 **20/20**，2026-10-18 归档到 `openspec/archives/fix-native-cli-conversation-regressions/` 后 **19/19**，`git diff --check` 通过。活动整体集成仍为92/94、原生协议迁移仍为13/14，未验证事项没有虚勾或一并归档。

## 2026-10-18：v0.8.1 四图用量、公开过程与 OMP 目录优化

- Qoder `qoder-2` 的真实 ACP 与 transcript 只有隐藏全零计数和上下文比例，未发现可恢复的实际 token 数。精确绑定且账单为 null 的消息现在显示可点击的“用量未知”；底部保留 `Token 用量 —` 与可查看的缺失说明，17.6% 上下文不反推 token。断连清除数值，仅为最后已接受快照中的精确轮次保留未知标记；owner/generation 变化及最后释放清空旧映射，错误回执不能引入新轮次，普通原生统计不受影响。
- Hermes `hermes-2` 原始 hook/HTTP/数据库保留输入4,091、输出10、总计4,101及推理1，但规范化缓存零不能证明明确未命中。底部与弹层现在显示“缓存命中 —”及数据不足说明，保留实际 token；原生明确零仍显示0%，不把缺失转成零。未改写原始日志或凭空回填。
- 按要求移除原生 Grok turnTail 的“本轮未提供公开思考内容”。截图 Grok 只有21 reasoning token及不透明 signature，OMP 也没有可读思考或工具记录；原轮次没有可展开内容。已有公开思考和工具继续使用原生折叠组。已安装 OMP→生产桥→本地模拟提供方探针确认 `reasoning.summary=detailed` 与公开摘要传递，退出0；Grok 默认请求公开摘要但没有可用的另行开启参数。该探针不是真实模型生成。
- OMP 原生16.4.4旧缓存曾限制候选。现在受账号租约保护调用官方 `models refresh --json --no-extensions --config` 更新插件受管 registry，再与当前账号池和额度求交；任务RPC读取相同registry，取消等待元数据进程退出。用户和插件原始 `models.db/models.yml` 哈希保持，正常OAuth轮换沿既有身份校验与CAS保存。
- OMP 自身当前账号回执为 **free**，原生客户端协商版本0.144.1下只支持 `openai-codex/gpt-5.6-luna`、`openai-codex/gpt-5.6-terra`。同一OMP凭据改用本机Codex实测0.162.1版本的只读诊断多返回6-Luna，仍没有6.1-Sol或6-Astra；未把对照版本用于生产，也未借用Codex凭据或强加型号。原生RPC仅执行目录/选型/状态元数据，精确解析Luna、容量272000后主动SIGTERM退出143，没有发送prompt。证据见本节私有目录 `omp/REPORT.md`。

### 定向验收

- 关联回归分别通过：OMP/刷新/账号模型123项，账号池10项，过程与原生桥61项，Pi/OMP公开思考2项（其余67项未选），断连统计15项；原生聊天用量三组65项。分组有重叠，不相加。第一次OMP沙箱回归因loopback监听EPERM失败，授权本机模拟网络后重跑通过；pnpm依赖自动检查因非TTY失败后使用 `--config.verify-deps-before-run=false`，未替换根依赖图。
- 普通Node24.19.0执行目标SDK 0.2.1-rc.2类型检查、隔离preview通过；四包Client类型检查与宿主扩展构建/校验通过，**4包220文件**，补丁SHA256 `265b8827900afc937a837fa20318b11cd815faa6587d340ea1b096e888fee5f2`。
- 完整原生隔离浏览器7个明确模拟场景通过：Qoder未知用量、Hermes未知缓存、Grok/OMP公开思考逐级展开与键盘收起、无公开内容时完成行不可展开、Grok仅工具结果可展开且没有额外缺失说明。真实模型、CLI生成和工具执行均0；模拟Host禁止外部网络。初始工具定位忽略空格而超时，按最新界面精确名称纠正后通过，失败回执保留。4张截图已读取；最终8份成功回执及输入哈希绑定到 `browser/final-ui-acceptance.json`。模拟页面、浏览器任务和临时Host已正常清理。

### Desktop 更新

- 更新前52个Worker活动0、未知0，无账号终端/活动租约；正常退出Desktop，保留独立Web PID95979及两份配置。备份原lib、四包产物和六份profile只读快照，再正式Node24构建与预览比较：568文件中566份字节相同，Client bundle/map仅已审查的构建路径差异，运行内容和映射等价。安装后六份profile哈希不变，没有覆盖或重写用户配置。回执与备份在 `install/installed.json`、`install/backup-1792284284951/`。
- 冷启动实际Desktop 0.2.1-rc.2后，按四个真实Worker逐一复核：Qoder消息和底部弹层可打开，Qwen3.8-Flash/Low及17.6%保留；Hermes显示4,101与缓存未知；Grok多余提示消失，原正文、14.2K、缓存1%及上下文6%保留；OMP原正文、7.9K、缓存0%、上下文3%保留，真实模型菜单只有Luna/Terra且原选型未改变。Grok/OMP原空过程仍不可展开，不能把模拟公开思考验收冒充历史内容恢复。原生AX操作与截图在本次Codex工具记录，脱敏结果在 `desktop-acceptance.json`。
- 保护基线17,829份文件中17,824份哈希相同、0缺失、0新增。另5项已单列：一份Worker仅恢复顶层字段顺序即可匹配原哈希，值未变；一份父会话前205,476压缩字节精确匹配基线，仅追加82字节/一个空data的 `session/end-seed` 恢复标记，没有新增模型/任务事件。其余3项为OMP的 `agent.db`、WAL、SHM，与本轮正常OAuth续期及已有CAS保存流程一致；未做数据库逐行基线，不能声称这3份文件每个变化字节都已归因或账号文件全部未变。原始raw/events、绑定、偏好及原生模型配置保持。证明见 `worker-preservation-proof.json`、`session-preservation-proof.json`、`omp/preservation-note.json`（该OMP说明使用Desktop打开历史前的3差异中间快照）及最终 `protection-after.json`。
- 私有证据根为 `.test-data/cli-observability-20261018/`，未加入Git。未调用真实模型生成、未验证6.1-Sol/6-Astra生成、真实工具/续聊/取消、升级账号后的目录或Windows/Linux。版本保持**v0.8.1**，未提交、推送或发布；其余原生迁移的未验收事项保持可见。
- 收尾已按增量逐块同步模型发现1项新增、会话交互2项修改及1项新增，主规格标题/Purpose和未涉及内容保留；复核每项增量均已落入主规格后归档本次10/10任务到 `2026-10-18-fix-cli-observability-and-omp-catalog`，归档命令跳过重复合并。严格校验归档前20/20、归档后19/19，`git diff --check`通过。校验另有既存活动变更已同步需求的INFO提示，本次没有借机归档或改动其他变更。

## 2026-10-18：CodexHost 用量与缓存来源调查

- 按用户给出的仓库复查固定提交 `a8adb78b519a81795fc05b787811f20a9738d7f0`，阅读 Qoder/Hermes 实时、历史、元数据与测试路径，并对照其他共有 CLI 的用量来源；结论补入 `doc/cli-native-data-audit.md`。仅阅读外部仓库，未运行其安装脚本、服务或测试。
- Qoder SDK 读取消息/result用量，独立查询上下文、Credits和套餐；历史按消息ID去重，四桶全零标 `tokensUnknown`。插件当前可补非零历史缓存桶及独立Credits，但本轮调查未实施该行为变更。截图原记录重新读取仍全零，真实Credits为0.2834514285714286、上下文比例为17.617777…%，不能换算成Token或缓存率。
- Hermes `session.usage.cache_hit_pct` 来自原生正缓存读数/含缓存prompt，零读数不输出；没有额外隐藏数据来源。精确截图session的HTTP/hook与私有DB副本再次核对：4091+10=4101、reasoning1、canonical缓存读写0，仍无法区分未报告与真实0。当前hook去除raw_usage，未来准确0%需要原生公开接口保留字段存在性。
- 仅对本机Hermes原生比例计算AST片段做3个离线模拟回放：4091/0和0/0均不输出，520/400输出77%；此结果不等于Gateway或真实模型验收。首次DB读取用了不存在的默认路径而退出，未写用户数据；随后按既有绑定定位到Worker受管HTTP目录并成功复核。
- 证据为私有 `.test-data/codex-host-usage-reference-20261018/readonly-audit.json`。两份Worker、两份raw、Qoder transcript及Hermes DB读取前后哈希一致。无新增生成、模型切换、Desktop更新、版本变动、Git提交、推送或发布。本轮只改调查文档，不新增或归档业务变更；候选补全项与原生缺口继续明确标为未实施。


## 2026-10-18：原生思考过程内的持久思考记录（v0.8.1）

- 按用户最终位置要求，去掉最初预览的 turnTail 面板，改为复用原生 assistant-step / ReasoningRow。只有已绑定 CLI 子会话调整“思考记录”标题及正文滚动；原生“已完成，用时…”与步骤分组负责外层收起，公开块、工具顺序和历史持久化保持原生。
- Codex 新建/恢复轮次显式请求 `summary: auto`，不改变原有 model/effort/permission，不读取 raw reasoning。CodexHost 的 Qoder/Hermes 用量边界、Codex 摘要与三类上下文核查详见 `cli-native-data-audit.md`。
- 最终实现定向检查：`pnpm --config.verify-deps-before-run=false test tests/harness-reasoning-records.test.tsx tests/client-registration.test.ts tests/native-primary-runners.test.ts`，3 文件 85 项通过。前序本次协议检查另有 207 项通过：stream、ACP、Qoder、HTTP、ZCode、Pi/OMP、Hermes 相关测试；HTTP 首次在沙箱遇到本机监听 EPERM，允许本地监听重跑后 66 项全通过。合计 292 项；非全量测试。
- `/opt/homebrew/bin/node scripts/build.mjs --typecheck-only` 与 `scripts/build-preview.mjs` 通过（Node 22.23.1，固定 DSH 0.2.1-rc.2）。初版修正漏了可选 Chat slot 的类型边界，已修正后重新完成上述检查与构建。
- 最终隔离 UI：真实 Harness Host/原生组件、真实 WorkerStorage/投影，全部输入明确标注模拟，阻止真实 CLI、账号与外网调用。12 CLI 原生过程内展开和收起通过；Codex 思考—工具—思考顺序、完成快照无重复、安全 Markdown、长正文 400px 滚动通过；Grok/OMP/Codex 空白摘要不生成入口或缺失提示；Enter/Space、刷新后重新打开历史、980px 窗口内 524px 子栏（正文 405px）无横向溢出通过。
- 原生 UI 有“已完成，用时…”→步骤组→思考行的既有层级。验收脚本最初少展开步骤组、刷新后假设仍停留子会话、对原生最小栏宽设定过小的断言均已按实际状态修正；这些脚本失败不作为通过证据。最终依据 `browser/acceptance-receipt.json`。旧 turnTail 截图已被最终原生过程截图取代。
- 私有证据：`.test-data/cli-reasoning-records-20261018/`，包括原生过程展开/窄栏截图、隔离输入摘要、验收回执、Desktop 更新前只读状态和保留基线。历史 53 Worker 检查时无活动/未知状态，账号进程与租约均为 0。Desktop 已正式构建并重新打开；仅更新本地插件 lib，扩展包和六份 profile 配置均未改动。正式包与 preview 的运行文件、source map 经路径归一后等价，保留可回退备份。更新期间 17,837 个受保护文件字节完全一致；重启及查看历史后，17,836 个仍一致，唯一主会话文件在旧字节完整保留的基础上追加 82 字节 `session/end-seed` 原生恢复标记，无模型或任务事件。Worker 仍为 53 个、活动 0，账号进程/租约 0，独立 Web PID 12332 保持。Desktop 实际展开已有 Hermes-2 的原生过程→分析步骤→思考记录成功；没有重新调用 CLI 或模型。
- 未执行：12 CLI 真实模型调用、付费验证、Windows/Linux 实机、正式 GitHub 全量发布检查。没有增加版本、提交、推送或发布。

- 收尾：两条新增要求已同步到 `worker-conversation-interaction`，既有标题、Purpose 与要求保留。严格校验归档前 20/20、归档后 19/19 通过；变更归档为 `2026-10-18-add-cli-reasoning-records`。相关文件 `git diff --check` 通过；本次隔离服务与自建预览页已关闭。


## 2026-10-18：五 CLI 无思考展开的最小复核（v0.8.1）

- 用户确认无公开思考或工具记录时保持不可展开。当天新建 agy-new / codex-new / zcode-new / grok-new / pi-new 的精确 run 均没有公开 reasoning 或 tool 事件。Pi 原生最终消息只有 text、reasoning=0；ZCode 只有两个 text_delta；Grok 没有 agent_thought_chunk；AGY stream-json 没有公开思考文本，参考 CodexHost 的 AGY 通路也未提供相应恢复。没有把回答、签名或用量改造成思考。
- 仅检查相关既有 Desktop 界面：pi-new 完成行禁用；pi-2 经“已完成→已完成分析→思考记录”可展开真实正文；zcode-1 第二轮同样可展开，另外两轮无内容时禁用。未启动新真实模型任务。证据为私有 `.test-data/cli-thinking-regression-20261018/existing-five-cli-audit.json` 与本次原生 AX 操作记录。
- Codex 新轮的 rollout `summary` 字段为 none，reasoning output=0；安装产物含 auto 请求。该字段当时误记为 effective summary，后续已确认不能用于判断实际请求配置，见下节。仅针对这点生成当前已安装0.162.1协议类型、运行隔离 app-server 参数对照。首两次模拟请求502后到25秒时限退出，后续对照改为首错退出；本机模拟服务均未收到模型请求，不能作为摘要链路通过证据。当时保留未确认原因，不宣称已修复；详见 `cli-native-data-audit.md`。
- 此次仅更新调查和展示边界文档，未改生产代码、构建或更新 Desktop，未运行单元全量、全量验收或真实账号模型调用，未提交/推送/发布。GitHub 提交前再按用户授权执行全量验收。

## 2026-10-18：Codex 公开摘要实时投影修复（v0.8.1）

- 对照 CodexHost 固定提交 `a8adb78b519a81795fc05b787811f20a9738d7f0` 的原生 app-server 转发实现及官方 Codex 源码，确认应直接展示原生公开摘要增量。现有桥已收到摘要，但 Harness 投影仅放行 Hermes 的运行中追加，Codex 要等条目或整轮完成。生产改动仅将当前 run 的 `codex-app-v1` 纳入已核验追加来源；仍使用原生思考过程，完成去重，停止/失败保留已公开前缀，旧 transport 继续保留完成门槛。未读取私有推理或改动模型、强度、权限。
- 纠正此前 `summary:none` 诊断：官方 rollout 的兼容字段固定写 None，并非真实请求配置。本机 Codex 0.162.1 经生产桥连接隔离模拟提供方，实际 HTTP 请求为 `reasoning.summary:auto`，同时 rollout 仍记 none。前次模拟502源于系统代理路径；本次仅调整隔离探针的进程环境，未修改系统代理或用户配置。
- 最小源码回归：`pnpm --config.verify-deps-before-run=false test tests/harness-conversation-stream.test.ts -t 'streams Codex public summaries|withdrawal gate|streams actual Hermes|finalized public reasoning'`，**8 项通过、24 项跳过**；`tests/native-primary-runners.test.ts -t 'requests public Codex summaries'`，**2 项通过、59 项跳过**。修复前实时摘要用例缺少 reasoning-delta 而失败，退出前未完成夹具收尾造成的超时保留为失败证据；修复后相关用例通过。
- `/opt/homebrew/bin/node scripts/build.mjs --typecheck-only` 与 `scripts/build-preview.mjs` 通过（Node 22.23.1、DSH 0.2.1-rc.2）。再以隔离 preview 的实际编译模块接入原生 AgentLoop，仅运行 completed 实时摘要用例，**1 项通过、31 项跳过**；这是原生投影回归，不冒充浏览器视觉验收。
- 安装中 CLI 的三项本机模拟验证通过：流式摘要、仅完成快照、无公开摘要，均真实启动本机 Codex 和生产桥、连接明确标注模拟的本地 HTTP/SSE 提供方；退出0、原生 SUCCESS、请求 auto，私有 raw/encrypted 哨兵未进入输出。未连接真实模型或账号；模拟停止/失败行为由上述投影回归覆盖，不声称已验证真实服务中断。
- Desktop 更新前后均为 **64 Worker、活动0、未知0，账号进程/租约0**。正常退出后仅正式构建本地 lib，六份 profile 与宿主扩展包保持；正式包和 preview 的运行内容、source map 在已审查的构建根路径归一后等价。安装源码摘要 `c8115a08d6760a689a80aeb368c67330cc76b019180bab91abeabe7f33a90bea`，独立备份 `install/backup-1792291718024`。Desktop 已正常重开，已有 codex-new 问好轮的原生完成行仍正确禁用：该轮本来没有公开摘要或工具记录，没有回填或重跑。独立 Web PID 16686 保持。
- 安装期间 **18,805 份保护文件全部字节不变**；重启和查看历史后18,803份字节不变，0缺失、0新增。另两份已精确证明：Codex Worker 只变顶层属性顺序，使用当前全部值按旧顺序序列化即匹配原哈希；父会话前269,297压缩字节完全保留，仅追加82字节/一条空data的 `session/end-seed` 恢复标记，新增模型/任务事件0。账号、偏好、绑定、原始事件和输出均保持，未恢复覆盖用户文件。
- 私有证据位于 `.test-data/codex-summary-fix-20261018/`：三份 `bridge-*.json`、隔离回归配置/日志、安装回执及 `worker-preservation-proof.json`、`session-preservation-proof.json`，不进入Git。本次只做相关少量验收，未做全量、真实账号模型或 Windows/Linux 实机验证；保持v0.8.1，未提交、推送或发布。
- 收尾：仅同步“Codex 显式请求公开摘要”一项需求及三项场景，主规格标题、Purpose 和未涉及内容完整保留。本次4/4任务归档为 `2026-10-18-fix-codex-public-summary-stream`；严格规格校验归档前20/20、主规格14/14、归档后19/19通过。其他活动变更的未验收任务及既存同步INFO提示保持可见。

## 2026-10-18：Windows Qoder 自动识别修复（v0.8.1，候选更新中）

- 根因：Windows 实机的 `qoder` 指向 IDE/CLI 分发 `entry/qoder.cmd`，独立 CLI 位于 `~/.qoder/bin/qodercli/qodercli.exe`；旧自动发现没有检查该原生位置及官方 npm 入口，正式设置页的账号/模型显示启动器无法确认。路径记录没有 auto/manual entry，不属于缓存迁移。
- 实现：检查实际原生 PE 和官方 `@qoder-ai/qodercli` npm bin，Windows PATH 优先独立 `qodercli`，仅命令不存在时兼容旧 `qoder`。手动/部署路径优先，损坏、权限不足或不明启动器不静默换源；不安装 CLI、不修改系统 PATH、账号或模型，不扩展 Qoder ACP 参数。
- macOS 关联回归：`pnpm --config.verify-deps-before-run=false test tests/windows-cli-installation.test.ts tests/windows-cli-resolution.test.ts tests/native-launch.test.ts tests/native-spawn.test.ts tests/qoder-accounts.test.ts tests/qoder-integration.test.ts tests/cli-executable-management.test.ts tests/harness-service-integration.test.ts`：8 文件 205 通过、0 失败、0 跳过；Node 22.23.1、SDK 0.2.1-rc.2、标准 umask 022。`typecheck` 通过，`spec:check` 严格校验 20/20 通过。回执 `.test-data/release-v081-20261018/mac/qoder-windows-discovery-receipt.json`。
- 边界：Windows 实际解析、新候选设置页与更新后最终双平台全量待对应证据；本项没有真实模型调用。此前冻结源码的 macOS 3737/0/12 和真实 Codex 三轮结果保留原快照归属，不替代本项修改后的发布验收。

审查补强：所有 Qoder 自动来源（含已有 auto 缓存）必须通过独立原生 PE 或官方 package bin 身份门；未知 `qoder.exe`/IDE 不接入，npm dispatcher 归一到实际 CLI。Windows 实机证明默认入口规范化为 `qodercli-1.1.73.exe`，按该实际目标校验，不扫描或猜测版本。补充 IDE、缓存、dispatcher 与规范化目标回归后，关联 8 文件 **209 通过、0 失败、0 跳过**，类型检查及严格规格 20/20 通过；保留早先 207/1 的夹具变量遮蔽失败日志并已修正，断言未放宽。新回执仍为上述 `qoder-windows-discovery-receipt.json`；最终 Windows/新包 UI 与双平台全量范围继续由发布验收记录确认。

## 2026-10-18：v0.8.1 双平台发布验收进行中

- 用户授权 macOS、Windows 全量与 GPT-6.1 Sol 真实验收，通过后发布 GitHub/npm，版本保持 0.8.1。先前冻结源码在目标 SDK 0.2.1-rc.2 的 Mac 全量为 3737 通过、12 项 Windows 专属跳过；Windows 对应轮次为 3706 通过、1 失败、42 跳过，失败是集成夹具使用了 Windows 无效的绝对路径，修正后关联回归通过。其后 Windows 完整重跑为优先实际桌面交互而主动中止，不计通过。上述数字不替代新 Qoder / Codex / Hermes 修复后的最终全量。
- 两端均已加载内部候选包 `8554ec093ad3ae991bf5ba16dea4e44c1042501bb72d2149486132240861f015` 的 0.8.1。Windows 经正式桌面附带 CLI 安装并冷启动；Mac 正式 CLI 因既有无关工作流插件兼容检查失败，已完整回滚该尝试，再沿用既有开发链接备份替换已验预构建 lib 和本插件旧覆盖项，未增加兼容豁免。Mac 独立 Web 服务保持，未操作其页面。该候选尚不含下述新增修复。
- Mac 正式 Desktop 实际点击模型菜单选择 GPT-6.1 Sol / Low，通过子会话输入框发送原生文件编辑、无工具复述及流式输出后停止三轮。实际 JSON 产物精确匹配，前两轮回复 marker 一致，三轮原生会话 ID 保持，末轮 raw 和事件终态为 interrupted。已实际展开 fileChange 详情及用量/上下文弹层；进程退出等待的额外证明来自独立真实运行探针，不将桌面状态字样单独视为进程证明。既有父会话自动运行了三次其配置模型的状态通知，未修改父模型或把它记作 Codex 模型验收。
- Mac 实际历史界面核对：Qoder、OMP、Pi-2、ZCode-1 的已保存公开思考可在原生“已完成→分析→思考记录”展开；AGY、Grok、Pi、ZCode 的新问好轮没有公开思考或工具时禁用展开，符合用户选择。Qoder 原始 token 隐藏仍显示未知，上下文 17.6% 保留，不从比例反推。Windows 正式设置页已实际显示 Codex 登录状态与 GPT-6.1 Sol / 6-Astra 等本账号真实模型目录；Qoder 修复前的路径失败也在该设置页复现。
- Windows Qoder 安全版 2 文件 **61 项通过、0 失败、0 跳过**，实际默认解析为官方固定入口的规范目标 `qodercli-1.1.73.exe`，0 spawn、不执行 CLI、不写用户路径记录；最终新候选的设置页发现仍待冷启验证。
- Codex 桌面停止时仅收到恢复累计数 121175，没有本轮结算，旧派生差值却显示 0 tok。修复不再输出该占位零，旧 raw 的同类回执也不会经快照兜底恢复；明确原生结算零和已知累计值保留。5 文件 **78 项通过**、类型检查通过；原始私有记录只读回放证明本轮未知、累计值保留，未改用户历史。
- Hermes 桌面实际记录包含输入（含缓存）4054、缓存读取192、输出35；缓存写入未知不影响已知分母。修复 inclusive 分支的多余要求，uncached / reported 与不完整编排数据仍保留未知。局部原生组件 **23 项通过**，最终四包原生组件 **1858 项通过**；四包隔离构建/摘要校验通过。本次误用递归 `tsc -b` 引入无关上游全仓缺失类型错误，保留失败日志；正确局部 `tsc -p .../ui-chat/tsconfig.client.json --noEmit` 通过，没有为此修改上游声明或放宽检查。
- 私有证据集中于 `.test-data/release-v081-20261018/`：Mac `desktop-real/desktop-three-turn-receipt.json` 和实际截图、`native-ui-hermes-cache-ratio.json`；Windows `qoder-safety-tests.json` 和实际设置截图；`market/codex-interrupted-usage-receipt.json`、安装/回滚及逐文件包审计。模拟、真实运行、真实 Desktop 分别记账。当前等待新候选安装、对应桌面复查和最终双平台全量，尚未推送或发布。

### 最新候选 r3 的复核与新增阻塞

- 冻结 r3 包 SHA-256 为 `ab1f5c0959724a7ae92e119d88b97e61390d0ef882535bd1d5a3ef007860fe2a`，已在两端正式 Desktop 安装并冷启动。Mac 沿用既有开发链接，仅备份替换已验预构建 lib，6 份 profile、5311 份依赖条目和 28006 份业务条目在更新阶段保持；独立 Web 进程保持。Windows 使用正式 Desktop 附带安装器。
- 该候选的 Mac 最终源码回归：191 文件，**3755 通过、0 失败、12 项 Windows 专属跳过**；目标 SDK 0.2.1-rc.2 的类型检查、隔离构建、严格规格校验通过。另行 `build:preview` 与候选来源核对：241 份源码、204 份宿主运行文件及 12 份构建输入相同，Host 相同；Client 仅目录层级产生的生成注释/源映射路径差异，经限定路径归一后相同。没有以此代替 Windows 全量。
- Mac r3 实际原生界面复查：Hermes 单轮命中率 **4.7%**、底栏 **5%**，输入4054/缓存读取192/输出35；Codex 旧停止轮次不再显示伪零、累计121175保持；Qoder 公开思考仍在原生过程内展开，未知 token 和上下文17.6%保持。没有回写旧历史。
- Mac r3 追加一轮实际 GPT-6.1 Sol / Low 无工具流式输出后点击原生停止。事件最终 interrupted，未产生派生零用量，累计121175保持；但最后输出到168后至终态间有约138秒延迟，正在核查停止请求与进程清理，不将本轮标记为及时停止通过。该轮父会话仍按既有配置自动生成状态通知。证据 `mac/desktop-real/r3-recheck-receipt.json` 与 r3 截图，均私有。
- 用户新增反馈：Windows Qoder 无法自动确认登录状态，普通终端及登录终端不能正常使用。路径解析通过不能替代账号/终端验收；当前正单独核对 Windows 原生元数据收尾回执及正式 Desktop ConPTY 来源/清理链。r3 不再作为最终可发布候选，保持相关任务未完成，修复阶段只做关联验收。尚未提交或发布 GitHub/npm。

- 为区分首轮停止延迟与过程清理，补做一轮仅关联的真实 Sol 停止时序复测，不改生产代码。CUA记录点击窗口与只读观察器的UTC时间：点击后201–321ms首见stopping，740–860ms内出现interrupted终态；native turn/completed=interrupted实际存在，三个精确所属PID全部退出，累计121175与未知本轮用量保持。私有证据 `market/stop-observer-timing2.jsonl`、`mac/desktop-real/stop-timing2-ui.jsonl` 和最终桌面截图。首次137.337秒空窗未记录取消入站时刻、原因未定位，原始记录保留，不因复测通过删去或声称已修复。


## 2026-10-18 v0.8.1：r4 双平台 Qoder 账号终端复验

- r4 冻结包 SHA-256 `ca760868ed041845c414a92dc75e927ba5798baa43259cbc28f793b57af3be1b`，共 791 文件。Mac 以备份后替换已链接的预构建 `lib` 安装，六项 profile 配置、依赖、业务状态和独立 Web 进程保持不变；Windows 使用正式 carrier 安装同一 tgz 后正常冷启动。两端实际打开的是新包。
- Windows Qoder 自动读取已登录账号，并显示真实模型目录（17 项）；普通账号终端显示 Qoder 1.1.73、原生 Browser Login 状态、模型与输入行，关闭后观察的 native、bootstrap、console 及 wrapper/owner 进程全部退出、控制目录为空。登录终端通过原生浏览器流程完成登录并自然退出 0，无插件代填凭据。首次 7 秒截图只有光标，17 秒复查已显示 TUI，不能把初始未渲染截图记作通过。
- Mac Qoder 自动账号读取、普通终端和登录终端也实际复验通过：普通终端对应子进程关闭后消失，登录终端原生成功后自然退出。账号元数据查询的“不回写认证”与原生登录/交互终端的认证更新分开记录；后者可能由 CLI 自身刷新账号文件，不声称整个登录验收前后账号文件逐字节相同。含 OAuth 链接的截图只保存在私有验收目录，不公开。
- Mac r4 全量回归：192 个文件，189 通过、3 跳过；3772 项通过、12 项 Windows 专属跳过、0 失败。类型检查、隔离预览、候选构建与严格 OpenSpec 校验均通过。首次受限执行因回环/进程权限出现的失败日志完整保留，正式允许所需本地能力的重跑结果才作为本次验收。此处不替代尚未完成的 Windows 最终全量。
- Mac 最新冷启动真实 Codex GPT-6.1 Sol / low 停止复验：UI 点击后 623–729ms 进入 interrupted，7 个已确认属于本轮的进程全部退出；原生界面显示已停止、保留 1–171 输出，累计 121175 token 保留，没有把未知本轮用量写为 0。此前一次 137 秒收尾现象仍保留为未定位记录；后两次精确记录点击和进程的复验通过，不据此虚构早期原因已修复。
- Mac 原生组件复查：Hermes 本轮输入（含缓存）4054、缓存读取192、输出35、总量4089，单轮命中率4.7%、底栏取整5%；Qoder 公开摘要位于原生“已完成 → 已完成分析 → 思考记录”，账单用量未知与上下文17.6%独立展示。
- 同包 Mac 隔离 profile 完成 clean 安装、r3→r4 同版本替换及卸载，14条正式命令全部退出0；791文件摘要、四个 canonical 模块身份唯一、合成用户 chat 配置保留及卸载恢复均通过。独立完整 Host/Client 装配进一步核验四模块 ACTIVE、9项真实服务、native provider、实际客户端 provideProjections 与同一原生 conversation frame；明确标注 SIMULATED 的投影17→23→未知→释放恢复通过，模型调用0，进程与端口清理通过。这些装配检查不替代实际 Desktop 或真实模型任务。
- 曾针对浅色终端文字试验 xterm 最小对比度选项；用户确认现有显示效果可以，明确不需要该调整，因此撤回该选项及对应规范文字，保留原生 ANSI 显示，不交付该实验、不创建 r5 候选。继续以已安装的同一 r4 包完成 Windows 真实任务与最终全量。当前未推送 GitHub、未发布 npm/Release。

### Windows r4 正式 Desktop 真实三轮与恢复

- 正式原生选型卡选择 Codex GPT-6.1 Sol / Low / 无角色，首轮通过原生文件工具创建验收文件；实际内容精确为 `CWN_WINDOWS_081_ARTIFACT_OK`，27 字节。第二轮从子会话原生输入框续聊，实际读取、追加第二行 `CWN_WINDOWS_081_FOLLOWUP_OK` 并保留首行；最终文件55字节、SHA-256 `f04c9d941f0057b8994592198be68d067d02dae2e225fd9868dd5c90816eb80b`。检查的是实际文件与事件，不是完成自述。
- 第三轮通过原生命令启动180秒等待，在同一原生会话点击停止后终态为 interrupted；跟踪的 Codex、runner、PowerShell、Node 等11个精确所属PID全部退出，其他既有 Codex 进程保留，3个本轮私有端口已无监听。该轮 CLI 确实发布238391 token，本会话累计405745；本轮为已知统计，不能当作未知用量测试或改为0。
- 第二轮“已完成”可展开，实际显示公开过程及文件读取/修改记录；停止轮的“已调用工具”可以打开，显示工具在持久记录完成前被中断、结果未知的原生状态，不把中止工具记成成功，也没有盲目重试。正式界面用量、缓存与上下文弹层保留各自实际来源。
- 临时验收扩展已在正式 Desktop 退出后按配置摘要 CAS 移除，随后不带调试参数正常冷启动；三轮真实历史仍能打开、旧会话保留。误添加的 Downloads 工作区仅经界面移除书签，选择保留文件夹和会话，没有删除用户文件。父会话按其原配置自动生成状态通知，与子会话 Sol 验收分开记录。
- 私有证据：`windows/sol-final-summary-r4.stdout.txt`、`windows/desktop-sol-stopped-r4.png`、`windows/desktop-sol-cold-history-r4.png` 及实际过程/工具展开回执。Windows 最终自动回归使用 r4 同一源归档（SHA-256 `2a95aaaca091fb70a0c15ff52c20aa04990ef2bcea141b058e01528b273037c7`）；可移植清单仅排除原1043项中的10个 `.DS_Store`，共同1033项逐文件摘要差异0。此处先记录真实桌面结果，最终全量统计待执行结束另记。

### 最终自动结果与用户停测发布决定

- Windows r4最终完整回归已经结束：192文件、3784项，**3738通过、4失败、42跳过**，用时503.08秒；frozen依赖安装、隔离preview、候选build、typecheck及严格规格校验均退出0，源码漂移0。失败为`native-runtime.test.ts`一项Qoder合成续聊，以及`qoder-accounts.test.ts`三项合成时钟预算测试；初步定位为Windows自动入口身份门与合成入口的夹具适配，尚未修复/重测，不能写为通过。Windows跳过项涵盖POSIX权限/信号及平台限定Python夹具，不把跳过当运行成功。
- Windows同一r4包的隔离安装、同版本候选替换和卸载，14条正式命令均退出0；文件摘要、模块身份与用户配置保留按独立回执核对。正式Desktop三轮真实Sol与Qoder三个账号入口另有实际界面及进程证据。最终汇总为私有`windows/windows-final-total-receipt.json`。
- Mac clean profile在用户停测前补完一轮真实GPT-6.1 Sol / Low：原生fileChange生成实际marker、原生turn completed与回复匹配；实际Client打开同一Worker并展开文件详情，本轮47393 token=未缓存输入10553+缓存读取36736+输出104，未知三类上下文显示“—”。四个原生进程句柄正常退出且范围为空；隐藏IAB及Host清理、卸载恢复四个官方模块通过，正式Desktop/Web配置未变。证据为私有`mac/r4-clean-real-worker-closure-receipt.json`；此项为真实任务，不与先前模拟投影混写。
- 用户随后明确要求“暂停所有测试”，并表示自行测试后所有任务正常、可以上传。立即停止后续诊断/修复/重测，撤回唯一尚未验收的合成夹具临时改动，生产、测试与r4冻结内容一致；本任务测试、模型、临时Host、浏览器、监听端口和计划任务均已收尾，保留用户自测及其他Codex进程。
- 本次按用户最新手工验收和明确授权发布同一r4包；不宣称Windows自动回归全绿。Windows clean profile真实模型任务尚未启动，公开registry固定版本及latest升级测试也按停测要求不再执行。上传后只做公开版本、URL及包摘要的只读确认；OpenSpec保留未验证项，不强行归档。

### 2026-10-18 v0.8.1 上传与开源致谢

- 用户明确停止全部测试并确认手工验收正常后，将已审核的595项改动提交为 `ecaddbe0a2178b2ff0f42730e31d278206ff0d6d`；保留远端README历史的合并提交为 `037168a23fb4fd5e1260d9f3fc04fedc23fc81bc`，以非强制方式上传main与v0.8.1标签。合并没有改变发布源码内容，无关素材修改未暂存。提交包含 `[skip ci]`，只读回查该提交的Actions运行数为0。
- [GitHub Release v0.8.1](https://github.com/SuperWheel/dsh-cliworker-now/releases/tag/v0.8.1) 已公开，含tgz、SHA256SUMS.txt及脱敏package-verification.json。远端下载为17935007字节，SHA-256 `ca760868ed041845c414a92dc75e927ba5798baa43259cbc28f793b57af3be1b`，与两端已安装候选逐字相同；没有重建或重打包。
- npm经用户完成官方发布二次验证后返回HTTP 202，CLI退出0；提交包同上。公开registry的版本及摘要另行只读回查，不把服务端接受等同于已经可安装。
- 按用户补充要求，在中英文README增加“开源参考与致谢”及导航，列明codex-host、Codingns4DSH、DeepSeek Harness的作者与实际参考内容，并链接已核对的相关CLI官方项目。该修改仅提交GitHub文档，已上传0.8.1安装包内的README保持冻结内容。
- 按停测指示没有新增测试、真实模型任务、构建或发布后安装；Windows自动回归的4项失败及其余未验收边界继续保留。

- 06:10 UTC只读回查：npm `0.8.1`端点仍404，公开latest及dist-tags仍为0.7.9；上传已被接受，但公开下载尚未确认。npm官方说明新包需先完成发布扫描，通常约5分钟，繁忙或较大包可能15分钟以上：[发布扫描说明](https://github.blog/changelog/2026-07-28-npm-publish-time-malware-scanning-and-dual-use-metadata/)。未重复发布、未更换包，也未据CLI成功输出宣称公开安装成功。
- 已审核市场条目通过npm更新：发布同包名新版本并保持repository指向本仓库即可，无需重新申请上架或复用已合并PR。市场插件检查registry/latest后由用户更新；列表刷新和镜像存在延迟。条目静态tgz备用链接若需换成0.8.1，另开目录更新PR；本轮没有擅自创建该PR。[市场贡献说明](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md#npm-package--npm-包optional--可选)、[市场更新实现](https://github.com/dsh-market/dsh-market/blob/main/src/updates.ts#L114)。

## 2026-10-18：Qoder 上下文与积分补全（v0.8.1，Windows 最小验收）

- 按用户本次授权参考 Codingns4DSH 固定提交 `27b4c95065e9f3ae01d513c60673a871487257f3`，独立实现本轮 Credits、ACP quota 与上下文窗口补读。继续精确匹配项目、会话、模型、userMessageId 与 parentUuid 链，Credits 按原生请求去重；隐藏全零 token 不作为真实零，不用积分或比例反推账单。容量只有同轮原生证据才显示，并标注已用量估算；缺失时保留比例和未知容量。
- Windows 实机根因包括原生文件由 Administrators 拥有、当前用户直接完全控制及其他主体继承只读权限，旧私有 ACL 门禁拒绝了这些来源。仅 Qoder 数字读取接受该明确布局，仍拒绝其他主体写入、删除、改权限以及链接替换；通用读取器默认不变，原生 ACL 未修改。macOS 保留 POSIX 私有文件读取路径。
- 用户截图给出新 Windows 地址后，以既有固定主机密钥重新连通。全部测试和桌面验收在 Windows 执行，Node **24.15.0**、相同锁文件依赖；Mac 仅编辑、构建和打包，没有执行测试或桌面验收。
- Windows 命令：`node scripts/build.mjs --typecheck-only` 退出 0；`node node_modules/vitest/vitest.mjs run tests/qoder-native-metering.test.ts tests/qoder-durable-context.test.ts tests/native-qoder.test.ts tests/qoder-integration.test.ts tests/native-supplemental-privacy.test.ts tests/harness-native-telemetry.test.tsx tests/harness-native-telemetry-provider.test.ts tests/native-file-privacy-windows.test.ts --maxWorkers=1 --testTimeout=20000 --hookTimeout=20000`，最终 **8 文件 118 项通过，0 失败、0 跳过**。首轮新日志测试误引入无关 UI 辅助函数，触发现有 Windows 依赖缺少 clsx 的加载失败；移除该无关导入后完成上述全组检查，没有改动依赖。
- 使用 `node scripts/build-host-extension.mjs --target 0.2.1-rc.2 --export-patch`、隔离四包构建/校验及 vendor 冻结，220 文件产物与203文件 runtime-host 核对通过；`pnpm --config.verify-deps-before-run=false build:preview` 通过。补丁 SHA256 为 `f7457fd6a115a49331aace0045ef03ec24dc2574f5bb004c09a418a964b04c51`。已加入扩展源码的原生积分渲染用例，但未执行该独立 Vitest 文件，不把构建通过当作该测试通过。
- 确认 Windows 15 个 Worker 均空闲后备份插件/profile，应用菜单正常退出，再由官方 `dsh plugin --profile desktop add --save-exact` 安装同版本隔离候选（退出 0），正常冷启正式 Desktop，无调试参数。候选 tgz SHA256 为 `4cb54ab625b11caf1fe3f775e7397249a4de14edc0e238484e202f3dd0d7a91d`；没有更新 Mac Desktop。
- 实际只读打开原有“Qoder 问候”历史：底栏显示 **0.2526 积分 · Token 未公开** 和 **上下文已用 15.7%**；逐个点击原生弹层，积分来源为 Qoder 本轮原生请求，完整值 **0.252595**。上下文原始比例为 **0.15682222222222222**，容量和 token 显示 `— / —`，缺失说明及三类统计均正确保留未知。原生读取的前后 Windows ACL 证明通过；没有发送新 prompt、切换模型或执行模型请求。
- 数据保护：原有顶层状态114文件中112份字节不变、0缺失；另2份为正常冷启的 host.lock 和本次打开的 Qoder Worker。后者在内存恢复原属性顺序后完整哈希与安装前一致，证明只有序列化顺序变化，无字段值变化；未写回恢复。所有原 raw/events 保持，Qoder 原生项目6文件逐字节保持。未递归审计其他 CLI 私有环境，不据此声称全用户目录逐文件不变。
- 私有证据集中在 `.test-data/qoder-metering-20261018/`：`report.json`、`tests.json`、`real-history-fixed.json`、`install.json`、`worker-preservation-proof.json`、`preservation-after.json`、`ui-qoder-before.png`、`ui-qoder-after.png`、`ui-credits.png`、`ui-context.png`、`ui-final.json/png` 和 `cleanup.json`。12个本次计划任务已清理，余量0；活动Worker及Qoder原生进程均0，正式Desktop保持打开。凭据、日志及截图不进入Git。
- 本轮真实模型调用0；未运行Mac测试、全量回归、新生成/续聊/运行中取消、真实账号登录或多账号测试。实现保留两平台路径，Mac运行时兼容性未实测；上述Windows历史最小验收不替代其他发布待办。版本保持0.8.1，未提交、推送或发布本次修复。
- 收尾：本次4项任务全部按实际证据完成，仅同步 Qoder“原生统计及明确未知”1项需求，原有 Purpose 与其他需求逐字保留。严格校验归档前 **21/21**、归档后 **20/20**，`git diff --check`通过；变更归档到 `2026-10-18-fix-qoder-native-metering`。主规格已单独合并核对，归档使用 `--skip-specs`避免重复修改；其他活动变更及未验收任务保持原状。

## 2026-10-18：积分用量文案与 Hermes Windows 网关修复（v0.8.1）

- 按用户后续要求，Qoder 用量模块只显示积分，弹层标题改为“积分用量”，不再并列Token字样；有效零、缺失、等待和断连保持实际语义。可选计费单位绑定当前Worker代际，断连清数字但保留单位，释放归属后清除单位；其他CLI原有token统计不变，后台有效Qoder计数不用于替代积分。
- 实机核查两个Hermes失败任务：原始事件只有queued/failed，错误均为“API 网关启动已中止”；原生状态及gateway.log却证明已成功监听。Windows Hermes **0.21.7**、checkout `71d34bad1045610252eda02ee79549436896e784` 的venv python.exe是启动器，实际Python网关PID不同，且原生没有向stdout输出监听行。旧版只按启动器PID确认状态，误判正确网关并等到超时；不是本次模型请求的上游拒绝。
- 修复仅对精确自有Python入口增加每次随机nonce进程回执，经本次管道确认实际解释器PID，再核对新鲜状态pid/writer_pid、精确本机监听地址和鉴权能力。nonce不包含API秘密，进入原生CLI前移除；磁盘PID、错误nonce、旧状态和错误端口均不足以发送鉴权请求。保留其他入口、原生账号、权限及完整进程清理边界。
- Windows隔离实际网关复现：修复前启动器PID与原生PID不同、端口一致但超时；修复后同一官方安装约4秒就绪，鉴权及全部必需能力通过。更新正式包后再用该包的真实MJS/Python资产复验一次，仍约4秒通过。两次成功检查均未创建模型请求、stored_runs=0；模型和Nous免费选型保持原值，不把能力检查当真实生成、续聊或运行中取消通过。
- 自动检查全部在Windows Node **24.15.0** 执行，复用同锁文件依赖，未安装或改动依赖。`runner.mjs`执行必要`node scripts/build.mjs --typecheck-only`和10文件关联；`runner-final.mjs`仅重跑失败/变更的就绪、投影及代际3文件与类型检查；`runner-provider.mjs`仅复验代际文件。按每文件最后有效JSON回执汇总为 **134通过、0失败、3项POSIX专属跳过**；最终Host/Client类型检查退出0。范围为`native-hermes-readiness`、`native-hermes-binding`、`native-hermes-planned-stop`、`native-hermes-host-cleanup`、`native-http`、`hermes-installation`、`hermes-windows-installation`、`windows-hermes-home`及两个`harness-native-telemetry`文件，非全量回归。
- 保留初始失败：隔离副本漏带已生成的remote声明导致首次client类型检查失败，补入同候选生成声明后通过；新就绪测试最初传入缺少HTTP计数方法的预算夹具，3条正向用例失败，改为正式预算构造器后10条全通过。断连测试最初误要求整个可用性对象消失，按既有合同只要求积分单位清除后16条通过；没有放宽生产门禁。原始及修正JSON/日志均在本轮私有目录，不累加重复测试数字。
- `node scripts/build-host-extension.mjs --target 0.2.1-rc.2 --export-patch`及隔离四包构建/校验通过，220文件产物冻结为203文件runtime-host；当前补丁SHA256 `c4be999c2ad18ba2e7d6a49a311295344e904022eeebf6727c1e56444564b89c`。已更新原生扩展渲染用例源码，但未执行其独立Vitest文件，显示证据来自Windows正式Desktop。Mac仅编辑、构建和打包，`build:preview`通过，没有执行单元测试或桌面验收，也未更新Mac Desktop。
- 确认15个Worker空闲并备份插件/profile后，正常菜单退出，以官方`dsh plugin --profile desktop add --save-exact`安装同版本候选，退出0，正常冷启无调试参数。tgz **17,949,470字节**，SHA256 `cfbd1d9e1502e75db15332867b482762ed572db82de4fb8d04060f976ae5a918`。实际Windows打开原Qoder问候历史并点击用量入口：只显示 **0.2526积分**，标题 **积分用量**，完整积分 **0.252595**；该模块无Token字样，上下文 **15.7%**保持。Hermes旧失败记录保持原状，没有伪改为成功。
- 更新前后顶层状态114文件中 **113份字节不变、0缺失**，唯一变化为正常冷启的host.lock；所有Worker、raw/events及Qoder原生6文件均不变，Hermes账号config.yaml/auth.json哈希不变。3次网关探针的临时认证均已清理，自有探针进程0、活动Worker0；清理12个本次计划任务，并仅移除原生探针对本次独立目录添加的3条用户PATH记录，原Hermes入口仍为原官方安装。正式Desktop保留打开，其他会话与账号不恢复覆盖。
- 完整私有证据：`.test-data/credits-hermes-20261018/`中的`diagnosis.json`、`inspection.json`、`startup-before.json`、`startup-after.json`、`installed-gateway.json`、`combined-tests.json`及分组失败/成功回执、`install.json`、`preservation-after.json`、`cleanup.json`、`ui-ready.json`、`ui-qoder.png`和已目视核对的`ui-credit-details.png/json`。无新模型调用、CLI升级、版本变化、Git提交、推送或发布；Mac运行时、新生成/续聊/运行中取消和全量发布验收仍未执行。
- 收尾：本次5项任务完成，实际证据及候选摘要汇总至`final-acceptance.json`。仅同步Qoder原生统计1项需求并新增Hermes网关平台1项需求，保留两个主规格的Purpose及其他正文；严格校验归档前 **21/21**、归档后 **20/20**，`git diff --check`通过。变更归档为`2026-10-18-fix-windows-hermes-and-credit-labels`；其余活动变更和未验收项保持原状。

## 2026-10-18：逐轮积分、统计弹层与实际模型身份（v0.8.1）

- 范围：用户截图中的 Qoder 回复用量、Hermes 上下文说明与留白、OMP 内部模型路由。OpenSpec：`fix-native-usage-details`。不增加版本号、不提交 GitHub、不发布、不新增模型调用；运行验收只在 Windows。
- 实施：逐轮积分经精确 turn/run 绑定去重，缺失任一运行账单时保留积分单位并显示 —；断连清空积分数字。实际模型展示使用该轮 observedModel，不改写 Session 事件或执行路由，缺少提供方显示未公开；外部总账单缺失时，独立模型元数据可配合原生精确回复计数。原生和回退统计弹层删除重复解释段落，未知与估算继续保留。
- Windows 关联检查：Node v24.15.0；Host/Client 类型检查退出 0；7 文件 **132/132 通过、0 失败、0 跳过**。覆盖 `native-usage-details` 15、`harness-turn-usage` 29、`harness-native-telemetry` 17、`harness-native-telemetry-provider` 17、`conversation-timeline` 21、`native-supplemental-context` 13、`qoder-native-metering` 20。全部为隔离模拟或只读协议测试，无模型请求。
- 隔离构建：原生扩展 4 包、220 文件；冻结 203 文件；`pnpm --config.verify-deps-before-run=false build:preview` 与忽略打包钩子的候选包完成。Mac 仅编辑、构建和静态规格检查，没有 Mac 运行测试。Windows 通过官方插件安装命令退出 0，正常菜单退出后冷启动，版本仍 0.8.1，无调试参数。
- 私有证据目录：`.test-data/usage-details-20261018/`，Windows 独立目录后缀 `usage-details-df7c15fa-9dbe-472e-87e0-b09221214c24`。安装候选 SHA256 `a2e0d1bc75a353fcdd9fad2493634597b2d5978c14149efe933aec490116d471`；源补丁 SHA256 `1b34e4fb0ff87a59791bfabaa030d929b3cd10e51a3c4318bbb4933db7729b3c`。
- 未执行：Mac 运行时、其他 CLI 的逐个 Desktop 实测、原生扩展独立 Vitest 套件、真实新生成/续聊/取消与全量发布验收。本次原生界面检查仅复用 Windows 现有历史。
- Windows 实际 UI：`ui-omp-usage.png/json` 显示 `omp/zhipu-coding-plan/glm-5.3-flash`，3,748 tok 及原有分项保持；`ui-hermes-context-right.png/json` 明确取右侧 Hermes 子会话，显示 2%、4.8K/262K、系统 ~1.7K、工具 —、对话 ~43，原缺失分类句已消失，末行后只保留正常内边距。初次同名 2% 命中主会话的截图不作为 Hermes 验收证据，后续按已观察位置选择右侧控件核对。
- Windows Qoder 实际 UI：`ui-qoder-turn-credits.png/json` 显示回复功能条“积分用量 0.2526 积分”，弹层“积分用量”、精确 0.252595 积分及 `qoder/未公开/qfmodel`；不再显示 Token 缺失文案，底部独立上下文仍为 15.7%。
- 保全与清理：原有 127 个顶层状态文件无缺失，124 个逐字节一致；2 个 Worker JSON 仅属性顺序变化、值不变，另 1 个 host.lock 为正常冷启动锁。Qoder 原生项目记录 6/6 逐字节一致，Hermes 原始 config/auth 摘要一致；未做所有 CLI 原生子目录的全量审计。检查结束活动 Worker 为 0，本次所属检查及 UI 任务 17 个已精确清理、遗留任务和进程均为 0。
- 静态核对：插件业务源码／测试／文档及原生扩展源码的 `git diff --check` 通过。完整仓库 diff 中生成 source.patch 的两个空白上下文行会被当作尾随空白；保留可应用的标准补丁格式，原生来源／补丁校验与隔离构建通过，不改动已有其他文件。
- 收尾：仅同步本次 `worker-context-inspection` 菜单需求与 `worker-conversation-interaction` 新增逐轮统计需求，其他内容保持；主规格已先逐项同步并保存范围证明，归档使用 `--skip-specs` 避免重复合并。严格规格校验归档前 **21/21**、归档后 **20/20**。变更归档为 `2026-10-18-fix-native-usage-details`，保留全部未执行边界。

## 2026-10-18：跨平台设置首次预热与展示缓存（v0.8.1）

- 范围：用户要求 Windows 设置首次缓存全部账号、模型和思考强度，并核对 Mac、形成共用方案。变更 `unify-settings-warm-cache`；版本保持 0.8.1，没有新增依赖、模型生成或 GitHub 提交/发布。
- Mac 只读核对：正式插件仍链接本仓库，旧 Host 包已有 settings-catalogs 持久目录，旧 Client 账号 state 随 OpenSettingsDialog 关闭丢失，模型仅查询选中页。现有实现为部分缓存，并非 Windows 单独缺少一条系统分支。共用新缓存无 process.platform 分支。Mac 桌面当前仍在运行，64 个本地 Worker 无活动；未替换其运行产物、未关闭窗口，也未执行 Mac 运行验收，通用候选包已准备。证据 `mac-source-audit.json`。
- 实施：轻量 settingsCache 元数据核对 Host 代际、项目、每 CLI 来源版本、当前偏好和内存目录账号证明；Client 展示池按 API、Host、项目隔离，最多八个项目，只缓存完成的安全摘要和模型/强度。当前页优先、最多两项任务顺序读取账号再读取目录；关闭取消未完成，重开补缺，禁用不探测。缓存失效、错误及迟到响应不恢复旧选项；明确选择才保存默认值。跨父会话复用项目目录仍保留原账号绑定，保存和执行的实时授权规则不变。
- Windows 最终自动检查：Node v24.15.0，Host/Client typecheck 退出 0；6 文件 **243 通过、0 失败、0 跳过**：settings-dialog 178、settings-display-cache 10、cli-settings 32、settings-catalog-cache 17、account-query-queue 5、harness-model-guard 1。包括全部已启用 CLI 预热、关闭重开、仅补取消部分、失败保留、单 CLI 来源失效、Host 换代、最新偏好、手动刷新和原账号绑定。均为隔离模拟，不计为真实模型验收。
- 首轮真实失败保留：239 通过/4 失败，其中 3 个新测试使用错误的 Qoder 导航名称，按实际 CLI_LABELS 修正；另 1 个发现手动账号刷新未传入强制目录标记，修正默认刷新路径后整组 243 项通过。没有放宽生产断言。首轮及最终源码/报告分别保存，不累加重复数字。
- 隔离 preview 构建完成，Host 原生扩展保持上一已验证冻结包不变；源码 711 文件与同锁依赖在 Windows 独立目录复核。官方安装器退出 0，正常菜单退出后冷启动，无调试参数；候选 SHA256 `1c40582ffba093f04f982c7871c9620ea30ad899fc54a280288e90d7673b1344`，源补丁 `1b34e4fb0ff87a59791bfabaa030d929b3cd10e51a3c4318bbb4933db7729b3c`。
- 私有证据：`.test-data/settings-warm-20261018/`；Windows 目录 `settings-warm-3d9294c5-1e7e-46a8-b867-c612948b3213`。源码最终压缩包 SHA256 `ddb0288a0e4cf9ebfb9d68d2abd240cb3566f771f49ff479eb59937cfcce3930`，首轮压缩包及失败日志保留。Mac 仅编辑、构建和静态实现核查；真实新生成、续聊、取消、Mac/Linux 运行时与全量发布验收均未执行。


本轮补充要求把模型与思考强度改为离页后台保存。新增 SettingsPreferenceSaves：选择只更新完整草稿，离开当前 CLI 页（其他 CLI / 智能体设置）或关闭时提交最终组合；页面先切换，不等账号核验。关闭只取消展示探测，保存请求继续完成；快速重开恢复未完成草稿，后续同 CLI 写入串行且旧回执不覆盖新选择。失败保留选择和短错误供重开查看、下次离页重试；显式刷新/账号/路径/开关或宿主换代取消旧来源草稿与写入。展示 LRU 淘汰时清除目录，但单独保留进行中的写入顺序，结束后可释放，不扩大账号授权。

Windows 补充第一轮 251/251 通过，随后补齐 LRU 写入顺序、宿主换代和临时缺少目录绑定证明的边界用例；最终 6 文件 **254/254，0 失败、0 跳过**，Host/Client typecheck 通过（Node v24.15.0）。隔离 `pnpm --config.verify-deps-before-run=false build:preview` 通过，源码与候选 src 对比无差异；未在 Mac 运行验收、未发送模型请求、未做全量测试。最终报告 `report-deferred-final.json` / `tests-deferred-final.json`，第一轮报告保留为 `report-deferred-first.json`。

初版缓存候选的 Windows 实际进程观察：首次打开的 20 秒观察窗口内记录 25 个 Desktop 后代进程启动；全部预热完成后，关闭重开并查看 Codex 强度菜单的 18 秒观察窗口内为 **0**。这两个数字只代表各自窗口，不是完整首次预热总耗时或总进程数。原生 Codex 与 Qoder 模型菜单及 Codex 强度已实查并截图；最终补充候选的离页/关闭落盘证据见下，模拟用例与真实桌面记录分别保留。


最终候选通过 Windows 官方 `dsh plugin --profile desktop add --save-exact` 安装（退出码 0），正常原生菜单退出后冷启动，无调试参数；已安装 `lib/client.js` / `lib/index.js` 与隔离候选哈希一致，Windows 测试源码 **712 文件、0 差异**。最终包 SHA256 `127313c9b8e9087e3482068a27f95a7b2a55ff9d1e93ef08678ec9ec800d1f9a`（17,970,132 字节），冻结源码 `eab6e53e40beae2ed269891d63ba64cfac8a3197d459c9c8ef8c26c441a987c9`；初版缓存候选及既有首轮失败报告仍保留，不混作最终产物。

Windows Desktop 真实 UI 验收：Codex 原默认 GPT-6-Luna / Low，选择 GPT-6-Sol / High 后，**12 份项目偏好均未改变**（`preferences-on-page.json`）。切到 Qoder 后，仅 Codex 偏好文件保存为最终 Sol / High（`preferences-after-leave.json`）；返回显示已保存，其他 11 份未变。随后恢复 Luna 并选择 Low，留在设置页时文件仍为 Luna / High（`preferences-close-local.json`，窗口仍打开），点击关闭按钮后 **12 份偏好哈希全部恢复原值**（`preferences-after-close.json`）。期间没有创建 Worker、发送 prompt 或变更已有 Worker 选型。

关闭路径初次 UI 自动化误选了背景的同名 Low 文本，触发遮罩关闭，留下了一份未完成的 `ui-deferred-closed.json`；截图确认不是菜单项选择。测试定位随后优先原生 MenuItem，重新完成“窗口仍打开、选择未写入、明确关闭后保存”的验收，原始失败记录保留。该修正只在私有验收脚本，不改变产品代码或放宽断言。


按补充要求，关闭统一由 CliSettings 卸载提交，涵盖叉号、点击窗口外侧、原生 Esc 和外部状态关闭。Windows 补充真实操作：选择 High 后 12 份偏好保持原值，点击窗口外侧关闭后仅 Codex 保存 Luna / High（`preferences-before-backdrop.json` / `preferences-after-backdrop.json`）；重新打开选择 Low 后用 Esc 关闭，12 份偏好再次全部恢复原哈希（`preferences-after-escape.json`）。显式叉号关闭此前已独立核验。产品代码未因这些不同关闭方式新增分支。

最终补充候选重复打开并查看模型菜单，18 秒记录仍为 0 个 Desktop 后代进程启动（`processes-final-reopen.json`）。实点“刷新模型”后记录到原生设置的“正在读取 Codex 模型…”状态，随后恢复可用选项；该次 18 秒观察窗口也为 0（`processes-manual-refresh.json`），因此不将进程观察数量当作实际 RPC/HTTP 查询次数或原生辅助进程总数，目录强制刷新语义另有对应模拟 Gateway 断言。这里仅记录 Win32 Desktop 进程后代范围，不声称覆盖任务计划服务启动的全部辅助范围。


最终数据核对：原 127 份顶层状态中只有正常重启的 host.lock 哈希变化；原 Worker 记录与全部 12 份项目偏好均保持原哈希，6 份 Qoder 项目文件不变，Hermes config.yaml 不变。严格全文件不变检查 `preservation-after.json` 返回 false，原因是 **Hermes auth.json 的真实内容变化**，不是 JSON 格式变化；修改时间 08:42:15 UTC 落在初版首次预热期间。基线只记录该文件哈希，未保留其正文，原生 home 文件也不匹配该基线，因此无法逐字段确认变更内容或把它确定归因为某一种凭据续期；不宣称凭据字节不变或已证明前后身份完全相同。当前设置页 Hermes 登录展示可用，未执行登录、退出或手动改写/回滚认证文件，保留现有文件并保留这一证据边界。安全审计仅输出字段名/时间/哈希匹配结论，没有输出凭据；见 `hermes-auth-format-audit.json` / `hermes-auth-renewal-audit.json`。

精确归属本次远端目录的 59 个已完成计划任务已清理，剩余同范围任务、辅助进程和活动 Worker 均为 0；正常 Windows Desktop 保持运行，候选、安装前插件备份及验收证据保留（`cleanup.json`）。Mac 只检查已安装代码与共同实现，当前运行实例未更新、未运行 Desktop 验收。没有增加版本号、提交、推送、发布或模型生成调用。


收尾检查补充了“保存成功先到、旧设置读取后到”的竞态。新增读取起点与保存回执代次保护，避免快速重开显示旧默认值；后续新读取仍接受外部修改，不长期固定在本地回执。Windows 最终 **6 文件 255/255，0 失败、0 跳过**，Host/Client 类型检查和隔离 preview 构建通过；前面的 254 项候选及记录保留。最终报告 `report-receipt-final.json` / `tests-receipt-final.json`，冻结源码 712 文件 SHA256 `ed6f9ea4e55f26c8ea8e55cc23619e22c802dcec8aef4dfdccd2f0d498cf345e`；最终候选 SHA256 `8af846bfba1ca65d6b6f89fb1dd102d0bc324e91765143bb2b6848bee0a4e554`（17,970,688 字节）。


回执顺序保护的最终候选也已通过官方安装并冷启动（PID 23368、无调试参数），已安装 Host/Client bundle 与候选匹配，712 份测试源码无差异。最终候选重新核验：窗口外侧关闭保存 Luna / High，重开显示 High；Esc 关闭恢复 Low。点叉路径明确重选已保存 Low，选择期间文件修改时间不变，点叉后修改时间前进且内容仍为原值，证明不是靠已有值“看起来已保存”（`x-close-file-proof.json`）。12 份偏好最终哈希全部恢复。前述设置页截图已视觉核对；模拟的迟到响应排序不冒充真实网络重排。

为最后一次候选更新补录安全基线（不保存/输出凭据原值），与更新后再比较：Hermes 认证文件原字节、配置、提供商列表、当前提供商及 1 组 JWT 主体指纹均一致，审计未改写文件（`hermes-safe-before-final.json` / `hermes-safe-after-final.json`）。这验证最后一次更新的账号保全，不追溯填补首次预热前缺少正文基线的证据空白；首次 auth 哈希变化仍保留为独立记录。最终功能验收汇总在私有 `final-acceptance.json`。

最后一轮额外 19 个归属任务已清理（前一轮 59 个，合计 78 个），当前同目录计划任务、辅助进程、活动 Worker 均为 0；正常 Windows Desktop 保持运行，所有证据与备份保留。最终源码及规格检查不把早期失败报告或首次认证文件变化覆盖为成功。

OpenSpec 两个增量均已同步：新增 cli-model-discovery 的跨平台展示缓存契约，修改 worker-management 的模型默认值离页保存契约，原 Purpose、其他需求及原有场景均保留。严格校验归档前 21/21、归档后 20/20；8/8 任务核对后归档到 `2026-10-18-unify-settings-warm-cache`，活动变更已移除。该格式校验不替代前述 Windows 验收，也不消除首次认证文件变更的证据边界。

## 2026-10-18：CLI 接入与实现方法原子笔记（v0.8.1）

- 新增 [文档总索引](README.md) 和 [实现知识库](knowledge/README.md)，按 CLI 接入 11 篇、性能优化 10 篇、架构原理 11 篇、验证与交付 6 篇分类，共 38 篇原子笔记、1 个知识库总索引和 4 个分类索引。中英文项目 README 均增加入口；既有专项协议、设计与验收历史保留。
- 接入部分覆盖注册与能力、图标来源和主题、12 CLI 原生协议、数据接口、地址发现、macOS／Windows 启动、账号绑定、模型与强度、原生会话、权限清理及最小验收。性能部分覆盖 Host 已验证目录、Client 完成结果、并发预热、来源失效、元数据复用、离页保存、串行写入及迟到读取保护。
- 按当前源码澄清：设置页在离开当前 CLI 页或正常关闭时提交草稿；对话选择仍立即调用 `configureWorker → runtime.configureWorker → storage.save`，发送时才执行实时原生授权，不将“发送才落盘”写成已实现。另注明外部终端换账号不能由轻量缓存元数据即时发现、Qoder 积分是当前运行及绑定轮次口径，以及 Windows 原生来源 ACL 校验与插件存储 mode 的区别。
- 本次验证：源码与有效规格交叉核对；Python 检查 44 份新 Markdown 的单 H1、451 条本地链接、38/38 原子笔记分类索引覆盖及项目 README 新入口，无错误；另检查新增文档空白与本次导航差异。测试文件链接仅作为复核入口，不表示本轮运行了产品测试。
- 本次为说明文档整理，没有更改运行行为、版本、Desktop 安装或会话数据，没有执行模型调用、产品测试、构建、平台实机验收或 GitHub 提交／发布；不新增或归档行为变更。


## 2026-10-18：CLI 附件与 Harness Skill/MCP（v0.8.1，Windows 最小验收）

- 参考 Codingns4DSH 固定源码的宿主附件解析及按协议转换方式，补齐真实子 Agent 的附件输入；文件/图片身份参与回执去重，运行中附件保留原生 Inbox，私有执行配置不进入 Worker 持久化。macOS / Windows 共用 Host 转换和 Client 适配，原有 legacy 会话保持原协议。
- CLI 子会话加号菜单增加“添加文件”“添加图片”。桌面普通文件通过宿主 preload 的真实路径和公开 SessionInput/source codec 进入原生草稿，图片调用原生 File action。修复 rc.2 隐藏文件控件统一禁用子会话的遗漏，增加默认关闭、只对附件能力有效的 CLI 绑定开启的 childImageUploads；私有生成路由声明可接收图片用于协议/路径转换，仍不把该声明当成实际模型视觉。ACP 未明确公布 image prompt 能力时传入验证后的路径。追加文件使用原生 TokenSpan 的不透明字符坐标，不用展开后的剪贴板坐标覆盖已有引用。
- 复用现有 tools.schemas → tools.execute 与 Skill 按需读取桥。Kimi/Grok/Qoder 的 ACP 仅在结构化精确工具名、本轮实时目录及 allow_once 同时匹配时准入；不因标题或 namespace 前缀自动批准。十二 CLI 的入口和真实限制见 [能力矩阵](cli-harness-capabilities.md)。Codex/Claude/Kimi/Grok/MiMo/Pi/OpenCode/Qoder 有当前执行接入口；Antigravity/Hermes/OMP/ZCode 保留临时注入或额外交互未核验的具体限制。
- 最小回归分组分别记录，**不累计重叠项**：初始关联 macOS 404/404，Windows 401/404（3 个平台跳过）；路由及 ACP 图片能力修复后 macOS 141/141，Windows 140/141（1 个平台跳过）；最终客户端 30/30 两端通过。原生输入 120 项、原生侧栏 18 项通过；四包类型检查、Host/Client 两端类型检查、preview、四包 220 文件校验及 runtime-host 203 文件冻结通过。Windows 699 份源码/运行资源与本地冻结输入哈希一致。
- 正常 Windows Desktop 通过官方安装器安装并冷启动 v0.8.1。Qoder 1.1.73 沿原有 qfmodel / low、同一 Harness child 与原生 CLI 会话，真实完成一次文本文件 + PNG 的只读续聊。原始同 run 事件确认 4 个完成回执：两次 mcp__dsh_worker_tools__read、一次 dsh_list_skills、一次 dsh_read_skill（office）。两次读取均命中仅存在于文件中的随机标识；技能目录和正文均有实际工具回执。initialize 明确声明 image=true，原生历史保留 PNG；终态 end_turn、SUCCESS 和 Worker completed 一致，受管 CLI/MCP 进程归零。
- 此真实任务使用冻结候选 v4 的后端；最终 v5 仅修正追加引用坐标，Host 与协议 sidecar 字节相同。v5 完成最终 Windows 类型检查及 30 项回归，实际连续选择两个不同文件后两个原生草稿引用均保留；清除仅用于验收的未发送草稿。未为这项客户端修正额外调用模型。宿主按既有完成通知行为向父会话追加一条自动回复；不把该自动回复称作无模型调用。本轮未手工切换选型或运行其他 CLI 模型。
- 数据对照：原 18 个 Worker 全部保留、0 活动任务；原 127 个根文件中 123 个字节相同，变化项为已验收 Qoder 的追加事件及最新元数据、原生绑定记录和重启锁。旧 Qoder 事件前缀完整；原生项目 6 个文件中 4 个字节相同，原生 transcript 保留旧前缀并追加本轮，state 更新。原始旧 raw 未改，Qoder 原生/宿主子会话和偏好不变，Hermes config/auth 哈希不变；没有把这些合理写入说成所有文件均不变。
- 实际验收暴露并修复了原生图片选择控件禁用、私有路由仅文本及已有引用后的坐标问题。早期本地回环 socket 的沙箱限制、Windows 模拟 Qoder fixture 被误作自动发现 PE 的测试配置，以及显示缩放导致观察进程坐标虚拟化分别处理；未削弱生产可执行文件保护、未修改系统显示或安全策略。四包检查另修正既有积分可选参数的显式 undefined 类型声明，统计行为不变。
- 私有证据/原包备份位于 .test-data/harness-attachments-20261018 和测试机同名独立目录：canary-verified、preservation-after、execution-source-verified、各回归 JSON、正常安装哈希及 Windows 原生截图。凭据、用户日志和运行数据不进入 Git。
- 边界：macOS 只做源码、离线回归与构建，**桌面验收全部在 Windows**；没有逐个付费实测十二 CLI、第三方 MCP 服务端、复杂 Skill 依赖、真实运行中取消或大图片。普通浏览器文件回执仍不受 rc.2 子会话支持，非文本 MCP 工具结果和额外 DSH 模型辅助操作仍受原桥限制。此真实 Qoder 返回未提供顶层精确 userMessageId，不能据此倒填未披露的积分/Token 或新上下文值。版本保持 v0.8.1，未推送或发布；原生会话 change 第 7 节原缺口不隐藏、不整体归档。

## 2026-10-18：Windows 刷新故障按 CLI 隔离（v0.8.1）

- 用户现场先出现 Grok 模型目录不可读，随后十二 CLI 全红，错误为 `CLI catalog process cleanup did not reach quiescence`。旧实现将可归属某 CLI 的账号/模型元数据清理异常写成全局保护；原 Windows 全局记录修改时间为 14:24:01.487 UTC，跨 Host 重启继续阻断所有 CLI。源码确认 Grok 目录 helper 与本轮附件转换 helper 分离；未发现附件转换触发此全局保护的证据。初次底层清理异常只保留通用错误，**不能据此确定最初的 Windows 驱动原因，也不能把当前账号续期提示倒推为当时清理失败的确定原因**。
- 变更 `isolate-cli-catalog-refresh-failures`：已知 CLI 的账号、路径、目录和任务准入元数据异常，仅持久暂停该 CLI 的查询、账号变更和任务准入；队列与冷恢复同样按 CLI 隔离。损坏的按 CLI 保护只拒绝其 CLI。真实任务范围清理失败及旧无归属记录仍保留全局保护；没有忽略 `waitForExit`、自动清除保护、改写原生登录或放宽停止成功条件。
- Windows 原 Electron 44.7.0 / Node 24.21.0 上的**模拟进程探针**完成 20 次正常元数据命令、10 次中途取消，30 次范围退出均确认。真实已安装 Grok 1.0.50 初始化/版本元数据进程退出码 0、范围退出确认，但账号层明确返回“登录需要续期，请打开 Grok”；没有发起登录或模型请求。早期随 SSH 会话结束而中断的探针不计为通过结果。
- 最终冻结源码 683 文件在 Windows 校验一致，Node v24.15.0 上 8 个关联测试文件 **361/361 通过、0 失败、0 跳过**：cli-settings、cleanup-persistence、runtime-metadata-cleanup、metadata-cleanup、accounts、core、followup-queue、runtime-account-isolation。覆盖十二 CLI 分别发生普通失败、取消及账号/模型清理未确认时其他 CLI 的查询、实际 Runtime 准入、队列和冷恢复；均为明确模拟，不算真实模型验收。新源码首次类型检查因缺少生成的 `lib/typert.remote-client.d.ts` 失败，按正常 Host 构建生成后 Host/Client 类型检查通过，首轮报告保留；本地隔离 preview 构建通过。macOS 关联检查只作离线验证，不累计重复通过数字。
- 空闲备份后通过 Windows 官方安装器安装同版本 v0.8.1，退出码 0；正常退出并冷启动，无调试参数。候选 SHA256 `e92ad0091dc7432268dff90de6454bbc344fb19e5f5365f800d6b12deffc4a1c`（17,989,264 字节），源码 SHA256 `94530f9ce8f506658bfbd32a054d52a6f885c647315ee3f96deaa10b2cd463c2`。已安装 Host/Client 与候选匹配，原生附件 sidecar 和 runtime-host manifest 与安装前相同；没有回退附件功能。
- Windows 正常 Desktop **逐一实际点击全部十二 CLI 的账号刷新和模型刷新**，24 个动作均结束；每次再检查其他 11 个 CLI，共 **132 次跨 CLI 对照，0 次模型选择/保护状态连带变化，未生成全局保护**。预热期间 MiMo 实际出现一次清理未确认，仅 MiMo 受阻，其他 CLI 保持可用，形成真实异常隔离证据。首轮 UIA Invoke 不支持及错误假定所有账号均可用的未完成报告保留；最终报告按现场有效状态比较，没有把 Grok/Kimi 不可用伪装为刷新成功。
- MiMo 恢复先正常退出并确认原 Desktop 五进程范围全部结束，留存其按 CLI 原始保护，再单独执行真实账号/目录元数据检查：三次命令退出码 0、范围退出均确认，读到 `xiaomi/mimo-v2.5` 和 `xiaomi/mimo-v2.5-pro`；观察到的 13 个探针进程全部退出后才正常冷启动。最终重开复核十二 CLI 并再次刷新 MiMo：**无全局/按 CLI 清理保护，十个 CLI 模型选择可用**；Grok 登录需要续期，Kimi 明确提示“登录凭据已过期或即将过期，请打开账号终端完成原生续期或重新登录”。这两个账号条件未通过代登录、借其他 CLI 凭据或模型请求绕过。
- 保全对照：原 21 个 Worker 及其记录均保持原哈希，0 活动；原顶层 142 文件中 140 字节相同，变化为重启后的 host.lock，缺少的旧全局保护已原字节留存于私有备份。9 份 Qoder 项目文件均不变，原偏好不变。官方安装改变 profile package/lock 及 Host/Client bundle，cordis.patch 保持不变。Hermes config.yaml 不变，**auth.json 与本轮起始哈希不同**；基线未保存认证正文，不能逐字段证明变化原因或前后身份完全相同，也不能宣称所有凭据字节不变。本轮未手动登录、退出或改写/回滚认证文件。
- 私有证据位于 `.test-data/windows-cleanup-20261018/` 及测试机对应独立目录：windows-regression、refresh-all-verified、recovery-mimo、mimo-audit、final-ui、kimi-status、preservation-after。完整屏幕/原始控件树下载被自动审批拒绝后，改用限定 CLI 错误、状态布尔值与哈希摘要，未重试完整屏幕导出。macOS Desktop 和 Linux 运行、真实生成/续聊/工具/取消以及全量发布验收均未执行；未新增版本号、提交、推送或发布。
- 本次目录精确归属的 11 个已完成辅助计划任务已清理；同范围剩余任务、辅助进程、活动 Worker 均为 0，正常 Windows Desktop 保持运行，无调试参数，全局和按 CLI 清理保护均不存在（cleanup.json）。主规格仅同步 cli-model-discovery 的“目录证据和生命周期边界”，保留 Purpose、其他需求和原有场景；主规格严格检查 14/14，归档前全规格/活动变更严格检查 21/21。其他变更已有的归档提示与未完成验收不属于本次完成范围。
- 5/5 任务与实际证据核对后，归档到 `openspec/archives/isolate-cli-catalog-refresh-failures`，归档后严格检查 **20/20**；归档前后主规格与本次完整增量一致。最终本次源码/文档空白检查通过，四个生产代码文件仍与已实测、安装的冻结输入相同；未顺带归档其他进行中的协议或发布变更。

## 2026-10-19：Qoder CN 独立接入、Windows 路径发现与设置服务恢复（v0.8.1）

- 按本次授权新增独立 `qodercn`：中国版使用 `qoderclicn`、`.qoder-cn`、`QODERCN_`、`qodercn-acp-v1` 与原生 `qoder-cli-cn` 身份；国际版 `qoder` 保持原身份。账号/PAT、路径、目录缓存、项目偏好、会话协议、清理保护、积分和上下文来源均区分两版。共享 SDK 控制字段与中国版仍使用的 `qodercli.log` 按官方 1.1.74 发行包核验，没有机械替换原生字段。协议细节见 [Qoder CN 原生协议与隔离](qodercn-protocol.md)。
- 泛称“调用 qoder”按安装情况处理：只装国际版使用国际版，只装中国版使用中国版，两版都有则使用 Harness 原生询问框选择；明确国际版、中国版或 `qodercn` 时固定相应身份。只读 resolve 不弹窗、不落盘；取消、项目变化、CLI 禁用或授权条件不满足均不创建任务。路由和询问行为已经模拟回归，未通过真实模型调用验证派遣。
- 提取所有已支持 CLI 共用的 Windows 发现层：常见用户 bin/npm/Bun/Scoop/pnpm 路径、PATHEXT 和有界最新 User/Machine PATH 查询；特殊安装入口与包身份保留各 CLI 声明。自动发现不枚举磁盘或猜最新版本，拒绝已知对侧品牌与 GUI，显式自定义入口优先。真实 Windows 清空继承 PATH 后仍通过该公共层找到系统 Node；其他 CLI 的不同安装器布局由对应模拟回归覆盖，未逐个重新安装所有 CLI。
- Windows Node **v24.15.0**，冻结的 **1359 文件**及生成资源摘要核对一致；复用该机同锁文件依赖，没有升级依赖。最终 Host/Client 类型检查退出 0；30 个关联测试文件 **1192 项：1189 通过、0 失败、3 跳过**，测试用时约 61.5 秒。覆盖注册、账号隔离、Windows 入口、路由询问、原生 ACP/工具/附件、取消清理、恢复及遥测。属于相关范围回归，不是全量发布验收；跳过为平台限定测试，不能当作实际运行成功。
- 保留首轮失败：Windows 首轮同组 1177 通过、12 失败、3 跳过，失败来自旧 PATH/Appx 查询顺序断言、无扩展合成入口和假时钟测试误命中真实 Qoder 安装；只修复四份夹具后重跑同组通过，没有放宽生产入口身份门或清理条件。本地较早一组检查还遇到沙箱禁止 loopback socket 的失败；不将该轮报告写为全绿。最终有效平台结果以前述 Windows JSON 回执为准，不累计重复分组数字。
- Windows 实际入口分别为国际版 **1.1.73** 和中国版 **1.1.74**，独立自动识别。中国版账号检查明确为“尚未登录 Qoder CN”；官方 SDK 账号查询退出 1，但进程范围已确认退出，作为缺少登录的阻塞保留。隔离空根的真实 ACP initialize 返回 protocol 1、`qoder-cli-cn` / `Qoder CLI CN` / 1.1.74、原生登录方法及 loadSession/image 能力；没有创建 Session 或发送 prompt，初始化能力声明不等于工具、图片理解或真实生成验收。
- 本地 `build:preview` 通过，仅生成隔离候选，未更新 Mac Desktop。Windows 确认原 21 个 Worker 均空闲、备份原插件与 profile 后，通过官方 `dsh plugin --profile desktop add --save-exact` 安装并正常冷启动，安装退出 0、无调试参数；已安装七份关键产物与候选一致。候选 **18,008,416 字节**，SHA256 `055d831a00e4c64169f4e5286c7fb06e2ac74c568725dba51ecf1d9a5664c3fa`。
- 初次正常启动出现用户反馈的全部 CLI 设置报错：`active Service "cliworker" is unavailable`。现场 `host.lock` 的 PID 已属于 **Tabbit Browser.exe**，既有存储逻辑仅检查 PID 存活便拒绝创建 Host 服务；该逻辑与本次开始前的源码一致。不能确定旧锁遗留时间和原因，也不把它归因为中国版未登录。正常退出且确认 Harness 范围结束、无活动 Worker、原锁哈希不变后，备份并移除这份确定过期的锁，未结束 Tabbit、未改生产锁规则。重启后新锁由真正 Harness 持有。
- 第一次恢复后在正常 Windows Desktop 实际逐一打开 **13 个 CLI 设置页**，全部页面存在、统一服务报错均不存在；两版 Qoder 有独立页签和对应路径，截取的中国版设置弹窗已目视核对。最后关闭设置。此项只证明该阶段设置服务与品牌路径展示恢复；当时两版模型选择均不可用，中国版缺少登录，未将个别 CLI 的认证/目录提示写成模型可用或全账号通过。
- 保全对照：原 **21 条 Worker** 保持原哈希，顶层 141 文件仅正常重启的 `host.lock` 变化；国际版项目 10 文件、国际版认证 6 文件、中国版认证 2 文件均保持原哈希，中国版原无项目历史。公共路径缓存一份随安装指纹更新；未保存、输出或回滚凭据正文。无活动 Worker，无全局/按 CLI 清理保护；本轮辅助进程和计划任务收尾另存布尔回执，正式 Windows Desktop 保持运行。
- 私有证据位于 `.test-data/qodercn-20261019/` 和 Windows 同名独立目录：`windows-status-final.json`、原始失败/成功测试回执、`native-audit.json`、`installed.json`、`stale-lock-recovery.json`、`all-settings.json`、限定设置截图、`preservation-after.json` 与 `cleanup.json`。账号、日志、截图和备份均不入 Git。
- 上述首次安装和初始化阶段真实模型调用 **0**，当时中国版未登录、未获选型。用户随后完成原生登录并明确授权选型，真实验收及后续桌面故障按下列补录记录，不能继续把未登录状态写成当前结论。Mac Desktop 未操作、未重启、未更新；版本保持 **v0.8.1**，未提交、推送或发布。

### 登录后真实验收与桌面恢复补录

- 用户完成原生登录后，官方只读 SDK 确认 **Qoder CN 已登录、15 个可用模型**；读取前后中国版和国际版认证、项目历史均保持该次读取前哈希。正常 Windows Desktop 实际点击中国版“刷新状态”“刷新模型”，显示“已登录”、模型选择可用、独立页签与服务状态正常。用户在本聊天原生询问中明确选择 **Qwen3.8-Flash / low**，对应实际目录 `qfmodel / low`。
- 使用临时 Cordis 验收扩展调用该正常 Desktop 已安装的正式 `ctx.tools.execute(cliworker_start)`，只在本轮独立目录创建一个真实 Worker。模型/强度问题由明确标注的授权夹具从实时选项匹配用户选择，未冒充真实 UI 点击或原生询问框人工验收。父会话未指定虚构模型、未提交主模型 prompt；只对本父会话配置官方 quiet 完成通知及主模型生成拒绝门。该夹具未改变 CLI 传输、账号授权、工具、模型事件或退出结果。
- **首轮生成与工具通过**：`3ce937f0-f4ab-486f-bd47-560179a77f1e` 使用中国版原生文件工具写入 `artifact.json`，三个字段与独立随机标记完全匹配，实际产物 SHA256 为 `ee7ec2c9d72016244dbc27bfea67f1e3aab0224fad86df6be18a8c3de6af1dbc`；回复精确等于标记，原生工具完成事件、Worker completed 和真实桥退出码 0 相符。
- **同会话续聊通过**：`5abd7b1b-9ac1-4bc6-b73a-7c76a6849343` 不读文件、不调用工具，精确返回上一轮完整随机标记；Worker 和原生会话均未改变。本轮工具事件为 0，状态 completed，真实桥退出码 0。
- **运行中取消通过**：`3df88e4c-418b-426c-8555-65925ec30b30` 在实际 assistant 输出且状态 running 后，由独立控制器提交正式 `cliworker.stop`；stop 返回与最终状态均为 interrupted，同一原生会话保持，真实桥退出码 1。两阶段合计 **14 个实际受管句柄**的 done/范围退出均确认；其中元数据程序退出码 1 与结构化查询成功分别记录，没有把所有句柄写成退出 0。总计 **3 次模型提交**，父会话模型 prompt 为 0，没有因夹具失败重跑付费首轮。
- 保留夹具失败：父代理读取持续写入的证据文件时，Windows rename 出现 EPERM，采集脚本错误地阻断了尚未发出的续聊。正常清理首版夹具后，只修私有证据写入重试和并发采集方式；新版逐项核对真实旧 Worker、首轮事件、原生会话、产物及摘要后恢复同一会话继续剩余两轮。首版原始成功与失败报告保留，源码、正式候选及首轮模型结果均未改写。
- 保留桌面失败：独立测试会话的 UI 树导航检查期间，**14:11:48 UTC** 发生 `Desktop renderer exited: crashed`，窗口显示“DeepSeek Harness 无法使用”。原生 crash 日志没有捕获具体 renderer console 错误，限定时间的 Windows 应用崩溃事件未提供更多信息；当时后台 Host 继续完成了真实续聊、取消及夹具清理。只能确认渲染进程崩溃与导航时间重合，**不能确定触发原因、归因为 CLI 取消或宣称永久修复**。该次原生子会话可见 UI 打开检查未通过，不能由后台成功替代。
- 恢复先确认无活动 Worker、夹具句柄全部退出，再通过错误窗口正常 CloseMainWindow 退出全部 Harness 范围；无需强制结束。移除精确的本轮临时 Cordis 条目，profile 恢复至原字节 SHA256 `7ab7523743666c3928125231a7de171d178f95d525499cb076f24605a4295dd9`，正常冷启同一正式候选，无调试参数。恢复后再次逐一打开 **13 个设置页**，页面与统一服务状态全部通过，设置已关闭，正常 Desktop 保持运行。渲染崩溃归因及正常原生子会话的可见 UI 验收仍列为后续事项。
- 数据保全：原 **21 条 Worker** 均保持原哈希，新增长期可核查的本轮 1 条验收 Worker；国际版认证 6 文件及项目历史 10 文件不变，中国版用户登录后原有 2 份项目文件不变。中国版新增本轮原生历史，其中保留取消时原生程序产生的一份 state 临时文件，不擅自修改原生历史。顶层新增本轮 raw/events、绑定、偏好与续聊记录，原生绑定表正常追加，host.lock 随重启变化。
- 严格全文件保全报告返回 **false**：中国版 `.auth/user` 的真实字节与登录后基线不同，其他中国版认证文件不变。未保存原凭据正文，不能确定变化字段或将其断言为 token 续期；未手工回滚认证。收尾使用正式只读 `authorizeSelection` 与任务开始前保存的私有账号绑定比对，**绑定一致、15 模型仍可用、qfmodel / low 仍有效**，查询及范围退出完成。该身份核验不等同于凭据字节不变。
- 私有补充证据：`login-audit-output.json`、`login-ui.json`、`real-evidence/`、`real-evidence-v2/`、`real-resume.json`、`real-progress-stop.json`、`renderer-crash-current.json`、`renderer-recovery.json`、`all-settings-final.json`、`real-preservation-output.json`、`final-binding-output.json` 与 `cleanup-final.json`。真实调用仅上述中国版选型；未逐一付费验证其他 14 个模型、真实图片理解、共享 Skill/MCP 全链路、Mac 运行时或全量发布。正式双装询问由模拟路由回归覆盖，本次实际选型使用授权夹具，不声称已实际点击该询问框。
- OpenSpec 严格检查 **21/21** 通过；实现与测试源码 699 文件保持最终 Windows 冻结输入一致。本轮源码与说明文档空白检查通过；仓库级 `git diff --check` 仍提示两份既有生成 `source.patch` 中合法统一补丁空白上下文行，不为消除提示破坏补丁格式。活动变更保留桌面可见 UI 与渲染崩溃未决项，暂不归档；未推送、发布或更新 Mac Desktop。
- 最终收尾回执 `cleanup-real-final.json`：本阶段剩余 **8 个**本轮计划任务已清理（此前阶段已单独清理），所有本轮辅助进程、计划任务及活动 Worker 均为 **0**；无全局/按 CLI 清理保护，新锁由真正 Harness 持有，正常 Desktop 保持可见，原 profile 原字节恢复。原 21 个 Worker、国际版认证和历史保持；中国版当前账号绑定一致，认证 user 字节变化继续单独保留，不把严格保全失败覆写为全文件不变。

### Windows 当前面板裁切恢复补录

- 后续检查确认 Windows 官方主包只在 `render-process-gone` 记录 reason，没有记录 renderer exitCode；既有 Crashpad/WER 候选目录未找到本次转储，不能据此确定原生崩溃原因。用户随后明确要求无法定位就停止、避免破坏插件，进一步复现和转储采集未执行。诊断冷启动未执行；临时导航包只上传到私有目录，未挂载进 profile，未修改正式插件或宿主核心。
- 用户截图澄清当前页面有内容、右侧大部分被窗口裁切。现场主进程 **19652**、renderer **1256** 和真正 Harness Host 锁均存活，profile 仍为原哈希。通过普通 Windows 最大化触发布局重排，右栏标题、设置入口、搜索、四个状态筛选及已有任务卡片恢复完整显示。只完成当前窗口的显示恢复，未断言已经修复所有恢复尺寸下的宿主布局，也不将此现象归因为插件服务失效或此前 renderer 崩溃。
- 私有 `renderer-followup/pane-maximize.png` 已实际查看；`page-repair-gui-final.json` 在交互会话 16 确认原主进程仍可见、最大化、响应且无错误窗口。SSH 收尾探针的 MainWindowHandle 为 0，导致其组合 success 为 false；该非交互会话结果保留，由上述真实交互窗口回执补充核验，没有覆盖失败报告。此阶段 renderer PID 保持，未产生新的 crash 日志，无诊断启动参数。
- 以本阶段开始时的 **22 条 Worker** 及当前两版账号为基线，Worker 文件、所有顶层运行文件、两版认证和项目历史均保持哈希；profile 原字节保持，无活动 Worker，新增模型调用 **0**。这个新基线对照不撤销此前中国版 `.auth/user` 曾相对登录后基线变化的记录。8 个已结束辅助计划任务已清理，另一个仅核对窗口的收尾任务自行移除；无插件更新、安装包替换、Mac Desktop 操作或 GitHub 提交／发布。
- 现有验收父会话的两次有界精确标题查询未命中，均立即退出，未发送消息、重跑模型、伪造父 turn 或继续全树导航。Qoder CN 原生子会话可见 UI 仍未验收通过，OpenSpec 保留该未完成项；列表面板恢复不替代此项，停止扩大崩溃排查遵循用户最新要求。
- 私有证据：`renderer-followup/windows-main-meta.json`、`baseline.json`、`pane-geometry.json`、`pane-maximize.json/png`、`child-list.json`、`child-list-text.json`、`preservation-final.json`、`finish-page-output.json` 与 `page-repair-gui-final.json`。仅更新实际记录，未修改产品源码，因此没有重跑产品测试或构建。

### Windows 正常新对话与 Qoder CN 原生子会话验收补录

- 用户再次反馈鼠标操作无响应。限定主窗口的真实 SendInput 点击未切换会话，虽然原生 WM_NULL 与窗口健康检查成功，页面仍未响应；因此前一阶段的最大化截图只证明静态显示恢复，不能继续用作交互通过证据。无新 crash 日志并不排除页面无响应，具体崩溃及冻结原因仍未确定；遵循用户要求，不再扩大诊断、挂载导航扩展或修改正式插件。
- 确认原 **22 条 Worker、0 活动任务** 后，正常关闭未结束冻结实例；校验精确路径、PID 和创建代次后仅结束该实例的主进程，其已核对后代随后全部退出，再以原 profile 正常冷启。新主进程 **4312**，无调试参数、无临时扩展；实际点击已能切换至原验收父会话。首轮恢复脚本因日期类型断言在关闭前拒绝、首轮前台校验拒绝均保留，未将其算作成功。
- 按用户最新要求，实际点击 Windows Desktop“新会话”，在输入框键入请求并点击发送 **一次**，由正常主对话派遣。主对话沿用当时已选 **GLM-5.3-Flash / Low**，有正常模型执行与转述；Qoder CN 使用已授权 **Qwen3.8-Flash / low（qfmodel / low）**。本次没有调用验收扩展、构造父 turn 或直接从脚本创建 Worker，也没有手工点击双装或首次选型询问框，不混用此前夹具的“父模型 prompt 为 0”结论。
- 新 Worker `4b6469a1-3c35-4ea1-9f72-920f6eb3e017`，父会话 `session-a71ba9da-cd5a-4820-a312-651a8acf0f0e`，run `29f3f9d2-9bd0-4964-b417-4ec217341b1d`；原生 CLI 会话 `698fea66-f6e3-4506-a081-287585f77a2a` 与 Harness child `ea11d486-38f7-4472-bbdb-dbacfade3e2a` 分开绑定，协议为 `qodercn-acp-v1`。独立样例 `normal-input.json` 明确标为验收夹具，随机 marker 未放进请求；样例 SHA256 为 `90f12c50fdd046b5ee806ccd22861747e002ea2c123fb161a8fed9e834cf1e49`。
- 本 run 的 **41 条**持久事件及原始协议快照完整稳定：CLI 实际调用 `mcp__dsh_worker_tools__read` 工具桥，输入精确命中该样例路径，完成回执含文件中的随机标识；结果与 Worker 最终文本均为正确 marker 和 `sum: 95`，原始协议结果 `SUCCESS`、Host 终态 `completed`。此次未单独采集原生进程退出码，不倒填为 0；最终只读进程观察确认 Qoder CN 进程和本轮辅助进程均为 **0**，不以此冒充完整逐句柄退出回执。此前三轮真实生成、续聊和取消的逐句柄退出证据仍单独保留。
- 原生可见 UI 已通过：实际点击 `qodercn-file-reader｜读取 JSON 并汇总` 卡片打开子会话，看到“已完成，用时25秒”、正确 JSON、过程展开后的“已调用工具”；点击模型入口能打开菜单及独立 **Qoder CN CLI** 列表，当前 **Qwen3.8-Flash** 有勾选，输入栏显示 **Low**。在该原生输入框实际输入一个字符后截图，再用退格清空并复核占位提示；草稿未发送。上述 25 秒是界面显示的子任务用时，不等于父对话或整轮墙钟时间。没有声称已在界面看到工具完整名称/参数，也未用能力标记推导其他按钮均已实测。
- 界面脚本保留三类未完成步骤：窗口恢复尺寸变化时点击前拒绝、一次无法取得前台焦点时无输入退出，以及私有脚本误用 PowerShell `[ushort]` 类型名而在首次按键前退出。只修私有脚本、改用有效类型并分别保存回执后完成剩余检查；没有修改产品代码、降低焦点/几何保护或重复发送付费任务。正常操作使用原生鼠标和键盘，不再执行 UIA 全树遍历。
- 最终只读证据检查 **14/14 条件为 true、0 issue**：原 **22 条 Worker** 哈希不变，本次仅新增上述 **1 条**完成记录，总数 **23、0 活动**；国际版项目 10 文件及认证 6 文件不变，中国版旧项目 6 文件不变、新增本轮历史 3 文件。中国版认证 **5 文件不变、1 文件真实字节变化**；未保存凭据正文、不能确认变化字段或原因，未回滚、未手工登录，不宣称全部凭据不变。原 profile SHA256 仍为 `7ab7523743666c3928125231a7de171d178f95d525499cb076f24605a4295dd9`，样例不变。此阶段没有正式包更新、Mac Desktop 操作、版本变更、GitHub 提交或发布。
- 私有证据集中在 `.test-data/qodercn-20261019/native-ui-final/` 及 Windows 同名目录：恢复/输入步骤失败与成功回执、`normal-baseline.json`、两轮独立 `normal-evidence/`、`normal-final-evidence-summary.json`、`health-final-before-cleanup.json`、正常派遣与原生子会话截图；原始用户数据、日志和认证均不入 Git。正常调用证据补齐本 change 原生子会话缺口；其他 14 个中国版模型、双装询问框人工点击、Mac 运行时、所有窗口尺寸布局及永久崩溃修复仍未验证。
- `cleanup-native-ui-final.json` 确认精确归属本阶段的 **10 个**已结束计划任务已移除，同范围剩余任务为 **0**；正常 Windows Desktop 与该原生子会话保持运行，输入框为空。没有产品源码变更，因此仅补文档与规格检查，没有重跑产品测试、构建或全量发布验收。
- 核对 **12/12** 任务及本次证据后，使用 OpenSpec 同步中国版 4 项需求和公共 Windows 发现 1 项需求；保留既有 platform-runtime 的标题、Purpose 和全部场景，新中国版主规格沿用增量 Purpose。主规格严格校验 **15/15**；全部严格校验同步前 **21/21**、同步后归档前 **22/22**、归档后 **21/21**。增量已逐项合入后用 `pnpm --config.verify-deps-before-run=false spec archive add-qodercn-cli --skip-specs --yes --json` 归档至 `openspec/archives/add-qodercn-cli`，再核对归档任务、两份增量及活动列表。`--skip-specs` 仅避免重复应用已同步增量；其他活动变更的既有同步提示和未完成事项未修改，崩溃原因未确定及其他未验证边界继续保留。

## 2026-10-20 v0.8.1：Host 生命周期与持久化高危缺陷修复

OpenSpec 变更 `harden-host-lifecycle-durability`。来源为 4 个 Codex gpt-6.1-sol 只读审查及主会话源码抽查（静态结论）；本轮修复与测试均为本地模拟，未提交、未推送、未更新 Desktop。

- 停止：`FollowupQueue.revokeGeneration` 先推进内存代际再写盘，`stop()` 先中止预约、插队消息与当前运行，队列写盘失败只在清理后以“待发送消息状态持久化失败”拒绝本次停止，不设置 `blocked`；`close()` 逐个以 `Promise.resolve().then` 隔离同步异常。回归：`tests/followup-queue.test.ts` 末尾三例（队列路径替换为非空目录模拟写盘失败；无排队消息时停止仍释放启动资源；`stop` 同步抛错）；前一与第三例在 HEAD 版失败；第二例针对 Codex gpt-6.1-sol high 复核发现的问题（初版在停止时设置 `blocked` 导致 `release` 被跳过），恢复该行时失败，修复后通过。
- 存储锁：改为唯一候选 `host.lock.<uuid>`（临时文件 + rename 原子发布）后扫描其他存活候选，冲突撤回并随机退避重试 3 次；失效候选按唯一名删除；兼容的 `host.lock` 继续以 `wx` 写入。回归 `tests/storage-lock.test.ts`：三个确定性用例在 HEAD 版失败、修复后通过；6 进程并发回收失效锁用例在修复前后均通过（竞态窗口太短，无法稳定复现旧缺陷），只作安全检查，不作复现证据。残余限制：与不发布候选锁的旧版本 Host 并发时，`host.lock` 回收仍为旧的非原子语义。
- 断尾恢复：按字节定位最后换行，`ftruncate` + `fsync` 原地截断。回归 `tests/storage-torn-tail.test.ts`：注入“截断后写入失败”故障时，HEAD 版丢失完整前缀，修复后前缀逐字节保留；多字节断尾截断与续写序号通过。
- Windows Codex 环境：后台启动只传 `launch.env`。回归 `tests/native-worker-windows-env.test.ts`（模拟 win32 与描述符）：HEAD 版启动环境含 101 个父环境变量，修复后无关 `*_API_KEY/_TOKEN/_SECRET`、`DSH_*` 不进入 env 或请求文件。
- 工具桥 lease：新增 `adoptNativeHarnessLease`，`index.ts` 发布失败时关闭 lease 并恢复展示模式，清理也失败时以 `AggregateError` 保留两者。回归 `tests/native-harness-lease.test.ts` 用真实本地监听确认关闭；`harness-service-integration.test.ts` 通过。
- 解码：`adapters.ts` `captureCatalogMetadata` 与 `process.ts` `discoverModels` 改用 `StringDecoder`。回归 `tests/catalog-decoding.test.ts`（逐字节分块）：HEAD 版两例失败，修复后通过。
- 检查：`node scripts/build.mjs --typecheck-only` Host/Client 通过（DSH 0.2.1-rc.2）；本 worktree 无构建产物 `lib/`，Client 类型检查时临时只读链接主仓库 `lib/` 取 `typert.remote-client.d.ts`，结束后删除链接。相关 21 个测试文件 342 例通过（Codex 复核修正后复跑）。全量 `vitest run`：3783 通过、2 失败、13 跳过；失败均为 `tests/build-dependencies.test.ts`（`UNRESOLVED_ENTRY lib/typert.remote-client.js`、`lib/types/host/index.js`），因本 worktree 未构建 `lib/`，与本次改动无关，未在构建后复跑。`openspec validate harden-host-lifecycle-durability --strict` 通过。
- 复核：Codex gpt-6.1-sol（high）只读审查未提交改动，按“只报具体缺陷、不加防御/门禁”要求执行；报告候选锁协议、ftruncate、Windows 环境与 lease 修复无缺陷，指出上述 `blocked` 问题并已修正。Codex 未运行写文件测试或 Windows。按防过度防御要求，同时删去 `stopCurrent` 外层 try/catch、解码的字符串分支和锁冲突的错误改写。
- 未执行：Windows 实机（Codex 后台启动环境、`host.lock` 候选锁、`ftruncate` 行为）、真实 CLI/模型、`pnpm build:preview` 与 Desktop 更新。同类 `String(chunk)` 逐块解码仍存在于 `windows-hidden-process.ts`、`managed-agent.ts`、`native-harness-mcp.mjs`、`runtime.ts` stderr 尾部，未在本次范围修复。


## 2026-10-20 v0.8.1：既有失败测试对齐与运行时 stderr 解码

- 对照 Qoder/Qoder CN 主规格、原生附件与设置保存增量、README 和设计记录核对 7 项失败：补齐中国版 PAT／独立登录目录夹具；旧运行时夹具为中国版保留 ACP，使未登录测试继续验证账号拒绝而非误入旧协议；原生注册测试覆盖附件引用与命令两份注册及释放；OpenCode 私有附件路由声明包含 image；默认选型测试改为选择时只更新草稿、切 CLI／关闭时保存，并核对模型限定强度。7 项均属旧断言或夹具遗漏，未改变产品账号、附件或设置行为。
- `runtime.ts` stderr 尾部改用每流独立 `StringDecoder`，流结束调用 `end()`，保留原有 8192 字符尾部及原始字节落盘。新增两项逐字节中文／emoji 与不完整 UTF-8 断尾回归，修复前均复现乱码，修复后同时核对错误内容和原始 stderr 字节。
- 本地定向：按指定 `node node_modules/vitest/vitest.mjs run <file> -t <name>` 逐项复现 7 失败；修复后对 6 文件按名称过滤，目标 7 项及新增 2 项共 **9 通过、0 失败、231 跳过**。
- 全量 `node node_modules/vitest/vitest.mjs run` 首轮受沙箱 `listen EPERM 127.0.0.1` 限制，停止该轮；沙箱外重跑退出 0，**239 文件通过、3 跳过；4367 测试通过、0 失败、13 跳过**，耗时 **71.35 秒**。`tests/http-context-relay.test.ts` 本轮未失败，未修改该文件。`node scripts/build.mjs --typecheck-only` 退出 0，Host/Client 对 DSH **0.2.1-rc.2** 类型检查通过。完整日志在 `/private/tmp/cliworker-vitest-20261020-runtime-unsandboxed.log` 与 `/private/tmp/cliworker-typecheck-20261020-runtime.log`。
- 边界：仅本地模拟／本机回环测试，未运行真实 CLI、模型或 Windows 实机，未访问外网、构建安装包或更新 Desktop；未操作 Git 状态，未修改其他代理负责的四份文件。本任务范围无待确认项。

## 2026-10-20 v0.8.1：合并、剩余解码点、不稳定测试与正式构建

- 合并：`refs/heads/claude/inspiring-easley-211b9f`（Host 高危修复）与 `refs/heads/claude/charming-jackson-c858d5`（`clean` 脚本、Windows 远程白名单）均为未提交 worktree 改动，按“HEAD 为基准、主工作区未提交版为 ours、分支版为 theirs”逐文件三方合并进 `codex/release-v081` 工作区；冲突仅 `src/host/adapters.ts` 两行 import 与本文件末尾两段新增，均保留双方。未暂存、未提交。合并前以 HEAD+主工作区未提交改动重建对照，确认合并未引入新失败。
- 剩余 UTF-8 逐块解码（Codex gpt-6.1-sol high）：`windows-hidden-process.ts`、`managed-agent.ts` 改用每流 `StringDecoder` 并在关闭时 `end()`；`native-harness-mcp.mjs` 已 `setEncoding('utf8')`，未改。新增 `tests/process-stream-decoding.test.ts` 5 项。
- 不稳定测试：`tests/http-context-relay.test.ts` 中“rejects an unowned loopback path…”以两次 20ms 睡眠假设时序，多进程并发压力下 **3/99** 失败；改为等待上游收到请求与 close 事件的明确信号，产品代码未改。修复后隔离连续 30/30、并发压力 99/99 通过。原始全量失败未在全量中直接复现，仅由合成压力复现（待确认）。
- 计数更正：上一段记录的“239 文件、4367 测试”运行时目录中仍有另一代理的 32 份临时压力副本，不作为最终结果。最终全量（临时副本已删除）：`node node_modules/vitest/vitest.mjs run` 退出 0，**207 文件通过、3 跳过；4145 测试通过、0 失败、13 跳过**；`node scripts/build.mjs --typecheck-only` 通过（DSH 0.2.1-rc.2）。
- 构建：确认 Desktop 插件 Host 无子进程、64 个 Worker 均为终态后，`node scripts/build-preview.mjs` 通过；再次确认无活动任务后正式 `node scripts/build.mjs` 通过，`lib/` 更新，`tests/build-dependencies.test.ts` 10/10。Desktop 通过 `~/.dsh/profiles/desktop/node_modules/dsh-cliworker-now` 链接本仓库，运行中的 Host 需重启 Harness 后才加载新构建；本轮未重启 Harness，未做 Desktop UI 验收。
- 真实 CLI 目录读取（不发送提示）：`scripts/smoke-extended.ts --catalog-only` 对 pi、opencode 返回“当前账号暂无可用模型”，omp 返回“无法安全保存账号续期”，zcode 要求显式授权的原生认证目录；在 HEAD 临时 worktree 复跑 pi/opencode/omp 结果相同，判定为本机账号状态阻塞，非本轮回归。`smoke-native` 因 Desktop 状态中无项目保存选型，全部为 blocked，未写入选型。
- Windows：`.test-data/windows-remote/config.json` 记录的地址 SSH 连接超时，Windows 远程回归与实机验收未执行，需用户提供当前地址。真实模型调用未执行。

## 2026-10-20 v0.8.1：Claude Code 官方账号模型目录兼容 2.1.287

- 现象：重启 Harness 后 Claude Code 模型目录无法读取。本机插件使用 Homebrew `claude` **2.1.287**（`cli-executable-paths` 自动发现），而官方账号目录逻辑按 2.1.296 输出编写。CC Switch 当前未写入路由，`readClaudeOwnRoute` 正确选择官方登录分支；路由分支代码未修改。
- 根因（真实 CLI 仅发送 `initialize`/`get_usage` 元数据控制请求，未发送提示）：① `account` 无 `tokenSource`，改报 `subscriptionType: 'Claude Pro'`，被判为未登录；② `get_usage` 返回 `rate_limits: null`，原设计把未知额度视为拒绝；③ 模型清单重复返回相同的 `default` 条目，被判为重复冲突；④ `claude-fable-5-1[1m]` 因 ID 规则不允许方括号被过滤。
- 修复（`src/host/claude-native-oauth.ts`、`src/host/adapters.ts`）：身份接受 `tokenSource: claude.ai` 或“无 tokenSource 且有 subscriptionType”，API key/helper、非 firstParty、无邮箱仍拒绝；订阅类型非 pro/max/team/enterprise 仍拒绝；额度未知时保留模型并在目录说明提示“剩余额度暂无法确认，以实际调用为准”，确认用尽仍阻止；同 ID 同解析模型的重复条目合并，冲突仍拒绝；模型 ID 允许末尾 `[1m]` 类后缀。设计记录同步更新 `doc/design.md`。
- 验证：`tests/claude-native-oauth.test.ts` 更新并新增 2.1.287 账号形态、无订阅拒绝、未知额度保留模型、重复合并/冲突、`[1m]` 保留用例；与 `claude-own-route`、`first-party-models` 合计 **156/156** 通过。真实 CLI 本地复现脚本（`.test-data/claude-catalog-20261020/`）修复前失败，修复后返回 `default、opus、claude-fable-5-1[1m]、sonnet、haiku` 5 个模型及额度未知提示。全量 **207 文件、4149 通过、0 失败、13 跳过**，typecheck 通过；确认无活动任务后 `build-preview` 与正式 `build` 通过，`build-dependencies` 10/10。
- 未验证：CC Switch 路由开启时的真实目录读取（当前未开启路由，未改动用户 CC Switch 配置）；真实模型调用；需重启 Harness 后在界面确认。

## 2026-10-20 v0.8.1：目标、规划、反馈与分支桥接到全部 CLI

- 范围与决策见 `openspec/changes/bridge-conversation-features/` 和 `doc/design.md` 同名小节。用户选定：目标为插件持久目标、每轮注入、不自动续轮；分支为最新轮全部可用、较早截点按原生能力；反馈只记录在 Harness；授权低成本模型真实验收。
- 实施：主会话完成能力契约（`conversation-features.ts`、绑定能力键与旧绑定兼容），三路 Codex gpt-6.1-sol high 并行实施 Client 入口/GoalBar/禁用提示、Host 目标与 `/goal`/`/plan`、原生分支（`worker-fork.ts` 及各原生桥）。分支经本机源码/协议核实后降级：Grok、OMP 整项不支持；较早截点仅 Codex。
- 验证：Host 目标相关 6 文件 148 通过；Client 新增 14 项通过，旧菜单断言（`tests/harness-native-commands.test.ts`）按新增入口更新后 2 文件 27 通过；分支相关多轮 367/367、62/62、Pi/OMP 72/72 通过（各轮有重叠）。集成后 `node scripts/build.mjs --typecheck-only` 通过（DSH 0.2.1-rc.2）；全量 `vitest run` **213 文件通过、3 跳过；4249 通过、0 失败、13 跳过**；`node scripts/build-preview.mjs` 通过。
- 未执行：真实 CLI/模型的目标与分支验收（未开始，待用户确认执行方式）；正式构建与 Desktop UI 验收；Windows。
- 真实低成本验收（2026-10-20，`scripts/smoke-features.ts`，在沙箱外运行，证据位于 `.test-data/feature-smoke/run-*`）：目标注入和最新轮分支在 **Codex gpt-5.6-luna low**（另含较早轮分支、暂停后不注入）、**Claude haiku**（延迟分支、暂停后不注入）、**Pi glm-5.3-flash**、**Qoder efficient** 上全部通过。通过的判定为：CLI 实际收到的请求含目标块，新旧原生会话 ID 不同，分支保留截点前的上下文，原会话可以继续。**Grok grok-4.5**、**OMP glm-5.3-flash** 的目标注入通过（这两个 CLI 的分支本就不支持）。失败项：OpenCode 分支后新会话首轮 HTTP 404（疑似原生状态目录未共享）；ZCode 分支报 “No workspace checkpoint is available yet.”；MiMo 第二轮 “原生轮次缺少助手终态”；Qoder CN 第二轮 “账号已变更”；Hermes 免费模型 429 限流后超时（提供方问题），已换模型重跑，结果未核对；Antigravity 首轮失败是脚本未把模型解析成带强度的变体 ID，已修脚本并重跑，结果未核对。Kimi 凭据过期，阻塞。前四项修复未完成（排查代理因额度中止，可能留有部分改动，需复核 `git diff`）。


## 2026-10-20 v0.8.1：OpenCode / ZCode 分支烟测最小修复

- 已读取主会话 common-brief.md 与 agent-c-report.md，保留现有工作区改动；本次不运行真实 CLI 模型调用、不正式 build、不更新 Desktop、不做 Git 写操作。
- OpenCode 根因证据（只读 SQLite）：`.test-data/feature-smoke/run-kcm8YW/opencode/worker-state/native/564304b3-6bb7-4e5e-a43c-f0be951cd851/data/opencode.db` 含源 `ses_ea75a71e0ffe4JV7CeFVPvptny` 和分支 `ses_ea75a221fffeNtq9sP4ZIrcadF`；新 Worker `9db5b021-55fc-48f0-a154-316b85f3d59c` 的数据库 session 表为空，raw/result 为 GET 404，其 `.fork.json` 只有历史来源而无 `nativeStateWorkerId`。`opencode-adapter.ts` 按状态根设置 `OPENCODE_DB`，确认为分支与后续启动使用不同数据库。
- 修复：`worker-fork.ts` 将 Pi 已有的原生状态根引用继承扩展到 OpenCode 和 ZCode，支持重启与嵌套分支直接沿用最初状态根。ZCode 的 `zcodeEnvironment` 同样按状态根设置 `ZCODE_SESSION_DB_PATH`；一并避免其成功分支后恢复找不到原生会话。未修改既有失败烟测目录或原生数据库。
- ZCode 根因与本机协议：`/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`（0.16.9）的 `Usr/mGt` schema 允许 `{kind:'message',messageId}`；`ZKo/vXa → mRo/lRo/oRo` 在无后续 checkpoint 时走纯消息复制，`P6e/R6e` 包含指定助手及同轮响应，不要求工作区检查点。旧 latestCheckpoint 默认导致纯对话失败，也可能在已有旧检查点时遗漏后续消息。`run-3nicAz` 的 session.sqlite 有两组用户/助手消息（助手 finish=stop），无 checkpoint 条目。
- `native-zcode.mjs` 现于 resume 后用 `session/messages` 读取活动链的最新原生助手 ID，再调用 message 目标的 `session/fork`；缺失助手 ID 时明确中文拒绝。不发送 `session/send`、不伪造检查点；较早截点仍禁用。README 中英文、设计与该 OpenSpec 增量场景同步；4.3 真实复验与4.4正式构建仍未勾选。
- 新增7项模拟回归：Pi/OpenCode/ZCode 重启及嵌套分支共3项；ZCode 精确原生消息目标1项、缺失消息/助手ID3项；原有 latestCheckpoint 测试改为无检查点的最新助手 message 分支，验证不发模型请求和关闭新会话。新增重启夹具调试期间因重复Host锁、缺失完整capabilities及默认字段差异失败，已修正夹具后重跑，无产品校验绕过。
- 最终关联回归：`node node_modules/vitest/vitest.mjs run tests/worker-fork.test.ts tests/native-fork.test.ts tests/worker-fork-runtime-native.test.ts tests/native-zcode.test.ts tests/worker-fork-official.test.ts tests/native-transport.test.ts`：**6文件，111/111通过，0失败，2.77秒**。
- `node scripts/build.mjs --typecheck-only`：Host/Client 对 DSH 0.2.1-rc.2 通过，0类型错误。`node scripts/build-preview.mjs`：通过，隔离包 `.cache/preview-package`；已核对构建产物保留 ZCode message 分支与共享状态根继承。OpenSpec `validate bridge-conversation-features --strict --no-interactive` 通过；范围内 `git diff --check` 通过。
- 本次没有修复后真实账号/模型、Desktop UI 或 Windows 复验，没有全量回归、正式构建、安装、提交或发布。主会话需使用新隔离包重跑 OpenCode/ZCode 分支首轮及原会话继续；此前失败分支的私有状态未做追溯迁移，应重新创建分支复验。

### 接续审阅与重新验证（2026-10-20）

- 重新审阅遗留差异并只读核对烟测数据库、本机 ZCode schema 与处理源码：两项生产修复已完整保留，无需回退。MiMo 的 HTTP 消息 ID 与相关 response-audit 测试、Qoder CN 等并行改动保持原样。
- 本轮新增3项模拟测试：ZCode 原生助手消息缺少 ID、ID 为空白的拒绝路径；相同原生状态根复用数据库、不同状态根即使共享账号仍隔离数据库。结合已有重启及嵌套分支用例覆盖状态目录恢复。
- 最终运行 `node node_modules/vitest/vitest.mjs run tests/worker-fork.test.ts tests/native-fork.test.ts tests/worker-fork-runtime-native.test.ts tests/native-zcode.test.ts tests/worker-fork-official.test.ts tests/native-transport.test.ts tests/zcode-adapter.test.ts tests/opencode-adapter.test.ts`：**8文件，166/166通过，0失败，3.39秒**；此前6文件111项重跑也通过，不将两轮重叠结果累加。
- `node scripts/build.mjs --typecheck-only`：Host/Client 对 DSH 0.2.1-rc.2 通过；OpenSpec 严格校验和本任务路径 `git diff --check` 通过。本轮仍未运行真实模型、Desktop 或 Windows 复验，未执行 Git 写操作。
- 最后运行 `node scripts/build-preview.mjs`：退出码0，隔离包 `.cache/preview-package` 构建成功；未更新正式 Desktop 链接。

## 2026-10-20 v0.8.1：MiMo / Qoder CN 续聊烟测修复复核

- 先读共同交接并审阅未提交 diff，保留并验证上一代理已落下的两处最小修复。本轮未编辑 `native-session-http.mjs`、`native-opencode.mjs`、`native-zcode.mjs`、`worker-fork.ts` 或 runtime 分支/原生状态目录区域，未回退其他未提交改动。
- MiMo 证据：`run-rlhIPS/mimo/worker-state` 首轮 raw/events 为 SUCCESS，第二轮 raw 只有原生路由、模型、会话与“原生轮次缺少助手终态”，没有提供方额度/模型错误。只读原生 SQLite（`mode=ro`、`query_only=ON`）核对同一会话：首轮用户 ID `msg_ce1c…`，助手 `msg_g001a158a416d4001Yj4CLjRoC`，`finish=stop`；第二轮用户 `msg_afb152868f5ba488fa60f70dde4f4ea660fe` 已保存、文本以前置目标块开始，但无第二轮助手。安装版 0.1.15 源码的 `existing-assistant` 分类按 `lastUser.id < assistant.id` 判断旧助手已回答；原随机十六进制 ID 排在 `msg_g` 前，与目标文本无关，未见远端额度/模型错误。候选修复仅为 MiMo 使用核实过的原生格式时间排序 ID，保留缺少助手及终态失败校验。
- Qoder CN 证据：`run-tbkGD7/qodercn/worker-state` 的首轮 SUCCESS 后，第二轮在准入处失败且没有第二轮 raw。只读目录元数据确认 `.qoder-cn/.models` 创建于 **2026-10-20 09:32:48.280 UTC**，正处首轮运行中，含 `catalog-v7` 和 `default`，没有 `customs`；安装版 1.1.74 源码将这些文件用于模型缓存，将 `customs` 作为独立自定义路由。旧绑定逻辑在 `.models` 尚不存在时不添加路由，存在后却添加 `customs: absent`，使同账号发生虚假变化。保留 `qoder-accounts.ts` 的最小修复：只绑定实际存在的 customs；主体、PAT、自定义路由新增/改写/删除仍改变绑定，未修改 runtime 的拒绝条件。
- 模拟测试：保留上一代理已有的含目标/无目标 MiMo 续聊及 CN 浏览器/PAT 缓存初始化回归；本轮新增 **3 项**（CN 完整账号绑定哈希与真实账号切换授权拒绝 1 项；含目标/无目标仍缺少助手时失败 2 项），全部夹具明确标为模拟，不运行真实登录或模型。
- 实际命令：`node node_modules/vitest/vitest.mjs run tests/qodercn-accounts.test.ts tests/qoder-accounts.test.ts tests/session-http-response-audit.test.ts tests/cli-account-binding.test.ts tests/runtime-account-isolation.test.ts tests/native-primary-runners.test.ts` 退出 0，**6 文件、269 测试通过、0 失败**，14.19 秒；`node node_modules/vitest/vitest.mjs run tests/worker-goals.test.ts tests/native-runtime.test.ts` 退出 0，**2 文件、33 测试通过、0 失败**，4.02 秒。两组无重叠，合计 **8 文件、302 测试通过**。更早基线为 3 文件 124/124，与上述测试重叠，不累加。
- `node scripts/build.mjs --typecheck-only` 退出 0，Host/Client 对 DSH **0.2.1-rc.2** 类型检查通过。本轮没有真实 CLI 模型调用、账号操作、build-preview、正式 build、Desktop/Windows 验收或 Git 写操作；真实模型复验由主会话执行。OpenSpec 4.6 仅勾选本地修复和模拟验证，4.3/4.4 仍未完成，不归档。
- `node node_modules/@fission-ai/openspec/bin/openspec.js validate bridge-conversation-features --strict --json` 退出 0，**1/1 变更通过、0 issue**；重新读取 apply instructions 为 **14/16**，4.6 已完成、4.3/4.4 保持未完成。本任务路径 `git diff --check` 通过。

## 2026-10-20 v0.8.1：目标与分支真实复验收尾

- 修复后复验（`scripts/smoke-features.ts`，在沙箱外运行，各 CLI 只用目录中最便宜或免费的模型，证据在 `.test-data/feature-smoke/run-*/report.json`）：**OpenCode glm-5.3-flash、ZCode GLM-5.3-Flash、Qoder CN fast、MiMo mimo-v2.6-flash** 的目标注入、最新轮分支和原会话续聊全部通过。判定依据：CLI 实际请求含目标块，新旧原生会话 ID 不同，分支能答出截点前的暗号，原会话可以继续。**Hermes solar-mini4:free**、**Antigravity gemini-3.8-flash** 的目标注入通过（这两个 CLI 不支持分支）。上一段列出的失败项至此全部解决。
- 复验过程中的非产品问题：Hermes 首次失败为免费模型 429 限流；Antigravity 首次失败为脚本未解析带强度的变体 ID，第二次为 150 秒超时，用默认 240 秒重跑后通过；MiMo 有一次首轮失败，原因是模型想用 bash“记住”暗号，被插件按原有策略拒绝额外授权，于是在首轮提示里加入“不要使用任何工具”。
- 汇总：12 个 CLI 中 11 个已真实验收；**Kimi 因登录凭据过期阻塞，未验收**。较早轮分支只有 Codex 支持，已真实通过；暂停目标后不再注入，已在 Codex、Claude 上验证。
- 检查：`node scripts/build.mjs --typecheck-only` 通过；全量 `vitest run` **213 文件通过、3 跳过；4266 通过、0 失败、13 跳过**。确认 Desktop Host（pid 96558）没有子进程、64 个 Worker 都处于终态后，执行 `node scripts/build-preview.mjs` 与正式 `node scripts/build.mjs`，均通过；`build-dependencies` 10/10。重启 Harness 后才会加载新构建；Desktop 界面上的禁用提示、GoalBar、分支入口尚未目测验收；Windows 未验收。

## 2026-10-20 v0.8.1：失败轮分支与原生视图命令源修复

- 对照已归档 `conversation-feature-bridge` 规格修复既有行为。Client 只接受 completed 且含助手消息的轮次；模拟覆盖第一轮完成、第二轮输出后 error/interrupted、空完成轮、DOM 禁用和点击/键盘/共享分支路由不发送请求。最新正常完成轮仍可分支。
- 核实安装的 Harness `uiWorkspace.openSession → replaceMain → retain(source: mainView)` 确实打开原生主视图；Worker 面板的 openWorker 和 activeHarnessSessionId 仅选择面板中的 Worker。复用公开 composer 槽位和随包 runtime 已有的 commandSource 属性，只对已登记 CLI Worker 设置 cliworker-settings。模拟覆盖主视图/侧栏菜单、原生 trigger/popup controller 的规划选取、普通/无会话源保留、晚到绑定及卸载清理。
- `node node_modules/vitest/vitest.mjs run tests/client-conversation-features.test.tsx tests/harness-native-commands.test.ts tests/harness-native-content.test.tsx tests/harness-dom-guard.test.ts tests/worker-fork.test.ts tests/panel-native-composer.test.tsx tests/host-runtime-package.test.ts`：退出 0，**7 文件、101 项通过、0 失败**，1.68 秒。本轮新增 **8 项模拟测试**；前一组 5 文件 89 项与本组重叠，不累计。
- `node scripts/build.mjs --typecheck-only`：退出 0，Host/Client 对 **DSH 0.2.1-rc.2** 类型检查通过。未触碰主会话正在修改的 runtime.ts、types.ts、storage.ts、harness-worker-goal.tsx、harness-goal-editor.ts、harness-conversation-commands.ts；未改 Harness 核心、node_modules、runtime-host，未执行 Git 写操作、真实 CLI/模型、正式构建或 Desktop/Windows 目测。
- 最后执行 `node scripts/build-preview.mjs`：退出 0，隔离包 `.cache/preview-package` 构建成功，Host 和 Client 打包分别 66ms、110ms；构建有既有 CommonJS 与 onlyBundle 提示，没有构建错误，未更新正式 Desktop 链接。本次路径的 `git diff --check` 通过。

## 2026-10-20 v0.8.1：桥接改动审查修复与 OpenSpec 归档

- 规格：用户确认不再验收 Kimi（凭据过期，保持未验证）。勾选 4.3、4.4 后，严格校验通过并归档为 `openspec/archives/bridge-conversation-features/`；新规格 `openspec/specs/conversation-feature-bridge/spec.md` 已补写 Purpose，`validate --specs --strict` 16/16 通过。
- 审查：Codex gpt-6.1-sol high 内置审查器只读审查本轮桥接改动，报告 3 项 P2 缺陷，主会话逐项核对后均成立并已修复：
  1. 分支截点把失败或中断结束的轮当作完成轮（`src/client/harness-worker-fork.tsx`），可能静默从上一轮分支。现在只纳入结束原因为 `completed` 且有助手消息的轮，失败轮的按钮保持禁用。
  2. 清除目标后 revision 从 1 重新计数，旧窗口发来的过期请求可能删除或改动新目标。新增 `Worker.goalRevision`，清除时递增并持久保存，之后不再复用（runtime、storage、`/goal`、GoalBar）。新增模拟回归。
  3. 分支后通过 `openSession` 打开的 Harness 原生主视图使用默认命令源，“+”菜单里没有目标、反馈等入口。新增 `src/client/harness-native-command-menu.tsx`，替换 `conversation.composer.bar` 槽位，只给已绑定 Worker 的 CLI 子会话传入插件命令源，普通会话保持原状。
- 检查：`node scripts/build.mjs --typecheck-only` 通过；全量 `vitest run` **213 文件通过、3 跳过；4275 通过、0 失败、13 跳过**。确认 Desktop Host（pid 96558）没有子进程、64 个 Worker 都处于终态后，`build-preview` 与正式 `build` 均通过，`build-dependencies` 10/10。
- 未执行：这 3 项修复只改了 Client 与目标版本逻辑，没有改原生调用路径，因此没有再发起真实模型调用；Desktop 界面目测并入当晚 Windows 验收；需重启 Harness 才会加载新构建。

## 2026-10-20 v0.8.1：Windows 实机验收与权限入口说明修正

- 环境：用户提供的 Windows 地址与 `config.json` 记录一致（172.22.75.103）。远程隔离回归 `node scripts/windows-remote.mjs` 通过：**111 通过、1 待定**。分批定向 Vitest 在同一隔离环境运行，均退出 0：76 项、4 项（`storage-lock`）、108 项（分支、目标、原生运行时）、112 项（会话功能、原生命令、OpenCode/ZCode/QoderCN、HTTP 审计）。
- Windows 修复：`tests/storage-lock.test.ts` 并发用例的子进程用盘符路径动态导入，Windows ESM 拒绝该写法，改为 file URL；Mac 4/4、Windows 4/4 通过。只改测试，产品代码不变。
- 安装：先 tar 备份已安装插件（`installed-backup-before-bridge-20261020.tar`），通过菜单正常退出 Harness，确认无 Harness 进程、所有 Worker 都处于终态后，用 `dsh.cmd plugin --profile desktop add --save-exact` 安装预览包，并逐个比对 lib 文件哈希：636/636 一致，版本 0.8.1。下述文案修正后，以同样流程重装 `bridge-20261020b.tgz`（SHA-256 `763D166B…584C9B`），636/636 一致。
- 界面验收（Qoder CN 子会话，Harness 正常启动、无调试参数）：
  - 规划控件禁用，悬停提示“当前 CLI 不支持规划模式”；消息分支按钮可用。
  - “+”菜单依次列出模型、权限、规划、目标、反馈、分支及各自说明。
  - 反馈入口打开 Harness 的“提交反馈”对话框（含分类和详情）。未提交，按 ESC 关闭。
  - 目标：编辑器为空时“保存目标”禁用，输入后可用。完成设置、编辑、暂停（“已暂停的目标”）、恢复、清除，目标栏随状态变化；清除后 Host 存储 `goal` 为空，`goalRevision` 递增到 5，与修复后不复用 revision 的设计一致。测试目标文本均标注 SIMULATED，已清除。键盘输入的空格被远程桌面的中文拼音输入法吞掉；改用剪贴板粘贴后空格完整保留，可见插件只去掉首尾空白。
- 发现并修正：不支持规划的 CLI 只有“允许编辑”一种权限模式，所以权限入口禁用本身正确，但原先借用“当前 CLI 不支持规划模式”作说明，容易误导。新增 `harnessPermissionReason`，“+”菜单和权限控件都改为“当前 CLI 只有“允许编辑”一种权限模式”，规划自身的提示不变。README 中英文同步更新。Windows 上悬停权限控件及“+”菜单都已显示新文案。
- 检查：类型检查通过；`client-conversation-features`、`harness-native-commands` 35/35 通过。确认 Mac 无活动 Worker 后，`build-preview` 与正式 `build` 均通过，`build-dependencies` 10/10。
- 收尾：Windows Harness 保持正常运行，无活动 Worker；本轮界面自动化的计划任务都已注销。远端还有 15 个更早留下的 `CLIWorker-AGYBridge-*` 计划任务，不属于本轮，未删除。
- 未执行：Windows 上没有发起真实模型调用或实际分支（分支已在 Mac 真实验收）；Kimi 按用户决定不验收；没有全量回归，没有 Git 提交或发布。

## 2026-10-20 v0.8.1：热重载清空原生输入框控件与分支双提示框修复

- 现象（用户报告，Codex 只读查看 Mac Desktop 确认）：普通会话和 CLI 子会话的输入框只剩“+”、发送和上下文占用；模型选择、访问模式、规划、步数/Token 统计都消失，“+”也打不开菜单。Windows 同一构建冷启动后一切正常。
- 根因：Mac Desktop 通过 link 直接加载本仓库，Harness 开着 HMR。22:36 在 Harness 运行中重新构建 `lib/` 触发插件热重载。`ctx.slots.register` 本身是 Cordis effect，作用域销毁时它先于插件自己的清理执行，于是 `conversation.composer.bar` 替身条目带着借来的 `children` 被销毁。slot 核心销毁带 `children` 的条目时会清空全部子槽位（model、permission、plan、left、right、overlay 等），对所有会话生效，且不会自动重建。
- 修复：`src/client/harness-slot-shadow.ts` 用 getter 暴露借来的 `children`，替身仍在条目列表中时才返回，任何销毁路径都不会再连带清空原生子槽位。
- 分支按钮双提示框：DOM 守卫在禁用时除了 Harness Tooltip 还写了浏览器 `title`，导致出现两个提示。现在不再写 `title`（保留按钮原有值）。按钮可用时也不再叠加插件 Tooltip，只用原生按钮自带的“在新对话中分支”。
- 回归测试：新增“热重载时作用域先销毁替身注册”测试（真实 SlotCore），在修复前失败（子槽位声明被清空）、修复后通过；新增可用分支不叠加提示、守卫不写 `title` 的断言。全量 `vitest run`：**213 文件通过、3 跳过；4276 通过、0 失败、13 跳过**；类型检查通过。
- 端到端（隔离 `dsh web`，DSH_HOME 与 HOME 均在 `.test-data/web-repro`，仅 127.0.0.1）：加载本插件后，同一页面连续热重载两次，访问模式和模型选择都保留；临时换回旧代码后热重载，两者立即消失，只剩“+”和发送，与用户现象一致；恢复修复后刷新页面，控件恢复，再热重载两次仍保留。隔离环境没有配置模型，“+”菜单在原生对照中同样打不开，因此“+”菜单和统计组件未在该环境验证。
- Desktop 复验（Mac）：确认无活动 Worker 后，以系统正常退出关闭 Harness，23:18 重新打开。Codex gpt-6.1-sol high 用 Computer Use 只读查看：普通会话与 Qoder 子会话的输入框都恢复了“+”、访问模式、模型选择、发送和三个统计组件（普通会话 `28 轮 84 步 · 65 tok/s`、`2.1M tok · 缓存命中 84%`、`上下文已用 5%`；子会话 `1 轮 1 步`、`0.2835 积分`、`上下文已用 17.6%`）。两个“+”菜单都能打开，子会话菜单列出模型、权限、规划、目标、反馈、分支等 8 项。23:22 在 Harness 运行中重新构建，触发真实热重载，以上组件全部保留。
- 同时修正：不支持规划的 CLI 的访问模式按钮原先显示“当前：Custom”（锁定分支直接渲染原生控件，没有传入该 CLI 的权限目录）。现在锁定状态也走 `CliControl`，读取 CLI 的实际权限（只读，不保存），显示为“访问模式，当前：允许编辑”，悬停提示“当前 CLI 只有“允许编辑”一种权限模式”。新增模拟测试，覆盖映射到原生预设、保持锁定、不保存；Desktop 已由 Codex 确认。
- 未验证：分支按钮的悬停提示。合成鼠标移动事件没有触发 Harness 的悬停，截图里也没有提示框，结论只来自单元测试；需要用户手动悬停确认，尤其是较早轮次或运行中的禁用按钮。Windows 未重新打包（安装版不链接仓库，不受构建热重载影响）；没有 Git 提交。

## 2026-10-20 v0.8.1：CLI 子会话“+”菜单改为原生分段样式

- 需求（用户）：CLI 子会话的“+”菜单原先是平铺列表，没有图标和分段标题；改成与原生菜单一致，能复用原生的就直接复用。
- 对照来源：原生 `dsh-client-ui-commands` 的 `SECTION_ROWS`/`HOST_FACES`（添加：文件、目标、计划、反馈；指令：压缩、权限、模型、下载日志），模型行图标取自 Desktop 内置 `ui-model-selection`（`IconDataOutlineRegular`），文件行取自 `ui-conversation`（`IconPaperclipOutlineRegular`）。
- 实现：`harness-native-commands.ts` 与 `harness-native-attachments.ts` 的候选项改用原生图标、名称和分段：添加（file 文件、image 图片、goal 目标、plan 计划、feedback 反馈），指令（permission 权限、model 模型、fork 分支）。分段标题取原生 `command` 词典的 `section.add`/`section.commands`，缺失时回退“添加/指令”。空查询按分段排列；输入关键字时改用原生 `rankByName` 排序，且不显示分段标题，与原生 `candidates` 一致。说明文字保留 CLI 专属文案，不支持的入口仍显示原因。`/规划` 与 `/计划` 都对应计划。README 中英文同步。
- 检查：类型检查通过；全量 `vitest run` **213 文件通过、3 跳过；4277 通过、13 跳过**（新增断言覆盖分段、名称、图标、关键字排序；测试中 primitives 为模拟桩）。`build-preview` 确认 primitives 仍为外部原生依赖；确认无活动 Worker 后正式 `build` 触发 Desktop 热重载。Codex gpt-6.1-sol high 代码审查无问题。
- Desktop 验证（Codex Computer Use，只读）：`qoder-1｜说你好` 子会话“+”菜单显示“添加”“指令”两段，8 行顺序、名称、标签、图标全部符合预期；`/mod` 只剩模型一行，无分段标题；与普通主会话原生菜单对照一致（原生另有压缩、下载日志、dsh-visible-workflows，CLI 子会话不提供）。热重载后输入框的访问模式、规划、模型、`1 轮 1 步`、`0.2835 积分`、`上下文 17.6%` 均保留。首次验证发现文件行名称为 `attach-file`，已改为与原生一致的 `file`（图片行改为 `image`）并复验通过。
- 未执行：未点击菜单行实际触发功能（行为未改，沿用既有测试）；Windows 未重新打包；没有 Git 提交。

## 2026-10-20 v0.8.1：不支持规划的 CLI 子会话移除禁用的“规划”按钮

- 需求（用户）：Qoder 等不支持规划的 CLI 子会话，输入框下的禁用“规划”按钮可以移除。
- 实现：`harness-control-guards.tsx` 中，规划不可用时 `conversation.input.plan` 不再渲染禁用按钮，直接留空；可用的 CLI 和普通会话仍用原生 PlanChip。“+”菜单的“计划”行保留，并照常显示“当前 CLI 不支持规划模式”。README 中英文和 `doc/design.md` 已同步。
- 检查：类型检查通过；PlanChip 测试改为断言“不支持时不渲染、未绑定会话仍显示原生控件、不读写权限”；全量 `vitest run` **213 文件通过、3 跳过；4277 通过、13 跳过**。确认无活动 Worker 后，`build-preview` 与正式 `build` 均通过，Desktop 已热重载。
- Desktop 验证（Codex Computer Use，只读）：`qoder-1｜说你好` 的控件从左到右为“+”、“允许编辑”（禁用）、“Low”（Qwen3.8-Flash）、发送，没有“规划”按钮。下方统计仍为 `1 轮 1 步`、`0.2835 积分`、`17.6%`。“+”菜单的“计划”行仍在，原因文字正确。主会话控件不受影响。
- 未执行：支持规划的 CLI 没有在 Desktop 复验（代码路径未改动，由既有测试覆盖）；Windows 未重新打包；没有 Git 提交。

## 2026-10-21 v0.8.2：发布与 README 精简

- 范围（用户批准发布为 v0.8.2）：CLI 子会话“+”菜单原生分段、移除不支持规划的禁用按钮、热重载保留原生输入框控件、分支单提示框，以及 goal/plan/feedback/fork 桥接。版本号、Codex/ACP/MCP/Hermes 客户端标识改为 0.8.2。
- README：中英文改为精简概览；原有各 CLI 账号、路径、模型规则、安装细节、兼容队列与开发说明原文迁入 `doc/usage-details.md` / `doc/usage-details.en.md`，README 只保留链接。
- macOS：类型检查通过；全量 `vitest run` **213 文件通过、3 跳过；4277 通过、0 失败、13 跳过**；OpenSpec 严格校验 23/23；`build-preview` 与正式 `build` 通过，Host 及全部 helper 逐字相同，Client 仅打包路径注释不同。
- 安装包：`dsh-cliworker-now-0.8.2.tgz`，845 文件，18071954 字节，SHA-256 `7d0c8ca847f19b76d8e1f4e27c3c1602ebe150fc8a9cd9cef130147e99ea1793`；扫描无私人路径、账号或运行日志。独立 `DSH_HOME`/`HOME` profile 用该 tgz 安装（exit 0），回环地址启动 Web 后插件列为已启用，CLI Worker Now 侧栏正常加载，无控制台错误；之后已停止。
- Windows（x64，Node 24，固定 pnpm 11.25.0）：远程脚本的冻结依赖安装、类型检查、7 个 Windows CI 文件和安装包 Host 加载全部通过。另在同一源码目录跑全量：使用隔离 HOME/TEMP 环境时 **4203 通过、8 失败、43 跳过**；失败集中在 6 个 Host 读取器/PTY 测试文件（Grok、Kimi、Qoder 持久记录读取与 OMP 账号 PTY），本版没有改动这些代码。同一 6 文件改用正常用户环境串行重跑 **179/179 通过**，判断为隔离环境（或并发时序）造成，原因未进一步定位。
- 未执行：v0.8.2 的 Windows Desktop 实机安装与界面检查；本版没有新的真实模型调用（改动只涉及界面，桥接功能已在 v0.8.1 开发期完成低成本真实验收）；支持规划的 CLI 未在 Desktop 复查规划按钮。
- 发布：`main` 与注释 Tag `v0.8.2`（提交 `f1f5863`）已推送。该提交的 GitHub Windows CI 在“Build isolated plugin”失败：Windows 检出默认 `core.autocrlf=true`，把 LF 的 runtime-host 文件转成 CRLF，触发 `runtime-content-mismatch`（v0.8.1 起的提交均带 `[skip ci]`，此前未暴露）。后续提交 `1c36a2f` 新增 `.gitattributes`，令 `runtime-host/**`、`host-extensions/**` 不做换行转换，[CI](https://github.com/SuperWheel/dsh-cliworker-now/actions/runs/39456295405) 通过。安装包不受影响；Tag 保留原位，未强制改写。
- [GitHub Release v0.8.2](https://github.com/SuperWheel/dsh-cliworker-now/releases/tag/v0.8.2) 已公开，含 tgz、SHA256SUMS.txt 和脱敏 package-verification.json；远端下载后 `shasum -c` 两项均 OK。
- npm：用户本人登录并完成发布二次验证，同一 tgz 发布返回 `+ dsh-cliworker-now@0.8.2`。随即只读回查时 registry 仍返回 404、`latest` 仍为 0.8.1（发布扫描中）；按用户要求不再继续等待，公开可安装状态未确认。


## v0.8.3（未发布）：完整 rc.3 re-vendor 与官方客户端恢复（2026-10-24）

- 包版本保持 **0.8.2**，没有 commit/push/publish。OpenSpec：`upgrade-host-rc3`。39 个 SDK rc.3 版本经 registry 实查存在，根锁文件由 pnpm 重生；四包采用官方 Git tag `dsh-v0.2.1-rc.3`，HEAD `1f81c047fc48fa190a683e469daa699857e9afe8`。
- pnpm 安装自动记录 release-age 例外：根 workspace 新增 300 个 DSH 包的精确 `0.2.1-rc.3`；扩展独立 workspace 为 296 个 DSH 包加入精确 rc.3，并保留继承的 rc.1/rc.2 与 7 个 Cordis 等基础包的固定版本例外（共 303 行）。保留以便复现本次依赖图，没有关闭全局保护或放开通配版本。
- 官方 app 的 `be72761` 构建标记经 GitHub commit API 查询无对应公开对象，未冒充 tag commit。48 文件补丁从真实 checkout 导出，保留 rc.3 header hooks、views.actions/view-pins、whenDraftExists、提交快照与原有 commandSource/childImageUploads。旧 rc.2 扩展目录未改。
- 运行命令统一使用 `PATH=/opt/homebrew/lib/node_modules/corepack/shims:$PATH pnpm --config.verifyDepsBeforeRun=false …`。依赖以 `install --ignore-scripts --no-frozen-lockfile` 更新，扩展独立 store；显式冻结 React 18.3.1 及 Zustand/use-sync-external-store，消除初次源码测试的重复 React。四包源码类型检查通过；builder 构建/verify **4 包 221 文件**，vendor 摘要 **204 文件**，插件 Host/Client `typecheck` 通过。
- 关联 `tests/build-dependencies.test.ts tests/host-runtime-package.test.ts tests/market-install-peers.test.ts`：**3 文件 24 项通过**。新增 rc.3 精确图选择场景，未知未来版本拒绝保留。source 测试的 7 个旧统计文案断言按已有简洁设计更新，另 1 项负载超时复验；三文件独立复验 **37/37**。首次与后续全量结果及最终复验见下方收尾记录，未将失败轮次计为通过。
- 隔离实际 Host 使用交接 scratch 中 rc.3 官方 app asar 与 rc.2 DSH Desktop asar（仅 scratch 副本）。四个新 DSH_HOME 的 rc.2/rc.3 启用/禁用均通过；启用预检 ready、五个客户端（含插件），禁用四个官方客户端，四 UI 身份始终各一次。ConfigEditor/SettingsForms 真实 update/reset/replace、旧 revision 拒绝与 canonical stock 行落盘通过；未写正式设置。两版本浏览器已实际打开 CLI Worker 空面板，禁用页均正常启动、插件计数 0。
- 隔离证据：交接 scratch 下 `rc3-upgrade/isolated-results.json`、各 home 的 `ownership-result.json`、`rc2-cliworker-panel.png`、`rc3-cliworker-panel.png`。本轮构建与测试原始日志在 `.cache/rc3-*`，不纳入 Git。未调用真实模型或派遣任务；未验证 Windows/Linux、真实 CLI 续聊或工具执行。


### 收尾结果

- 四包完整源码回归最终以 `--maxWorkers=2` 干净通过：**112 文件、1894/1894**；`check-client-types.mjs` 四包全通过。首次 React 环境失败和旧文案断言失败日志均保留，最终未跳过上述测试。
- 插件 `pnpm test --maxWorkers=2` 最终 **214 文件通过、3 文件跳过；4285 通过、13 跳过、0 失败**。此前首次全量发现两处 rc.2 pin 旧断言，已更新并增加 rc.3 选图用例；后续高并发全量在 Hermes/ZCode 模拟进程出现 4 项失败，两个相关文件单独 **90/90** 复验通过，最终低并发全量也通过。三组计数不相加。
- `pnpm build:preview`、`pnpm build` 成功；最终 preview/runtime-host manifest 与 source.patch 相同。生产构建前确认官方 profile 不含插件 bundle，配置块注释，CLI Worker 未加载。独立行补丁 `cordis.patch.yml` 和 `scripts/host-extension-guard.mjs` 与本次起点 HEAD 完全相同。
- 隔离页面在最后一次 preview 原地重建期间出现 HMR `SlotAssemblyError`；没有将该热更新计为通过。按既有冷启动要求重启 rc.2/rc.3 后，两页均重新呈现原生页面和 CLI Worker，四包各 1、插件 1、无槽位错误，并读取先前保存的 verbose/steer。禁用场景仍各 4 个官方模块、插件 0。支持冷启动更新，不新增热更新承诺。
- 官方 `/Applications/DeepSeek Harness.app` 版本核验为 **0.2.1-rc.3**。正常 quit 后，仅在 `~/.dsh/profiles/desktop/package.json` 的 bundles 中将插件加到 dshmarket 后，恢复 `cordis.patch.yml` 的原五行 CLI Worker 配置；visible-dynamic-workflows 保持注释。没有编辑官方应用、DSH Desktop、凭据文件、既有会话或 Worker 数据。
- 两份逐字节校验备份：`~/.dsh/profiles/desktop/package.json.bak-rc3-cliworker-20261024-153635`、`~/.dsh/profiles/desktop/cordis.patch.yml.bak-rc3-cliworker-20261024-153635`。配置变化仅上述恢复及对应说明注释，没有回退。
- `open -a "DeepSeek Harness"` 后原窗口恢复，CUA 实际点击“打开 CLI Worker”，确认右侧 `CLI Worker Now` 标题、筛选栏及空列表。System Events 窗口标题与截图留于 scratch `rc3-upgrade/official-cliworker.png`；`official-result.json` 与日志前后 inventory 记录 `~/Library/Logs/DeepSeek Harness` **无新增、无修改日志文件**。未触发任务、模型、登录、账号探测或设置修改。
- 严格规格检查归档前 **25/25**、归档后 **24/24**，`git diff --check` 通过。7/7 任务核对后，同步 package-distribution 的 1 项新增需求并归档至 `openspec/archives/upgrade-host-rc3/`；其余活动变更和旧待办未变。真实模型、Windows/Linux 与公开分发仍未验证，本次未提交或发布。


## 2026-10-24：dshmarket 热切换白屏隔离调查（版本仍为 0.8.2）

- 起点 `codex/release-v081` / `a9d4017`，干净工作树。按用户要求由 gpt-6-astra/high 独立审查生命周期；所有运行实验位于本会话 `scratchpad/blank-toggle/`，只有 preview 和副本，真实 DSH Desktop/官方 app 及其数据未操作；没有正式 build、commit/push、模型调用或任务派遣。
- 实际经过 dshmarket 1.70.1 `POST /dsh-market/toggle`、登录 cookie 和变更锁；无头 Chromium 保存截图、浏览器异常、Loader/graph/设置状态。rc.2 Desktop 解包（默认 HMR 与 ConfigWatchHmr）和 rc.3 原生 Host 均复现停用白屏，错误为 `SlotAssemblyError: scope 'session-maybe' rendered without an installed adapter`。stock 恢复后页面仍白，rc.2 停用后冷启动正常。
- scratch guard dispose 恢复 stock 的实际候选在 rc.2/rc.3 都失败，未合入。rc.3 刷新恢复聊天后再启用，HTTP 502 但 bundle 已重新加入，六个 vendor disabled 行继续存在，最终 stock/vendor 全关。rc.2 Desktop 的市场停用列表过滤使该方向保持 stock，未独立复现健康页面启用后的新白屏。
- scratch 上游方向原型跳过 live mutation、仅记录下次启动状态；rc.2 两轮 off/on 保持页面和 graph。仅是方向性证据；跨宿主、后续配置刷新、既有 overrides 和分组切换未解决，不是可发布补丁。详细证据索引、失败启动记录、源码行号和后续真实 Desktop 验证清单见 [调查报告](blank-toggle-investigation.md)。
- 实际命令均使用 `PATH=/opt/homebrew/lib/node_modules/corepack/shims:$PATH pnpm --config.verifyDepsBeforeRun=false …`：`build:preview` 通过；`typecheck` 通过；`test tests/host-runtime-package.test.ts tests/client-registration.test.ts tests/build-dependencies.test.ts` 为 **3 文件、30 项通过**，TMPDIR 指向上述 scratch。原生 SettingsForms 的设置写入、revision/reset/释放沿用真实 Loader 关联测试；未做浏览器设置编辑和真实账号验收。
- 只更新 README 中英文、设计与调查/验证文档，澄清连续热切换未通过；没有运行行为变更、新行为测试、全量 suite 或 OpenSpec 归档。失败候选保留在 scratch 供主会话审阅，不更新真实 Desktop。


## 2026-10-24 v0.8.3：发布验收

- 范围（用户批准以 v0.8.3 发布到 GitHub 与 npm）：市场安装移除 `dsh-client-store` peer、DSH Desktop 下 stock UI 行不再归插件所有、Harness 0.2.1-rc.3 原生会话界面 re-vendor，以及 dshmarket 热切换白屏的已知限制说明（上游 dsh-market/dsh-market#1010）。版本号与 Codex/ACP/MCP/Hermes 客户端标识改为 0.8.3（提交 `9efb086`）。OpenSpec `fix-market-install-peer-scope` 已核对并归档为 `2026-10-24-fix-market-install-peer-scope`，严格校验 23/23。
- macOS：`typecheck` 通过；全量 `vitest run`（沙箱外）**214 文件通过、3 跳过；4285 通过、0 失败、13 跳过**；`spec:check` 归档前 24/24；`git diff --check` 通过。Codex 子代理在沙箱内的首轮因 `listen EPERM 127.0.0.1` 与 `/bin/ps EPERM` 有 10 文件失败，不计入结果。
- Windows（x64，Node v24.15.0，pnpm 11.25.0）：`test:windows:remote` 隔离 preview、冻结依赖、typecheck、7 个 Windows CI 文件 **111 通过、1 项 POSIX 跳过**、包检查与 Host 加载均通过，success/cleanup.confirmed/cleanup.lockReleased 为 true。同一源码目录全量 vitest（隔离 HOME/USERPROFILE/TEMP）**210 文件通过、6 失败、1 跳过；4243 通过、11 失败、44 跳过**；失败集中在 Grok/Kimi/Qoder 读取器与 native-zcode 模拟账号 header（共 6 文件），本版未改这些代码；同 6 文件在正常用户环境串行重跑 **123/123 通过**。根因未定位，与 v0.8.2 同类（失败文件集合不同，本次 OMP PTY 未失败、native-zcode 新出现）。远端临时目录已清理，用户运行中的 Harness 进程未受影响。
- 构建：正式 `build` 与 Windows 远程脚本构建的隔离 preview 相比，`lib/index.js` 与全部原生 helper 逐字节相同，`lib/client.js` 仅打包 region 注释不同；该 Client 与 a9d4017 时在 DSH Desktop 实装验收的 rc.3 构建（忽略注释）一致，runtime-host 与 `cordis.patch.yml` 逐字节相同。构建前确认 Mac 官方 Harness 无运行中的 CLI 子进程。
- 未执行：v0.8.3 的 Windows Desktop 实机安装与界面；真实模型调用与任务派遣；DSH Desktop 窄窗口/深色/Windows 版；官方 rc.3 的 pin 选项。
- 安装包：`scripts/package-release.mjs` 生成公开清单（`private:false`、无 scripts/devDependencies/packageManager、无 store peer），系统 npm `--ignore-scripts` 打包为 `dsh-cliworker-now-0.8.3.tgz`，846 文件，18104242 字节，SHA-256 `074ed63ebc11caa7573561670233cbd3a1cff7ad088bb9ee827a37af454ec176`；扫描无私人路径或局域网地址。独立 HOME/DSH_HOME 用官方 0.2.1-rc.3 的 `dsh plugin --profile web add` 安装前一版 tgz（仅 README 已知限制措辞不同，其余文件逐字节相同）exit 0、版本 0.8.3；回环 Web 中插件启用、6 个组件 Running，CLI Worker NOW 面板正常，pageerror/console error 均为 0，进程与端口已清理。安装器有 peer 警告，不阻止加载。
- 发布：`main` 与注释 Tag `v0.8.3`（提交 `7e3e9d4`）已推送，[GitHub CI 40080947668](https://github.com/SuperWheel/dsh-cliworker-now/actions/runs/40080947668)（Windows native runtime）成功。[GitHub Release v0.8.3](https://github.com/SuperWheel/dsh-cliworker-now/releases/tag/v0.8.3) 含 tgz、SHA256SUMS.txt 与脱敏 package-verification.json，远端下载后 `shasum -c` 两项 OK。
- npm：用户本人 `npm login` 并完成网页二次验证后，同一 tgz 发布返回 `+ dsh-cliworker-now@0.8.3`（npm shasum `8b9b815d9a592f994700dfa079263fcdb5aa908d`）。发布后立即回查 registry 仍返回 404、`latest` 仍为 0.8.2（npm 提示包处理中），公开可安装状态待后续回查确认。


## 2026-10-25 通用设置页与总并发上限（分支 `feat/general-settings`，未发布）

- 范围：设置导航「智能体设置」上方新增「CLI Worker 设置」页；Host `general-settings.json`（0600）保存所有 CLI 共用的「最高同时对话数」（1–8，缺省沿用部署配置），保存后立即重新调度排队任务。OpenSpec `add-general-settings-page`。界面语言与同目录写任务隔离副本并行在后续分支实现。
- 实际执行：`vitest run tests/general-settings.test.ts tests/cli-settings.test.ts tests/settings-dialog.test.tsx tests/storage.test.ts` **4 文件 335 项通过**（含新增导航测试）；`node scripts/build-preview.mjs` 通过（Host/Client 类型检查与隔离构建）；`openspec validate add-general-settings-page --strict` 通过。
- 说明：根目录 `typecheck` 读取的是 Desktop 链接的 `lib/` 生成类型，未正式构建前会报新增 Remote 不存在；本次未运行正式 `build`，未更新 Desktop。
- 未执行：Desktop 实机界面（明暗主题、窄屏）；真实 CLI 多任务并发；全量 suite。


## 2026-10-25 界面中英双语与语言切换（分支 `claude/i18n-english-482e08`，未发布）

- 范围：「CLI Worker 设置」新增「语言」分区（跟随 DSH / 中文 / English，默认跟随），与并发上限同存 `general-settings.json`；Host 快照附带非默认语言，所有已打开面板实时同步。Client 接入 Harness locale（`cliworker` 命名空间，生命周期内注册/订阅、卸载注销），抽取 `src/client` 用户可见中文并提供完整英文（词典 627 条，其中约 90 条为 Host 原文映射）。OpenSpec `add-client-i18n`。版本号未改。
- 基线（改动前，本工作树）：全量 `vitest run` **10 失败 / 4283 通过 / 13 跳过**；失败为 `tests/build-dependencies.test.ts` 2 项（缺少正式构建生成的 `lib/types/host/index.js`）与 `tests/native-zcode.test.ts` 8 项（模拟账号 header；改动后同文件通过，判定为不稳定）。
- 实际执行：
  - 全量 `node node_modules/vitest/vitest.mjs run`：**215 文件通过、1 失败、3 跳过；4312 通过、2 失败、13 跳过**。仅上述 build-dependencies 2 项失败，与基线相同；既有中文断言测试在默认语言下通过。
  - 收尾修改后复跑 `tests/client-i18n.test.tsx tests/general-settings.test.ts tests/settings-dialog.test.tsx tests/panel.test.tsx tests/client-conversation-features.test.tsx`：**5 文件 362 项通过**。
  - `node scripts/build-preview.mjs`：通过（Host/Client 类型检查与隔离构建）。
  - `openspec validate add-client-i18n --strict --no-interactive`：通过。`git diff --check`：通过。
- 新增测试：语言持久化（0600、重载、`null` 恢复默认）与非法补丁；Runtime 快照字段；词典完整性（英文非空、占位符一致、英文不含中文）；跟随/显式/非法偏好；模拟 locale 服务下随 Harness 语言实时切换与卸载注销；Host 文案映射与未知原文保留；设置窗口保存 English 后整体切换；面板随快照语言切换。locale 服务与 Cordis 上下文均为测试内模拟。
- 未执行：DSH Desktop 实机英文界面（窄栏换行、明暗主题、Windows）；真实 Harness 语言切换下的 `ctx.locale` 行为；正式 `build`（未更新 Desktop）；真实模型调用。
- 已知限制（保持中文）：未收录的 Host/CLI 错误、Host 生成的标题与摘要、内置角色预设名称与内容、默认名称 `智能体-xxx`、发给 CLI 的附件说明；给主 Agent 的工具描述与提示词不在范围内。并行会话（同目录写任务隔离副本并行）的新增文案在合并时补入词典。

## 2026-10-25 同目录写任务隔离副本并行（分支 `claude/isolated-parallel-writes-459fae`，未发布）

- 范围：「CLI Worker 设置 → 任务调度」新增「同目录写任务并行」开关（缺省关闭）。开启后，仅在同目录写冲突时为新写任务在插件私有目录创建 APFS 克隆副本，任务结束后由任务卡或 `cliworker_merge` / `cliworker_discard` 三方合并或丢弃；合并有冲突时项目零写入、副本保留，结果为未提交改动。OpenSpec `add-isolated-parallel-writes`；无新增依赖（diff3 自实现）。
- 实际执行：`vitest run` 隔离相关 8 文件（diff3、isolated-workspace、isolated-runtime、isolation-ui、general-settings、settings-dialog、storage、cli-settings）**373 项通过**；`tests/isolated-runtime.test.ts` 修复复制完成后才收到停止的挂起后连续运行 10 次均 10/10 通过；`node scripts/build-preview.mjs` 通过；`openspec validate add-isolated-parallel-writes --strict` 通过；`git diff --check` 通过。
- 全量 suite：4329 通过、13 跳过、2 失败；失败均为 `tests/build-dependencies.test.ts` 读取正式构建产物 `lib/typert.remote-client.js`，本工作树未运行正式 `build` 故不存在，与本变更无关。
- 未执行：真实 CLI 与模型、DSH Desktop 实机界面、Windows 实机（路径分隔符仅单元测试）、Linux reflink；未运行正式 `build`，未更新 Desktop。

## 2026-10-25 合并 i18n 与隔离副本并行到 `feat/general-settings`（未发布）

- 合并：`claude/i18n-english-482e08`（9f9e87a、fb178f8、641b45b）无冲突合入；`claude/isolated-parallel-writes-459fae`（07cfe97、5d20d71）在 10 个文件冲突，均为两边并列新增：`GeneralSettings` 同时含 `language` 与 `isolatedParallelWrites`，存储补丁两字段共用一个合并逻辑；通用设置页以 i18n 版本为底，按其逐字段保存反馈加入并行开关；旧 Host 缺少 `isolatedParallelWrites` 时按关闭读取。
- 文案：隔离副本的设置开关、任务卡状态与按钮、合并/丢弃弹窗改用 `t()`；Host 的副本状态、排队原因、冲突原因、过程行与错误经 `hostText()` 映射。`hostPatterns` 改为支持多参数，`reason` 捕获再次映射（如「项目文件数超过隔离副本上限（N 个）；已改为排队…」整体译出）；路径与系统错误细节保持原文。冲突列表连接符改为语言无关的 ` — `（词典规则要求键含中文）。给 CLI 的副本提示、主 Agent 工具描述与丢弃确认询问仍为中文。
- 实际执行：`vitest run tests/isolation-ui.test.tsx tests/client-i18n.test.tsx tests/general-settings.test.ts tests/settings-dialog.test.tsx` **4 文件 225 项通过**（新增英文下的任务卡/弹窗与 Host 副本文案映射测试）；`node scripts/build-preview.mjs` 通过；全量 `vitest run` 第一次 **4350 通过、4 失败、13 跳过**，失败均为 `tests/native-zcode.test.ts` 的模拟账号 header 用例（单独运行 3 次均 24/24 通过，与 i18n 分支基线记录的同类不稳定一致），第二次全量 **220 文件、4354 通过、13 跳过、0 失败**；`openspec validate --all --strict` **26/26**；`git diff --check` 通过。
- 未执行：正式 `build` 与 Desktop 更新；DSH Desktop 实机（中英界面、并行开关、任务卡合并/丢弃、明暗主题、窄屏、Windows）；真实 CLI 与模型的副本运行与合并。

## 2026-10-25 Desktop 实机验收：通用设置、英文界面与隔离副本（`feat/general-settings` 8cf3154，未发布）

- 准备：CLI Worker 无运行或排队的 Worker（54 完成、9 失败、3 中断），后续消息只有已暂停项，Host 进程无 CLI 子进程。先在 Desktop 运行中正式 `build`（11:12），插件 Host 未热重载（锁 token 不变），新 Remote 需要重启；Desktop 退出时提示「当前正在运行的任务将会中断」，经用户确认后退出（锁随即释放）并重新打开，Host 以新构建启动（新锁），日志无新错误。`profiles/desktop/node_modules/dsh-cliworker-now` 链接本仓库。
- GUI（Codex gpt-6-astra high，Computer Use）：
  - 通过：导航「CLI Worker 设置」位于「智能体设置」正上方；页面含「语言」「任务调度」，初始为跟随 DSH、`2（默认）`、并行关闭，说明文字与设计一致。切换 English 后设置窗口立即整体变为英文（导航、标题、并行说明、ZCode/Codex 页），保存反馈正确；并行开关开启/关闭反馈正确；最后恢复为跟随 DSH（回到中文）与并行关闭。
  - 通过：同项目两个 ZCode 写任务（GLM-5.3-Flash · Low），`zcode-append-b` 显示「Running in an isolated copy」→「Isolated copy ready to merge」与 Merge/Discard；Merge 弹窗文案正确，结果「Wrote back 1 and deleted 0 files…」，列出 b.txt，副本目录已清理。Discard 弹窗文案正确，确认后状态行与按钮消失（无单独成功提示）。
  - 英文模式仍为中文：已有智能体预设名称与描述（已知限制）；插件设置问题卡标题与选项「ZCode 模型」「选择模型」（Host 生成，待补）；「输入你的答案」「跳过」「提交」及子会话内「处理失败」「已调用工具」「代码块」「允许编辑」为 Harness 原生控件，随 Harness 语言（中文）。未逐页检查全部 CLI 页；未打开并发下拉核对 1–8。
- 落盘核对（本会话直接检查）：a.txt `alpha/one`、b.txt `beta/two`（合并写回）、c.txt `gamma/three`、d.txt `delta/four`。Worker 状态：a 完成（主目录）、b 完成且隔离 `released`、c `failed`（主目录，`ZCode 额外权限请求已拒绝`：Bash `echo >>` 被拒后改用 Edit 成功，运行仍判失败；该判定为 v0.8.1 起的既有 ZCode 行为）、d 完成且第二个副本 `ready` 残留。
- **发现缺陷：隔离可被绕过。** d 的副本丢弃后，主 Agent 把「改动在隔离副本中」理解为失败，经 `cliworker_followup` 要求「必须在真实目录、不要在隔离副本中操作」；该轮 cwd 仍为新副本，但 ZCode Edit 直接写入 测试目录外层的 `cliworker-isolation-test/d.txt` 并成功，副本内 d.txt 仍为 `delta`。隔离只靠给 CLI 的提示词，ZCode 原生权限允许写 cwd 外的绝对路径；并行时主目录可能被同时改写。主 Agent 收到的结果也未说明「改动待用户合并」。
- 未解决：首次派遣的 ZCode 设置问题卡在 26 秒内被回答（GLM-5.3-Flash · Low），Codex 称未提交，会话记录未见主 Agent 代答，来源未查明。测试目录、测试会话与 d 的残留副本保留待处理。

## 2026-10-25 主 Agent 合并隔离副本、设置说明精简与滚动条自动隐藏（`feat/general-settings`，未发布）

- 用户调整：任务卡不显示隔离副本状态与「合并」「丢弃」；合并只由主 Agent 调用 `cliworker_merge`，不确定的冲突用原生询问交给用户。移除 `IsolationDialog`、Remote `mergeIsolation`/`discardIsolation` 及相关字典条目。
- 完成通知 `guidance` 与 `cliworker_status` 对待合并副本说明路径、主目录未改动、核查后调用 `cliworker_merge`、不要让 CLI 在原目录重做（针对实测的绕过问题，仅提示，未做强制隔离）。
- `mergeIsolatedWorkspace` 支持逐文件 `resolutions`；结构性冲突只能保留项目版本。`cliworker_merge` 冲突 ≤6 个逐个询问，更多一次性询问；暂不合并、未作答或自由文本均不写入、保留副本。
- 设置「同目录写任务并行」说明缩为一行，开关保存成功不再显示确认文字；设置窗口左右两侧滚动条只在滚动时（及指针在滑块上时）显示，900ms 后隐藏。
- 验证：相关回归 + 新增 `tests/isolated-merge-decisions.test.ts`、`tests/settings-scrollbar.test.tsx`；`build:preview` 隔离类型检查与构建通过；全量 `vitest run` 222 文件通过、3 跳过（4366 通过、13 跳过）；OpenSpec 严格校验 26/26。
- 未执行：真实主 Agent 合并与冲突询问（需真实模型调用）；暗色主题与窄屏；Windows/Linux。

## 2026-10-25 主 Agent 整合实测与额外授权拒绝后标为待核实（`feat/general-settings`，未发布）

- 整合方案实测（Desktop 重启后新 Host 12:49；Codex gpt-6-astra high 驱动界面；ZCode 沿用 GLM-5.3-Flash·Low，用户授权真实调用）：两个 ZCode 任务各在 merge.txt 末尾加一行，A 在主目录、B 在隔离副本。主 Agent 调用 `cliworker_merge` 两次：首次返回 `needs_integration`（原因“两边改动了相同或相邻的行”，choices project/copy/content），第二次 `use=content` 写入整合内容，返回 merged。落盘核对（本会话直接读文件）：merge.txt 为原 5 行 + `A done` + `B done`；副本状态 `released`。界面未出现“冲突”字样和问题卡，任务卡无副本状态与合并按钮。
- 同次实测两张任务卡均为「失败」：ZCode 尝试 shell 追加被插件拒绝（`ZCode 额外权限请求已拒绝`）后改用编辑完成。原始帧：requestPermission(toolCallId) → permission.resolved(deny) → batch errorCount 1。按用户决定改为结果待核实（OpenSpec `report-denied-permission-as-unverified`）。Codex/Hermes/HTTP 两个 runner 由 Codex gpt-6.1-sol 子代理并行实施，主会话审阅并补充 Codex 被拒条目豁免。
- 验证：runner 相关 5 个测试文件 243 通过；`build:preview` 类型检查与构建通过；全量 222 文件通过、3 跳过（4384 通过、13 跳过）；OpenSpec 严格校验 27/27。
- 未执行：拒绝后标为待核实的真实 CLI 复验（需重启 Desktop）；Hermes/HTTP 系审批不带工具身份，有拒绝时其他工具失败也只到待核实。

## 2026-10-25 拒绝授权后结果待核实的真实复验（`feat/general-settings` 32752a8，未发布）

- 第二次复验（13:09，fa45247）任务被停止：“CLI 新响应先于当前响应的完成边界”。原始帧：ZCode 对只读 Read 先发 scheduled/started，再发该消息 model_complete；被动工具行落在未完成响应之后。修复：`ZcodeResponseTracker.tool()` 在响应未完成时暂存工具事件，完成后按序放出（原生 runner 与旧适配器共用）；新增夹具 `tool-before-complete`，撤掉修复时该测试失败。
- 验证：conversation/native/harness/zcode 相关 77 个测试文件（1259 通过、4 跳过）；`build:preview` 与正式构建通过。
- 第三次真实复验（确认无活动任务后重启 Desktop，新 Host 13:19；Codex gpt-6-astra high 驱动界面；ZCode 沿用 GLM-5.3-Flash·Low，用户授权）：任务卡「结果待核实」；本会话读取 Worker 记录为 `uncertain`、结果帧 UNCERTAIN，Bash 步骤失败，Read/Edit 均在响应完成之后；deny.txt 实际为 alpha、beta、gamma。主 Agent 独立读文件后汇报一致。
- 遗留：任务详情同时显示「处理失败 / 本轮运行失败 / CLI_RUN_FAILED」，与待核实措辞不一致；其他 CLI 的真实拒绝场景未复验。
- 用户要求待核实轮次不显示「处理失败 / CLI_RUN_FAILED」（b5f50f2）：Harness 只有 stop/tool-calls/max-tokens/aborted/error 五种结束原因，error 固定渲染为处理失败；改为 uncertain 与 completed 同样以 stop 收尾，说明由插件已有警示提示显示。新增流测试（撤掉修改时失败）；相关 80 个测试文件 1341 通过、4 跳过；`build:preview`、正式构建、OpenSpec 严格校验 27/27 通过。
- Desktop 复验（新 Host 15:05，ZCode 沿用 GLM-5.3-Flash·Low）：任务卡「结果待核实」，详情只有待核实警示，未见处理失败、本轮运行失败或 CLI_RUN_FAILED；Worker `uncertain`，deny.txt 实际为 alpha、beta、gamma。主 Agent 独立读文件后报告为“已完成”，并注明后台状态为待核实。

## 2026-10-25 Hermes 账号终端空白与无法续期（`claude/fix-hermes-account-8d26ac`，未发布）

- 现象：Hermes 登录设置的账号终端空白，提示「无法启动账号终端，请检查 CLI 安装」；此前账号显示过期，点登录后提示无法续期。其他 CLI 正常。
- 根因（本机只读核查，未打印凭据）：Hermes Agent v0.21.7 安装正常（入口校验、`hermesNativeCommand` 均通过）。插件账号目录 `~/.dsh/cliworker-now/accounts/hermes/auth.json` 的凭据池多了 `copilot` 记录（`source: gh_cli`、`api_key`，只有指纹无令牌），14:59 由原生 Hermes 进程写入（agent.log 同刻记录）。原生 `_seed_copilot_singleton` 在 `gh` 已登录时写入该记录，不受 `adopt_external_logins: false` 约束，未选择 Copilot 时不路由模型。插件 `assertHermesOwnAccounts` 把它当外部账号拒绝：账号终端准备阶段的普通 Error 被统一改写成「检查 CLI 安装」；状态查询的续期快照同样被拒，被改写成「Hermes 登录暂时无法续期，请稍后刷新」。在该目录用复现脚本调用 `prepareHermesAccount` 得到「Hermes 含外部账号来源，请使用自身登录」。
- 续期链路干跑：用真实插件账号目录运行 `hermes-nous-refresh.py` 的 `_run`，原生刷新函数替换为桩：配置、主体摘要、凭据池与 shared 镜像一致性、原生锁及 API 签名全部通过，到达刷新调用；`auth.json` 修改时间不变。另以错误摘要调用 `--cliworker-nous-refresh` 返回 `changed`、退出码 0。说明除插件守卫外续期无其他阻断。
- 修复：放行未被选择的环境 Copilot 记录（`auth.active_provider` 或 `config.yaml` 任意位置为 `copilot` 即视为已选择，仍拒绝）；守卫拒绝改为 `HermesAccountSourceError`，账号终端、状态、续期、绑定显示真实原因；Client 启动白名单与英文词典补充固定文案。OpenSpec `fix-hermes-ambient-copilot-source`。
- 实际执行：`tests/hermes-renewal.test.ts` 新增 5 项（撤掉守卫修复时 5 项全部失败）；Hermes/账号/绑定/i18n 相关 31 个测试文件 **628 通过、1 跳过**；`node scripts/build-preview.mjs` 通过；`build.mjs --typecheck-only` 的 Host 部分通过，Client 部分在本工作树报 9 个错误，均因自引用 `dsh-cliworker-now/remote` 声明需正式构建生成（报错文件均未改动），未在正式构建后复核；OpenSpec 严格校验 28/28。
- 未执行：正式构建与 DSH Desktop 实机（账号终端出现原生菜单）；真实 Nous 续期（会消耗一次性刷新令牌，需用户在 Desktop 操作；若服务端拒绝，应显示需重新登录并能打开登录终端）。插件账号目录中的 `copilot` 记录保留未动。

## 2026-10-25 Hermes 续期与 Nous 校验：DSH 子进程 NO_PROXY 带 `[::1]`（`feat/general-settings` e923fee，未发布）

- 合并环境 Copilot 修复（0368236）后实机：账号终端显示原生菜单（修复生效），但状态仍为「Hermes 登录暂时无法续期」；用户在终端选 Nous Portal 报 `Could not verify credentials: Invalid port: ':1]'`。
- 根因：抓取账号终端进程环境，`NO_PROXY`/`no_proxy` 为 `localhost,127.0.0.1,::1,.local,[::1]`（Desktop 主进程只有 `::1`，`[::1]` 由 DSH 发布给子进程的代理环境追加）。Hermes 自带 httpx 0.28.1 遇 `[::1]` 抛 `InvalidURL: Invalid port: ':1]'`，裸 `::1` 正常；插件续期子进程同样继承，异常被归为 unavailable。插件 Nous 账号访问令牌 2026-10-20 过期、刷新令牌仍在；主会话在干净环境运行同一续期操作返回 ready（真实刷新成功并保存，用户已授权验证）。
- 修复：`hermesAccountEnvironment` 合入 `hermesNoProxyEnvironment`，把带括号/端口/CIDR 的 IPv6 旁路改为裸地址并去重（与 Hermes 自身规则一致），覆盖账号终端、续期与任务运行。OpenSpec `fix-hermes-bracketed-ipv6-no-proxy`。
- 验证：`tests/hermes-no-proxy.test.ts` 4 项；Hermes/账号/绑定相关 44 个测试文件（957 通过、1 跳过）；`build:preview`、正式构建、OpenSpec 严格校验 29/29。Desktop 重启（新 Host 15:38）：终端进程 NO_PROXY 不再含 `[::1]`；状态「Nous账号登录」；选择 Nous Portal 后出现模型列表，无 Invalid port；未选模型，config.yaml 未变。
- 未执行：修复后插件自身触发的过期续期（需令牌再次过期）；设置页 Hermes 模型下拉曾持续显示「正在读取 Hermes Agent 模型…」，用户自行检查后确认没有问题。


## 2026-10-25 设置页去掉“已保存”提示；同对话并行派遣受选型锁拖慢（`feat/general-settings`，未发布）

- 用户要求删除设置页保存后的小字（「同时对话数已保存」「发送方式已保存」等）：通用设置、发送方式、默认设置与角色预设只在保存中或失败时显示一行反馈，已选值由控件本身显示；删除对应中英词条，`doc/settings-ui-design.md` 同步。设置相关 5 个测试文件 227 通过。
- 用户反馈「同时对话数」设为 5 后 Antigravity 仍最多 2 个并行。核查（只读本机记录）：`general-settings.json` 为 `maxConcurrent: 5`；07:50 的 5 个任务 `createdAt` 依次相隔约 7–9 秒，运行时并未拒绝第 3 个（排队时立即建立隔离副本）。瓶颈在任务创建前：同对话同 CLI 的选型锁内每次先读目录、再重读一次，`agy models` 实测约 3.7 秒，锁内约 7.4 秒；任务约 15 秒完成，故最多两两重叠。
- 修复（OpenSpec `fix-parallel-dispatch-admission`）：已有本对话设定的派遣取得顺序位置后立即让出，目录检查在锁外并行；设定失效时重新排队按原规则询问；未询问问题时不在选型内重读目录，`launch` 提交前授权不变。
- 验证：新增并行与失效设定测试（旧实现下并行测试只会进入 1 次目录检查）；派遣/设置相关 7 个测试文件 443 通过；全量 223 文件 4397 通过、13 跳过；`build:preview` 通过。
- Desktop 复验（正式构建，新 Host 16:01，用户授权；Codex gpt-6-astra high 驱动界面）：同时对话数 5→4→5，保存后无「已保存」小字，最终为 5。同一对话并行派遣 5 个 Antigravity 问好（沿用 gemini-3.8-flash · Low，无问题卡）：Worker 记录 5 个任务在 0.8 秒内创建（修复前相隔 7–9 秒），11.2–14.9 秒 5 个同时运行，界面显示「5 个后台任务运行中」，全部已完成；1 个主目录、4 个隔离副本。
- 观察（未改）：agy 回复中的自称不一致（如「我是 agy-1」「dsh_worker_…」），来自模型按示例作答，与派遣名无关。

## 2026-10-25 全部 CLI 并行核查：Grok 同项目启动竞争、OMP 独占账号改排队（`feat/general-settings`，未发布）

- 核查：任务只在运行时 `drain()` 一处按同一 `maxConcurrent` 放行，插队、续聊、隔离退回均经同一队列，没有 CLI 绕过或另设上限。
- 只读探针（不调用模型）：13 个 CLI 各 5 次并行派遣授权，OMP 4/5 失败「账号正被使用，请稍后刷新」，Kimi 登录过期未测，其余全部成功；Grok 同项目并行准备 100 次 65 次 `EEXIST`（删除后重建登录链接的竞争）；OMP 账号绑定读取不占租约。
- 修复（OpenSpec `fix-parallel-account-waits`）：Grok 派生配置与登录链接先以临时名创建再原子改名；Pi/OMP 独占账号在进程启动前遇到占用时退回原队列位置、不占名额，同账号持有者结束或每 2 秒重试，停止立即生效；派遣检查遇到占用时用同账号最近已验证目录，否则最长等 30 秒，同账号新鲜目录写入显示目录供并行复用；不提高单个 OAuth 账号的实际并行数。
- 验证：新增 Grok 并行准备、排队让出名额/释放后运行/等待中停止、派遣目录复用/他账号不用/换号失败/其他错误不吞等测试（撤掉修复时对应用例失败）；激活冲突用例按新行为改为排队后运行；全量 225 文件 4404 通过、13 跳过；`build:preview` 通过。真实只读探针：Grok 修复后 100 次 0 失败；经 Host 包装的 OMP 5 次并行派遣检查：首轮提交后一次探针 5 次中 1 次报「无法读取 Pi/OMP 原生模型目录」——两阶段目录读取之间账号被另一读取取得，忙碌错误被改写；保留该错误后连续 4 轮 20/20 成功（每轮约 5.4 秒，修复前 4/5 失败）。
- Desktop 复验（正式构建，新 Host 17:00，用户授权；Codex gpt-6-astra high 驱动界面）：同一请求并行派遣 3 个 OMP（glm-5.3-flash）与 3 个 Grok（Grok 4.6·Low），均只读。OMP：两个任务记录「账号正被另一个任务使用，排队等待」，三个依次运行（04:16–04:25、04:51–05:00、05:16–05:25）并全部完成，没有账号占用失败。Grok：3 个只读任务在同一项目目录准备，未出现 `EEXIST`，但均在原生会话建立后失败「ACP does not advertise the selected permission mode」——Grok ACP 不提供只读所需的权限模式，属既有问题，未在本次修改。主 Agent 自行改为默认权限补派 3 个，同时创建、同时运行并完成（2 个在隔离副本中）；项目文件未变化。
- 未执行：Grok 同项目并行的真实成功运行（只读模式受上述问题阻断）；Kimi 登录过期，未核查其并行；Hermes 运行阶段的安装锁冲突未实测（目录读取 5 并行通过）。

## 2026-10-25 Grok 只读任务报「ACP does not advertise the selected permission mode」（`feat/general-settings`，未发布）

- 根因：Grok 1.0.62 的 ACP `session/new` 不再返回 `modes`（只有 model、reasoning_effort 配置项，会话 kind 为 build），插件只读时要求 ACP 列出并切换 `plan`，于是在发送提示前失败。`grok --help` 的 `--permission-mode` 支持 `plan`；临时 GROK_HOME 下以 `--permission-mode plan agent --no-leader stdio` 只做 initialize/session/new（不发提示）会话正常建立。
- 修复（OpenSpec `fix-grok-native-plan-mode`）：Grok 原生启动参数按任务模式替换权限模式（只读 `plan`、可写 `acceptEdits`），与可写模式一样由原生参数设定；ACP 完全不列出模式时，仅启动参数已确定该模式的 CLI 可跳过 ACP 切换，列出模式时仍须确认 `plan`，其他 CLI 照旧失败关闭；只读中仍拒绝全部额外权限请求。
- 验证：`tests/native-acp.test.ts` 新增 2 项（无模式 ACP 下只读 Grok 成功且不切换模式——撤掉修复时失败；列出模式时仍切换、Kimi 无模式仍失败）；全量 225 文件 4407 通过、13 跳过；`build:preview` 通过。
- Desktop 复验（22:52，用户授权，新 Host 17:21）：同项目并行 2 个只读 Grok（grok-4.6·low），无 `EEXIST`、无模式报错，访问模式「规划（只读）」。问好任务 completed（「你好。」，无工具调用）；写文件任务中 Grok 在 plan 模式下仍请求 write 权限，插件拒绝，Grok 以 cancelled（PermissionRejected）结束，任务 failed；项目文件 shasum 前后一致，探针文件不存在。
- 已知行为：Grok 1.0.62 plan 模式不自行阻止写工具，只读靠插件拒绝额外权限；拒绝即取消整轮，写入被拒的只读任务显示为失败。未改动。

## 2026-10-26 只读 Grok 权限改由私有 config.toml 设定（`feat/general-settings`，未发布）

- 背景：Grok 1.0.62 官方文档称 `--permission-mode plan` 只是兼容值；`mkdir`/`touch` 在所有模式下免审批。用户决定改为 dontAsk 加 deny 规则。
- 第二版（ef10d44，全局参数 `--permission-mode dontAsk --deny …`）Desktop 复验 2026-10-25 23:33 未通过：写文件仍询问，`touch`/`mkdir` 实际建出文件与目录（已在用户同意后删除）。`grok agent stdio` 不采用 `agent` 之前的全局权限参数。
- 第三版（f7b4002，OpenSpec `fix-grok-native-plan-mode` 第 6 节）：只读运行在私有 `GROK_HOME/config.toml` 写入 `[ui] permission_mode = "dontAsk"`、`[permission] deny = ["Bash(mkdir)", "Bash(touch)"]`，工具桥就绪且绑定 Grok 时加 `allow = ["MCPTool(dsh_worker_tools__*)"]`；可写运行写回基础配置；只读启动参数不再含全局权限参数。离线：`grok inspect --json` 读回只读 2 条、带工具桥 3 条、可写 0 条规则；新参数在临时 GROK_HOME 正常建立会话。全量 4410 通过、13 跳过；类型检查、`build:preview`、OpenSpec 严格校验通过。
- Desktop 复验（2026-10-26 00:09，用户授权，新 Host 00:07:52）：并行 4 个只读 Grok。问好 completed；`touch`/`mkdir` 被 Grok 原生拒绝（`Denied by permission policy: deny rule on bash matching …`），无审批请求，任务显示 failed（工具失败）；写文件仍请求审批，插件拒绝，Grok cancelled，failed。项目目录清单与 shasum 前后一致。
- 结论与遗留：deny 规则生效，touch/mkdir 缺口已补上；`permission_mode = "dontAsk"` 未生效，其余写入仍靠插件拒绝审批。被拒的只读写入任务均显示失败。只读运行调用 DSH 工具桥未验证。
- 2026-10-26 00:20 复验（d0ecd63，去掉无效 dontAsk，只读私有配置 deny `Edit`、`Write`、`Bash(mkdir)`、`Bash(touch)`；用户授权 1 个写文件任务）：grok-17 的 `write` 未发审批请求，被 Grok 原生拒绝（`Denied by permission policy: deny rule on edit`），Grok 未取消本轮并如实说明；任务显示 failed（工具失败）。项目目录清单与 shasum 前后一致。
- 另发现路由缺陷：消息含「调用 1 次 CLI Worker 派遣工具」时，`invocationResolution` 把「1 次」当作 CLI 名，返回 unknown，主 Agent 按提示不派遣。已由 OpenSpec `fix-routing-invocation-count` 修复（见下节）。

## 2026-10-26 路由把「调用 N 次」当作 CLI 名（`feat/general-settings`，未发布）

- 修复（OpenSpec `fix-routing-invocation-count`）：`invocationResolution` 识别明确调用前去掉紧跟调用动词的次数/数量词（排除「一次性」）。
- 验证：`tests/routing.test.ts` 新增 4 个解析与 3 个无提示用例，撤掉修复时 5 个失败；离线对 Desktop 失败的原消息运行路由，修复前 unknown、修复后无提示，改写消息仍解析为 grok。全量 4417 通过、13 跳过；类型检查、OpenSpec 严格校验通过。
- 未执行（用户只要求单元测试与离线验证）：正式构建、Desktop 真实复验。名称后紧跟全角括号（「使用 Grok（Grok Build）」）仍不产生提示，未处理。

## 2026-10-26 Antigravity 1.4.x 凭据不含 `id_token`，账号绑定失败（GitHub issue #7，`feat/general-settings`，未发布）

- 现象（issue #7，Windows 11、DSH 0.2.1-rc.3、插件 0.8.2/0.8.3、`agy` 1.4.7）：CLI 自身登录与 `agy models` 正常，CLI Worker 连接 Antigravity 报「Antigravity 无法确认当前自身账号」。
- 原因：agy 1.4.x 写入 `gemini:antigravity` 的 blob 只有 `token` 与 `id_token_email`。`windows-agy-account.ps1` 只从 `id_token.sub` 计算 `principalHash`，Windows 绑定分支没有 `principalHash` 即为空 `entries` → `CliAccountBindingError`。POSIX 读 `jetski-standalone-oauth-token` 同样只认 `id_token`（访问令牌不透明）。
- 修复（OpenSpec `fix-agy-email-only-credential`）：ps1 在 `id_token` 未提供邮箱时输出经校验的 `id_token_email`；Windows 无 `principalHash` 时以已登录的安全邮箱（小写）为 `oauth` 邮箱主体；POSIX 绑定与账号标签在 `id_token` 无主体/邮箱时回退到 `accountEmail` 校验后的 `id_token_email`。`id_token` 主体仍优先。未采用 issue 中的 UI 确认方案（两种字段都是本机凭据，`id_token` 原本也只做本地解码，不验签）。
- 验证：`tests/cli-account-binding.test.ts` 新增 POSIX 与 Windows（模拟 `win32`）仅邮箱绑定用例、`tests/account-identity.test.ts` 新增标签回退用例、`tests/agy-windows-account.test.ts` 新增仅邮箱投影用例；撤掉 TS 修复时 3 个新用例失败。账号相关 6 个测试文件 133 通过；`build.mjs --typecheck-only` 通过；`build-preview.mjs` 通过，隔离包两份 `windows-agy-account.ps1` 均含回退；OpenSpec 严格校验 34 项通过。
- 兼容性：同一账号由旧格式改写为新格式后，绑定版本从 `subjectHash` 变为邮箱主体，按现有规则需重新选型，旧任务续聊需新建任务。
- 未执行：ps1 无法在 macOS 运行（无 PowerShell 与凭据管理器），Windows 实机/远程回归未做；macOS 本机 agy 1.4.7 凭据文件仍含 `id_token`，POSIX 新格式只有模拟测试；未正式构建、未更新 Desktop、未调用真实模型；issue 未回复。

## 2026-10-26 换号后旧任务自动续接（OpenSpec `continue-tasks-across-account-changes` 第 1–4 节，`feat/general-settings`，未发布）

- 实现：已有任务续聊、排队续聊、分支、子对话改选及旧记录遇到换号时，以当前账号授权原模型与强度后改绑继续，过程区记「账号已变更，已改用当前账号继续」；无账号、新账号下模型/强度不可用、同次启动 A→B→A 竞态仍拒绝；新任务选型/排队期间换号仍拒绝。运行中换号后的引导转为排队。续接方式表全部为 `try`；改绑的续接在无任何回复/思考/工具事件前失败时，以插件历史摘录在新原生会话中改接一次，原 ID 记入 `previousConversationIds`，改接失败恢复原 ID；Hermes oneshot 当前 `HERMES_HOME` 无 `state.db` 时直接改接。
- 测试：新增 `tests/cross-account-continuation.test.ts`（16）与 `tests/carryover-context.test.ts`（7），由 Codex 子 agent（gpt-6-astra high）编写，本会话复核用例内容并重新运行；更新 `runtime-account-isolation`、`followup-queue`、`cli-settings`、`worker-management` 中原「换号即拒绝」断言为新行为；`panel.test.tsx` 新增排队回执用例（撤掉 Client 修复时失败）。
- 验收：全量 227 个文件 4445 通过、13 跳过（同日首次全量曾有 `native-zcode`、`native-harness-tools` 共 6 个失败，单独运行与再次全量均通过，判断为负载下的偶发超时）；`build.mjs --typecheck-only`、`build-preview.mjs`、OpenSpec 严格校验（35 项）通过。
- 用量跟进（用户决定改接不重置用量）：改接前把原会话的会话级累计并入 `previousSessionUsage`，显示时与新会话逐项相加（缺失分项保持未知，轮次级用量不合并），上下文占用只取新会话自身数值；改接未建立新会话时恢复原累计。新增 `conversation-telemetry` 2 项（求和与显示合并）、`cross-account-continuation` 2 项（改接后 107+57=164 且重开后保持；改接失败仍为 107，不重复计入）、`worker-fork-runtime-native` 2 项（换号后分支以当前账号执行元数据操作且不写绑定；未登录时不启动）。验收：相关 9 文件 229 项通过，全量 227 文件 4451 通过、13 跳过；类型检查、`build-preview.mjs` 与 OpenSpec 严格校验通过。ZCode 无会话级检查点，改接后只显示新会话用量。
- 审查修复：Codex 子 agent（gpt-6-astra high，只读）审查 `1b83943` 提出 2 项 P1、5 项 P2，本会话逐条对照源码确认均属实并修复——AGY 先回 SUCCESS 再非零退出会被重放（成功或带正文的最终结果算已执行）；已提交引导后改接会丢失引导（改为不改接）；摘录把取消/被替代的插队消息当用户消息且可能重复本轮插队（先折叠再按送达状态过滤）；改接失败恢复原 ID 后绑定已是新账号，下一轮无法再改接（持久化 `reboundConversationId`）；改接后从改接前的消息分支会把旧截点套到新会话（记录 `carryoverRunId` 并明确拒绝）；引导转排队后重试或并发重复报错（同一请求 ID 返回同一排队项）；改接准备遇 Pi/OMP 账号占用时因沿用首个进程的启动标记而直接失败（改为逐次判断，等待中停止由 `finish` 恢复原 ID）。新增 `cross-account-continuation` 4 项、`followup-queue` 4 项、`carryover-context` 1 项；每项均在撤掉对应修复后失败、恢复后通过。验收：全量 227 文件 4460 通过、13 跳过；类型检查、`build-preview.mjs`、OpenSpec 严格校验通过。
- 未执行或未做：第 0 节真实账号跨账号续接实验（需授权）；Desktop 实测；正式构建；Codex rollout / Claude 会话文件预检；分支原生操作失败的改接（tasks 2.6）。
- 并行冲突提示：改动了 `src/host/index.ts`（`launch`、`catalogForWorker`、`configureWorker`、`steerMessage`）与 `src/client/i18n-messages.ts` 末尾，合并 `no-ask-dispatch`、`cliworker-i18n` 等分支时需留意。

## 2026-10-26 调用前询问模型开关（OpenSpec `add-dispatch-ask-toggle`，分支 `claude/no-ask-dispatch-a78e4f`，基于 `feat/general-settings`，未发布）

- 行为：「CLI Worker 设置 → 任务调度」新增全局“调用前询问模型”原生 Switch，存为通用设置 `askBeforeDispatch`（`general-settings.json`，0600，目录 0700）；缺少字段（含旧配置、旧 Host）即询问，现有行为不变，`null` 恢复默认。关闭后新主对话直接使用该项目 + CLI 的完整设定（`storage.dispatchSetup`：设置页的模型/强度 + 上次完整选型的角色与账号绑定），只针对刚读取的目录与绑定做 `valid()` 检查，再由 `launch` 以记录的绑定实时授权（与基线分支对已确认对话设定的处理一致），宿主权限、CLI 开关与项目一致性检查不变。无完整设定（只在设置页选过模型、未确认角色）或失效（模型不在目录、强度不支持、账号绑定变化）时回退完整选型，不猜测、不跨项目或 CLI 借用；主对话自身设定有效时优先，失效时先试项目设定。Qoder 双版本询问照常。保存成功不显示文字。
- “默认模型设置”的取舍：插件只有项目 + CLI 一级默认值，设置页没有默认角色控件，因此“默认设定”= 项目完整设定；缺角色时回退选型一次，之后即可免询问。开关最初按项目 + CLI 实现于各 CLI 页，合并 `feat/general-settings` 后改为通用页全局开关：任务指定位置即「CLI Worker 设置」，安全性由每个项目 + CLI 的有效设定保证。
- 自动检查（macOS，本 worktree）：相关 10 文件（dispatch-flow、general-settings、settings-dialog、cli-settings、client-i18n、isolated-runtime、running-message-settings、dispatch-storage、role-dispatch、storage）**442 项通过**。新增用例覆盖旧配置缺字段即询问、关闭后无问题卡（含 `cliworker_start` 入口）且绑定交给 `launch`、无完整设定/账号/模型/强度失效回退、宿主拒绝不保存、对话设定失效改用项目设定、不跨项目或 CLI、通用设置持久化/权限/重开/`null`/非法值、设置页旧 Host 缺字段显示开启/保存/失败恢复、i18n 键检查。全量 `vitest run`：**224 文件通过、1 失败、3 跳过；4433 通过、2 失败、13 跳过**，失败均为 `build-dependencies.test.ts` 缺少正式构建的 `lib/typert.remote-client.js`（本 worktree 未执行正式 build，环境性）。`build-preview.mjs` 通过；预览包内 `build.mjs --typecheck-only` Host/Client 通过。OpenSpec `validate --all --strict` 35/35 通过。
- 未执行：DSH Desktop 实际界面（未更新 Desktop 链接，需用户授权）、Windows 界面、真实 CLI 派遣与模型调用。OpenSpec 变更因上述验收未完成暂不归档。

## 2026-10-26 换号续接收尾：分支首轮改接与退出重登（OpenSpec `continue-tasks-across-account-changes` 2.6、4.6，`feat/general-settings`，未发布）

- 范围（用户 2026-10-26 决定）：原账号退出后无论登录其他账号还是重登原账号，任务都要能续聊；真实验收只测原账号退出后重登，换到其他账号与改接不做真实实测，第 0 节实验未执行，方式表保持全部 `'try'`。
- 2.6：Claude 延迟分支首轮（`--fork-session`）在改绑后无任何事件即失败时改接一次——清除待分支来源、新会话附带分支截点前记录；改接也失败时恢复待分支状态，下一轮仍按改绑处理；改接后继承自原任务、早于改接的轮次拒绝原生分支。其他 CLI 的分支元数据操作在本地完成，失败照常报告。
- 测试：`tests/cross-account-continuation.test.ts` 新增延迟分支 3 项（改接一次、改接失败恢复并下一轮再改接、同账号失败不改接；合成 AGY 进程模拟延迟分支，换回旧 `runtime.ts` 时前 2 项失败）与退出重登 2 项（未登录续聊失败、不启动、保留会话与绑定；重登原账号原生续接且无改绑说明，登录其他账号原生续接并有一条改绑说明）。相关 9 文件 249 项通过；全量 227 文件 4479 通过、13 跳过；类型检查、`build-preview.mjs`、OpenSpec 严格校验 36 项通过。
- 未执行：正式构建与 Desktop 退出重登实测（5.2）。

## 2026-10-26 macOS Antigravity 登录状态与绑定改读钥匙串（OpenSpec `fix-agy-macos-keychain-account`，`feat/general-settings`，未发布）

- 起因：用户在 Antigravity 账号终端 `/logout` 后，设置页仍显示已登录，`agy-11` 续聊报「CLI 模型查询失败」（未启动进程，会话与绑定保留）。本机核对：agy 1.4.7 使用 go-keyring，`/logout` 后钥匙串 `gemini`/`antigravity` 条目不存在，遗留 `~/.gemini/jetski-standalone-oauth-token` 为 10-23 写入未变，agy 日志报 `You are not logged into Antigravity`。
- 修复：新增 `src/host/agy-macos-account.ts`，以参数数组调用 `/usr/bin/security find-generic-password -s gemini -a antigravity -w`，Host 内解码 go-keyring 前缀；条目不存在（44）即未登录、不回退文件，其他失败报无法读取且不带输出。`account-identity.ts` 抽出 `agyIdentityFromCredential` 供文件与钥匙串共用；`nativeAgyAccountIdentity` 与绑定在 `darwin` 上改读钥匙串，主体计算与 `~/.gemini` 来源标识不变。Linux、Windows 不变。
- 测试：新增 `tests/agy-macos-account.test.ts`（11）；`authorized-catalog-windows-agy` macOS 用例改为合成 `/usr/bin/security` 进程（3 种编码、旧文件属另一账号时以钥匙串为准、缺条目即拒绝且不查模型），`cli-account-binding` mock 钥匙串读取。换回旧接入代码时 6 个新用例失败。全量 228 文件 4493 通过、13 跳过；类型检查、OpenSpec 严格校验 37 项、`build-preview.mjs` 通过。
- 未执行：重新登录后真实钥匙串读取（是否弹出访问提示、编码形式）与 `agy-11` 原生续接（任务 3.1、3.2）。

## 2026-10-26 账号终端关闭被僵尸辅助进程阻止（OpenSpec `fix-account-terminal-zombie-close`，`feat/general-settings`，未发布）

- 起因：用户在 Antigravity 账号终端 `/login` 成功后关闭终端，界面报「账号终端清理失败，请重试关闭」，CLI 保持占用，续聊被「请先关闭账号终端」阻止。本机核对：agy（pid 13692）未回收登录时的浏览器打开辅助进程，留下僵尸子进程 13708；宿主 `dsh-subprocess-local` macOS 清理先清后代、有幸存者即抛 `terminal cleanup failed; surviving pids`，从不向 agy 发信号。合成探针复现同样失败，先 SIGTERM 顶层后清理即成功。
- 修复：`AccountManager.finish()` 在非 Windows、CLI 未退出时先 `signalForeground('SIGTERM')`，最多等待 `graceMs` 后再 `terminate()`；CLI 已退出不发信号。宿主核心未改。
- 测试：`tests/accounts.test.ts` 夹具在 SIGTERM 时模拟 CLI 退出；新增 3 项（僵尸幸存者、忽略 SIGTERM、已退出不发信号），去掉新调用时僵尸用例失败。全量 228 文件 4496 通过、13 跳过；类型检查、OpenSpec 严格校验 38 项、`build-preview.mjs`、正式 `build.mjs` 通过；本地提交 `6c367bc`。Desktop 重启后残留 agy 随旧 Host 退出。
- 未执行：真实 `/login` 后关闭终端（任务 3.1），需用户再次登录时验证。

## 2026-10-26 Desktop 实测：Antigravity 原账号退出重登后续聊（`continue-tasks-across-account-changes` 5.2、`fix-agy-macos-keychain-account` 3.2）

- 过程：用户在账号终端 `/logout` 后 `/login` 原账号；正式构建 `6c367bc` 后重启 Desktop，由 Codex Computer Use（gpt-6-astra high）在「让5个智能体同时打招呼」读取设置页并发送续聊。
- 结果（磁盘核对 `2fd9686d….events.jsonl`、`worker.json`）：钥匙串条目存在（`security` 退出 0），界面未出现钥匙串访问提示或模型选择卡；设置页显示已登录；run `708b2505…` 原生续接同一会话 `98bda1e4-e006-4248-87cc-7dceb4526a0a`，回复 `blue-lantern-42`，状态 `completed`，结果 `SUCCESS`。
- 不符合预期：过程区出现「账号已变更，已改用当前账号继续」，绑定由第一轮的 `…bce29b01` 变为 `…57063469`。原因（只比较结构与哈希，未输出凭据）：遗留文件含 `id_token`，主体为 `sub`+`iss`；钥匙串条目无 `id_token`、只有 `id_token_email`，主体退化为邮箱。两者邮箱哈希一致，是同一账号。第一轮在修复前按文件计算，因此这次是格式迁移导致的一次性改绑，不是重登本身。`fix-agy-macos-keychain-account` 中“同一账号从文件切换到钥匙串绑定不变”的假设与单测夹具（两边用同一 JSON）不成立，待用户决定兼容方案后修正。
- 未执行：钥匙串→钥匙串的同账号重登（稳态，无格式迁移）；退出期间续聊提示登录（3.1）。

## 2026-10-26 全部 CLI 换号静默续接（OpenSpec `continue-tasks-across-account-changes` 4A，`feat/general-settings`，未发布）

- 起因：Antigravity 重登实测出现「账号已变更，已改用当前账号继续」。用户要求：不要账号变更类提示，所有对话都能正常读取和续聊，全部 CLI 都要静默续接。
- 实现：移除改绑诊断；时间线隐藏旧记录中的换号说明，旧改接说明改为「原会话无法续接 / 原会话记录不可用，已在新会话中继续」；新任务受理后换号按当前账号重新授权用户已选的模型与强度；启动准备期间换号（未启动 CLI）静默重新授权一次；选型卡答完后、模型目录读取期间换号静默改读当前账号一次；对话与项目设定不再因绑定变化失效。仍保留：未登录、模型或强度在当前账号下不可用、同一次启动内连续两次变化。
- 钥匙串修正：`fix-agy-macos-keychain-account` 的“同一账号绑定不变”假设不成立（钥匙串只有 `id_token_email`），规格、设计与单测按实测格式改写；该一次性绑定变化现由静默改绑吸收。
- 测试：更新 6 个文件中原「换号即提示/拒绝」断言，新增静默与竞态用例 12 项；逐项撤掉新逻辑（旧记录过滤、启动竞态重试、新任务重读、设定绑定放宽、选型卡重试、目录读取重试、任务目录重读）时对应用例失败。全量 228 文件 4502 通过、13 跳过；类型检查、OpenSpec 严格校验 38 项、`build-preview.mjs` 通过。
- 未执行：Desktop 中静默续接复测（需再次退出重登）。

## 2026-10-26 Desktop 复测：静默续接与账号终端关闭（`713aa13` 正式构建）

- 过程：用户在 Antigravity 账号终端 `/logout` 后 `/login` 原账号并关闭终端（钥匙串条目 21:46:58 新建，遗留文件未变）；Codex Computer Use（gpt-6-astra high）读取设置页并让 `agy-11` 续聊「请把暗号倒过来写一遍」。
- 结果（磁盘核对 `2fd9686d…` 事件与 `worker.json`）：run `f10a5521…` 原生续接同一会话 `98bda1e4-e006-4248-87cc-7dceb4526a0a`，结果 `SUCCESS`、状态 `completed`，回复 `24-nretnal-eulb`；本轮无任何含「账号」的诊断，绑定 `…57063469` 与上一轮相同（钥匙串→钥匙串稳定），无 `previousConversationIds`/`reboundConversationId`。界面：设置页「已登录」，无终端占用或「账号终端清理失败」，未弹钥匙串、模型或权限卡；任务详情三轮均无「账号已变更」。
- 终端关闭：关闭后无残留 agy 进程或其僵尸子进程，续聊未被「请先关闭账号终端」阻止（系统中另有的僵尸进程属于 clash-verge，无关）。关闭瞬间的界面提示未目视。
- 未验证：退出登录期间的设置页状态与续聊提示（用户已重登，无法事后核对；需再退出一次时检查）。

## 2026-10-26 Desktop 复测：Antigravity 退出期间的状态（`fix-agy-macos-keychain-account` 3.1）

- 过程：用户在 Antigravity 账号终端 `/logout` 后保持退出（钥匙串 `gemini`/`antigravity` 查询退出码 44，条目不存在）；Codex Computer Use 读取设置页并让 `agy-11` 续聊。
- 结果：设置页显示「未登录」，第二行为「Antigravity 无法确认当前自身账号，请检查该 CLI 的登录或 API 配置」；续聊被拒绝且提示同一文案，主 Agent 据此重试两次。磁盘核对：未启动进程，Worker 仍为 `completed`、最近 run `f10a5521…`，绑定 `…57063469` 未变，无新增事件。
- 发现：拒绝文案没有告诉用户需要登录及去哪里登录，主 Agent 也无法判断不应重试。已在 `guide-agy-account-terminal` 改为明确的登录说明（见下节），待 Desktop 复测。

## 2026-10-26 Antigravity 账号终端引导与自动退出（OpenSpec `guide-agy-account-terminal`，`feat/general-settings`，未发布）

- 实现：`agy-account-guide.ts` 识别 agy 1.4.7 画面（去控制序列与空白后匹配），Host 只发固定文案；「退出登录」在识别到主界面后写入一次 `/logout` 与回车，以钥匙串状态确认后自动关闭终端；「登录账号」显示选择方式、浏览器授权并粘贴授权码、已粘贴按回车、确认中、已登录等步骤，登录与退出均以 `identity()` 轮询确认。Antigravity 未登录时续聊说明改为「尚未登录 Antigravity，请在「CLI Worker 设置 → Antigravity」点击「登录账号」完成登录后再继续」。
- 自动检查（模拟画面，标注合成）：`agy-account-guide` 8 项；`accounts` 新增 6 项 Host 集成（自动退出写入与关闭、未登录不写、退出未确认、登录只写用户输入且帧不含授权码、登录超时、关闭后停止轮询）；相关 7 个文件 238 项通过。
- 未验证：主界面就绪标记 `? for shortcuts` 为占位，需用户重新登录后只读探测真实已登录画面校准；真实退出、登录引导与退出期间续聊提示待 Desktop 验收。

## 2026-10-26 Antigravity 自制登录窗口（`guide-agy-account-terminal` 修订，未发布）

- 用户实测 `65793f1`：分步提示停在「第 1 步」，授权后无变化；没有醒目的“粘贴后回车”提示，看不出在哪里粘贴；样式难看。要求插件自绘分步登录窗口，后台仍用原生终端。
- 原因：只读探测（未登录，浏览器打开被替身拦截，只按回车选择默认登录方式，不提交授权码）显示 60×200 终端下授权码提示正常输出；弹窗中 agy 以约 80 列运行，登录地址折成 10 行，提示落在 agy 自身滚动区不可见的第 18–27 行，从未输出。登录地址以 OSC 8 超链接给出，agy 开启括号粘贴模式。
- 修订：Antigravity 登录/退出改为 `AgyAccountWizard`（三步登录、退出进度与结果、「显示原生终端」后备）；Host 以 200×60 隐藏运行，提取 Google 登录地址，画面静止后按原生账号状态判断是否已登录再自动 `/logout`，登录确认后结束原生终端。
- 自动检查（模拟画面与帧，标注合成）：`agy-account-guide` 12 项、`accounts` 新增 3 项并调整登录用例、`account-terminal` 新增 6 项，相关 3 个文件通过。
- 未验证：Desktop 中的真实登录窗口、真实退出与主界面就绪判定。
- Desktop 冒烟（`fe40c55` 正式构建，Codex Computer Use 只读截图，未点登录方式、未输入）：点「登录账号」后窗口先显示「正在启动 Antigravity…」，约 6 秒内进入第 1 步「选择登录方式」（说明、「使用 Google 账号登录」按钮、Google Cloud 提示），第 2、3 步为灰色待办，底部「显示原生终端」，原生终端未显示，无重叠或截断。以 × 关闭后显示「正在关闭终端…」，无确认框，之后无残留 agy 进程。设置页未登录时显示「尚未登录 Antigravity…」。真实浏览器授权、粘贴提交与退出尚未验收。
- 真实登录（`fe40c55`，用户本人操作新窗口）：钥匙串 `gemini`/`antigravity` 条目 2026-10-26 22:46:51 新建，插件自身绑定读取返回已绑定；登录确认后无残留 agy 进程（窗口按设计结束原生终端）。窗口各步的实际观感以用户反馈为准。
- 已登录主界面只读探测（200×60，只回复终端查询，未输入）：`? for shortcuts` 为真实文字；已登录启动也先打印「You are currently not signed in.」与「Signing in...」，约 2 秒后画出主界面。原实现会据此误报「无需退出」并关闭，已修正（D11：未登录只以登录方式菜单判定；静止阈值 3 秒；`/logout` 未生效且无登录菜单时再按一次回车）。全量 4533 项、类型检查、OpenSpec 39 项通过。
- 真实退出首测（`d6fa094`）：用户点「退出登录」后一直停在「正在检查登录状态…」，钥匙串条目仍在，agy（cwd 为当前项目 `/private/tmp/dsh-planning-speed-acceptance-20261019`）在运行。同目录只读探测复现：agy 先询问是否信任该项目文件夹，原退出窗口未处理。已修正为窗口显示信任询问、用户确认后再自动退出（D12）；按用户要求账号弹窗收窄为 480px，有可见终端时恢复 720px（D13）。全量 4535 项、类型检查通过。
- 真实退出复测（`14cf48a`）：用户确认文件夹信任后窗口显示「已退出 Antigravity」；钥匙串查询退出码 44；插件无残留 agy 进程；插件绑定读取返回「尚未登录 Antigravity…」。按用户截图反馈调整：底栏把「账号终端已关闭」与「显示原生终端」放在同一行；粘贴提示改为淡绿色色块，去掉左侧色条和回车键帽。DSH 对话中退出期间的续聊提示仍待复测。

- 新样式下重新登录（`265bbc8`，用户本人操作）：钥匙串条目 2026-10-26 23:02:45 新建，插件绑定读取为已登录，插件无残留 agy 进程。

## 2026-10-27 可复用登录模板与「账号」窗口（OpenSpec `add-cli-login-templates`，`feat/general-settings`，未发布）

- 真实画面探测（2026-10-26 / 27，隔离 HOME / XDG / 配置目录，200×60 PTY，只回复终端查询或按回车 / 方向键，不提交任何授权码、密钥或网址；浏览器调用由替身拦截；原始输出含一次性码，仅留在会话临时目录，不入库）：
  - Codex：`login` 显示本地回调地址与 `navigate to this URL to authenticate` + auth.openai.com 链接；`logout` 未登录为 `Not logged in`。
  - Claude Code：OSC 8 链接 claude.com、`Paste code here if prompted >`，未开括号粘贴。
  - Qoder / Qoder CN：`login` 为 `open the following URL in your browser to sign in` + qoder.com / qoder.cn 设备页；未登录 TUI 先问信任文件夹，再是 `1. Sign in to continue`。
  - MiMo：`auth login` 为 `Add credential` → `选择服务商`（MiMo 为首项）→ platform.xiaomimimo.com 链接 + `Paste code here if prompted`；`auth logout` 无凭据为 `No credentials found`。
  - ZCode 0.16.9：`login bigmodel|zai --no-browser` 为 `Open this URL to sign in:`；`logout` 为 `Logged out from Coding Plan accounts.`，两家一起移除。
  - Grok 1.0.62：设备码 `Confirm this code in your browser:` + accounts.x.ai；`logout` 未登录为 `No cached session to log out of.`。此后不再探测 Grok（`grok --help` 同秒写过 `~/.grok` 的模型缓存与会话索引，`auth.json` 未变）。
  - OpenCode 1.19.0（模拟凭据 `simulated-*`）：`auth list` 列出两条；`auth logout deepseek` 无交互输出 `Logout successful`，只删 deepseek、保留 openrouter；`auth login -p <服务商>` 约 15 秒读取目录后进入 `Enter your API key`（deepseek / openrouter / anthropic 相同）。下拉框 19 个服务商 id 均与该版本 models.dev 目录核对。
  - Hermes（源码 `auth_commands.py`）：`auth remove <服务商> <id>` 无交互；`auth add <服务商> --type api-key` 依次问可选标签与 `Paste your API key:`（实测画面见 Pi/OMP/Hermes 报告）。凭据池每条有 6 位十六进制 id。
  - 未捕获：Kimi 全部画面；Qoder 已登录 TUI 与 `/logout`；Pi / OMP / Kimi 非空退出菜单。
- 自动检查（合成画面与模拟凭据，均已标注）：`account-guide-flows` 20 项（新文件）；`accounts` 新增 18 项（单账号流程、OpenCode / Hermes 指定服务商与单条退出、目标仍在时不报成功、目标不存在时拒绝）；`account-terminal` 新增 5 项（切换账号先退后登、退出未确认不登录、单条退出参数、Hermes 替换顺序、旧 Host 提示）；`settings-dialog` 改写 18 项并新增 3 项（账号窗口、行内确认、替换警示、添加 / 替换单选）；`cli-settings` 新增 `accountStartWith` 参数测试。修复了切换账号时登录被启动两次的问题（测试发现）。
- 全量：`vitest run` 230 个文件通过、3 个跳过，4602 项通过、13 项跳过（首轮 3 项失败：词条键须含中文、Gateway 新参数，已修）；类型检查通过（DSH 0.2.1-rc.3）。
- 未验证：Desktop 中各 CLI 的真实登录 / 退出 / 切换账号；OpenCode / Hermes 真实 API Key 登录与单条退出；Kimi、Pi、OMP 的「登录到」与逐条退出尚未实现。

## 2026-10-27 Kimi、Pi、OMP 的「登录到」与逐条退出（OpenSpec `add-cli-login-templates` 0.3、2.4，`feat/general-settings`，未发布）

- 实现由三个子 agent 分别完成（Pi、OMP、Kimi），主会话审阅后补了引擎的后台授权核对（`watches`）、OMP 软删除行不覆盖其他位置，以及 Kimi 链接白名单与词条。
- 真实画面探测（隔离 HOME / 临时目录，模拟凭据，不提交任何授权码、密钥或网址；原始输出含一次性码，仅留在会话临时目录）：
  - Pi 1.0.4：`pi-login.mjs logout deepseek` 只移除 deepseek，其他服务商保留；`login <服务商>` 进入登录方式菜单（账号 / API Key）。
  - OMP 16.4.4：`/logout <服务商>` 列表每行带唯一 `#<rowid>`，选择时只局部重绘；按编号选中的那一行被软删除（`node:sqlite` 核对 `disabled_cause='deleted by user'`，其余行不变）。`/login <服务商>` 显示浏览器 / 设备 / 密钥画面。
  - Kimi Code：`kimi provider remove <键>` 只删目标；`/logout` 列表不循环，到边界即停，Kimi Code 恒为首行；`kimi login --region` 显示设备码与 www.kimi.com / www.kimi.ai 页面。
  - **影响真实安装**：探测期间 Kimi 自带的自动更新把真实的 `~/.kimi-code/bin/kimi` 从 2.1.1（188155456 字节，10-08）升级为 2.3.3（189806656 字节，10-27 08:54）；更新器写入自身安装路径，不受隔离 HOME 影响（原生开关为 `KIMI_CODE_NO_AUTO_UPDATE`）。`~/.kimi-code` 的配置、凭据、会话文件时间未变。另外 Kimi TUI 把模拟的 moonshot 密钥发到了 api.moonshot.cn（返回 Invalid Authentication）。
- 自动检查（合成画面与模拟凭据，均已标注）：`pi-account-window` 25 项、`omp-account-window` 25 项、`kimi-account-window` 17 项（均为新文件）；`kimi-accounts` 55 项（新增逐行登录）；`accounts` 新增 Kimi / Pi / OMP 参数与句柄校验；`pi-omp-native` 新增 OMP 软删除与有效凭据测试；`provider-login-status` 新增「deleted by user 视为未配置、其他禁用原因仍为失效」（全量首轮发现该回归后修复）；`settings-dialog` 新增 Pi 分组测试。
- 全量：`vitest run` 233 个文件通过、3 个跳过，4681 项通过、13 项跳过；类型检查通过（DSH 0.2.1-rc.3）；OpenSpec 严格校验通过。
- 未验证：真实授权成功与真实账号退出（Pi / OMP / Kimi）；Desktop 界面；Kimi `/logout` 分页（>8 行）；OMP Moonshot / MiniMax 登录画面；Copilot 企业版。已知风险：Kimi 的 40 次 ↑ 若未生效，窗口会停在「正在选择」，需显示原生终端处理（不会误按回车）。

## 2026-10-27 账号窗口反馈修正：OMP 模型目录、过期账号、MiMo 退出与卡片布局（`add-cli-login-templates` 2.5，未发布）

- 用户反馈（Desktop 截图）：OMP 账号窗口显示应已过期的 xai/openai 账号与不明的「CLI 全局账号」，OMP 模型列表和思考强度不显示；MiMo 退出无法完成；账号窗口与「登录到」页排版不佳。
- 根因（只读核对真实数据，未输出凭据）：`~/.omp/agent` 为 OMP 自身目录，有 7–8 月留下的 xai-oauth 与 openai-codex（均已过期）；插件目录的 xai-oauth 因续期被拒（invalid_grant）已被 OMP 停用。上一轮让停用行不覆盖其他位置，但共享续期缓存的 `owners` 仍按全部行判断，两边归属不一致，快照抛出「无法安全保存账号续期」，模型目录读取失败；同一改动让原生目录里失效的 xai 重新出现在列表。修复：统一 `ownsProvider`（只有 `deleted by user` 不占有服务商）。
- 真实数据复核（本机 OMP 16.4.4，读取模型目录，未调用模型）：修复前报错；修复后 13 个模型含思考强度；账号列表为插件目录两条 OpenAI（各带邮箱）、zai.cn API，以及配置中的 api.po1nt9.me，xai 不再显示。
- MiMo 0.1.15（隔离目录、模拟凭据）：`auth logout` 显示 `Remove credential / Select provider / ● Xiaomi (api)`，原流程无此步骤而停住；按回车后显示 `Logout successful`，经符号链接的 `auth.json` 变为 `{}` 且链接保留。新增 `pick` 只在 Xiaomi 行回车。真实 MiMo 账号未退出。
- 引擎：`pick` 步骤在画面静止后仍未找到目标即转原生终端（覆盖单行列表与 Kimi ↑ 未生效）。
- 界面：账号卡片、位置组名与说明、正文上边距收紧；用户第二次反馈「登录到」页排版不协调后，查明浅色主题下 `bg-layer-1` 与弹窗底色相同，面板不可见、各块缩进不一，改为淡灰 `interactive-bg-hover` 卡片，服务商下拉框改为两列卡片单选，所有块贴齐同一内容边线（见 `doc/settings-ui-design.md`）。界面截图核对未完成：截图子 agent 截到了用户正在使用的 Word 窗口而非 Desktop，截图已删除，改由用户在 Desktop 中查看。
- 自动检查：`pi-omp-refresh` 新增 2 项（续期失败停用行 / OMP 退出行下的快照与续期缓存一致；在上次提交版本上确认失败）；`account-guide-flows` 新增 MiMo 3 项；`kimi-account-window` 新增 ↑ 未生效 1 项；`settings-dialog` 新增同服务商邮箱区分 1 项并更新分组断言；`provider-login-status` 改为允许经过滤的邮箱、不含 accountId 与令牌。全量 `vitest run` 233 个文件通过、3 个跳过，4688 项通过、13 项跳过；类型检查通过。
- 用户认可新账号窗口后，单账号 CLI（如 MiMo）的「登录 / 切换账号」已登录页改为同样的卡片样式：当前账号卡片（品牌图标、登录方式与邮箱、「已登录」）与右对齐「关闭 / 切换账号」，不再显示居中结果页与「显示原生终端」。账号信息来自设置页已有的账号状态，不另读凭据。自动检查：`account-terminal` 新增已登录卡片页 1 项（模拟账号状态）；全量 `vitest run` 233 个文件通过、3 个跳过，4689 项通过、13 项跳过；类型检查通过。Desktop 中的实际外观由用户查看，未截图核对。用户查看后确认满意。
- 「CLI Worker 设置」通用页的「语言」标题紧贴页头（用户截图反馈）：CLI 页页头下有 28px 开关状态行，通用页没有。改为通用页第一分区上方补 28px，两类页面标题到第一分区的距离一致。自动检查：`general-settings`、`settings-dialog` 测试与全量 `vitest run` 通过；Desktop 外观由用户查看。用户确认间距合适。
- 用户要求点击设置默认进入「CLI Worker 设置」而非 Antigravity：面板标题栏设置按钮改为打开通用页（不再记住上次的 CLI），任务详情「默认设置」仍打开该任务的 CLI。自动检查：`panel` 新增 1 项（通用页选中、选择 CLI 前不读取模型目录），原生设置交接测试改为先选 Antigravity；全量 `vitest run` 与类型检查通过。

## 2026-10-27 Codex 第三方中转兼容（`allow-codex-custom-route`，未发布）

- 用户反馈：Codex 在 `~/.codex/config.toml` 设置 `model_provider` 指向第三方中转，命令行正常，插件派遣立即报「Codex 无法确认当前自身账号」。原因：`requireDefaultCodexRoute` 见到自定义路由配置即拒绝；模型目录只向 OpenAI 官方核对账号范围。派遣参数本不覆盖 provider。
- 方案（用户选择「交给 Codex 自己处理」）：Codex 自身配置声明的路由不再拒绝；账号版本取配置文件、`env_key` 变量与 `auth.json` 的摘要；模型取 Codex 自带 `model/list`（费用未知，设置页显示中转说明）；派遣与分支只额外传入配置 `env_key` 指定且宿主存在的变量。只有宿主继承的 `OPENAI_*` 变量而无配置路由时仍拒绝。
- 本机模拟验收（Codex CLI 0.162.1，隔离 `CODEX_HOME`，本机 127.0.0.1 模拟中转，模拟密钥，无真实凭据与模型调用）：
  - 直接运行 `codex exec` 经模拟中转完成；同配置下 `app-server model/list` 返回 Codex 自带 8 个模型，不访问中转 `/v1/models`；插件解析后 7 个（`gpt-6.1-sol` 被原有原生过滤规则排除，未改）。
  - 经插件 Host（`authorizeSelection` + `WorkerRuntime.submit`，计划模式）：`auth.json` + `requires_openai_auth = true` 形式首轮、续聊均 completed、同一会话；改写 `auth.json` 密钥后账号版本变化，续聊自动继续 completed、同一会话；模拟中转日志对应 3 次 `POST /v1/responses`（带 Bearer，model 为所选 `gpt-6-sol`）。
  - `env_key` 形式：首次运行失败，Codex 报 `Missing environment variable: MOCK_RELAY_KEY`——DSH 子进程环境经净化，变量未传入。增加 `env_key` 透传后重跑，首轮、续聊、换密钥后续聊均 completed，同一会话，中转日志 3 次请求。
- 自动检查：`cli-account-binding` 改 4 项、新增 3 项；`codex-models` 新增 2 项；`settings-dialog` 新增 1 项。`core`、`worker-goals` 的 mock 补 `codexRouteEnvironment`。全量 `vitest run` 233 个文件通过、3 个跳过，4696 项通过、13 项跳过；类型检查通过；`openspec validate allow-codex-custom-route --strict` 通过。变更保持未归档，等待真实中转实测（任务 3.2）。
- 未验证：真实中转站（无账号，需反馈用户实测）；DSH Desktop 中由终端设置的 `env_key` 变量是否被宿主进程继承；keyring 存储下中转密钥变化不会改变账号版本（已知边界）。

## 2026-10-27 v0.8.4：发布验收

- 范围（用户批准以 v0.8.4 发布到 GitHub 与 npm）：v0.8.3 之后 `feat/general-settings` 分支的全部改动——CLI Worker 通用设置页（界面语言、最高同时对话数、同目录写任务并行、调用前询问模型）、同目录写任务隔离副本与主 Agent 合并、换号后自动续接、插件绘制的登录/退出窗口与多账号「账号」窗口、权限被拒轮次标为未验证、Grok 只读规划模式、Hermes/OMP/ZCode/并行派遣修复，以及本日的切换账号卡片页、设置默认页与 Codex 第三方中转兼容。版本号与 Codex/ACP/MCP/Hermes 客户端标识改为 0.8.4。
- OpenSpec：已完成的 `fix-account-terminal-zombie-close`、`fix-parallel-account-waits`、`fix-parallel-dispatch-admission`、`fix-hermes-bracketed-ipv6-no-proxy` 归档为 `2026-10-27-*`，`spec:check` 37/37。其余变更保留未归档，未勾选项均为真实账号、真实模型、DSH Desktop 实机或其他平台验证。
- macOS：`typecheck` 通过；全量 `pnpm test` **233 文件通过、3 跳过；4696 通过、0 失败、13 跳过**（版本号与 Windows 修复后各重跑一次，结果相同）；`git diff --check main` 通过（修正 5 个文件末尾多余空行）。
- Windows（x64，Node v24.15.0，pnpm 11.25.0；新地址经原固定主机公钥严格核对后登记）：`test:windows:remote` 隔离 preview、冻结依赖、typecheck、Windows CI 文件 **111 通过、1 项 POSIX 跳过**、包检查与 Host 加载均通过，success/cleanup.confirmed/cleanup.lockReleased 为 true。同一源码目录全量 vitest（隔离 HOME/USERPROFILE/TEMP）首轮 4608 通过、17 失败；在正常用户环境串行重跑仍有 8 项失败，逐一定位：
  - 产品问题：同一项目并行启动 Grok 时，各启动以 rename 替换共享 `config.toml`，Windows 同时替换同一文件报 `EPERM`。改为 Windows 上遇 EPERM/EACCES/EBUSY 短暂重试（最多 20 次）。Hermes 的 `NO_PROXY` 改写在 Windows 只处理 `NO_PROXY`（Windows 环境变量名不区分大小写）。
  - 测试假设 POSIX：Antigravity 仅邮箱凭据（POSIX 文件路径；Windows 有独立用例）与 Qoder/Hermes 引导窗口 4 项（只测画面流程，Windows 启动解析另有用例）在 Windows 跳过；Pi PATH 解析测试改为同时隔离 `APPDATA`/`LOCALAPPDATA`/`PNPM_HOME`，不再读到这台机器已安装的 `pi.cmd`；Hermes 大小写测试按平台断言。
  - 修复后全量（隔离 HOME/TEMP）**4604 通过、16 失败、53 跳过**，上述文件均通过；失败落在另外 10 个读取器/模拟进程文件，另 2 个文件因远端未传 `scripts/` 而无法加载（测试环境所致）。这 10 个文件在正常用户环境串行重跑 **279/279 通过**。与 v0.8.2/v0.8.3 同类：隔离 HOME/TEMP 并行负载下的失败集合每轮不同，根因未定位。

- 打包：正式构建与最终 Windows 远端 preview 出自同一提交，`lib/index.js` 与全部原生辅助文件逐字节相同（515 个文件），`lib/client.js` 只差打包器 region 注释。`npm pack --ignore-scripts` 生成 `dsh-cliworker-now-0.8.4.tgz`（912 个文件、18491692 字节，SHA256 `d7f6ba6f…326b`）；扫描未发现私人路径、IP、`doc/local/` 或 `.test-data/`，无 scripts/devDependencies。macOS 用官方 dsh 0.2.1-rc.3 隔离 profile `plugin add` 该 tgz：exit 0，版本 0.8.4。
- Windows DSH Desktop：Harness 未运行，空闲门禁全为 0。原生安装器把正式 profile 从 0.8.1 升到 0.8.4：exit 0，702 个 lib 文件与 Host 哈希逐一匹配；另上传并核对 0.8.3 发布包作为回滚件（未使用）。随后正常启动，无调试参数。UIA 只读核对：
  - 标题栏设置按钮直接打开「CLI Worker 设置」，四个通用选项齐全。
  - 13 个 CLI 页均列出；Codex、Antigravity、ZCode 显示已登录，模型按钮可用。
  - Claude Code 显示「Claude 自身配置 API 登录」，并提示原默认模型不可用、需重新选择；Kimi 提示登录凭据已过期，模型按钮禁用。这两项是这台机器的账号状态，不是插件故障。
  - Hermes「账号」窗口列出 1 个登录及「在原生终端中退出」「添加账号」，Escape 可关闭。
  - 设置最终已关闭。
  - v5 观察 151.9 秒（03:20:32–03:23:04 UTC），完整覆盖前四段动作（03:20:54–03:23:02）：没有新增的 Harness 窗口，唯一事件是此前已打开、非 Harness 子孙的 Windows Terminal 获得前台。之后读取 Claude/Kimi/Hermes 的三段动作不在观察范围内。
  - 收尾门禁 activeWorkers、账号 scope、owner、原生认证、观察器及本次计划任务均为 0。
  - 0 次模型调用、0 次登录或退出、0 次偏好修改。
- 未验证：真实模型调用、真实中转端点，以及各 CLI 的实际登录、退出和切换账号（Windows 只打开了只读页面）；Windows 隔离 HOME/TEMP 全量失败的根因。

## 2026-10-27 Windows 账号退出卡住修复（v0.8.4 发布前）

- 用户反馈：Windows 上多个 CLI 的「退出」窗口卡住。用户授权后，用 Antigravity 做了一次真实退出复现。窗口停在「正在启动」约 13 秒，转入「正在退出」，最后报「未能确认已退出」；账号仍是已登录。
- 根因一，Antigravity：Windows 上的 agy 首次打开终端时会进入初始设置，先选配色（Choose your color scheme），再勾选服务条款与数据使用。插件不认识这两屏，等屏幕静止后读到账号已登录，就输入了 `/logout` 和回车。这次回车只把向导推进到服务条款页，退出没有发生。初版修复只是把这两屏交给用户在原生终端里完成。后续实测发现两个问题：自动展开的原生终端没有键盘焦点，用户按键根本没送到 agy（agy 日志在 11:55–12:13 之间没有任何记录，`onboarding.json` 始终未完成），所以每次都重新出现；而且用户不想自己逐屏处理。按用户选定的方案（OpenSpec `guide-agy-account-terminal` D14）改为：
  - 配色页整页画完后，插件按一次回车采用默认配色。
  - 服务条款画成插件窗口中的一步，数据收集选项默认不勾；用户点「同意并继续」后，Host 按读到的勾选状态切换，再按 ↓ →，确认 `[Done]` 已选中后按回车。
  - 无法跟随的画面转给原生终端，终端出现时自动获得焦点。
  - 登录流程同样适用。
  - `agy -p /help` 列出的打印模式命令不含 `/logout`，所以无法绕开交互界面。
- 根因二，Node 包装入口：Codex 的 npm `codex.js` 等 Node 包装脚本以 `stdio: 'inherit'` 启动原生程序。Electron 运行时下 fd 0 是 NUL，原生程序因此报 `stdin is not a terminal`：Codex 账号终端直接以退出码 1 结束，交互输入也无法送达。修复：在账号终端专用的 `windows-account-stdio.mjs` 中，把 `spawn`/`spawnSync` 继承来的 stdin 换成已重新打开的控制台输入（`CONIN$`）。任务进程与共享 Host 不受影响。
- Windows 实测（x64，DSH Desktop，正常退出 Harness 后用原生安装器安装修复后的隔离包，702 个 lib 文件逐一匹配）：
  - SSH 伪终端下，修复前包装脚本启动的子进程 `IsInputRedirected=True`，修复后为 `False`。
  - Codex「账号终端」修复前报 `stdin is not a terminal`（退出码 1），修复后正常显示 Codex 主界面；未输入任何内容即关闭。
  - Antigravity「退出」初版修复后约 6 秒停在初始设置提示，原生终端自动展开，插件没有输入任何按键。
  - 第三版（终端获得焦点）：退出窗口出现首次设置提示时，焦点元素为 `Terminal input`。
  - 用 PTY 只读抓取条款页：只在配色页按回车，在条款页只按方向键、不提交。确认了勾选框默认 `[x]`，回车切换勾选，↓ 到 `[Previous]`，→ 到 `[Done]`（显示为 `> Done`）；配色页在启动时画两次。
  - 第四版因配色页第二次重画被误判为「回到配色页」，转进了原生终端后备步骤。第五版（重画时继续等待）：约 8 秒自动跳过配色，停在条款步骤，「同意并继续」按钮出现。用户本人点击后，`onboarding.json` 变为 `onboardingComplete: true`，设置页显示「未登录」，无残留 agy 进程。用户选择的数据收集设置未单独读取核对。
- macOS：`typecheck` 通过；全量 `pnpm test` 234 文件通过、3 跳过；4699 通过、0 失败、13 跳过。首次设置改动后：`typecheck` 通过；全量 234 文件通过、3 跳过，4702 通过、0 失败、13 跳过；之后的配色重画修正只重跑了关联的 3 个文件（228 项通过）；`pnpm spec validate guide-agy-account-terminal --strict` 通过。
- 未验证：Codex、ZCode 等其他 CLI 在 Windows 上的真实退出（本次只授权了 Antigravity）。Qoder 的 `/logout` 同样依赖屏幕静止后输入，Windows 首次运行屏未实测。

## 2026-10-27 v0.8.4 重新发布（标签移至退出修复提交）

- 用户决定把 GitHub 上原指向 `7b7a6ed` 的 `v0.8.4` 标签移到包含 Windows 账号退出修复（`a7b8610`、`d4ff25d`）的提交，重新跑全量验收后创建 Release；npm 由用户 `npm login` 后发布。版本号不变。
- macOS：`typecheck` 通过；全量 `pnpm test` **234 文件通过、3 跳过；4702 通过、0 失败、13 跳过**；`spec:check` 37/37；`git diff --check main` 通过（修正 2 个 OpenSpec 文件末尾空行）。
- Windows 远程（run `e5093fe0`）：隔离 preview、冻结依赖、typecheck、Windows CI 文件 **111 通过、1 项 POSIX 跳过**、Host 加载均通过，success/cleanup.confirmed/cleanup.lockReleased 为 true。同一源码目录全量 vitest（隔离 HOME/TEMP，计划任务运行）**4614 通过、12 失败、53 跳过**；另 2 个文件因远端未上传 `scripts/` 无法加载。失败的 7 个读取器/模拟进程文件在正常用户环境串行重跑 **198/198 通过**，与此前各版同类，根因仍未定位。
- 打包：正式构建的 `lib/index.js`（SHA256 `33165606…112b`）与 Windows 远程 preview、Windows DSH Desktop 实测的第五版预览包相同；702 个 lib 文件中只有 `lib/client.js(.map)` 的打包器 `#region` 路径注释不同。`scripts/package-release.mjs` 生成公开清单（与原 v0.8.4 清单一致），系统 npm `--ignore-scripts` 打包为 `dsh-cliworker-now-0.8.4.tgz`，912 个文件，18504186 字节，SHA256 `01b2a4a7…4da5`；扫描未发现私人路径、IP、`doc/local/` 或 `.test-data/`。官方 dsh 0.2.1-rc.3 隔离 profile `plugin add`：exit 0，版本 0.8.4，安装后的 Host 与正式构建逐字节相同。
- Windows DSH Desktop：见上节，第五版预览包的 Antigravity 真实退出已由用户本人确认条款后完成。
- 未验证：真实模型调用与中转端点；Windows 上 Codex、ZCode、Qoder 等其他 CLI 的真实退出，以及各 CLI 的真实登录与切换账号；agy 条款步骤后保存的数据收集设置未回读；Windows 隔离 HOME/TEMP 全量失败的根因。
