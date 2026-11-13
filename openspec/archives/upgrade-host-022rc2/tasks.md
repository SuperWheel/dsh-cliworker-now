# Tasks

## 1. 差异核对与 Desktop

- [x] 1.1 npm `next` = 0.2.2-rc.2（2026-11-12T02:16Z），`latest` 仍为 0.2.2-rc.1；cordis 依赖仍 `~4.1.0`。官方 tag `dsh-v0.2.2-rc.2` = `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`，是 rc.1 的后代（1568 个提交）。
- [x] 1.2 Mac Desktop 更新（用户 2026-11-12「先更新 rc2，之后再适配」）：更新源已迁到 `https://download.deepseek.com/dsh-desk/feeds/mac-arm64/nightly-mac.yml`（旧 `bin/mac-arm64/nightly-mac.yml` 返回 404），清单 Version 0.2.2-rc.2、releaseDate 2026-11-11T10:17:26Z、stagingPercentage 16。下载 `deepseek-harness-0.2.2-rc.2-mac-arm64.zip` 多次停滞，按用户要求「10 秒无增长即中断并续传」（curl `--speed-limit 1 --speed-time 10` + `-C -` 循环）第 6 次完成，362,753,775 字节，sha512 与清单一致；`codesign --verify --deep --strict` 通过，`spctl` 为 Notarized Developer ID（Hangzhou DeepSeek，NAN929V4UM，与旧版相同）。安装前 Host 无 CLI 子进程、CPU 0.1%、5 分钟内无会话写入；AppleScript 正常退出（0 进程），替换 `/Applications/DeepSeek Harness.app`（未备份），版本 0.2.2-rc.2。重启后 5 个进程，无新崩溃日志，未触发「禁用全部插件」；`profiles/desktop/package.json` 的 bundles 与 11-06 以来一致（dsh-base、dsh-web-app、dsh-experimental-auto-review、dsh-cliworker-now）。
- [x] 1.3 rc.1 插件构建在 rc.2 上的实机现象（内置浏览器直连 Host Web UI）：主界面、插件页（CLI Worker 已启用）、旧会话正文正常；控制台 `useAnchoredPosition is not a function`，`ContextMeter`（`conversation.composer.bar`）与 `useStatDialog`/`TurnUsagePanel`（`conversation.chat.node`）slot 崩溃；CLI Worker 面板打开后列表为空（会话显示 1 个子智能体）。
- [x] 1.4 rc.1 → rc.2 差异：全仓 4645 个文件；ui-session 2、ui-conversation 47、ui-subagent 15、ui-chat 49、ui-primitives 58 个文件；新依赖 dsh-session-projection（ui-conversation）、dsh-agent-team（ui-subagent），zod 4.6.6。
- [x] 1.5 Windows Desktop 更新（用户 2026-11-12「连接 Windows，把 Windows 上的 dsh 也更新到 rc2，然后测试一下 Windows 上的适配性」）。Windows IP 172.22.84.183，SSH 可连；更新前 DSH 0.2.2-rc.1，进程数 0。
  - C 盘只剩 0.02 GB（D 盘 291.77 GB），装不下 rc.2。用户批准清理四项（npm 缓存、DSH 更新器缓存、用户临时目录、旧远程测试副本）。先确认无进程占用：清空 `AppData\Local\npm-cache`（2.52 GB）、`@deepseek-aidsh-desktop-updater` 内容（0.54 GB）、`%TEMP%` 可删部分（0.45 GB）后 C 盘 3.54 GB；旧远程目录 `cliworker-now-remote` 只删 11 个过期测试副本与运行输出（agy-bridge-312e0ee7、attachments-9b79d895、cleanup-20261018、credits-hermes、npm-cache、qoder-metering、qodercn-20261019、settings-warm、usage-details、e2e-issue8、runs），保留 desktop-audit-20261010、tools、output 与脚本文件，C 盘 5.70 GB。
  - 2026-11-12 已完成 Windows Desktop 0.2.2-rc.1 → 0.2.2-rc.2 更新。SSH 实时 ED25519 指纹 `SHA256:eev5GJMmeGKlbTX/jyFGhiaMwGJyJxDMYbMpkyeAVkw` 与登记一致；安装前 DSH 0 进程、所属 CLI/node 子进程 0，无需退出或强杀。
  - 真实 `resources\app-update.yml` 指向的 Windows nightly 清单仍为 rc.1，初次检查因此受阻。用户随后明确决定「直接装，用签名校验」：只从官方 `https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-0.2.2-rc.2-win-x64.exe` 下载，以 **签名＋长度＋COS CRC** 替代缺失的官方清单 sha512。curl `-C - --speed-limit 1 --speed-time 10` 第 4 次完成，299,659,528 字节；CRC-64/XZ（反射 ECMA 多项式 `0xC96C5795D7870F42`、init/xorout 全 1）通过标准向量 `123456789 → 995DC9BBDF1939FA`，实际十进制 `689760880065028319` 与 COS 响应头相同。SHA256 `7e25286518ce520b5c0943e178c52cdba1cc9ec3680bc7da181b79879e080c32`，SHA512 记录于证据（本地审计摘要，无官方 SHA512 比对）。
  - Windows Authenticode Valid，证书指纹 `84032578657219876E273E0D1BD303CFE1B82E6F` 与已装 rc.1 完全一致；RFC3161 时间戳 2026-11-11T10:26:17Z，token 签名、对安装包 Authenticode 签名的摘要绑定、DigiCert 时间戳证书在签署时刻的在线吊销/可信链与 TSA 用途校验均通过。再次核对哈希、签名及零进程后，NSIS `/S /currentuser` 退出码 0（62.95 秒），覆盖原用户级目录；安装及最终独立读回的 exe FileVersion、HKCU DisplayVersion 均为 0.2.2-rc.2，已装签名 Valid。
  - 经 Interactive/Limited 计划任务带 `--force-renderer-accessibility` 启动：5 个进程均在 admin 交互会话 32（SSH 为 0），主窗口 197774 可响应。按用户允许缩短观察至 3 分钟，实际 199.35 秒后主 PID 26192 未变、窗口仍响应、5 个进程仍在会话 32；Application Error/Hang 1000/1002 查询成功、DSH 相关事件 0。未进行 10 分钟观察、UI 内容或插件适配验收。
  - Mac 下载包与 Windows D 盘本次安装包均已删除；本次创建的 2 个临时计划任务均已删除，剩余 0；仅保留本次探针/审计证据，未删除其他远程文件。C 盘空闲本轮更新前 6,124,498,944 字节（5.70 GiB）、后 5,872,992,256 字节（5.47 GiB）；D 盘最终 313,280,802,816 字节。未备份，未手动改 Windows `.dsh`，未装插件，未调用真实 CLI/模型，未 commit/push。证据：`.test-data/windows-remote/desktop-audit/update-dsh-022rc2-20261112.json`。
  - 本条仅完成 Desktop 更新；Windows CLI Worker 适配安装/验收另行处理。严格格式校验 `corepack pnpm spec validate upgrade-host-022rc2 --strict --no-interactive` 通过，不替代插件业务验收。

