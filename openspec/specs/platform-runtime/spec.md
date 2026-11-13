# platform-runtime Specification

## Purpose

规定插件在 macOS 与 Windows 中如何识别并启动已安装的原生 CLI、使用其自身保护与权限模式、解析对应系统路径并确认进程清理，确保跨平台声明来自实际运行证据。

## Requirements

### Requirement: CLI 原生保护方式
插件 SHALL 使用各 CLI 实际支持的原生权限和计划模式，不额外套插件操作系统进程沙箱。宿主授权、项目及模型选择边界 MUST 保持；原生不支持的只读模式不得通过普通写入模式冒充。

#### Scenario: 原生任务启动
- **WHEN** 用户授权并选择已安装 CLI、模型和强度后启动任务
- **THEN** 只传该 CLI 实际支持的原生参数，不依赖 macOS sandbox-exec，不静默换用 CLI 或权限模式

#### Scenario: 只读能力缺失
- **WHEN** 请求原生 CLI 不支持的只读任务模式
- **THEN** 保留明确拒绝，不添加不存在的开关或绕过宿主限制

### Requirement: Windows 原生入口与路径
插件 SHALL 在 Windows 按实际官方安装入口启动 exe、Node/Bun 和 Python CLI，参数保持独立 argv，不拼接 shell。盘符与 UNC、当前原生账号目录和安装资产 MUST 按该平台解析；未知 batch 形态短错误拒绝。

#### Scenario: npm Windows shim
- **WHEN** 官方固定 npm shim 指向可核验的自身 JavaScript 入口
- **THEN** 使用该入口记录的 Node/Bun 运行时启动，CLI 参数按原数组保留，包含空格/中文/引号的参数不触发 shell 执行

#### Scenario: 不受支持的入口
- **WHEN** 自定义 batch 包含无法确认的程序或逻辑
- **THEN** 拒绝并显示短原因，不以 cmd /c 执行任意 batch

#### Scenario: 当前认证路径
- **WHEN** 当前原生登录位于 Windows 盘符或 UNC 路径
- **THEN** 状态和执行读取相同 CLI 的当前来源，不生成错误盘符路径或复制旧认证

### Requirement: 跨平台进程范围清理
Windows 任务 SHALL 使用可确认后代归属的 Host 进程管理能力；停止、取消与清理失败语义保持一致。测试 MUST 验证实际 Windows 进程范围，不能只用 mock 证明后代退出。

#### Scenario: Windows 任务取消
- **WHEN** 用户停止或取消启动了后代的任务
- **THEN** 等待所有受管理进程退出再报告停止成功；无法确认时阻止冲突任务

#### Scenario: 关闭账号终端
- **WHEN** 用户关闭原生账号菜单
- **THEN** 清理属于该菜单的进程和临时状态，持久账号和其他终端保留

### Requirement: Windows 桌面 CLI 自定义安装发现
Host SHALL 从 Windows 已知默认目录、当前用户及公共安装登记、已运行产品的映像位置和已知快捷方式位置定位 ZCode/OpenCode 桌面随附 CLI，支持自定义磁盘、中文及空格目录。只检查对应产品实际 CLI 布局，MUST 不以桌面 GUI 或安装痕迹代替 CLI，不执行登记或快捷方式中的命令。无安装记录、PATH 或快捷方式且程序未运行的任意解压目录 SHALL 保留显式路径配置方式。

#### Scenario: ZCode 自定义目录
- **WHEN** 用户安装 ZCode 到默认目录外，登记或快捷方式指向该安装且存在配套 CLI/provider
- **THEN** 自动解析该 CLI，状态、模型、登录和任务使用相同入口，无需用户追加 PATH 或手改执行路径

#### Scenario: 安装位置字段为空
- **WHEN** 卸载登记的 InstallLocation 为空，但匹配产品的 DisplayIcon 或快捷方式指向实际安装
- **THEN** 从有效文件路径定位安装根，兼容卸载 ICO、带图标索引的 EXE 和带引号路径，不执行该字段

#### Scenario: OpenCode 随附 CLI
- **WHEN** OpenCode 实际发行物含 resources/opencode-cli.exe 或安装根的独立 CLI
- **THEN** 选取核验通过的独立 CLI，不能执行 OpenCode 桌面主程序冒充 CLI

