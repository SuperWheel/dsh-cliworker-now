# Tasks

## 1. 差异核对与 Desktop

- [x] 1.1 npm `next` = 0.2.2-rc.1（2026-11-04T09:20Z），依赖 cordis `~4.1.0`（4.1.0 于 2026-11-04T08:11Z 发布）；官方 tag `dsh-v0.2.2-rc.1` = `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`。GitHub Release 无安装包附件。
- [x] 1.2 Mac Desktop 更新（用户 2026-11-05「用官方更新源，不用备份旧版」）：安装前确认 Host 无子进程、CPU 0.1%、5 分钟内无会话写入，经 AppleScript 正常退出（进程数 0）。下载 `https://download.deepseek.com/dsh-desk/bin/mac-arm64/deepseek-harness-0.2.2-rc.1-mac-arm64.zip`，353,501,474 字节，sha512 与 `nightly-mac.yml` 一致；`codesign --verify --deep --strict` 通过，`spctl` 为 Notarized Developer ID（Hangzhou DeepSeek，NAN929V4UM，与旧版相同）。替换 `/Applications/DeepSeek Harness.app`（未备份），版本 0.2.2-rc.1，启动后 5 个进程、无崩溃报告。当时插件仍为 rc.5 构建，界面未核对。
- [x] 1.4 Windows Desktop 更新（用户 2026-11-05「用 ssh 把 Windows 上的 dsh 也更新一下，也不用备份」，Codex gpt-6.1-sol high 执行）：Windows IP 变为 172.22.8.97，主机指纹与原记录（别名 172.22.96.112）一致。门禁：原 0.2.1-rc.5 共 5 个进程，DSH 进程树下无 CLI/node 子进程。经交互计划任务运行 `quit-harness.ps1` 正常退出（0 进程，未强杀）。直连下载 `deepseek-harness-0.2.2-rc.1-win-x64.exe`，293,425,336 字节，sha512 与 `win-x64/nightly.yml` 一致，Authenticode Valid（与已装版本同一证书，指纹 `84032578…2E6F`）。NSIS `/S /currentuser` 退出码 0，覆盖原用户级目录，未备份；exe FileVersion 与卸载项 DisplayVersion 均为 0.2.2-rc.1。经交互计划任务带 `--force-renderer-accessibility` 重启，5 个进程均在会话 25，主窗口可响应，10 分钟内无崩溃/挂起事件。主会话经 SSH 复核版本与会话号一致。证据：`.test-data/windows-remote/desktop-audit/update-dsh-022rc1-20261105.json`。`.test-data/windows-remote/config.json` 仍为旧 IP，未修改。插件仍为 rc.5 构建，未核对。
- [x] 1.3 rc.5 → 0.2.2-rc.1 全仓库 8120 个文件变化；四包源码：ui-session、ui-subagent 主要是新语言与少量界面，ui-conversation +5246/−757、ui-chat +5124/−551（含 `lib/assets`）。四包新增 DSH 依赖：ui-context-menu、ui-file-drag、message-quotes、tool-executor-ptc、client-connection；ui-primitives 新依赖 util-file-drag。

## 2. 重建四包

