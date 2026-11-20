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

- [x] 4.1 人工验收 Mac Desktop 加载。确认无活动 Worker 后执行正式构建，确认 Desktop 链接解析到本次构建，冷启动 0.2.2-rc.5，核对插件加载、原生会话视图、CLI Worker 面板与设置。记录应用和自带 `dsh` 的版本、可取得的应用构建标记及插件日志。
  - 2026-11-19 合并 #14～#17 后的 main（3c5b3f0）：Desktop 宿主下无子进程、221 条 Worker 记录无运行中项，退出 Desktop 后 `pnpm build` 通过，四个随包界面包均为 0.2.2-rc.5。Desktop profile 以 `link:` 指向本仓库（插件 package.json 仍为 0.9.1）。应用 `CFBundleShortVersionString`/`CFBundleVersion` 与自带 `dsh --version` 均为 0.2.2-rc.5。
  - 冷启动后主界面、CLI Worker 面板（空态）与「CLI Worker 设置」（CLI 连接列表）正常、无白屏；控制台仅有 DSH 自身的 `[deepseek-account] account read failed {field: profile}`，无插件错误。随后以 `--force-renderer-accessibility` 等参数重启，由 Codex Computer Use 在真实窗口复核同样通过。记录：`/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-19-v092-desktop-acceptance/round1-notes.md`。