#### Scenario: 无可发现信息
- **WHEN** 任意位置的便携文件夹没有登记、已知快捷方式或 PATH，且程序未运行
- **THEN** 不扫描任意驱动器猜测，返回未找到 CLI 的明确原因及对应显式路径字段

### Requirement: Windows 入口优先级与歧义
显式 CLI 路径及已部署的 ZCode 完整运行时 SHALL 保持优先，正常的原生 PATH/shim 行为 SHALL 保留。自动发现 MUST 去重同一真实入口，并拒绝多个不同可用安装；损坏的显式来源不得静默换成另一安装，PATH 指向已识别桌面 GUI 时只能转到该安装的核验 CLI 或报告 CLI 缺失。

#### Scenario: 显式来源优先
- **WHEN** 用户配置有效路径，或存在已部署的 ZCode 完整 CLI
- **THEN** 不读取其他桌面安装覆盖该来源；显式错误保持可见

#### Scenario: 登记与快捷方式重复
- **WHEN** 同一入口通过 32/64 位登记和多处快捷方式出现
- **THEN** 归一化并按真实文件去重，不制造重复安装或随机选择

#### Scenario: 多个不同安装
- **WHEN** metadata 确认多个不同可用 ZCode 或 OpenCode CLI
- **THEN** 返回需显式选择路径的短提示，不按目录顺序、版本或修改时间猜测

### Requirement: 桌面安装查询边界和清理
桌面安装发现 SHALL 是有数量、目录深度、输出及超时上限的只读查询，仅处理相应产品记录和已有快捷方式。查询 MUST 支持取消及确认进程范围退出，错误不暴露个人路径、原始登记或凭据；自动 metadata 中的相对、device 或远程网络路径不得被采用。非 Windows 平台及其他 CLI SHALL 不启动该查询。

#### Scenario: 查询被取消或超时
- **WHEN** 状态、选型或启动准备取消了安装查询
- **THEN** 等待查询进程退出，不使用迟到入口、不启动 CLI；范围清理未确认继续阻塞

#### Scenario: 异常或越界 metadata
- **WHEN** 查询不完整、格式无效、输出过大或候选路径不合法
- **THEN** 返回简短探测错误，不执行 metadata 或泄露其原文，不把异常伪装成确定未安装

#### Scenario: 其他平台
- **WHEN** macOS 或其他 CLI 解析原生入口
- **THEN** 保留既有行为，不查询 Windows 注册表或快捷方式

#### Scenario: 不依赖桌面图标或快捷方式
- **WHEN** 用户未创建或已经删除桌面及开始菜单快捷方式
- **THEN** 已知默认目录或有效 InstallLocation / DisplayIcon / App Paths 仍可独立定位 CLI；DisplayIcon 仅作为安装登记路径，不要求桌面存在图标

#### Scenario: 无登记但程序已运行
- **WHEN** 自定义目录未登记且缺少快捷方式，但相应产品程序正在运行
- **THEN** 可读取精确产品名的程序映像位置作为线索并核验相同安装中的 CLI，不读取命令参数、不启动程序、不把同名进程本身视为 CLI

### Requirement: Electron 宿主中的物理安装识别
Windows CLI 安装识别 SHALL 依据磁盘中的实际文件类型、权限和内容，不因宿主将 ASAR 视作虚拟目录而拒绝有效 CLI。可选桌面归档标记缺失 MUST 不阻止普通独立 CLI；真实读取失败、损坏入口及显式桌面 GUI 仍须按既有边界报错。检查不得改变宿主全局归档行为。

#### Scenario: npm CLI 无桌面归档
- **WHEN** Electron 宿主发现有效 OpenCode npm 原生 CLI，旁侧不存在桌面 app.asar
- **THEN** 保留该 CLI 并自动记录路径，不因可选标记缺失报桌面入口不可用

#### Scenario: 桌面归档为物理文件
- **WHEN** PATH 命中 OpenCode 桌面 GUI，磁盘存在桌面归档与核验通过的独立 CLI
- **THEN** 自动解析该安装的独立 CLI；手动指定 GUI 时仍明确拒绝