- [x] 2.1 固定 checkout `.cache/dsh-host-source-022rc1`（HEAD = tag），`git apply --3way` rc.5 的 48 文件补丁：8 个文件冲突（ui-conversation `index.ts`、`InputBar.tsx`；ui-chat `ChatFlow.tsx`、`RunningStatus.tsx`、`StatsPills.tsx`、`ChatView.module.css`、`stat-dialog.module.css`、`chat-view.client.spec.tsx`），逐处人工合并，合并原则见 `host-extensions/dsh-0.2.2-rc.1/README.md`。另把 `StatsPills` 两处插件 `ariaLabel` 改为官方 `text`；六种新语言补插件词条（conversation 12 条、chat 38 条，暂用英文）。`--export-patch` 导出 48 文件补丁（SHA256 `bc89b178…de09`）。
- [x] 2.2 构建依赖：rc.5 冻结三文件改 DSH pin 与 workspace 例外（追加 `|| 0.2.2-rc.1`），新增 `@deepseek-ai/dsh-util-file-drag`；`pnpm install --ignore-scripts`（独立 store `.cache/dsh-host-pnpm-store-022rc1`），package.json/workspace 未被改写。与 rc.5 相比：cordis 系列 4.0.5→4.1.0（plugin-group/include/loader 1.1.0、timer 1.2.0、cosmokit 1.9.0、schemastery 3.19.0），第三方只新增 acorn、acorn-walk、hosted-git-info、rrule、shell-quote、mime，无删除、无升版。`generate-dependency-links.mjs` 生成 870 行清单（无丢弃，新增 5 个包）；`--prepare-links` 通过；`check-client-types.mjs` 四包 session/conversation/subagent/chat 均为 0。
  - 未执行：上游四包 Vitest（同 rc.5，自动模式不运行外部仓库代码）。
- [x] 2.3 首次构建 ui-chat 报 `Missing field code`：插件根与独立依赖各有一份 rolldown 1.1.5，官方预设新增的资源插件返回 `RolldownMagicString`，跨实例不被识别。0.2.2 目标改由 checkout 链接的 tsdown 调用 `build` 后，`build-host-extension --target 0.2.2-rc.1` 构建并 `--verify`（230 个文件）。
- [x] 2.4 `vendor-host-extensions` 改为 0.2.2-rc.1，保留 ui-chat `lib/assets/*` 与 `./assets/*` 导出；冻结 `runtime-host/`（4 包、213 个文件，均为 0.2.2-rc.1），无参数复核通过；`running-whale@2x-06738fa29b2f.png` 与官方 npm 包逐字节相同。

## 3. 插件

- [x] 3.1 开发 SDK 39 个 pin 与根 workspace 300 条发布期限例外改为 0.2.2-rc.1，cordis devDep 4.1.0、peer `4.0.4 || 4.0.5 || ~4.1.0`；`pnpm install --ignore-scripts` 重生根锁：第三方只新增 acorn、acorn-walk、hosted-git-info、lru-cache、rrule、shell-quote，无删除、无升版。`build-dependencies.mjs`、`build-host-extension.mjs`、`vendor-host-extensions.mjs` 加入新目标。
- [x] 3.2 Host 端 0.2.2 API 适配（Codex gpt-6-astra high 实施，主会话审查与复跑）：
  - 工具桥：`native-harness-executor.ts` 在新宿主上以 `executeToolBatch` + 绑定子会话 context 的 `ToolExecutionPipeline` 逐调用原生执行（动态加载 `@deepseek-ai/dsh-tools/pipeline`），不改子会话自身执行器，策略、guard 与审批照常；保留 `cliworker:<callId>` 审批匹配与 `withinCliTool`，缺结果时明确报错。旧宿主检测到 `presentAs` 时沿用原路径（仅模拟测试覆盖）。
  - CLI 工具回执：0.2.2 AgentLoop 在模型响应前冻结可执行工具集，响应中注册的回执被拒。改为随内部子 Agent 生命周期挂载只放行插件当前回执定义的执行器，不执行真实工具（`harness-observed-tools.ts`）。
  - 冷会话权限修改：字符串键 `stateOf` 返回 `unknown`，新增 `native-cold-session-state.ts` 以官方 `InboxState`/`TurnBoundaryProjection`/`PlanUnitState` 类型做运行时校验，格式不符时不修改。仍依赖上游已标记弃用的 `stateOf`。
  - Worker 分叉：0.2.2 在步骤准备时固定模型选择，分叉在 `agent/request` 才换路由会被拒（表现为「Harness 分支历史初始化未完成」）。改在 `agent/created` 对分叉调用 `agent.model.select()`，不改继承历史（`harness-conversation.ts`）。
  - 宿主 guard（主会话修复，`scripts/host-extension-guard.mjs`）：0.2.2 的 `settings.configure` 与查找都按 `owner.ctx.fiber` 归一，代理 fiber 落到官方包已配置 `{ auto: false }` 的 vendor fiber 上，重复配置会抛错；遇此情况沿用官方包配置，旧宿主仍注册代理。0.2.2 设置表单改读 `fiber.effectiveConfig`，代理同时覆盖 `config` 与 `effectiveConfig`。
  - `windows-remote-common.mjs` 白名单放行 `runtime-host/dsh-client-ui-chat/lib/assets/*.png`。
  - `pnpm typecheck`：Host/Client 对 DSH 0.2.2-rc.1 通过。
