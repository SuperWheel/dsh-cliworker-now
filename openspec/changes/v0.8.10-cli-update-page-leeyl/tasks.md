## 1. 共享协议与来源清单 〔后端｜6h〕
- [x] 1.1 新增 `src/shared/cli-management.ts`：分区、原因码、版本信息、计划、操作快照、下载进度、下载源设置的类型与 zod schema
  - 共享文件只放类型、常量与 `customRegistryProblem()`（前后端共用的自定义地址校验）；zod schema 放在 Host（`cache.ts`、`versions.ts`），客户端对 Host 返回值做基本形状校验。typecheck 通过（2026-11-13）。
- [x] 1.2 新增 `src/host/cli-management/sources.ts`：17 个 CLI 的包名、发布源、自带更新命令、默认安装位置、前置条件、兼容范围、版本读取方式与后台可用标记（按 PRD 5.3 表，待核实项不开放自动方法）
  - Phase A：`sources.ts` 明列 17 个 CLI、npm / 已核实的 brew 名称、官方说明、更新 argv（仅描述）、安装位置、前置条件、兼容范围与后台标记；未核实方法保留 manual。`corepack pnpm vitest run tests/cli-management.test.ts tests/cli-management-remotes.test.ts tests/general-settings.test.ts tests/cli-settings.test.ts tests/accounts.test.ts`：5 文件、400 项通过（2026-11-13；CLI / HTTP 均为模拟夹具）。
- [x] 1.3 来源核实：Gateway 能否区分设置页与 Agent 调用（PRD 第九节第 15 条）
  - 2026-11-14 核对锁定 SDK 0.2.2-rc.3 源码：`node_modules/@deepseek-ai/dsh-typert-protocol/src/types.ts:454–478,498–512` 只提供连接主体 principal、Peer 和方法参数，没有可信的设置页点击/Agent 来源；`dsh-api-gateway/src/index.ts:798–855` 根据 Peer 授权并把 invocation 绑定到 Context，未注入 UI 来源；`dsh-typert-protocol/src/principal.ts:16–18` 将 owner 与受信进程内调用同视为无非 owner 主体。不能用 owner、parentSessionId 或客户端字符串冒充用户点击。
  - 替代保护已核对：`src/host/index.ts:1676–1941` 只向 Agent 注册 7 个 Worker 工具；安装/更新/取消/下载设置只在 `index.ts:2365–2437` 的设置 Remote 注册。新增 `tests/cli-management-remotes.test.ts` 实际执行 registerTools 并核对完整工具清单，防止误投影；5 项模拟通过（/tmp/gaps-remotes.log）。本勾选表示来源核实和替代边界已完成，不表示 Gateway 能证明“用户点击”；同机受信代码仍可直接调用 Remote。

## 2. 版本检查、安装来源识别与缓存 〔后端｜10h｜前置 1〕
- [x] 2.1 安装来源识别：真实路径、npm 前缀与包名、Homebrew 元数据、官方布局、桌面托管、手动类管理器
  - Phase A：`identity.ts` 复用现有路径记录和 `resolveCliExecutable`，读取真实路径、npm 白名单、brew tap receipt、官方布局和手动类管理器；复用 Pi / WorkBuddy 安装读取。正反例、符号链接与应用版本指纹见上述 400 项通过记录。
- [x] 2.2 当前版本读取（有界子进程或清单，Kimi 带 `KIMI_CODE_NO_AUTO_UPDATE=1`）与 SemVer 比较、预发布通道、适配范围（Pi 白名单、OpenCode V1）
  - Phase A：有界读取 5 秒、64 KiB 输出上限、UTF-8 解码、退出范围确认；Kimi 注入 `KIMI_CODE_NO_AUTO_UPDATE=1`，TRAE 复用身份检查；未证实安全的读法返回版本未知。SemVer、预发布、Pi 白名单及 OpenCode V1 测试通过；没有执行本机真实 CLI 的 `--version`。
- [x] 2.3 官方发布源查询：8 秒超时、3 并发、512 KiB 上限、不带凭据、按下载源与官方源核对
  - Phase A：沿用 `hostFetch` 和系统代理；每请求 8 秒、全局 3 并发、512 KiB、omit credentials、拒绝重定向；npm dist-tags / versions 与 Homebrew API；镜像结果向官方核对，官方不可达时保留所选源出处。HTTP 模拟测试通过；npm 路径解析和 config get registry 子进程共用 5 秒上限。
- [x] 2.4 分层缓存：路径与归属长期、版本按文件指纹、最新版本 6 小时、账号状态 10 分钟与项目区分；目录 0700、文件 0600，损坏即丢弃
  - Phase A：`stateDirectory/cli-management/state-<平台>-<机器哈希>.json`；zod 严格校验、损坏整份丢弃、atomicJSON、0700/0600；版本按指纹、发布源 6 小时、账号 10 分钟与项目哈希。账号只落盘显示字段，不存输出、凭据或操作句柄；accountStatus 缓存附 cache.checkedAt / stale / displayOnly，缓存 actions 为空，前端需接 refreshAccountStatus 原地重读及恢复操作句柄；损坏、权限、TTL、源切换和失效防回写测试通过。
- [x] 2.5 Remote：`cliUpdateSnapshot`、`checkCliUpdates`（missing / all）、`watchCliUpdates`，接入插件生命周期
  - Phase A：六个页面 / 下载源 Remote 已注册，参数顺序与 `workers.ts` 对齐；watch 按 revision，snapshot 不探测，check 立即返回、30 秒截止、取消后等待所有并发读取清理。Host / Client `corepack pnpm typecheck` 通过（DSH 0.2.2-rc.2），Remote 模拟测试通过。
- [x] 2.6 单元测试：来源识别正反例、版本比较、指纹失效、缓存损坏、只读快照不启动探测
  - Phase A：新增 `tests/cli-management.test.ts`、`tests/cli-management-remotes.test.ts`；来源、版本、指纹、缓存、网络、只读快照、Remote、账号缓存等纳入上述 400 项回归。
- [x] 2.7 修复阶段 A 审查（Codex 审查，2026-11-13）报告的 Host 问题
  - P1 `service.ts`：`npm config get registry` 清理未确认后预加载与前台仍会再起 npm 进程，须立即停止后续探测。
  - P2 `service.ts`：启动器指纹不变而清单版本已变时仍用旧缓存版本，须把清单纳入缓存身份或优先用新读出的清单版本。
  - P2 `identity.ts`：自动记录的路径失效后前台检查不重找，误报未安装；前台检查须复用 `resolveCliExecutable` 的失效路径恢复，后台仍只读文件。
  - P2 `service.ts`：旧 `manual` 分组在安装归属变成可识别的 npm 后仍保留，发布源查询被永久跳过；须按新身份重算。
  - Phase B（2026-11-13）已修：registry 探测 single-flight，清理未确认立即停止后续探测并调用既有全局 cleanup 隔离；指纹加入清单版本且不沿用与当前清单冲突的缓存；失效自动路径前台复用 resolver 重找；manual → npm 重新计算分组。
  - 模拟回归：`corepack pnpm vitest run tests/cli-management-phase-b.test.ts tests/cli-management-download.test.ts tests/cli-management-admission.test.ts`：3 文件 40 项通过（包含四项审查回归和并发 registry 清理失败）；`corepack pnpm typecheck` 通过。

- [x] 2.8 实机发现：packument 超限、前台 --version
  - 发布源查询改为 `GET <registry>/-/package/<编码包名>/dist-tags`；普通 JSON 保留 512 KiB、8 秒和全局 3 并发。仅 Pi/OpenCode 等 compatibility 非 any 且 latest 不兼容时请求 `<registry>/<编码包名>` 的版本列表，专用 32 MiB 上限同时检查 Content-Length 和流式累计字节；依据为用户提供的 OpenCode 14.7 MB 实测大小，保留有界增长空间。latest 兼容时不拉 packument。
  - 镜像与官方核对/回退顺序不变；integrity()/artifact() 仍读取小型 `<pkg>/<version>`，保持 512 KiB。ReleaseRecord/cache schema 不变，新的版本列表只缓存 latest 与最高兼容正式/预发布候选；原有缓存可直接使用，无须迁移，原有严格格式校验/损坏丢弃与 0700/0600 不变。
  - `currentVersion` 先读清单，缺版本时前台按实际 InstallationIdentity.executable 运行 --version：argv 数组、stdin ignore、5 秒、64 KiB 输出上限、去 ANSI、首个完整合法 SemVer；取消/超时经 bounded 进入整个进程范围清理，未确认则隔离。Kimi 一律 KIMI_CODE_NO_AUTO_UPDATE=1。安装/更新核对与页面检查共用此函数；Windows 继续走 nativeProcessBackend/nativeLaunchArgv，不添加 cmd /c 或拼接命令。
  - sources 数据按本次用户提供的实机观察控制后台：Antigravity、Claude、Kimi、MiMo、Grok、OMP、Pi、OpenCode、CodeBuddy、TRAE 可运行版本命令；Codex、Qoder/CN 仅前台；Hermes 前后台均不运行，明确说明超时及写租约，且不被重新安装说明覆盖；ZCode/WorkBuddy 两版沿用清单文件。版本或无 SemVer 结果按指纹复用，指纹变化才再读；后台跳过不写负缓存，首次前台仍可探测。
  - Codex `~/.codex/packages/standalone/` 按完整路径组件识别为 official-installer，sources 无 update，因此保持手动更新。Claude cask 用模拟 --version 读到当前版本后可进入 updatable，planner 生成 `brew upgrade --cask claude-code` argv；未执行 brew。首次安装方法保持原状态，不因本次版本检查修复重新开放脚本。
  - 新增 `tests/cli-management-live-regression.test.ts`（42 项模拟）：dist-tags、兼容回退、大响应拒绝/超时、17 CLI 前后台策略、清单优先、ANSI/SemVer、超时等待与隔离、缓存、Codex 来源正反例、Claude cask 从检查到计划、Windows cmd 安全启动；安装测试另加 Hermes 说明不被覆盖回归。更新旧 HTTP 夹具为 dist-tags 响应。
  - `corepack pnpm typecheck`：初轮及 Hermes 说明补充后的最终复核均通过，Host/Client against DSH 0.2.2-rc.2，退出码 0。
  - `corepack pnpm vitest run tests/cli-management-live-regression.test.ts tests/cli-management.test.ts tests/cli-management-phase-b.test.ts tests/cli-management-review.test.ts tests/cli-management-install.test.ts tests/cli-management-desktop.test.ts tests/cli-management-admission.test.ts tests/cli-management-download.test.ts tests/cli-management-directory.test.ts tests/cli-management-remotes.test.ts tests/cli-settings.test.ts tests/accounts.test.ts tests/native-launch.test.ts tests/cleanup-persistence.test.ts tests/windows-cli-resolution.test.ts`：15 文件 603 项通过（21:30:35，11.4 秒，退出码 0）。Hermes 说明补充后 `corepack pnpm vitest run tests/cli-management-live-regression.test.ts tests/cli-management-install.test.ts`：2 文件 66 项通过（21:32:26，1.76 秒，退出码 0）。
  - 首轮沙箱外 `corepack pnpm vitest run`：1 文件失败、297 通过、4 跳过（302）；1 项失败、6519 通过、14 跳过（6534），72.62 秒，退出码 1。唯一失败是 Hermes 说明回归，该轮启动后才补入最终修复/测试，不能作为稳定最终代码验收。最终代码沙箱外重跑（2026-11-13 21:33:24，74.62 秒，退出码 0）：**Test Files 298 passed | 4 skipped (302)；Tests 6520 passed | 14 skipped (6534)**，无失败或未处理错误。
  - `corepack pnpm build:preview`：首次及最终代码复核均通过，退出码 0，产物 `.cache/preview-package`；未改正式安装链接。只有现有 CommonJS/依赖打包提示。严格规格首轮因 Requirement 正文超过 500 字警告失败，拆分版本读取与发布请求两个 Requirement 后 `corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict` valid（退出码 0）。
  - `/Library/Developer/CommandLineTools/usr/bin/git diff --check`：通过；指定 Git 的 `diff -- src/client src/shared/cli-management.ts` 无差异。共享协议无新增字段，Remote 签名不变。
  - 本轮仅使用模拟 HTTP/CLI/退出回执，没有访问外网、运行真实 CLI/npm/brew、提交 Git或修改 Client；用户提供的实机证据不在此重复记为本轮执行，7.3 保持不动。
  - 2026-11-13 来源复测修复：Qoder/CN 只将 home 下精确的 `.qoder/entry/qoder` / `.qoder-cn/entry/qodercn` 识别为 self-update，不放行其他 entry 名字；Grok 仅在记录入口为 `.grok/bin/grok` 且 realpath 位于 `.grok/downloads/` 时补认 self-update，仍因 NO_RELEASE_SOURCE 归手动。静态核对 Client 既有标签使用 CLI_LABELS，实际文案为「Grok Build 自带更新」。没有修改 Client 或共享协议，Remote 签名不变。
  - Qoder/CN 计划和实际执行保持 `[记录入口, 'update']`、cwd=homedir。executor 在 spawn 前 lstat 检查 homedir/update，存在文件、目录、断链或检查失败即报 PREREQUISITE_MISSING 并零启动；指向分发器的别名同样受保护，直接 qodercli 实体不套该限制。选择预检拒绝而非猜测 PATH 中的 qodercli，避免改变用户实际入口；不删除用户路径。外部进程在预检后并发创建路径的竞态无法原子排除，已写入设计边界。
  - 新增 `tests/cli-management-source-layouts.test.ts`：20 项「模拟」覆盖真实文件夹具的双分发脚本、Grok 符号链接、完整路径反例、Qoder/CN 从检查到 updatable/计划/argv 执行、同名路径拒绝和别名；所有 spawn/HTTP 均为模拟，不运行脚本。
  - 本次 `corepack pnpm typecheck`：Host/Client against DSH 0.2.2-rc.2 通过，退出码 0。初轮关联 5 文件 178 项通过；补齐直接实体回归后执行 `corepack pnpm vitest run tests/cli-management-source-layouts.test.ts tests/cli-management-live-regression.test.ts tests/cli-management-phase-b.test.ts tests/cli-management-review.test.ts tests/cli-management.test.ts tests/cli-management-install.test.ts tests/cli-management-desktop.test.ts tests/cli-management-admission.test.ts tests/native-launch.test.ts tests/windows-cli-resolution.test.ts`：**10 文件 281 项通过**（21:47:22，1.94 秒，退出码 0）。
  - 本次 `corepack pnpm build:preview`：隔离包 `.cache/preview-package` 构建成功，退出码 0；只有既有 CommonJS/依赖打包提示。`corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict` valid，退出码 0；指定 Git 的 `diff --check` 通过，`diff -- src/client src/shared/cli-management.ts` 无差异。仅本地模拟验证，不访问外网、不运行真实 CLI、不提交 Git，7.3 不改。
  - 来源修复首轮沙箱外 `corepack pnpm vitest run`（21:47:49，86.12 秒）：**Test Files 299 passed | 4 skipped (303)；Tests 6540 passed | 14 skipped (6554)**；断言无失败，但有 1 个未处理 AbortError，退出码 1。来源为既有 `tests/hermes-renewal.test.ts`「退出 Nous 后服务商为 auto」的 `AccountManager.finish`/`confirmAccount` 引导清理链；本轮未修改账号源码。沙箱外单独复跑 `corepack pnpm vitest run tests/hermes-renewal.test.ts`：**1 文件 34 项通过**（21:49:31，1.08 秒，退出码 0），未再出现该错误。
  - 来源修复最终沙箱外 `corepack pnpm vitest run`（21:49:40，94.87 秒）：**Test Files 299 passed | 4 skipped (303)；Tests 6540 passed | 14 skipped (6554)**，退出码 0，无失败或未处理错误。两轮之间未改业务代码或测试；首轮账号引导 AbortError 的偶发根因不在本次来源修复范围，未宣称已修复。

## 3. 后台预加载 〔后端｜6h｜前置 2〕
- [x] 3.1 启动 60 秒延迟、空闲判定（无任务、无登录窗口、无更新、CPU 忙碌低于 50%）、一次一项、间隔 2 秒、子进程降优先级
  - Phase A 已实现并通过模拟测试：60 秒延迟、2 秒 CPU 双采样、忙碌低于 50%、逐项读取与间隔、可取消定时器、私有启动器对子进程调用 os.setPriority；只读取已记录路径，不后台搜索。
  - 2026-11-14 任务 12 补齐第五类的安全子集：ZCode 本地配置/账号绑定 + GET 模型目录，强度随目录取得；其余原生目录按决定 12 的逐 CLI 审计留在前台（建会话、续期、MiMo refresh 或无副作用证据不足）。本项完成的是安全调度接线，不代表所有 CLI 均能后台探测。
  - 任务 12 将本地投影扩展到 MiMo、CodeBuddy、ZCode、Grok、OMP、Pi、OpenCode；禁止退回 PATH / 注册表 / 原生身份探测，Pi/OMP 不做原生 provider 发现，过期但可续期的 OAuth 不显示已登录。其余 CLI 原因见决定 12。
- [x] 3.2 派遣、账号窗口、更新时暂停并确认子进程退出，空闲 30 秒后从断点继续；页面打开时切前台并复用结果
  - Phase A：runtime 与账号 reservation 发出通知；当前项 abort 后等待退出，30 秒空闲后重试；页面接管等待当前读取完成，复用版本 / 发布源 / 安全账号缓存，剩余页面检查并发执行。模拟暂停、CPU 采样中接管、并发清理等待、账号队列接管测试通过；实际更新操作的准入接线由阶段 B 的 4.2 继续。
- [x] 3.3 通用页开关「启动后在后台检查 CLI」（默认开）接入 `generalSettings`
  - Phase A：`GeneralSettings.backgroundCliCheck: boolean` 默认 true，Host 读取、保存、nullable 恢复默认与 schema 接入；general-settings 回归通过。前端开关由主会话负责。
- [x] 3.4 单元测试：延迟、空闲判定、暂停与继续、指纹不变不启动进程、开关关闭、插件停用清理
  - Phase A：启动延迟、CPU / Worker / 账号 / 操作忙闲、开关关闭、暂停继续、指纹复用、停用清理模拟测试通过。`corepack pnpm vitest run tests/native-process.test.ts` 首次沙箱内因 `/bin/ps EPERM` 失败，批准沙箱外重跑后 1 项通过；这是 Node 夹具进程范围验收，不是实际 CLI / Windows 验收。

## 4. 更新执行、维护锁与停滞续传 〔后端｜14h｜前置 2〕
- [x] 4.1 计划与指纹：`planCliOperation`、开始前重算指纹、受控方法 ID、requestId 幂等
  - Phase B：`planner.ts` 在 Host 内按来源与归属选择 npm / brew / self-update；token 含平台、动作、安装身份、版本、目标和下载源；执行前重算两次，变化返回 PLAN_EXPIRED；单次与批次 requestId 分开命名空间，重复请求不再启动。新增五个 Remote 与 `workers.ts` 的参数顺序一致，install 明确返回「首次安装尚未支持」。
  - 模拟：计划过期四种变化、幂等、批次顺序与取消排队、Remote 返回值及参数约束通过。相关 9 文件 439 项命令见 4.7；后续 3 文件 40 项复核通过。
- [x] 4.2 维护锁：同步准入，接入派遣、续聊、账号、模型目录、路径修改；有任务时拒绝更新
  - Phase B：`maintenance.ts` 同步检查 runtime busyWorkers、账号窗口/状态查询和在途读取租约后立刻上锁。`RuntimeConfig.cliMaintenance` 由同一 Host 实例共享；运行时 assertCliEnabled / assertAccountIdle、AccountManager start / status / reservation、Host 模型与账号绑定查询、路径读写接入。统一错误为「MAINTENANCE：<CLI> 正在更新，请等待更新或取消清理完成」；更新被占用拒绝为 CLI_BUSY，Remote 错误数据含 busyWorkers。
  - 模拟：派遣、续聊、待受理、账号、模型目录、路径修改拒绝；已有异步账号读取阻止中途更新；其他 CLI 不受影响；预加载 abort 当前项并等清理；cleanup marker 跨 Runtime 重启及明确确认后的解锁通过。
- [x] 4.3 执行器：npm（同前缀、精确版本、`--registry`）、Homebrew、CLI 自带更新命令；输出去 ANSI、脱敏、32 KiB 尾部；进程树取消后才报告已取消
  - Phase B 审查修订后：`executor.ts` 使用 ProcessBackend argv；独立解析 Node/npm 安装，原 CLI 前缀只传给 `--prefix`；Host 下载目标精确版本主包、按官方 sha512 验证后交给 npm 安装本地 tgz，并传所选 `--registry`。brew upgrade 使用受控名称；自带命令仅取 sources.update。Windows npm 直接以 `[node.exe, npm-cli.js, ...]` 启动，不解析或执行官方 npm.cmd，不经 cmd /c；其他 CLI 沿用 nativeLaunchArgv / nativeProcessBackend。安装阶段 10 分钟超时。
  - 本轮用户要求取代初版简报的精确包参数方案：官方源与镜像都由 Host 自行下载和验算主包，`integritySource` 固定官方源，主包字节进度 readable=true；镜像仅伪造 packument 摘要不能绕过实际文件校验。传递依赖仍由 npm 正常解析，风险边界已写入 design.md，不声称 Host 已独立校验所有依赖。
  - 模拟：完整行跨 chunk 脱敏 Authorization / Cookie / 令牌 / URL 凭据、ANSI 清理、UTF-8 32 KiB 尾部；取消与超时等待整个进程范围退出，未确认进入 cleanup-unconfirmed 并保留锁；窗口关闭后继续、停用等待清理通过。
- [x] 4.4 下载器：10 秒停滞、Range 续传（206/200/416）、200 次、2 小时、integrity 校验、临时文件 24 小时与 2 GB 上限
  - Phase B：`download.ts` 实现 10 秒无字节中断、206 起点校验后续写、200 截断重写、416 按长度核对后摘要验证；200 次重试与 2 小时总预算分别编码；sha512 / sha256 integrity 不符删片段，取消删片段；目录 0700 / 文件 0600；启动时及下载结束清理 24 小时或 2 GB 超限片段。
  - 模拟：`corepack pnpm vitest run tests/cli-management-download.test.ts tests/cli-management-directory.test.ts`：2 文件 15 项通过；覆盖持续每 9 秒实际写入字节仍达到两小时上限、201 个请求耗尽 200 次续传预算、Range 三状态、错误摘要、取消、缓存过期/容量。审查修订后已接管 npm 主包下载，另测超过准备阶段 30 秒的续传仍可安装；npm 依赖与 brew 下载仍由外部命令负责。（未执行：失败片段跨新操作复用及跨重启累计次数尚未实现，不声称已完成 PRD 全部恢复语义。）
- [x] 4.5 结果核对：重新解析路径与版本，等于目标才成功；版本未变、身份变化、清理未确认分开编码
  - Phase B：命令及进程范围退出确认后，重新解析安装身份、读取版本；只有目标版本一致才 succeeded，原版本、其他版本、实际路径或归属变化分别为 VERSION_UNCHANGED / VERSION_MISMATCH / IDENTITY_CHANGED。结果写 results；成功失效版本及模型目录缓存；未把 exit 0 当成成功。
  - 模拟：三种核对错误、成功的版本及缓存失效、退出未确认分支均通过。审查修订后 Homebrew 比较稳定前缀、formula/cask、启动器与包内入口，允许版本目录变化；其他身份变化仍拒绝。成功后刷新身份/版本缓存、重算分组并落盘，重启不会恢复虚高徽标。真实平台布局验收仍留在 7.3 / 7.5。