#### Scenario: 真实文件错误
- **WHEN** 安装文件无读取权限、不是普通文件或 PE 内容损坏
- **THEN** 保留安装错误，不将其当作可选归档缺失，不静默换用其他 CLI

### Requirement: Windows 后台查询不创建独立终端窗口
插件 SHALL 在已核验的 Windows CLI 安装与版本上后台完成设置首次加载、账号及模型刷新、模型或思考强度保存时的 CLI 查询，不创建可见的独立终端窗口。已核验安装启动器的内部派生不得绕过该保证；隐藏处理 MUST 保留原账号、模型目录、参数、环境、输出及失败语义，不省略校验或切换安装。未核验的第三方启动器版本保留原调用并明确验证边界，不猜测其内部协议或声明已通过窗口验收。用户显式打开的内嵌账号终端及登录浏览器保留原行为。

#### Scenario: 冷启动首次打开设置
- **WHEN** Desktop 冷启动后首次打开设置，并查询启用 CLI 的账号与当前 CLI 目录
- **THEN** 查询与结果正常完成，无属于该后台查询的可见控制台或 Windows Terminal 窗口

#### Scenario: 模型及强度自动保存和刷新
- **WHEN** 用户选择模型、思考强度，或手动刷新账号／目录
- **THEN** 保留真实账号绑定与目录校验，后台启动不弹独立终端，失败仍在插件内反馈

#### Scenario: 安装启动器内部调用原生程序
- **WHEN** 已确认的官方 Node 启动器会通过继承标准句柄再次派生原生 CLI
- **THEN** 使用同一安装的核验原生启动信息和原生环境语义，保持字节输出与进程范围管理，不能静默调用其他安装

#### Scenario: 取消或启动失败
- **WHEN** 后台查询取消、超时或原生入口不可用
- **THEN** 等待受管理进程范围清理，保留取消和失败状态，不降级为可见终端或未验证入口

#### Scenario: Antigravity 后台自动更新
- **WHEN** Windows 插件后台读取 Antigravity 模型或启动 Antigravity 任务
- **THEN** 仅本次子进程设置官方 `AGY_CLI_DISABLE_AUTO_UPDATE=true`，避免内部更新进程弹出独立终端；账号、模型和任务参数保持原行为，不修改系统环境、用户更新标记或显式账号终端

#### Scenario: 其他平台和显式账号交互
- **WHEN** 在 macOS 执行相同查询，或用户主动打开内嵌账号终端
- **THEN** 维持现有平台及交互行为，不为隐藏后台窗口而更改原生保护、认证或终端输入输出

### Requirement: Windows 后台引导器退出与长路径元数据
Windows 后台引导器 SHALL 在原生父进程已结束、退出回执已发送且被转发的输入输出均已关闭后自然退出，不得仅因只写控制通道保留可读端而持续驻留。原生父进程退出回执 MUST 与整个进程范围退出区分；受管理后代及进程范围清理仍由宿主与 Job 管理。Windows 私有 SQLite 元数据快照及查询请求临时目录 SHALL 使用长路径兼容的文件入口，保留源只读及文件身份检查。

#### Scenario: 后台命令完成
- **WHEN** 原生后台命令正常或非零退出，退出回执已发送且转发输入输出均已关闭
- **THEN** 引导器自然退出，不依赖超时强制结束，也不打开终端窗口；原生退出码和信号通过回执准确保留，不以引导器自身退出码替代

#### Scenario: 原生父进程退出但后代仍持有输出管道
- **WHEN** 原生父进程已退出，但受管理后代仍持有输出管道
- **THEN** 及时发送父进程的准确退出回执并继续转发字节，直到管道关闭或宿主完成进程范围清理；不能将父进程回执当作全部后代已退出，也不能提前截断输出

#### Scenario: 用户目录或隔离快照路径很长
- **WHEN** Windows 原生账号的 SQLite 临时快照路径超过普通 Win32 路径限制
- **THEN** 按同一路径的长路径语义读取或创建快照，不因路径长度误报账号不可读取，不迁移或改写原账号目录

#### Scenario: 查询请求临时目录路径很长
- **WHEN** Windows 查询请求临时目录的完整路径超过普通 Win32 路径限制
- **THEN** 按同一路径的长路径语义创建、读写和清理请求文件，不因路径长度误报账号或目录不可用，不迁移原账号目录

