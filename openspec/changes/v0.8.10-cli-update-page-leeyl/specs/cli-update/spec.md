## ADDED Requirements

### Requirement: macOS 系统代理注入
Host SHALL 在 macOS 用参数数组运行 `/usr/sbin/scutil --proxy`，复用 Windows 的 5 秒超时、64 KiB 输出上限、15 秒按需缓存、并发合并及进程清理。读取失败或关闭代理后 SHALL 清除旧代理。Host SHALL 优先使用有效且启用的 HTTPS 代理，其次 HTTP，只接受单个主机名、IPv4 或带括号 IPv6 与 1–65535 端口，统一作为 HTTP 代理。已有代理环境变量或显式删除 SHALL 优先，不得覆盖。账号终端、Worker、更新/安装命令和探测 SHALL 通过同一进程后端获得代理；Host 的 HTTPS 请求与 Pi/OMP 子进程 SHALL 按相同来源与例外规则查找代理，保留代理请求的 User-Agent。Linux MUST NOT 新增系统代理注入。

#### Scenario: macOS 图形启动未继承环境变量
- **WHEN** Host 没有代理环境变量，而系统启用了有效的显式 HTTP(S) 代理
- **THEN** 新启动的 CLI SHALL 获得 HTTP_PROXY、HTTPS_PROXY 与 NO_PROXY；NO_PROXY SHALL 合并既有值、localhost、127.0.0.1、::1 以及 ExceptionsList 中可表达的主机、域名后缀与精确 IP
- **AND** `*.example.com` 和 `*.local` SHALL 转为 `.example.com` 和 `.local`；CIDR、短网段、任意位置通配、主机端口等非通用形式 SHALL 丢弃

#### Scenario: 只有 PAC 或 SOCKS
- **WHEN** 没有有效显式 HTTP(S) 代理，而 PAC、自动发现或 SOCKS 已启用
- **THEN** Host MUST NOT 执行 PAC、推测代理或注入 SOCKS 变量，来源生命周期内 SHALL 仅记录一次不含原始输出的诊断

#### Scenario: 继承变量或显式删除决定代理
- **WHEN** Host 环境或进程 spec 中任意大小写的 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY 已有非空值，或 spec 明确设为 undefined
- **THEN** 系统代理 MUST NOT 覆盖该进程的环境

#### Scenario: 系统变更或插件停用
- **WHEN** 系统代理关闭、读取失败或插件停用
- **THEN** 关闭/失败 SHALL 在下次过期刷新后不再保留旧值，停用 SHALL 中止读取、等待进程范围退出并撤销 Host 代理查找；同步 spawn 不等待刷新，账号终端与 Host 查询等待 fresh

### Requirement: 全部 CLI 的官方自动更新范围
Host SHALL 为已识别的官方安装开放 PRD 5.3.1 的自带命令、官方安装器或桌面替换流程；npm/Homebrew 归属 SHALL 优先使用原包管理器。Codex 独立版 SHALL 下载内置官方脚本，以 `CODEX_NON_INTERACTIVE=1` 和 `--release <目标>` 执行。Hermes SHALL 在执行前提供迁移配置、更新依赖、可能重启服务及保留原通道的说明；所有更新 MUST 由前台用户发起。

#### Scenario: Codex 独立安装更新
- **WHEN** 已识别的 Codex standalone 安装有新版本
- **THEN** Host 先下载官方脚本到私有目录，再以文件参数执行锁定版本；MUST NOT 使用未经核实的 codex update 参数

#### Scenario: Hermes canary 安装
- **WHEN** install-stamp 的 baseVersion 小于官方 stable 版本且安装通道未知或 canary
- **THEN** Host 显示通道说明，前台使用原入口 update --yes，不暗中切换通道，并以装后重新探测结果判定

### Requirement: 官方发布源与后台只读查询
Host SHALL 按来源使用 sources 内置地址的匿名 GET：Antigravity 平台 manifest、Codex rust-v tag、Kimi native latest、MiMo FDS 文本、Grok stable 文本、OMP npm、Pi managed API、Hermes stable release、Qoder 两版 channels manifest、TRAE public stable，以及桌面专用发布读取器。字段格式、平台工件和清单摘要 SHALL 校验；普通请求统一受 8 秒、512 KiB、3 并发约束。后台发布查询 MUST NOT 启动任何 CLI check/update 子命令或 npm config 命令。

#### Scenario: Grok 后台查新
- **WHEN** 后台需要刷新 Grok 最新版本
- **THEN** 只 GET 官方 stable 文本，不执行会写文件的 grok update --check

#### Scenario: Codex tag 不是 rust-v
- **WHEN** OpenAI latest 返回其他 tag 前缀或非法版本
- **THEN** Host 报发布查询失败，不猜测目标

### Requirement: 无法锁版方法的实际版本核对
不能锁定目标的方法 SHALL 在身份核对后接受实际版本大于更新前版本且仍兼容的结果，即使不等于检查时目标；版本不变 MUST 返回 VERSION_UNCHANGED，降低、未知或越过 OpenCode V1 MUST 返回 VERSION_MISMATCH。成功后 SHALL 以实际版本重算分区并持久化。