- [x] 3.3 测试、契约与预览：
  - Codex gpt-6.1-sol high 更新 `build-dependencies`（新增 022rc1 选图、SDK pin、兼容列表含 0.2.2-rc.1、未验证目标改用 0.2.2-rc.2）、`host-runtime-package`（来源 commit、ui-chat 资源导出与 PNG 与官方包逐字节比较）、`clean` 测试。0.2.2 app-boot `evaluatePluginCompatibility` 不检查 cordis peer，故未加 cordis 准入断言。
  - typert（Codex gpt-6-astra high 实施）：tsc 声明输出会省掉只在 `declare module '<X>'` 扩充块内使用的 import（块内可直接引用 X 的导出），0.2.2 新增的 `SessionProjectionSummaryExcluded` 引用因此被 typert 分析器判为跨包未显式导入；生成器本身 rc.5 与 rc.1 逐字节相同。`scripts/build.mjs` 只对暂存的 SDK 声明副本用 TypeScript API 补 `import type`（通用、幂等、名称冲突时用别名，不掩盖其他分析错误），已安装 SDK 3019 个声明文件未改；新增 `tests/build-typert-augmentations.test.ts`。构建日志：10 个 SDK 声明文件被规范化。
  - 主会话复跑：`pnpm typecheck` 通过；全量 `vitest run --maxWorkers=2`（沙箱外，HTTP 桥测试需监听 127.0.0.1）253 个文件通过、4 个跳过，5437 项通过、14 项跳过、0 失败。`pnpm build:preview` 成功：预览包四包 0.2.2-rc.1，含 `runtime-host/dsh-client-ui-chat/lib/assets/running-whale@2x-06738fa29b2f.png`；`typert.remote-client.d.ts` 与 rc.5 构建产物逐字节相同（`typert.host.d.ts` 亦相同）。
- [x] 3.4 文档（Codex gpt-6.1-sol high，主会话审查）：README（中英）、`doc/native-conversation-host-extension.md`、`doc/design.md`、`host-extensions/dsh-0.2.2-rc.1/README.md`。

## 4. 安装与界面