### Requirement: Windows Qoder CLI 自动发现
Qoder 的 Windows 自动发现 SHALL 使用实际独立 CLI 的官方固定安装位置、已核验的官方 npm 包 bin 和 PATH，不能将同名编辑器或分发脚本当作可直接执行的 CLI。手动路径及显式部署配置 MUST 保持优先；存在但损坏、权限不足或不支持的入口不得被另一安装静默替换。发现路径不代表账号或模型验收，不扫描任意目录、不安装或修改用户原生配置。

#### Scenario: Desktop PATH 尚未包含官方安装
- **WHEN** Windows 当前用户已在官方固定位置安装原生 qodercli，或已安装包名和固定 bin 均可确认的官方 npm 入口
- **THEN** 插件无需修改系统 PATH 即可识别实际 CLI，npm shim 静态解析为单独参数执行，不启动同名 IDE 或执行 shell 脚本文本

#### Scenario: 独立命令与旧别名兼容
- **WHEN** 固定位置没有安装且 PATH 存在实际 qodercli，或仅在独立命令缺失时存在旧版 qoder CLI 入口
- **THEN** 优先独立 CLI，兼容旧别名；显式路径失效、权限错误和无法确认的现有启动器保留错误，不切换到别的安装

### Requirement: Windows Qoder 原生账号与终端
Windows Qoder 账号读取 SHALL 使用已发现的同一官方 CLI、当前原生账号来源及其实际控制协议，不以文件存在替代登录证明。查询的自然失败、主动收尾和网络边界 MUST 按真实回执区分；原生交互终端保留本方进程范围归属、用户输入及完整退出检查，不修改原生账号数据来绕过失败。

#### Scenario: 已登录账号的只读查询
- **WHEN** 同一原生 CLI 成功回复账号或模型控制查询并确认结束会话，插件随后主动回收其 Windows 进程范围
- **THEN** 按该平台实际主动结束回执分类，并在完整退出确认后呈现已核实结果；取消、协议错误及未确认退出仍拒绝

#### Scenario: 正式 Desktop 中的原生交互终端
- **WHEN** 用户显式打开 Qoder 普通或登录终端
- **THEN** 从正式宿主实际官方终端依赖验证来源后启动，输入输出可用，关闭或自然结束均确认所属范围退出；无法证明来源时明确拒绝，不放宽为任意同名进程

### Requirement: 原生持久遥测的跨平台文件保护
持久遥测只读补充 SHALL 使用当前系统可核验的身份和访问控制，不能在 Windows 将模拟 POSIX mode 当作实际私有权限。读取 MUST 保留精确账号、项目、会话与运行归属，以及路径、链接、大小和读取期间稳定性检查；不能证明安全时保持未知，不修改原生文件权限或读取其他会话兜底。

#### Scenario: Windows 合法私有来源
- **WHEN** Windows 原生会话文件的当前用户身份、访问控制、路径和读取稳定性均经确认
- **THEN** 可读取同一运行公开的用量或上下文，不因模拟 POSIX mode 固定包含其他位而恒定拒绝

#### Scenario: 无法确认或被替换
- **WHEN** 权限读取失败、存在不可信访问来源、路径越界或读取期间发生替换
- **THEN** 丢弃补充统计并保持未知，不放宽所有者或链接约束，不改写原会话

### Requirement: Windows 官方 ConPTY 实现身份
原生账号终端 SHALL 兼容当前已核验的官方宿主终端实现。接受控制台进程 MUST 基于精确的系统来源或实际官方依赖来源、关联进程和创建时序，不仅凭进程名放行；停止仍须确认整个所属范围退出。

#### Scenario: 官方依赖提供控制台程序
- **WHEN** 已核验的官方终端依赖以自己的控制台程序承载当前终端
- **THEN** 按实际安装来源和完整归属证明接入，输入输出、停止和自然退出可在 Windows 实机核对

#### Scenario: 同名或不明控制台
- **WHEN** 控制台程序来自其他路径、归属不符或缺少来源证明
- **THEN** 拒绝接入，不通过名称白名单或放宽进程范围绕过保护

