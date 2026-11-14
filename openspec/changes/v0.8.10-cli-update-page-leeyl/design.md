## Context

- PRD：`doc/prd/2026-11-13-cli-update-PRD.md`（20 条决定已全部定下）；设计稿：https://claude.ai/artifact/Drk2Ti7JmUhYEAWV5mG5Yk（15 张）。
- 后端调研（只读，未安装或运行任何 CLI）的结论已并入本设计，逐 CLI 的安装与更新方式见 PRD 5.3 表。
- 现有可复用部分：
  - 机器级路径记录：`src/host/cli-executable-paths.ts`，`resolveCliExecutable` 优先级为手动路径、部署配置、自动发现。
  - 进程后端：`src/host/process.ts`、`src/host/native-process.ts`，Windows 启动器转换在 `src/host/native-launch.mjs`。
  - 有界探测样板：`captureCatalogMetadata`（`src/host/adapters.ts:108-166`）。
  - Worker 忙闲：`WorkerRuntime.busyReason` 与 `assertAccountIdle`（`src/host/runtime.ts`）。
  - 模型目录磁盘缓存：`src/host/settings-catalog-cache.ts`。
  - 私有存储：`atomicJSON` 等（`src/host/storage.ts`）。
- 参考项目 Codingns4DSH 为 GPL-3.0，只参考行为规则，不复制代码。

## Goals / Non-Goals

**Goals**

- 设置页能看到 17 个 CLI 的当前版本、最新版本（及插件已适配的最新版本）、安装来源。
- 按真实安装来源一键更新或首次安装，下载停滞时自动续传。
- 打开设置时直接显示后台预加载好的缓存。

**Non-Goals**

- 卸载、回退、切换发布通道。
- 后台静默更新。
- 远端 Host。
- Agent 调用更新。
- 代装运行时。

## Decisions

### 决定 F：macOS 与 Windows 共用系统代理注入（2026-11-14）

