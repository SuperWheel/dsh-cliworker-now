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

- npm 用该安装归属的同一 Node/npm、同一 `--prefix`、精确版本（`<包>@<目标版本>`）。所选下载源以 `--registry` 传入。主包 tarball 由插件下载（可续传、可校验）后交给 npm 安装本地文件。
- Homebrew 用 `brew upgrade <包名>`，CLI 自带更新用其已核实的子命令。
- 官方安装脚本只取 `sources.ts` 中的内置地址：先下载到 `cli-management/downloads/`，再以 `['bash', <文件>]` 或 `['powershell', '-NoProfile', '-File', <文件>]` 执行。
- Windows 继续用 `native-launch.mjs` 的启动器转换，不用 `cmd /c`。
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

- **识别错误装出第二份**：严格按真实路径、包名、brew 元数据匹配，识别不出就转手动；更新后核对版本与路径。
- **官方脚本执行远端代码**：只用内置地址，先下载再以文件执行，行内显示地址。脚本内部的行为与落点逐个核实后才开放自动安装。
- **后台探测的副作用**：只开放 `sources.ts` 中标为后台安全的读取。目前只确认 Kimi 需禁用自动升级，其余逐个验证。
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
