# Tasks

## 1. SDK 来源、差异与构建目标 〔后端｜4h〕

- [x] 1.1 在指定独立 worktree 实施，记录升级前提交、锁文件非 DSH 包集合及同环境 macOS 全量 Vitest 基线，复核 npm 发布时间、tag commit、Desktop 版本和自带 `dsh` 版本。
  - 实施 worktree 为 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/worktrees/2026-11-19-dsh-rc5-adapt`。
  - 独立验收目录为 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-19-dsh-rc5-adapt`，用于干净安装对照、临时 `HOME`／`DSH_HOME`、验收工作区及产物。测试根和私有验收目录权限为 0700。
  - 基线分支 `dsh-022rc5-adapt`、干净提交 `c6df94a144c809869ed603e95cf4bce78987310c`。macOS、Node 22.23.1、corepack pnpm 11.25.0。修改跟踪文件之前完成根目录冻结安装和 `corepack pnpm build`，均退出 0。首次冻结安装复用了现有 `~/Library/pnpm/store/v11`；后续显式使用 worktree 内的 store。锁文件 1,037 项中非 DSH 705 项，排序摘要见 1.3。
  - 首次 `KIMI_CODE_NO_AUTO_UPDATE=1 corepack pnpm vitest run --maxWorkers=2` 退出 1，366 文件（360 通过、2 失败、4 跳过），8,857 项（8,830 通过、12 失败、15 跳过），另有 3 个未处理错误，295.81 秒。将 HOME 从被测试仓库内部移至所列验收目录，恢复原 PATH 的 Python 3.12.13，并只为 Git 指定系统二进制后，Qoder／Hermes 两文件 94 项全部通过。
  - 按修正环境重测未改动基线，退出 1，366 文件（361 通过、1 失败、4 跳过），8,857 项（8,841 通过、1 失败、15 跳过），362.22 秒。下载总时限模拟用例的流提前关闭，两次单文件复跑为 17/18，通过 c6df94a 的独立 rc.3 安装夹具再次单跑为 18/18（6.61 秒）。升级后全量使用同一外部 HOME、原 Python 与双 worker。
  - 官方 npm 发布时间分别为 rc.4 `2026-11-17T17:03:03.170Z`、rc.5 `2026-11-18T13:17:23.604Z`，查询时 latest 和 next 均为 rc.5。Git tag 解析为 `3f321d32bfe382212a8ed8785c1d47a5a300aa23`、`9c2670d3bce5275e0d1610272958121af87787bb`。只读 Info.plist 和隔离 HOME 下自带 `runtime/cli/bin/dsh --version` 均得到 0.2.2-rc.5。测试根、验收目录与临时 HOME 权限均为 0700。
- [x] 1.2 对两套实际安装的 rc.3 与 rc.5 npm 产物逐包比较，核对 Gateway、Remote、Typert、扩展点、主题 token、共享组件、四包及 Cordis。将公开导出、生成类型、运行产物、资源的实际差异和「需适配」或「无需改动」的依据补入设计。若发现破坏性变化，完成最小兼容修正并通过关联测试。
  - 两棵冻结安装树的 332 个 DSH 包与 Cordis 4.1.0 共 333 包，按约定排除文档噪声、map、垫片和包清单后比对 11,102／11,106 个文件，18 包 47 个差异路径，归一化 pin 后导出与入口等 10 组字段差异 0。39 个直接 pin 中有 3 包出现文件差异，详见设计中的逐包结论，插件接入无需修改。
  - 逐包清单在上述验收目录的 `sdk-comparison.json`，SHA256 为 `f4c4f6cc274adfc1b45b144a65cf29cf5a59b530ead29de63893157704b4afd8`。