- 用户决定 macOS 与 Windows 一致。`system-proxy.ts` 提取共享来源接口、15 秒按需缓存、环境优先级、NO_PROXY 合并及 Host 查找；Windows 保留原导出兼容。`macos-system-proxy.ts` 以参数数组 `['/usr/sbin/scutil', '--proxy']` 读取，只解析根 dictionary，不执行 PAC、读取凭据或更改系统/launchd。
- 两个平台复用 5 秒超时、64 KiB 输出预算、500 ms grace、失败即清除旧值、finally 终止并等待退出。首次在 Host 创建时刷新；同步 spawn 用 current，账号终端/Host 查询用 fresh，过期刷新合并为一个请求。停用 abort 来源并等待待处理读取，撤销全局 Host 查找。不新增持久化或定时轮询。
- HTTPS 开启且主机端口有效优先，否则尝试 HTTP；主机仅合法 hostname、IPv4 或带括号 IPv6，端口为 1–65535，不接受 URL、认证信息或多个代理。所有代理都转为 `http://host:port`（HTTPSProxy 表示 HTTPS 流量使用的 HTTP 代理）。没有有效显式代理时 PAC/自动发现/SOCKS 不注入，生命周期内只报一次固定诊断；多数 CLI 不认 SOCKS 变量或语义不一。
- ExceptionsList 保留主机、精确 IPv4/IPv6 与前导 `*.` 域名，后者转为点前缀，包括 `*.local` → `.local`；IPv6 去括号后用于 NO_PROXY。CIDR、169.254/16、10.*、<local>、主机端口等丢弃。依据：[curl NO_PROXY](https://curl.se/docs/manpage.html#--noproxy) 支持域名后缀、无括号 IPv6，但 CIDR 要求 curl 7.86+；[Node 24 代理支持](https://nodejs.org/docs/latest-v24.x/api/http.html#built-in-proxy-support) 的通用例外形式不包含 CIDR，因此不声称各 CLI 支持网段。始终合并回环三项，并保持继承/spec 决定代理（含显式 undefined）优先。
- `nativeProcessBackend` 覆盖 Worker、账号终端、更新/安装命令与版本/模型探测；Host `hostFetch` 和 Pi/OMP 子进程读取在 darwin 启用 HTTP(S) 代理环境解析，保留 `User-Agent: node`。Linux 不创建来源，也不注入。禁止修改 cli-management 或 Client；不运行真实 CLI。只读本机 scutil 解析仅报告主机端口与 NO_PROXY 数量，自动测试均为模拟。
- 回退仅撤回 Host 接线与该来源，无用户数据或系统设置需要迁移；不以模拟测试替代真实 CLI、模型、账号或 Desktop 验收。

| 进程类别 | 注入路径或例外原因（源码核对，非真实 CLI 验收） |
| --- | --- |
| Worker、原生 helper、terminal/private bridge、Pi/OMP bridge | WorkerRuntime → backend spawn/spawnTerminal；其内部 native-transport 子进程继承已注入环境 |
| 登录/退出/账号终端 | AccountManager → 同一 backend spawnTerminal/spawn |
| 更新、首次安装、npm/brew/官方脚本及自带 update | CliManagementService → executor → 同一 backend.spawn；脚本及 git/curl 等后代继承 |
| 版本、账号、模型探测与续期子进程 | adapters/captureCatalogMetadata、versions、账号模块 → 同一 backend；native helper 内探测继承 |
| Host 发布源、下载与目录 HTTPS 请求 | hostFetch → setHostProxy(hostProxyLookup(source))；Pi/OMP 内部请求按继承的代理环境查找 |
| 系统代理读取 | raw backend，避免系统代理探测递归 |
| OMP 私有离线 --help 能力探测 | pi-omp-environment 主动创建无网络变量的离线环境，不需要访问网络 |
| 文件权限/进程身份/桌面签名、挂载等本地命令 | 本地操作，不增加网络代理；desktop-update capture 不经后端，无网络命令无需注入 |
| 打开 WorkBuddy 桌面应用 | workbuddy-desktop-open 启动已安装 GUI，网络由应用与操作系统管理，不等同 CLI 登录终端 |

### 决定 1：一个 Host 服务，多个子模块

Host 新增 `CliManagementService`，由 `CliWorkerService` 持有并在 `ctx.effect` 清理时关闭。子模块拆成以下文件：

| 文件 | 职责 |
|---|---|
| `src/shared/cli-management.ts` | DTO、原因码、操作快照、zod schema，不含命令或秘密 |
| `src/host/cli-management/sources.ts` | 17 个 CLI 的显式来源描述：包名、发布源、自带更新命令、默认安装位置、前置条件、兼容范围、版本读取方式、是否可在后台运行 |
| `src/host/cli-management/identity.ts` | 选定路径 → 启动器 → 真实路径 → 归属（npm 前缀、Cellar、官方布局、桌面应用）→ 指纹 |
| `src/host/cli-management/versions.ts` | 当前版本读取（有界子进程或清单文件）、SemVer 比较、发布源查询 |
| `src/host/cli-management/planner.ts` | 生成计划与受控方法；只有 Host 内的方法 ID，客户端不能传 argv、URL、env |
| `src/host/cli-management/executor.ts` | 执行、取消、进程树清理、输出尾部、结果核对 |
| `src/host/cli-management/download.ts` | HTTP Range 下载、10 秒停滞、200 次预算、2 小时上限、校验、临时文件 |
| `src/host/cli-management/maintenance.ts` | 与派遣、续聊、账号、目录、路径共用的同步准入与租约 |
| `src/host/cli-management/cache.ts` | 分层缓存的读写与失效 |
| `src/host/cli-management/preload.ts` | 启动延迟、空闲判定、低优先级队列、暂停与继续 |

原因：职责清晰，单测可以只测纯逻辑（识别、比较、计划、缓存失效、停滞判定）；index.ts 只负责注册与接线。

### 决定 2：Gateway 方法

方法均为 `@Remote`，沿用现有 JSON 字符串传输与 `failure()` 错误转换：

| 方法 | 作用 |
|---|---|
| `cliUpdateSnapshot(parentSessionId)` | 返回缓存与 Host 当前阶段的整页快照（含每个 CLI 的分区、版本、来源、原因、检查时间，以及当前操作），只读，不启动探测 |
| `checkCliUpdates(parentSessionId, scope)` | scope 为 `missing`（只补缺的与过期的）或 `all`（用户点「检查更新」）；页面接上进行中的预加载，不重复探测 |
| `watchCliUpdates` | stream，推送快照 revision；断线后先取快照 |
| `planCliOperation(parentSessionId, cli, intent, installDirectory?)` | intent 为 `update` 或 `install`；`installDirectory` 只允许 ZCode、WorkBuddy CN、WorkBuddy 的 install |
| `startCliOperation(parentSessionId, planId, methodId, requestId)` | 重新生成计划核对指纹后开始；相同 requestId 返回同一操作 |
| `cancelCliOperation(parentSessionId, operationId)` | 进入 cancelling，清理确认后才 cancelled |
| `cliDownloadSource` / `saveCliDownloadSource` / `testCliDownloadSource` | 下载源设置与连接检查 |

预加载开关并入现有 `generalSettings` / `saveGeneralSettings`。

关于来源：

- `parent(parentSessionId)` 只是上下文校验，不证明是用户点击。
- 2026-11-14 已核对 SDK 0.2.2-rc.3：RemoteInvocation 只含 request、service、peer、signal/uplink；Peer principal 标记连接主体，不标记设置页点击与 Agent。Gateway 将同一 Peer 绑定到调用 Context，不能据此证明 UI 来源。保留设置页 Remote，Agent 工具清单只含 7 个 Worker 操作并有注册回归；不声称防止同机受信代码直接调用 Remote。源码行号与实际验证见 tasks 1.3。

### 决定 3：维护锁与现有忙闲共用一个同步准入

在 `maintenance.ts` 维护 `Map<CliId, Lease>`：

- `tryBeginMaintenance(cli)` 同步检查 `runtime` 的忙闲（运行、准备、停止中、排队、待接收、未暂停续聊）和账号窗口的使用租约，通过就立即写入维护租约。
- 派遣、续聊执行、账号操作、模型目录查询、路径修改的入口调用 `assertNotInMaintenance(cli)`；它与 `runtime.assertCliEnabled` 并列，不写入启用设置。
- 清理无法确认时，租约转为隔离状态，沿用现有 cleanup marker 跨重启保留。

### 决定 4：执行只走参数数组与受控方法

- npm 的运行时安装与 CLI 全局包前缀分开解析：解析 npm 启动器对应的 `npm-cli.js`，核对 npm 包清单与 bin 声明，读取 Node 原生程序文件并核对格式，不运行版本探测。优先使用 npm 启动器旁的 Node，否则解析 PATH 中的 Node；全局包前缀只作为 `--prefix` 目标，不要求前缀下存在 npm。
- Host 自动换源时按所选 registry 的标准路径生成主包 tarball 地址（显式 custom 模式使用所选源元数据中的主地址），使用 npm 官方源同版本的 sha512 校验真实下载内容；官方源也走完全相同的下载、续传和摘要校验路径。官方摘要不可得或摘要不符时拒绝安装，不降级为信任镜像摘要。校验后的私有文件改为 `.tgz`，以 `[node, npm-cli.js, 'install', '--global', '--prefix', 原前缀, 本地tgz, '--registry', 所选源]` 安装。显示的可读字节进度只对应 Host 下载的主包。
- Homebrew 用 `brew upgrade <包名>`，CLI 自带更新用其已核实的子命令。
- Qoder/CN 官方分发入口仅认 `<home>/.qoder/entry/qoder`、`<home>/.qoder-cn/entry/qodercn`，不放行 entry 目录下其他名字。更新保留记录入口的 `[入口, 'update']` 与 homedir cwd，不猜测 PATH 分发得到的实体。执行器紧邻 spawn 前用 lstat 检查 `<home>/update`；存在任何文件、目录、符号链接或检查失败时拒绝启动，避免分发到 IDE；记录入口是指向分发器的符号链接也同样检查。不删除/改名用户路径。该预检不能原子阻止外部进程恰在检查与分发之间创建路径。
- Grok 的记录入口精确为 `<home>/.grok/bin/grok` 且 realpath 在 `<home>/.grok/downloads/` 下时识别为 self-update；查询官方 stable 文本，并执行带目标版本的自带 update。
- 官方安装脚本只取 `sources.ts` 中的内置地址：先下载到 `cli-management/downloads/`，再以 `['bash', <文件>]` 或 `['powershell', '-NoProfile', '-File', <文件>]` 执行。
- Windows 的官方 npm.cmd 不当作 cmd-shim 解析或执行：按 Node/npm 发行目录的固定布局找到并核实 `node.exe`、`node_modules/npm/bin/npm-cli.js`，直接传参数数组；其他 CLI 继续沿用 `native-launch.mjs`。不用 `cmd /c`。
- Homebrew 更新后允许同一前缀、同一 Cellar/Caskroom 包、同一稳定启动器与包内入口的版本目录变化；来源、前缀、包名、入口变化仍拒绝，再单独核对目标版本。
- 桌面安装包：
  - macOS DMG 只读挂载、校验 app bundle、复制到所选目录、最后卸载挂载；
  - Windows 安装器的静默与目录参数在逐个核实前不自动执行，改为打开官方安装程序，操作进入 `awaiting-user`。

### 决定 5：停滞续传只用于插件掌控的下载

- `download.ts` 每 10 秒比较已写入字节。没有增长时 abort 当前请求，以 `Range: bytes=<已下载>-` 续传：
  - 206 时校验 `Content-Range` 后追加；
  - 200 时整包重下；
  - 416 时按服务器给的总长度核对。
- 次数预算 200，总时长 2 小时，两种失败分开编码。
- 外部命令（brew、自带更新命令、npm 的依赖下载）只在能读到字节时套用；否则进度显示「下载进度无法读取」，安装阶段 10 分钟上限。
- 临时文件放在 `cli-management/downloads/`，目录 0700、文件 0600：取消即删；失败或重启后保留 24 小时，总量上限 2 GB。

### 决定 6：缓存分层与指纹

- 缓存文件放在 `stateDirectory/cli-management/state-<平台>-<机器哈希>.json`，写入用 `atomicJSON`，读取时用 zod 校验，失败就整份丢弃。
- 缓存以 CLI 为键，分层保存：
  - 路径与归属：长期保存。路径直接复用现有路径记录，不另存第二份。
  - 当前版本：以 `{realpath, size, mtimeMs, appVersion?}` 为指纹。
  - 最新版本：6 小时，键含包名与下载源。
  - 账号状态：显示用的上次结果，键含项目目录哈希，超过 10 分钟视为过期。
- 模型目录沿用 `settings-catalog-cache`，不改它的规则。
- 前端 `SettingsDisplayCache` 保持「只在内存」的约定：页面首屏从 `cliUpdateSnapshot` 和账号快照取数据，不在浏览器侧存盘。

### 决定 7：预加载调度

- `preload.ts` 在服务创建后 `setTimeout(60s)` 启动。
- 空闲判定每 30 秒做一次：
  - Host 侧状态：`runtime` 无运行或启动中的任务、无账号窗口、无更新操作；
  - CPU：`os.cpus()` 两次采样相隔 2 秒，忙碌比例低于 50%。
- 队列为五类工作，依次做：路径 → 版本 → 账号 → 最新版本 → 模型目录。
- 执行方式：
  - 每次只执行一项，项间隔 2 秒；
  - 版本探测沿用低优先级 helper（Windows 为 `BELOW_NORMAL`），连接查询复用前台原生启动及清理路径，不另套命令包装；
  - 每项有自己的 AbortController。
- 运行时的协调：
  - 有派遣、账号窗口、更新时，`runtime` 发出忙信号，预加载 abort 当前项并等待子进程退出，然后回到等待空闲；
  - 页面调用 `checkCliUpdates` 时，把剩余项切到前台模式（并发与超时同前台），共用同一份结果。
- 账号与目录范围按决定 12 的 2026-11-14 用户决定执行，接受原生初始化与续期，排除会话及交互。
- 主会话解析时登记项目，按项目独立入队，不依赖先打开设置。

### 决定 8：前端结构

- `settings-dialog.tsx` 导航插入 `update` 项。
- 新文件 `src/client/cli-update-page.tsx`：
  - 页头；
  - 分区组件（统一折叠按钮）；
  - 行组件（32px 品牌图标、名称、说明、操作），以及展开区：进度、命令、输出、手动方法气泡、安装位置气泡；
  - 下载源下拉（`NativeChoice`）与自定义地址。
- 新文件 `src/client/cli-update-layout.ts`，放纯函数：
  - 分区归类与重排时机（最多两次）；
  - 「展开或进行中的行不动」；
  - 滚动锚点。
- 视觉取值按 `doc/settings-ui-design.md` 与设计稿规范总表：行 16/16、分区头最小高 36、页头到首分区 28、0.5px 分隔线、按钮只用 md/sm 两档。新增参数同步写回该文档。
- 文案经 `t()`，进 `client-localization` 词表。

## Risks / Trade-offs

- **首次安装来源边界（阶段 C）**：`installationSource` 以 PRD 5.3 的平台差异选择方法。Codex、Pi、CodeBuddy 用 npm；MiMo/OpenCode 的 Windows 用 npm；Pi 添加 `--ignore-scripts`；PRD 5.3.1 起 Pi 取最新版并提供未适配通知，OpenCode 仍只取 V1。npm 通过已核实的 Node/npm 读取 Node 版本及 `npm prefix -g`，校验目标包 engines 和最低版本，前缀不可写不提权。安装与更新共用 Host 计划入口、全局操作生命周期、维护锁、下载器和执行器。
- **脚本版本与摘要**：Kimi、TRAE CN（Mac/Linux）、Qoder/CN（Windows）只用 sources 内置脚本 URL 与解释器。脚本以文件执行，不传远端命令文本；没有官方独立摘要时仅依赖无重定向的 HTTPS 传输及 HTTP 长度，不称为已验证发布签名。目标选择器为 `official-current`，不编造精确版本或未证实的锁版本参数；执行后仍须读取有效且适配的版本，否则失败并保留旧路径设置。原生二进制没有已核实版本读法时不会据退出码宣告成功。阶段 C 审查确认 Claude 全平台及 MiMo Mac/Linux 没有足够证据实现原生版本读取，改回 manual；不根据目录名称猜版本、不新增未证实无副作用的 --version。MiMo Windows npm 不受影响。Antigravity/Grok 的前置条件或版本读法、OMP/Hermes 的禁止代装运行时参数、Qoder/CN 的 macOS 入口及 OpenCode macOS 锁 V1 参数仍待核实，保持仅说明。
- **阶段 C 的桌面安装边界（2026-11-14 已由末节接通 macOS）**：ZCode、WorkBuddy CN、WorkBuddy 没有已核实的安装包 URL、摘要/长度及开发者身份，因此生产来源表仍为 manual。通用执行器仅以模拟描述符验证：macOS 只读挂载、codesign Team ID 要求与 spctl、暂存复制后移动、失败清理暂存和 detach；detach 未确认进入清理隔离，不删除仍可能挂载的目录。Windows 仅启动官方安装程序并等进程范围退出，不传猜测的静默/位置参数；未实现真实 Authenticode 验收。页面位置是建议值，未来已核实来源可提供常见目录用于装后查找。
- **位置与旧路径**：纯 CLI 不接受客户端自选位置。桌面位置可不存在，但父目录须可写且空间充足，拒绝与已知项目/工作区、插件状态、账号数据及另一版 WorkBuddy 安装目录重叠。路径变更前核对路径存储 revision，只有装后身份与版本验证成功才调用现有 `CliExecutablePathStore.setManual`；失败不重置旧记录，也不删除旧安装文件。

- **npm 依赖解析边界**：官方 sha512 绑定的是目标版本主包 tarball；其依赖及生命周期脚本仍由 npm 按所选 registry 和 npm 原生规则处理。本实现不声称已独立验算所有传递依赖，也不伪造其下载字节进度。
- **阶段 C 审查修订**：Qoder/CN Windows 安装入口复用现有发现工具的官方 exe 候选；Git Bash 通过完整 PATH/git 位置与 PE/MSYS 布局作文件核实，不启动 bash/git，不依赖父目录名。Pi 损坏旧安装可生成带 unusableBefore 的重新安装计划，装后核对仍严格。桌面卸载/进程隔离错误优先保留，目录删除失败只追加原因。安装位置保护与账号读取共用 Codex/Claude 根解析，并复用 MiMo/Qoder/CodeBuddy/Hermes/ZCode/OpenCode 目录工具，包含当前生效的环境变量。
- **识别错误装出第二份**：严格按真实路径、包名、brew 元数据匹配，识别不出就转手动；更新后核对版本与路径。
- **官方脚本执行远端代码**：只用内置地址，先下载再以文件执行，行内显示地址。脚本内部的行为与落点逐个核实后才开放自动安装。
- **后台探测的副作用**：以用户提供的 2026-11-13 macOS 实机结果更新 sources 数据：Antigravity、Claude、Kimi、MiMo、Grok、OMP、Pi、OpenCode、CodeBuddy、TRAE 可后台读取版本；Kimi 禁自动升级。Codex、Qoder/CN 版本命令只在前台执行；Hermes 前后台都不执行。桌面应用继续只读文件。该规则只影响版本查询，不扩大账号预加载白名单。
- **2.8 发布源与前台版本修复**：npm 最新版本先读 `/-/package/<编码包名>/dist-tags`，保持 512 KiB / 8 秒；仅兼容受限且 latest 不兼容时拉 packument，单请求上限 32 MiB（用户实测最大 OpenCode 为 14.7 MB，预留有界增长空间），流式计数。缓存结构不变，版本列表只存 latest 和最高兼容正式/预发布候选，该轮旧缓存仍有效（第 8 节策略升级后重建）；integrity/artifact 精确版本接口和镜像回退不变。清单缺版本时前台以实际入口运行 `--version`，5 秒、stdin ignore、去 ANSI、首个完整合法 SemVer，退出进程树后才返回。版本/无版本结果按指纹复用，后台跳过不阻止首次前台读取。Codex standalone 仅按完整路径前缀归官方安装器，第 8 节已开放锁版官方脚本更新；Claude cask 可经版本查询生成 brew upgrade --cask claude-code。此轮不重新开放阶段 C 暂停的首次安装脚本。
- **缓存落后于真实情况**：版本靠文件指纹发现变化；账号状态最多落后 10 分钟。
- **Windows**：npm.cmd、进程树终止、文件占用、提权窗口不可见、空闲判定和低优先级需单独验收；不走需要管理员权限的位置。
- **Gateway 来源核实已完成**：无法区分可信 UI 点击与 Agent，写操作保留设置 Remote，不提供 Agent 工具；不把 owner 连接当作点击证据。
- **工作量大**：按阶段交付。第一阶段为只读检查、缓存、预加载与页面；第二阶段为 npm、brew、自带命令更新与停滞续传；第三阶段为首次安装（脚本与桌面）。未完成的阶段在 tasks 里保持未勾选。

## Migration Plan

- 新增状态文件，不迁移旧数据。
- 回退：停用「启动后在后台检查 CLI」开关即可关闭预加载。整体回退时删除 `stateDirectory/cli-management/`，不影响路径记录、账号与会话。

## Open Questions

- Gateway 缺少可信 UI 来源标记（2026-11-14 已核实），现行保护是设置 Remote 与 Agent 工具不互相投影。
- 各 CLI 的 `--version` 是否有副作用、自带更新命令是否只读可检查（Grok `update --check`、TRAE `update check`）。
- 三个桌面安装器的静默与目录参数。


## PRD 5.3.1 全部自动更新决定（任务 A / B）

- **发布源**：sources 固定官方地址，Host 仅替换操作系统/CPU 枚举；ReleaseClient 共用 3 并发、8 秒、512 KiB 流式预算，JSON 与纯文本都受限。npm/brew 归属优先原渠道；原生 OMP 使用现有自更新器读取的 npm latest，未采用语义不明确的另一份 build.stencil 版本。OpenCode V1 仍允许 32 MiB 兼容回退；Pi 不再回退旧适配版本。
- **Codex**：独立安装选择下载 `https://releases.openai.com/codex/install.sh`（2026-11-14 起 `chatgpt.com/codex/install.sh` 302 跳转至此，插件不跟随跳转，故直接用目标地址）到 0700 私有目录、0600 文件，以 `/bin/sh <文件> --release <目标>` 和 `CODEX_NON_INTERACTIVE=1` 执行。研究未证明 `codex update` 能同时锁版和无交互，因此不用它。Windows 独立版对应安装器参数未核实，显示平台手动原因；Windows npm/brew 不受此限制。沿用官方脚本 HTTPS 信任边界，脚本不具有独立发布摘要。
- **自带更新**：Antigravity update；Claude update；Kimi update -y；MiMo upgrade <目标> --method curl；Grok update --version <目标>；OMP update；Pi update --self；Hermes update --yes；OpenCode upgrade；Qoder/CN update；CodeBuddy update；TRAE update --channel <原安装通道> --version <目标>。所有参数数组、stdin ignore、homedir cwd，复用超时、取消、输出脱敏、进程树清理、维护锁与队列。Kimi 明确更新路径不受 KIMI_CODE_NO_AUTO_UPDATE=1 控制，保留该变量阻止启动副作用。MiMo 退出 0 不代表版本正确，仍需装后核对。
- **锁版与身份**：npm、Codex 脚本、MiMo、Grok、TRAE、桌面工件锁定目标；brew 及其余自带命令不能锁版。后者接受任意实际前进且兼容的版本，不要求等于检查目标；不变为 VERSION_UNCHANGED，未知/降低/不兼容为 VERSION_MISMATCH。只允许识别出的同一原生安装根内版本实体变化，记录入口、归属及通道不许改变。
- **Hermes**：只读 install-stamp.baseVersion，不执行版本/check/fetch；commit 加入指纹。未记录通道时显示 unknown，notice 明示 stable 查询不能证明 canary 的精确 ahead/behind，不切换通道，只比较可核实 baseVersion，执行后重新读取。迁移配置、更新依赖及可能重启服务的说明须在前台操作前可见。
- **Pi**：PI_SUPPORTED_VERSIONS / isSupportedPiVersion 单一来源；管理页放宽有效版本读取，包名及安装入口仍验证，Worker 默认检查完全保留。notice 为「插件尚未适配 Pi X，更新后 Pi Worker 要等插件适配后才能使用」。main 未加入另一分支的 1.5.2 适配实现。
- **桌面接口**：直接调用任务 B 的 readDesktopRelease/runDesktopUpdate，测试使用 vi.mock；下载回调经官方 sha512/sha256 与可用长度核对后返回完整 `.part`，不提前改 exe。ZCode 读 Info.plist 短版本；WorkBuddy 保留 CLI 版本、另读 appVersion，现有官方 Info.plist/条件 feed 使用三段应用版本，四段 productVersion 的工件信息留在计划中，核对使用三段应用版本。204 的 DesktopUnavailableError 当前按明确中文 message 匹配为 latest、latestVersion=appVersion、无 token；建议任务 B 将来提供独立 no-update 错误码，避免依赖文案。
- **缓存与手动原因**：策略版本升至 2，旧显示/版本/发布缓存整体重建；显示投影增加 appVersion/notice/channel。手动仅保留原外部管理器、未知归属、Windows ARM64 Qoder、尚无对应官方源的 TRAE 通道、未核实的平台安装器和桌面源明确不可用等具体原因。首次安装来源表独立，本任务不借更新证据开放未知首次安装。
- **证据边界**：本次不联网、不运行真实 CLI、脚本、npm、brew 或安装器；所有新增执行证据来自标注「模拟」的夹具。原研究标未核实的交互、工件可用性和退出语义不冒充实机验证；通过 stdin ignore、有界执行及装后核对约束，真实验收另列。

## 任务 C：实机检查修复决定（2026-11-13）

- Kimi 固定匿名源改用最终 CDN 地址，仍拒绝 HTTP 跳转；同时核对纯文本 latest 与两个安装脚本地址。
- 自动路径记录持久化发现的入口，身份验证产生的版本实体仅用于本次调用。旧 auto 的已核实托管版本目录在前台重新发现后以 revision 比较写回；manual 和部署路径优先级保持不变，失败不覆写旧记录。后台不通过 PATH 迁移旧实体，等待前台发现。
- 管理页解析 Pi 入口时允许读取未适配版本，Worker 仍按原支持集合校验。每次检查从入口读取 current-version 并解析实体，以实体路径和清单版本使版本缓存失效。
- ZCode 固定 managed runtime 的自动入口在 macOS 关联默认 ZCode.app，先核对 Info.plist 的 CFBundleIdentifier=dev.zcode.app，再读应用版本；其他 manual 路径保持原行为。该 runtime 是官方源树构建的完整 CLI（本机 INSTALL-MANIFEST 记录 2026-10-05、0.16.9、treeSha 29628c9acdb81b703bbd4080c207a0e7ce5e276e），由临时 staging 脚本部署，不是从应用复制；不能用桌面内置 CLI 自动覆盖完整 runtime。检查行及更新结果必须明确说明桌面更新不会同步更新独立 Worker runtime，需另行核验与部署。

### 任务 C：逐 CLI 影响核对

下表为本次只读核对的 macOS 记录与源码布局；不表示真实更新验收。通用 auto 写回均保存发现入口。迁移只适用于 auto、没有更高优先级部署配置、命中已知版本目录；保留 revision 竞争保护和现有 0700/0600 持久化。

| CLI | 本机记录与影响 | 旧版本实体迁移覆盖 |
| --- | --- | --- |
| Antigravity | auto `~/.local/bin/agy`，未受此缺陷影响 | 未发现已核实版本目录，不猜测 |
| Codex | auto `~/.local/bin/codex`，当前稳定 | `.codex/packages/standalone/releases/<v>/…`、对应 Caskroom |
| Claude | auto `/opt/homebrew/bin/claude`，当前稳定 | `.local/share/claude/versions/<v>`、对应 Caskroom |
| Kimi | auto `~/.kimi-code/bin/kimi`，路径稳定；发布源跳转受影响 | 未发现已核实版本目录；固定 CDN URL 修复 |
| MiMo | auto `~/.mimocode/bin/mimo`，当前稳定 | 未发现已核实版本目录，不猜测 |
| ZCode | auto 插件 runtime，应用来源和版本识别受影响 | 独立 runtime 不当作版本实体迁移；关联核实后的应用 |
| Grok | auto `~/.grok/bin/grok`，当前稳定 | `.grok/downloads/grok-<v>-…` |
| OMP | auto `~/.local/bin/omp`，当前稳定 | 原地更新布局，未发现此类版本目录 |
| Pi | auto 固定 1.0.4 实体；只读 current-version 已为 1.5.2，受影响 | `.pi/agent/install/releases/<v>/…`；不迁移插件刻意冻结的私有 Pi runtime |
| Hermes | auto `~/.local/bin/hermes`，当前稳定 | checkout/shim 布局，不猜测版本目录 |
| OpenCode | auto `/opt/homebrew/bin/opencode`，当前稳定 | 对应 Cellar |
| Qoder | auto `~/.qoder/entry/qoder`，当前稳定 | `.qoder/bin/qodercli/qodercli-<v>` |
| Qoder CN | auto `~/.qoder-cn/entry/qodercn`，当前稳定 | `.qoder-cn/bin/qoderclicn/qoderclicn-<v>` |
| CodeBuddy | auto `/opt/homebrew/bin/codebuddy`，当前稳定 | 对应 Cellar |
| TRAE CN | auto `~/.local/bin/traecli`，当前稳定 | `.local/share/traecli/releases/<v>-…/…` |
| WorkBuddy CN | auto 应用内固定 CLI 入口，当前稳定 | 无此类版本目录 |
| WorkBuddy | 本机没有路径记录；源码为应用内入口 | 无此类版本目录；不推断实际安装状态 |

### 任务 C：只读来源证据与刷新边界

- Kimi：旧域名的 latest.json、latest、install.sh、install.ps1 均实测 HTTP 302，Location 为同路径 cdn.kimi.com；四个 CDN 端点均直接 HTTP 200。匿名 GET 的 latest.json 版本与 latest 纯文本均为 2.6.1。Host 没有使用纯文本 latest，因此不新增冗余请求。
- ZCode：本机 Info.plist 为 XML，CFBundleIdentifier=dev.zcode.app、CFBundleShortVersionString=3.17.2；`codesign -dv` 只读输出 TeamIdentifier=8A5X4JJ39T。后台关联采用最低充分证据 bundle id，无需启动 codesign 子进程；桌面更新器原有团队签名验证保留。
- runtime 的 INSTALL-MANIFEST.generatedAt=2026-10-05T09:17:48.149Z，VERIFICATION.verifiedAt=2026-10-05T09:19:06.562Z、filesVerified=3424、symlinks=0。`.cache/stage-zcode-runtime.mjs` 从 `/private/tmp/ZCode-main/apps/zcode-cli/packages/cli/dist` 收集完整 CLI、TUI/Playwright 运行依赖及配套 provider 文件，用 copyFile 形成 staging，写出 source.origin=https://github.com/zai-org/ZCode 及源树 SHA。Host 源码只选择该已部署入口，没有从 `.app` 复制或定时刷新的逻辑。最后从 staging 搬入用户 runtime 的具体命令/操作者未获取，不作推断。
- 桌面包内 CLI 与该完整 runtime 能力不同，不能套用不存在的“应用副本刷新”。本次使用简报允许的明确说明路径：检查行 notice 和桌面更新操作 outputTail 均保留“独立 runtime 不会随应用同步更新，需另行核验并部署”的说明，不声称 Worker runtime 已升级或与新应用配套。

## 任务 D：中断恢复设计

下载器只对白名单网络异常、提前 EOF 与真实字节停滞恢复，协议错误立即终止，完整文件校验失败干净重下一次；原始输出在脱敏前流式识别中断证据，只保存布尔值和有限的跨块匹配窗口，展示仍使用原脱敏/截断规则。外部重跑在整个进程范围退出并完成版本核对后决定，保持同一 argv，200 次与 2 小时共同预算，禁止用无输出时间冒充下载停滞。官方本地交接优先；任务 D 续已批准 MiMo macOS zip/--binary 接管及官方双源自动切换，撤销有配置副作用的 TRAE offline-install 接管。详细核实表与验证证据见下文。

### 任务 D：最终恢复策略与审计表

`recovery.ts` 集中保存 200 次、2 小时及中断证据规则。下载器的滑动 10 秒无字节计时与固定 10 秒速度窗口独立：`DOWNLOAD_SLOW_BYTES_PER_SECOND=100_000`，1 KB=1000 B；必须先见到 `Accept-Ranges: bytes` 或 206 才按慢速重连，服务器无声明时不推测能力，Range 被忽略返回 200 后禁用后续慢速重连。200 次耗尽后不再主动断开仍有进展的连接；真正无增长 10 秒失败，持续传输仍受 2 小时约束。已断线且次数耗尽不能继续传输，照常报告耗尽。

外部命令不监听“无输出”或慢速，也不虚构外部文件字节。原始 stdout/stderr 每个块在脱敏前被检查，保留的只有中断布尔值和 256 字符跨块窗口；显示仍为脱敏后的 32 KiB 尾部，超长行仍省略。每次重试复用同一 argv、确认进程树退出、追加分隔行，新增共享可选字段 `progress.retryCount`，不复用 `resumeCount`。版本前进后即使仍有中断文本也不重跑；非零退出仍保留 EXIT_CODE 失败，不伪装成功。未知归属、身份改变、清理未确认均不重试。

证据常量：curl (18)/(28)/(52)/(56)，transfer closed，connection reset/closed/timed out，ECONNRESET、ETIMEDOUT、ECONNABORTED、EPIPE，socket hang up，unexpected EOF/end of file，premature close，UND_ERR_SOCKET/CONNECT_TIMEOUT/HEADERS_TIMEOUT/BODY_TIMEOUT/RES_CONTENT_LENGTH_MISMATCH。下载器另处理 fetch TypeError 和 Content-Length 提前 EOF；先遍历 cause 排除证书/TLS/SSL/非法 URL/redirect 错误，HTTP/Range 协议错误不按网络中断恢复，完整文件校验另走单次干净重下。依据：本次 MiMo 实机证据；本机 `curl --manual` 6571–6573、6608–6611、6682–6684、6698–6700 行对 18/28/52/56 的定义。任务 D 续已按主会话决定对齐 PRD 5.6 第 7 条：完整文件长度/摘要不符删除片段后干净重下一次，仍失败固定报“下载的文件校验不通过”；不占用/重置 200 次，不重置总超时。HTTP、证书、Range 协议异常和 2 GB 上限仍直接失败。

以下 `net/`、`static/`、`task-d/` 均相对 `.cache/cli-update-research/`。所有脚本仅阅读，未执行；任务 D 新 GET 的 MiMo/OMP/TRAE v2 与缓存逐字节相同。GET OpenCode/Claude 新脚本保存于 task-d。

| CLI | 本轮结论 | 官方依据与边界 |
|---|---|---|
| MiMo | 接管（macOS 默认原生更新）；其他原归属 | `task-d/mimo.sh:19,48–78,186–205,335–368`：官方 --binary 安装入口。内置双 FDS 源 zip 模板 + HEAD 长度/ETag/content-md5 一致性 + 文件 MD5；精确提取根成员 mimo，解压 CRC/普通文件/单链接/大小校验，再以私有脚本文件执行。无独立摘要。npm 归属仍接管主包；Linux tar 与非默认布局保持原生。 |
| Kimi | 外部下载重跑 | `net/kimi-install-direct/body:21–22,521–553`：下载基址硬赋值，manifest/tar/raw URL 自行构造，没有已核实本地工件入口；`--version`/安装目录不是本地包开关。 |
| Codex | 外部下载重跑 | `net/codex-install-direct/body:5–10,82–98,330,392–395`：支持 --release，发布基址固定，无已核实本地工件入口；npm 主包原有接管保留。 |
| TRAE CN | 原生更新 + 中断证据重跑 | 主会话撤销 offline-install 接管：`task-d/trae-install-v2.sh:2124–2125` 会关闭自动更新，属于用户配置副作用。回 `traecli update --channel <原通道> --version <目标>`，不引入新环境变量；首次安装回既有官方脚本。用户提供原生 0.213.1→0.215.0 实机通过，本轮仅模拟。 |
| Claude | 外部下载重跑 | `task-d/claude.sh:6–10,38,148–159,196–226`：可传版本，但脚本固定下载新版安装器并调用 install；没有已核实本地包参数。 |
| OpenCode | 接管（Unix 默认原生 V1 更新） | `task-d/opencode.sh:19,48–58,80–89,173–180,216–218,351–375`：--binary；只选择 V1 官方工件，HEAD 核对长度，精确提取根成员 opencode 后交官方脚本。仅允许 github.com 官方模板跳转至 release-assets.githubusercontent.com，GET 禁止再跳转。首次安装原有 manual 边界不变。 |
| Antigravity | 外部下载重跑 | `net/agy-install-direct/body:11,20,102`：固定 manifest 基址，--dir 只改安装位置；未见本地包入口。 |
| Grok | 外部下载重跑 | `net/grok-install-direct/body:203–204,401–437`：primary/fallback 固定，下载自己的工件；现有 update --version 不提供本地包参数，见 feeds.md §3.6。 |
| OMP | 接管（Unix 默认原生更新） | `task-d/omp.sh:20–21,293–324,325–335`：官方 PI_BUILD_URL + --binary --ref；构建元数据给 sha256/size，插件先下载已核实 R2 主机上的签名工件，私有清单只将 download 改为 file URL，官方 curl 读取本地清单/文件后自行校验安装。不开 --source，不代装 Bun。 |
| Pi | managed 外部下载重跑 | `net/pi-install-direct/body:5,1005–1028,1045–1062`：PI_INSTALLER_API_BASE 只控制 metadata/package/lock，要求 HTTP 200（file:// 的 000 不可用），后续依赖由 npm 安装；没有已核实无需另启 HTTP 服务的本地交接。npm 主包仍由插件下载。 |
| Qoder | 外部下载重跑 | `net/qoder-install-direct/body:13,31–36,254–277,324`：基址固定、只提供版本/force/quiet/path 开关，脚本下载包后调用内置 install。原 dispatcher 同名 update 防护保留。 |
| Qoder CN | 外部下载重跑 | `net/qodercn-install-direct/body:13,31–36,254–277,324`：同上，使用独立 CN 基址，不混用国际版。 |
| Hermes | 外部下载重跑 | `~/.hermes/hermes-agent/hermes_cli/subcommands/update.py:10–13,40–44,51–56,99–115`：git+依赖更新、channel/branch/yes，无本地工件入口；不改迁移/服务重启语义。 |
| CodeBuddy | native 外部下载重跑；npm 主包接管 | 本机 `@tencent-ai/codebuddy-code/dist/codebuddy.js:1522`，摘录 `task-d/codebuddy-update-parser.txt`：update 无本地参数，install [target] 仅目标版本；npm 归属继续原同前缀 tarball 路线。 |

所有本地工件按锁定版本准备，安装后实际版本必须等于该目标（仅版本前进不足以成功）。本地工件位于插件 0700 目录、文件 0600；归档只选指定根成员，拒绝符号链接/硬链接/非文件，输出二进制仍由官方脚本安装，不复刻更新安装步骤。跨平台模板只取 Host 平台/架构；x64 使用官方 baseline，Linux libc 根据 Host 判定。失败/取消清理自身交接目录，进程清理未确认时保留；过期 local-* 私有交接目录按 24 小时清理。未清理安装器自有目录。

### MiMo 已批准实施的方案与边界（任务 D 续）

- 官方 `task-d/mimo.sh:66–78` 固定安装位置 `$HOME/.mimocode/bin`，支持 `--binary <path>` 并跳过下载/检测；`186–205` 固定 FDS 模板，darwin-arm64 目标为 `.../releases/v0.1.17/mimocode-darwin-arm64.zip`。
- 原流程 `335–354`：建立 `$TMPDIR/mimocode_install_$$`，curl 到 zip，macOS unzip（Linux tar），将根成员 mimo 移到安装目录，chmod 755，成功后 rm 临时目录。`357–368` 的官方本地分支为 cp 本地 mimo 到同一目录并 chmod 755。现按授权由插件下载并校验 zip、只提取根成员 mimo，然后参数数组 `[/bin/bash, 私有官方脚本, --binary, 私有mimo, --no-modify-path]`。不必复刻安装逻辑。
- 本次匿名 HEAD 200，Content-Length=**33,817,652 B**，Accept-Ranges=bytes；ETag/content-md5 存在但不是 SHA256/SHA512 独立发布摘要。任务 D 续追加后使用官方 HTTPS HEAD 长度和 content-md5（支持 hex/base64）校验文件，再核对 zip 结构/解压 CRC、安装后身份/版本。ETag 用于对象一致性/If-Range，不冒充 SHA256；同源 MD5 不代表独立签名验证。
- 风险：同源 MD5 只能校验传输完整性，不提供独立签名认证；官方脚本本地 cp 非原子替换，需维护锁、进程范围清理和安装后重新探测；自定义安装位置不可直接套默认目录；x64 baseline/Linux musl 与 Windows 需独立核实；下载/解包后不得让安装阶段 10 分钟倒计时提前覆盖 2 小时下载预算。
- 用户提供第一次代理断线 11,091,327 B、第二次直连约 40 KB/s 在 10 分钟后留 27,181,941 B 的证据。只读磁盘确实见 `$TMPDIR/mimocode_install_31818` 1 文件 **11,091,327 B**、`mimocode_install_52437` 1 文件 **27,181,941 B**，合计 **38,273,268 B**，均未删除、改写。未自行运行两次更新，退出/原安装完好结论来自用户证据。
- **任务 D 续已启用 macOS 默认原生 MiMo 更新接管**，先下载后启动安装器 10 分钟计时；Linux tar、Windows 与自定义位置按原归属，首次安装 manual 不扩张。本轮全部测试模拟，尚未真实更新 MiMo。

### OMP 与原生更新的差别及风险（任务 D 续）

- 用户提供原生 `omp update` 从 16.4.4 到 18.20.0 实机通过。该证据只证明原生更新器，不代表本地交接已实测。
- 本地交接不执行原生 `omp update`：插件按锁定版本/Host 平台构建官方 API 请求，校验 SHA256 和 size，将工件落到 0700 私有目录；保持官方 build/file 清单结构，仅把 download 改为 file URL，通过进程局部 `PI_BUILD_URL=file://...`、`PI_INSTALL_DIR=$HOME/.local/bin` 调用官方脚本 `--binary --ref v<version>`。
- `task-d/omp.sh:293–324` 用 curl 读清单和工件，再次核对 SHA256；`325–335` chmod 后同目录 mv，随后运行 --version。没有 --source 或 Bun 代装，也不写用户持久配置。
- 风险：官方脚本/API schema/签名资产主机可能变化；file:// 需官方 curl 支持；脚本通过 uname/libc 选平台而插件按 Host 平台/架构选平台，Rosetta 或特殊 libc 的组合可能不一致（本地清单找不到则失败，不猜另一平台）；默认路径之外不接管。脚本自身后续行为可能与原生 update 不同，必须由主会话实机复测；本轮不把原生成功外推为交接成功。

### MiMo 官方多源（2026-11-14，任务 D 续追加）

- 用户已同意自动换源，主会话提供 2026-11-13 23:5x 实机证据：两个小米 FDS 域名上的 v0.1.17 macOS arm64 zip 长度均为 **33,817,652 B**，ETag/content-md5 均为 **fef70ee7fcb83ec003fd29ecb85cea68**，Last-Modified 相同、均支持 Range。原域名 40–137 KB/s；API 域名完整下载 7.29 秒、4.6 MB/s，经代理约 1 MB/s，下载 MD5 一致；API latest 返回 0.1.17。这些数字来自用户，本轮未重做真实下载。
- `sources.ts` 保存 host 白名单与 `/mimocode/mimocode/releases/` 前缀，首选 `cnbj1.fds.api.xiaomi.com`，备用 `mimocode.cnbj1.mi-fds.com`；生成地址只含经过校验的目标版本/Host 平台，拒绝凭据、query/hash/port，GET/HEAD 均 credentials:omit、redirect:error。latest 同样 API 优先，失败/无效版本回原域名。
- 通用下载器接收 `sources: string[]`；首个可达源 HEAD 建立固定身份，换源必须再次 HEAD 且长度、ETag、content-md5 一致（MD5 hex/base64 归一化）。来源身份变化直接拒绝，不拼接新对象；GET 复核 ETag/MD5，206 复核范围及总长度，发送 Range 和可用的 If-Range。200 忽略 Range 时覆盖重下；完成后的长度或文件 MD5 不符走一次干净重下，既有计数/2 小时不重置。
- 中断、低速或停滞重连轮换源，计入同一 200 次，新增输出“切换到 <host> 继续下载（第 N 次）”；200 次用尽仍有进展保留当前连接，真正停滞才失败。HEAD 失联可尝试其他列出的源，全部不可用则失败；证书或源身份不符不视为可恢复网络中断。随后 PRD 3c 已扩展至 npm 主 tarball；桌面包缺少已核实第二源仍单源，CLI 自带下载仍按证据重跑。

### 其他 CLI 官方多地址证据（仅列候选，不启用）

| CLI | 已有官方证据 | 尚缺的同对象证据 |
|---|---|---|
| Codex | `net/codex-install-direct/body:319–330,494–506,1420` 对同一版本、同一 asset 构造 releases.openai.com/codex/releases 与 github.com/openai/codex/releases/download/rust-v 两条地址，官方 download_file_with_fallback 共用 expected_digest。 | 本轮未 HEAD 两端工件核对长度/ETag/content-md5；GitHub 重定向到签名资产须独立适配，不能直接套 MiMo 白名单。 |
| Grok | `net/grok-install-direct/body:203–204,401–437` 明确 x.ai/cli 与 storage.googleapis.com/grok-build-public-artifacts/cli 是 primary/fallback，同一 version/platform 的 artifact_base 仅切 base。 | 仅脚本级回退依据，未获得两端同对象 HEAD/摘要；不能声称已证实可跨域 Range 拼接。 |

Kimi 仅有安装脚本/metadata CDN 跳转证据，OpenCode 只有 GitHub 到签名资产的重定向，OMP 是 API 到 R2 下载地址，TRAE 是原站与 CDN 脚本地址；均不构成本轮已核实的“同安装包多域名”证据，不列为可直接启用的多源。

### 通用自动换源与 npm 设置（2026-11-14，覆盖仅 MiMo 的临时范围）

- PRD 5.6 3c 已读原文。npm 主包与 MiMo 使用同一多源能力；外部命令自己下载不适用。官方/npmmirror 设置以对应 registry 为首选；follow 以 npm 当前 registry 为首选，再补官方/npmmirror 去重；custom 显式关闭自动切换（MiMo 同样仅首选源，同源恢复不受影响）。操作启动时同时锁定 registry 与换源策略，准备期间修改设置仅影响下一次操作。
- npm 工件只从官方精确版本 packument 取 sha512；自动模式不读取镜像 packument 的 integrity 或 tarball，按 `<registry>/<scope/name>/-/<name>-<version>.tgz` 构造地址；custom 主地址可来自该 registry 元数据，但其 integrity 不参与信任。安装与更新均接线，npm 子依赖仍由 npm 处理。
- HEAD 核对完整长度；Range HEAD 的 206 必须为 bytes 0-(total-1)/total。ETag 相等或可识别的 32 位 hex ETag/content-md5 摘要相等方可切换，长度不同/摘要冲突直接拒绝；一般 ETag 保持大小写敏感。If-Range 使用当前源的原始强 ETag，不拿上一源的标签替代。最终仍核对官方 sha512；同源 MD5 不取代该校验。
- 本轮匿名 HEAD `is-number@7.0.0`：registry.npmmirror.com 标准路径返回 **302**，Location 为 `https://cdn.npmmirror.com/packages/is-number/7.0.0/is-number-7.0.0.tgz`；CDN **200 / 3,730 B**，ETag `6C6E00114E00C2815FC0AEAE3DA1AF23`，content-md5 `bG4AEU4AwoFfwK6uPaGvIw==`。npm 官方普通 HEAD **200** 无 Content-Length；带 Range 的 HEAD **206 / bytes 0-3729/3730**，ETag `6c6e00114e00c2815fc0aeae3da1af23`。另对已记录版本 @openai/codex@0.162.1 的标准包地址执行 HEAD，返回 **302**，Location 为 `https://cdn.npmmirror.com/packages/%40openai/codex/0.162.1/codex-0.162.1.tgz`，据此对 scoped 包的每个路径段编码（保留分隔 /）。仅 HEAD，无 tarball GET。该证据支持精确映射的镜像 CDN HEAD 跳转及摘要归一化，不表示所有包均可切换；运行时每个对象仍必须复核。
- 镜像只允许标准地址到同包/版本的 `cdn.npmmirror.com/packages/...` 精确跳转；不跟随任意 Location。HEAD 的已核实跳转目标成为 GET 地址，GET 始终 redirect:error。MiMo URL 的 host/路径白名单和禁止重定向不放宽。
- 新增可选 `CliDownloadProgress.sourceHost?: string`，每次有效源变化随进度推送当前实际 GET host，npm CDN 时显示 cdn.npmmirror.com；复用“切换到 <host> 继续下载（第 N 次）”。Client 本轮未修改，主会话负责显示。

### 桌面包第二源核实结果（匿名 HEAD，未配置多源）

| CLI | 已有官方包与本轮 HEAD | 第二源结论 |
|---|---|---|
| ZCode | 已有 feed `net/zcode-mac-direct/body:1–10` 的 3.18.2 macOS arm64 zip；cdn-zcode.z.ai 返回 **200 / 305,360,326 B**，ETag `99D36E8C5D465A340C10F98E7C87CF81-30`，无 Location。feed 有 SHA512。 | 未获取第二官方域名；同清单 dmg 是不同文件，不作为备用 zip。 |
| WorkBuddy CN | `net/workbuddycn-latest-darwin-arm64-direct/body` 的 5.9.3.42398134；download.codebuddy.cn 返回 **200 / 447,126,372 B**，ETag `80ea3a42a97094e485de2c88ae205048-427`，x-cos-meta-md5 `ecded5aedfef7d276a14d14c0e276bf0`，无 Location。feed 有 SHA256。 | 未获取第二官方同对象域名；不将国际版地址当镜像。 |
| WorkBuddy | `net/workbuddy-latest-darwin-arm64-direct/body` 的 5.9.4.42593613；download.codebuddy.ai 返回 **200 / 478,466,147 B**，ETag `6b5d8abc5ade49edeb9e41867c8acfd8-457`，x-cos-meta-md5 `0d931f9ebea458d7ff2976c329d10ba1`，无 Location。feed 有 SHA256。 | 未获取第二官方同对象域名；不将 CN 地址当镜像。 |

以上为当前已知官方 feed 指向对象的响应证据，不是全网不存在镜像的证明。本轮不猜测 OSS/COS 内部桶域名、不下载桌面包，不改 desktop-update.ts。


## 2026-11-14 首次安装来源与实机复核

- macOS 首次安装复用 `readDesktopRelease`，通过现有 ReleaseClient 的 3 并发、8 秒与 512 KiB 预算读取匿名清单；`sources.ts` 固定应用名、包内 CLI、Team ID，客户端不能传 URL、摘要或签名主体。计划 token 包含本次 release 描述符，执行前重新核对；下载摘要失败不执行解包或安装。ZIP 在 0700 私有目录用系统 ditto 解包，codesign --deep --strict 的 Apple anchor / Team ID 及 spctl 通过后复制，应用版本必须等于清单目标才写回路径。DMG 的只读挂载与卸载继续保留。
- [ZCode 官方安装页](https://zcode.z.ai/en/docs/install) 与 `https://zcode.z.ai/api/v1/releases/electron/manifest?platform=darwin-aarch64&channel=1`：本次版本 3.18.2，`cdn-zcode.z.ai/zcode/electron/releases/3.18.2/macos-arm64/ZCode-3.18.2-mac-arm64.zip`，305,360,326 B，官方 SHA-512 `KD7Z6GjYQWAX2tvgIE35XA4iLU5jn41tx5Wz2ZJEs+ivWu56cQY3yqsusuh88MvgCrtOykRjfhOyHhA1S2Q2gA==`；固定 Team `8A5X4JJ39T`。隔离安装通过。
- [WorkBuddy CN 官方安装页](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Installation-Mac-Guide) 与 `https://www.workbuddy.cn/v2/update?platform=workbuddy-darwin-arm64&version=0.0.0`：5.9.3.42398134，download.codebuddy.cn 的 `/workbuddy/saas/darwin-arm64/WorkBuddy-darwin-arm64-5.9.3.42398134-d4692421.zip`；清单 SHA-256 `55d73c63e44be58e31411254d10ad141faef9fd9eaf3cab67685d81f88e14835`。Team `FN2V63AD2J` 沿用既有本机签名依据，本次未重新下载 CN 包，不把清单读取当作该包真实安装验收。
- [WorkBuddy 官方安装页](https://www.workbuddy.ai/docs/workbuddy/From-Beginner-to-Expert-Guide/Installation-Mac-Guide) 与 `https://www.workbuddy.ai/v2/update?platform=workbuddy-darwin-arm64&version=0.0.0`：5.9.4.42593613，download.codebuddy.ai 的 `/workbuddy/saas/darwin-arm64/WorkBuddy-darwin-arm64-5.9.4.42593613-fa0a0901.zip`。清单 SHA-256 为 `6502dc77a0d931dc5b6c490dea20b5966bab0c5c64fea65938ecb15e4a5fbea6`；插件两次下载均不符而删除片段。独立 curl 下载 478,466,147 B 的 SHA-256 为 `754926260c0ab867b5fe1050ab5cc01724a1330451617c8f339c679ff3bbc542`；保留拒绝，不替换官方摘要、不绕过完整性检查。仅解包检查签名：`com.workbuddy.workbuddy-ai`、Developer ID Application Tencent Technology (Shanghai) Company Limited、Team `FN2V63AD2J`，codesign --verify --deep --strict 通过，存在 stapled notarization ticket。此签名检查不是插件安装成功证据，也未打开应用、读账号或登录。
- Windows 仍只提供官方说明：当前没有 Windows 实机、没有已核实的首次安装 Authenticode 与向导实际落点，不猜静默参数或把用户建议位置当成实际位置。任务 5.2、7.4 因 Windows 部分保留未勾选。
- OMP 的 `https://omp.sh/install` 本次 HEAD 为 302，目标是 `https://raw.githubusercontent.com/can1357/oh-my-pi/main/scripts/install.sh`；因下载器拒绝跳转，将本地交接脚本固定为该官方目标。GET 构建 API 已确认 18.19.0 / 18.20.0 可用；16.4.4 的 HEAD 404 不用于推断 GET 不可用。真实交接及脚本调用的最终结果见任务 11.6。

### 决定 12：设置页连接状态使用 Host 预加载缓存（2026-11-14）

设置页连接状态包括账号投影和模型目录（`ModelChoice.efforts` / `variants` 随目录一起取得，不另起强度查询）。新增 `SettingsConnectionCache`，在 Host 内存中按规范化项目路径哈希、CLI、账号/目录分槽；有效期均为 10 分钟。该缓存不持久化、不恢复上次 Host 的绿色登录态，不用于执行授权。保留原 `SettingsCatalogCache` 的磁盘目录及账号绑定机制，任务和保存选型仍实时授权。

`cliSettings.settingsCache.connections` 首屏携带所有 CLI 已有状态；`settingsConnectionStatus(parentSessionId, cli, signal)` 立即返回已有或缺失的分槽，并为缺失/过期槽启动前台查询；`watchSettingsConnections(parentSessionId, signal)` 首次返回整份项目快照，此后推送加载、完成、失败和作废。原 `accountStatus` / `catalogForCli` 未过期直接复用同一缓存，过期/缺失等待现查；`refreshAccountStatus` / `refreshCatalogForCli` 强制查询。旧客户端无需新字段仍可用；前端消费新快照由独立任务实施。

时间使用 `checkedAt`（epoch ms），时钟回拨视为过期。快照含 `project`（SHA-256）、CLI `revision`、全局递增 `sequence`；每槽含 `loading`、`value?`、`error?`、`cache?={checkedAt,stale,project,revision,displayOnly:true}`。账号快照保留 Host 原摘要，但移除动作及逐条退出句柄；过期的 authenticated 降为 unknown，没有 verification 的 authenticated 也降为 unknown。目录只返回模型、强度与 notice，不返回 Host binding。缓存读取不替代登录操作前的即时校验。

登录/退出窗口 reservation 开始与结束、账号变更回调、CLI 开关、执行入口变化及更新后经统一失效机制清除两槽并增加 revision。保留 `accountRevision` 和执行入口 revision 的同步检查。作废同时 abort 进行中查询；后续请求先等旧查询清理，旧结果不得回填。显式刷新也排在正在进行的读取之后，不被该读取吞掉。查询失败清除旧成功值；关闭 Host 中止并等待全部查询，取消订阅移除监听。

项目在解析主会话时登记，因而不依赖先打开设置；无项目时不猜项目。已知项目的允许连接项加入原空闲队列，后加入项目可继续入队；同一项目只登记一次，无定时重复全量查询。启动 60 秒、2 秒 CPU 双采样/间隔、CPU <50%、无任务/登录/更新、打断清理与 30 秒空闲恢复规则不变。进入更新页接管时也完成已知项目的允许连接项。关闭开关后不启动后台项；前台显式查询不受该开关限制。

2026-11-14 用户决定将后台范围扩大为「除原生会话外全部」，并明确接受打开设置时已有的原生服务启动、初始化、令牌续期及插件私有运行配置写入。以下为源码审计与本次接线，**不是本机 CLI 或账号实测**。账号与目录均使用已记录的绝对入口，缺失不额外发现 PATH；目录钉住该入口后复用前台 `SettingsCatalogCache.get → readAccountBinding / queryCatalog → authorizedCatalog → catalogFor`，不另造后台协议。原生安装身份校验与所需 helper 沿用前台逻辑。账号复用 `AccountManager.status` 完整路径，后台标记仅限制名单和入口，不再省略可续期账号或原生登录服务商目录。

| CLI | 后台账号/登录 | 后台模型与强度 | 实际路径及仍保留前台的理由 |
| --- | --- | --- | --- |
| Antigravity | 不纳入 | 不纳入 | macOS security 钥匙串可能弹授权框；两类查询仍保留前台。 |
| Codex | 纳入 | 纳入 | `readCodexAccount`：`app-server --stdio` 的 `account/read`，旧版回退 `login status`；`discoverCodexModels`：同命令的 `model/list` 与账号模型元数据。允许服务初始化及其原生续期，不发送 thread/prompt。 |
| Claude Code | 纳入 | 纳入 | 账号 `auth status --json`，必要时 `prepareClaudeWorkerLaunch` 写私有路由配置；原生目录 `discoverClaudeNativeOAuth` 只发送 initialize/get_usage，路由目录走 `readFirstPartyModelSources / discoverFirstPartySources`；接受原生初始化，不发送用户消息。 |
| Kimi | 纳入 | 纳入 | 账号和来源探测 `provider list --json`，目录 `readFirstPartyModelSources / discoverFirstPartySources` 读取自身 OAuth 能力及账号模型元数据；保留 `KIMI_CODE_NO_AUTO_UPDATE=1`。 |
| MiMo | 纳入 | 纳入 | `readMimoAccount` 本地状态；`discoverMimoModels` 读取账号模型元数据和原生列表，必要时执行 `models --refresh`。刷新模型缓存已获接受，不升级 CLI。 |
| ZCode | 纳入 | 纳入 | `zcodeGrokAccountStatus('zcode')` 本地状态；`discoverZCode` 读取配置及 GET 模型列表、前后核对 binding；改与前台共用完整目录路径，仍不创建原生会话。efforts/variants 来自原生解析。 |
| Grok Build | 纳入 | 纳入 | `zcodeGrokAccountStatus('grok')` 完整本地状态；`discoverGrok` 运行 Node 原生目录 helper、`--version` 与账号元数据查询，必要时 `ensureGrokAccessFresh` 使用原生续期。允许续期，不发送 prompt。 |
| OMP | 纳入 | 纳入 | `readPiOmpAccount`、来源清单与 `nativeLoginProviders.read`；`discoverPiOmp` 使用 Node helper 的元数据/目录阶段，原生 credential lease 可续期并写私有快照。只读取 OMP 自身来源，不创建任务会话。 |
| Pi | 纳入 | 纳入 | 与 OMP 共用调度接口，但由 Pi 自身安装解析器、账号格式和 helper 读取；目录原生初始化和续期纳入后台，不混用 OMP 配置。 |
| Hermes Agent | 纳入 | 纳入 | 账号校验入口、`readHermesAccount / ensureHermesNousFresh`；目录 `discoverHermes`、`hermesAccountModels`，非 Nous 使用 `config get model.default/model.provider --json`，Nous 读取原生认证目录，必要时续期。不修改 hermes-nous-refresh.py 逻辑。 |
| OpenCode | 纳入 | 纳入 | `readOpenCodeAccount` 完整本地状态；`discoverOpenCode` 使用 `snapshotOpenCodeAuth / openCodeEnvironment` 写插件运行配置，再执行 `models --verbose` 并核对账号模型范围，不运行任务会话。 |
| Qoder | 不纳入 | 不纳入 | 原生 SDK 账号/模型组合查询创建 session，保留前台。 |
| Qoder CN | 不纳入 | 不纳入 | 独立入口及来源，同样创建原生 session，保留前台。 |
| CodeBuddy Code | 纳入 | 不纳入 | 账号保持 `readCodebuddyAccount` 本地投影；模型 bridge 即使 no-session-persistence 仍发送 session/new，保留前台。 |
| TRAE CN | 不纳入 | 不纳入 | 账号及目录使用原生协议会话，保留前台。 |
| WorkBuddy CN | 不纳入 | 不纳入 | `readWorkBuddyMetadata/bootstrap` 可能准备原生密钥与配置，保留前台。 |
| WorkBuddy | 不纳入 | 不纳入 | 国际版独立入口、账号根同样 bootstrap 密钥，保留前台，不借用 CN 结果。 |

两个名单分别为 11 个账号、10 个模型目录。后台队列按项目登记且连接项串行；同一 CLI 的账号与目录（含不同项目）共用 `SettingsConnectionCache` 的读取队列和维护锁，单槽未完成请求合并，显式刷新排在旧查询之后。不同 CLI 的前台读取仍可并发。后台任务或账号窗口打断立即 abort，等待进程范围清理后再空闲至少 30 秒重试；Host 关闭中止并等待队列与缓存读取。失败仅更新对应槽 error；进程清理无法确认时沿用该 CLI 的隔离机制，不以普通失败继续启动它。取消与 revision 校验阻止旧结果写入内存及目录缓存。

所有后台路径禁止 prompt、真实模型调用、原生任务会话、终端/窗口/交互和自动升级。保持宿主代理环境，不删除代理变量，不执行 env -u；Pi/OMP 登录服务商 helper 与目录 bridge 均保留大小写代理键，继续过滤无关凭据。允许的是前台已有的服务初始化、原生续期与私有配置写入。决定 7 的“缺失模型目录”按本次用户决定扩展，不再要求“无文件改动/无续期”；版本与发布源后台权限保持原规则。真实账号、原生服务、Desktop 和 Windows/Linux 验收仍未执行；模拟不证明本机账号可用或所有版本均无弹窗。回退可关闭后台开关；没有用户数据迁移。
