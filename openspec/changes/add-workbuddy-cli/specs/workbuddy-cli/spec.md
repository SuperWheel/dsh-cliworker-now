## ADDED Requirements

### Requirement: 两个独立的试验性入口
插件 SHALL 以 `workbuddycn`「WorkBuddy」与 `workbuddy`「WorkBuddy AI」两个 CliId 接入 WorkBuddy 桌面应用内置的 CLI，分别管理路径、配置根、项目偏好、模型目录、会话、清理保护与 transport（`workbuddycn-acp-v1`、`workbuddy-acp-v1`）。连接页与 Worker 卡片 MUST 标注“试验性：依赖 WorkBuddy 桌面端非公开接口”。

#### Scenario: 明确指定版本
- **WHEN** 用户明确选择 WorkBuddy 国内版或 WorkBuddy AI
- **THEN** 只使用该版本的应用与项目偏好，不回退另一版本，新 Worker 绑定该版本的 transport

#### Scenario: 泛称且两版都安装
- **WHEN** 用户泛称“WorkBuddy”派遣，且两版都已安装
- **THEN** 在宿主原生询问框中让用户选择版本，取消或无有效选择时不启动

#### Scenario: 泛称且只装一版或安装未知
- **WHEN** 用户泛称“WorkBuddy”，只检测到一版，或安装检测出错
- **THEN** 只装一版时使用该版；检测出错时保留未知状态，不静默改版

### Requirement: 只认应用包内的内置 CLI
插件 SHALL 只从 WorkBuddy 应用包内解析运行时与内置 CLI，并核对包名 `@genie/agent-cli`、入口 `dist/codebuddy-lite-wb.mjs` 与 `product.json` 的 endpoint 属于本版本。内置 CLI 不可用时 MUST 明确报错，不得回退到 PATH 上的 CodeBuddy 或另一版本。

#### Scenario: 应用未安装或入口缺失
- **WHEN** 候选位置与手动路径都找不到符合身份的应用
- **THEN** 连接页显示未安装及原因，不启动任务

#### Scenario: 程序属于另一版本或更新后身份变化
- **WHEN** 解析到的应用或 runner 启动前重读的 product 身份属于另一版本，或包名、入口不符
- **THEN** 拒绝任务并显示 WorkBuddy 暂不可用及原因，保留已有 Worker 记录

### Requirement: 密钥引导
插件 SHALL 用 WorkBuddy 自带运行时执行插件自写的引导助手，读取本机凭据 at-rest 密钥并只经一次性私有 socket 交给本次启动的 CLI。密钥 MUST NOT 进入 runner、Host、日志、事件、Worker 消息、持久化数据、错误信息或测试快照；私有目录 0700。引导成功或失败都 MUST 关闭并删除 socket 与目录。

#### Scenario: 引导成功
- **WHEN** 助手读到有效密钥且 CLI 回执 `ok` 与 `fields` 策略，CLI 随后上报带正确 token、会话与 pid 的就绪
- **THEN** 插件确认就绪后才发送 `initialize`，助手退出，一次性 socket 已删除

#### Scenario: 私有绑定读取失败或格式不符
- **WHEN** 私有绑定不可用、返回格式不符或密钥无效
- **THEN** 显示 WorkBuddy 暂不可用及固定原因类别，结束本次启动的 CLI 与助手，删除一次性 socket，错误中不含密钥或绑定返回值

#### Scenario: 引导或就绪超时
- **WHEN** CLI 未在时限内接受引导或上报就绪，或就绪报文的 token、会话、pid 不符
- **THEN** 停止本次 CLI，确认进程范围退出后报告失败原因

#### Scenario: 网关横幅
- **WHEN** CLI 在就绪前向 stdout 打印非 JSON 的网关横幅
- **THEN** 横幅被丢弃，不写入日志、事件或 Worker 消息

### Requirement: 子进程环境隔离
插件 SHALL 为内置 CLI 设置本版本的配置根（`CODEBUDDY_CONFIG_DIR` 与 `WORKBUDDY_CONFIG_DIR`），关闭自动更新与定时任务，并 MUST 从子进程环境中移除代理变量、继承的引导变量与 CodeBuddy 凭据变量；插件 MUST NOT 修改用户系统代理。