- [x] 1.3 将 `package.json` 的 39 个 `@deepseek-ai/dsh*` 开发依赖同步为精确的 0.2.2-rc.5，更新 `pnpm-workspace.yaml` 发布期限例外和 `pnpm-lock.yaml`。以 `pnpm install --frozen-lockfile` 复核，并比较锁文件非 DSH 包集合与基线逐项一致。
  - 39 个 DSH 开发依赖和根 workspace 的 340 条版本例外均更新到 rc.5，插件版本为 0.9.1。根目录 `corepack pnpm install --frozen-lockfile --offline --store-dir "$PWD/.cache/upstream-store-seeded"` 退出 0，用时 12.1 秒。根锁共 1,037 项，非 DSH 包名和精确版本排序清单为 705 项，升级前后逐项一致，SHA256 均为 `203d8c00dfbd41e5290fff7714fac33ef52c637ab1c87f30ff6fbe19a4649692`。
  - 联网安装曾遇到 DNS 和大包下载超时，保留既有代理，复用私有 store 中已获取的官方包和 rc.3 缓存后冻结复核通过。
- [x] 1.4 在 `scripts/host-targets.json` 注册 rc.5 并将 `vendorDefault` 指向它，核对 `scripts/build-dependencies.mjs`、`scripts/build-host-extension.mjs`、`scripts/vendor-host-extensions.mjs` 对新旧目标的选择与校验。更新当前基线的 `build-dependencies`、`clean` 测试并跑定向回归，旧目标和不支持目标的断言均通过。
  - 目标表新增 rc.5 固定 commit、独立工具链和 vendor 标记，vendorDefault 为 rc.5。三个脚本均读取同一目标表。定向 `vitest run tests/build-dependencies.test.ts tests/clean.test.ts --maxWorkers=2` 退出 0，2 文件 26 项通过，失败和跳过均为 0。覆盖 rc.5 选择、历史图、拒绝未支持 rc.4，以及保留当前缓存和清理旧缓存。

## 2. 四个原生界面包的补丁迁移与分发 〔后端｜5h｜前置 1〕

- [x] 2.1 在官方 rc.5 commit 建干净与补丁工作树，三方迁移 rc.3 的 48 文件补丁，导出 `host-extensions/dsh-0.2.2-rc.5/source.patch`。对比旧补丁的文件清单和内容，记录任何差异和处理原因，验证补丁反向应用及 `git diff --check`。
  - 上游干净与补丁工作树分别放在 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/worktrees/2026-11-19-dsh-rc5-upstream-clean` 和 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/worktrees/2026-11-19-dsh-rc5-upstream-patched`。
  - 用 `git worktree add --detach` 建立上述两棵官方 rc.5 树，HEAD 均为设计中的完整 commit。补丁树 `git apply --3way` 成功，`build-host-extension --target 0.2.2-rc.5 --source <补丁树> --export-patch` 导出 48 文件、0 冲突。新旧补丁 cmp、补丁树反向应用检查和 `git diff HEAD --check` 均退出 0，文件清单及内容逐字节相同。SHA256 为 `e96e40bea9924a54d1058adfdaf16fb9a95864659aec19b12c6dcc480f279439`，保留 rc.3 现有行为。
- [x] 2.2 同步 rc.5 的独立构建依赖、锁文件和 workspace 清单，冻结安装复核。使用相同 Node、代理和依赖配置分别运行补丁前后的 `ui-session`、`ui-conversation`、`ui-subagent`、`ui-chat` 上游 Vitest。按包记录通过、失败、跳过数，逐项追溯并处理失败。
  - 构建目录 `.cache/dsh-host-build-deps-022rc5/` 的 package.json、workspace 和锁文件冻结安装退出 0。独立锁 991 项，662 项非 DSH 清单与 rc.3 一致。上游两树按各自相同的 rc.5 上游锁、Node 24.22.1、pnpm 11.28.5 冻结安装，沿用代理，仅从 Vitest setupFiles 排除清除代理的测试钩子。
  - `KIMI_CODE_NO_AUTO_UPDATE=1 node node_modules/vitest/vitest.mjs run packages/client/ui-session packages/client/ui-conversation packages/client/ui-subagent packages/client/ui-chat --config <保留代理的配置> --maxWorkers=2`，两树均退出 0。按 session、conversation、subagent、chat 排列，干净树分别通过 30、914、121、1,016 项（122 文件／2,081 项，77.43 秒），补丁树分别通过 36、964、122、1,095 项（128 文件／2,217 项，79.27 秒），各包均 0 失败、0 跳过。
  - 大包联网首次重试超时后，使用工作树内的官方包缓存和已安装 rc.3 的 store 副本，通过同一冻结锁复核。上游的完整依赖与构建用的 863 条别名分在不同 checkout。