#### Scenario: 检查后官方又发布新版
- **WHEN** Qoder 检查目标为 1.2.3，更新前为 1.0.0，实际更新为 1.2.4
- **THEN** 操作成功并显示 1.2.4，不因不等于旧目标失败

### Requirement: Pi 更新与 Worker 适配分离
Pi 更新 SHALL 取官方 latest，MUST NOT 用适配集合限制目标；适配判断 SHALL 共用 pi-installation 的 PI_SUPPORTED_VERSIONS/isSupportedPiVersion。未适配目标 SHALL 带可选 notice「插件尚未适配 Pi X，更新后 Pi Worker 要等插件适配后才能使用」，Worker 身份和协议核对 MUST 保持严格。

#### Scenario: 管理页读取未适配 Pi
- **WHEN** Pi 已安装有效新版本且官方包身份、入口正确，但 Worker 尚未适配
- **THEN** 管理页可读取版本和更新，Worker 仍拒绝不支持的协议

### Requirement: 手动更新原因与桌面应用版本
「需要手动更新」SHALL 仅保留外部管理器、未识别归属、不支持平台或确实没有可用官方源的情况，每条 SHALL 说明原因。ZCode/WorkBuddy 两版 SHALL 调用桌面更新器，下载回调仅返回已完整校验的文件。WorkBuddy 的官方 204 无更新响应 SHALL 映射为 latest，latestVersion 为当前应用版本且无更新计划，不得归检查失败。共享协议 appVersion、notice、channel SHALL 为可选字段。

#### Scenario: WorkBuddy 返回无更新
- **WHEN** 已核实应用版本的 WorkBuddy feed 返回 204
- **THEN** 显示已是最新，不启动安装，也不生成更新 token

#### Scenario: 官方 Windows 工件缺摘要
- **WHEN** 桌面发布读取器确认此平台的官方工件没有摘要
- **THEN** 显示具体手动原因，MUST NOT 下载执行未校验安装程序

### Requirement: 「更新 CLI」设置页入口与分区
设置窗口 SHALL 在左侧导航「智能体设置」之后、「CLI 连接」之前提供「更新 CLI」入口，图标为原生 `IconDownloadOutlineRegular`。有可更新的 CLI 时，入口右侧 SHALL 显示数量徽标，数量来自缓存，不必先进入该页；有更新或安装进行中时，徽标 SHALL 换成转圈；数量为 0 时 MUST NOT 显示徽标。页面 SHALL 依次显示「检查中」「检查失败」「可更新」「需要手动更新」「已是最新」「未安装」「下载设置」分区，没有内容的分区 MUST NOT 显示。每个分区标题行最右侧 SHALL 有同一个折叠按钮，「未安装」默认收起，其余默认展开，收起状态按分区记在本机。页头 SHALL 只有标题、副标题、「检查更新」和页内唯一的 primary 按钮「全部更新」，MUST NOT 显示状态行。

#### Scenario: 导航徽标来自缓存
- **WHEN** DSH 启动后预加载已得出 3 个可更新的 CLI，用户打开设置窗口但停留在通用页
- **THEN** 「更新 CLI」导航项显示徽标 3

#### Scenario: 没有可更新的 CLI
- **WHEN** 检查完成，所有已安装的 CLI 都是最新或只能手动更新
- **THEN** 导航不显示徽标，页头不显示「全部更新」，「可更新」分区不出现

#### Scenario: 收起状态保留
- **WHEN** 用户收起「已是最新」后关闭设置窗口再打开
- **THEN** 「已是最新」仍为收起，标题里的数量随检查结果更新

### Requirement: 加载与重排
页面 SHALL 先显示可用内容，再原地更新结果，分区归类集中重排。没有任何缓存时，17 个 CLI SHALL 立即列在「检查中」分区：读完本地版本后重排一次，查完最新版本后再重排一次，整个过程 MUST NOT 超过两次重排。有缓存时 SHALL 直接按缓存分区显示，只把缺缓存的 CLI 放进「检查中」，读完后与其他行一起只重排一次，已有结果的行 MUST NOT 重读。重排时，用户展开着的行和正在更新或安装的行 SHALL 原地不动，视口内第一行 SHALL 保持位置。最新版本查询的总等待上限为 30 秒，超时的行归入「检查失败」并写「查询超时」。Host 整体读不到状态时，页面 SHALL 只显示一行原因和「重试」，MUST NOT 显示空分区。

#### Scenario: 全部有缓存
- **WHEN** 17 个 CLI 都有未过期的缓存，用户打开「更新 CLI」页
- **THEN** 页面直接按缓存分区显示，不出现「检查中」分区，也不启动任何探测

#### Scenario: 部分缺缓存
- **WHEN** Kimi 的可执行文件指纹变了，其余 CLI 都有缓存
- **THEN** 只有 Kimi 出现在「检查中」分区，读完后与其他行一起重排一次

#### Scenario: 展开的行不移动
- **WHEN** 用户展开 ZCode 的「查看方法」时，检查结果要求 ZCode 改到别的分区
- **THEN** ZCode 留在原位，等用户收起后的下一次重排再归类

#### Scenario: 单个 CLI 查询超时
- **WHEN** OpenCode 的发布源 30 秒内没有返回
- **THEN** 其他行照常完成；OpenCode 写「查询超时」，随重排进入「检查失败」

