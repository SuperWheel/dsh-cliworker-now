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
- 实施时先核实 Gateway 能否区分来源（PRD 第九节第 15 条）。核实前写操作只注册在设置页使用的 Remote 上，不进入工具清单；同时在 tasks 里保留「来源核实」项。

### 决定 3：维护锁与现有忙闲共用一个同步准入

在 `maintenance.ts` 维护 `Map<CliId, Lease>`：

- `tryBeginMaintenance(cli)` 同步检查 `runtime` 的忙闲（运行、准备、停止中、排队、待接收、未暂停续聊）和账号窗口的使用租约，通过就立即写入维护租约。
- 派遣、续聊执行、账号操作、模型目录查询、路径修改的入口调用 `assertNotInMaintenance(cli)`；它与 `runtime.assertCliEnabled` 并列，不写入启用设置。
- 清理无法确认时，租约转为隔离状态，沿用现有 cleanup marker 跨重启保留。

### 决定 4：执行只走参数数组与受控方法

- npm 的运行时安装与 CLI 全局包前缀分开解析：解析 npm 启动器对应的 `npm-cli.js`，核对 npm 包清单与 bin 声明，读取 Node 原生程序文件并核对格式，不运行版本探测。优先使用 npm 启动器旁的 Node，否则解析 PATH 中的 Node；全局包前缀只作为 `--prefix` 目标，不要求前缀下存在 npm。
- Host 从所选源的目标精确版本元数据取得主包 tarball 地址，使用 npm 官方源同版本的 sha512 校验真实下载内容；官方源也走完全相同的下载、续传和摘要校验路径。官方摘要不可得或摘要不符时拒绝安装，不降级为信任镜像摘要。校验后的私有文件改为 `.tgz`，以 `[node, npm-cli.js, 'install', '--global', '--prefix', 原前缀, 本地tgz, '--registry', 所选源]` 安装。显示的可读字节进度只对应 Host 下载的主包。
- Homebrew 用 `brew upgrade <包名>`，CLI 自带更新用其已核实的子命令。
- Qoder/CN 官方分发入口仅认 `<home>/.qoder/entry/qoder`、`<home>/.qoder-cn/entry/qodercn`，不放行 entry 目录下其他名字。更新保留记录入口的 `[入口, 'update']` 与 homedir cwd，不猜测 PATH 分发得到的实体。执行器紧邻 spawn 前用 lstat 检查 `<home>/update`；存在任何文件、目录、符号链接或检查失败时拒绝启动，避免分发到 IDE；记录入口是指向分发器的符号链接也同样检查。不删除/改名用户路径。该预检不能原子阻止外部进程恰在检查与分发之间创建路径。
- Grok 的记录入口精确为 `<home>/.grok/bin/grok` 且 realpath 在 `<home>/.grok/downloads/` 下时识别为 self-update；缺少已核实发布源，仍为手动更新，沿用 Client 品牌名显示「Grok Build 自带更新」。
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
  - 子进程启动后用 `os.setPriority(pid, 10)` 降优先级（Windows 为 `BELOW_NORMAL`），失败则忽略；
  - 每项有自己的 AbortController。
- 运行时的协调：
  - 有派遣、账号窗口、更新时，`runtime` 发出忙信号，预加载 abort 当前项并等待子进程退出，然后回到等待空闲；
  - 页面调用 `checkCliUpdates` 时，把剩余项切到前台模式（并发与超时同前台），共用同一份结果。
- 账号状态读取只调用 `accounts.status` 中标记为「只读、无副作用」的分支。会刷新令牌的分支（如 Grok、Hermes 续期）在后台跳过。
- 与项目有关的账号状态用最近一次打开设置时的项目目录。

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

- **首次安装来源边界（阶段 C）**：`installationSource` 以 PRD 5.3 的平台差异选择方法。Codex、Pi、CodeBuddy 用 npm；MiMo/OpenCode 的 Windows 用 npm；Pi 添加 `--ignore-scripts` 且只取白名单，OpenCode 只取 V1。npm 通过已核实的 Node/npm 读取 Node 版本及 `npm prefix -g`，校验目标包 engines 和最低版本，前缀不可写不提权。安装与更新共用 Host 计划入口、全局操作生命周期、维护锁、下载器和执行器。
- **脚本版本与摘要**：Kimi、TRAE CN（Mac/Linux）、Qoder/CN（Windows）只用 sources 内置脚本 URL 与解释器。脚本以文件执行，不传远端命令文本；没有官方独立摘要时仅依赖无重定向的 HTTPS 传输及 HTTP 长度，不称为已验证发布签名。目标选择器为 `official-current`，不编造精确版本或未证实的锁版本参数；执行后仍须读取有效且适配的版本，否则失败并保留旧路径设置。原生二进制没有已核实版本读法时不会据退出码宣告成功。阶段 C 审查确认 Claude 全平台及 MiMo Mac/Linux 没有足够证据实现原生版本读取，改回 manual；不根据目录名称猜版本、不新增未证实无副作用的 --version。MiMo Windows npm 不受影响。Antigravity/Grok 的前置条件或版本读法、OMP/Hermes 的禁止代装运行时参数、Qoder/CN 的 macOS 入口及 OpenCode macOS 锁 V1 参数仍待核实，保持仅说明。
- **桌面安装不先开放**：ZCode、WorkBuddy CN、WorkBuddy 没有已核实的安装包 URL、摘要/长度及开发者身份，因此生产来源表仍为 manual。通用执行器仅以模拟描述符验证：macOS 只读挂载、codesign Team ID 要求与 spctl、暂存复制后移动、失败清理暂存和 detach；detach 未确认进入清理隔离，不删除仍可能挂载的目录。Windows 仅启动官方安装程序并等进程范围退出，不传猜测的静默/位置参数；未实现真实 Authenticode 验收。页面位置是建议值，未来已核实来源可提供常见目录用于装后查找。
- **位置与旧路径**：纯 CLI 不接受客户端自选位置。桌面位置可不存在，但父目录须可写且空间充足，拒绝与已知项目/工作区、插件状态、账号数据及另一版 WorkBuddy 安装目录重叠。路径变更前核对路径存储 revision，只有装后身份与版本验证成功才调用现有 `CliExecutablePathStore.setManual`；失败不重置旧记录，也不删除旧安装文件。

