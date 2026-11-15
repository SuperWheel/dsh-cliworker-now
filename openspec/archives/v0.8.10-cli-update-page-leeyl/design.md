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

### 决定 16：国际版 WorkBuddy macOS 使用官方同路径 DMG（2026-11-15）

- 依据本变更 `workbuddy-feed-audit-2026-11-15.json` 与下文「2026-11-15 WorkBuddy 国际版摘要复核」：arm64 / x64 feed 的 SHA-256 分别与同名 DMG 实测一致（6502dc77… / 435e3990…），与 ZIP 均不一致；官网 `invite-BP67xNKo.js` 对 darwin URL 同样把 `.zip` 换成 `.dmg`。本次沿用入库证据，不重新联网下载或运行工件。
- 仅 `workbuddy` + darwin 在读取 feed 时进行工件选择：要求 HTTPS、精确主机 `download.codebuddy.ai`、无认证/端口/查询/片段、未编码或规范化的已核实 `/workbuddy/saas/darwin-{arm64,x64}/WorkBuddy-darwin-{同架构}-{feed版本}-{8位hex}.zip` 路径；必须匹配请求架构和版本，只替换末尾扩展名。执行阶段单独验证生成的 DMG 地址，不再接受 ZIP 或任意外部 DMG 地址。保持 feed 的 `sha256hash` 为唯一摘要来源，不内置实算摘要或回退 MD5。
- 首次安装选择既有 DMG 分支；更新器先复用 `installDesktop` 的只读挂载、签名、Gatekeeper、ditto 与卸载流程把新应用准备到私有暂存目录，再沿用原有同卷复制、目标身份复核、替换及回滚。国际版固定 Team ID `FN2V63AD2J` 和签名 identifier `com.workbuddy.workbuddy-ai`，暂存及待替换副本均核对；失败不能以旧应用 Team ID 放宽。版本继续按既有安装/更新后的应用版本核对，不以安装命令退出 0 判成功。卸载未确认保留清理隔离，摘要失败不启动挂载、解包、签名或安装命令。
- CN 继续使用 ZIP 与 CN feed 摘要，ZCode 与 Windows 不变；下载和进程保留宿主默认代理。没有新增账号读取、后台安装、版本号或存储迁移。
- 若未来 feed 修正为 ZIP 摘要，现行 DMG 下载会严格校验失败并停止；不得自动尝试 ZIP、替换摘要或降低校验。应重新核对官网、feed 和工件配对，明确修订此选择规则及对应模拟回归后再切换。撤回本修复则恢复原 ZIP 严格拒绝行为，不迁移用户数据。
- 本次仅做模拟回归、类型与规格检查、隔离构建；真实安装、更新、挂载、签名系统执行、登录和 Desktop 验收保留待验证。

#### 2026-11-15 装后识别修复（15.3 续验）

- 只读核对指定 SHA-256 的 arm64 DMG：`WorkBuddy AI.app`、`Contents/MacOS/Electron`、`cli/dist/codebuddy-lite-wb.mjs`、包名 `@genie/agent-cli` / `2.165.0`、endpoint 主机 `www.workbuddy.ai` 均符合既有 resolver；产品配置目录为 `.workbuddy-ai`，修正国际版 variant 的该提示值。实际运行仍读取产品元数据，CN 定义、endpoint 白名单和 sources 的应用名/入口无需变更。
- 根因实证：官方 mjs 权限为 0644，安装器先调用可执行文件查找（X_OK），因此尚未进入身份读取器就被拒绝；直接调用 `resolveWorkBuddyInstallation` 成功。国际版装后核对直接把包内路径交给现有 identity/resolver，仍验证包名、站点、runtime、entry 与可读权限，不添加执行位、不启动包内程序、不回退 PATH。身份读取抛出的 `WorkBuddyUnavailableError.reason` 作为固定原因码附在 VERSION_MISMATCH 后，不拼接原始异常或产品 JSON。
- 第二处实物差异：Info.plist 的短版本与 build 均为 `5.9.4`，product.genieVersion 也为 `5.9.4`；feed 目标是 `5.9.4.42593613`。仅国际版 macOS 官方 DMG 首次安装、且 feed SHA-256 已校验时，允许三段装后应用版本等于四段目标的前三段。精确工件由 feed 摘要绑定，安装元数据本身不提供四段 build，不能声称独立读出了该 build；若装后提供四段版本则必须完整相等，短版本不符仍失败。保留真实 appVersion，不把 feed 目标写入指纹；CN/ZCode/Windows 版本规则不变。
- 未修改更新器流程；真实首次安装与清理结果、未验更新与 Desktop 的边界以 tasks.md 15.3 后续记录为准。回退仅撤回上述安装核对及提示值，无数据迁移。