### Requirement: 版本检查与兼容范围
Host SHALL 优先读清单；前台清单缺版本时，用实际调用的入口执行已核实的 `--version`：参数数组、stdin ignore、5 秒超时、确认进程范围退出、去 ANSI 后取首个完整合法 SemVer。Kimi MUST 带 `KIMI_CODE_NO_AUTO_UPDATE=1`。后台仅对 sources 标为无文件改动的 CLI 开放，按指纹复用结果；Codex、Qoder/CN 仅前台。Hermes 前后台均不执行版本命令，改读 install-stamp.json 的 baseVersion；缺少可信记录时显示版本未知。ZCode SHALL 读 Info.plist 应用版本，WorkBuddy SHALL 保留 CLI 版本并另读应用版本用于更新比较。普通 CLI 版本 SHALL 按 SemVer 比较；正式版不提示升级到预发布版。OpenCode V1 之外的版本 SHALL 显示「有新版本 X，插件尚未适配」，MUST NOT 提供更新按钮；Pi 更新不受 Worker 适配集合限制。

#### Scenario: 前后台版本命令权限不同
- **WHEN** 前台或后台检查缺少清单版本的 Codex、Qoder/CN 或 Hermes
- **THEN** 仅前台允许 Codex、Qoder/CN 版本命令，Hermes 两者均跳过；指纹不变的结果不重复执行

#### Scenario: Claude cask 无清单版本
- **WHEN** 前台识别出 Claude 的 Homebrew cask 归属且清单没有版本
- **THEN** Host 从实际入口读取版本，存在兼容更新时生成 `brew upgrade --cask claude-code` 参数数组

### Requirement: 发布元数据查询边界
最新版本 SHALL 从官方发布源读取（npm registry、Homebrew API、官方清单），每请求 8 秒超时、最多 3 并发、普通响应体限 512 KiB，MUST NOT 携带凭据。npm SHALL 先读 dist-tags；仅 compatibility 非 any 且 latest 不兼容时才读取版本列表，流式累计并限 32 MiB。镜像核对/回退顺序及精确版本 integrity/artifact 的 512 KiB 限制 SHALL 保持不变。

#### Scenario: 大包的 latest 已兼容
- **WHEN** dist-tags 返回的 latest 是插件已兼容的版本
- **THEN** Host 只读不超过 512 KiB 的 dist-tags，不读取整份 packument

#### Scenario: 兼容回退的版本列表超限
- **WHEN** latest 不兼容且版本列表实际流式字节数超过 32 MiB
- **THEN** Host 中止响应并报告发布查询失败，不放大其他请求上限

#### Scenario: Pi 出现未适配版本
- **WHEN** Pi 的最新版本不在插件适配集合内
- **THEN** 仍允许更新，行内 notice 显示「插件尚未适配 Pi X，更新后 Pi Worker 要等插件适配后才能使用」

#### Scenario: 探测 Kimi 不触发自动升级
- **WHEN** Host 读取 Kimi 当前版本
- **THEN** 子进程环境含 `KIMI_CODE_NO_AUTO_UPDATE=1`，Kimi 安装目录在探测前后没有变化

#### Scenario: 预发布版本
- **WHEN** 当前为 2.1.40，发布源的 latest 指向 2.2.0-beta.1
- **THEN** 不提示更新

### Requirement: 安装来源识别与更新计划
Host SHALL 解析可执行文件的符号链接，按真实路径识别安装来源：Homebrew（路径属于 Cellar 或 Caskroom，且 brew 元数据对应该 CLI 的包）、npm 全局包（路径含 `node_modules/<包名>/`，包名在该 CLI 的白名单内）、CLI 自带更新命令、官方独立安装器与桌面应用。WinGet、Scoop、Nix、Bun、pnpm 全局 SHALL 归入「需要手动更新」，只给原管理器说明；识别不出时 SHALL 写「没有识别出安装方式」。npm 更新 MUST 在原前缀下进行，MUST NOT 换包管理器。计划 SHALL 记录指纹（CLI、动作、平台、当前版本、可执行文件路径与文件状态、方法、目标版本及锁版能力）；开始执行前 Host SHALL 重新生成计划，指纹不一致时 MUST 拒绝，并提示「CLI 或安装方式已变化，请重新检查」。

#### Scenario: npm 全局安装
- **WHEN** Codex 的真实路径为 `<前缀>/lib/node_modules/@openai/codex/bin/codex.js`
- **THEN** Host 下载 `@openai/codex@<目标版本>` 主包并按官方 sha512 校验，在同一 `--prefix` 下安装已校验的本地 tgz；Node/npm 安装独立于包前缀解析，命令以参数数组执行

#### Scenario: WinGet 安装
- **WHEN** Grok Build 由 WinGet 安装
- **THEN** 归入「需要手动更新」，展开后显示 `winget upgrade` 命令与官方说明，没有「更新」按钮

#### Scenario: Qoder 官方分发入口
- **WHEN** Qoder/CN 真实路径分别为 `<home>/.qoder/entry/qoder` 或 `<home>/.qoder-cn/entry/qodercn`，且发布源存在兼容更新
- **THEN** Host 识别为 self-update、进入可更新，计划为 `[记录入口, 'update']`；entry 下其他名字不据此识别