- [x] 2.3 准备依赖链接、通过四包类型检查，运行 `node scripts/build-host-extension.mjs --target 0.2.2-rc.5` 及同目标 `--verify`。用 `node scripts/vendor-host-extensions.mjs --from <经校验的产物目录>` 更新 `runtime-host/`，再以不带参数的 vendor 命令复核。核对四包 `package.json` 及 manifest 均指向 rc.5、继承的 Host 和声明文件及 ui-chat 图片与官方同版本包逐字节一致，并通过 `tests/host-runtime-package.test.ts`。
  - `generate-dependency-links` 复核 863 条别名，303 条 DSH 版本变化、0 项非 DSH 版本变化，删除已由 pmspec 替代且四包不用的旧规划 CLI 别名。独立 workspace 沿用旧例外并追加 rc.5，最终冻结安装退出 0，991 项供应链策略通过。三份实际构建输入与冻结清单 cmp 一致。
  - `build-host-extension --target 0.2.2-rc.5 --prepare-links`、四包源码类型检查、相同目标的构建／更新 README 后的重建及 `--verify` 均退出 0。构建核对 631 文件；显式 vendor 和无参数复核均退出 0，runtime 4 包、217 文件（另有 manifest）。四包及 manifest 版本、tag 和 commit 与 rc.5 固定来源一致。runtime manifest SHA256 为 `536941144672da6d3282162530849a38351358bd12a1bcb8e7e6444481791512`。
  - 独立读取官方 rc.5 npm 包，202 个 Host／声明文件均逐字节匹配，ui-chat 图片集合、导出及 21,631 字节鲸鱼图相同，图片 SHA256 为 `0fd990d118113d19af7af4480f2b55d610b103451a08be6f7bf5a146823f8bd3`。最终 `tests/host-runtime-package.test.ts` 单跑 1 文件 12 项全过，退出 0。
- [x] 2.4 在独立夹具验证 rc.3 旧目标的 `build-host-extension --verify` 及显式 vendor 路径可用，复核 rc.5 随包清单和旧目标资产均未被夹具覆盖。
  - 原 rc.3 构建产物目录已不存在。在 `.cache/rc3-fixture/` 用官方 rc.3 tag、旧补丁、原三份构建依赖重建，按冻结清单从主仓库只读拷贝旧工具别名。使用本分支目标表和脚本，`build-host-extension --target 0.2.2-rc.3 --verify` 退出 0（631 文件）；显式 vendor 导入和 `--target 0.2.2-rc.3` 校验均退出 0（4 包 217 文件）。夹具内以默认目标检查这套 rc.3 产物如期退出 1，提示所选目标 rc.5 不符。
  - 根目录无参数 vendor 仍通过；夹具操作前后 rc.5 runtime manifest SHA256 均为 2.3 所列值。`git diff --quiet c6df94a -- host-extensions/dsh-0.2.2-rc.3` 退出 0。