- [x] 4.6 下载源设置：四个选项、自定义 https 校验、连接检查、不改用户 npm 配置
  - Phase A：四个下载源选项按本机持久化，自定义 HTTPS / 无凭据 / 无查询参数校验，连接检查，`npm config get registry` argv 只读查询；不写 npmrc。下载源与 Remote 模拟测试通过；Phase B 更新已固定受理时的 registry 并通过 argv 传入；安装沿用第三阶段边界。
- [x] 4.7 单元测试：互斥、任务占用拒绝、更新期间拒绝派遣、取消与进程树退出、停滞续传与上限、Range 不支持、校验失败、输出截断与脱敏、窗口关闭后继续、插件停用清理
  - Phase B 新增测试均标注「模拟」：`cli-management-phase-b.test.ts`、`cli-management-admission.test.ts`、`cli-management-download.test.ts`、`cli-management-directory.test.ts`，共用 `cli-management-phase-b-fixture.ts`；没有调用真实 CLI、npm、brew、账号、安装或更新。
  - `corepack pnpm vitest run tests/cli-management-phase-b.test.ts tests/cli-management-download.test.ts tests/cli-management-directory.test.ts tests/cli-management-admission.test.ts tests/cli-management.test.ts tests/cli-management-remotes.test.ts tests/cli-settings.test.ts tests/accounts.test.ts tests/native-launch.test.ts`：9 文件 439 项通过。新增明确确认清理后的解锁及后续微调后，3 文件 40 项复核通过；typecheck 通过。
  - 目录 Remote 模拟覆盖 ADMIN_REQUIRED / NO_SPACE / NOT_EMPTY / INVALID、取消 path=''、三个桌面 CLI 限制、macOS 与 Windows 固定 argv。真实系统选择器和平台权限体验留在第三阶段与平台验收。
  - 全量 `corepack pnpm vitest run` 沙箱内：17 文件失败、276 通过、4 跳过；348 项失败、6060 通过、14 跳过，另 20 个错误，主要为 listen EPERM、/bin/ps EPERM 及由此引起的等待超时；日志 `/private/tmp/cliworker-phase-b-vitest.log`。单独复现 `tests/native-harness-tools.test.ts`：沙箱内 32 失败/1 通过，获准沙箱外重跑 33/33 通过。
  - 获准沙箱外全量 `corepack pnpm vitest run`（2026-11-13 17:33:40，111.32 秒，退出码 0）：**Test Files 293 passed | 4 skipped (297)；Tests 6408 passed | 14 skipped (6422)**，无失败或未处理错误；日志 `/private/tmp/cliworker-phase-b-vitest-unsandboxed.log`。测试总数与沙箱内一致，348 项失败全部在沙箱外通过，支持这些失败由沙箱进程/监听限制引起；没有借此执行真实 CLI 安装、更新或版本探测。
  - 暂停后续跑最终复核（2026-11-13 18:28:51）：`corepack pnpm vitest run tests/cli-management-phase-b.test.ts tests/cli-management-admission.test.ts tests/cli-management-download.test.ts tests/cli-management-directory.test.ts`：**4 文件 46 项通过**，退出码 0；`corepack pnpm typecheck`：Host/Client against DSH 0.2.2-rc.2 通过，退出码 0。不重复已完成的沙箱外全量测试。
  - `corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict --no-interactive`：valid，退出码 0；`/Library/Developer/CommandLineTools/usr/bin/git diff --check`：通过；`git diff -- src/client src/shared/cli-management.ts`：无差异。本阶段未修改 Client 或共享协议，没有执行 build、真实 CLI 安装/更新/--version，也没有 Git 提交。

- [x] 4.8 修复阶段 B 审查问题（六项，逐项模拟回归）
  - ① 主包完整性：`ReleaseClient.artifact` 绑定官方包名/版本/sha512，`downloadCliArtifact` 实际下载所选源 tarball 后校验，校验通过才以本地 tgz 安装；官方源同路径。`cli-management-review.test.ts` 模拟覆盖两种源成功、元数据摘要一致但文件被替换时 INTEGRITY_MISMATCH/删片段/零进程、缺 sha512 拒绝、下载取消、超过 30 秒准备预算后的续传。
  - ② npm 与包前缀分离：新增 `npm.ts`，读取 npm 包清单/bin 声明及 Node 原生文件格式，优先启动器旁 Node，否则解析 PATH；原前缀仅为安装目标。模拟覆盖 POSIX 自定义前缀及 manifest/入口/运行时无效，均不执行真实 Node/npm 探测。
  - ③ Windows 官方 npm.cmd：不把批处理作为 cmd-shim 解析，核实固定 npm JS 入口后直接 `[node.exe, npm-cli.js, ...]`。模拟使用含 npm-prefix.js、FOR /F 的官方 npm.cmd 形态文本，Program Files 运行时与 AppData/Roaming/npm 包前缀分离，验证无 cmd /c；跟随 npm 配置的 Windows 读取同步使用此入口。
  - ④ Homebrew：`sameInstallation` 允许同一前缀/formula 或 cask/稳定启动器/包内入口的版本目录变化。模拟覆盖 Cellar、Caskroom 正例，前缀/包名/类型/入口/启动器/来源变化六个反例，以及服务成功更新后仍核对目标版本。
  - ⑤ 账号隔离状态：`readAccountStatus` 在取维护租约前返回无进程 cleanupBlocked 状态。`cli-management-admission.test.ts` 对 accountStatus、refreshAccountStatus 分别加模拟回归，并在真实 Host 方法配模拟更新清理失败的流程中验证两个方法可读、零额外账号/进程调用、明确确认后恢复。
  - ⑥ 成功分组：更新核对后刷新 identity/version 缓存，重算 group/reason/planToken 并持久化。模拟覆盖 updatable → latest、徽标计数清零、磁盘读回、服务重启、再次全部更新不排入已完成条目。
  - `corepack pnpm typecheck`：退出码 0，Host/Client against DSH 0.2.2-rc.2 通过。`corepack pnpm vitest run tests/cli-management-review.test.ts tests/cli-management-phase-b.test.ts tests/cli-management-admission.test.ts tests/cli-management-download.test.ts tests/cli-management-directory.test.ts`：5 文件 70 项通过。
  - 扩展关联 `corepack pnpm vitest run tests/cli-management-review.test.ts tests/cli-management-phase-b.test.ts tests/cli-management-admission.test.ts tests/cli-management-download.test.ts tests/cli-management-directory.test.ts tests/cli-management.test.ts tests/cli-management-remotes.test.ts tests/cli-settings.test.ts tests/accounts.test.ts tests/native-launch.test.ts tests/cleanup-persistence.test.ts`：11 文件 484 项通过（2026-11-13 18:45:44，7.71 秒，退出码 0）。所有新增夹具均标注「模拟」。
  - 获准沙箱外 `corepack pnpm vitest run`（2026-11-13 18:46:27，71.99 秒，退出码 0）：**Test Files 294 passed | 4 skipped (298)；Tests 6432 passed | 14 skipped (6446)**，无失败或未处理错误。
  - `corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict`：valid，退出码 0；指定 Git 的 `diff --check` 通过。`src/client/workers.ts` 本轮前后 SHA-256 均为 `a5b5d3228dd2e0ab8aabc92233dc0e8de34c2f3cd5ceef99b3faf7dd54adfde9`，保留主会话 Omit 修正；没有修改 Client 或共享协议。
  - （未执行：本次仍禁止真实 CLI 安装/更新/npm/brew/--version、build 和 Git 提交；Windows 与 Homebrew 行为用模拟夹具验收，未声称真实平台通过。）既有跨操作/跨重启续传、首次安装、可视验收等未完成项保持原状态。