## 2. 重建四包

- [x] 2.1 （Codex gpt-6-astra high 实施，主会话抽查）由 rc.1 checkout 建 worktree `.cache/dsh-host-source-022rc2`，HEAD = `ddac9676…2b4c`（主会话复核）；rc.1 工作树未变。`git apply --3way` rc.1 的 48 文件补丁，10 个文件冲突并人工合并：ui-chat `ChatView.tsx`、`TurnUsagePanel.tsx`、`stat-dialog.module.css`、`index.ts`、`chat-view.client.spec.tsx`；ui-conversation `contract/slots.ts`、`ContextMeter.tsx`、`ConversationContent.tsx`、`InputBar.tsx`、`input-bar.client.spec.tsx`。保留官方 CSS anchor、Retry、文件接收与子会话直接输入行为，追加插件外部回答、用量与输入框扩展。导出 48 文件补丁，SHA256 `f4e0b865…32b4`（主会话复核）。合并决定见 `host-extensions/dsh-0.2.2-rc.2/README.md`。
  - 未执行：上游四包 Vitest。
- [x] 2.2 独立依赖 `.cache/dsh-host-build-deps-022rc2`（store `.cache/dsh-host-pnpm-store-022rc2`）`install --ignore-scripts --frozen-lockfile` 成功；依赖链接清单 864 行，`--prepare-links` 通过；`check-client-types` 四包均 0。`build-host-extension.mjs` 的 rc.2 目标改从独立依赖目录加载构建工具，旧目标路径不变。
- [x] 2.3 构建与 `--verify` 通过（630 个文件）；rc.1 目标 `--verify` 仍通过。
- [x] 2.4 vendor `runtime-host/` 4 包、217 个文件，均为 0.2.2-rc.2（主会话复核 package.json），无参数复核通过；`runtime-host` 中无 `useAnchoredPosition`/`AnchoredPositionOptions`（主会话 grep 复核），不含 src/map，保留 ui-chat `./assets/*`；鲸鱼图片与 202 个 Host/声明文件与官方 npm 包逐字节一致。审计见 `artifacts/dsh-host-rebuild-022rc2/audit.json`。