### Requirement: Hermes 原生网关就绪及启动失败
Host SHALL 只在确认本次 Hermes 原生网关的实际进程、精确本机监听和鉴权能力后提交模型请求。Windows 启动器与实际 Python 网关进程不同时 MUST 核对二者的本次执行归属，不接受仅由旧磁盘记录声明的 PID。启动失败或取消必须回收本次进程范围并保留失败结果。

#### Scenario: Windows Python 启动器与网关 PID 不同
- **WHEN** 已核验的 Windows Hermes 原生入口使用启动器派生实际 Python 网关
- **THEN** 依据本次自有入口的执行证明核对实际网关，监听地址和状态写入者一致且鉴权能力有效后报告就绪，不把启动器 PID 误当网关 PID。

#### Scenario: 旧状态或其他监听者
- **WHEN** 状态文件来自旧运行、非本次进程或不同端口，或者监听者不属于本次启动
- **THEN** 不向该监听者发送鉴权秘密或模型请求，不降低进程归属和新鲜度校验。

#### Scenario: 启动失败或取消
- **WHEN** 网关超时、提前退出、能力缺失或用户取消启动
- **THEN** 保留明确失败或取消，确认本次进程范围退出，清理临时账号快照，不改变原始账号和历史，不自动重试模型任务。

### Requirement: 公共 Windows 路径发现
插件 SHALL 对所有受支持 CLI 复用有界的 Windows 路径发现流程，读取当前进程及当前用户/机器 PATH，并检查共享常见安装入口。版本专属位置及包身份 MUST 保留精确声明；显式配置优先、无关 GUI 不执行、不扫描任意磁盘或猜测最新版本。

#### Scenario: Desktop PATH 陈旧
- **WHEN** 受支持 CLI 已通过用户安装器加入用户或机器 PATH，而 Desktop 继承的 PATH 尚未更新
- **THEN** 公共发现层读取最新路径并按该 CLI 的入口规则解析，保留现有原生 argv 启动及取消清理边界。

#### Scenario: 显式损坏或跨版安装
- **WHEN** 显式入口损坏、不可访问，或候选实际属于另一 CLI/品牌
- **THEN** 保留该错误或拒绝候选，不静默替换显式入口、启动 GUI 或回退另一品牌。

### Requirement: POSIX 账号终端关闭先结束 CLI
在 macOS 与 Linux 上关闭仍在运行的原生账号终端时，插件 SHALL 先请求该终端的前台 CLI 退出（SIGTERM），最多等待配置的宽限时间，再由宿主终端清理确认整个范围退出；CLI 已退出时 MUST 不再发送任何信号。CLI 未在宽限时间内退出时仍执行原清理，无法确认时保持“清理失败、继续占用”的原语义。

#### Scenario: 登录辅助进程成为僵尸
- **WHEN** CLI 登录时派生的辅助进程已结束但未被 CLI 回收，用户随后关闭账号终端
- **THEN** CLI 先退出、僵尸由系统回收，清理成功，状态为已关闭且解除占用

#### Scenario: CLI 忽略 SIGTERM
- **WHEN** CLI 在宽限时间内未退出
- **THEN** 继续调用宿主清理，结果以清理是否确认为准

#### Scenario: CLI 已自行退出
- **WHEN** 用户在 CLI 中退出后终端随之结束
- **THEN** 不向任何进程发送信号，只完成清理

### Requirement: 同项目并行启动的派生状态
同一项目的多个任务同时启动时，插件为其准备的共用派生状态文件和指向 CLI 自身登录的链接 SHALL 以完整文件原子替换，MUST NOT 因并行删除与重建而让任一启动失败或读到不完整内容；链接仍 MUST 只引用 CLI 自身当前登录，登出后不得复活旧引用。

#### Scenario: Grok 同项目并行启动
- **WHEN** 同一项目同时准备 5 个 Grok 任务
- **THEN** 每个任务都得到完整配置和指向自身登录的引用，不出现 `EEXIST`，不残留临时文件