- [x] 4.2 人工验收 Mac Desktop 真实派遣与续聊。确认主对话模型已有选型授权及可用额度、目标 CLI 已登录，在指定验收工作区由主 Agent 派遣一次并观察选型卡片。核对完成事件、退出状态、实际产物，续聊一次并核对沿用同一原生 CLI 会话。
  - 用户 2026-11-19 授权开始实机验收。验收工作区 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-19-v092-desktop-acceptance/ws`（0700，模拟项目）。主对话模型 `workbuddy/glm-5.3-flash`；17:16 主 Agent 派遣 Codex，选型卡选 GPT-6-Luna、Low、不使用角色预设。Worker `codex-hello-txt` 状态 completed，`hello.txt` 回读为 `hello v0.9.2`。
  - 17:18 续聊未再弹选型，同一 Worker 第二轮 completed，`hello.txt` 回读两行（追加 `second line`）。两轮原始流的 `threadId` 均为 `01a1f319-1369-…`，沿用同一原生 Codex 会话。
- [x] 4.3 人工验收 Mac Desktop 停止。经授权启动一项可观察的 Worker 任务，从面板停止，独立核对终态与进程范围已退出。本次遇到原生审批时同时记录审批转交的实际结果。
  - Worker `codex-ticks-loop`（每 5 秒向 `ticks.txt` 追加一行）。17:20:42 在 Worker 详情点「停止生成」，事件 09:20:43Z 为 `interrupted`「已停止」；`ticks.txt` 在 17:20:37 后断档，说明 CLI 进程已退出。17:22:17 第二次停止同样在 1 秒内 `interrupted`，文件同样断档。
  - 发现（已在 4.5 修复，Desktop 复测见 4.6）：主对话收到 `interruptionReason: user` 后自行续派同一 Worker（新 runId 09:21:12Z、09:22:55Z），最后一轮跑满 60 行于 09:27:09Z completed。用户从面板停止后主 Agent 不应自动续派。
  - 本次无原生审批卡片（Worker 权限显示「自动审批」）；结束后 DSH 宿主下无残留 Codex 进程。
- [x] 4.5 修复手动停止后主 Agent 自动续派。还原会话日志确认原因，在后台作业结果、派遣说明和 `cliworker_followup` 描述中写明手动停止不得自行续派，补单测并跑关联回归。
  - 根因：会话 `session-6cb26a63…` 中，主 Agent 收到的作业通知只有 `finished [status: killed]` 与 `"status":"interrupted"`，没有停止来源和续派约束；其推理为「任务被打断，应续聊恢复」，随即调用 `cliworker_followup`。`src/host/service-launch.ts` 的作业结果此前不带 `interruptionReason`，`guidance` 只覆盖待核实与完成通知。
  - 修复：`isUserInterrupted(worker)` 为真时结果加 `stoppedBy: "user"` 与 `STOPPED_BY_USER_GUIDANCE`；`src/host/routing.ts` 派遣说明、`src/host/service-tools.ts` 的 `cliworker_followup` 描述加同一规则；增量规格 `specs/worker-run-outcomes/spec.md`。不在 `cliworker_followup` 加硬拦截，避免误挡用户之后明确要求的续聊。
  - 验证：`tests/agy-run-outcome.test.ts` 新增用户停止与超时两例，39 例通过；撤回 `service-launch.ts` 改动时用户停止用例失败。引用路由与续聊工具的 16 个测试文件 898 例通过；`pnpm typecheck` 输出 `Host/Client typecheck passed against DSH 0.2.2-rc.5`；改动的三个源文件 eslint 无输出。`src/host/routing.ts` 与测试文件改前即不符合 Prettier，按约定未整文件格式化。
- [x] 4.6 Mac Desktop 复测手动停止后不续派。正式构建并重启 Desktop 后，在已有验收工作区派一项可观察的长任务，从面板停止，核对主 Agent 收到 `stoppedBy: "user"` 且未调用 `cliworker_followup`。
  - 2026-11-19 用户授权「构建并复测」。确认 Desktop 下无 Worker 子进程后 `pnpm build:preview`、退出 Desktop、`pnpm build` 通过，`lib/index.js` 含 `stoppedBy`；profile 仍 `link:` 本仓库，带无障碍参数重启 Desktop。
  - 由 Codex Computer Use 在 `ws` 工作区新建对话（会话 `session-4e5f0b5e-99e1-48c7-9aed-18da1fd08808`，主模型 GLM-5.3-Flash），派 Codex Worker `codex-1`（GPT-6-Luna、Low，沿用确认卡）每 5 秒向 `ticks2.txt` 追加一行。约 23:16:12 在 Worker 详情点「停止生成」，事件 15:16:14Z `interrupted`「已停止」，本 Worker 只有一个 runId `4201f3cb…`；`ticks2.txt` 4 行，最后一行 23:16:10 后不再增长，无循环残留进程。
  - 会话日志中主 Agent 收到的作业结果含 `"stoppedBy":"user"` 与停止说明；其推理为「用户已停止，不应续聊或重派」，回复「被手动停止的任务我不会自行续聊或重新派遣」后结束本轮。之后 90 秒内无新的 tool/call、job/registered 或新 runId。
  - 另见：主 Agent 未核查产物即称「循环没有执行，`ticks2.txt` 也未生成」，与实际 4 行不符。停止说明里「只说明进度」可能让模型略过核查，用户决定调整措辞，见 4.7。
- [x] 4.7 调整手动停止说明：主 Agent 向用户说明进度前先只读核查实际产物，以核查结果为准，不凭本轮部分回复推测。
  - `STOPPED_BY_USER_GUIDANCE` 与 `src/host/routing.ts` 派遣说明改为「先只读核查实际产物，再按核查结果说明进度」，增量规格同步；`tests/agy-run-outcome.test.ts` 用户停止用例增加该断言，39 例通过；关联 16 个测试文件 898 例通过，`pnpm typecheck` 通过，eslint 无输出，严格校验通过。
  - Desktop 复测（2026-11-20，用户授权「构建并复测」）：确认无活动 Worker 后 `pnpm build:preview`、退出 Desktop、`pnpm build` 通过，`lib/index.js` 含新措辞，带无障碍参数重启。Codex Computer Use 在 `ws` 新建对话（会话 `session-f101111e-e4f0-4344-b48a-84e0188dac80`，主模型 GLM-5.3-Flash），派 `codex-1`（GPT-6-Luna、Low）写 `ticks3.txt`，00:07:06 从 Worker 详情停止。
  - 会话日志：16:07:07Z 主 Agent 收到 `stoppedBy: "user"` 与新说明，16:07:14Z 调一次只读 `bash` 核查 `ticks3.txt`（4 行，00:06:51～00:07:06），回复按核查结果说明「4 行、未完成、已按规则不自动续聊或重新派遣」并等待用户指示，16:07:23Z 结束本轮。之后约 90 秒无新的 Worker 运行或 `cliworker_followup`；`ticks3.txt` 停在 4 行，无残留循环进程。
- [x] 4.4 Windows Desktop 由用户安排基础加载与派遣检查。确认实际宿主版本和插件来源，核对面板及设置可用，并记录获授权派遣的事件、退出状态和实际产物。Windows 实机本项只做基础检查；Windows CI 定向检查按发布规格执行。
  - 2026-11-20 用户在 Windows 应用内把 Desktop 从 0.2.2-rc.3 更新到 rc.5，并授权「连接 Windows，完成实机检查」。经 SSH 核对：`DeepSeek Harness.exe` FileVersion `0.2.2-rc.5`，`runtime.json` desktopVersion `0.2.2-rc.5`；更新前插件为 0.9.1 正式包（`v091-8ef27ef-20261117`）。
  - 插件来源：在临时 worktree（HEAD `b7703b2`，构建后已移除）执行 `pnpm build:preview` 并打包，包 SHA256 `1b38ddbe605f45e8fc4433170a839f510280b09842dbde3d74fb02fb74c821b8`，1391 个文件，devDependencies 锁定 `@deepseek-ai/dsh` 0.2.2-rc.5，包内没有 `doc/local`、`.test-data` 或 `.ssh`。安装前空闲检查 activeWorkers=0、账号进程 0；经应用菜单正常退出（quitRequested=true，进程数 0）后运行原生安装器 `dsh plugin --profile desktop add --save-exact`，退出码 0，1391/1391 个文件哈希一致（lib 1167 个），profile 依赖改为 `v092-b7703b2-20261120\dsh-cliworker-now-b7703b2.tgz`；安装前 profile 与旧插件已备份到同目录 `profile-before`。在交互桌面带无障碍参数启动，进程正常响应，stderr 为空，启动日志无错误。
  - 界面（内置浏览器经 SSH 端口转发访问 Windows Host Web UI）：插件页显示 dsh-cliworker-now v0.9.1，已启用，说明文字为本次构建（含 rc.5 与委派深度说明）；右侧 CLI Worker 面板正常加载，无白屏；「CLI Worker 设置」打开正常，17 个 CLI 均列出，「更新 CLI」显示 9 项可更新；Codex 页显示已登录，项目默认为 GPT-5.6-Luna、Low。
  - 派遣：工作区 `live-codex`（`C:\Users\admin\cw081f1\live-codex`），标准模式，主模型 DeepSeek-V4.1-Flash High。用户已授权本次检查调用模型，派遣 Codex 新建 `rc5-win-check.txt`；问题卡片询问是否沿用 GPT-5.6-Luna · Low，选择沿用后启动。Worker `codex-1`（`596fd348-5864-4b5a-a4ff-1adf5bd917cf`），codex-app-v1，自动审批档（accept-edits）。
  - 事件：08:11:48Z queued → 08:11:52Z「本轮权限：自动审批」→ 08:11:56Z CLI 已连接，observedModel gpt-5.6-luna → 08:12:31Z result SUCCESS → 08:12:32Z completed。共 444 条事件，4 个工具步骤；步骤 2 是 Codex 用 `rg` 搜索自身记忆，无匹配退出码 1（FAILED），由此产生「本轮有 1 个工具步骤失败，CLI 已自行处理」的结果说明；fileChange 与读回命令（退出码 0）均完成。
  - 产物：SSH 读回 `rc5-win-check.txt` 共 24 字节，十六进制 `7263352077696e646f7773206469737061746368206f6b0a`（`rc5 windows dispatch ok` 加 LF），修改时间 16:12:21+08:00。主对话也用读取工具独立读回，内容一致。
  - 证据：`/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-20-windows-rc5-check/`（包、清单、安装与启动脚本、Worker 事件和 worker.json）；Windows 端 `%LOCALAPPDATA%\cliworker-now-remote\v092-b7703b2-20261120\`（安装结果、安装器日志、profile 备份、启动日志）。
  - 未执行：Windows CI 定向检查（按发布规格另行执行）；其他 CLI 的 Windows 派遣；DSH 原生子 Agent 在 Windows 上的派遣。检查结束后 Windows Desktop 保持运行，装的是本次构建。

## 5. v0.9.2 发布验收 〔测试｜4h｜前置 4〕

- [x] 5.1 macOS 自动检查、Windows 远程隔离检查、正式构建、打包与隔离安装（版本号 0.9.2，`299b872 chore(release): 0.9.2`；用户 2026-11-20 要求「归档这 6 个变更，提交到 github，然后发布」）
  - macOS：`corepack pnpm typecheck` 通过（DSH 0.2.2-rc.5）；全量 vitest 366 个文件通过、4 跳过，9038 项通过、15 跳过、0 失败（106 秒，日志 `.test-data/release-v0.9.2/vitest-full.log`）；`pnpm spec validate --all --strict` 41/41；`git diff --check origin/main...HEAD` 通过；`pnpm lint` 0 error（334 warning）
  - 格式：相对 origin/main 改动的 16 个代码文件中，11 个未通过 Prettier，但它们在 origin/main 上已不符合 Prettier（存量文件，按 AGENTS.md 不整文件重排）；本次新改的其余 5 个文件通过
  - Windows 远程隔离：运行 `015239d4`（299b872，config-d.json）preview、冻结依赖、包列表与入口、解包、契约类型、类型检查、31 个 Windows CI 文件 1039 项（1031 通过、0 失败、8 跳过）与安装包 Host 加载全部通过，无模型调用
  - 正式构建与隔离构建：退出 Mac Desktop 后 `corepack pnpm build` 通过；`lib` 1167/1167、`runtime-host` 218/218 文件一致，仅 `lib/client.js(.map)` 的 `//#region` 路径注释不同；Host `lib/index.js` SHA-256 `1fe54100…`，Client `ed1f2613…`。发布验证记录 `artifacts/dsh-cliworker-now-0.9.2-verification.json`，`scripts/package-release.mjs` 通过
  - 安装包：`artifacts/release-v0.9.2/dsh-cliworker-now-0.9.2.tgz`，22000825 字节，SHA-256 `94e1fec194604812077960cfcf45b15f732b89739a9659f6c4996ab064d2b70b`，1391 个文件；顶层只有 `LICENSE`、两份 README、`cordis.patch.yml`、`icon.png`、`lib`、`package.json`、`runtime-host`；`private:false`，无 scripts／devDependencies，repository／homepage／bugs 指向 `SuperWheel/dsh-cliworker-now`；内容扫描未发现 `.env`、`.test-data`、日志、私钥、令牌特征、私人路径、IP 或账号标识
  - 官方 dsh 0.2.2-rc.5（Desktop 自带 CLI）全新隔离 `HOME`／`DSH_HOME`：`plugin --profile web add --save-exact <tgz>` 退出 0，版本 0.9.2，1391 个文件与包内逐字节一致，`lib` 与 `runtime-host` 1385 个文件与正式构建逐字节一致；临时 profile 已删除，日志留在 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-20-release-v0.9.2-isolated-install/install.log`
  - Mac Desktop（DSH 0.2.2-rc.5，链接正式构建，Codex CU 只读，17:08）：插件 v0.9.2 已启用，CLI Worker 面板正常；17 个 CLI 设置页均显示状态（已登录 8、已连接 6、API 登录 1、已配置 1、未安装 1）；「更新 CLI」检查完成（可更新 10、已是最新 6、未安装 1）；无错误提示
  - 真实 CLI：自上次真实验收以来派遣代码有变化的是 Antigravity（`b7703b2`），2026-11-20 已在 Mac 与 Windows Desktop 用含该提交的构建实测（见 `v0.9.2-agy-background-command-leeyl` 4.1、4.2）；Codex 派遣 2026-11-20 在 Windows rc.5 实测（4.4）；OMP 服务商配置为隔离环境验收（`v0.9.2-omp-custom-provider-leeyl` 5）；发布候选包与这些构建只差 initialize 中的版本字符串，未在候选包上重跑真实派遣
- [x] 5.2 Windows Desktop 用原生安装器装入发布候选包并只读核对
  - 2026-11-20 用户回来后要求「开始测 Windows」。Windows（DSH Desktop 0.2.2-rc.5）上 Desktop 原本未运行，空闲门禁（`hermes-windows-preflight-readonly.ps1`）通过；备份 profile 的 7 个文件到 `%LOCALAPPDATA%\cliworker-now-remote\v092-release-20261120\profile-before`，用 Desktop 自带 pnpm 原生安装 `dsh-cliworker-now-0.9.2.tgz`（SHA-256 `94e1fec1…d2b70b`），退出码 0，依赖由 0.9.1 换为 0.9.2；1391/1391 文件与清单一致、lib 1167/1167，Host 哈希 `1fe54100…730aeb` 与 Mac 构建相同。脚本与清单副本在 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-20-windows-release-v0.9.2/`
  - 带无障碍与防节流参数启动（pid 29372，会话 38），进程响应正常，`desktop.stderr.log` 0 字节。直接调用 Codex Computer Use（Windows）只读核对：插件页 dsh-cliworker-now 显示 v0.9.2、已启用，6 个组件全部「运行中」；CLI Worker 面板正常渲染已有 CodeBuddy 任务；「CLI Worker 设置」17 个 CLI 都显示状态，16 个绿点，Qoder CN 红点「Qoder 原生账号查询暂不可用…（原生账号未认证）」，属该机 Qoder CN 原生登录状态，与本版改动无关；「更新 CLI」自动检查列出 可更新 11、需要手动更新 3（Qoder、Qoder CN、TRAE CN）、已是最新 3（MiMo 0.1.17、ZCode CLI 0.17.1、Pi 1.5.2）。核对后关闭设置、回到原会话，未改动任何设置，未点更新，未调用模型；Computer Use 中继已停止（无残留）
  - 未覆盖：Windows 上本次发布包未做真实模型派遣（4.4 已用 rc.5 + main 做过 Codex 派遣）；Desktop 保持运行，安装前 profile 备份保留以便回退