## 3. 插件

- [x] 3.1 （Codex gpt-6.1-sol high）开发 SDK 39 个 pin 改为 0.2.2-rc.2，cordis devDep/peer 与插件版本不变；workspace 例外由 300 条换成 339 条（含安装补入的 39 条 rc.2 必要例外，已对照锁文件）；`build-dependencies.mjs` 加 `.cache/cliworker-build-deps-022rc2`。`pnpm install --ignore-scripts --config.confirmModulesPurge=false` 重生锁（首次因无 TTY 报 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`）：锁中无 rc.1 SDK 残留；第三方无包名增删，`@deepseek-ai/libreoffice-kit` 及 5 个平台包 0.1.5→0.2.3，zod 根依赖仍 4.4.3、新增传递版本 4.6.6。`pnpm peers check` 报 schemastery 3.18.5 不满足 dsh-settings 的 ~3.19.0，rc.1 已有。
  - 类型检查：Host 13 条、Client 3 条错误，均为 rc.2 API 变化（`SubagentRuntime.listChildren` 删除、`SubagentPromptRequest` 去掉 `parentSessionId`/`mode`、`interruptByParent`→`interruptByUser`、`AgentRegistry.isOwnedBy` 删除、`Menu.getAnchorRect`→`anchorRef`/`anchorPoint`、ui-primitives 删除 `useAnchoredPosition`——插件自身 `stat-popover.tsx` 也引用）。原始报告存 `artifacts/sdk-upgrade-022rc2-report.md`。
- [x] 3.2 Host/Client rc.2 接口适配（Codex gpt-6-astra high 实施，主会话审查与复跑）。每处替换在上游源码中有依据：
  - `listChildren` 删除 → `readDshChildren` 读取公开 `subagentCatalog` 投影（上游 `list-children.ts`，删除提交 `86d4c75516`；rc.1 的 `listChildren` 本就是同一投影的薄封装）。
  - `SubagentPromptRequest` 去掉 `parentSessionId`/`mode` → 按 rc.2 字段传入，父会话约束留在插件侧核对目录、lineage 与 live ownership（`ea009821d6`）。
  - `interruptByParent` → `interruptByUser`，补目标 Session 授权；停止仍等待结束投影，不凭 `accepted` 报成功（`ea009821d6`）。
  - `AgentRegistry.isOwnedBy` 删除 → 新增 `src/host/native-subagent-ownership.ts` 的 `ownsDirectSubagent`：直系 header（`origin === 'subagent'` 且 `parentSession === parent.id`）+ 上游 `SubagentManager.rootOf`（要求 exact live caller，无运行所有者即抛 UNAUTHORIZED）对父与子都返回父（`b3d4933f39`、`27716078ef`）。主会话核对上游 `manager.ts:509` 后认为不弱于原校验。冷会话（子 Agent 不在线）由 DSH 目录 lineage 校验，插件侧不另查。
  - 旧桥能力检测依赖已删除的 `drainChildren` 会拒绝 rc.2，已修；`startActivation` 参数展平（`575606a356`）。
  - Client：Menu 右键用 `anchorPoint`、键盘用 `anchorRef`；`stat-popover` 改官方 CSS anchor（`2c990f0b14`）。
  - 空列表调查（主会话实机查明）：面板与主视图都绑定 `session-0a42370f`，Worker `ddb9fe71` 已于 11-11 19:07 被 v0.8.9 换段归并到新段 `2f1955e3`（`formerParentSessionIds` 含 0a42370f），旧段 CLI Worker 分组为空属设计行为，非 rc.2 回归。
  - 另见 3.5：旧段 DSH 分组把该 Worker 换段前的内部 Harness 子会话 `c6e39cf7`（label `worker/ddb9fe71…`）列为 dsh-1。
- [x] 3.5 修复换段后旧内部会话混入 DSH 列表（Codex gpt-6.1-sol high 实施，主会话审查）：实际换内部会话的路径是 `HarnessConversationBridge.ensure()` → `create()` → `replaceWorkerBinding()`，旧 ID 已持久化在现有可选字段 `retiredSessionIds`（上限 64），复用而不新增字段。`src/host/dsh-subagents.ts` 新增 `ownedHarnessSessions`（当前与 retired 内部会话）与集中判断 `isInternalSession`，另精确排除 label 为 `worker/<存储中已知 Worker ID>`（含其他父段与已归档）的目录条目，列表、命名、单条读取与操作共用；未知 ID 或相似标签仍显示。不改 `~/.dsh`，已误分配的 dsh-names 条目保留原样、只是不再显示。新增/更新 `tests/dsh-subagents.test.ts`、`tests/parent-lineage.test.ts`、`tests/harness-conversation-store.test.ts`。Codex 报告：typecheck 通过，相关 208 项通过，全量 6227 通过、14 跳过、0 失败（沙箱外）。
  - 主会话复跑全量两次（沙箱外，`--maxWorkers=2`）：第一次 6226 通过、1 失败、14 跳过（输出被 `tail` 截断，失败用例未能识别）；第二次 6227 通过、14 跳过、0 失败。记为未识别的偶发失败。
  - 实机复核（主会话，`pnpm build` 后命令行启动）：旧段「用 CLI Worker 指挥 TRAE 创建文件」的面板不再显示 dsh-1，显示空状态（Worker 已在新段）。
- [x] 3.3 主会话复跑（依赖已用默认 store `--frozen-lockfile` 重装，package.json/workspace/锁逐字节不变）：`pnpm typecheck` 通过（against DSH 0.2.2-rc.2）；全量 `vitest run --maxWorkers=2`（沙箱外）283 个文件通过、4 个跳过，6222 项通过、14 项跳过、0 失败。`pnpm build:preview` 首次失败：rc.2 typert 生成器要求 `files` 含 `lib/typert.remote-client.d.ts.map`（`TypertAnalysisError … package files must include lib/typert.remote-client.d.ts.map`），根 `package.json` `files` 补该项后预览包构建成功并产出该 map；`build-dependencies`、`host-runtime-package`、`windows-remote` 三测试 54 项通过。
  - 测试契约（Codex gpt-6.1-sol high 已改 `tests/build-dependencies.test.ts`、`tests/host-runtime-package.test.ts`、`tests/clean.test.ts`：rc.2 隔离图、未支持目标改 rc.3、SDK pin、来源 commit `ddac9676…`、022rc2 缓存保护；`clean.mjs` 按 SDK pin 动态生成标签，无需改脚本；三文件 35 项通过）。注意：3.1 安装时用了 `/private/tmp/...` 临时 store，`node_modules/.modules.yaml` 的 storeDir 指向它，之后 pnpm 运行前检查会要求重建 modules 目录，需用默认 store 重装一次；`pnpm typecheck`、全量 vitest、`pnpm build:preview`。
- [x] 3.4 文档（Codex gpt-6.1-sol high，主会话抽查 README 与 design 新增段）：README 中英宿主版本行与验证范围、`doc/native-conversation-host-extension.md` 开头、`doc/design.md` 新增 2026-11-12 一节；`host-extensions/dsh-0.2.2-rc.2/README.md` 由 2.1 生成；AGENTS.md 未改（其中只有历史发布描述）。原范围：README（中英）、`doc/native-conversation-host-extension.md`、`doc/design.md`、`host-extensions/dsh-0.2.2-rc.2/README.md`、AGENTS.md 宿主版本描述（如有）。

## 4. 安装与界面

- [x] 4.1 Host 无子进程、CPU 0.1%、3 分钟内无会话写入；AppleScript 正常退出（0 进程）后 `pnpm build`（19:11），命令行启动 Desktop，启动输出无插件、runtime-host 或 slot 错误。
- [x] 4.2 Mac 界面核对（内置浏览器直连 Host Web UI，主会话操作）：
  - 通过：rc.1 构建时缺失的输入栏与统计药丸恢复（「3 轮 6 步」「127K tok」「缓存命中 83%」、上下文 2%）；控制台不再有 `useAnchoredPosition` 与 slot 崩溃，只剩与插件无关的 `[deepseek-account] account read failed {field: profile}`。
  - 通过：「换段测试新会话准备」的 CLI Worker 面板显示 TRAE CN 分组 `traecn-1`（Doubao-Seed-Code）；Worker 对话正文、代码块、续聊输入框（Seed-Code）与统计（33.6K tok、上下文 7%）正常；CLI Worker 设置页加载，语言、最高同时对话数 5 与各开关为原值。
  - 通过：点击回答下方「用量 47.6K tok」展开本轮用量弹层（rc.1 构建时 `TurnUsagePanel` 即崩溃处），fixed 定位于药丸上方，显示 47,561 tok、提供方/模型、缓存命中 98.5%、未缓存输入、缓存读取与输出；Escape 关闭。
  - 观察：视口 1024 且两侧栏都打开时，主对话列宽 400、内容宽 570，可被横向滚动（DSH 同时提示「栏宽不足」），弹层关闭后依旧，属官方窄宽布局，与插件无关。
  - 通过：3.5 修复后重新 `pnpm build`（Host 无子进程，正常退出），旧段 DSH 分组不再显示 Worker 内部会话。核对结束后退出命令行实例，以 `open -a` 正常启动（5 个进程），删除含 token 的启动日志。
  - 未验证：输入栏上下文用量弹层、运行中动画与 Stop（无运行中任务）。
- [x] 4.3 未覆盖（如实保留）：真实模型／CLI 派遣、续聊、审批、停止（未获本次授权）；运行中动画与 Stop；Worker 围栏代码块（Windows）；换段后旧段内部会话排除的 Windows 实机场景；rc.1 宿主上的兼容回归（兼容只声明 rc.2）；上游四包 Vitest；Mac 全量第一次的 1 个偶发失败未识别；Windows rc.2 安装包因官方清单仍为 rc.1，用签名+长度+CRC64 替代 sha512（用户决定）。

### 4.4 Windows 远程回归与正式插件安装（2026-11-12）

- [x] 4.4.1 远程隔离回归：`PATH=$PWD/.cache/bin:$PATH node scripts/windows-remote.mjs --config .test-data/windows-remote/config-d.json`，配置的 host 已为本轮已确认地址，沿用已验证 SSH 指纹，remoteRoot 位于 D 盘。Windows x64 / Node v24.15.0 / pnpm 11.25.0；冻结依赖安装、类型检查、21 个 Windows CI 测试文件、包成员检查与 Host 导入均通过，437 项通过、4 项跳过、0 失败；`success=true`、`cleanup.confirmed=true`、`cleanup.lockReleased=true`。
  - 4 项跳过均为源码明确的平台条件：CodeBuddy 的 POSIX 权限/符号链接与 macOS fallback、Pi 的 POSIX launcher、TRAE 的 macOS/Linux fallback。没有 rc.2 适配失败或 Windows 环境失败。
  - run ID：`4c65130a-3e1c-431c-822d-5250595ce304`；完整命令、日志、Vitest JSON 与远程 report 位于 `.test-data/windows-remote/runs/<run ID>/`。仅此矩阵，不是 Windows 全量 Vitest；账号/CLI 协议数据为模拟夹具，没有真实 CLI 或模型调用。
- [x] 4.4.2 `PATH=$PWD/.cache/bin:$PATH corepack pnpm build:preview` 成功；在 `.cache/preview-package` 执行 `corepack pnpm --config.verifyDepsBeforeRun=false pack --out <候选包>`。候选包 `preview-022rc2-20261112-202031.tgz`，SHA256 `f59e0898194fd42bff5dd005d285bf9e109c4ee12e8962a5c66d5dba0fcc2942`，与远程回归所测 tgz 完全一致；从实际 tgz 生成 828 个 lib 文件的 SHA256 清单。实际包 1052 个文件，无私人/审计成员，四个 runtime-host 均 0.2.2-rc.2。
  - 自用包成员审计的首次白名单遗漏正常 `package/icon.png`，报 `AssertionError: ['package/icon.png']`；核对发布文件后补入审计白名单，再检查通过。属于本次审计脚本遗漏，未改包或产品代码。
- [x] 4.4.3 安装前重新核验：activeWorkers=0、workerReadErrors=0、DSH 非 Harness 子进程=0、近 3 分钟会话写入=0；经 Interactive/Limited 计划任务调用 `quit-harness.ps1`，`quitRequested=true`，再独立确认 Harness 进程=0。调用原生 `dsh.cmd plugin --profile desktop add --save-exact <已校验 tgz>`，退出码 0；828 个已安装 lib 文件逐一匹配、总数一致，`lib/index.js` SHA256 `3966f8fb597bab584c51118d1db0b25efed659ec513d9450de2fc39ef7488f8c`，四个 runtime-host 安装后读回均为 0.2.2-rc.2；插件版本仍 0.8.9。
  - 保留旧候选包 `preview-089-20261111-185643.tgz` 及清单供原生安装器回滚，SHA256 `7d50a44c67e574f34fdf6fc609a486896471c5b437d723f57e9b2a7f0fb5807b`；本轮安装前确认旧安装 825 个 lib 文件与其清单一致，Mac/Windows 回滚包哈希一致。未执行回滚。
- [x] 4.4.4 经 Interactive/Limited 计划任务带 `--force-renderer-accessibility` 正常启动；5 个进程均在交互会话 32，主进程 PID 16096。最终观察 196.40 秒后主 PID 未变，Application Error/Hang 1000/1002 查询成功、DSH 事件 0；独立读回 828 个 lib 文件无哈希差异。profile bundles 仍含 `dsh-cliworker-now`，`cordis.yml` 与 `cordis.patch.yml` 哈希均与安装前一致，仅保留原有历史 `.bak`、未新增，未触发「禁用全部插件」。
  - 最终 activeWorkers=0、workerReadErrors=0、账号 ready scope/owner/auth 进程=0、observerTasks/Launchers=0、本轮 UI 计划任务=0、调试参数进程=0；DSH 保持运行。按精确归属删除本轮 12 个远程临时脚本/回执，以及本轮 UUID 的隔离源码、依赖与缓存，保留测试 report、Vitest JSON、日志且证据哈希不变；候选 tgz、清单、安装日志/回执与旧回滚包均保留。C 盘最终空闲 5,839,134,720 字节，依赖与候选包均置于 D 盘。
  - 汇总证据：`.test-data/windows-remote/desktop-audit/install-plugin-022rc2-20261112.json`。严格校验 `PATH=$PWD/.cache/bin:$PATH corepack pnpm spec validate upgrade-host-022rc2 --strict --no-interactive` 通过；未归档未完成 change。本任务未改 src、tests、package.json、锁文件或 runtime-host，未调用真实 CLI/模型，未 commit/push。
- [x] 4.4.5 Windows 界面只读核对（Codex gpt-6.1-sol high，Windows Computer Use；未发送消息、未派遣、未改设置或账号；27 张截图与 REPORT.md 在 `.test-data/windows-remote/desktop-audit/ui-022rc2-20261112/`，主会话查看了 05、24 号截图）：
  - 关于面板版本 V0.2.2-rc.2；主界面无白屏或加载卡住，插件开关为启用。
  - 「换段测试新会话已就绪」（live-codex）：输入栏与统计药丸「4 轮 6 步」「90.2K tok」「缓存命中 97%」「上下文 2%」；回答下方用量弹层显示 16,156 tok、`zai-coding-cn/glm-5.3`、缓存命中 97% 等，输入栏上下文用量弹层也能展开，均 Escape 关闭。rc.1 构建的崩溃未复现。
  - CLI Worker 面板：新段 TRAE CN 分组 `rc089-trae`（Doubao-Seed-Code）卡片、对话正文、续聊框与统计正常；旧段为空状态（Worker 已换段，设计行为）。右键卡片菜单贴近鼠标位置展开（`anchorPoint`），Escape 关闭。CLI Worker 设置页各值与 17 项 CLI 连接导航正常。
  - 5 个历史会话的面板均未出现 DSH 分组或 `worker/<ID>` 条目（未覆盖“换段后旧段有内部会话”的完整场景）。
  - 控制台 2 条 `dsh-app://app/plugins/events:1 Failed to load resource: net::ERR_FAILED`：主会话核对 `/plugins/events` 是官方插件热更新事件流（官方包 `EVENTS_ENDPOINT`，注释说明 Host 重启期间注册路由前会返回非 200），插件代码不引用该路径，判断与插件无关。无 `useAnchoredPosition` 错误。
  - 未验证：Worker 围栏代码块（所查回复为普通文本）、运行中动画与 Stop、真实账号/CLI/模型行为。

## Workflow follow-up

- 全部必要任务与证据齐备后严格校验、同步规格并归档；否则保留活动 change。本次不 commit/push/publish。