### Requirement: Hermes 子进程的 IPv6 代理旁路
插件启动 Hermes（账号终端、续期、任务运行）时 SHALL 把 `NO_PROXY` / `no_proxy` 中带括号、带端口或 CIDR 形式的 IPv6 条目改写为裸地址并去重；IPv4、域名、通配符及无需改写的值 MUST 保持继承，该改写本身 MUST NOT 新增、删除或改变代理地址。Windows 上补充系统代理时按「Windows 系统代理继承」处理，改写后的 `NO_PROXY` 作为其继承值合并。

#### Scenario: DSH 发布带括号的回环地址
- **WHEN** 继承环境 `NO_PROXY=localhost,127.0.0.1,::1,.local,[::1]`
- **THEN** Hermes 进程收到 `localhost,127.0.0.1,::1,.local`，Nous 凭据校验与续期不因代理旁路解析失败

#### Scenario: 无需改写
- **WHEN** 继承的 `NO_PROXY` 不含带括号或 CIDR 形式的 IPv6，或包含 `*`
- **THEN** 该改写不覆盖该变量；只有 Windows 补充系统代理时，按「Windows 系统代理继承」在其基础上合并回环地址与代理例外

### Requirement: Windows 官方固定入口兼容
Windows 官方 npm 原生 exe shim 与 Pi 管理式 Node 启动器 SHALL 可经静态安装身份核验解析到实际原生入口。版本支持 MUST 建立在安装包契约和实际离线探针上，未知脚本或不可信路径继续拒绝。

#### Scenario: 官方入口
- **WHEN** 官方固定启动器指向核验通过的包与原生程序
- **THEN** 插件识别已安装并以独立 argv 启动，不经任意 batch 执行

#### Scenario: 入口异常
- **WHEN** 启动器含附加命令、版本指针越界、包身份不符或目标无效
- **THEN** 拒绝并提供入口不可用的短原因，不冒充未下载 CLI 或自动执行脚本

### Requirement: Windows Codex 与 Hermes 已有安装识别
插件 SHALL 核验 Windows 上 Codex 与 Hermes 的既有安装路径和实际原生入口，区分未发现、入口不兼容及版本不支持；不得仅因 Desktop 继承的旧 PATH 而误报已知官方路径中的有效安装不存在。启动 MUST 继续使用核验后的参数数组，不执行未知脚本或自动更换运行系统。

#### Scenario: 官方安装未在 Desktop PATH
- **WHEN** 用户已在该系统的已知官方位置安装 CLI，但 Desktop PATH 尚未包含该路径
- **THEN** 核对包/入口身份后识别并使用该安装，或明确报告该平台入口不支持，不要求重复安装

#### Scenario: 安装证据不足
- **WHEN** 已知路径和当前可用入口均无法核验，或仅找到不同系统的入口
- **THEN** 报告可核查的缺失或兼容边界，不伪造已安装、不静默改用其他 CLI/WSL

### Requirement: Windows Electron 后台 CLI 启动不创建可见控制台
Windows Electron 宿主中的后台 CLI 启动 SHALL 经插件统一的原生进程边界处理。目标不是当前 Electron 运行时的后台进程 MUST 先由当前 GUI 子系统运行时启动固定 bootstrap，再以参数数组、`windowsHide` 和独立标准管道启动真实目标；普通后台包装器不得以继承数字标准流描述符的方式重新触发 Windows 控制台窗口。插件自有包装器的嵌套原生子进程也 SHALL 使用同一隐藏窗口启动边界，不通过 shell 拼接任务命令。已有当前运行时入口不得重复包装，macOS 与交互式 ConPTY 分配 SHALL 保留原有路径。

#### Scenario: 打开设置和刷新触发后台检查
- **WHEN** Windows Electron 中首次打开设置、刷新账号状态或模型目录触发原生后台 CLI 检查
- **THEN** 插件使用固定 GUI bootstrap 和隐藏的原生子进程，不为检查额外创建 Windows 终端窗口；授权流程需要的正常浏览器仍可打开

#### Scenario: 已有运行时与其他平台
- **WHEN** 后台目标已是当前 Electron 运行时、宿主不处于 Windows Electron，或调用的是交互式终端分配
- **THEN** 不增加该后台 bootstrap，保留原有参数规范化、macOS 启动行为及嵌入式 ConPTY 输入输出和尺寸控制