#### Scenario: Qoder 分发路由冲突
- **WHEN** 即将执行官方分发入口（或其符号链接）的 update，而 homedir 下存在同名路径或无法检查
- **THEN** Host 在启动进程前拒绝并说明冲突，不转入 IDE，不删除用户路径

#### Scenario: Grok 官方下载实体
- **WHEN** Grok 记录入口为 `<home>/.grok/bin/grok`，真实路径位于 `<home>/.grok/downloads/`，官方 stable 文本有新版本
- **THEN** Host 识别为 self-update，生成 `[记录入口, 'update', '--version', 目标版本]`

#### Scenario: 计划过期
- **WHEN** 用户检查后在终端里重装了 Codex，回到页面点「更新」
- **THEN** Host 拒绝执行，提示 CLI 或安装方式已变化，并把该行重新检查

### Requirement: 执行更新与结果核对
更新和安装 SHALL 只能由设置页发起，MUST NOT 注册为主 Agent 或 Worker 的工具。Host 全局同一时间 SHALL 只执行一个更新或安装操作；「全部更新」SHALL 按顺序逐个执行。用户点「更新」后 SHALL 直接开始，行下展开下载进度、实际执行的命令和输出；输出 SHALL 去除 ANSI 控制序列、脱敏，只保留最后 32 KiB，按纯文本显示。命令 MUST 以参数数组执行，MUST NOT 拼接 shell。完成后 Host SHALL 确认进程范围已退出，再重新解析路径并读取版本：能锁版的方法 SHALL 核对目标版本，不能锁版的方法 SHALL 核对版本前进且仍兼容，并显示实际版本；版本没有变化 SHALL 显示「版本没有变化」；退出码为 0 MUST NOT 单独作为成功依据。关闭设置窗口 MUST NOT 取消操作；用户取消时，SHALL 在进程范围确认退出后才显示「已取消」。

#### Scenario: 更新成功
- **WHEN** Codex 从 0.129.0 更新，执行后重新探测得到 0.130.0
- **THEN** 行内显示「已更新到 0.130.0」，该行在下一次重排时进入「已是最新」

#### Scenario: 命令成功但版本未变
- **WHEN** 更新命令退出码为 0，重新探测仍为原版本
- **THEN** 显示「版本没有变化」，不算成功

#### Scenario: 关闭设置窗口
- **WHEN** 更新进行中用户关闭设置窗口
- **THEN** Host 继续更新；重新打开后显示当前阶段与已有输出

#### Scenario: 取消更新
- **WHEN** 用户点「取消更新」
- **THEN** 进程树确认退出后才显示「已取消」；清理无法确认时显示原因并保持该 CLI 的维护锁

### Requirement: 维护锁
目标 CLI 在更新或安装期间，Host SHALL 拒绝该 CLI 的新派遣、续聊执行、账号窗口、模型查询和路径修改，并给出具体原因；其他 CLI 不受影响。该 CLI 有任务在运行、准备、停止中、排队或有未暂停的续聊时，「更新」SHALL 不可用并悬停说明「这些任务结束或停止后才能更新」。准入检查与加锁 MUST 是同一个同步步骤，MUST NOT 先异步判断空闲再加锁。维护状态 MUST NOT 写入用户的启用设置。

#### Scenario: 更新期间派遣
- **WHEN** Codex 正在更新，主 Agent 派遣 Codex Worker
- **THEN** 派遣被拒绝，原因写明 Codex 正在更新；派遣 Kimi 不受影响

#### Scenario: 有任务在用
- **WHEN** Claude Code 有 2 个 Worker 正在运行
- **THEN** Claude Code 行的「更新」置灰，悬停说明需等任务结束或停止

### Requirement: 下载停滞检测与断点续传
插件自己掌控的下载（npm 主包 tarball、官方安装脚本、桌面安装包）SHALL 每 10 秒检查一次已下载字节；没有增长时 SHALL 中断连接，用 HTTP Range 从已下载位置继续，最多 200 次，总时长上限 2 小时。服务器不支持 Range 时 SHALL 整包重下，并计入同一次数预算。下载完成后 SHALL 校验官方长度或摘要；不符时 SHALL 删除文件并干净重下一次，仍不符才判为失败，校验通过前 MUST NOT 安装。外部命令只有在能读到下载字节时才适用停滞规则，否则页面显示「下载进度无法读取」，安装阶段另设 10 分钟上限。续传 200 次仍失败与超过 2 小时 SHALL 分开提示。取消时 SHALL 删除临时文件；失败或重启后临时文件保留 24 小时，总量有上限，用户重试时接着用。

#### Scenario: 停滞后续传
- **WHEN** 下载到 32 MB 后 10 秒没有增长
- **THEN** 插件中断连接，以 `Range: bytes=33554432-` 继续，进度区显示「已自动续传 1 次」

#### Scenario: 达到上限
- **WHEN** 第 200 次续传后仍然停滞
- **THEN** 判为失败，写「续传 200 次仍未完成」，提示可在页面底部切换下载源后重试；次数耗尽后不再主动换源，若仍有进展则继续当前连接至完成或总超时

