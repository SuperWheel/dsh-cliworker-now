## ADDED Requirements

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
Host SHALL 用插件实际调用的可执行文件读取当前版本，带超时；探测 Kimi 时 MUST 设置 `KIMI_CODE_NO_AUTO_UPDATE=1`。没有已验证、无副作用读法的 CLI SHALL 显示「版本未知」，MUST NOT 猜测。最新版本 SHALL 只从官方发布源读取（npm registry、Homebrew API、官方清单），单个请求 8 秒超时、最多 3 个并发、响应体超过 512 KiB 视为无效，MUST NOT 携带凭据。版本 SHALL 按 SemVer 比较；当前是正式版、远端是预发布版时 MUST NOT 提示更新。Pi（白名单 1.0.2、1.0.4、1.1.0）、OpenCode（只到 V1）等有适配范围的 CLI，发布源上超出范围的新版本 SHALL 写「有新版本 X，插件尚未适配」，MUST NOT 提供更新按钮。

#### Scenario: Pi 出现未适配版本
- **WHEN** npm 上 Pi 的最新版本不在插件白名单内
- **THEN** 行内显示「有新版本 X，插件尚未适配」，没有「更新」按钮

#### Scenario: 探测 Kimi 不触发自动升级
- **WHEN** Host 读取 Kimi 当前版本
- **THEN** 子进程环境含 `KIMI_CODE_NO_AUTO_UPDATE=1`，Kimi 安装目录在探测前后没有变化

#### Scenario: 预发布版本
- **WHEN** 当前为 2.1.40，发布源的 latest 指向 2.2.0-beta.1
- **THEN** 不提示更新

### Requirement: 安装来源识别与更新计划
Host SHALL 解析可执行文件的符号链接，按真实路径识别安装来源：Homebrew（路径属于 Cellar 或 Caskroom，且 brew 元数据对应该 CLI 的包）、npm 全局包（路径含 `node_modules/<包名>/`，包名在该 CLI 的白名单内）、CLI 自带更新命令、官方独立安装器。WinGet、Scoop、Nix、Bun、pnpm 全局和桌面应用托管的安装 SHALL 归入「需要手动更新」，只给官方方法；识别不出时 SHALL 写「没有识别出安装方式」。npm 更新 MUST 在原前缀下进行，MUST NOT 换包管理器。计划 SHALL 记录指纹（CLI、动作、平台、当前版本、可执行文件路径与文件状态、方法、目标精确版本）；开始执行前 Host SHALL 重新生成计划，指纹不一致时 MUST 拒绝，并提示「CLI 或安装方式已变化，请重新检查」。

#### Scenario: npm 全局安装
- **WHEN** Codex 的真实路径为 `<前缀>/lib/node_modules/@openai/codex/bin/codex.js`
- **THEN** 计划为在同一前缀下安装 `@openai/codex@<目标版本>`，命令以参数数组执行

#### Scenario: WinGet 安装
- **WHEN** Grok Build 由 WinGet 安装
- **THEN** 归入「需要手动更新」，展开后显示 `winget upgrade` 命令与官方说明，没有「更新」按钮

#### Scenario: 计划过期
- **WHEN** 用户检查后在终端里重装了 Codex，回到页面点「更新」
- **THEN** Host 拒绝执行，提示 CLI 或安装方式已变化，并把该行重新检查

### Requirement: 执行更新与结果核对
更新和安装 SHALL 只能由设置页发起，MUST NOT 注册为主 Agent 或 Worker 的工具。Host 全局同一时间 SHALL 只执行一个更新或安装操作；「全部更新」SHALL 按顺序逐个执行。用户点「更新」后 SHALL 直接开始，行下展开下载进度、实际执行的命令和输出；输出 SHALL 去除 ANSI 控制序列、脱敏，只保留最后 32 KiB，按纯文本显示。命令 MUST 以参数数组执行，MUST NOT 拼接 shell。完成后 Host SHALL 确认进程范围已退出，再重新解析路径并读取版本：版本等于目标才算成功；版本没有变化 SHALL 显示「版本没有变化」；退出码为 0 MUST NOT 单独作为成功依据。关闭设置窗口 MUST NOT 取消操作；用户取消时，SHALL 在进程范围确认退出后才显示「已取消」。

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
插件自己掌控的下载（npm 主包 tarball、官方安装脚本、桌面安装包）SHALL 每 10 秒检查一次已下载字节；没有增长时 SHALL 中断连接，用 HTTP Range 从已下载位置继续，最多 200 次，总时长上限 2 小时。服务器不支持 Range 时 SHALL 整包重下，并计入同一次数预算。下载完成后 SHALL 校验 integrity 或摘要，不符时 MUST 判为失败、MUST NOT 安装。外部命令只有在能读到下载字节时才适用停滞规则，否则页面显示「下载进度无法读取」，安装阶段另设 10 分钟上限。续传 200 次仍失败与超过 2 小时 SHALL 分开提示。取消时 SHALL 删除临时文件；失败或重启后临时文件保留 24 小时，总量有上限，用户重试时接着用。

#### Scenario: 停滞后续传
- **WHEN** 下载到 32 MB 后 10 秒没有增长
- **THEN** 插件中断连接，以 `Range: bytes=33554432-` 继续，进度区显示「已自动续传 1 次」

#### Scenario: 达到上限
- **WHEN** 第 200 次续传后仍然停滞
- **THEN** 判为失败，写「续传 200 次仍未完成」，提示可在页面底部切换下载源后重试，不自动换源

#### Scenario: 校验失败
- **WHEN** 下载完成后 integrity 与官方源给出的值不符
- **THEN** 判为失败并删除文件，不执行安装

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
「下载设置」分区 SHALL 提供「下载源」下拉：跟随 npm 设置（默认）、npm 官方源、国内镜像 npmmirror、自定义地址。自定义地址 MUST 为 https，MUST NOT 含用户名或密码，并可「检查连接」。所选源 SHALL 只以 `--registry <地址>` 参数作用于插件发起的 npm 安装和更新，MUST NOT 修改用户的 `.npmrc` 或全局 npm 配置；官方安装脚本、CLI 自带更新命令、Homebrew 和桌面安装包始终从官方下载。使用非官方源时，目标版本号和 integrity SHALL 优先向 npm 官方源核对，官方源连不上时才用所选源的值，并在命令下方注明校验值来源。设置按本机保存，从下一次操作开始生效。

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