- **npm 依赖解析边界**：官方 sha512 绑定的是目标版本主包 tarball；其依赖及生命周期脚本仍由 npm 按所选 registry 和 npm 原生规则处理。本实现不声称已独立验算所有传递依赖，也不伪造其下载字节进度。
- **阶段 C 审查修订**：Qoder/CN Windows 安装入口复用现有发现工具的官方 exe 候选；Git Bash 通过完整 PATH/git 位置与 PE/MSYS 布局作文件核实，不启动 bash/git，不依赖父目录名。Pi 损坏旧安装可生成带 unusableBefore 的重新安装计划，装后核对仍严格。桌面卸载/进程隔离错误优先保留，目录删除失败只追加原因。安装位置保护与账号读取共用 Codex/Claude 根解析，并复用 MiMo/Qoder/CodeBuddy/Hermes/ZCode/OpenCode 目录工具，包含当前生效的环境变量。
- **识别错误装出第二份**：严格按真实路径、包名、brew 元数据匹配，识别不出就转手动；更新后核对版本与路径。
- **官方脚本执行远端代码**：只用内置地址，先下载再以文件执行，行内显示地址。脚本内部的行为与落点逐个核实后才开放自动安装。
- **后台探测的副作用**：以用户提供的 2026-11-13 macOS 实机结果更新 sources 数据：Antigravity、Claude、Kimi、MiMo、Grok、OMP、Pi、OpenCode、CodeBuddy、TRAE 可后台读取版本；Kimi 禁自动升级。Codex、Qoder/CN 版本命令只在前台执行；Hermes 前后台都不执行。桌面应用继续只读文件。该规则只影响版本查询，不扩大账号预加载白名单。
- **2.8 发布源与前台版本修复**：npm 最新版本先读 `/-/package/<编码包名>/dist-tags`，保持 512 KiB / 8 秒；仅兼容受限且 latest 不兼容时拉 packument，单请求上限 32 MiB（用户实测最大 OpenCode 为 14.7 MB，预留有界增长空间），流式计数。缓存结构不变，版本列表只存 latest 和最高兼容正式/预发布候选，旧缓存仍有效；integrity/artifact 精确版本接口和镜像回退不变。清单缺版本时前台以实际入口运行 `--version`，5 秒、stdin ignore、去 ANSI、首个完整合法 SemVer，退出进程树后才返回。版本/无版本结果按指纹复用，后台跳过不阻止首次前台读取。Codex standalone 仅按完整路径前缀归官方安装器，仍无自动更新；Claude cask 可经版本查询生成 brew upgrade --cask claude-code。此轮不重新开放阶段 C 暂停的首次安装脚本。
- **缓存落后于真实情况**：版本靠文件指纹发现变化；账号状态最多落后 10 分钟。
- **Windows**：npm.cmd、进程树终止、文件占用、提权窗口不可见、空闲判定和低优先级需单独验收；不走需要管理员权限的位置。
- **Gateway 无法区分调用来源**：在核实前，写操作只在设置页的 Remote 使用，不提供给 Agent 工具。
- **工作量大**：按阶段交付。第一阶段为只读检查、缓存、预加载与页面；第二阶段为 npm、brew、自带命令更新与停滞续传；第三阶段为首次安装（脚本与桌面）。未完成的阶段在 tasks 里保持未勾选。

## Migration Plan

- 新增状态文件，不迁移旧数据。
- 回退：停用「启动后在后台检查 CLI」开关即可关闭预加载。整体回退时删除 `stateDirectory/cli-management/`，不影响路径记录、账号与会话。

## Open Questions

- Gateway 能否提供可靠的调用来源（第九节第 15 条）。
- 各 CLI 的 `--version` 是否有副作用、自带更新命令是否只读可检查（Grok `update --check`、TRAE `update check`）。
- 三个桌面安装器的静默与目录参数。