## 5. 首次安装 〔后端｜10h｜前置 4〕
- [x] 5.1 纯 CLI 安装：官方推荐优先、同为推荐用 npm；官方脚本只用内置地址、先下载再以文件执行；前置条件检查
  - Phase C：新增 `install.ts`，Host `planCliOperation(..., 'install')` 按来源、平台、当前身份/缺失状态、路径记录 revision、目标版本/官方当前选择器、安装目录、Node/npm 与下载源生成 token，执行前两次复算；接入现有全局操作、维护锁、取消和插件停用清理。未安装/未知版本条目通过 install offer 与 planToken 接入原页面；旧路径失效提示旧位置。
  - npm：Codex、Pi、CodeBuddy；Windows 另含 MiMo、OpenCode。读取当前 Node 版本及 `npm prefix -g`，核对目标包 engines/已知最低版本及可写性，不提权、不代装；主包复用官方 sha512 + 本地 tgz。Pi 限白名单并传 `--ignore-scripts`，OpenCode 限 V1。
  - 脚本（5.4 审查后）：Kimi（Mac/Linux/Windows）、TRAE CN（Mac/Linux）、Qoder/Qoder CN（Windows）；只使用 sources 的内置 URL 和 `/bin/bash <私有文件>` 或 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <私有文件>`。Kimi Windows 区分 Git Bash 与 WSL bash。没有独立官方摘要的脚本只验证 HTTPS 传输/响应长度，不声称发布签名已验证；脚本目标为 official-current，不编造锁定版本参数。装后版本无法读取或不适配仍判失败，不写回旧路径。
  - 仅说明：Claude 全平台、MiMo Mac/Linux 的原生版本读法（5.4 审查后退回；MiMo Windows npm 保留），Antigravity/Grok 的前置条件或安全版本读法、OMP/Hermes 禁止代装运行时的参数、Qoder/CN 的 macOS 入口、OpenCode macOS 脚本锁 V1 参数、TRAE Windows 默认入口未核实。按本阶段简报保留 manual，不猜参数或下载源。
  - 成功后用现有 `CliExecutablePathStore.setManual` 改用验证的新入口，核对 revision 防覆盖并保留旧文件，更新身份/版本缓存与分组、失效模型目录。模拟覆盖首次安装、重装、路径写入、路径过期、找不到入口、不可写前缀、前置条件失败、脚本 argv、幂等/取消和并发拒绝，命令见 5.3。
- [ ] 5.2 桌面应用安装：ZCode、WorkBuddy CN、WorkBuddy 的位置校验（权限、空间、非空目录）；macOS DMG 复制流程；Windows 打开官方安装程序；装后写入路径记录
  - 已实现通用桌面执行器 `desktop.ts` 并以模拟描述符验证：macOS attach 只读/no browse、codesign Team ID requirement + spctl、ditto 暂存复制后移动、attach/签名/复制失败均 detach 并清理；detach 未确认沿用清理隔离。Windows 进入 awaiting-user、只传安装程序路径，不猜静默或位置参数；等待整个进程范围退出、支持取消。装后查所选/描述符已核实的常见位置，再按通用流程验证并写原路径存储。
  - 位置校验允许目标不存在但父目录可写，拒绝系统/项目/已知工作区/插件状态/账号数据目录及其重叠路径，拒绝另一版 WorkBuddy 的安装目录；复用权限/空间/非空目录检查。
  - 2026-11-14 补齐 macOS：sources 固定三个官方 feed、应用名、CLI 相对入口与 Team ID；CliInstaller 通过共享发布预算读取清单，把 SHA-512/SHA-256、版本、工件地址纳入 token；ZIP 解包、codesign + spctl、应用版本核对成功后写回原路径记录，DMG 继续只读挂载/卸载。ZIP 成功、解包/签名/目标占用失败、摘要失败零启动、版本不符不写路径均有模拟回归。官方 URL、摘要与签名依据见本变更 design.md「2026-11-14 首次安装来源与实机复核」。
  - 本次实时 GET：ZCode 3.18.2 / SHA-512 / 305,360,326 B；WorkBuddy CN 5.9.3.42398134 / SHA-256；国际版 WorkBuddy 5.9.4.42593613 / SHA-256。国际版包的独立签名检查为 Team FN2V63AD2J、bundle com.workbuddy.workbuddy-ai，codesign 验证通过；但其 ZIP 与 feed SHA-256 不一致（官方 6502dc77…、实际 75492626…），插件完整重下仍拒绝，不用签名结果绕过摘要。CN 本轮只读清单，没有真实安装。
  - ZCode macOS 插件安装实测通过，详见 7.4。Windows 未执行；首次安装的 Authenticode、向导实际位置发现仍无充分证据，保持仅说明，所以组合项 5.2 保持未勾选。
  - 本轮交付检查：`corepack pnpm typecheck` 通过（DSH 0.2.2-rc.3）；最终指定 5 文件单 worker 回归 `corepack pnpm vitest run tests/cli-management-install.test.ts tests/cli-management-desktop.test.ts tests/cli-management-remotes.test.ts tests/cli-management-local-artifacts.test.ts tests/cli-management-download.test.ts --maxWorkers=1`：93/93 通过，25.80 秒，退出 0（/tmp/gaps-owned-delivery.log）。覆盖官方源/签名绑定、token 变化、应用版本核对、摘要失败零执行、ZIP 清理/隔离、Agent 工具清单、OMP 最终脚本地址。
  - `corepack pnpm vitest run tests/cli-management`：20 文件 604 passed / 1 failed（605 项），退出 1（/tmp/gaps-related-final.log）。唯一失败是既有 acceptance-fixes 的 Pi 1.5.2 Worker 拒绝断言，当前分支已支持该版本；本轮未修改对应源码/测试，交主会话整合。此前默认并发指定 5 文件一轮 91 passed / 1 timeout（92 项），单 worker 复跑 92/92，再补 ZIP 清理隔离后最终 93/93；不改超时或跳过用例。
  - 沙箱外默认并发 `corepack pnpm vitest run`：314 文件 296 passed / 14 failed / 4 skipped；7,056 项 6,992 passed / 50 failed / 14 skipped，570.22 秒，退出 1（/tmp/gaps-full.log）。该长轮期间补过本轮代码/用例，保留为中间结果；固定最终源码的 2 worker 全量另行记录，不据聚焦通过宣称全量通过。
  - 固定最终源码沙箱外全量 `corepack pnpm vitest run --maxWorkers=2`：314 文件 307 passed / 3 failed / 4 skipped；7,057 项 7,037 passed / 6 failed / 14 skipped，423.01 秒，退出 1（/tmp/gaps-full-delivery.log）。失败为本轮未改的 build-dependencies 2 项（根目录 lib/typert.remote-client.js、lib/types/host/index.js 尚未生成）、acceptance-fixes 1 项（Pi 1.5.2 旧拒绝断言）、native-bridge-time-limit 3 项（pid ENOENT、idle/total 断言、审批 hold 超时）。上述失败文件及 Pi/build/原生桥相关实现与 f510f75 无 diff；不改阈值、不隐藏失败。构建入口通过复制 preview 的被忽略 lib 产物补齐后另行聚焦复核，不运行正式 build。
  - 补齐被忽略 lib 后沙箱外 `corepack pnpm vitest run tests/build-dependencies.test.ts tests/native-bridge-time-limit.test.ts --maxWorkers=1`：2 文件 19/19 通过，10.53 秒，退出 0（/tmp/gaps-full-failures-recheck.log）。不以聚焦复跑覆盖全量失败；原生桥满载计时稳定性仍有风险，Pi 1.5.2 旧断言留主会话协调。最终本变更 53/61 完成；1.3、11.6 已补勾，5.2/7.4 的 Windows 部分、其他界面/预加载/整体验收由各责任方保留，未归档。
  - 初始依赖安装 `corepack pnpm install --frozen-lockfile --prefer-offline` 成功。初次 typecheck 因本工作树尚无生成的 `lib/typert.remote-client.d.ts` 失败；先隔离 build:preview，再仅复制该生成声明到被忽略的 lib 后复核通过，没有修改 Client 或正式 build。
  - `corepack pnpm build:preview` 通过，仅 `.cache/preview-package`，最终 4 个 Host 文件与 preview 源码逐字节一致；最终版本规划路径另做只读 GET，ZCode target/url/integrity 与真实安装报告一致、零子进程（/tmp/gaps-final-plan.log）。未正式 build 或更新 Desktop。三个变更的 `corepack pnpm spec validate <change> --strict` 均通过（/tmp/gaps-{spec,qoder-spec,workbuddy-spec}-delivery.log）；本变更只提示主任务数，WorkBuddy 为既有旧格式警告。指定 Git diff --check 通过。
- [x] 5.3 单元测试：安装方式选择、前置条件不满足、位置校验、装后路径写入、重新安装改用新路径
  - 新增 `cli-management-install.test.ts`、`cli-management-desktop.test.ts`，23 项均标「模拟」；Node/npm、脚本、HTTP、hdiutil、codesign、spctl、ditto、Windows 安装器均为替身。旧阶段 B 的两项「安装尚未支持」断言更新为「缺少路径存储则拒绝」。
  - `corepack pnpm vitest run tests/cli-management-install.test.ts tests/cli-management-desktop.test.ts`：2 文件 23 项通过，退出码 0。
  - `corepack pnpm typecheck`：Host/Client against DSH 0.2.2-rc.2 通过，退出码 0。`corepack pnpm vitest run tests/cli-management-install.test.ts tests/cli-management-desktop.test.ts tests/cli-management-phase-b.test.ts tests/cli-management-admission.test.ts tests/cli-management-download.test.ts tests/cli-management-directory.test.ts tests/cli-management-review.test.ts tests/cli-management-remotes.test.ts tests/cli-management.test.ts tests/cli-settings.test.ts tests/accounts.test.ts tests/native-launch.test.ts tests/cleanup-persistence.test.ts`：13 文件 507 项通过（2026-11-13 19:29:25，8.37 秒，退出码 0）。
  - 首轮关联测试仅 2 项旧错误文案断言失败，更新为阶段 C 的缺少存储拒绝语义后通过；未修改生产逻辑迁就断言。
  - 获准沙箱外 `corepack pnpm vitest run`（2026-11-13 19:30:01，68.32 秒，退出码 0）：**Test Files 296 passed | 4 skipped (300)；Tests 6455 passed | 14 skipped (6469)**，无失败或未处理错误。
  - `corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict`：valid，退出码 0；指定 Git 的 `diff --check` 通过，`diff -- src/client src/shared/cli-management.ts` 无差异。没有改共享协议或 Client。
  - （未执行：本阶段明确禁止联网、真实安装、真实脚本/npm/brew/hdiutil/安装程序、build 与 Git 提交；新流程均以模拟夹具验收，不作为真实平台安装证据。）

- [x] 5.4 修复阶段 C 审查问题（六项，逐项模拟回归）
  - ① 原生版本读取：仓库只证明 Claude 原生目录归属，未证明目录名可作为版本；MiMo 也没有已核实的清单/无副作用版本命令。Claude 全平台与 MiMo Mac/Linux 脚本改回 manual，MiMo Windows npm 保留；README、两份 design 和 5.1 同步。`cli-management-install.test.ts` 对两项分别验证仅说明、零下载/进程、不写路径，不添加猜测的 --version。
  - ② Windows Qoder/CN：直接复用 `windowsCliCandidates` 的首个官方候选，分别指向 `.qoder/bin/qodercli/qodercli.exe`、`.qoder-cn/bin/qoderclicn/qoderclicn.exe`。两个模拟回归核对候选、装后 resolve 与原路径存储写回；版本由模拟版本读取器返回，不作为真实原生版本验收。
  - ③ Git Bash：新增只读文件发现工具，扫描完整 PATH 的 bash/git 候选、已解析 git.exe 和常见安装位置；以 cmd/git.exe、usr/bin/bash.exe、MSYS DLL 的 PE 文件布局核实，不依赖目录名 Git、不启动探测进程。新增 `windows-git-bash.test.ts` 5 项模拟回归（自定义便携目录、WSL 排在前面、bash/git PATH、git 旁发现、常见位置、伪装文件、取消和隔离）；安装测试核对 prerequisites 与计划记录。
  - ④ Pi 旧安装损坏：准备阶段专门把 Pi CLI_IDENTITY_MISMATCH 记录为 unusableBefore 并纳入 token；装后身份读取不放松，取消和 ProcessCleanupUnconfirmedError 继续抛出。4 个模拟分支覆盖修复成功、新安装仍坏、取消、清理未确认；前两项通过真实只读 Pi 身份读取器检查损坏夹具，后两项注入取消/隔离错误；旧文件与失败时旧路径均保留。
  - ⑤ 清理隔离优先：desktop.ts 聚合附加清理错误，保留 ProcessCleanupUnconfirmedError；模拟覆盖 detach 与 stage 删除同时失败后的 cleanup-unconfirmed、镜像保留和维护锁保留，以及复制进程已隔离后目录删除失败不覆盖原错误。
  - ⑥ 账号目录保护：Codex/Claude 的环境根解析提取为账号读取器与目录保护共用的 helper；MiMo 直接复用 mimoConfigurationPaths，包含默认 config/data、MIMOCODE_HOME 和 XDG 覆盖；另复用 Qoder、CodeBuddy、Hermes、ZCode、OpenCode 的既有目录工具。模拟经 service.checkDirectory 验证默认/环境根及子目录拒绝，无账号或进程调用。
  - 首轮新增回归 2 项失败：Windows Qoder 测试错误继承了宿主 ARM64 架构；添加模拟 x64 架构输入后通过，生产默认仍读取 process.arch。之后 3 文件 39 项通过；再补复制清理隔离回归，最终关联命令结果见下。
  - `corepack pnpm typecheck`：Host/Client against DSH 0.2.2-rc.2 通过，退出码 0。
  - `corepack pnpm vitest run tests/cli-management-install.test.ts tests/cli-management-desktop.test.ts tests/windows-git-bash.test.ts tests/cli-management-phase-b.test.ts tests/cli-management-admission.test.ts tests/cli-management-download.test.ts tests/cli-management-directory.test.ts tests/cli-management-review.test.ts tests/cli-management-remotes.test.ts tests/cli-management.test.ts tests/cli-settings.test.ts tests/accounts.test.ts tests/native-launch.test.ts tests/cleanup-persistence.test.ts tests/windows-cli-resolution.test.ts tests/cli-account-binding.test.ts tests/claude-own-route.test.ts tests/mimo-configuration.test.ts`：**17 文件 666 项通过**（2026-11-13 19:51:44，8.71 秒，退出码 0）。最后一个 MiMo 文件过滤名不存在，Vitest 实际选择前 17 个文件；MiMo 目录保护回归位于 cli-management-install.test.ts，不声称运行了不存在的文件。
  - 获准沙箱外 `corepack pnpm vitest run`（2026-11-13 19:52:04，67.35 秒，退出码 0）：**Test Files 297 passed | 4 skipped (301)；Tests 6472 passed | 14 skipped (6486)**，无失败或未处理错误。相较审查前新增 17 项模拟回归。
  - `corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict`：valid，退出码 0；`/Library/Developer/CommandLineTools/usr/bin/git diff --check`：通过；指定 Git 的 `diff -- src/client src/shared/cli-management.ts`：无差异。
  - （未执行：本轮禁止联网、真实安装/CLI/脚本/npm/brew/hdiutil/安装程序、build 与 Git 提交；所有新增测试均标「模拟」。桌面来源/发布者核实和真实平台验收仍未完成，5.2 保留未勾选。）

## 6. 「更新 CLI」设置页前端 〔前端｜14h｜前置 2〕
- [x] 6.1 导航入口、徽标与转圈；页头（检查更新、全部更新）；分区与统一折叠按钮
  - `settings-dialog.tsx` 第三项导航 + `navIndicator()`；`cli-update-page.tsx` 页头与分区。`useCliUpdateData` 在弹窗打开期间只订阅一次，导航与页面共用。
- [x] 6.2 行组件：32px 品牌图标（深色主题单色图标反相）、版本与来源说明、操作按钮与悬停原因
  - 复用 `BrandIcon`；按钮只用 md/sm；禁用原因走 Tooltip。更新 / 安装按钮调用的 Host 方法在阶段 B/C 实现前不存在，页面按可选方法处理。
- [x] 6.3 加载与重排：缓存直显、缺的进「检查中」、最多两次重排、展开与进行中的行不动、滚动锚点、30 秒上限、整页错误与重试、`aria-busy` 与播报
  - 纯函数 `cli-update-layout.ts`（14 项测试）；30 秒截止在 Host 的 check。整页错误只在没有可显示快照时出现，已有结果时改为分区上方的错误行加「重试」（新增测试覆盖）。
- [x] 6.4 展开区：下载进度与续传次数、命令与输出、结果状态、手动方法气泡、安装位置气泡
  - 界面已按快照字段实现并用模拟快照测试（`readable=false` 显示「下载进度无法读取」）。Phase B/C 已提供操作、安装位置与首次安装后端；（未执行：本次禁止修改 src/client/**、构建和真实更新/安装，尚未进行界面与实际操作快照的可视核对；桌面安装来源仍待核实。）
  - 2026-11-15 Mac Desktop（34133b9 正式构建，07:25 部署，经内置浏览器打开 Host Web UI）：OMP 18.20.0 → 18.20.2 经官方 `omp update` 完成，展开区显示命令行 `/Users/leeyl/.local/bin/omp update`、「命令输出」「复制输出」及官方原文输出（补丁 36.6MB、sha256 校验、Updated to 18.20.2），末行「更新清理：已删除 0 项，释放 0 B。」，结果状态「已更新到 18.20.2 · 查看输出」。WorkBuddy（未安装组）点「安装」只展开安装位置气泡、不开始安装：显示「安装位置」只读框 `/Applications`、文件夹按钮、「恢复默认位置」（默认位置时禁用）与「开始安装」，短暂显示「正在检查安装位置…」后无空间提示（默认位置不做空间检查，符合实现）；点「收起」复原。
  - 2026-11-15 Windows（ad2f07f 包）：「需要手动更新」组 ZCode 点「查看方法」展开气泡：「此 ZCode 完整 runtime 由 CLI Worker 按官方源码部署，不能用 ZCode 桌面安装包或 CLI 自带命令更新；需另行核验并部署新版 runtime。」与「官方说明」，按钮变为「收起」；WorkBuddy CN 气泡为「无法核实桌面应用目录或版本，请先修复原安装。」与「官方说明」。下载进度、续传次数、通道标签与取消结果见 13.5 的 OMP 接管记录。
  - 发现：Windows 上 WorkBuddy CN 显示 2.165.0 但手动方法提示无法核实桌面应用目录或版本，原因未查。
  - 五类展开内容均已在真实界面出现，勾选。未覆盖：浏览文件夹选择器与非默认位置的空间提示（选择器需在 Windows/Mac 桌面上手动操作）、英文界面。
- [x] 6.5 下载设置：下载源下拉与自定义地址、检查连接
  - `cli-download-source.tsx` + `NativeChoice` 新增说明行 / 分隔线参数；8 项测试。
- [x] 6.6 文案进 `client-localization` 词表；`doc/settings-ui-design.md` 同步新增参数
  - `i18n-messages.ts` 新增 `cli-update-page`、`cli-update-settings` 两区；设计文档新增「「更新 CLI」页」一节。
- [x] 6.7 前端测试：分区归类与重排规则、展开行不动、徽标计数
  - `cli-update-layout`（14）、`cli-update-page`（12）、`cli-update-data`（9）、`cli-download-source`（8）、`general-settings`（8）及 `settings-dialog` 新增账号缓存 5 项。
  - 同一审查的两项前端问题已修：① 页面打开时该 CLI 的目录读取仍在进行，强制重读被丢弃 → `AccountQueryQueue.whenIdle()` 在该 CLI 空闲后补读；② `$stream` 自行重连（Host 重启）后新一代快照 revision 更低被丢弃 → 每个新 generation 重置 revision 下限。各加测试，临时关掉修复时测试失败，恢复后通过。
  - 账号缓存接线：`accountStatus` 命中 Host 缓存时只有显示字段；前端先显示缓存，再对当前打开的 CLI 或已过期条目调用 `refreshAccountStatus` 恢复登录 / 退出按钮；「刷新状态」直接走新读取；旧 Host 无该方法时退回 `accountStatus`。

## 7. 验收与文档 〔测试｜10h｜前置 3,4,5,6〕
- [x] 7.1 `pnpm typecheck`、相关 vitest、`pnpm build:preview` 隔离构建
  - Phase A：corepack pnpm typecheck 最终通过；上列 5 个后端关联测试文件 400 项通过。 （未执行：本阶段简报明确禁止 build / build:preview、全量测试。）
  - 阶段 A + 前端整合（2026-11-13）：`corepack pnpm typecheck` 通过（DSH 0.2.2-rc.2）；`corepack pnpm vitest run` 289 文件 6358 项通过、14 项跳过（首轮 8 项失败：`panel.test.tsx` 的组件桩缺新图标、`cleanup-persistence.test.ts` 的账号桩缺 `isBusy`，已补；`native-agy-acp`、`native-bridge-time-limit` 两个计时类测试在满载时偶发超时，单独与第二轮全量均通过）；`corepack pnpm build:preview` 成功。阶段 B/C 后需重跑。
  - Phase B：最终 typecheck、关联 4 文件 46 项、沙箱外全量 293 文件 6408 项通过，详见 4.7。（未执行：本次用户明确禁止 build / build:preview，因此本组合任务保持未勾选；不把 Phase A 构建当作 Phase B 构建证据。）
  - 阶段 B 主会话复核（2026-11-13）：`corepack pnpm typecheck` 通过；`corepack pnpm vitest run` 294 文件 6432 项通过、14 项跳过（首轮 `native-workbuddy.test.ts` 2 项在满载时失败，该文件自 a955675 起未改动，单独连跑 3 次 39 项全过，第二轮全量全过）；`corepack pnpm build:preview` 成功。构建曾报 TS2774：Host 注册页面 Remote 后生成类型把 11 个方法变为必有，已在 `src/client/workers.ts` 的 Omit 中排除并改回可选（`pnpm typecheck` 未发现此问题，只有隔离构建能发现）。阶段 C 后需重跑。
  - Phase C：typecheck、关联 13 文件 507 项、沙箱外全量 296 文件 6455 项通过，命令与完整统计见 5.3。（未执行：阶段 C 明确禁止 build / build:preview，本项保留未勾选。）
  - 阶段 C 主会话复核（2026-11-13）：`corepack pnpm typecheck` 通过；`corepack pnpm vitest run` 297 文件 6472 项通过、14 项跳过；`corepack pnpm build:preview` 成功；严格校验通过；`src/client`、`src/shared` 无改动。核对 `first-party-account-paths.ts` 与原写法一致（Codex 路径 resolve，Claude 路径不 resolve，绝对路径检查保留）。
  - 2026-11-15 当前代码复核（本地提交 34133b9，含双通道与临时目录回收的全部后续改动）：`corepack pnpm typecheck` 通过（DSH 0.2.2-rc.3）；`corepack pnpm exec vitest run tests/cli-management tests/cli-update-page.test.tsx tests/temporary-cleanup.test.ts tests/probe-process.test.ts tests/workbuddy-probe-temporary.test.ts` 及账号/适配器关联测试 90 文件 2299 项全部通过；`corepack pnpm build:preview` 成功（隔离包 1262 文件，已装入 Windows 实测）。三项要求均由同一份代码满足，故勾选。全量 vitest 本轮未跑。

- [x] 7.2 预览台与设计稿 15 张逐张截图对照，差异修完再截
  - 预览台（2026-11-13，Opus 子 agent 搭建，主会话复核）：`.cache/update-preview/`（不入 Git），esbuild 打包真实 `SettingsDialog` + DSH 0.2.2-rc.2 primitives 与主题 token，模拟 API 按画板推送 `CliUpdateSnapshot`（标「模拟」，不连 Host）；`node .cache/update-preview/run.mjs` 用本机无头 Chrome 截 900×780（Narrow 640×780）并生成设计稿 / 实现并排图。14 个状态控制台、异常、请求失败、横向溢出均为 0。
  - 修复的实现差异：640px 页头按钮组换到第二行 → 按钮组不换行、标题收窄；更新 / 安装进行中「检查更新」未置灰；进行中缺「已用时 m:ss」（取 Host `startedAt`）；速度「922 KB/s」→「0.9 MB/s」；首次加载第二步出现置灰「全部更新」→ 按显示分区判断，第二次重排后才出现；首次检查期间导航改为转圈（原为数量）；安装成功文案改为「已安装 X，登录后即可派遣」（PRD 5.11.6）；纯 CLI 安装显示「安装到官方默认位置 <路径>」，桌面应用「正在下载安装包」；前置条件「官方安装脚本需要 Git，这台电脑上没有找到」（范围为空时不留空格）；可用空间取整并带 Windows 盘符；下载源菜单主行 13/20 → 14/22；带转圈的说明换行时转圈留在首行。各项加测试（页面 17 项、布局 14 项），`doc/settings-ui-design.md` 同步。
  - 按 PRD 保留、判为设计稿自身问题：原生 Modal 外壳（圆角、关闭按钮、列间距 24）；「检查中」排在「检查失败」前（PRD 5.2.1）；失败行「重试」（PRD 5.1）；分区内按 CLI 固定顺序（Results 画板 Pi 位置）；任务占用时「全部更新」仍可点（只跳过占用的 CLI）；输出区高 150（规范值，画板为排版压到 96）；进度「已下载」前缀（PRD 5.9.4）；「由 WorkBuddy CN 桌面端管理更新」沿用 CLI 显示名，不猜桌面应用名。
  - 复核：`corepack pnpm typecheck` 通过；`corepack pnpm vitest run` 297 文件 6477 项通过；`corepack pnpm build:preview` 成功；修复后 14 个状态全部重截。（未执行：真实 DSH Desktop 里的目视核对，随 7.3 / 7.5 实机验收做。）
  - （未执行：Phase B 仅后端与模拟测试，禁止构建及修改 Client；可视验收留待整合阶段。）
- [x] 7.3 macOS 真实更新：npm 全局、Homebrew、CLI 自带命令各一次；人为限速验证停滞续传；核对更新前后版本、路径、事件与退出状态
  - 2026-11-13 macOS 实机（DSH Desktop 0.2.2-rc.2，内置浏览器直连 Desktop Host Web UI；主会话执行）：
    - 首次真实检查暴露两类缺陷：npm 元数据整份读取超 512 KiB（opencode-ai 14.7 MB、@openai/codex 5.6 MB、codebuddy 1.45 MB、claude-code 534 KB）全部误报「连不上发布源」；前台未按 PRD 5.4 执行 `--version`，17 个 CLI 中 12 个「读不出当前版本」。逐个实测真实 `<cli> --version`（8 秒超时、比对文件改动）后交 Codex 修复，见 2.8；修后复检 14 个读出版本、3 个可更新。Qoder/Qoder CN 分发脚本与 Grok downloads 路径的来源识别随后补修（2.8）。
    - npm + 停滞续传：本机测试中转（127.0.0.1 自签 CA，仅经 `NODE_EXTRA_CA_CERTS` 传给本次 Desktop 进程，「模拟」慢源）设为自定义下载源，首个主包请求发 40% 后静默。CodeBuddy 2.181.0 → 2.184.0：主包停在 27466967/68667419 字节，10.2 秒后插件发 `Range: bytes=27466967-`，中转回 206，随后 npm 安装成功，用时 28 秒；`/opt/homebrew/lib/node_modules/@tencent-ai/codebuddy-code` 路径不变，`codebuddy --version` 2.184.0。OpenCode 1.19.0 → 1.19.5：停在 1216/3041 字节，界面每秒显示「N 秒没有新数据」（警示色）与「已自动续传 0 次」，约 10 秒后续传、显示「已自动续传 1 次」，命令区显示实际 argv（`node npm-cli.js install --global --prefix /opt/homebrew <本地 tgz> --registry …`），成功后 `opencode --version` 1.19.5。两次 integrity 均以官方源为准，临时下载目录完成后清空，目录 0700、状态文件 0600。
    - Homebrew：Claude Code 2.1.287 → 2.1.311，执行 `/opt/homebrew/bin/brew upgrade --cask claude-code`，输出实时显示（下载进度标「无法读取」），经「正在核对结果」后成功；`/opt/homebrew/bin/claude` → `Caskroom/claude-code/2.1.311/claude`，`claude --version` 2.1.311。
    - 三项完成后缓存条目均为 latest，下载源已改回「跟随 npm 设置」，测试中转已停止。
    - （未执行：CLI 自带更新——Qoder 来源识别修复后待装入 Desktop 再测；用户 2026-11-13 要求全部 CLI 改为可自动更新，自带命令、官方安装器与桌面应用更新随新一轮实现一并实机验收。）
  - 2026-11-14 macOS 实机续（同一方法，正式 `corepack pnpm build` 后从终端启动 Desktop，保留宿主代理环境变量，不再 `env -u`）：
    - CLI 自带命令：Qoder 1.1.73 → 1.1.89、Qoder CN 1.1.74 → 1.1.89、Grok Build 1.0.62 → 1.0.77、TRAE CN 0.213.1 → 0.215.0、OMP 16.4.4 → 18.20.0（原生 `omp update`，无交互）、Kimi 2.4.1 → 2.6.1（带 `KIMI_CODE_NO_AUTO_UPDATE=1`）。Hermes 首轮因 Desktop 以无代理环境启动、`git ls-remote` GitHub 60 秒超时失败，旧安装未动；macOS 系统代理注入（第 10 节）后重测 0.21.7 → 0.23.1：`/Users/leeyl/.local/bin/hermes update --yes`，确认框先说明迁移与通道，输出依次为 stable v0.23.1（3b4215785882）、拉取、Python/Node 依赖，用时约 2 分 30 秒，`hermes --version` 为 v0.23.1 stable。
    - 插件本地交接（MiMo）：0.1.15 → 0.1.17，进度行「已下载 12.1 MB / 32.3 MB · 5.2 MB/s · 来自 cnbj1.fds.api.xiaomi.com」，11 秒完成并按 content-md5 校验，执行 `/bin/bash …/downloads/local-XXXXXX/install.sh --binary … --no-modify-path`；`~/.mimocode/bin/mimo --version` 0.1.17，downloads 目录完成后为空（0700）。此前两次在无代理/慢域名下失败时旧安装完好、界面如实报错。
    - 官方安装器（Codex）：首轮失败、输出为空，原因是 `https://chatgpt.com/codex/install.sh` 现 302 到 `https://releases.openai.com/codex/install.sh`，插件下载 `redirect: 'error'` 被拒且只显示笼统文案；改用目标地址并给跳转单独报错（见 11.7）后重测 0.162.1 → 0.169.0：「已下载 42.6 KB / 42.6 KB · 来自 releases.openai.com」，执行 `/bin/sh …/downloads/<uuid>.sh --release 0.169.0`（`CODEX_NON_INTERACTIVE=1`），约 15 秒成功；`codex` 解析到 `~/.codex/packages/standalone/releases/0.169.0-aarch64-apple-darwin/bin/codex`，`codex --version` 0.169.0，旧版 0.162.1 目录由官方脚本保留。首轮失败留下的 0 字节 `.part` 按下载缓存保留期处理（设计如此，不是泄漏）。
    - 桌面应用（ZCode）：首轮 codesign `-R` 参数格式错误；修为单个 `-R=…` 后第二轮签名通过，但 Host 在 Electron 下用补丁版 fs 删除暂存目录，把 `Contents/Resources/app.asar` 当目录处理而 `ENOTEMPTY`，触发回滚：新应用移到 `/Applications/.cliworker-update-*/failed.app`、旧 3.17.2 恢复，暂存残留 366 MB（即 11.5 记录的「原因未明」残留）。改用 `original-fs`（见 11.7）、清掉两处插件残留目录后重测 3.17.2 → 3.18.2：确认框说明 Worker runtime 不随应用更新；从 cdn-zcode.z.ai 下载 291 MB（最高 15.6 MB/s），ditto 解包、两次 codesign（Team 8A5X4JJ39T）与 spctl 通过后替换，约 30 秒成功；`/Applications/ZCode.app` 3.18.2，`codesign --verify --deep --strict` 与 `spctl --assess` 通过，`/Applications` 与 `cli-management` 下无暂存残留。
    - 页面：下载来源 host、重试/续传计数实时显示；OMP 开发期提示已删除；区块标题整行可展开收起。
    - （未执行：Antigravity 无可用新版、WorkBuddy CN 已是最新、Pi 由用户手动更新到 1.5.2，三者本轮未走插件更新；人为限速仍只有 2026-11-13 的 npm 中转那一次，插件接管下载的慢速换源只有模拟测试。）
- [ ] 7.4 安装真实验收：macOS 隔离 HOME 装一个 npm 类 CLI 和一个桌面应用（自选位置）；Windows 装一个桌面应用到非系统盘；不覆盖现有安装
  - 2026-11-14 macOS 已执行：隔离 HOME `.cache/gaps-live/isolated-home`，npm prefix 指向该 HOME 下 npm；`GAPS_SKIP_OMP=1 node .cache/gaps-isolated-launch.mjs` 调用真实 CliInstaller.prepare/execute、ReleaseClient、下载器、nativeProcessBackend + LocalSubprocessRuntime。npm Pi 1.5.2 安装到 `<隔离 HOME>/npm/bin/pi`，主包 7,899,382 B，官方 sha512 校验；npm 命令退出 0，插件核对版本并写回隔离路径存储，独立插件 captureReadOnly --version 返回 1.5.2、退出 0；事件含 downloading → installing → verifying-installation。证据 `.cache/gaps-live/npm-pi-report.json`、/tmp/gaps-npm-pi-live.log。没有 prompt、账号或模型调用。
  - 桌面：`node --import tsx .cache/gaps-desktop-live.ts` 沙箱内在 spctl 退出 1，未复制且清理完成；沙箱外原命令通过，ZCode 3.18.2 装到 `.cache/gaps-live/custom-apps/ZCode.app`（自选非默认位置）。下载 305,360,326 B、官方 SHA-512 通过，ditto 解包、codesign（Team 8A5X4JJ39T）、spctl、ditto 复制各退出 0，全部 waitForExit=true；插件读应用版本、验证实际 CLI 入口、写回隔离 manual 记录。downloads/mounts 均为空，目标只含 ZCode.app；证据 desktop-report.json、/tmp/gaps-desktop-live-outside.log。
  - 中间 Codex npm 0.169.0 安装命令退出 0，但附加插件 --version 读取超时，未作为本项成功证据；独立二进制 --version 读回 0.169.0。保留 isolated-report-first/second.json 与日志，不以安装退出码替代全部验收。
  - Windows 未执行：没有 Windows 环境，组合项 7.4 因 Windows 部分保持未勾选。隔离 HOME、npm 全局前缀/缓存、OMP 安装、custom-apps/ZCode.app、下载/挂载状态目录、签名检查解包目录及独立 WorkBuddy ZIP 已清理，9 个清理目标独立回读均不存在（cleanup-report.json，退出 0）；只保留被忽略的脱敏证据文件。另以沙箱外 ps 在内存中过滤本轮隔离路径，残留验收进程计数 0；没有打印其他进程参数。
