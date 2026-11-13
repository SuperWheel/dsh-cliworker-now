# Spec Delta

## Purpose

规定开发者通过已授权的 SSH 连接，在个人 Windows 原生测试机使用隔离目录验证 Mac 构建产物和平台行为，并取回可核查的测试报告，区分源码测试、实际进程证据、模型生成与界面验收。

## ADDED Requirements

### Requirement: 显式连接与私有配置
远程测试入口 SHALL 要求显式指定 Windows 地址、用户、密钥和已验证的主机记录，强制密钥登录及主机校验；连接配置和运行证据 MUST 留在 Git 忽略的私有目录，不传送凭据、用户日志或 Mac node_modules。

#### Scenario: 配置完整
- **WHEN** 开发者提供有效连接配置并运行开发命令
- **THEN** 只连接指定机器并使用已固定的主机记录，不修改通用 SSH 配置或采用密码回退

#### Scenario: 校验失败
- **WHEN** 连接配置缺失、路径越界或 SSH 主机校验失败
- **THEN** 非零退出并保留原因，不执行远程测试或放宽验证

### Requirement: Windows 隔离环境
测试入口 SHALL 在专用标记目录内安装项目固定版本的工具和冻结锁文件依赖，每次运行使用独立目录；子进程账号目录、Harness 配置和日志 SHALL 隔离，保留用户项目、已安装 CLI、账号和 Desktop 配置。

#### Scenario: 首次准备
- **WHEN** Windows 具有受支持的 Node 而缺少项目 pnpm
- **THEN** 在专用工具目录准备 package.json 声明的 pnpm，使用 Windows 本机依赖，不全局替换工具或复用 Mac 的依赖目录

#### Scenario: 不属于工具的目录
- **WHEN** 目标专用目录已存在却没有有效归属标记
- **THEN** 拒绝写入，不清理或覆盖其中内容

### Requirement: Mac 产物的 Windows 验收
入口 SHALL 先在 Mac 构建隔离 preview，传送允许列表源码快照及该构建包，在 Windows 执行类型检查、现有平台定向测试及该包的运行入口加载；MUST 验证包传输哈希，不以 Windows 重新构建替代 Mac 产物验收。

#### Scenario: 验证成功
- **WHEN** Windows 测试、实际进程检查和同一构建包加载均成功
- **THEN** 报告包含 Mac 包与 Windows 接收包相同的哈希、Windows 架构与运行时版本、测试数量及各阶段退出状态

#### Scenario: 部分阶段失败
- **WHEN** 类型检查、安装、测试、传输或包加载失败
- **THEN** 保存并尽可能回传已产生的日志与阶段状态，整体非零退出，不把缺失或跳过项报告为成功

### Requirement: 报告范围与生命周期
入口 SHALL 返回测试报告和实际产物，记录源码快照、阶段及失败边界；默认 MUST 不登录 CLI、不读取生产凭据或发送模型任务。源码夹具、实际 Windows 进程、官方 CLI 启动、模型生成和 Desktop 验收 SHALL 区分；运行锁及进程须有退出和中断清理。

#### Scenario: 离线验收
- **WHEN** 开发者运行默认远程测试
- **THEN** 模型请求数为零，报告明确未做真实模型或 Desktop 验收，保留运行日志供复查

#### Scenario: 重复或中断运行
- **WHEN** 同一专用环境已有运行锁，或本次执行被中断
- **THEN** 不并发修改共享依赖；中断停止自身进程并记录清理结果，无法确认清理时保留锁和失败状态