#### Scenario: 校验失败
- **WHEN** 下载完成后 integrity 与官方源给出的值不符
- **THEN** 删除文件后干净重下一次，不消耗恢复计数；仍不符才失败且不执行安装

#### Scenario: 镜像元数据保留摘要但替换文件
- **WHEN** 镜像的目标版本元数据声明了与官方一致的 sha512，但 tarball 地址返回不同内容
- **THEN** Host SHALL 使用官方 sha512 验算实际文件；一次干净重下仍不符时返回 INTEGRITY_MISMATCH、删除临时文件，并且 MUST NOT 启动 npm 安装

### Requirement: 首次安装
「未安装」分区的 CLI SHALL 可以在本页安装。纯 CLI SHALL 装到官方默认位置，MUST NOT 让用户选择位置；同时有 npm 包和官方脚本时，SHALL 用官方推荐的方式，同为推荐时用 npm 包。官方安装脚本 SHALL 只使用 Host 内置的官方地址，先下载到插件私有缓存，再以文件方式交给明确的解释器执行，行内显示脚本地址。ZCode、WorkBuddy CN、WorkBuddy SHALL 可以在行内选择安装位置（只有图标的文件夹按钮，直接打开系统目录选择）；能静默安装的由插件安装到所选位置，不能的打开官方安装程序。位置需要管理员权限、空间不足或目录非空时 SHALL 用错误色提示并禁用「开始安装」。安装前 SHALL 检查前置条件（Node.js、Bun 版本等），不满足时 MUST NOT 安装，只说明所需版本并给出官方说明，MUST NOT 代装运行时。安装后读得出版本才算成功，桌面应用的所选路径 SHALL 写入机器级路径记录，下一步提示登录。

#### Scenario: 安装纯 CLI
- **WHEN** 用户在「未安装」里对 CodeBuddy Code 点「安装」
- **THEN** 插件用 npm 装到全局目录，装完读得出版本，行内提示去登录

#### Scenario: 缺少 Node.js
- **WHEN** 安装需要 Node.js 18.20 以上，本机没有 Node.js
- **THEN** 「安装」不可用，行内写明所需版本并给出官方说明

#### Scenario: 桌面应用选位置
- **WHEN** 用户把 WorkBuddy CN 的安装位置选为 `E:\WorkBuddy CN` 并安装成功
- **THEN** 插件把该位置的入口写入路径记录，「CLI 连接」页直接使用这个路径

#### Scenario: 安装脚本地址
- **WHEN** 安装 Grok Build
- **THEN** 插件只从内置的官方地址下载脚本，以文件方式执行，不经 `curl | bash`

### Requirement: 下载源设置
「下载设置」分区 SHALL 提供「下载源」下拉：跟随 npm 设置（默认）、npm 官方源、国内镜像 npmmirror、自定义地址。自定义地址 MUST 为 https，MUST NOT 含用户名或密码，并可「检查连接」。Host SHALL 在自动模式按所选 registry 标准包路径生成主包 tarball 地址（custom 模式仅用该源元数据的主地址），按 npm 官方源同版本 sha512 验证实际文件，再交给 npm 安装本地 tgz；官方源也 SHALL 使用同一路径。安装 SHALL 传入 `--registry <地址>` 供 npm 正常解析依赖，MUST NOT 修改用户的 `.npmrc` 或全局 npm 配置；官方安装脚本、CLI 自带更新命令、Homebrew 和桌面安装包始终从官方下载。npm 主包的官方 sha512 不可得或实际文件校验失败时 MUST NOT 安装，MUST NOT 降级为信任镜像摘要；`integritySource` SHALL 标明官方源。设置按本机保存，从下一次操作开始生效。

#### Scenario: 选择国内镜像
- **WHEN** 下载源为 npmmirror，用户更新 Codex
- **THEN** 命令含 `--registry https://registry.npmmirror.com`，用户的 npm 配置没有变化

#### Scenario: 自定义地址含密码
- **WHEN** 用户输入 `https://user:pass@npm.example.com`
- **THEN** 地址被拒绝并说明不能包含用户名或密码

### Requirement: 后台预加载的时机与负载
DSH 启动后，插件 Host SHALL 等待 60 秒，再在系统空闲时在后台读取 CLI 状态。空闲指没有 Worker 任务在运行或启动、没有打开的登录窗口、没有更新或安装进行中，且系统 CPU 忙碌低于 50%（用 `os.cpus()` 前后两次采样 2 秒计算）；不空闲时每 30 秒再看一次。预加载 SHALL 一次只跑一个探测，每项至少间隔 2 秒，子进程降低优先级；按 CLI 路径（只核对文件状态）、当前版本（只在指纹变化或没有记录时读取）、账号登录状态（只读）、最新版本（超过 6 小时才查）、缺失的模型目录的顺序进行。每次 DSH 启动只完整执行一遍。预加载 MUST NOT 刷新令牌、改写 CLI 配置或打开窗口；未验证无副作用的版本读取 MUST NOT 在后台运行。

#### Scenario: 系统空闲时开始
- **WHEN** DSH 启动满 60 秒，没有任务，系统 CPU 忙碌 20%
- **THEN** 预加载开始，同一时间最多一个探测子进程