#### Scenario: 宿主环境带代理变量
- **WHEN** Host 环境含 `HTTPS_PROXY` 等代理变量
- **THEN** 内置 CLI 的子进程环境中没有这些变量，用户系统代理设置保持不变

#### Scenario: 配置根
- **WHEN** 启动国内版内置 CLI
- **THEN** CLI 使用 `~/.workbuddy`（取自 product.json 的 dataFolderName），不写入 `~/.codebuddy`

### Requirement: 原生会话、权限与停止
WorkBuddy SHALL 通过内置 CLI 的 ACP 运行任务：会话 ID 来自 `session/new`，续聊只用已确认的 ID 经 `session/load` 恢复；三档映射为 `default`、`auto`、`bypassPermissions`，规划映射 `plan`，未知模式与未知请求一律拒绝。停止 MUST 只结束插件启动的进程，在进程范围退出后才报告成功，不关闭用户的 WorkBuddy 桌面端。

#### Scenario: 拒绝审批结束整轮
- **WHEN** 用户拒绝审批，CLI 随后以 `cancelled` 结束本轮
- **THEN** Worker 显示“因拒绝审批而结束”而不是“已取消”，被拒操作未执行，用户可续聊

#### Scenario: 审批请求只带 rawInput
- **WHEN** 审批请求的 `toolCall` 没有标题，但此前同一 `toolCallId` 的 `tool_call` 事件有标题
- **THEN** 审批卡片使用此前事件的标题与类别

#### Scenario: 恢复失败
- **WHEN** 续聊时 `session/load` 失败
- **THEN** 报错，不新建会话、不换版本

#### Scenario: 用户停止
- **WHEN** 用户停止运行中的 WorkBuddy Worker
- **THEN** 插件发送原生取消并结束 CLI 与助手进程，确认退出后报告停止成功，WorkBuddy 桌面端不受影响

### Requirement: 模型目录与账号状态
模型 SHALL 来自经引导后 `session/new` 返回的账号目录，强度 SHALL 来自 `thought_level` 配置项；目录与状态查询 MUST 只发 `initialize`、`session/new` 与切换模型的 `session/set_config_option`，不发 prompt，并确认进程范围退出。插件 SHALL 提供桌面管理指引，但 MUST 不提供 CLI 登录/退出或伪终端；登录、退出、换号在对应桌面端完成，不新增凭据文件读取。元数据成功只确认当前已登录，只有可区分的认证缺失可确认未登录；通用认证错误 MUST 保持 unknown，不推断退出或同站点换号。

#### Scenario: 认证拒绝未能区分缺失
- **WHEN** `session/new` 返回通用认证错误，无法核实认证缺失
- **THEN** 账号区提示“请在桌面端检查登录状态”，保留桌面管理指引，不报告已退出或启动任务

#### Scenario: 桌面管理入口
- **WHEN** 用户打开对应 WorkBuddy 的桌面管理指引
- **THEN** 使用独立无 PTY 会话，仅打开重新核实的本版应用；有限串行观察与手动刷新共享每周期元数据，关闭取消查询并确认清理，不关闭桌面应用；旧 Host 未声明能力时只显示手动指引

#### Scenario: 选择强度
- **WHEN** 用户为 WorkBuddy 选择强度
- **THEN** 只提供所选模型切换后 `thought_level` 实际公开且插件支持的取值；选择默认时不改动该配置项

#### Scenario: 强度随模型不同
- **WHEN** 两个模型的 `thought_level` 取值不同，或用户切换到不支持原强度的模型
- **THEN** 每个模型只列出自己的强度，不共用一组；原强度不在新模型列表中时要求重新选择或使用默认，不沿用

### Requirement: 验证边界
文档与 tasks.md SHALL 区分模拟测试、本机元数据探测、Desktop 验收与真实模型任务；国际版、Windows、真实任务与审批行为未执行时 MUST 记为未验证，不得虚勾。

#### Scenario: 模拟夹具
- **WHEN** 测试使用模拟密钥或模拟 CLI
- **THEN** 用例名或文件名标明“模拟”，快照与断言中不出现真实密钥