- [x] 2.5 同步 `README.md`、`README.en.md`、`doc/design.md`、`doc/protocols/native-conversation-host-extension.md` 和生成的 `runtime-host/README.md` 的当前宿主适配版本。核对新扩展目录 README 的来源和构建说明，检索所有当前适配版本文字均为 0.2.2-rc.5，旧版本历史及对应证据可查。
  - 中文／英文 README 的需求行和徽标、设计文档的新版本段落、宿主协议开头、生成的 runtime README 和新扩展 README 均核对为 rc.5，保留带日期的旧版历史和 rc.3 扩展目录。新 README 记录真实 tag、commit、补丁摘要、四包构建命令、上游 Vitest 配置与结果；纳入最终重建后与产物目录逐字节一致。隔离 Web、Desktop、Windows 与真实模型分别由 3.3、4.x 跟进。

## 3. 插件回归与隔离 Web 宿主 〔测试｜4h｜前置 2〕

- [x] 3.1 核对 `tests/host-plan-state.test.ts`、`tests/cli-update-layout.test.ts` 和 `src/host/host-plan-state.ts` 的 rc.3 注释或基线。当前宿主规则或窗口尺寸以 rc.5 实际依据为准，保留已有的历史调查记录和模拟标记。先跑相关回归，再运行 `pnpm typecheck`（输出 `Host/Client typecheck passed against DSH 0.2.2-rc.5`）、macOS 全量 Vitest（零失败且通过数不少于 1.1 基线）、`pnpm lint`（零 error、无新增 warning）和 `pnpm format:check`。
  - 以 rc.5 官方源码核对 `packages/bundle/web-app/cordis.patch.yml` 的宿主 plan-mode 停用、presets 的 planning 组隔离，以及 `apps/desktop/src/main.ts` 的 minWidth 520px。更新三处注释，保留 rc.3 Mac 实测日期和夹具的模拟标记。先跑规划态／布局／runtime 关联回归，3 文件 37 项全部通过。
  - `corepack pnpm typecheck` 退出 0，输出 `Host/Client typecheck passed against DSH 0.2.2-rc.5`。同一隔离 HOME 下 `KIMI_CODE_NO_AUTO_UPDATE=1 corepack pnpm vitest run --maxWorkers=2` 退出 0，366 个文件中 362 通过、4 跳过；8,858 项中 8,843 通过、0 失败、15 跳过，耗时 369.35 秒。新增 rc.5 目标用例，基线中偶发失败的下载总时限模拟用例本轮通过。
  - `corepack pnpm lint` 退出 0，0 error、332 warning，逐文件的告警描述和数量与同提交改前基线一致。`corepack pnpm format:check`、`corepack pnpm exec pmspec validate v0.9.2-dsh-rc5-adapt-leeyl --strict` 均退出 0。Web、Desktop、Windows、真实账号／模型与派遣按 3.3 和 4.x 留待主会话。
- [x] 3.2 执行 `pnpm build:preview` 生成隔离预览包，复核包内 Host、Client、Remote 与四个 rc.5 随包资源的清单、版本和摘要。
  - `corepack pnpm build:preview` 退出 0，构建目录为 `.cache/preview-package/`。用 `corepack pnpm --dir .cache/preview-package --config.ignore-scripts=true pack` 打包。从交付文件重读确认 1,373 个常规文件，四包及清单均为 rc.5。包内 217 个 runtime 文件的摘要全部匹配 manifest，另含 manifest 自身。所有 exports 指向存在的文件，逐件核对预览目录内容；pnpm 打包规范化了根 package.json，移除了 packageManager 和 prepack。
  - 预览包位于上述独立验收目录的 `dsh-cliworker-now-0.9.1.tgz`（沿用现有插件版本），SHA256 为 `9422803fffcb0636cd2bc91a1e65963ca358a292ef44bc6c3eb2e2fab0ea5d50`。Host、Client、Typert Host、Typert Remote Client 入口 SHA256 分别为 `590544672e53643ea6fcbc602129c7bd7abf51ffc54edb1c54aa369b5e55026f`、`d6690b8f4dace7bba336842b4d9f51be18fb31e489f6439d6e4e42f8c2b45020`、`3181981a60ea8605e5f7c74263d6af70ecbbafb49a009dd570b2f34daaea9e48`、`f6c6b3397290024b996bf574ad96af4707c90725e31d48c496bd4904339ca7ea`。