### Requirement: 隐藏启动保留原生结果和 SDK 进程范围
隐藏启动 MUST 保留调用方的参数、工作目录、标准输入输出字节流及收集接口，并继续由宿主 SDK 的同一个 Job 管理 bootstrap 与后代。普通后台管道转发 SHALL 保留输入 EOF 与流背压，不进行文本解码重编码或混合 stdout/stderr。原生退出码、信号或启动失败 SHALL 经独立的有界控制通道回传，不混入 CLI 标准输出或错误流。原生父进程退出与整个进程范围退出 MUST 分开确认；取消、终止和范围退出确认继续交给 SDK，bootstrap 自己退出成功不得冒充原生 CLI 成功，清理未确认不得报告停止成功。

#### Scenario: 字节流、输入结束与慢速消费者
- **WHEN** 后台 CLI 接收二进制或大块输入、等待输入 EOF，或输出端暂时不能继续接收
- **THEN** 转发保留字节和输入结束语义，并遵守流背压；原生输入提前关闭时停止上游输入，不把预期的 EPIPE 当作 CLI 失败

#### Scenario: 原生父进程退出但后代仍持有输出
- **WHEN** 原生父进程已经退出，但其受管后代尚未关闭 stdout 或 stderr
- **THEN** 调用方可获得父进程的真实退出回执，剩余输出继续转发；整个范围的退出与清理仍由 SDK 确认，不因收到回执而宣告全部进程已停止

#### Scenario: 原生非零退出或启动失败
- **WHEN** 真实 CLI 返回非零退出码、Windows 原生崩溃退出值或已知启动错误
- **THEN** 调用方获得对应原生结果或安全的启动错误分类，标准输出和错误流保持原字节，不因 bootstrap 退出零而误判成功

#### Scenario: 取消与无效控制回执
- **WHEN** 调用被取消、终止，或控制回执缺失、格式错误、超出大小限制
- **THEN** 取消保留 SDK 的实际结果和退出确认；无效回执触发 SDK 清理并返回错误，不释放独立于 SDK 的失管后代，也不伪造原生成功

#### Scenario: 控制通道和环境隔离
- **WHEN** 调用方已占用控制通道，或原生目标原先设置或删除了 `ELECTRON_RUN_AS_NODE`
- **THEN** 已占用通道的请求明确拒绝，不覆盖调用方协议或回退为可见启动；bootstrap 的临时 Node 模式只用于自身，真实目标恢复原先环境语义，且不继承 bootstrap 专用控制通道

### Requirement: ZCode 管理式入口跨平台一致
ZCode 可执行入口选择 SHALL 在 macOS 与 Windows 使用同一优先级：用户显式配置的入口、已部署的插件管理式完整 CLI、该平台原生默认入口。管理式入口 MUST 继续经过现有可读性与原生启动校验；其部署不得覆盖 ZCode Desktop、账号凭据或项目模型偏好。

#### Scenario: 显式配置覆盖管理式运行时
- **WHEN** 用户指定了自定义 ZCode 可执行入口，即使存在已部署的管理式完整 CLI
- **THEN** 两平台均使用显式入口，并按其真实能力处理登录，不静默切换到另一安装

#### Scenario: 管理式入口存在或缺失
- **WHEN** 未显式配置 ZCode 入口
- **THEN** 已部署的管理式入口在两平台均优先于原生默认安装；管理式入口不存在时才继续平台默认查找，存在但无效时报告校验失败，不把它伪装成可用安装

### Requirement: Grok 只读任务使用私有配置中的拒绝规则
只读 Grok 运行 SHALL 在本次私有 `GROK_HOME/config.toml` 中以 `[permission] deny` 阻止 `Edit`、`Write`、`Bash(mkdir)` 与 `Bash(touch)`，MUST NOT 依赖 Grok 配置不支持的 `permission_mode = "dontAsk"`，也 MUST NOT 修改用户或项目的 Grok/Claude 配置。仅当 DSH 工具桥已就绪且绑定 Grok 时 SHALL 追加 `allow = ["MCPTool(dsh_worker_tools__*)"]`。可写运行的私有配置 MUST NOT 含这些规则。