#### Scenario: 文件没变不启动进程
- **WHEN** Codex 可执行文件的真实路径、大小和修改时间与缓存一致
- **THEN** 预加载不运行 `codex --version`，沿用缓存的版本与安装来源

### Requirement: 后台预加载的让路、开关与清理
用户派遣任务、打开登录窗口或开始更新或安装时，预加载 SHALL 立即暂停，正在运行的探测 SHALL 取消并确认进程退出，系统再空闲 30 秒后从没做完的一项继续。预加载 MUST NOT 占用更新锁，MUST NOT 阻止派遣。打开页面时预加载正在进行，页面 SHALL 接上同一个任务，剩余 CLI 改为前台速度，MUST NOT 重复启动探测。「CLI Worker 设置」通用页 SHALL 提供开关「启动后在后台检查 CLI」，默认开；关闭后不做预加载。插件停用或 DSH 退出时，定时器、采样器和子进程 SHALL 全部取消，子进程确认退出后才算清理完成。

#### Scenario: 派遣时让路
- **WHEN** 预加载正在读取 Qoder 账号状态，用户派遣 Codex Worker
- **THEN** 预加载取消该读取并确认子进程退出，派遣正常进行；30 秒空闲后从 Qoder 账号状态继续

#### Scenario: 关闭开关
- **WHEN** 用户关闭「启动后在后台检查 CLI」并重启 DSH
- **THEN** 不做预加载；打开「更新 CLI」页时按加载与重排规则读取

#### Scenario: 插件停用
- **WHEN** 预加载进行中用户停用插件
- **THEN** 正在运行的探测被取消，子进程确认退出后停用才完成

### Requirement: 分层缓存
CLI 状态缓存 SHALL 保存在插件私有目录，按本机保存，目录 0700、文件 0600，MUST NOT 进入 Git。CLI 路径与安装来源 SHALL 长期保存，在文件不存在或不可执行、真实路径变化、用户改了手动路径、本页刚装完或更新完时重读。当前版本 SHALL 长期保存，以真实路径、文件大小、修改时间（桌面应用再加应用包版本号）为指纹，指纹变化时重读。最新版本 SHALL 保存 6 小时，在超时、用户点「检查更新」、换了下载源时重查。账号登录状态 SHALL 保留上次结果用于显示，超过 10 分钟的在打开设置时原地静默重读，登录、退出、切换账号后立即重读；与项目有关的账号状态（Qoder、TRAE CN、WorkBuddy 等）按项目区分，换项目视为过期。缓存 SHALL 只保存显示需要的内容（版本号、来源、分区、检查时间、登录状态、界面上本来就显示的账号名），MUST NOT 保存令牌、Cookie、API Key 或命令输出。缓存文件读不出或格式不对时 SHALL 整份丢弃，按没有缓存处理，不报错。

#### Scenario: 账号状态过期
- **WHEN** 打开设置时某个 CLI 的账号状态缓存已有 15 分钟
- **THEN** 先显示上次的状态，同时原地重读，读完后替换

#### Scenario: 缓存损坏
- **WHEN** 缓存文件内容不是合法 JSON
- **THEN** 整份丢弃，页面按没有缓存加载，不弹错误

#### Scenario: 缓存不含凭据
- **WHEN** 检查缓存文件内容
- **THEN** 只有版本、来源、分区、时间、登录状态与显示用账号名，没有令牌或 Cookie

### Requirement: 自动入口与独立 runtime 的更新一致性
Host SHALL 保存自动发现的启动器或符号链接入口，每次使用时重新解析实体；旧 auto 记录命中已核实的托管版本目录时 SHALL 在前台重新发现入口，以 revision 比较写回，MUST NOT 修改 manual 记录。Pi 管理检查 SHALL 从入口重读 current-version，Worker MUST 保持原支持集合。

#### Scenario: Pi 更新切换版本指针
- **WHEN** Pi 自带更新将 current-version 从 1.0.4 改为 1.5.2，旧实体仍存在
- **THEN** 更新后检查读出 1.5.2，旧版本缓存失效；Worker 拒绝未适配 1.5.2，不回退旧实体

#### Scenario: ZCode 自动入口为独立 runtime
- **WHEN** 自动入口为插件固定 ZCode runtime 且默认应用 bundle id 已核实
- **THEN** 更新对象为 desktop-app，读取应用版本；检查行及更新结果说明独立 runtime 未随桌面应用更新且需要另行核验部署

#### Scenario: ZCode 应用身份不符
- **WHEN** 固定 runtime 对应的默认应用不存在或 bundle id 不符
- **THEN** 不将该 runtime 映射到桌面应用，不猜测版本或来源

### Requirement: 下载中断恢复与外部命令证据重试
Host SHALL 将连接关闭、重置、超时、fetch 网络错误及正文提前结束与下载停滞纳入同一 200 次续传和 2 小时预算；不可恢复的 HTTP、证书、Range 协议错误及缓存超限 MUST 直接失败；完整文件长度或摘要不符 SHALL 删除临时文件后干净重下一次，仍失败报告“下载的文件校验不通过”，该重下 MUST NOT 消耗或重置 200 次恢复预算或重置 2 小时总上限。

