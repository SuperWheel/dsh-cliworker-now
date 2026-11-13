# Spec Delta

## ADDED Requirements

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
