# Spec Delta

## ADDED Requirements

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