#### Scenario: 中断后按已写入字节续传
- **WHEN** 插件下载发生可恢复网络中断
- **THEN** Host SHALL 发送匹配已写入长度的 Range，并区分中断与停滞文案；200 响应从头覆盖，206 严格核对范围

#### Scenario: 外部下载退出但未更新
- **WHEN** 外部命令非零退出或版本未前进，原始输出包含下载中断证据，且进程范围退出已确认
- **THEN** Host SHALL 重跑同一 argv，保留脱敏输出及分隔行，用独立的自动重试次数表示，共用 200 次及 2 小时恢复预算，并允许取消
- **AND** 无中断证据、版本已前进、身份变化、进程清理未确认时 MUST NOT 自动重跑

### Requirement: 官方本地工件交接
Host SHALL 优先使用已核实的官方本地工件入口，在私有目录下载并校验官方工件，再交由官方安装器；URL MUST 来自内置官方模板或受限发布源，禁止用户输入下载地址或复刻 MiMo 安装步骤。MiMo macOS 默认原生更新 SHALL 下载内置官方 zip，校验 HEAD 长度、content-md5 与 zip 结构、精确提取根成员 mimo，交私有官方脚本 --binary 安装；SHALL 明示同源 MD5 不代表独立签名。TRAE CN MUST NOT 使用会关闭自动更新的 offline-install 接管，SHALL 保留原生 update --channel --version 与中断证据重跑。

#### Scenario: 官方安装器支持本地工件
- **WHEN** 官方提供本地工件入口及可核对的摘要或长度
- **THEN** Host SHALL 先完成可续传下载、校验及安全的本地工件准备，再调用官方入口；不支持的方式保留按中断证据重跑


#### Scenario: 校验失败只允许一次干净重下
- **WHEN** 完整文件与官方长度或摘要不符
- **THEN** Host SHALL 先删除临时文件，再不带 Range 从零重下；既有恢复计数及总超时保持，第二次仍不符删除文件并报校验失败

#### Scenario: MiMo 本地安装不越过维护锁与复核
- **WHEN** MiMo macOS 默认原生安装使用官方本地工件入口
- **THEN** Host SHALL 在维护锁内先下载后启动安装阶段，官方脚本只从内置地址下载到私有目录并以参数数组执行；安装后身份与目标版本均符合才成功，不清理安装器自有残留目录

#### Scenario: TRAE 保留自身自动更新配置
- **WHEN** 更新或首次安装 TRAE CN
- **THEN** Host MUST NOT 构造离线清单或调用 offline-install；已有安装保留原生更新及证据重跑，首次安装保留既有官方脚本

### Requirement: 可续传下载的低速重连
Host SHALL 使用一处 100,000 B/s 阈值，每个 10 秒窗口新增少于 1,000,000 B 且仍有进展时，仅对已证实支持 Range 的插件下载重连，共用 200 次计数；外部命令 MUST NOT 因低速被终止或重跑。

#### Scenario: 低速恢复保留已下载字节
- **WHEN** 206 或 Accept-Ranges: bytes 已证明续传能力，10 秒平均速度低于 100 KB/s 且仍有可用次数
- **THEN** Host SHALL 从已写入长度重新连接，并输出“下载过慢（X KB/s），从 Y 处重新连接（第 N 次）”；服务器忽略 Range 返回 200 后，后续 MUST NOT 再主动按慢速重连

#### Scenario: 次数用完后仍在前进
- **WHEN** 200 次已用完且正文仍在增长
- **THEN** Host SHALL 保持当前连接直到完成或 2 小时上限，不因低速报告失败；若真正 10 秒无增长才以次数耗尽失败

### Requirement: 官方同对象多源续传
Host 下载器 SHALL 提供 sources 列表能力，MiMo 配置官方双 FDS 源：API 域名优先、原域名备用；地址 MUST 匹配内置 host 与路径前缀白名单，无凭据，禁止重定向。最新版本查询 SHALL API 优先、失败回落原域名。首个成功源 HEAD SHALL 建立固定长度、ETag/content-md5 身份，换源前 MUST 核对目标 HEAD 一致；换源续传 SHALL 使用原已写字节的 Range/可用的 If-Range，核对 GET 身份及 206 范围，完成后核对长度与 content-md5（hex/base64），不符走一次干净重下。

#### Scenario: 慢速或中断轮换官方源
- **WHEN** MiMo 下载中断或达到已有低速重连条件
- **THEN** Host SHALL 在同一个 200 次/2 小时预算内选择下一个身份一致的源，继续 Range 并输出“切换到 <host> 继续下载（第 N 次）”；次数耗尽仍在前进时继续当前连接

#### Scenario: 换源身份不一致
- **WHEN** 备用源 HEAD 长度、ETag/content-md5 不匹配初始身份，或 GET ETag/MD5 不匹配已核实身份
- **THEN** Host MUST 拒绝换源或追加文件，不将不同对象片段合并

#### Scenario: 所有源不可用或校验重下仍失败
- **WHEN** 所有 HEAD 源不可用、GET 恢复预算耗尽或第二次完整文件校验仍失败
- **THEN** Host SHALL 报告失败，校验失败的文件 SHALL 删除，不执行安装器；取消 SHALL 停止回落/重试