#### Scenario: 只读任务尝试写入
- **WHEN** 只读 Grok 尝试写文件、`touch` 或 `mkdir`
- **THEN** Grok 按 deny 规则直接拒绝，不发审批请求，项目中不产生文件或目录

#### Scenario: DSH 工具桥
- **WHEN** 只读运行的 DSH 工具桥已就绪且绑定 Grok
- **THEN** 私有配置仅额外允许 `MCPTool(dsh_worker_tools__*)`；工具桥未就绪、绑定其他 CLI 或任务可写时不加该规则

#### Scenario: 可写任务
- **WHEN** 同一 Worker 之后以可写模式运行
- **THEN** 私有配置恢复为不含只读规则的基础配置

### Requirement: Grok 原生 ACP 只读启动与兜底
原生 ACP 启动参数中只读 MUST NOT 依赖 `agent` 之前的全局权限参数，权限参数只出现一次或不出现。ACP 完全不列出模式时，插件 SHALL 以私有配置为准运行只读任务；ACP 列出模式时 MUST 由 ACP 提供并确认 `plan`。其他 CLI 在 ACP 未提供所需模式时 MUST 继续失败关闭。只读任务中插件 MUST 拒绝非工具桥的额外权限请求。

#### Scenario: ACP 不列出模式
- **WHEN** Grok 1.0.62 的 ACP 会话不返回 `modes`，用户派遣只读 Grok 任务
- **THEN** 启动参数不含全局权限参数，不请求 ACP 切换模式，任务正常发送提示

#### Scenario: 其他需审批的调用
- **WHEN** 只读 Grok 发起 deny 规则未覆盖、需审批的调用
- **THEN** 插件拒绝该审批请求

#### Scenario: ACP 列出模式
- **WHEN** ACP 返回可用模式列表
- **THEN** 只读任务必须在列表中找到并切换到 `plan`，否则在发送提示前失败

#### Scenario: 其他 CLI
- **WHEN** 其他 ACP CLI 未列出所需模式
- **THEN** 任务在发送提示前失败，不推定模式

### Requirement: Windows 系统代理继承
在 Windows 上，继承环境与启动参数都没有设置 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`（任意大小写，含显式删除）时，插件 SHALL 读取当前用户「Internet 选项」中已开启的单一 HTTP 代理，并给它启动的每个 CLI 进程和账号终端补 `HTTP_PROXY`、`HTTPS_PROXY` 与 `NO_PROXY`；`NO_PROXY` MUST 合并继承值、回环地址（`localhost`、`127.0.0.1`、`::1`）及能以主机或前导通配域名表达的代理例外，且只保留一种大小写拼写。Host 自身及其子进程（如 Pi/OMP 桥）对 CLI 账号与模型服务的 HTTPS 只读查询 SHALL 按 CLI 实际得到的代理（系统代理或用户导出的 http/https 代理变量）与例外建立隧道。读数 SHALL 在 15 秒后失效重读；读取失败、代理关闭、仅有 SOCKS 或地址无法识别时 MUST 视为没有代理，MUST NOT 沿用旧读数。macOS 与其他平台 MUST NOT 读取或注入系统代理。

#### Scenario: 只在「Internet 选项」开代理
- **WHEN** Windows 用户在「Internet 选项」开启 `127.0.0.1:<端口>` 代理，环境中没有任何代理变量，用户打开 Grok 登录窗口
- **THEN** Grok 进程收到指向该代理的 `HTTP_PROXY`/`HTTPS_PROXY`，`NO_PROXY` 包含回环地址，登录页面地址正常出现

#### Scenario: 已有代理设置
- **WHEN** 继承环境或某个 CLI 的启动参数已设置（或显式删除）任一代理变量
- **THEN** 插件不补、不改任何代理变量

#### Scenario: 关闭代理
- **WHEN** 用户关闭「Internet 选项」代理超过 15 秒后启动新的 CLI
- **THEN** 新进程不带插件补充的代理变量；已经运行的进程不受影响

#### Scenario: Host 查询模型目录
- **WHEN** Windows 上 Codex 已登录、系统代理开启且未被例外排除，设置页刷新模型
- **THEN** Host 对账号模型目录的 HTTPS 只读请求经该代理隧道发出，不因直连超时显示「无可用模型」