- [x] 5.3 推送 GitHub、创建 Release、npm 发布与回读
  - 2026-11-20 按用户批准推送 main（`3c5b3f0..4e52a67`）。[CI](https://github.com/SuperWheel/dsh-cliworker-now/actions/runs/44753553622) Windows native runtime 通过（31 个文件）；Linux checks 55 项失败，对照 11-18 已知清单（测试未固定模拟平台、Hermes／手动接管用例），失败文件与上一提交相同，变化的只是同一参数化用例的不同实例，相关源码在 3c5b3f0..299b872 间未改，判为非本版回归
  - 创建 [GitHub Release v0.9.2](https://github.com/SuperWheel/dsh-cliworker-now/releases/tag/v0.9.2)（标题 `dsh-cliworker-now v0.9.2`，标签指向 `4e52a67`，附 tgz 与 `SHA256SUMS.txt`）。`gh release download` 回读到 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-20-release-v0.9.2-readback/gh/`，tgz SHA-256 `94e1fec1…d2b70b` 与本地一致
  - npm：旧令牌失效（whoami 401），用户在终端完成网页登录与 2FA；`npm publish <tgz> --access public` 退出 0，输出 `+ dsh-cliworker-now@0.9.2`，npm 计算的 shasum `700277f175c5aa81b6237a432329c4b68ab0b445` 与本地 tgz SHA-1 一致，1391 个文件，标签 latest（日志 `.test-data/release-v0.9.2/npm-publish.log`）
  - npm 仓库回读：发布后约 5 分钟内仓库仍在处理（`latest` 为 0.9.1，`0.9.2` 返回 404）；22:49 直接查询 registry，`latest` 为 0.9.2，`dist.shasum` `700277f1…b0b445` 与本地一致，1391 个文件
  - 面板：6 个变更按归档路径同步（31 条任务，新建 1 条为本主任务 5），版本 0.9.2 标记已上线（实际上线 2026-11-20，缺运营素材，按用户要求记决策「0.9.2 发布（未完成项已说明）」），补丁车道新建 0.9.3；联动把 REQ-0138 等 2 个需求改为已上线并各建复盘任务（截止 2026-12-04）

## 跟进

- 达到实施验收要求后按项目流程合并并清理已合入的 worktree 和分支，并保留指定测试根内仍有用的证据。发布验收另按 `development-workflow` 执行，保留尚未验证的账号、模型与平台范围。