### Requirement: npm 主包自动换源尊重所选源与官方校验
Host SHALL 为 npm 主 tarball 提供官方 registry 与 npmmirror 的多源列表，所选 registry 优先，follow 时使用 npm 当前 registry；显式 custom 模式 MUST NOT 自动换源（含 MiMo）。tarball 地址 SHALL 按各 registry 标准包路径生成，最终 integrity MUST 始终来自官方精确版本 packument 的 sha512，MUST NOT 采用镜像 integrity。中断/低速恢复 SHALL 复用 HEAD 身份检查、Range/If-Range、200 次和 2 小时预算；共享进度 SHALL 提供可选 sourceHost 表示实际下载 host。桌面包仅在匿名 HEAD 证实同对象第二官方域名与长度/摘要一致时配置备用源；证据不足 SHALL 保持单源。

#### Scenario: npm 官方和镜像双向恢复
- **WHEN** 所选官方或 npmmirror 主 tarball 下载过慢或中断，备用 HEAD 长度和 ETag/摘要一致
- **THEN** Host SHALL 从原已写字节换源，按目标源原始 ETag 发送 If-Range，推送 sourceHost 和切换输出，完成后仍按官方 sha512 校验

#### Scenario: 镜像元数据不能替换信任根
- **WHEN** 镜像 packument 的 integrity 或 tarball 地址被替换
- **THEN** 自动多源模式 SHALL 使用官方 sha512 和标准构造地址；实际文件校验失败只干净重下一次，仍失败不安装

#### Scenario: 自定义地址与未核实桌面备用源
- **WHEN** 下载设置为 custom 或桌面安装包没有同对象第二源证据
- **THEN** Host MUST NOT 自动切换下载 host；同源 Range 恢复及原校验规则保持

#### Scenario: npm 镜像 CDN 精确跳转
- **WHEN** npmmirror 标准 tarball 的 HEAD 返回跳转
- **THEN** Host SHALL 仅接受同包/版本预构造的 cdn.npmmirror.com/packages 精确目标；HEAD 可用严格的 Range 总长度，GET 禁止再次重定向；任意其他目标 SHALL 被拒绝

#### Scenario: 操作启动后修改下载源
- **WHEN** 操作已启动，用户在异步准备期间从 custom 改为官方源或反向修改
- **THEN** 当前操作 SHALL 使用启动时锁定的 registry 与自动换源策略，修改仅影响下一次操作

### Requirement: 项目连接状态静默预加载与缓存消费
Host SHALL 将已审计无副作用的账号状态、模型目录及其原生强度纳入既有 60 秒后空闲预加载队列。账号 SHALL 只读已记录入口对应的安全投影；目录 SHALL 禁止 prompt、原生会话、续期、刷新令牌与自动升级。Kimi 探测 MUST 设置 KIMI_CODE_NO_AUTO_UPDATE=1。无法证明满足该边界的查询 SHALL 保留前台，逐 CLI 原因写入设计。

#### Scenario: 项目已激活但设置未打开
- **WHEN** 主会话提供有效项目，后台检查开启且 Host 满足既有空闲条件
- **THEN** Host SHALL 按项目排入安全账号与目录项，取得的模型和强度不得来自猜测

#### Scenario: 后台被任务或登录打断
- **WHEN** 安全连接项尚未完成而新任务或账号窗口开始
- **THEN** Host SHALL 中止当前项并等待清理，空闲 30 秒后重试，旧取消结果不得写缓存

### Requirement: 连接快照、过期更新与来源作废
Host SHALL 按 Host 生命周期、项目和 CLI 隔离连接展示缓存，账号与目录分别保存 checkedAt、过期状态和 revision，10 分钟有效，时钟回拨视为过期。设置首屏 SHALL 可取得已有快照；请求连接状态 SHALL 先返回已有结果并对缺失或过期槽现查，通过订阅推送更新。未过期槽 MUST NOT 重复启动探测。旧接口 SHALL 仍兼容，强制刷新 SHALL 不被正在进行的读取吞掉。

#### Scenario: 缓存已命中
- **WHEN** 同一项目与 CLI 的账号及目录均未过期
- **THEN** 设置查询直接得到账号、模型和强度及 checkedAt，不再启动 CLI 进程

#### Scenario: 过期或未核实登录
- **WHEN** 账号缓存过期或 authenticated 没有 verification
- **THEN** 展示快照 SHALL 将其降为 unknown，不得显示绿色已登录；查询失败 SHALL 清除旧成功值并发布错误

#### Scenario: 登录或入口变化期间旧查询返回
- **WHEN** 登录/退出/账号切换、CLI 启用状态或执行入口发生变化
- **THEN** Host SHALL 作废相关 CLI 各项目的账号和目录缓存、增加 revision、中止旧查询并等待清理，旧回执不得恢复已作废内容

#### Scenario: Host 停用或项目切换
- **WHEN** Host 停用或客户端切换项目
- **THEN** 停用 SHALL 中止并等待所有读取及清理订阅，项目快照不得串用，重启不得将上次 Host 的登录缓存当作已核实状态