- [x] 7.5 Windows：npm 全局更新一次、停滞续传一次、预加载空闲判定与低优先级
  - （未执行：本次没有 Windows 真实环境验收且禁止真实更新；Windows argv 与目录选择器仅用模拟夹具验证。）
  - 2026-11-15 Windows 实机（200d97f 隔离包，详见双通道变更 9.17）：npm 全局更新 CodeBuddy Code 2.183.0→2.184.0 成功，共 3 个工件 86.4 MB；停滞 10 秒后从 13483712 B 处续传 1 次，页面显示「已自动续传 1 次」；`codebuddy --version` 2.184.0，downloads 目录无残留。npm 全局更新、停滞续传两项已满足。
  - 先前缺口：34133b9 包 06:17:43 启动后 06:23 有一次后台检查，但没有核对空闲判定时机和子进程优先级。
  - 2026-11-15 补测（34133b9 包，Windows 实机）：先从状态文件只删除 Kimi、OpenCode、Grok 三条版本缓存（其余不动；状态文件备份在 `%LOCALAPPDATA%\cliworker-now-remote\state-backup-20261115\`），以迫使后台预加载真实启动版本探测；Desktop 07:37:47.219 启动后无任务、无操作，用 40 ms 间隔的 Get-Process 轮询 5 分钟。第一个新子进程出现在 07:39:47.654（启动后 120.4 秒，晚于 60 秒空闲起点）；此后 `node`、`kimi`（+145.6 s）、`grok`（+158.4 s）、`reg` 及承载 `private-launch.mjs` 的 DeepSeek Harness（Electron 作 Node）子进程与其 conhost 全部为 BelowNormal，没有 Normal 优先级的新探测进程。结束时 CPU 负载 1%。另有一个 OfficeC2RClient BelowNormal 进程属 Office，与插件无关。
  - 四项均已覆盖，勾选。未覆盖：CPU 高于 50% 时推迟的分支只在模拟测试中验证，实机未制造高负载。

- [x] 7.6 README、`doc/design.md` 同步新页面与预加载说明
  - （未执行：Phase A/B 文件归属仅 Host、指定共享协议、后端测试与任务证据；README / doc/design.md 的整体验收说明由后续整合阶段统一更新。）
  - Phase C 已同步 README、doc/design.md 和本变更 design.md 的首次安装行为、脚本信任边界与桌面 manual 限制。（未执行：新页面与五类预加载的整体验收说明仍待整合，本项不以首次安装文档更新代替全部完成。）
  - 2026-11-15 整合：README.md「安装与更新」开头新增「更新 CLI」页的入口、分区、按钮、展开区、取消与下载设置说明，以及「启动后在后台检查 CLI」的启动时机、空闲条件、低优先级、前台限定 CLI 与 Windows 实测；README.en.md 同步英文版；README 中「Windows 接管仅完成模拟验证」改为已真实更新并指向 13.5。doc/design.md 末尾新增「「更新 CLI」页与后台版本检查（整体说明）」一节，描述与 `preload.ts`、`sources.ts` 的 backgroundSafe、`cli-update-layout.ts` 及决定 7/8 一致。

## 8. 全部 CLI 自动更新（PRD 5.3.1） 〔后端｜16h｜前置 4,5〕
- [x] 8.1 补齐官方发布 GET、Hermes 清单版本与桌面应用版本
  - 按 `.cache/cli-update-research/feeds.md` 第 2、3 节实现固定官方源；普通 JSON/文本统一 8 秒、512 KiB、3 并发，后台发布查询无 check/update/npm config 子进程。npm/brew 优先原归属，OpenCode 保留 V1 限制。模拟覆盖解析、格式错误、空摘要、非 rust-v、超限、超时及并发。
- [x] 8.2 自带更新、Codex 锁版脚本与实际版本核对
  - 13 个自带 argv 与 Codex 私有下载脚本均有模拟回归；不能锁版方法接受版本前进，未知、降低、不变及 OpenCode V2 拒绝。Kimi 保留防启动自更新环境变量；Hermes notice 明示迁移/依赖/服务重启和 stable 与原通道差异。维护锁、排队、取消及 Qoder homedir/update 预检沿用。
- [x] 8.3 Pi 取消更新白名单、共享可选字段与手动范围
  - 支持集合统一导出 PI_SUPPORTED_VERSIONS/isSupportedPiVersion；管理页允许未适配有效包，Worker 默认核对不放宽。共享仅新增可选 appVersion、notice、channel；前端需在操作前显示 notice 和桌面应用版本。外部管理器、未知安装、不支持平台、无对应官方源保留具体手动原因。
- [x] 8.4 接入任务 B 桌面接口及 WorkBuddy 204
  - 不修改 desktop-update.ts；模拟 read/run 接口、下载摘要核对与完整文件回传、应用/CLI 版本分离。204 明确文案映射 latest、latestVersion=当前应用版本、无更新 token；建议 B 后续增加独立 no-update 错误码。团队 ID 由 B 维护，ZCode=8A5X4JJ39T、WorkBuddy CN=FN2V63AD2J。
- [x] 8.5 关联模拟测试、类型检查、沙箱外全量、隔离构建与严格校验
  - `corepack pnpm typecheck`：通过，Host/Client against DSH 0.2.2-rc.2；最终复跑仍通过。
  - `corepack pnpm vitest run tests/cli-management`：Test Files **13 passed (13)**；Tests **440 passed (440)**，无失败，4.65 秒。新增 all-updates 文件含 **94 项模拟**，同时纳入任务 B 桌面测试及原维护锁/下载/安装/版本/Remote 回归。
  - 沙箱外 `corepack pnpm vitest run`（2026-11-13 22:39:56）：Test Files **301 passed | 4 skipped (305)**；Tests **6738 passed | 14 skipped (6752)**；无失败，80.53 秒。按用户要求在沙箱外执行，避免既往 /bin/ps EPERM 等限制。
  - `corepack pnpm build:preview`：通过，Host 与 Client 隔离包生成于 `.cache/preview-package`；仅有既有 CommonJS/依赖打包提示，没有正式 build 或 Desktop 链接更新。
  - `corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict`：通过。README、doc/design.md、增量规格及 change design 已同步；7.3 未改，不提交 Git。
  - 中间失败如实保留：首轮旧关联测试 6 文件 **10 failed | 193 passed (203)**，原因是旧 Pi 白名单/旧手动方法预期及夹具仍只提供 npm 源，已按新 PRD 更新；加入新测试后同组 6 文件 **1 failed | 273 passed (274)**，唯一失败为断言把 error.code 当 message，修正后上述关联与全量全过。未以这些失败运行作为完成证据。
- [x] 8.6 新增自动更新路径的真实平台验收
  - （未执行：本任务禁止联网、真实 CLI、安装脚本、npm/brew/安装器；模拟不能替代真实版本、路径、事件与退出状态验收。Windows 平台与前端新字段展示留主会话整合验收。）
  - 2026-11-15 汇总已有真实证据（逐项见各处记录）：OMP 自带更新——Windows 官方与接管各两次（13.5、11.9）、Mac 官方两次（本变更 6.4、临时目录变更 4.3）；Antigravity、Claude Code、TRAE CN 的 Windows 自带更新（13.5）；CodeBuddy npm 全局更新与停滞续传（7.5，Windows）；Pi npm 1.5.2 与 ZCode 3.18.2 的 macOS 隔离安装（7.4）；WorkBuddy CN 官方 feed 无更新时显示最新（Mac 页面检查）。
  - 仍无真实证据：Kimi、MiMo、Grok、Qoder/Qoder CN、Hermes、OpenCode 自带更新与 Codex 锁版脚本的真实更新（检查时均无新版本，或需回退旧版并下载）；ZCode、WorkBuddy 两版的桌面应用真实更新。本项保持未勾选，待这些 CLI 发布新版本后在页面上补测。
  - 2026-11-15 用户确认此项按现状验收并勾选；上面记录的未执行真实验证照旧保留，不当作已实测。

## 9. 任务 D 续与多源恢复 〔后端｜4h｜前置 8〕

- [x] 9.1 任务 D 续：MiMo 接管、撤销 TRAE 离线接管与单次校验重下
  - 已按用户授权实施；MiMo macOS 默认原生更新使用内置 FDS zip 与官方脚本 --binary，先完成下载再启动安装计时，保留维护锁、身份/目标版本复核；追加自动换源后校验长度、content-md5 与 zip 结构，同源 MD5 不代表独立签名。Linux/Windows、非默认布局保持原归属，首次安装范围不扩张。
  - TRAE CN 更新回原生 update --channel --version 加证据重跑，首次安装回既有官方脚本，删除所有 offline-install 接管分支；不关闭其自动更新。OMP 保留 PI_BUILD_URL，差别、脚本行号与风险同步 design.md。
  - 完整文件长度/摘要失败删临时文件后干净重下一次，不占用/重置恢复次数或重置 2 小时；HTTP/证书/Range 协议及缓存上限仍直接失败。README 中英、doc/design.md 和增量规格同步。
- [x] 9.2 任务 D 续：模拟回归、全量校验、隔离构建与交付证据
  - 首轮聚焦模拟 2 文件、33 passed / 3 failed（36）；3 项仅断言漏了 CliOperationError 固有 INTEGRITY_MISMATCH 前缀，修正测试断言，不改生产错误格式。日志 /tmp/task-d-cont-focused.log。

  - 中间关联：/tmp/task-d-cont-related.log 为 550 passed / 2 failed（552），两项旧夹具复用了已消费的 Response；改为每次返回新 Response 后 17 文件 552 项通过（23:57:57，3.62 秒，/tmp/task-d-cont-related-final.log）。npm 通用化首轮 572 passed / 4 failed（576，/tmp/task-d-npm-related-initial.log）是旧夹具未模拟新增 HEAD/ETag，补齐协议夹具并保留恶意字节、取消及 30 秒准备预算回归。
  - 中间全量（未含后续多源追加，23:58:12）：305 files passed / 4 skipped（309），6858 passed / 14 skipped（6872），85.23 秒、退出 0；/tmp/task-d-cont-full.log。
  - 中间全量（MiMo 多源，00:06:55）：305 files passed / 1 failed / 4 skipped（310），6879 passed / 3 failed / 14 skipped（6896），286.60 秒；/tmp/task-d-final-full.log。失败在未由本任务修改的 pi-omp-adapter.test.ts：Pi/OMP resume identity 两项 15000ms 超时、OMP metadata cleanup 的 catalog-started ENOENT；未降低计时阈值、未排除测试，最终全量另行重跑。
  - 通用多源阶段 typecheck 已通过（Host/Client against DSH 0.2.2-rc.2，退出 0，/tmp/task-d-universal-typecheck.log）。该阶段关联 `corepack pnpm vitest run tests/cli-management`：19 文件、588 项通过，0 failed/0 skipped，00:13:56，23.74 秒、退出 0；/tmp/task-d-universal-related.log。
  - 通用多源阶段 `corepack pnpm build:preview` 通过、退出 0，仅隔离 .cache/preview-package；7 个相关 Host 文件和共享协议共 8/8 与隔离包逐字节一致，/tmp/task-d-universal-preview.log。未正式 build 或修改 Desktop 链接。
  - 本续任务网络只额外执行 8 次获准沙箱外匿名 HEAD（npm 标准地址/CDN/官方普通及 Range HEAD/scoped Codex 跳转共 5 次，三个官方桌面包各 1 次），未 GET 工件或执行真实安装器；npm 首次沙箱 HEAD DNS 失败后申请升级。所有新测试均为模拟。

  - scoped npm 的额外 HEAD 发现 CDN 把 @openai 编码为 %40openai，已修正标准路径生成及模拟。正在运行的默认并发全量（00:17:18）未保持固定源码快照，记录为中间结果：305 files passed / 3 failed / 4 skipped（312），6944 passed / 4 failed / 14 skipped（6962），1 unhandled error，280.66 秒、退出 1；/tmp/task-d-universal-full.log。失败含 npm 双向慢速 2 项、native-agy-acp 1 项、pi-omp-adapter 1 项；不作为最终验收证据。
  - scoped 修正后 typecheck 再次通过，/tmp/task-d-delivery-typecheck.log；关联再次 19 文件 588/588 passed，0 failed/0 skipped，00:22:28，10.32 秒、退出 0，/tmp/task-d-delivery-related.log。冻结本任务 14 个源码/测试文件哈希；最终全量改用 maxWorkers=4 执行全部用例，不改测试超时、不排除文件。

  - 固定源码 maxWorkers=4 全量（00:24:04）：307 files passed / 1 failed / 4 skipped（312），6947 passed / 1 failed / 14 skipped（6962），209.98 秒、退出 1；/tmp/task-d-delivery-full.log。唯一失败 native-agy-acp 的 sandbox argv 断言，该文件单独复跑 42/42 passed（12.15 秒，/tmp/task-d-delivery-failure-recheck.log）；根因未定位，不据单跑抹去全量失败。
  - 固定源码单 worker 全量（00:29:57）：`corepack pnpm vitest run --maxWorkers=1`，308 files passed / 4 skipped（312），6948 passed / 14 skipped（6962），0 failed，449.30 秒、退出 0；/tmp/task-d-delivery-full-serial.log。未改测试、阈值或排除文件。
  - 交付复核发现操作中修改 source 设置会影响已启动操作。新增官方/custom 双向设置切换模拟先复现：11 passed / 2 failed（13），/tmp/task-d-settings-regression-before.log。修复为 launch 同步锁定 registry 与 automaticSources，首次安装规划/重查、npm 更新与 MiMo 交接都使用快照；不变更下一次操作生效规则。
  - 该边界修复后关联 `corepack pnpm vitest run tests/cli-management`：19 文件、590/590 passed，0 failed/0 skipped，00:38:43，3.72 秒、退出 0；/tmp/task-d-complete-related.log。typecheck 再次通过，/tmp/task-d-complete-typecheck.log；随后重新跑完整交付验证。

  - **最终全量（包含操作设置快照修复，00:39:47）**：获准沙箱外 `corepack pnpm vitest run --maxWorkers=1`，**308 files passed / 4 skipped（312）；6950 tests passed / 14 skipped（6964）；0 failed**，425.80 秒、退出 0；/tmp/task-d-complete-full.log。全部文件参与，没有修改超时或跳过新增用例；本任务 14 个源码/测试文件的运行前后哈希 14/14 一致。
  - 最终 typecheck、关联 19 文件 590 项、build:preview、严格规格校验及指定 Git diff --check 均通过；完整命令日志使用 /tmp/task-d-complete-{typecheck,related,preview,spec}.log。隔离构建后源码 8/8 与两份 README 2/2 核对；保护文件（Client、设置设计、PRD、主会话桌面更新等）哈希 95/95 保持一致。本续任务 20 个文件，不提交 Git、不改版本、不正式 build、不更新 Desktop 链接。
  - 整体 change 共 60 子任务，49 完成、11 未完成；保留 11.6 MiMo/OMP 本地交接实机及此前平台/界面验收缺口，不归档。新增 progress.sourceHost 前端显示由主会话负责；桌面 366 MB 残留原因仍未定位，未删除外部安装器目录。网络范围仅上述匿名 HEAD，新增测试全部模拟；无真实 CLI 更新/安装、账号/模型或 Desktop/Windows/Linux 实机验收。

- [x] 9.3 任务 D 续追加：MiMo 与 npm 通用自动换源、身份一致性与校验
  - 通用 sources 列表已加入下载器，MiMo 传入内置 host/路径白名单源，API 域名优先、原域名备用；latest 同步回落。每次切换前 HEAD 核对首个成功源的长度/ETag/content-md5，Range/If-Range 保留字节，GET 身份/206 范围严格复核；MD5 支持 hex/base64，失败复用一次干净重下。
  - 3c 追加后 npm 主 tarball 同步接入；所选源/follow 当前 registry 优先、custom 关闭换源（含 MiMo），官方 sha512 始终作为最终校验，不采用镜像 integrity。镜像标准 URL 的精确 CDN 跳转及官方 Range HEAD 总长度通过匿名 HEAD 核实；GET 不跟随重定向。
  - 可选 progress.sourceHost 已加入，前端显示留主会话；不改 src/client/**。三个桌面包匿名 HEAD 均 200，长度 305,360,326 / 447,126,372 / 478,466,147 B，未获取第二官方同对象域名，保持单源；详情在 design.md。
  - 全部新增网络/归档/安装测试均为模拟；用户提供两源实机速度、长度/MD5 一致性记入 design.md，未冒充本轮实测。其他候选仅列 Codex/Grok 官方脚本双地址依据，未配置多源、未推断实测同对象一致。

## 10. macOS 系统代理注入（任务 F） 〔后端｜4h｜前置 2,4〕
- [x] 10.1 新增有界 scutil 解析来源，共享 Windows 缓存、环境优先级与进程清理，接入 darwin 后端及 Host 查找
  - 新增 system-proxy.ts（共享接口、缓存、环境规则、有界读与生命周期）、macos-system-proxy.ts（仅根字典，HTTPS 优先再 HTTP），Windows 保留旧导出兼容；index darwin 接线，停用 close 等待读取退出并撤销 lookup。5 秒/64 KiB/500 ms grace/15 秒按需 TTL；同步 current 不等待、终端与 Host fresh 等待；失败或关掉清空旧值。
  - 主机仅 hostname/IPv4/带括号 IPv6 与 1–65535 端口；PAC/自动发现/SOCKS 无显式 HTTP(S) 时不猜不注入，每来源一次固定诊断；保留已有代理及显式 undefined 决定权。ExceptionsList 的主机、精确 IP 与 *.domain 转点前缀（含 .local），CIDR/169.254/16/任意通配等丢弃；回环始终加入注入环境。host-fetch 同时支持 macOS Host/Pi/OMP，保留 User-Agent。
- [x] 10.2 模拟回归覆盖解析、环境/显式删除、回环、darwin/linux、Host 查找、刷新与清理
  - 新增 tests/macos-system-proxy.test.ts：54 项全部为模拟，覆盖有效/关闭/异常代理、HTTPS→HTTP、PAC/自动发现/SOCKS、IPv6/异常端口、例外各形态、环境/显式删除、回环、darwin/linux、Host 查询、User-Agent、刷新合并/失效/失败/超限/超时及停用清理；另更新 Windows 既有测试以匹配共享 Host 查找。
  - 首轮沙箱内 2 文件、65 passed / 2 failed（67），其中本轮 parser 对 IPv6 zone id 的 Invalid URL 已修正；另一项为 Windows CONNECT 模拟 listen EPERM（连带 15 秒超时与 1 unhandled error）。日志 /tmp/cliworker-F-proxy-tests.log，不作为通过证据。
  - 修正后沙箱内 macOS 文件 54/54 passed，1.27 秒；获准沙箱外 `corepack pnpm vitest run tests/macos-system-proxy.test.ts tests/windows-system-proxy.test.ts`：2 文件、68/68 passed，0 failed/0 skipped，0.887 秒，退出码 0；/tmp/cliworker-F-proxy-tests-final.log。
  - 沙箱外 `corepack pnpm vitest run tests/native-process.test.ts tests/native-launch.test.ts tests/windows-hidden-process.test.ts tests/windows-codex-launch.test.ts tests/windows-codex-background.test.ts tests/hermes-nous-proxy.test.ts tests/hermes-nous.test.ts`：7 文件、126/126 passed，0 failed/0 skipped，2.96 秒，退出码 0；/tmp/cliworker-F-related-tests.log。
- [x] 10.3 只读运行一次本机 scutil 经解析器，核对主机端口及 NO_PROXY 条目数
  - 沙箱内 node --import tsx 运行解析时读数为无代理；获准沙箱外只读运行一次 `/usr/sbin/scutil --proxy`，参数数组、5 秒/64 KiB，经 parseScutilProxy/proxyEnvironment，仅输出主机 127.0.0.1、端口 7897、NO_PROXY 条目数 5；退出码 0，stderr 0 B。结果 /tmp/cliworker-F-local-proxy-live.json。没有输出 scutil 原文或其他配置，没有修改系统/launchd，没有真实 CLI/模型/账号调用。
- [x] 10.4 同步中英 README、架构设计、增量规格及进程覆盖面
  - README.md/README.en.md、doc/design.md、本变更 design.md/specs/cli-update/spec.md 同步；覆盖表与 curl/Node 依据见 design.md 决定 F。只核对调用链，不冒充真实 CLI 验收。
  - 共用 backend 覆盖 Worker、账号终端、更新/安装命令、版本/账号/模型探测；native/terminal/private/Pi/OMP helper 的子进程继承已注入环境。例外：系统代理读取用 raw backend 避免递归；OMP 私有离线 --help 主动移除网络变量；本地文件权限/进程身份/签名挂载命令不需要网络；WorkBuddy GUI 由操作系统负责网络。未改 src/host/cli-management/** 或 src/client/**。
  - 并行任务把原 8.13/8.14 调整为第 9 组，故 F 使用第 10 组；严格校验发现第 9 组职能“开发与测试”无效，仅改为其实际职能“后端”，不改该组内容和勾选。
- [x] 10.5 执行 typecheck、相关测试、获准沙箱外全量 vitest、隔离 preview 与严格规格校验并记录确切结果
  - `corepack pnpm typecheck`：Host/Client against DSH 0.2.2-rc.2 通过，退出码 0；/tmp/cliworker-F-typecheck.log。
  - 获准沙箱外 `corepack pnpm vitest run`（00:10:06）：311 文件中 304 passed / 3 failed / 4 skipped；6950 项中 6929 passed / 7 failed / 14 skipped，276.03 秒，退出码 1；/tmp/cliworker-F-full-vitest.log。全量未达到零失败，本项勾选仅表示已执行并记录完整结果。
  - 全量失败文件（均非本轮修改）：native-agy-acp.test.ts 3 项（探测 argv/审批标志断言）；native-agy-account-permissions.test.ts 1 项（模拟 audit.jsonl ENOENT）；native-bridge-time-limit.test.ts 3 项（模拟 pid ENOENT 2 项、审批 hold 超时 1 项）。这些测试直接启动本地 Node 夹具，不经过此次 Host/nativeProcessBackend 代理注入；未发现直接关联，失败根因未定位，不能凭此宣称全量通过。
  - 获准沙箱外 `corepack pnpm vitest run tests/native-agy-acp.test.ts tests/native-agy-account-permissions.test.ts tests/native-bridge-time-limit.test.ts`：3 文件、62/62 passed，26.55 秒，退出码 0；/tmp/cliworker-F-full-failures-recheck.log。保留上条全量失败，未改用例、超时或并发阈值。
  - `corepack pnpm build:preview`：通过、退出码 0，仅 .cache/preview-package；6 个本轮 Host 文件与隔离源码逐字节一致（6/6），/tmp/cliworker-F-preview.log；未正式 build 或更新 Desktop 链接。`corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict`：valid，退出码 0；/tmp/cliworker-F-spec-validate-final.log。指定文件 git diff --check 通过。
  - 边界：全量零失败尚未取得；真实 CLI/安装/更新、账号/模型、Desktop、Windows/Linux 实机验收没有执行，不以模拟/只读配置证据代替。保留整个 change 其他未完成项，不归档；不提交 Git、不推送、不改版本或用户配置。

## 11. 实机验收发现的修复与下载接管 〔后端｜前置 8〕
- [x] 11.1 修复实机检查的 Kimi 跳转、auto 入口迁移与 Pi 重探测、ZCode runtime 应用关联
  - 本轮任务 C：仅 Host、测试及本变更文档；不改真实路径记录，不执行真实更新，不修改 Pi Worker 支持集合。
  - 根因与修复：Kimi 旧域名四个地址均 302，改为直接 CDN，保持 redirect:error；auto 保存发现入口，旧已知版本目录前台迁移并保留 revision 保护，manual 不变；Pi 管理解析允许新版本但 Worker 仍拒绝 1.5.2，current-version 切换后实体路径和 manifestVersion 改变使缓存失效；ZCode 固定 runtime 以已核实 bundle id 关联默认应用，读取 Info.plist，并在 notice/outputTail 明示独立 runtime 未同步更新。
  - 新增 `cli-management-acceptance-fixes.test.ts` 的 31 项均为模拟，涵盖各旧版本实体迁移/manual 不动、失败与并发手动覆盖保护、Pi 缓存/真实 resolver 链/更新后重探测、ZCode bundle 不符/缺失不映射/应用版本和更新结果提示、Kimi CDN 地址及无跳转。首次 29 passed / 2 failed 为夹具误用导出名与可选字段断言，已修正；随后关联回归中 31/31 通过。
  - 只读实机证据：16 条 auto 中 Pi 为 1.0.4 实体而 current-version=1.5.2；ZCode 应用 3.17.2、bundle=dev.zcode.app、codesign team=8A5X4JJ39T，独立 runtime INSTALL-MANIFEST 为 2026-10-05 源树构建 0.16.9。17 CLI 清单、来源脚本与 runtime 不自动覆盖依据见本变更 design.md。匿名 GET 读取 Kimi JSON/text 均为 2.6.1；四个 CDN HEAD 均 200。
- [x] 11.2 任务 C 模拟回归、类型检查、全量测试、隔离构建与严格校验
  - `corepack pnpm typecheck`：两次通过，Host/Client against DSH 0.2.2-rc.2，退出码 0。
  - `corepack pnpm vitest run tests/cli-management tests/cli-executable-paths.test.ts tests/cli-executable-management.test.ts tests/pi-installation.test.ts tests/pi-omp-adapter.test.ts tests/zcode-adapter.test.ts tests/windows-cli-resolution.test.ts`：沙箱内 18 文件通过/1 文件失败，626 passed / 118 failed（744），失败均为 Pi/OMP fixture 的 `listen EPERM: operation not permitted 127.0.0.1`；获准沙箱外同命令重跑（23:07:18，165.60 秒），**19 文件、744 项通过**，退出码 0。`tests/pi-installation.test.ts` 不存在，过滤名未选中测试，不计入执行证据。
  - `corepack pnpm vitest run tests/pi-omp-identity.test.ts tests/pi-omp-native.test.ts tests/pi-omp-windows-directories.test.ts`：沙箱内 **3 文件，46 passed / 1 skipped（47）**，1.46 秒，退出码 0；是模拟入口/身份/目录覆盖，不是 Windows 实机验收。
  - 获准沙箱外 `corepack pnpm vitest run` 第一轮（23:07:27，171.32 秒）：**1 failed / 301 passed / 4 skipped（306 文件）；1 failed / 6776 passed / 14 skipped（6791 项）**，退出码 1。唯一失败为未改动的 `native-bridge-time-limit.test.ts` 工具审批 hold/release 用例，原始错误“原生引导通路已关闭或尚未准备”。日志 `/tmp/task-c-full.log`。
  - 沙箱外 `corepack pnpm vitest run tests/native-bridge-time-limit.test.ts`：**1 文件、4 项通过**，10.16 秒，退出码 0。第二轮默认并发全量（23:11:24，152.97 秒）仍 **1 failed / 301 passed / 4 skipped（306 文件）；1 failed / 6776 passed / 14 skipped（6791 项）**，退出码 1；这次失败是同文件的 heartbeat 用例，期待 total timeout、实际 idle timeout。日志 `/tmp/task-c-full-final.log`。没有改用例、放宽阈值或修改无关生产逻辑；后续以 4 worker 全量核对负载影响。
  - `corepack pnpm build:preview`：通过，退出码 0，生成 `.cache/preview-package`；仅既有 CJS/依赖打包提示。5 个本次 Host 源文件与 preview/src/host 逐字节一致（5/5）；没有正式 build、Desktop 链接更新。
  - `corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict`：valid，退出码 0；指定 Git `diff --check` 通过。
  - 获准沙箱外 `corepack pnpm vitest run --maxWorkers=4`（23:14:13，156.23 秒）：**Test Files 302 passed / 4 skipped（306）；Tests 6777 passed / 14 skipped（6791）**，退出码 0，无失败。日志 `/tmp/task-c-full-4workers.log`。仅限制测试进程并发，未改计时阈值、未跳过新增用例。默认并发两轮未全绿的风险保留，不把本轮结果描述为默认命令通过。
  - 最终严格校验与指定 Git diff --check 均通过；新增 11.1/11.2 完成，本变更整体仍有其他真实平台验收待办，不归档。未执行真实 CLI 更新、账号/模型或 Desktop/Windows 实机验收；未写 ~/.dsh 真实路径记录；未提交 Git。Client、UI 文档和已有其他改动由主会话维护，本轮未触碰。

- [x] 11.3 任务 D：下载网络中断续传、慢速重连与外部命令证据重跑
  - 网络异常/提前 EOF 与停滞共用 200 次和 2 小时；新增单一 100,000 B/s 阈值，确认 Range 能力的 10 秒窗口低于阈值才重连，保留已写入字节；200 次耗尽仍进展则不断开，真正停住 10 秒失败。无 Range 声明或已忽略 Range 时不按慢速中断，外部命令不因慢速或无输出重跑。
  - executor 在脱敏/32 KiB 显示截断之前流式识别中断，跨块窗口 256 字符；原 argv 重跑必须在进程范围退出及版本核对后，身份改变/清理未确认/无证据/版本前进不重跑，取消和 2 小时边界保留。新增可选 progress.retryCount，输出区复用“已自动重试 N 次”；未改 Client。
  - 本轮新增 3 个模拟文件，最终合计 68 项：interruption 44、local-artifacts 18、slow-download 6。包含下载各类中断、TLS/HTTP/206/长度拒绝、200/2 小时、原始超长输出、跨块证据、退出 0/非零、清理隔离、取消、慢速阈值、预算耗尽后继续/真正停住、外部慢速不重跑。
- [x] 11.4 任务 D：逐个核实官方本地工件入口并接管可支持的下载
  - 任务 D 初版（接管决策已由任务 D 续 §9 覆盖）：14 CLI 审计表、原始脚本行号与 MiMo 方案写入本变更 design.md；Unix 默认原生 OpenCode V1、OMP 和 TRAE public 接管官方工件下载/校验后交官方本地入口，实际安装版本必须等于已锁定工件目标；TRAE 首次 Unix 安装也交 offline-install。只使用内置模板、受限发布源与固定签名资产主机。npm 主包接管、其他归属与手动安装范围保留。
  - 用户追加要求将 MiMo 接管留主会话决定：最终代码明确不启用，保留原生中断重跑；设计列出官方 --binary 和原脚本 335–368 行步骤，无需复刻安装。TRAE 离线模式关闭自身自动更新，输出/文档均明确。
  - 网络实际仅匿名 GET 5 个官方脚本（MiMo、TRAE v2、OpenCode、OMP、Claude，另读 TRAE 旧 install.sh），HEAD MiMo zip 200/33,817,652 B/Accept-Ranges: bytes，未 GET 二进制或执行脚本。初次沙箱 OpenCode GET 为 DNS 错误，获准沙箱外重试成功。
  - 只读见外部 MiMo 临时目录 2 个、各 1 文件：11,091,327 B 与 27,181,941 B，合计 38,273,268 B；未删除。实机更新退出和原安装完好由用户提供，本轮没有执行真实更新。
- [x] 11.5 任务 D：模拟、类型、全量、隔离构建与严格校验，记录边界
  - `corepack pnpm typecheck`：最终含慢速规则通过，Host/Client against DSH 0.2.2-rc.2，退出码 0；日志 `/tmp/task-d-typecheck-final2.log`。
  - `corepack pnpm vitest run tests/cli-management`：最终 **17 files passed；539 tests passed**，0 failed/0 skipped，3.50 秒，退出码 0；`/tmp/task-d-related-final2.log`。
  - 获准沙箱外 `corepack pnpm vitest run`（23:46:12）：最终 **305 files passed / 4 skipped（309）；6845 tests passed / 14 skipped（6859）**，0 failed，103.28 秒，退出码 0；`/tmp/task-d-full-final2.log`。使用默认并发，没有排除用例或改计时阈值。
  - 本地工件目标版本一致性补充前的全量（23:41:18）也通过：**305 files passed / 4 skipped（309）；6844 tests passed / 14 skipped（6858）**，78.95 秒，退出码 0；`/tmp/task-d-full-final.log`。补充对应模拟后重新执行上一条全量。
  - 新增慢速要求前的中间全量（23:37:29）：**304 files passed / 4 skipped（308）；6839 tests passed / 14 skipped（6853）**，82.54 秒，退出码 0；`/tmp/task-d-full.log`。仅作中间记录，最终验收以上一条为准。
  - `corepack pnpm build:preview`：通过、退出码 0，仅隔离 `.cache/preview-package`；8 个相关源码与隔离包逐字节一致（8/8），日志 `/tmp/task-d-preview-final.log`；既有 CJS/打包提示，没有正式 build/更新 Desktop 链接。`corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict`：valid、退出码 0；指定 Git diff --check 通过。
  - 中间失败保留：首次 typecheck 的闭包 file 可选类型错误已修正；首轮关联 470 passed/1 failed 是退出码被版本错误覆盖，已修复错误优先级；中断新文件首轮 31 passed/11 failed 为逐字符证据窗口拼接缺陷，修复后全过；接管首轮 80 passed/3 failed 为模拟 HTTP Header/依赖路径误用中文，改用明确模拟 ASCII 路径后全过。没有修改无关生产逻辑来规避失败。
  - README 中英、doc/design.md 与本变更规格/设计同步。未改 src/client/**、doc/settings-ui-design.md、PRD 或任务 C 其他文件；Client 顶层及设置设计文档哈希 70/70 与任务开始时一致；未提交 Git。真实 CLI/安装器、模型/账号、Desktop、Windows/Linux 实机验证均未执行；不归档。
  - 主会话桌面更新追加信息核对（23:50:12）：只读确认 `desktop-update.ts` 已使用单个 `-R=anchor …` 参数，清理失败保留原 CliOperationError 码并附 errno/路径；没有覆盖该文件及其测试。补跑 `corepack pnpm vitest run tests/cli-management-desktop-update.test.ts tests/cli-management-all-updates.test.ts tests/cli-management-interruption.test.ts`：**3 文件、244 项通过**（桌面 106 + 全部更新 94 + 中断 44），0 failed/0 skipped，1.08 秒，退出码 0；日志 `/tmp/task-d-desktop-followup.log`。
  - 用户补充签名失败后 `cli-management/desktop-update-XXXX` 约 366 MB 残留，原因未明。本轮仅记录用户实机证据，未定位实际目录、未删除；保留原错误码的修改不等于清理失败根因已解决。任务 D 的 downloads/local-* 清理不扩展到桌面暂存目录。
- [x] 11.6 MiMo 与 OMP 本地交接真实验收
  - MiMo 由主会话在 2026-11-14 已验收 0.1.15 → 0.1.17（官方 FDS / content-md5），详见 7.3；本轮没有重复调用 MiMo。
  - 2026-11-14 OMP：`GAPS_SKIP_NPM=1 node .cache/gaps-isolated-launch.mjs`（沙箱外）在隔离 HOME 以插件真实 `prepareLocalUpdate` → `executeCliOperation` → `identifyInstallation/currentVersion` 链路先装 18.19.0，再更到官方 latest 18.20.0。同一入口 `<隔离 HOME>/.local/bin/omp`、self-update 身份不变；两次官方工件按 build service 的 size/SHA-256 核对后，官方脚本参数数组 `[/bin/sh, 私有install.sh, --binary, --ref, v目标]`，进程局部 `PI_BUILD_URL=file://私有目录`、`PI_INSTALL_DIR=<隔离 HOME>/.local/bin`。两次安装与两次装后 --version 共 4 个进程全退出 0、waitForExit 全 true；明确输出两次“已接管 OMP 官方工件下载”。证据 `.cache/gaps-live/omp-report.json`、/tmp/gaps-omp-live-corrected.log。
  - 本次修复发现的脚本入口：omp.sh/install 302 至官方 raw.githubusercontent.com，下载器拒绝跳转；sources 已改成核实的最终官方地址，并加模拟回归。不执行 --source、不代装 Bun；官方脚本提示用户 PATH 中仍有现有 OMP，但未执行/替换该用户安装，也未改 PATH。
  - 中间脚本错误保留：首次 GET 在旧脚本入口失败；后续验收脚本把 local.env 误放入 timeoutMs 参数而立即报 INSTALL_TIMEOUT，修正为 undefined, local.env 后完成上条真实验收。不是生产安装超时，未修改生产超时阈值。18.19.0 / 18.20.0 交接目录均在成功后由 local.cleanup 删除；历史失败的 0 B part 随最终隔离目录统一清理。没有真实模型、账号或 Desktop 调用。