- [x] 3.3 用 Mac Desktop rc.5 自带的 `dsh` 将预览包装入隔离 `DSH_HOME` 的 Web profile 并启动 `dsh web`。从有效配置与实际模块路径核对四包均解析到插件 `runtime-host/`，检查主界面、CLI Worker 面板、设置无白屏，检查控制台及 Host 日志无插件相关错误。
  - 2026-11-19 在验收目录 `web33/` 下建临时 `HOME` 与 `DSH_HOME`（0700）。Desktop 自带 `runtime/cli/bin/dsh --version` 为 0.2.2-rc.5；`dsh plugin --profile web add` 装入 3.2 的 tgz 后，profile `package.json` 依赖指向该 tgz，已装插件版本 0.9.1。以 `dsh --profile web --no-open --host 127.0.0.1 --port 0` 启动，内置浏览器打开本地地址（token 未落盘）。
  - 有效配置：已装插件的 `cordis.patch.yml` 把官方 `ui-session`、`ui-conversation`、`ui-subagent`、`ui-chat` 设为 `disabled`，改以 `./runtime-host/dsh-client-ui-*/lib/index.js` 插入；四包 `package.json` 版本均为 0.2.2-rc.5。浏览器实际下载的客户端合包中四个模块段大小与 `runtime-host/` 各 `lib/client.js` 对应，且含补丁特有标记 `cliworker-native/`、`cliworker-continuation`。
  - 主界面、右侧栏 CLI Worker 面板（空态）和「CLI Worker 设置」弹窗（含 CLI 连接列表）均正常渲染，无白屏。控制台无错误；Host 日志只有启动地址一行，无插件报错。停止后进程退出、`host.lock` 释放。
  - 未执行：真实派遣、续聊与停止（属任务 4）。

## 4. Desktop 实机验收 〔测试｜3h｜前置 3〕

- [ ] 4.1 人工验收 Mac Desktop 加载。确认无活动 Worker 后执行正式构建，确认 Desktop 链接解析到本次构建，冷启动 0.2.2-rc.5，核对插件加载、原生会话视图、CLI Worker 面板与设置。记录应用和自带 `dsh` 的版本、可取得的应用构建标记及插件日志。
  - （未执行：待隔离验收通过及安排 Mac Desktop 实机操作。）
- [ ] 4.2 人工验收 Mac Desktop 真实派遣与续聊。确认主对话模型已有选型授权及可用额度、目标 CLI 已登录，在指定验收工作区由主 Agent 派遣一次并观察选型卡片。核对完成事件、退出状态、实际产物，续聊一次并核对沿用同一原生 CLI 会话。
  - （未执行：待 Mac Desktop 加载验收、真实模型及 CLI 条件就绪。）
- [ ] 4.3 人工验收 Mac Desktop 停止。经授权启动一项可观察的 Worker 任务，从面板停止，独立核对终态与进程范围已退出。本次遇到原生审批时同时记录审批转交的实际结果。
  - （未执行：待 Mac Desktop 加载验收和可停止的实机任务。）
- [ ] 4.4 Windows Desktop 由用户安排基础加载与派遣检查。确认实际宿主版本和插件来源，核对面板及设置可用，并记录获授权派遣的事件、退出状态和实际产物。Windows 实机本项只做基础检查；Windows CI 定向检查按发布规格执行。
  - （未执行：等待用户安排 Windows rc.5 环境和调用条件。）

## 跟进

- 达到实施验收要求后按项目流程合并并清理已合入的 worktree 和分支，并保留指定测试根内仍有用的证据。发布验收另按 `development-workflow` 执行，保留尚未验证的账号、模型与平台范围。