- [x] 4.1 Mac Desktop 链接更新：Host 无子进程、CPU 0.1%、3 分钟内无会话写入；AppleScript 正常退出（0 进程）后 `pnpm build`（`lib/` 19:44–19:45 更新）。以 `--force-renderer-accessibility` 启动，5 个进程；启动输出只有更新检查（已是最新 0.2.2-rc.1）与本机 Web 地址，无插件、runtime-host 或 slot 错误。
- [x] 4.2 Mac 界面核对（Codex Computer Use）：CLI Worker 面板加载、Worker 对话、运行状态动画图片、统计药丸、输入框 Stop。
  - 2026-11-05 第一次（Codex gpt-6-astra high，只读）：受阻。主窗口停在「HARNESS / Loading plugins…」，两张截图间隔约 41 秒无变化，界面上看不到错误文字（`.test-data/mac-desktop-20261105/01-main-loading-plugins.png`、`02-final-loading-plugins.png`）。Host 进程空闲（CPU 0.1%），本次启动没有生成崩溃日志。
  - 现场发现：19:31 Desktop 报 `desktop welcome: Web RPC failed` 后走了宿主自带的崩溃恢复「禁用全部插件」（`disableAllPlugins` → `sanitizeProfile`）。`cordis.patch.yml` 被改名为 `cordis.patch.yml.bak-1793878278341`，`dsh.profile.bundles` 只剩 `dsh-base`、`dsh-web-app`，`dshmarket`、`dsh-cliworker-now`、`dsh-visible-dynamic-workflows` 都不再加载。19:35 新写入的补丁缺少书生 provider、默认模型、`cliworker-now`、`visible-dynamic-workflows` 与 `ui-settings-general` 条目。本会话的工具记录里没有点击该对话框的操作；19:04–19:06 的三次崩溃发生在插件仍为 rc.5 构建、仓库正在重建 runtime-host 期间。也就是说，CLI Worker 当前没有加载，而卡在 Loading plugins 发生在只剩官方 bundle 的情况下，原因未查明。恢复 profile 与读取渲染端控制台都需要用户授权。
  - Profile 恢复（用户 2026-11-05「Restore and check」）：先确认 3 分钟内无会话写入，经 AppleScript 正常退出（0 进程）。改前备份为 `cordis.patch.yml.bak-before-20261105-restore`、`package.json.bak-before-20261105-restore`。`cordis.patch.yml` 用 `.bak-1793878278341` 原样还原（逐字节一致）；`dsh.profile.bundles` 按 10-28 记录恢复为 `[dsh-base, dsh-web-app, dsh-visible-dynamic-workflows, dshmarket, dsh-cliworker-now]`。19:35 版补丁与恢复版相比，只多了 ui-chat 条目上与官方一致的 `name`，舍弃不影响功能。127.0.0.1 的 `dsh-auth-*` cookie 有 55 个、约 12 KB，未达 10-24／10-28 的 431 阈值，未清理。
  - 恢复后带 `--force-renderer-accessibility` 重启：5 个进程，没有新的崩溃日志，主界面正常加载。
  - 第二次（Codex gpt-6-astra high，只读）：控件树确认 CLI Worker 面板、agy-1 已完成任务、原生设置值与 CLI Worker 设置都正常。但 DSH 被其他窗口遮挡时窗口截图不刷新，这次截图不作为证据。
  - 第三次（Codex gpt-6-astra high，只读，每张截图前先把 DSH 窗口提到最前）：截图与控件树一致，主会话核对截图。`restore-v-03-worker-conversation.png`：agy-1 子会话两轮记录、代码块与文件链接正常，统计药丸显示「2 轮 6 步」「81.6K tok · 缓存命中 31%」「上下文」，无原始词条键；输入框是置灰的发送按钮，没有残留 Stop；无破图。`restore-v-04-native-settings.png`：通用设置各项有值（工作区内修改、中文、跟随系统、14 px、标准、回答结束后、全部回复），版本 0.2.2-rc.1。`restore-v-05-cliworker-settings.png`：CLI Worker 设置页与 12 个 CLI 连接列表正常，显示跟随 DSH、最高同时对话数 5、同目录写任务并行与调用前询问模型均开启。主会话默认模型已恢复为 GLM-5.3-Flash。
  - 未验证：药丸悬停提示（CU 无悬停能力）；运行中任务的鲸鱼动画图片（当时没有运行中的任务）；运行中的 Stop。
- [x] 4.3 未覆盖（如实保留）：Windows 插件安装与界面（Windows Desktop 已是 0.2.2-rc.1，插件仍为旧构建）；真实模型／CLI 派遣与续聊（未获本次授权）；六种新语言界面（插件词条暂用英文）；rc.5 宿主上的兼容回归（旧路径只有模拟测试覆盖）；上游四包 Vitest；悬停提示、运行中动画与 Stop。

## Workflow follow-up

- 全部必要任务与证据齐备后严格校验、同步规格并归档；否则保留活动 change。本次不 commit/push/publish。