- [x] 11.7 修复实机验收发现的桌面应用暂存清理、Codex 安装脚本跳转与笼统报错
  - 桌面应用（`desktop-update.ts`、首次安装 `desktop.ts`）的文件操作改走新增的 `src/host/cli-management/physical-fs.ts`（Electron 下取 `original-fs`，普通 Node 不变），避免 `app.asar` 被当作目录导致 `ENOTEMPTY` 回滚；`desktop.ts` 的 codesign 要求同样改成单个 `-R=…` 参数。
  - Codex 安装脚本地址改为 `https://releases.openai.com/codex/install.sh`；下载遇到跳转（`redirect: 'error'`）时报 NETWORK「官方下载地址 <host> 已跳转到其他位置，插件不跟随跳转」，不再落到「更新失败，请检查网络…」。
  - 测试（模拟）：新增 `tests/cli-management-physical-fs.test.ts` 3 项、`tests/cli-management-download.test.ts` 跳转 1 项；`tests/cli-management-desktop.test.ts` 断言改为 `-R=`。`corepack pnpm typecheck` 通过；`corepack pnpm vitest run tests/cli-management` 20 文件 594 项通过；页面相关 `tests/cli-update-page.test.tsx tests/client-i18n.test.tsx tests/cli-management` 636 项通过。真实复测见 7.3。
  - 2026-11-14 01:07 全量 `corepack pnpm vitest run`：313 文件（309 通过、4 跳过）、6954 项通过、14 项跳过，0 失败；退出码 1，原因是 `tests/codebuddy-account.test.ts` 满载时 1 个未处理拒绝（临时目录 lstat ENOENT），该文件与对应源码本轮未改，单独连跑 3 次各 76 项全过、无错误。`corepack pnpm build:preview` 成功；`corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict` 通过（提示主任务 8 子任务超过 12 个）。