### 决定 17：CodeBuddy Code 官方原生来源与稳定入口（2026-11-15）

- 本决定修复文末「CodeBuddy 原生布局问题的结论」所列缺口。匿名读取 [install.sh](https://www.codebuddy.cn/cli/install.sh)、[install.ps1](https://www.codebuddy.cn/cli/install.ps1) 与[安装文档](https://www.codebuddy.cn/docs/cli/installation)，脚本均下载 COS 二进制、以 checksums.txt 的 SHA-256 校验，再委托 `codebuddy install`；脚本文本不单独证明最终布局。
- 为重新核实布局，匿名下载官方 npm `@tencent-ai/codebuddy-code@2.184.0`，校验 registry dist.integrity（SHA-512）相符后只读 `dist/codebuddy.js` 的 InstallEnv、PathUtils、InstallService。Unix（含 macOS）使用 Linux paths：`${XDG_DATA_HOME:-~/.local/share}/codebuddy/versions/<semver>/codebuddy`，稳定入口为数据根上两层的 `bin/codebuddy`（默认 `~/.local/bin/codebuddy`）；Windows 为 `${LOCALAPPDATA:-~/AppData/Local}/codebuddy/Data/versions/<semver>/codebuddy.exe` 和同根 `bin/codebuddy.exe`。安装先尝试 symlink，再 hardlink，最后 copy；没有证据支持 `versions/<v>` 本身就是文件或 `.codebuddy/bin` 布局。
- 官方自更新命令为 `[所选入口, 'update']`，不锁目标版本。2.184.0 源码先解包到新版本目录，再以 `.codebuddy-update-<uuid>` 同目录临时文件替换当前 invoked entry 的 realpath；Windows 先将旧文件改名 `.old`，失败回滚。故稳定入口不变，甚至 realpath 的旧版本目录名也可能不变，不能从目录名推断当前版本。官方自行保留最近五个版本并保护当前执行版本。
- 新增纯路径模块共用于 identity、auto-entry 和 planner：仅 CodeBuddy ID、当前 home/环境定义的完整根、精确二进制名称与一层 SemVer 版本目录可识别为 `self-update`，npm/brew 仍先按各自证据分类；撤去没有证据的 `.codebuddy/bin/` 前缀。WorkBuddy 内置 codebuddy-lite、其他 CLI、备份/临时文件、跨根和相似名称不获得 CodeBuddy 原生更新资格。
- 自动记录旧版本实体时前台优先重找同根稳定入口；首次 PATH 直接返回版本实体时也保存稳定入口，并核对其 realpath 仍属同根。手动路径与部署配置保留原选择；后台遇到旧 auto 版本实体暂不探测，不做 PATH 迁移。更新后 `sameInstallation` 同时核对来源、通道、更新根、真实入口及所选路径（不变的手动别名可保留，变化时须为同根精确入口），接受同根版本迁移及链接/复制形状，随后仍须新鲜版本前进验证；版本探针设置 `DISABLE_AUTOUPDATER=1`，保留继承代理。
- 复用 `sources.ts` 已有 `NATIVE_UPDATES.codebuddy.argv=['update']` 与 planner/executor 生命周期，不新增下载接管、原生安装入口、进度推断或残留删除；`update-residue.ts` 不纳入 CodeBuddy，旧版本与 `.old` 由官方处理。OMP 的精确入口和 Kimi 禁后台自动升级模式作为对照，不扩大它们的规则。
- 只读实测：Mac `/opt/homebrew/bin/codebuddy` → `/opt/homebrew/lib/node_modules/@tencent-ai/codebuddy-code/bin/codebuddy`，版本和包清单均 2.184.0；Windows `~\AppData\Roaming\npm\codebuddy.ps1/.cmd`，CLI 与包清单均 2.184.0，`%LOCALAPPDATA%\codebuddy` 不存在。两机均为 npm，不把这些结果写成原生更新实测。未安装、更新、删除或操作账号；Linux 与三平台原生更新仅模拟验证。
- 回退：撤回此精确路径规则及入口迁移；无持久化格式变更，已保存稳定路径仍是普通 auto 记录。本 change 其他未完成验收保持可见，不因本子任务完成而归档。

### 决定 15：Windows WorkBuddy 从已核实产品元数据补齐应用版本（2026-11-15）

- 实机 CN 安装根 `D:\Software\workbuddy` 的 exe FileVersion=5.9.3、ProductVersion=5.9.3.0，HKLM 卸载项 DisplayName=WorkBuddy 5.9.3、DisplayVersion=5.9.3、InstallLocation 为空、DisplayIcon 指向该 exe。插件自动路径记录指向同目录 `resources\app.asar.unpacked\cli\dist\codebuddy-lite-wb.mjs`，根和站点识别没有失败。
- 根因：`resources/app/package.json` 不存在，应用包位于 `resources/app.asar`；旧 identity 只尝试前者，Windows 又没有 macOS 的 Info.plist 回退，导致 appVersion 缺失。只读独立核对 ASAR 内 package.version=5.9.3，已有 unpacked CLI product.json 的 genieVersion=5.9.3，内置 agent-cli package.version=2.165.0，证明不是版本正则拒绝或安装损坏。
- 复用 `resolveWorkBuddyInstallation` 已有的有界 product.json 读取及包名、endpoint 站点、runtime/entry 核对，返回可选 appVersion（genieVersion）。仅 Windows 且既有 app/package.json 版本无效/缺失时，identity 接受通过 `validAppVersion` 的该字段；不把 CLI 版本代作应用版本，不放宽版本正则。macOS 保留 Info.plist 优先级，ZCode 保留独立 runtime / bundle 映射。
- 不新增进程、注册表轮询、ASAR 解析器或持久化格式；后台与前台均只读安装文件，版本进入现有指纹，更新后重读。无有效字段仍保留不可核实提示，跨站点仍拒绝。回退撤回此可选字段及消费即可，无数据迁移。
- 验收边界：Windows 实机仅只读取证；两版 Windows、macOS 及服务 204 分组由模拟测试覆盖。本轮不更新 Desktop、不启动 WorkBuddy、不测试真实更新或真实派遣；国际版实机元数据尚未核验。

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

登录/退出窗口 reservation 开始与结束、账号变更回调、CLI 开关、执行入口变化及更新后经统一失效机制清除两槽并增加 revision。保留 `accountRevision` 和执行入口 revision 的同步检查。作废同时 abort 进行中查询；后续请求先等旧查询清理，旧结果不得回填。显式刷新也排在正在进行的读取之后，不被该读取吞掉。查询失败清除旧成功值，槽内 `error` 保留该次读取的原因（去掉错误类名、最长 1024 字符，与直读接口报告的一致），空原因才用「连接状态读取失败，请刷新重试」；关闭 Host 中止并等待全部查询，取消订阅移除监听。

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

## 2026-11-14 Windows 接管下载（任务 W）

### 决定 13：Windows 四个自带更新改由插件下载（用户 2026-11-14 批准，含 TRAE）

背景（11.9 实机）：Windows 经 Clash Verge 代理时，长下载在 18–153 MB 处断流后不再有数据；Claude、TRAE、OMP、Antigravity 自带更新器都不续传，插件只能等 10 分钟安装超时，界面显示「下载进度无法读取」。curl 经同一代理复现（36.9 秒 153,384,276 B 后停）。

逐个核实的官方入口（脚本保存在 `.cache/cli-update-research/task-w/`，仅阅读未执行）：

| CLI | 官方来源与校验 | 官方脚本的放置步骤 | 插件做法 |
| --- | --- | --- | --- |
| Claude Code | `https://downloads.claude.ai/claude-code-releases/<v>/manifest.json` 的 `platforms["win32-x64"].checksum`（sha256）与 size；工件 `<v>/win32-x64/claude.exe` | 下载后执行 `claude.exe install <target>`；实测（断网代理 127.0.0.1:9）`install` 会重新联网下载，不能作本地入口；Windows 启动器 `.local/bin/claude.exe` 与 `versions/<v>` 逐字节相同；二进制内无下载源环境变量 | 下载校验后写 `~/.local/share/claude/versions/<v>`（临时文件再改名），再替换 `.local/bin/claude.exe` |
| Antigravity | `https://antigravity-cli-auto-updater-…run.app/manifests/windows_amd64.json` 的 version、url、sha512 | 下载到 staging、校验 sha512、`Copy-Item` 到 `%LOCALAPPDATA%\agy\bin\agy.exe`、`Unblock-File`，再 `agy install`（实测只配置 PATH 与 shell 别名） | 下载校验后写同目录临时文件再替换 `agy.exe`；不执行 `agy install` |
| OMP | `https://build.stencil.so/api/products/omp/versions/<v>/windows-x86_64` 的 build.version、file.name、file.sha256、download | `Install-Binary`：写 `$InstallDir\.omp.download.exe`、校验 sha256、`Move-Item -Force` 到 `omp.exe`，再配置 PATH 与 Git Bash | 同上放置，不做 PATH/Bash 配置。PI_BUILD_URL 指向 file:// 在 Windows PowerShell 5.1 不可用（实测 Invoke-RestMethod 返回字符串，不解析 JSON） |
| TRAE CN | `https://lf-cdn.trae.com.cn/obj/trae-com-cn/trae-cli/v2/releases/<v>/manifest.json`（或 public/stable/latest.json）：主工件、sidecars、windows_sandbox_helpers 的 url/sha256/size；ripgrep `v2/deps/ripgrep/latest.json` | 官方 `install_v2.ps1 offline-install <目录>` 读取 `offline-manifest.json`（相对路径工件），但离线模式把 `$AutoUpdateEnabled` 置 false 并删除 `auto-update-version` 标记 | 按官方 `Export-OfflineBundle` 结构组离线包交 offline-install；更新前标记存在则装后写回新 release 目录名（实测标记内容为 `0.213.1-x86_64-pc-windows-msvc`，即 release 目录名），否则不写 |

- 下载全部走插件下载器：10 秒停滞续传、低速重连、200 次与 2 小时上限、真实进度。多源只在有官方同对象第二地址时启用（Claude 另有 GCS 桶 `storage.googleapis.com/claude-code-dist-…`，需 HEAD 核对长度一致后才轮换）。
- 校验：Claude/OMP/TRAE 用官方 sha256，Antigravity 用官方 sha512；均为同源发布清单，不等于独立签名，输出中注明。
- 替换失败（exe 被其他进程占用）：保留原文件、删除临时文件、报告「文件被占用」，不半途改动。
- 撤销：本决定替代任务 D 续 9.1「TRAE 不使用 offline-install」以及 spec 中对应场景；macOS/Linux TRAE 与其他 CLI 维持原归属，本轮只改 Windows 四项（TRAE Unix 待另核其标记逻辑）。

实施补充（任务 W，2026-11-14）：

- `windows-artifacts.ts` 接管 Windows self-update 默认入口，支持 x64/arm64；下载准备与安装回调分离，服务重新核对计划后才写安装目录，安装预算单独 10 分钟。所有工件进度沿原 `prepareLocalUpdate → op.progress` 回调发送。Unix 的更新入口不变，OMP 共用构建清单校验函数。
- Claude 的 GCS 备用源已加入内置源表：匿名 HEAD 实测 2.1.325 win32-x64 两源均为 200、Accept-Ranges bytes、372461728 B、ETag `"63c63d3679b0aebc2ba5886abd0f464d"`。运行时仍逐次校验 HEAD 身份，使用目标源 If-Range；自定义地址模式禁用自动换源。只请求 HEAD，没有下载该二进制。
- 三项直接放置使用唯一临时文件和同目录 rename，不先删除旧 exe。Claude 启动器失败则删除本次新版本文件；若同名版本文件原先存在，先保留并在失败时恢复。Antigravity 不执行 `agy install`；Host 写出的文件没有 Zone.Identifier，无需 Unblock-File。
- TRAE 官方 `Export-OfflineBundle` 要求恰一项 code_mode_host；windows_sandbox_helpers 字段存在时必须包含两项已知辅助件。匿名 GET 的 0.215.0 当前清单无 helpers 字段，按脚本允许缺省，模拟覆盖缺省及完整两项。ripgrep 清单仅保留目标平台；全部 URL 改为相对路径，先校验所有记录／重名／总预算再下载。私有 JSON、工件、脚本合计与每次下载剩余预算受 2 GB 限制。
- TRAE 脚本来自内置 lf-cdn 地址，argv 为 PowerShell `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File <script> offline-install <bundle>`。固定版本、原通道、release_channel、默认 StateDir/InstallDir；设 `TRAECLI_INSTALL_ASSUME_YES=1` 和 `TRAECLI_INSTALL_SKIP_USER_PATH=1`，不设置 `TRAECLI_INSTALL_AUTO_UPDATE`，不删除代理环境。原有非 public 通道的发布源计划限制仍保留。
- StateDir 默认是 `%LOCALAPPDATA%/TraeCLI`，标记为其中的 auto-update-version。脚本成功后仅对原先存在的标记写回新 release；脚本第 1989–1995 行允许已有不可变 release 加 UUID 后缀，因此读取 `current` 的实际目标，要求其位于同一 releases 根且名为 `<版本>-<packageTarget>` 或其 32 位十六进制后缀形式。失败／取消不由插件改写标记。
- 匿名 GET 核对了 Claude 2.1.325 两平台、Antigravity 1.5.9 windows_amd64、OMP 18.20.0 windows-x86_64、TRAE 0.215.0 与 ripgrep 15.1.0 清单字段；没有下载大型工件或执行真实安装器。

### 决定 14：维护期账号读取不记为错误；维护结束统一作废连接显示

11.9 取消 OMP 后侧栏红点根因：更新持有维护锁时，账号状态读取被 `MaintenanceError` 拒绝，`SettingsConnectionCache.read` 把它存为 `entry.error`；更新只在成功路径调用 `invalidateModels`，失败/取消后不作废，红点保留到用户点开该 CLI。修复：缓存遇到 `MAINTENANCE` 不写 error（保持无值、不转红）；`launch` 的 finally 在释放维护锁后（非隔离情形）对该 CLI 调用一次 `invalidateModels`。


实施：SettingsConnectionCache 对 code=MAINTENANCE 清空旧 error/value/checkedAt，仍向直接调用方抛出维护拒绝；成功、失败和取消统一在 launch finally 释放租约后调用一次 invalidateModels，移除成功分支的重复调用。cleanup-unconfirmed 隔离分支不释放租约、不发布可用状态。模拟测试覆盖旧错误被清除、两种缓存槽、释放时序及取消/失败/成功各一次作废。

## 2026-11-15 WorkBuddy 国际版摘要复核（只读）

本轮从指定基线 `e096dd4` 核对 `desktop-update.ts`、`install.ts`、`service.ts` 与 `download.ts`：WorkBuddy/CN 读取单对象 JSON 的 `sha256hash`，要求 64 位 hex；首次安装和更新都将 hex 转成 SHA-256 SRI base64，再按下载字节计算并比较。ZCode 才使用 YAML `files[].sha512` base64。这里没有算法或编码混用。

**已定位国际版 feed 的 URL/摘要配对不一致：arm64 与 x64 的 `url` 都是 ZIP，各自 `sha256hash` 却精确等于同版本、同架构 DMG 的 SHA-256。** 官网首页引用的 `invite-BP67xNKo.js` 的下载函数明确对 darwin 地址执行 `.replace(".zip", ".dmg")`；本轮只读脚本文本，不执行。按这一公开映射下载 DMG 复算后确认对应关系。CN arm64 ZIP 则直接匹配 CN feed，同一家族也不能统一把 ZIP 改为 DMG。完整 URL、6 个 feed 响应、下载摘要与响应头见 [复核证据](workbuddy-feed-audit-2026-11-15.json)，关键数值同时写在 [WorkBuddy 任务 7.3](../add-workbuddy-cli/tasks.md)。

- SHA-256 字段不是 SHA-512 或 base64；实算 SHA-512（hex/base64）另列证据，没有匹配。两架构分别请求，各自 URL 路径包含对应架构，没有从列表挑错文件；universal 返回空摘要，不可作为后备。响应无 `files`、DMG 或 blockmap 摘要条目，`hash`/`name` 为空，`supportsFastUpdate=false`。
- 所有成功对象均为 HTTP 200、0 次跳转；实际字节数等于 Content-Length，MD5 等于 `x-cos-meta-md5`。国际版 arm64 ZIP 与 11-14 记录的长度、ETag 和 SHA-256 一致。没有 Content-Encoding/Location；原始地址经 `new URL(url).href` 不变。证据支持“发布元数据配对问题”，不支持“插件解码或截断”，也不能仅凭头部证明 CDN 源站从未错配；未做绕过代理、缓存清除或源站直连。
- 本轮保持严格校验与产品代码不变：拒绝 ZIP 的错误摘要，不用本次实算值替换 feed，不改用 MD5，不把扩展名替换冒充 URL 规范化。官网的 DMG 下载映射可作为今后独立 DMG 安装/更新路径的依据，但当前 `readDesktopRelease` 与 `runDesktopUpdate` 明确约定 ZIP（解包、签名、替换和清理）；不能仅改 URL 后把 DMG 交给 ZIP 解包。是否扩展独立 DMG 流程另行实施，本轮不安装、不挂载、不解包、不打开应用。

CodeBuddy 对照：当前插件支持的是 **CodeBuddy Code CLI**，并非 CodeBuddy IDE 桌面更新 feed。`sources.ts` 指向 `@tencent-ai/codebuddy-code`，`versions.ts` 读取 npm `dist.integrity`（本轮 2.184.0 是 `sha512-…`，完整值见证据）；官方 `/cli/install.sh` 与 `/cli/install.ps1` 则按 COS `checksums.txt` 的文件名取 SHA-256 hex。这两种格式均与 WorkBuddy 的 JSON `sha256hash` 分开处理，不能因同品牌把 npm SHA-512 规则套给 WorkBuddy。

### CodeBuddy 原生布局问题的结论

找到了相关记录，但仓库中日期为 [双通道设计“调研 7.3”的 2026-11-15](../v0.8.10-cli-update-dual-channel-leeyl/design.md)，不是 11-14。官方[安装指南](https://www.codebuddy.cn/docs/cli/installation) 本轮仍指定 Unix `~/.local/bin` 与 Windows `%USERPROFILE%\AppData\Local\codebuddy\bin`；本轮读到的安装脚本把最终放置委托给 `codebuddy install`，因此脚本文本本身不证明版本实体的最终形状，`versions/<v>` 细节沿用上述既有只读研究，未重新安装验证。

**安装方式分类确有缺口。** `identity.ts` 只含 `.codebuddy/bin/`，既没有 Unix 官方稳定入口/版本实体，也没有 Windows 官方目录。对当前源码中 `classifyInstallation` 与 `automaticMethod` 的原样摘录执行隔离模拟：官方 Unix 稳定入口、两种研究中的版本实体形状、Windows 官方入口均得到 `unknown` / 无自动更新方法；npm 对照仍为 `npm`。这影响原生安装的“更新方式识别”，不是账号身份或登录站点布局；npm/brew 的独立分支不受这一缺失规则影响。

此前只读审计按用户允许的“修或给结论”交付明确缺陷结论，当时**未修复 CodeBuddy 原生更新支持**；现由上方决定 17 实施修复，以下保留当时的证据边界。后续修正应一起验证真实路径归属、稳定更新根、自动路径随版本迁移（`cli-auto-entry.ts` 当前也没有 CodeBuddy 原生规则）与更新后 `sameInstallation`，并补模拟回归及平台证据；不能仅泛化目录前缀就宣布支持。未检查本机 CodeBuddy 账号或执行其 CLI。


### 决定 18：Windows ZCode 运行时关联桌面应用

- 原因：2026-11-15 主会话 Windows 实机确认 Worker 使用插件部署的完整 runtime 0.16.9，原 managedZCodeApplication 仅支持 macOS，导致已有桌面应用仍归入 plugin-runtime。此次只补自动固定 runtime 的桌面关联，manual 与显式 executable 不关联。
- 候选仅为 `%ProgramFiles%\ZCode`（实机所有用户安装 `C:\Program Files\ZCode`，桌面版本 3.14.5）与 `%LOCALAPPDATA%\Programs\ZCode`（electron-builder 当前用户默认位置），依次检查；Windows 路径比较忽略大小写。后台不读注册表、不启动任何进程。候选根须为实际目录，拒绝链接/junction；ZCode.exe 须为普通文件，PE StringFileInfo.ProductName 必须精确为 ZCode，并要求 resources/glm/zcode.cjs 为文件。
- 新增纯 Node 有界 PE 读取：按位置读 DOS、PE/可选头、节表、.rsrc 资源目录 RT_VERSION=16 和 VS_VERSIONINFO；总读取上限 256 KiB、版本资源上限 65535 B、节数上限 96、单目录条目上限 256、版本块上限 512。畸形、截断、越界或缺失资源返回 undefined，关闭文件句柄，不整读 222 MB EXE。结构依据 [Microsoft PE 格式](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format) 与 [VS_VERSIONINFO](https://learn.microsoft.com/en-us/windows/win32/menurc/vs-versioninfo)。同时提取字符串 ProductName/ProductVersion 与 VS_FIXEDFILEINFO ProductVersion，应用比较只取固定 ProductVersion 前三段：3.14.5.7961 → 3.14.5。
- 关联后 source=desktop-app、appPath=应用根、fingerprint.appVersion=应用版本，沿用 ZCODE_RUNTIME_NOTICE。runtime 文件继续作为 executable 与文件指纹；EXE 替换的 size/mtime 不影响同一安装判断，应用版本变化使计划 token 作废，更新后 verify 重新读 PE 并核对 3.18.2。同一安装仍要求应用根相同，Windows 盘符路径大小写不敏感。macOS 保持原 Info.plist/bundle 关联与版本读取。
- 沿用 Windows readDesktopRelease/checkedRelease/runDesktopUpdate：官方 cdn-zcode.z.ai、/zcode/electron/releases/ 前缀与 .exe 已放行，下载验证 SHA-512/大小后创建执行副本，进入 awaiting-user 并等待整个进程范围退出；只传安装程序路径，不新增参数。所有用户安装由官方程序请求 UAC，插件不提权、不静默、不猜安装位置参数，保留宿主代理。未找到可核实桌面应用时保留原 plugin-runtime 提示。
- 验证边界：本轮仅模拟 PE、目录、HTTP 与安装进程；Windows 实机更新及 UAC/向导操作待主会话验收。独立 Worker runtime 不随桌面更新。

### 决定 19：Windows 国际版 WorkBuddy 首次安装与无摘要 feed

2026-11-15 匿名 GET 两版官方 `win32-x64-user` feed 与 EXE，保留宿主代理环境。下载置于 TMPDIR 新建 0700 私有目录，只读计算和解压 NSIS 头，不执行、不安装、不挂载；证据见 `evidence/workbuddy-intl-windows-audit-2026-11-15.json`。

- 国际版 5.9.4.42593613：**507,036,736 B**；feed sha256hash 空；实算 SHA-256 `6ff4be433d664ad14c88210b5b82ebb3674d7047aab8ae52459006c587be2ee0`，仅作本次审计记录，不替代后续版本的 feed。整文件 MD5 `6700207e26ac033442e12c186754e218`、CRC-64/XZ 十进制 `10177316869881057802` 均匹配 COS 响应头；分片 ETag 不作为 MD5。
- 国内版 5.9.3.42398134：**450,174,440 B**；SHA-256 `b5edb52bd6c5b6c7296cf2fff697b019c86d11992a8a814c3010d611896852f9` 匹配 feed，MD5 `1faa9f762c7aafc0a378b09659046dcf`、CRC64 `1038290105151614475` 匹配 COS 头。同源参照证明本次对象的头值对应完整文件，不代表独立签名或未来对象必然可信。CRC 使用系统 liblzma 的 XZ 参数，已核对 `123456789 → 995dc9bbdf1939fa`。
- 两包 PE 安全目录 PKCS#7 均含签名证书主体 `Tencent Technology (Shenzhen) Company Limited`（CN 与 O，C=CN、ST=Guangdong Province、L=Shenzhen、serialNumber=9144030071526726XG）。Mac 未装 osslsigncode，使用只读安全目录提取与 openssl 证书解析；**未完成 Authenticode 信任链/吊销验证**，运行时必须在 Windows 验证。
- NSIS 头 raw DEFLATE 解出国际版 681,996 B、国内版 677,846 B。国际版安装/卸载键 GUID **C02C88CB-5DAE-4330-AEC1-572CFD048A59**，国内版 **BFD312E9-1019-4F57-9F44-F86246833B50**。国际版头没有国内版 GUID，其四个旧 Inno 卸载键也与国内版不同；程序/卸载器为 `WorkBuddyAI.exe` / `Uninstall WorkBuddyAI.exe`。CurrentUser 分支先读国际版自己的 InstallLocation，否则采用 UserProgramFiles（回退 LOCALAPPDATA/Programs）再拼 **WorkBuddyAI**；存在用户自选和 all-users 分支，不能把 `-user` 文件名当作强制 per-user。默认候选 `%LOCALAPPDATA%\Programs\WorkBuddyAI`，不猜测带空格的目录名。
- 冲突结论：静态安装指令与键标识未发现会自动卸载或覆盖现有 `D:\Software\workbuddy` 国内版；没有实机安装，完整共存行为仍未核实。用户不可把国际版向导目标选为国内版目录。安装器实际默认位置/系统重定向/自选目录与磁盘空间仍须主会话实机验收。现有 C 盘约 5.6 GB、D 盘约 313 GB 是用户提供的只读信息，本轮未重新读取 Windows。

实施仅开放 `workbuddy + win32 + x64` 首次安装。CN 与 ZCode 保留 manual（未完成各自首次安装签名及位置/共存验收），ARM64 未有实物证据。共享首次安装与更新的发布检查：只对国际版 Windows 的**明确空字符串** SHA-256 采用 COS 路径；缺失、非法摘要不得降级，有 SHA-256 时仍按 SHA-256 校验，不允许失败后回退。严格 URL 为 HTTPS download.codebuddy.ai、无凭据/端口/查询/片段/编码歧义，版本/架构与 feed 一致，路径匹配 `/workbuddy/saas/win32-(x64|arm64)-user/WorkBuddy-win32-\1-user-<version>-[a-f0-9]{8}.exe`。

替代路径下载前同 URL HEAD（redirect:error），四项缺一不可：完整长度等于 COS content-length 且等于 feed size（若有）；完整 MD5 等于 x-cos-meta-md5；CRC-64/XZ 等于 x-cos-hash-crc64ecma；运行前固定 argv PowerShell Get-AuthenticodeSignature -LiteralPath 返回 Valid 且 CN/O 精确等于固定腾讯发布者。摘要不符不得靠签名放行。失败删除执行副本；进程范围退出未确认沿用原隔离清理规则。安装只传 exe 路径、不加静默或位置参数、不主动提权；保持 awaiting-user，进程范围退出后以实际站点/入口/版本核对并写路径记录。


补充实物证据：按 NSIS File 指令只读取出内嵌 app-64.7z，再用系统 bsdtar 仅把 `resources/app.asar.unpacked/cli/product.json` 输出到内存；没有落地安装树、没有执行 DLL/脚本。genieVersion=`5.9.4`、productName=`WorkBuddy AI`、dataFolderName=`.workbuddy-ai`、endpoint=`https://www.workbuddy.ai`。因此 Windows 国际版装后允许经上述完整工件和签名核验绑定的三段应用版本匹配四段 feed 前三段，仍拒绝错误三段或错误四段 build，指纹保留真实版本。两包 SignerInfo 的 issuer+serial 与证书精确匹配：国际版序列号 `0634E23D7F72BEB913CA2B29C29770E6`、国内版 `0EC3880864ADEB96CAFC6AABAFDA1F94`，均为上述腾讯主体；不把证书解析当作 Windows Valid。新 TypeScript CRC 实现对两份完整 EXE 再算，结果均同时匹配系统 liblzma 与 COS 头。

### 决定 20：Windows 官方安装程序可见、不限时，向导落点与结果刷新（2026-11-15 实机后）

- 窗口：Windows 隐藏中继原对所有子进程设 `windowsHide: true`，实机 ZCode 更新时向导与 UAC 前的窗口不可见。改为 Host 内部 Symbol 标记 `VISIBLE_WINDOW`，只由 `plan.method === 'desktop'` 且平台为 win32 的更新/首次安装设置，经 `nativeProcessBackend.spawn` 剥离后写入中继启动 JSON 的 `visibleWindow`，中继启动目标时 `windowsHide: false`。Worker、CLI 命令、npm 与脚本安装仍隐藏；标记不进入 SDK 规格、不经用户输入或 Client 传入。
- 时限：用户 2026-11-15 要求「这个安装上限计时应该从弹出安装窗口开始就要停止」。官方安装程序启动即进入 awaiting-user，等待 UAC 与向导，插件无法判断用户何时操作完，因此 Windows 桌面安装程序不设时限（`DESKTOP_INSTALLER_TIMEOUT_MS = Infinity`，不挂计时器，避免 setTimeout 把 Infinity 当 1 ms）。用户仍可在页面取消；取消仍须确认整个进程范围退出。控制台安装命令保留 10 分钟。
- 向导落点：实机国际版 WorkBuddy 5.9.4 向导默认 `C:\Program Files\WorkBuddyAI`（all-users）；用户选 `D:\Software\WorkBuddy guoji` 时向导追加子目录，实际为 `…\WorkBuddy guoji\WorkBuddyAI`。插件不向安装程序传目录，因此装后候选依次为所选目录、所选目录名不是 WorkBuddyAI 时的「所选目录\WorkBuddyAI」、`%ProgramFiles%\WorkBuddyAI`、`%LOCALAPPDATA%\Programs\WorkBuddyAI`，仍逐一用 resolveWorkBuddyInstallation 核对国际站点与版本，国内版目录不会被当作国际版。
- 结果刷新：页面上次操作结果（如 VERSION_MISMATCH）原先一直保留到下次同一 CLI 操作。改为用户点「检查更新」触发的 `check('all')` 清空全部结果，打开页面时的 `check('missing')` 保留，避免刚完成的「已更新到 X」在打开页面时消失。
- 完成判定与结束页「运行」（用户 2026-11-15：不管是否勾选运行都要正确识别已装完）：Harness 的 Windows 子进程都在 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` Job 中且不允许脱离（从 Harness 包内实现核实）。安装程序自身退出即判定安装结束；输出管道只再等 3 秒，防止结束页启动的应用继承管道导致无限等待。之后进程范围 3 秒内仍未清空，说明有进程留在 Job 内：先按主程序名（ZCode.exe / WorkBuddy.exe / WorkBuddyAI.exe）用 CIM 快照，结束范围后再快照，消失的那些就是被一起结束的应用；核对安装成功后，经 `explorer.exe <主程序>` 交给当前外壳重新打开（不在 Job 内，也不继承提权），只接受已核实安装目录内、文件名相符的主程序，打不开时提示手动打开。快照进程自身清理未确认仍按清理未确认处理。实机 electron-builder 安装程序的「运行」由外壳启动（父进程 explorer.exe），不在插件 Job 内，因此该补救路径只有模拟覆盖。
- 签名核验时限：首次安装的 `Get-AuthenticodeSignature` 原用只读探针默认 5 秒；2026-11-15 实机下载完成后在机器繁忙时超时，被归为未分类错误，页面只显示「更新失败，请检查网络、安装前缀与输出后重试」。改为 120 秒并显示「正在核对安装包的官方签名」，超时报 VERIFY_TIMEOUT「核对安装包官方签名超时，未运行安装程序」。更新流程的核验器本就 30 秒，未改。
- 装后分组：a00724f 起非 npm 安装成功后固定归入「需要手动更新」且无说明，2026-11-15 实机国际版 WorkBuddy 刚装好的最新版因此显示在该组。改为按 updateProblem / automaticMethod 判定：插件能自动更新的归「已是最新」（刚装的是官方当前版本），否则仍归「需要手动更新」并写明原因。官方安装程序在 `%LOCALAPPDATA%\<产品>-updater\installer.exe` 自留安装包副本（ZCode 227 MB、WorkBuddy 484 MB），供其自带更新器做差分更新，不在插件下载目录内，插件不删除。