- [x] 11.8 修复 Windows 更新页 ZCode、Hermes、WorkBuddy 检查失败及冷启动并发超时
  - 用户 2026-11-14 Windows 截图：ZCode、Hermes Agent、WorkBuddy 三项「读不出当前版本」。SSH 只读核实根因：① Hermes Windows 启动器在 `%LOCALAPPDATA%\hermes\bin\hermes.exe`，`install-stamp.json`（baseVersion 0.21.7）在同级 `hermes-agent\`，原逻辑只向上层找；② ZCode Windows 入口是插件部署的完整 runtime（`~/.local/share/cliworker-now/runtimes/zcode`），只有 macOS 会关联 ZCode.app，runtime 自带 `INSTALL-MANIFEST.json`（0.16.9，官方源 origin）却未读取，且该文件 723 KB 超过 128 KB 元数据上限；③ 注册表只登记国内版 `D:\Software\workbuddy`，国际版解析拿到它后判「站点不符」，落入检查失败。
  - 修复（a8aa99c、fae2894、6c00cdc）：Hermes 在 bin 上一级查同级检出并增加 `AppData/Local/hermes/` 布局（与 macOS 同为自带更新）；ZCode 无桌面应用关联时读 runtime 清单（仅官方 origin，上限 4 MiB），来源新增 `plugin-runtime` 并给出手动说明；WorkBuddy 自动发现到另一站点视为未安装，用户指定路径仍报站点不符；失败原因与补充说明之间补句号。验收中发现冷启动打开设置时 OMP、TRAE CN 并发超过 5 秒（单独 `--version` 0.9 秒、0.5 秒），Windows 本机检查时限改 15 秒，超时注明「读取当前版本超时，可点「检查更新」重试」。
  - 模拟测试：Hermes Windows 同级检出与不越级、ZCode 大清单与非官方 origin、WorkBuddy 自动/手动站点不符、超时原因各有回归；ZCode 用例在旧 128 KB 上限下失败、新上限下通过。`corepack pnpm typecheck` 通过；相关 70 文件 1533 项通过。
  - Windows 实机（DSH 0.2.2-rc.3，经「应用 → 退出」正常关闭，空闲闸门 activeWorkers=0）：6c00cdc 包 SHA-256 74f1d4ab7b50…，原生安装器退出 0，1169/1169 文件逐一哈希一致。冷启动后立即打开「更新 CLI」：0 项检查失败，可更新 10（Codex、Kimi、MiMo、Grok、Pi、Hermes 0.21.7→0.23.1、OpenCode、Qoder、Qoder CN、CodeBuddy），需手动 5（ZCode 0.16.9「CLI Worker 部署的完整 runtime」、Antigravity、Claude Code、OMP、TRAE CN「没有识别出安装方式」），未安装 1（WorkBuddy）；WorkBuddy CN 为桌面应用手动（NO_RELEASE_SOURCE）。Host 状态文件 17 项与界面一致。
  - 未执行：任何真实更新（含 Hermes）；Antigravity、Claude Code、OMP、TRAE CN 的 Windows 安装布局与自带更新命令尚未核实，仍为手动；英文界面实机；全量 vitest。Windows `%LOCALAPPDATA%\hermes\.hermes-update-in-progress.lock`（0 字节，2026-10-11）为旧遗留，可能影响 Hermes 自带更新，未处理。

- [x] 11.9 Windows 适配 Antigravity、Claude Code、OMP、TRAE CN 自带更新并真实更新验收
  - 识别（633a530）：按官方 install.ps1 目标精确匹配 `%LOCALAPPDATA%\agy\bin\agy.exe`、`%LOCALAPPDATA%\omp\omp.exe`、`~/.local/bin/claude.exe`（NTFS 不区分大小写，仅 Windows 盘符路径生效，POSIX 不放宽）；TRAE 增加 `AppData/Local/TraeCLI/` 布局与带版本 auto 入口，同一 releases 根下同名入口视为同一安装。模拟回归在 cli-management-source-layouts。Windows 实机（DSH 0.2.2-rc.3，633a530 包）：可更新 14，四项均为「自带更新」，需手动仅 ZCode（plugin-runtime）与 WorkBuddy CN。
  - 真实更新（2026-11-14 15:25–15:48，逐个执行，C 盘约 1.9 GB）：四项全部在下载阶段停住，没有一项完成。Claude `claude.exe update` 下载到 `~/.cache/claude/staging/<版本>.<pid>.<时间>/claude.exe`，停在 134,306,034 B；同一命令经 SSH 带代理直接执行 4 分钟停在 81,108,992 B（说明与插件无关）。TRAE `traex.exe update --channel public --version 0.215.0` 内部官方 install.ps1 停在 18,483,484 B。OMP `omp.exe update` 写 `omp.exe.<时间>.<pid>.0.new` 停在 82,509,153 B（完整约 225 MB）。Antigravity `agy.exe update`（先出现「确认行为尚未实机核实」行内确认）写 `bin\.new` 停在 33,830,276 B。
  - 根因：Windows 走 Clash Verge（mihomo，127.0.0.1:7897）代理，长连接中途断流；curl 经同一代理取 Claude 150 MB 区间，36.9 秒取到 153,384,276 B 后 20 秒无数据退出 28。四个 CLI 自带更新器都没有续传，界面只显示「正在执行，下载进度无法读取」，插件对外部命令只按输出中的中断证据重跑，静默停滞要等 10 分钟安装超时。下载文件字节实际可读（上述四个路径），PRD 5.6 第 3 条要求的「能读到本次下载字节时按 10 秒规则终止重跑」及第 3a 条「优先由插件接管下载」均未对这四项实现。
  - 取消：四项「取消更新」均在进程树退出后显示「已取消。已写入的文件不会回滚」，旧版本仍可用（omp/18.8.7、agy 1.4.11）。残留（未删除）：Claude `versions\2.1.325`（0 B）及两个 staging 目录（134 MB、81 MB）；TRAE `%TEMP%\traecli-install-*.ps1` 与 18 MB 部分下载（官方脚本 finally 未执行）；OMP `omp.exe.*.new` 82 MB；agy `bin\.new` 33 MB。取消 OMP 后侧栏 OMP 状态点变红，原因未查。
  - 未完成：四项真实更新成功的验收；停滞检测/接管下载的实现。
  - 2026-11-15 补记：上面列的「未完成」两项都已完成。接管下载在第 13 节实现；四项真实更新都把正确版本落到了磁盘（13.5：Antigravity 1.5.9、Claude Code 2.1.325、OMP 18.20.0、TRAE CN 0.215.0，各自 `--version` 核实）。OMP 18.20.0→18.20.2 在当前代码（34133b9）上再次实测：官方补丁超时后插件接管、续传 4 次，页面直接显示「已更新到 18.20.2」，`omp --version` 18.20.2。适配与真实更新都已验收，故勾选。Antigravity 和 Claude 当时被误报失败，修复（13.6/13.7）后未再做一次真实更新来确认成功提示，这一点与接管期间取消一起留在 13.5。

## 12. 设置页连接状态预加载 〔后端｜8h｜前置 3〕
- [x] 12.1 审计 17 个 CLI 的账号、模型及强度读取；将安全投影接入空闲队列，记录跳过原因
  - 证据：sources 两份后台名单、accounts 的 background/activeOnly 分支与 settings-connection-background；完整 17 CLI 审计表见 design 决定 12，仅源码审计和模拟测试。
- [x] 12.2 接入项目与 CLI 隔离的连接缓存、时间与版本、失效及推送，兼容原有前台接口
  - 新增 settings-connection-cache（内存、10 分钟、项目 SHA-256 + CLI + account/catalog 分槽），共享 checkedAt/stale/project/revision/displayOnly；失效中止并等旧查询清理，旧版本回执不得发布；订阅与 Host 关闭可取消/清理。
  - cliSettings.settingsCache.connections、settingsConnectionStatus 和 watchSettingsConnections 供前端读取；原 accountStatus/catalogForCli 命中无需起进程，过期/缺失现查后推送。账号切换/登录/退出、启用与入口变化、安装身份变化和清理阻塞使两槽失效；快照剔除动作/退出句柄，过期或无 verification 的 authenticated 降为 unknown。
  - 仅 ZCode 模型目录纳入后台，7 个 CLI 的安全账号投影纳入；Kimi 探测统一补 KIMI_CODE_NO_AUTO_UPDATE=1。安全集合外仍走原前台查询，不改 Hermes 续期。实际实现与隔离包 16 个 src 文件逐字节一致（16/16）。
- [x] 12.3 执行模拟回归、类型检查、沙箱外全量测试、隔离构建与严格规格校验并记录结果
  - 新工作树先执行 corepack pnpm install --frozen-lockfile --prefer-offline，安装完成；新增夹具均标注“模拟”。最终相关命令：corepack pnpm vitest run tests/settings-connection-cache.test.ts tests/cli-management-remotes.test.ts tests/cli-management.test.ts tests/settings-catalog-cache.test.ts tests/accounts.test.ts tests/cli-settings.test.ts tests/provider-login-status.test.ts tests/zcode-grok-accounts.test.ts tests/first-party-models.test.ts --maxWorkers=4，9 文件、547 passed、0 failed，35.44 秒；日志 /tmp/connection-related-final.log。
  - 随后补充登录/退出跨项目作废用例并执行 corepack pnpm vitest run tests/cli-settings.test.ts --maxWorkers=1：1 文件、166 passed、0 failed，22.36 秒；/tmp/connection-login-regression.log。覆盖缓存命中不起进程、TTL/时钟回退、项目隔离、source revision/入口/启用/登录退出作废、晚回执拒绝、强刷串行、无副作用集合、任务/登录打断后恢复、清理与订阅退出。
  - 沙箱内原生进程夹具曾因 /bin/ps EPERM 失败，随后获准沙箱外执行全量。默认并发 corepack pnpm vitest run：10 failed / 301 passed / 4 skipped（315 文件），35 failed / 7015 passed / 14 skipped（7064 项），465.90 秒，退出 1；/tmp/connection-full-unsandboxed.log。此轮处于后续修复与生成类型文件期间，包含未生成 lib、当轮尚未完成的来源回执围栏及原生时序失败，不作为最终代码通过证据。
  - 最终生产代码沙箱外 corepack pnpm vitest run --maxWorkers=4：3 failed / 308 passed / 4 skipped（315 文件），3 failed / 7048 passed / 14 skipped（7065 项），260.26 秒，退出 1；/tmp/connection-full-4workers.log。失败文件均未修改：cli-management-acceptance-fixes.test.ts 的 Pi 1.5.2 拒绝预期、native-agy-acp.test.ts 的模拟 audit.jsonl ENOENT、native-bridge-time-limit.test.ts 的审批 hold/release 通路关闭。
  - 沙箱外 corepack pnpm vitest run tests/cli-management-acceptance-fixes.test.ts tests/native-agy-acp.test.ts tests/native-bridge-time-limit.test.ts --maxWorkers=1：2 passed / 1 failed（3 文件），79 passed / 1 failed（80 项），23.75 秒，退出 1；/tmp/connection-full-failures-isolated.log。两个原生文件复跑全过；Pi 测试第 106 行仍要求拒绝 1.5.2，而基线 f510f75 的 pi-installation.mjs 已支持该版，是基线断言冲突；未修改无关用例、超时或生产逻辑。保留全量未全绿事实。
  - corepack pnpm build:preview 通过，仅 .cache/preview-package；/tmp/connection-preview-final.log。新工作树需要 Remote 类型，将该隔离包 lib 复制为本工作树被忽略的 lib 目录后 corepack pnpm typecheck 通过（Host/Client against DSH 0.2.2-rc.3）；/tmp/connection-typecheck-final.log。未正式 build、未更新 Desktop 链接。
  - corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict 与指定 Git diff --check 通过。本项勾选仅表示已执行并记录，零失败全量结果尚未取得；真实 CLI/账号/模型、用户目录元信息前后对比、Desktop 与其他平台实机验证没有执行，不能以源码审计和模拟代替。
- [x] 12.4 同步设计、README 与前端接入契约，本地提交
  - README.md、doc/design.md、增量规格及本变更 proposal/design 同步；3.1 按安全账号与目录范围完成，17 CLI 审计及未纳入原因见 design 决定 12。前端精确契约见 12.5，保持未勾选；src/client/** 与 src/host/hermes-renewal.ts 无修改。仅本地提交、不推送、不改版本、不归档。
- [x] 12.5 前端消费连接快照和订阅、缓存时效及侧栏状态
  - 改动文件：新增 `src/client/settings-connection-view.ts`（纯函数：10 分钟时效、状态点判定、到期时刻、缺失/到期补查判定、快照/状态/直读回执按项目+sequence+revision 排序、分槽转条目）；`src/client/settings-dialog.tsx`（首屏用 `settingsCache.connections`，项目与 metadata 一致且 Host 有两项新方法才进入快照模式，否则走旧路径；打开期间只订阅一次 `watchSettingsConnections`，关闭/卸载 abort；当前 CLI 用 `settingsConnectionStatus`，其他已启用 CLI 只把缺失或到期的分槽交原最多 2 并发队列；revision 变化取消该 CLI 排队读取、清账号/目录/偏好草稿，value 清空删对应分槽；到期计时器重绘并补查一次；登录/退出/账号窗口/桌面端窗口操作前 `refreshAccountStatus` 取最新 actions，操作窗口使用该次结果；手动刷新仍为 refreshAccountStatus + refreshCatalogForCli；启用状态、入口修改、会话切换清旧值；快照目录过期时模型选择禁用）；`src/client/account-login/accounts-window.tsx`（逐条退出确认前可选 `prepare` 现读，按最新 logins.id 启动）；`src/client/settings-display-cache.ts`（条目新增 `handles`、目录 `cache` 类型）；`src/client/workers.ts`（两项新方法声明为可选，兼容旧 Host）；`src/client/i18n-messages.ts`（两条 Host 状态词条英文）。
  - 状态点：仅 authenticated + verification + cache.stale=false + `0 <= now-checkedAt < 600000` + 无 loading/error/cleanupBlocked 为绿；任何 loading 转圈（原先有旧值时仍显示旧点，现按契约改为转圈，账号摘要文字保留上次结果）；到期后显示中性「登录状态已过期，等待重新核实」。没有 cache 字段的回执视为旧 Host 现查结果，按 verification 判定。修复：Host 现查结果同样带 displayOnly cache，原「打开页面即强制刷新」在新 Host 下会反复调用 refreshAccountStatus；现改为按客户端 `handles` 标记判断，且只在没有连接快照的 Host 上启用。
  - 当前 CLI 的状态接口回答账号仍在读取时，另经队列补一次 `accountStatus`（Host 端并入正在进行的读取，不另起进程），用于显示快照不包含的清理暂停状态。
  - 测试（均为模拟）：新增 `tests/settings-connection-view.test.ts` 14 项；`tests/settings-dialog.test.tsx` 新增「settings connection snapshots from the Host (simulated)」10 项，并按新契约更新 4 处旧断言（读取中转圈、绿点需 verification）；`tests/accounts-window.test.tsx` 新增 2 项。`corepack pnpm typecheck` 通过（Host/Client against DSH 0.2.2-rc.3）；`corepack pnpm vitest run` 指定 10 文件（含 settings-connection-cache 10、cli-settings 166、settings-dialog 282、settings-connection-view 14、accounts-window 6 等）653 passed / 0 failed；扩大到 22 个客户端相关文件 925 passed / 0 failed。`corepack pnpm build:preview` 通过（仅 .cache/preview-package，Remote 类型含 settingsConnectionStatus/watchSettingsConnections）；`corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict` valid。
  - 未执行：真实 Host/CLI/账号/模型、Desktop 与 Windows 实机验证；未改 src/host/**、src/shared/**。
  - 主会话合并（3535b18）后补 Host 缺口：`settingsConnectionStatus` 对处于清理暂停的 CLI 直接返回 `account.value`=隔离状态（cleanupBlocked、无动作）且两槽 loading=false，不再排账号读取，避免当前 CLI 账号一直转圈。`tests/cli-management-admission.test.ts` 新增模拟用例；`corepack pnpm vitest run tests/cli-management-admission.test.ts tests/cli-management-remotes.test.ts tests/settings-connection-cache.test.ts` 28 passed，typecheck 通过。

  - 前端精确接入契约（12.5）：
    - 打开设置先读取 `cliSettings`：保留 `settingsCache.host/project/revisions/preferences` 校验，新增可选 `settingsCache.connections` 为 `SettingsConnectionSnapshot`。只有 host/project 匹配才能复用；新字段缺失时走旧 Host 路径。
    - 快照形状：`{sequence,project,entries:[{cli,project,revision,account,catalog}]}`。两个分槽均为 `{value?,cache?,loading,error?}`；cache 为 `{checkedAt,stale,project,revision,displayOnly:true}`。account.value 为 AccountStatus（无动作/退出句柄），catalog.value 为 `{cli,models,notice}`；efforts/variants 从 models 原样使用，偏好取 settingsCache.preferences，不推测缺失强度。
    - 打开期间仅订阅一次 `watchSettingsConnections(parentSessionId, signal)`；它先发整份项目快照，再发完成/失败/作废变化。按当前 Host、project、sequence 丢弃旧回执，CLI revision 变化或 value 被清空时同步删除客户端旧账号/目录/草稿。关闭时 abort 订阅。
    - 当前 CLI 优先调用 `settingsConnectionStatus(parentSessionId, cli, signal)`，其他已启用 CLI 复用原最多两项并发队列。该方法立即返回已有值并启动缺失/过期部分；不可为了拿动作在每次打开时无条件 refresh。未过期缓存直接显示，账号和目录分别判断加载；有 value 的目录刷新时可保留带过期标记的展示，不代表可执行授权。
    - 状态点：只有 account.value.state=authenticated、有 verification、cache.stale=false 且 `0 <= Date.now()-checkedAt < 600000`、无 loading/error/cleanupBlocked 时显示绿；loading 显示转圈；缺失/unknown/configured/unconfigured 显示中性灰，错误/cleanupBlocked 沿用红；unauthenticated 按原未登录规则，绝不绿。Host 已将过期和未核实 authenticated 降为 unknown；前端仍按时间检查，长期开窗到期时调用状态接口补查，不永久保留绿点。
    - 手动账号刷新使用 `refreshAccountStatus`，随后强制 `refreshCatalogForCli`；仅刷新目录时用后者。执行登录/退出/逐条退出前才 `refreshAccountStatus` 获取最新 actions/logins.id，不使用缓存句柄；操作后清除两槽并重新读取。启用状态、入口修改及 host/project 切换也清除旧值。
    - 原 `accountStatus` 与 `catalogForCli` 参数不变，新增可选 cache；命中不探测，缺失/过期等待现查。新订阅/接口由 preview 构建生成 Remote 类型。禁止将快照目录作为 configure/派遣授权。

- [x] 12.6 按 2026-11-14 用户决定扩大非原生会话连接预加载，共用前台读取、分槽缓存与 CLI 串行清理；完成模拟回归、全量、类型检查、隔离构建和规格校验
  - 实现文件：`src/host/cli-management/sources.ts`、`preload.ts`；`src/host/index.ts`、`accounts.ts`、`settings-connection-background.ts`、`settings-connection-cache.ts`、`native-login-providers.mjs`、`pi-omp-bridge.mjs`。账号 11 项、目录 10 项按项目排队；共用前台加载函数、分槽缓存与同一 CLI 跨项目串行队列；旧取消结果拒收，强刷不被吞掉，清理后至少 30 秒空闲再重试。Pi/OMP helper 保留宿主大小写代理变量；不修改 Hermes 续期脚本。
  - 模拟测试文件：新增 `tests/settings-connection-preload.test.ts`；修改 `tests/settings-connection-cache.test.ts`、`cli-management.test.ts`、`accounts.test.ts`、`native-login-providers.test.ts`、`pi-omp-adapter.test.ts`。覆盖每个纳入 CLI 的账号/目录排队、排除名单、CodeBuddy 仅账号、逐项目登记、串行、缓存与强度复用、前后台合并/强刷排队、打断旧值不回填、关闭等待清理及队列不再启动、单槽失败、清理隔离、Kimi 禁升级和代理保留。
  - 文档文件：`README.md`、`doc/design.md`、本变更 `design.md` 决定 7/12、`specs/cli-update/spec.md` 和 `tasks.md`。保持 Client、Shared、插件版本及 Hermes 续期逻辑不变；整个 change 尚有其他验收缺口，不归档。
  - 环境准备：原 node_modules 是指向主工作区的软链接，pnpm 拒绝删除外部目录；仅解除本 worktree 的软链接，使用 `corepack pnpm install --offline --frozen-lockfile --store-dir /Users/leeyl/Library/pnpm/store` 安装独立的 760 个依赖，缓存数据库访问经沙箱外重试后通过。第一次 typecheck 因 worktree 缺生成 Remote 类型失败；隔离构建后将 preview/lib 复制到本 worktree 被忽略的 lib，随后类型检查通过，不执行正式 build 或更新 Desktop。
  - 初轮沙箱内全量 `corepack pnpm vitest run`：317 文件（296 passed / 17 failed / 4 skipped），7132 项（6759 passed / 359 failed / 14 skipped），20 个未处理错误，212.55 秒、退出 1；`/tmp/preload-full.log` 有 `listen EPERM 127.0.0.1`。期间继续补代理保留及关闭排队回归，因此该轮仅作为环境失败记录，不作为最终源码验收。
  - 真实验证未执行：真实 CLI/账号及续期、模型调用、Desktop、macOS 弹窗与 Windows/Linux 实机；本轮只有模拟与隔离构建，不使用真实账号补证据，不更新 Desktop 链接、不推送、不改版本。
  - 最终关联命令：`corepack pnpm vitest run tests/settings-connection-cache.test.ts tests/cli-management.test.ts tests/cli-management-remotes.test.ts tests/cli-management-admission.test.ts tests/accounts.test.ts tests/settings-connection-preload.test.ts tests/native-login-providers.test.ts tests/pi-omp-adapter.test.ts`；沙箱外 **8 文件、400 passed、0 failed、0 skipped**，81.61 秒、退出 0，`/tmp/preload-related-final.log`。同命令沙箱内曾因 Pi/OMP 回环监听 EPERM 得到 7 文件通过/1 失败、271 项通过/129 失败，沙箱外复跑全部通过。
  - 最终全量：沙箱外单独运行 `corepack pnpm vitest run`，**317 文件（313 passed / 4 skipped），7133 项（7119 passed / 14 skipped），0 failed**，204.73 秒、退出 0；`/tmp/preload-full-final.log`。未调整超时、并发或跳过用例；运行前后 14 个本次源码/测试文件 SHA-256 全部一致（`/tmp/preload-source-hashes.json`）。
  - `corepack pnpm typecheck` 通过，Host/Client against DSH 0.2.2-rc.3（`/tmp/preload-typecheck-final.log`）；`corepack pnpm build:preview` 通过，仅 `.cache/preview-package`，8 个修改的 Host 文件与隔离源码逐字节一致（`/tmp/preload-preview-final.log`）。`corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict` valid，仅保留原有主任务超过 10 个的建议（`/tmp/preload-spec-final.log`）；指定 Git `diff --check` 通过。
- [x] 12.7 修复账号终端无法打开
  - 已确认并修复的共有 Host 缺陷：`AccountManager.finish` 清理失败时保留 reservation，却未登记 unsafeTerminals、未通知设置缓存失效；因此刷新仍提供登录动作，随后 accountStart 又以“已有账号终端”拒绝。Codex、CodeBuddy 的真实 AccountManager + 模拟 PTY 回归在修复前均失败（新增文件当时 8 passed / 2 failed），证明此状态不一致；尚不能将它认定为用户“所有 CLI 都打不开”的唯一现场根因，本子任务保留未勾选。
  - 改动文件：`src/host/accounts.ts` 在清理失败时登记终端暂停并通知活动订阅，在重试确认清理成功后移除该终端暂停再释放 reservation；没有绕过进程清理或允许重复启动。`tests/account-settings-start.test.ts` 新增 10 项模拟，`tests/settings-dialog.test.tsx` 新增 2 项真实 Host 缓存/订阅与页面点击的模拟，`tests/accounts.test.ts` 更新 2 项失败清理后的暂停诊断断言。未修改 `src/client/**`、版本号及 12.6。
  - 调用链核查：快照有意移除 actions 与逐条退出句柄；refreshAccountStatus 的强制分支等待已有缓存读取结束后重新调用 accounts.status，返回原始可操作结果，而非复用 displayOnly 快照。新增模拟覆盖 Codex（终端型）和 CodeBuddy（账号窗口型）的设置缓存命中→刷新→真实 AccountManager 启动模拟 PTY、后台读取并发、取消排队刷新、清理暂停与失败清理重试。页面模拟覆盖真实 Host watch 更新与点击；正常链路均通过，没有复现全部 CLI 共有的 actions 丢失、动作 ID 不匹配或启动参数错误。
  - 只读现场证据：Desktop 为 0.2.2-rc.3；已装插件符号链接指向主仓库，核查时主仓库已推进到 cc3eb2791c1aff6602205f74367de7be137f11c5，构建文件时间为 2026-11-14 12:37，与本工作树的 0245b35 基线不同。当前 Desktop 标准输出日志仅 5 行启动/更新信息，Host 输出接 IPC 管道，未获取点击 CLI Worker 账号动作的调用顺序或报错。renderer 崩溃日志中的 deepseek-account 报错属于宿主账号，不能当作本插件证据。只读界面见已有 Pi 账号列表窗口正常显示，不代表登录终端验收通过；没有点击真实账号动作。
  - 最终关联测试：`corepack pnpm --config.verifyDepsBeforeRun=false test tests/account-settings-start.test.ts tests/accounts.test.ts tests/account-terminal.test.tsx tests/settings-connection-cache.test.ts tests/cli-management-remotes.test.ts tests/settings-dialog.test.tsx tests/accounts-window.test.tsx tests/cli-management-admission.test.ts tests/account-login.test.ts tests/account-query-queue.test.ts`：10 文件、615 项通过，0 失败、0 跳过，13.39 秒。修复后的首次关联运行为 613 passed / 2 failed，两项旧断言仍要求“已有账号终端”；按新的明确暂停诊断更新后全过，未削弱清理/保留锁的验证。
  - `corepack pnpm --config.verifyDepsBeforeRun=false build:preview` 通过，仅生成本工作树 `.cache/preview-package`；新工作树缺 Remote 生成声明导致首次 typecheck 失败，隔离构建完成后使用该隔离包生成的 lib 声明（本工作树被忽略的 lib），再运行 `corepack pnpm --config.verifyDepsBeforeRun=false typecheck` 通过，Host/Client against DSH 0.2.2-rc.3。共享 node_modules 链接使 pnpm 自动依赖校验拒绝安装，故上述命令显式关闭启动前依赖重装检查；测试因 Vite 缓存写入权限失败后获准沙箱外执行，未更改主仓库源码或正式构建。
  - 未执行的真实验证：真实登录/退出、真实模型调用均为 0；未安装本次预览包、未更新 Desktop 链接、未在 Desktop 点击登录终端、未做 Windows/Linux 实机验收。现有现场日志不足以闭环原始全 CLI 故障；本次提交只确认共有清理状态缺陷已修复及模拟链路通过，没有证据要求修改前端生产文件。
  - 严格校验：`corepack pnpm --config.verifyDepsBeforeRun=false spec validate v0.8.10-cli-update-page-leeyl --strict` valid、退出码 0，仅提示主任务超过 10 个；Git diff --check 通过，隔离包 `src/host/accounts.ts` 与本工作树源码逐字节一致。仅本地提交，不推送、不归档。
  - 主会话 Mac Desktop 实机（构建 e4857d1，2026-11-14 13:04）：Codex「账号终端」约 4 秒显示原生界面；Claude Code 账号终端在系统负载约 25 时约 15 秒后显示原生界面；关闭终端后账号状态重新读取。本机未复现「全部无法打开」，需用户提供失败的 CLI 与界面提示后再闭环，保持未勾选。
  - 2026-11-15 Windows 实机（ad2f07f 包，经端口转发的 Host Web UI）：Codex「账号终端」6 秒内显示原生 Codex v0.169.0 界面，「关闭终端」后弹窗关闭；Claude Code「官方账号终端」显示原生 Accessing workspace 信任提示（未作答），「关闭终端」正常。关闭后无新增 codex/claude 进程（现存 4 个 codex.exe 属 11-14/06:44 启动的 Codex 桌面应用）。
  - 修复已实现且 Mac、Windows 均能打开与关闭账号终端，勾选；原始「全部无法打开」现场未复现。
- [x] 12.8 修复 Qoder 模型与强度目录
  - 现象（用户 2026-11-14，Mac Desktop 0.2.2-rc.3，main 0245b35 正式构建）：Qoder 显示已登录，但模型与思考强度目录取不到。
  - 根因分两层。账号侧：真实只读探测确认 Qoder 国际版 1.1.89 原生目录返回 16 个模型、启用 0、停用 16（13 个声明强度），账号已识别、Free；插件按既有规则不把停用模型列为可选，因此确实没有可选模型和强度，这部分不是插件缺陷，未放宽过滤。插件侧（d584398 引入）：`SettingsConnectionCache.read` 在读取失败时把槽内 `error` 一律写成「连接状态读取失败，请刷新重试」（原 src/host/settings-connection-cache.ts:64），设置页模型区在快照模式下只显示快照的 `error`（src/client/settings-dialog.tsx:1060），直读接口返回的真实原因随后也被快照覆盖；用户只看到通用失败、刷新无效，看不到是账号下模型全部停用。另外原文案「Qoder 未公开可用的结构化模型目录」（src/host/qoder-accounts.ts:600）把「账号下全部停用」说成了「没有目录」。
  - 改动文件：`src/host/settings-connection-cache.ts`（失败槽保留该次读取的原因，去掉错误类名、最长 1024 字符，空原因才用通用文案）；`src/host/qoder-accounts.ts`（全部停用时报「<Qoder|Qoder CN> 返回的 N 个模型在当前账号下均为停用状态，暂无可选模型；请在 <CLI> 中确认账号额度或套餐后刷新」，目录本身为空仍报原文案；停用过滤与强度解析不变）；`src/client/operation-error.ts`、`src/client/i18n-messages.ts`（新文案与通用文案的英文对照，界面结构和样式未改）；本变更 design 决定 12 与增量规格「过期或未核实登录」场景同步为发布真实原因。未改共享协议、Remote 签名和版本号。
  - 模拟回归（夹具均标注模拟）：`tests/settings-connection-cache.test.ts` 新增 1 项（快照保留真实原因、不带类名、空原因回退、1024 截断、成功后清除并带强度）；`tests/qoder-accounts.test.ts` 新增 1 项（16 个全停用经 daemon 查询报数量与品牌名并正常 shutdown；含 1 个启用模型时返回该模型及 default/none/low/high 强度）；`tests/settings-dialog.test.tsx` 新增 1 项（已登录而目录失败时模型区显示原因、不转圈、状态点仍为绿、不自行重复读取）。
  - `corepack pnpm vitest run tests/settings-dialog.test.tsx tests/settings-connection-cache.test.ts tests/settings-connection-view.test.ts tests/qoder-accounts.test.ts tests/qodercn-accounts.test.ts tests/authorized-catalog.test.ts tests/client-i18n.test.tsx tests/cli-settings.test.ts`：8 文件、662 项通过、0 失败。
  - `corepack pnpm build:preview` 通过，仅 `.cache/preview-package`；新工作树缺 Remote 类型，按 12.3 的做法把隔离包 lib 复制为被忽略的 `lib/` 后 `corepack pnpm typecheck` 通过（DSH 0.2.2-rc.3）。`corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict` 通过，仅既有的主任务数量提示。
  - 真实只读探测（不建会话、不发 prompt、不登录或退出、保留宿主代理变量、不输出邮箱与凭据）：`corepack pnpm exec tsx .cache/qoder-catalog/live.ts`（修复前文案，复用 H-live.ts）退出 0，Qoder 1.1.89 两个元数据进程 argv 含 `--sdk`、退出码均 0，原生 16 个模型、启用 0、停用 16；`corepack pnpm exec tsx .cache/qoder-catalog/live-after.ts`（真实 `discoverQoderModels` 经 `SettingsConnectionCache` 读取）退出 0：Qoder 快照为 `loading=false`、`error`=新文案（16 个）；Qoder CN 1.1.89 原生 13 个、启用 1，快照得到 1 个模型且带强度；两个进程退出码均 0、范围退出确认，私有目录残留 0，`~/.qoder*` 1,181 项前后新增 0、mtime/大小/模式变化 0。证据在 `.cache/qoder-catalog/`（不入 Git）。
  - 未执行：正式 `pnpm build` 与 Desktop 实机复看新文案；Windows；英文界面实机；国际版账号有启用模型时的真实目录与强度（账号当前 0 启用，仍由 v0.8.10-qoder-sdk-daemon-leeyl 的 3.1 跟踪）；全量 vitest。

- [x] 12.9 连接预加载提前：路径检查之后即逐 CLI 连续执行账号与目录，先于版本与发布检查
  - 实机发现（2026-11-14 Mac Desktop，构建 7642cd9）：冷启动并打开会话后约 4 分钟打开设置，首屏仅 Codex 为绿，其余仍在查询。原因是连接项排在 17 项路径检查、17 项版本检查之后，目录项更排在 17 项发布检查之后；每项另有约 2 秒 CPU 采样与 2 秒间隔，全程约 6–7 分钟，期间 CPU 超过 50% 还会顺延 30 秒。
  - 修改 `src/host/cli-management/service.ts` 的 `context()`：连接项插在路径检查（已登记执行入口身份）之后，按 CLI 顺序把账号与目录相邻排列；空闲门槛、串行和打断清理不变。
  - `tests/settings-connection-preload.test.ts` 新增「连接项紧接路径检查」模拟用例；旧顺序下该用例失败（expected 17 to be less than 0），新顺序 19 passed。`tests/cli-management.test.ts`、`cli-management-remotes`、`cli-management-admission` 与之合计 107 passed；typecheck 通过。
  - Mac Desktop 复验（构建 44740eb，2026-11-14 13:20 冷启动、打开会话后不开设置等待约 3.5 分钟，负载约 3–5）：首次打开设置首屏 Antigravity、Codex、Claude Code、Kimi、MiMo、ZCode、Grok Build 已为绿点，OMP、Pi、Hermes 仍在后台队列中加载；调整前（构建 7642cd9，同样条件约 4 分钟）首屏只有 Antigravity、Codex 为绿。负载 25（10 核）时 CPU 门槛使后台顺延，属既定行为。

## 13. Windows 接管下载与维护期状态（任务 W） 〔后端｜12h｜前置 11〕
- [x] 13.1 Claude Code、Antigravity、OMP 在 Windows 由插件下载、按官方摘要校验后按官方脚本位置放置（决定 13）
  - 实施：新增 windows-artifacts.ts；仅 self-update 官方默认布局，Windows 路径不区分大小写，覆盖 x64/arm64。Claude SHA-256+size 后原子写 versions/<目标> 与启动器；Antigravity SHA-512（可用时核对 HEAD 长度）后同目录替换；OMP 复用构建版本/平台/CPU/名称/源地址/摘要/长度校验后替换。不执行原生 install、PATH 或 Bash 配置；FILE_LOCKED 保留旧 exe、清理临时文件，Claude 回滚本次版本文件并保护先前同名文件。
  - 模拟证据：cli-management-local-artifacts-windows 的三项 x64/arm64 放置、错误清单、一次干净重下、EBUSY/EPERM/EACCES、Claude 同版本回滚、Range/If-Range、多源身份不一致拒绝、自定义源禁止换源、服务精确版本/身份复核与下载后计划变化拒绝。接管进度直接传入 op.progress；安装单独 10 分钟预算。
  - 官方来源只读核对：匿名 GET Claude 2.1.325、Antigravity 1.5.9、OMP 18.20.0 的 Windows 清单；Claude 主站/GCS HEAD 均 200、372461728 B、相同 ETag 63c63d3679b0aebc2ba5886abd0f464d，已启用内置双源且仍运行时验证。未下载大型二进制；真实更新属于 13.5。
- [x] 13.2 TRAE CN 在 Windows 组官方离线包交 offline-install，并恢复更新前存在的自动更新标记
  - 实施：按官方 Export-OfflineBundle 组主工件、唯一 code_mode_host、清单存在时的两项 windows_sandbox_helpers、筛选目标平台的 ripgrep；逐项 SHA-256+size、受限源、文件名/归档路径、压缩格式、去重和 2 GB 合计/流式剩余预算校验。相对 URL、offline_channel/release_channel、两份 manifest 与 CDN install_v2.ps1 存入 0700/0600 私有目录，argv 数组调用 offline-install。
  - 模拟证据：x64/arm64 包结构、清单缺省/完整 helpers、错误来源/平台/摘要/大小/依赖路径、重复平台、预算溢出；标记原有/原无/失败/取消、正常与 UUID release 名；服务级进程 argv/env、维护锁、更新后真实身份与精确版本核对。标记在脚本成功后写回 current 实际指向的新 release；安装失败不由插件改写；原有非 public 发布源限制仍保持。
  - 只读证据：trae.ps1 StateDir/ReleaseName/Export-OfflineBundle 已核对；匿名 GET TRAE 0.215.0 与 ripgrep 15.1.0 清单（当前 0.215.0 未提供 helpers 字段）。环境仅设置固定版本/通道/默认目录、ASSUME_YES、SKIP_USER_PATH，不设置 TRAECLI_INSTALL_AUTO_UPDATE、不剥离代理；Unix TRAE 原生更新不变。
- [x] 13.3 维护期读取被拒不记红点，更新结束（含失败、取消）作废连接显示（决定 14）
  - 实施：SettingsConnectionCache 遇 code=MAINTENANCE 清除 value/checkedAt/旧 error，直接调用方仍收到维护拒绝；launch finally 在非隔离路径释放维护锁后统一 invalidateModels，移除成功分支重复调用。
  - 模拟证据：settings-connection-cache 两槽旧错误清除及释放后重读；cli-management-admission success/failure/cancel 均断言释放锁后恰好一次作废；phase-b 保留取消必须等待整个进程树退出、cleanup-unconfirmed 不释放锁也不作废的断言。
- [x] 13.4 模拟回归、类型检查、相关测试、隔离构建与严格校验
  - 最终检查：corepack pnpm typecheck 退出 0；corepack pnpm vitest run tests/cli-management tests/settings-connection-cache.test.ts tests/cli-management-admission.test.ts：22 文件、710 passed、0 failed、0 skipped（3.52 秒，/tmp/task-w-related-final.log），包含新增 Windows 文件 71 项。新增夹具和用例标注“模拟”，不执行本机 CLI 或真实安装器。
  - 构建/规格：corepack pnpm build:preview 退出 0，隔离包 .cache/preview-package（/tmp/task-w-preview.log）；corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict 退出 0，仅现有“主任务超过 10 个”建议警告。git diff --check 通过。README 双语、doc/design.md 与本变更决定 13/14 已同步。
  - 调试记录：首次 typecheck 因 sidecars 的 unknown 类型收窄报错，修正后通过；服务级 TRAE 初次夹具遗漏 binary_version、且 ReleaseClient 在模拟 Windows 前初始化，导致计划缺失，完善模拟清单与初始化顺序后全过。真实 Windows、Clash 下载/续传、占用与取消仍由 13.5 单列；没有正式构建、Desktop 链接更新、版本修改、提交或推送。
- [x] 13.5 Windows 实机：四项真实更新经代理完成、进度条与续传次数、取消与残留、红点不复现
  - 环境：Windows 11 实机，DSH 0.2.2-rc.3，经 Clash Verge 127.0.0.1:7897，保留宿主代理设置；先装 64b2a3b 包，13.6/13.7 修复后装 c84b0c4 包（1172/1172 文件一致，packageSha256 32644f71e5de…）。逐个经「更新 CLI」页点击更新与「继续更新」。
  - Antigravity 1.4.11 → 1.5.9（64b2a3b）：进度条显示「已下载 83.1 MB / 221 MB · 来自 storage.googleapis.com」，停滞 10 秒自动续传 2 次（24651583 B、183528098 B）后下载完成并替换 agy.exe（231726744 B），agy --version 为 1.5.9；当时校验误报 IDENTITY_CHANGED，即 13.6 的问题。装 c84b0c4 后检查归入「已是最新」，状态文件 latest 1.5.9。
  - Claude Code 2.1.296 → 2.1.325（64b2a3b）：进度条显示字节、速度、来源，停滞时显示「5 秒没有新数据」；在 downloads.claude.ai 与 storage.googleapis.com 间切换 3 次、续传 3 次后完成；claude.exe 与 versions/2.1.325 均为 372461728 B，claude --version 为 2.1.325，2.1.296 保留；当时以 UNKNOWN 误报失败，即 13.7 的问题。装 c84b0c4 后归入「已是最新」，状态文件 latest 2.1.325。
  - OMP 18.8.7 → 18.20.0（c84b0c4）：240 MB 来自官方 r2.cloudflarestorage.com，续传 3 次（80907860、124288979、153616375 B）后完成并直接成功；omp.exe 251502592 B，omp --version 为 omp/18.20.0，omp 目录无 .new 或临时文件。更新前、更新中、完成后侧栏 OMP 均为绿点，未复现红点。
  - TRAE CN 0.213.1 → 0.215.0（c84b0c4）：主工件 141 MB 来自 lf-cdn.trae.com.cn，过慢重连 1 次（24.6 KB/s）、停滞续传 4 次；sidecar 过慢重连 1 次；再交官方 install_v2.ps1 offline-install，输出 Loading bundled TRAE CLI 0.215.0、ripgrep 15.1.0 后成功。traex --version 为 traecli 0.215.0 / installation: public；current 指向 releases/0.215.0-x86_64-pc-windows-msvc；更新前存在的 auto-update-version 从 0.213.1-x86_64-pc-windows-msvc 恢复为 0.215.0-x86_64-pc-windows-msvc；旧 release 由官方脚本清理。
  - 残留：每项完成后插件 cli-management 目录只剩状态文件（TRAE 后另有空 downloads 目录），无 .part、临时脚本或离线包；agy/omp/.local/bin 无 .download 临时文件。C 盘可用空间 1.96 → 1.51 → 1.39 → 1.40 GB（Claude 新版本比旧版本大约 112 MB，且旧版本保留）。
  - 未完成：接管下载期间的取消未实测。11.9 只证明接管前原生更新器的取消；本次四项均已更新到最新，没有可取消的更新，留到这四个 CLI 下次有新版本时补测，故本项保持未勾选。
  - 发现但未修：OMP 来源主机名过长时在进度行下单独换行；TRAE 多文件下载时进度条与「已自动续传」按文件重置，不显示总进度。两者均为显示问题，留待前端处理。（已由 72bac7d 修改，见双通道 5.1。）
  - 接管下载期间取消（补测）：2026-11-15 Windows 实机（ad2f07f 隔离包，1262/1262 文件一致；经 SSH 端口转发在 Mac 内置浏览器操作 Windows Host Web UI）：用 build.stencil.so 官方清单下载 OMP 18.20.0（251502592 B，sha256 1b6c7bda…，另存 18.20.2 安全副本）回退 `%LOCALAPPDATA%\omp\omp.exe`。07:58:02 点更新并确认，页面显示「官方更新今天在这台电脑上失败，7 天内直接由插件下载」「官方渠道近期在本机失败（7 天内），直接接管」，来源 r2.cloudflarestorage.com，停滞 10 秒从 80633198 B 续传 1 次，最快 15.6 MB/s；07:58:47 在 241/241 MB 尚未替换时点「取消更新」，页面显示「已取消。已写入的文件不会回滚，建议重新检查」，OMP 留在可更新组。复核：omp.exe 仍为 18.20.0（sha256 前缀 1b6c7bda），omp 目录只有 omp.exe，插件 downloads 0 项，Temp 无 `cliworker-`/`cwn-`/`dshwb-` 目录，无 omp 进程；OMP 的 7 天通道记忆按设计在取消时清除（2 条 → 1 条）。
  - 取消后再次更新：08:00:23 点更新，通道记忆已清除，走官方 `omp update`，增量补丁 38.6MB 并 sha256 校验，约 20 秒「已更新到 18.20.2」，输出末行「更新清理：已删除 OMP 原生备份 1 项，释放 251502592 B。」；omp 目录只剩 omp.exe（sha256 前缀 6dbb8ac3，与回退前安全副本一致），downloads 0 项，回退用文件已删除，C 盘 4.81 GB。
  - 四项真实更新、进度条与续传次数、取消与残留、红点不复现均已覆盖，勾选。未重跑：Antigravity、Claude Code 在 13.6/13.7 修复后的「直接成功」提示（两者已无新版本，修复后检查归入「已是最新」）；修复后的成功提示以 OMP 两次真实更新为代表。
  - 2026-11-15 OMP 复测（34133b9 包）：先把 OMP 用官方备份回退到 18.20.0，再在页面点更新。官方 `Downloading patch from 18.20.0 (38.6MB)` 约 6 分钟后超时，转下整包时插件接管（提示「官方更新超过时间预算……改由插件下载」），sha256 校验；停滞续传 4 次（159485587、173326300、181010396、196296650 B）。06:47:03 开始，06:59:13 显示「已更新到 18.20.2」。输出末行「更新清理：已删除 插件临时文件 2 项、OMP 原生备份 1 项，释放 698127848 B」。复核：omp 目录只剩 omp.exe，`--version` 18.20.2，downloads 0 项。本次未核对侧栏红点。
  - 仍未完成：接管下载期间的取消；Antigravity、Claude 修复后的成功提示复测。

- [x] 13.6 Windows 路径大小写不再误判安装身份
  - 实施：planner.ts 共用路径比较函数，只对带盘符的 Windows 路径折叠大小写与正反斜杠，覆盖 executable、updateRoot、prefix、packageRoot、fingerprint.realpath 及 TRAE 版本目录分支；POSIX 路径保持精确匹配，Homebrew 分支、来源和通道比较规则保持不变。
  - 实施：windows-artifacts.ts 在放置前读取现有入口 realpath，按原有忽略大小写的精确入口规则核对白名单后，以磁盘上的名称替换，保留 agy.EXE 等大小写；入口不存在时沿用默认目标，真实路径偏离白名单时拒绝写入。Claude versions/<目标版本> 为版本命名的新文件，本次保持其放置及回滚逻辑。
  - 模拟回归：新增 12 项测试并扩展 TRAE 用例，覆盖各路径字段的 Windows 大小写／分隔符等价、不同路径／来源／通道拒绝、POSIX 精确比较、保留 agy.EXE 落盘名称、拒绝偏离白名单的真实路径。corepack pnpm exec vitest run tests/cli-management* tests/settings-connection-cache.test.ts：22 文件、722 passed、0 failed、0 skipped（4.06 秒）。
  - 调试记录：首轮同命令为 21 文件通过、1 文件失败，721 passed、1 failed。新增用例「模拟：POSIX 安装身份的 prefix 保持大小写与分隔符精确匹配」报「AssertionError: expected true to be false // Object.is equality」；夹具前缀 /模拟 不含可变大小写的字母，改用 /Users/admin 后重跑全过，未修改生产比较规则来适配断言。
  - 检查：corepack pnpm typecheck 退出 0，Host/Client 类型检查通过；corepack pnpm build:preview 退出 0，隔离包位于 .cache/preview-package。没有正式构建、Desktop 链接更新、前端源码修改、版本修改、提交或推送。
  - 审查：更新计划 token 在执行前复核；fingerprintToken 用于版本读取期间的一致性检查、缓存命中及模型缓存失效。更新后 service.ts 只用 sameInstallation 核对安装归属，再清除旧版本缓存并记录新指纹，没有跨替换比较旧／新指纹 token，保持这些规则。local-artifacts.ts 的精确字符串比较只在 Unix 分支执行；install.ts 的 oldPath 比较只产生首次安装位置提示，不参与更新成功判定。
  - Windows 实机依据为主会话核查（2026-11-14）：Antigravity 下载接管已替换文件，agy --version 为 1.5.9，但服务报 IDENTITY_CHANGED「命令已完成，但实际路径或安装归属已变化」。记录入口为 C:\Users\admin\AppData\Local\agy\bin\agy.EXE，替换目标为小写 agy.exe；同机创建 Q.EXE 后 realpath('q.exe') 返回磁盘名称 Q.EXE，同名替换改变大小写导致误判。本次只完成模拟回归，修复后的 Windows 实机复测仍由 13.5 保留。
- [x] 13.7 更新后首次启动的版本校验不再因 5 秒上限误报失败
  - 实施：service.ts 仅在更新完成后的 verify 使用 60 秒总预算，currentVersion 新增可选 timeoutMs 并向 captureReadOnly 传入 45 秒；普通检查、后台检查、更新前计划复核及首次安装保持原默认预算。校验计时器在 finally 清理。
  - 错误码：共享 CLI_OPERATION_ERRORS 增加 VERIFY_TIMEOUT。captureReadOnly 自身超时使用 ReadOnlyTimeoutError，等待进程范围清理后由 verify 转为 CliOperationError，消息为「已替换，但新版本首次启动超时，无法确认版本；请稍后重新检查」。取消和 CLEANUP_UNCONFIRMED 优先保留；不自动重装或回滚已写文件。只读检查 client/cli-update-page.tsx 的 resultDescription 和 operation-error.ts 的 hostText，确认现有前端按 Host 消息显示新代码，未知翻译保留原文，未修改 client/。
  - 模拟回归：新增 6 项服务级 Windows Claude 接管测试，实际执行 currentVersion/captureReadOnly，使用模拟进程和假计时器覆盖 9032 ms、20000 ms 成功，45000 ms 探测超时、60000 ms 总预算超时，用户取消与清理未确认；断言进程范围退出前不发布终态、已写 exe 和版本文件保留、只启动一次版本命令。现有普通版本读取 5 秒超时回归继续通过。
  - 验证：corepack pnpm typecheck 退出 0；corepack pnpm exec vitest run tests/cli-management* tests/settings-connection-cache.test.ts 为 22 文件、728 passed、0 failed、0 skipped（4.05 秒）。此前定向测试 2 文件、119 项通过；本次没有测试失败。README、doc/design.md 和本变更增量规格同步更新后预算与超时行为。
  - Windows 实机依据为主会话核查（2026-11-14）：Claude takeover 写入 claude.exe 372461728 B 和 versions/2.1.325，claude --version 为 2.1.325，无残留，但操作以 UNKNOWN 失败。同机新写入 372 MB 副本首次 --version 用时 9032 ms、第二次 623 ms，首次 Defender 扫描超过 captureReadOnly 原 5000 ms 上限。本次为模拟验证，修复后的 Windows 实机复测仍保留在 13.5，没有执行真实 CLI、正式构建、Desktop 更新、版本修改、提交或推送。


## 14. Windows WorkBuddy 应用版本发现修复 〔后端｜2h｜前置 13〕

- [x] 14.1 只读核对 Windows 安装、路径记录与根因
  - 2026-11-15 SSH 只读：`D:\Software\workbuddy\WorkBuddy.exe` FileVersion=5.9.3、ProductVersion=5.9.3.0；HKLM Uninstall 的 DisplayName=WorkBuddy 5.9.3、DisplayVersion=5.9.3、InstallLocation=null、DisplayIcon=`D:\Software\workbuddy\WorkBuddy.exe,0`、Publisher=Tencent Technology (Shenzhen) Company Limited。HKCU 和 WOW6432Node 查询未返回 WorkBuddy 项。
  - `%USERPROFILE%\.dsh\cliworker-now\cli-executable-paths\win32-<host>.json` 中 workbuddycn 为 auto、revision=1，entry 指向上述根内 `resources\app.asar.unpacked\cli\dist\codebuddy-lite-wb.mjs`；国际版没有入口。仅提取非账号字段。
  - `resources/app/package.json` 缺失，app.asar 存在，归档内 package.version=5.9.3；unpacked CLI package.version=2.165.0，product.genieVersion=5.9.3、productName=WorkBuddy、endpoint=https://www.workbuddy.cn、dataFolderName=.workbuddy。旧实现不读取此应用版本；validAppVersion 已接受 5.9.3 与 5.9.3.0，安装未损坏。
  - PowerShell 5.1 ConvertFrom-Json 无法解析该公开产品 JSON（错误意外展开了厂商静态元数据），随后改用 Node 标准输入 JSON.parse 并只输出白名单字段成功；未读取账号文件。所有远程脚本均低于上传阈值，只通过 EncodedCommand/标准输入运行，没有写文件、安装、删除、退出或重启 Desktop，也没有启动 WorkBuddy。
- [x] 14.2 修复只读版本回退并同步设计与规格
  - 安装发现器返回可选 appVersion；identity 仅 Windows 缺有效应用包版本时使用经格式校验的 genieVersion。保留站点隔离、CLI 版本、macOS 与 ZCode 现有行为；README、doc/design、本 change design/spec 同步。
- [x] 14.3 完成模拟回归、类型检查与隔离构建
  - `KIMI_CODE_NO_AUTO_UPDATE=1 corepack pnpm vitest run tests/cli-management-workbuddy-identity.test.ts tests/workbuddy-installation.test.ts tests/cli-management-desktop-update.test.ts tests/cli-management-all-updates.test.ts tests/cli-management-acceptance-fixes.test.ts`：5 文件、282 passed、0 failed，含新增 14 个模拟用例。覆盖两版 Windows 的身份到服务 204 分组、缺失/非法应用版本、四段版本及指纹变化、既有 package 优先、跨站点拒绝、macOS Info.plist 优先级，并回归 ZCode。
  - 首轮同命令 272 passed、10 failed：新夹具误把 service.local 的 pathOnly 设为 true，未进入版本阶段；修正夹具为 false 后全过，未调整生产服务逻辑。
  - `corepack pnpm typecheck` 最终退出 0，Host/Client 通过（DSH 0.2.2-rc.3）。首次失败因新 worktree 缺 `dsh-cliworker-now/remote` 生成声明；先执行 `corepack pnpm build:preview`（退出 0），再仅把 preview 的 `lib/typert.remote-client.d.ts` 复制到本 worktree 忽略的 lib 目录后复验通过。没有正式构建或更新 Desktop 链接。
  - `corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict --no-interactive` 通过，仅提示主任务超过 10 个；`git diff --check` 通过。保留本 change 原有未完成项及 14.4，不归档。
- [x] 14.4 修复包的 Windows Desktop 页面回读（真实更新、派遣及国际版 Windows 实机仍未执行）
  - 2026-11-15 Windows 实机（主会话）：HEAD 277751b（含 f1bab12 修复）`build:preview` 后 `npm pack`，1265 个文件逐一写入清单，包 SHA-256 前缀 edbefa85b10a8100，上传后远端哈希一致。部署前 activeWorkers 0；经 UIA「应用 → 退出」正常退出 Desktop（进程 0），原生 `dsh plugin --profile desktop add --save-exact` 安装退出 0，逐文件校验通过，Host SHA-256 `c3e1b9f7…`。交互会话带无障碍与防节流参数启动，窗口有响应，stderr 0 B，stdout 无 error/431。
  - 经 SSH 端口转发在 Mac 内置浏览器打开 Windows Host Web UI，「CLI Worker 设置 → 更新 CLI」检查完成后 WorkBuddy CN 归入「已是最新」，显示「应用 5.9.3 · CLI 2.165.0 · WorkBuddy CN 桌面应用，下载官方安装包更新」，不再出现「无法核实桌面应用目录或版本」。同页「需要手动更新」只剩 ZCode（插件部署的 runtime 0.16.9），国际版 WorkBuddy 在「未安装」。


## 15. 国际版 WorkBuddy macOS DMG 安装与更新 〔后端｜4h｜前置 5,8〕

- [x] 15.1 按已入库证据限定国际版 DMG 工件选择，复用挂载与签名流程并同步设计、规格和双语说明
  - 基线：指定 worktree 从 `6c6db88` 通过 `git merge --ff-only bec435fb66ccbda7a1977b24ba2a3adfc4ded848` 快进。首次因共享 Git 元数据写入沙箱限制失败，获准提升后成功；安装锁文件依赖时同样因 ENOTFOUND 提升重试成功，无锁文件修改。
  - 实施：`desktop-update.ts` 在 feed 读取阶段只对国际版 darwin 的官方同版本同架构 ZIP 地址选择同路径 DMG；执行阶段只接受受限 DMG。拒绝主机、后缀、路径、架构、版本、查询/片段及规范化歧义，严格保留 feed SHA-256；CN ZIP 与 Windows EXE 不变。
  - `install.ts` 选择 DMG；更新器复用 `desktop.ts` 只读挂载、codesign/spctl、ditto、卸载并暂存，再走原替换/回滚；固定 Team FN2V63AD2J 与签名 identifier com.workbuddy.workbuddy-ai，装后版本核对保留。决定 16、增量规格、README 中英文与 doc/design 已同步，未来 feed 改为 ZIP 摘要时严格停止而非自动回退。
  - 保持现有 Host 代理、argv 执行、维护锁与生命周期；没有更改版本号、用户账号、Desktop 链接或现有安装。
- [x] 15.2 完成离线模拟回归、类型检查、隔离构建及严格规格校验，记录通过数
  - 最终命令：`KIMI_CODE_NO_AUTO_UPDATE=1 corepack pnpm vitest run tests/cli-management-desktop-update.test.ts tests/cli-management-desktop.test.ts tests/cli-management-install.test.ts tests/cli-management-all-updates.test.ts tests/cli-management-download.test.ts tests/cli-management-workbuddy-identity.test.ts`：**6 文件、322 passed、0 failed、0 skipped**（5.83 秒）。HTTP/工件字节/系统进程全为模拟，不联网、不真实下载；覆盖两架构映射、异常主机/后缀/路径/版本/架构/空查询与片段、执行阶段拒绝 ZIP、CN ZIP/Windows EXE 不变、完整 feed 到首次安装、装后版本不符不写路径、摘要错误两次严格拒绝且零安装命令、固定 Team/bundle、取消/挂载/签名/Gatekeeper/复制失败卸载与卸载未确认隔离。
  - 调试记录：首轮 3 文件 177 passed / 1 failed；新下载校验测试漏传 progress 回调，报 `options.progress is not a function`。只补齐模拟夹具回调后，6 文件 316 passed；追加空查询/片段、执行阶段拒绝和装后版本不符回归后为上述最终 322 passed。
  - `corepack pnpm typecheck`：最终退出 0，Host/Client against DSH 0.2.2-rc.3 通过。首次因新 worktree 缺 `dsh-cliworker-now/remote` 生成声明失败；按授权先 `corepack pnpm build:preview`（退出 0），将 `.cache/preview-package/lib/typert.remote-client.d.ts` 复制到本 worktree 被忽略的 `lib/` 后复验通过。最终源码再次 `corepack pnpm build:preview` 退出 0，产物仅 `.cache/preview-package`，没有正式构建或 Desktop 链接更新。
  - `corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict` 退出 0（valid；仅既有主任务超过 10 个的组织建议）；指定 Git 的 `diff --check` 通过。本 change 的其他缺口和 15.3 保留，未归档。
- [x] 15.3 真实 macOS 首次安装与更新验收
  - 2026-11-15 11:52:46–11:53:45 CST，主仓库 `main` / `cb0d6e5`，一次国际版 WorkBuddy arm64 隔离首次安装实测；安装链路未通过，脚本退出码 1。未找到历史 `gaps-desktop-live.ts`，在被忽略的 `.cache/` 新建同类脚本，实际运行 `"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/primary-runtime/dependencies/node/bin/node" --import tsx .cache/workbuddy-dmg-acceptance.ts`（Node 24.21.0）。调用真实 `CliInstaller.prepare/execute`、`ReleaseClient`、插件下载器、`nativeProcessBackend` 与 DSH `LocalSubprocessRuntime`；没有替换身份/版本核对为模拟实现，没有修改被跟踪源码。
  - 隔离 HOME 为 `.cache/workbuddy-dmg-home-nHuzVt`，目标为其下 `custom-apps/WorkBuddy AI.app`，状态/下载/挂载/TMPDIR 都在该隔离目录内；目录检查通过（可用 457,724,329,984 B，要求 2 GiB）。初始入口显式指向隔离目录内不存在的路径，避免默认应用发现；所有执行命令均为 argv 数组，仅允许 scutil/hdiutil/codesign/spctl/ditto，不启动应用、CLI 会话或登录，不调用账号读取，不覆盖或复制到现有应用位置。代理完整复用 `MacOSSystemProxySource` → `hostProxyLookup` → `hostFetch`，系统代理存在，继承的代理环境变量未移除。
  - 官方 feed GET `https://www.workbuddy.ai/v2/update?platform=workbuddy-darwin-arm64&version=0.0.0`：HTTP 200、329 B，目标 `5.9.4.42593613`；插件把其 ZIP URL 换为同路径 `WorkBuddy-darwin-arm64-5.9.4.42593613-fa0a0901.dmg`，DMG GET HTTP 200、Content-Length 与实际文件均为 **408,500,901 B**，一次完整下载、无续传。插件严格摘要校验通过，挂载前额外独立读取下载文件实算 SHA-256 `6502dc77a0d931dc5b6c490dea20b5966bab0c5c64fea65938ecb15e4a5fbea6`，与 feed `sha256hash` 完全一致（SRI `sha256-ZQLcd6DZMdxbbEkN6iC1lmurDFxk/qZZOOyxXkpfvqY=`）；下载文件权限 0600。
  - 系统步骤：`hdiutil attach -readonly -nobrowse -mountpoint …` → `codesign --verify --deep --strict '-R=anchor apple generic and certificate leaf[subject.OU] = "FN2V63AD2J" and identifier "com.workbuddy.workbuddy-ai"' …` → `spctl --assess --type execute …` → `ditto <只读挂载应用> <custom-apps/.cliworker-install-*/WorkBuddy AI.app>` → `hdiutil detach …`，五步退出码均 **0**，每步 `waitForExit=true`；实际挂载为 disk4，卸载输出 `"disk4" ejected.`。hdiutil 有命令弃用警告，未报失败；3 次系统代理读取及安装后的 `hdiutil info` 也均退出 0、确认进程范围退出。
  - 失败边界：事件序列为 `downloading` → `installing`（挂载/签名/Gatekeeper/复制/卸载）→ `verifying-installation`，最后抛出 `VERSION_MISMATCH`：在隔离 `custom-apps/WorkBuddy AI.app/Contents/Resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs` 找不到可确认的 workbuddy。安装器没有到达路径记录写回；实际应用版本和 CLI 版本未能核实，不能把 feed 目标版本当作装后版本。该入口失败的底层原因未被安装器保留，本次不推测、不修改源码或绕过校验。完整 24,941 个变更通知、HTTP 响应、argv、退出回执及错误见 `.cache/workbuddy-dmg-acceptance-report.json`，日志 `.cache/workbuddy-dmg-acceptance.log`。
  - 清理：安装器已卸载镜像并清理下载与挂载暂存；脚本确认全部子进程退出后删除整个隔离 HOME。另一个独立 Python 进程于 11:54:34 CST 回读 HOME、custom-apps、downloads、mounts、tmp **5/5 不存在**；独立 `/usr/bin/hdiutil info` 退出 0、无本次镜像/挂载路径，`/bin/ps -axo …` 退出 0、匹配本次隔离路径/镜像/验收脚本的残留进程 **0**。证据 `.cache/workbuddy-dmg-cleanup-readback.json`；验收脚本已删除，仅保留脱敏 JSON/日志（均被 Git 忽略）。
  - 15.3 保持未勾选：真实首次安装未通过装后身份/版本核对与路径写回；（未执行：更新验收、正常安装位置的发现与 Desktop 显示，本次只授权隔离首次安装；未启动应用、登录或读取账号）。
  - 证据文档校验：`corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict` 与 `corepack pnpm spec validate add-workbuddy-cli --strict` 均 valid、退出 0（保留既有主任务数量及旧格式警告）；指定 Git `diff --check` 通过。只改两个指定 tasks.md，没有源码/版本变更，未执行 typecheck、构建或模拟测试。
  - 2026-11-15 用户确认此项按现状验收并勾选；上面记录的未执行真实验证照旧保留，不当作已实测。

  - 2026-11-15 续验（当前 `worktree-agent-a5477fafccf61680a`，先 fast-forward 到 `d73d38309b6fcfe238570e28e42cba6939845caa`）：指定旧验收脚本已被上一轮清理（上文也有记录），主仓库仅存 JSON/日志；在本 worktree 被忽略的 `.cache/workbuddy-dmg-acceptance.ts` 重建等价验收，不更改版本、账号、/Applications 或 Desktop 链接。
  - 只读实物检查：新建 0700 私有目录，下载同一 408,500,901 B DMG，SHA-256 完整匹配 `6502dc77a0d931dc5b6c490dea20b5966bab0c5c64fea65938ecb15e4a5fbea6`；`hdiutil attach -readonly -nobrowse -noautoopen -mountpoint` 与 detach 均退出 0。国际版 `WorkBuddy AI.app` 的 MacOS 目录仅 `Electron`，CFBundleExecutable=Electron，ShortVersion/BundleVersion 均 5.9.4，bundle=com.workbuddy.workbuddy-ai；cli 顶层有 bin/builtin/dist/node_modules/vendor，入口 dist/codebuddy-lite-wb.mjs，package=@genie/agent-cli@2.165.0，productName=WorkBuddy AI，endpoint 主机 www.workbuddy.ai，dataFolderName=.workbuddy-ai，genieVersion=5.9.4。只读对照本机 WorkBuddy.app：同 runtime/入口/包版本，应用 5.9.3、bundle=com.tencent.workbuddy.mac、endpoint www.workbuddy.cn、dataFolderName=.workbuddy、genieVersion=5.9.3。未输出其他产品字段、未运行包内程序；卸载后下载与挂载目录已删除，hdiutil info -plist 无该镜像。详见本 worktree `.cache/workbuddy-structure-report.json`。
  - 根因与修复：修改前隔离安装重现 VERSION_MISMATCH；实际入口权限 0644，可执行文件查找报 SUBPROCESS_EXECUTABLE_NOT_FOUND，而直接 resolver 成功（`.cache/workbuddy-baseline-report.json`）。国际版安装核对直接使用原 identity/resolver，不改 endpoint/runtime/entry 白名单；修改 variant 的国际版配置目录提示为 .workbuddy-ai。安装失败保留 WorkBuddyUnavailableError 固定 reason，不输出原始异常或产品 JSON。第二处差异是 Info.plist 只有三段版本：仅国际版 macOS 官方 DMG 且 feed SHA-256 已验证时允许三段应用版本匹配四段目标前三段；已有四段装后版本必须完整相等，CN/ZCode/Windows 规则不变，不把 feed build 写入安装指纹。决定 16、增量规格、doc/design 及双语 README 同步。
  - 模拟回归：新增 6 项，涵盖国际版实际布局/无执行位入口、真实身份读取器下包名与站点原因传递、三段版本通过与错误短版本/四段 build 拒绝。`KIMI_CODE_NO_AUTO_UPDATE=1 corepack pnpm vitest run tests/workbuddy-installation.test.ts tests/cli-management-workbuddy-identity.test.ts tests/cli-management-desktop-update.test.ts tests/cli-management-install.test.ts tests/cli-management-desktop.test.ts` 最终 **5 文件、232/232 通过**。初次 typecheck 因缺 lib/remote 生成声明失败；`corepack pnpm build:preview` 成功，仅复制隔离包生成声明到被忽略的 lib/，再 `corepack pnpm typecheck` 成功（DSH 0.2.2-rc.3）。无正式 build 或 Desktop 更新。日志 `.cache/workbuddy-tests-final.log`、`workbuddy-preview.log`、`workbuddy-typecheck-final.log`。
  - 验收脚本边界：先以真实 Node 子进程桥验证修复后安装成功（`.cache/workbuddy-fixed-report.json`），再切到原生 `nativeProcessBackend + DSH LocalSubprocessRuntime` 复验。两次原生脚本收尾分别漏传 graceMs、误用 ctx.dispose，均是验收脚本问题：安装系统步骤已完成，第二次已保存装后身份、版本和手动路径；两次脚本各退出 1，均另用独立进程确认无挂载/残留进程后清理隔离目录。已修正为完整 spawn 参数及 ctx.fiber.dispose；不将这两次脚本退出 1 写成完整验收成功，详见 `.cache/workbuddy-host-interrupted-cleanup.json`、`workbuddy-host-final-report.json`、`workbuddy-host-final-cleanup.json`。
  - 最终完整真实验收：2026-11-15 **12:09:25–12:10:13 CST**，`corepack pnpm exec tsx .cache/workbuddy-dmg-acceptance.ts accepted` **退出 0**；真实 `CliInstaller.prepare/execute`、`ReleaseClient`、下载器、`nativeProcessBackend + DSH LocalSubprocessRuntime`，身份/版本函数均为本 worktree 实现，没有 mock。继承代理变量保留，系统代理存在，HTTP 走 MacOSSystemProxySource → hostProxyLookup → hostFetch。隔离 HOME/custom-apps/state 均在本 worktree .cache 下，临时根 0700；不启动应用、不登录、不读账号、不写 /Applications。
  - 最终 feed HTTP 200 / 329 B，目标 5.9.4.42593613；同路径 DMG HTTP 200 / 408,500,901 B，独立 SHA-256 与上述 feed 摘要完全一致，下载文件 0600。只读 attach、固定 Team FN2V63AD2J + bundle com.workbuddy.workbuddy-ai 的 codesign --verify --deep --strict、spctl --assess、ditto、detach **五步均退出 0、进程范围退出确认 true**。真实事件 downloading → installing → verifying-installation；装后 source=desktop-app、应用实际版本 **5.9.4**、CLI/package **2.165.0**、mjs 0644；重新调用 identifyInstallation 独立读取相同身份/指纹，成功写回隔离状态中的 manual 入口。四段目标依靠 feed 摘要绑定，没有声称从本地读到 build 42593613。证据 `.cache/workbuddy-accepted-report.json`、`.cache/workbuddy-accepted.log`。
  - 清理独立回读：最终脚本确认全部子进程范围退出后删除隔离 HOME；**12:10:43 CST** 另一个 Python 进程核对本轮全部隔离 HOME/custom-apps/downloads/mounts 与首次只读检查目录均不存在，`hdiutil info -plist` 退出 0、匹配本轮镜像/挂载 **0**，`ps -axo pid=,command=` 退出 0、匹配本轮隔离路径进程 **0**，`.cache/workbuddy-real-*` 残留目录 **0**。完整回读 `.cache/workbuddy-cleanup-readback.json`；只保留被 Git 忽略的脚本与脱敏报告/日志。
  - 15.3 **仍不勾选**：本轮首次隔离安装已验收通过；（未执行：真实更新的替换/回滚验收、正常安装位置自动发现、Desktop 显示、x64/Windows/真实账号与模型调用）。这些不以模拟测试或首次安装代替，整个 change 不归档。
  - 最终文档校验：`corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict` valid、退出 0（仅既有主任务超过 10 个建议）；指定 Git `diff --check` 退出 0。未改版本号、未 push、未正式构建。

## 16. CodeBuddy 官方原生更新识别 〔后端｜4h｜前置 2〕

- [x] 16.1 匿名核实官方脚本、发布包源码与两机只读路径版本
  - 2026-11-15：install.sh/ps1 仅文本读取；官方 npm 2.184.0 tarball SHA-512 与 dist.integrity 相符，只读 InstallEnv/InstallService/PathUtils；Mac 与 Windows 均 npm 2.184.0，Windows 原生根不存在。详细路径、来源哈希及布局见决定 17 和 `codebuddy-native-layout-audit-2026-11-15.json`。
- [x] 16.2 修复精确来源分类、稳定自动入口和更新后同一安装判断并补模拟回归
  - 新增 `codebuddy-native-layout.ts` 精确布局规则，共用于 identity、auto-entry、planner；adapters 优先保留同根稳定入口，版本探针设置 DISABLE_AUTOUPDATER=1。npm/brew、手动路径与 WorkBuddy 工件逻辑保持原渠道。
  - `tests/cli-management-codebuddy-native.test.ts` 46 项模拟覆盖三平台、SemVer/近似路径拒绝、npm 链接、旧版本已删/仍在、手动与部署路径、并发手动修改、服务原位更新/重链接及残留不清理。通用 all-updates 的 CodeBuddy 夹具改为真实形状的模拟原生根。
- [x] 16.3 同步双语 README、设计与规格并执行类型检查、相关测试和严格校验
  - README.md、README.en.md、doc/design.md、本 change design/specs 已同步；官方源码与两机只读证据另存脱敏 JSON。
  - `corepack pnpm typecheck` 通过；初次缺少 remote 声明，按要求先 `corepack pnpm build:preview` 成功，再复制 285 个生成声明到被忽略的 lib/，后续 Host/Client 类型检查通过。
  - `KIMI_CODE_NO_AUTO_UPDATE=1 corepack pnpm vitest run tests/cli-management-codebuddy-native.test.ts tests/cli-management-source-layouts.test.ts tests/cli-management-acceptance-fixes.test.ts tests/cli-management-all-updates.test.ts tests/cli-management-review.test.ts tests/cli-management-update-cleanup.test.ts tests/cli-management-workbuddy-identity.test.ts tests/cli-executable-management.test.ts tests/adapters.test.ts`：9 文件、388 项通过。
  - `corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict` 通过，仅已有主任务超过 10 个的组织建议；`git diff --check` 通过。首次任务工时标记格式失败已修正；首次关联测试的旧 CodeBuddy 夹具缺 updateRoot 失败已修正，并完整重跑通过。
- [x] 16.4 三平台真实原生更新验收
  - 原标注：未执行：本次明确禁止真实更新；Mac/Windows 只有 npm 安装，Linux 无实机。
  - 2026-11-15 用户确认此项按现状验收并勾选；上面记录的未执行真实验证照旧保留，不当作已实测。


## 17. Windows ZCode 桌面更新关联 〔后端｜2h｜前置 8〕

- [x] 17.1 实现 Windows 固定 runtime 关联、PE 版本读取与更新后身份核对，同步设计和说明
  - identity 新增两处有证据的默认目录与 ProductName/内置 CLI 核对，pe-version 使用有界位置读取，planner 保留同根应用更新并拒绝应用根变化。macOS、manual、官方 EXE 下载/校验/执行链路保留；双语 README、doc/design、本 change 决定 18 与增量规格已同步。
- [x] 17.2 完成模拟测试、类型检查、隔离构建和严格规格校验
  - `node_modules/.bin/vitest run tests/cli-management-zcode-windows.test.ts`：29/29 通过；`node_modules/.bin/vitest run tests/cli-management`（Vitest 文件名前缀匹配，等价覆盖 tests/cli-management*，包含新测试与 macOS 既有回归）：37 文件、1256/1256 通过，0 failed，18.65 秒。手工模拟 PE32/PE32+、ProductName/StringFileInfo 与固定版本区分、缺资源/截断/越界/超限/循环、222866328 B 稀疏文件、两默认目录、链接/junction、产品名/内置 CLI、manual/显式路径、版本与计划 token、应用根与大小写均覆盖；服务测试复用实际 feed/下载/更新器/verify，只有 HTTP、安装进程与文件产物是模拟，确认仅一个 EXE 参数、等待进程范围退出并独立回读 3.18.2。
  - `corepack pnpm --config.verify-deps-before-run=false typecheck`：退出 0，Host/Client against DSH 0.2.2-rc.3 通过；`corepack pnpm --config.verify-deps-before-run=false build:preview`：退出 0，隔离包位于本 worktree .cache/preview-package。无正式 build 或 Desktop 链接更新。
  - 环境/调试记录：原 `corepack pnpm typecheck` 和 spec 命令因共享 node_modules 链接触发 ERR_PNPM_UNSAFE_MODULES_DIR；只用命令级 verify-deps-before-run=false 关闭自动依赖重装检查，未修改依赖/锁文件。新 worktree 首次类型检查缺 remote 生成声明；隔离构建后复制 286 个生成 .d.ts 到本 worktree 忽略的 lib/，再验证通过。Vitest 首次 .vite-temp 写入被沙箱拒绝，经工具授权提升后执行；新测试最初路径夹具错误（29 failed）、随后复用已消费 Response（28 passed / 1 failed），均只修正模拟夹具后通过。
  - `corepack pnpm --config.verify-deps-before-run=false spec validate v0.8.10-cli-update-page-leeyl --strict --no-interactive`：valid、退出 0，仅已有主任务超过 10 个建议；首次因扩写旧 requirement 超过 500 字警告失败，已精简总述并保留独立 Windows requirement/scenarios。指定 Git `diff --check` 通过。17.3 与其他原有实机缺口保持未勾选，不归档。
  - 2026-11-15 主会话 Windows 实机只读复核（不更新、不启动 ZCode）：把 `pe-version.ts` 用 esbuild 编成单文件，经 `ELECTRON_RUN_AS_NODE=1` 的 DSH Electron 运行。初版读 `C:\Program Files\ZCode\ZCode.exe` 返回 undefined，WorkBuddy.exe 与 DeepSeek Harness.exe 正常；逐项打印字符串表发现失败在「值内含 NUL」：`SquirrelAwareVersion` wValueLength=3（6 字节，值 "1" 带两个结尾 NUL），`OriginalFilename` 为空串。改为与 VerQueryValue 一致、按第一个 NUL 截断（结构与越界检查不变），新增模拟用例「多余结尾 NUL」；`node_modules/.bin/vitest run tests/cli-management-zcode-windows.test.ts` 30/30 通过。重跑实机：ZCode.exe → productVersion 3.14.5.7961、productName ZCode；WorkBuddy.exe → 5.9.3.0 / WorkBuddy。
- [ ] 17.3 Windows 实机更新验收
  - 待主会话实机验收。

## 18. Windows 国际版 WorkBuddy 安装 〔后端｜3h｜前置 5〕

- [x] 18.1 下载两版安装包完成完整性、签名主体及 NSIS 安装标识只读调研
  - 证据：`evidence/workbuddy-intl-windows-audit-2026-11-15.json`；国际版 507036736 B、国内版 450174440 B，完整 MD5/CRC64 均匹配 COS 头，国内版 SHA-256 匹配 feed。国际版卸载键 C02C88CB-5DAE-4330-AEC1-572CFD048A59、CurrentUser 默认 WorkBuddyAI，与国内版键/目录不同。冲突结论及信任链未核实边界见决定 19。
- [x] 18.2 实现受限 Windows 国际版首次安装、COS 与 Authenticode 校验，保持原摘要路径和身份核对
  - 首次安装和更新共用严格 URL、COS HEAD/完整长度/MD5/CRC-64/XZ 与固定腾讯 Authenticode Valid。只开放国际版 x64；无空字符串之外的降级，SHA-256 不符不回退。发现补充 WorkBuddyAI 目录/程序名，保持等待向导、整个进程范围退出后才核对国际站点/版本写路径；实际三段应用版本保留。README 中英文、doc/design 及增量规格已同步。
- [x] 18.3 完成模拟测试、类型检查、隔离构建及严格规格校验并同步双语说明
  - `node_modules/.bin/vitest run --configLoader native tests/cli-management* tests/workbuddy-installation.test.ts`：38 文件、1297 项；沙箱内 1292 passed / 5 failed，失败均为两份 Pi 环回测试的 listen EPERM 或其连带断言。提升后仅重跑 `node_modules/.bin/vitest run --configLoader native tests/cli-management-pi-registry-prototype.test.ts tests/cli-management-task4-pi.test.ts`：2 文件、6/6 passed，覆盖全部 5 个失败项；没有修改 Pi 代码/断言规避环境限制。
  - 追加首次安装 SHA-256 不走 COS、错误四段 build、签名失败清理、已启动安装取消用例后，`node_modules/.bin/vitest run --configLoader native tests/cli-management-workbuddy-windows.test.ts`：**45/45 passed**。该文件覆盖 CRC 标准向量/分块、严格 URL、HEAD/完整长度/MD5/CRC、签名状态/主体、摘要不降级、awaiting-user、进程范围等待/未确认隔离，以及真实身份读取器下默认/自选位置、跨站点拒绝与路径记录。全部 HTTP/进程为模拟，真实安装未执行。
  - 首轮 3 文件 211 passed / 2 failed：新夹具用 POSIX 临时文件路径写 Windows 路径记录，修正夹具路径记录器为当前测试磁盘平台后通过；生产校验未放宽。直接 Vitest 命令最初因共享 node_modules/.vite-temp 写入 EPERM 未启动，改用 native 配置加载器避免写工作树外的共享依赖。
  - `pnpm_config_verify_deps_before_run=false corepack pnpm typecheck`：Host/Client against DSH 0.2.2-rc.3 通过；首次缺 remote 声明，先执行同环境前缀的 `corepack pnpm build:preview` 成功，仅把隔离包生成的声明复制到本工作树忽略的 lib 后复验。最终 `build:preview` 退出 0，仅生成本工作树 .cache/preview-package；无正式 build 或 Desktop 链接更新。pnpm 11 默认自动重装共享 node_modules 被自身安全检查拒绝，用单次环境设置关闭自动重装检查，未修改共享依赖、锁文件或代理变量。
  - `pnpm_config_verify_deps_before_run=false corepack pnpm spec validate v0.8.10-cli-update-page-leeyl --strict --no-interactive` 通过（仅既有主任务超过 10 个建议）；指定 Git `diff --check` 通过。首次严格校验因追加文字触发已有 DMG Requirement 超长警告，精简该句后通过，行为条款保留在 Windows 专门 Requirement。
  - 只读调研补充：内嵌 app-64.7z 仅用系统 tar 读取产品 JSON 到内存；SignerInfo issuer+serial 精确匹配两版腾讯证书。新 TypeScript CRC 对两份完整 EXE 再算，与系统 liblzma/COS 均一致。全部下载、内嵌归档、证书及 NSIS 中间文件随 0700 临时目录删除，另一个 Python 进程回读确认目录及两个 EXE 均不存在；证据 JSON 记录回读时间。本 change 仍含实机及其他原有未完项，不归档。
- [ ] 18.4 Windows 实机安装验收
  - 待主会话实机验收；真实签名信任链、向导目录、国内版共存、磁盘空间及安装后页面回读均未执行。
