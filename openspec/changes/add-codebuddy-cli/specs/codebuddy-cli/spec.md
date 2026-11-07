## ADDED Requirements

### Requirement: CodeBuddy 单入口身份与路由
插件 SHALL 以一个 CliId `codebuddy`（名称「CodeBuddy Code」，短名 `codebuddy`）接入腾讯 CodeBuddy Code。中国站、国际站、企业域与 iOA 是同一 CLI 的登录站点，MUST NOT 拆成多个 CLI 入口，也 MUST NOT 为另一站点另设认证目录。新会话绑定 transport `codebuddy-acp-v1`；该标记缺失、为 `legacy` 或不是 `codebuddy-acp-v1` 时 MUST 拒绝续聊，不改用其他 CLI 的 transport。中英文别名（如 codebuddy、cbc、CodeBuddy Code、腾讯 CodeBuddy、腾讯云代码助手）SHALL 路由到该入口。

#### Scenario: 用户泛称 CodeBuddy
- **WHEN** 用户说“让 codebuddy 处理”或“用腾讯 CodeBuddy”
- **THEN** 路由到 CodeBuddy Code，选型卡片显示「CodeBuddy Code」，不询问站点

#### Scenario: 原生身份不符
- **WHEN** 配置的可执行文件经 ACP 初始化后不是 CodeBuddy（回执缺少 CodeBuddy 的 `authMethods` 或协议版本不是 1）
- **THEN** 拒绝任务并提示检查 CLI 路径，不尝试其他入口

### Requirement: CodeBuddy 可执行文件发现与启动
插件 SHALL 按手动路径、部署配置、自动记录的顺序解析 `codebuddyExecutable`（默认 `codebuddy`），macOS 补查 Homebrew 前缀与 `~/.local/bin`，Windows 补查 npm 全局入口。npm shim SHALL 归一化为核对过包名 `@tencent-ai/codebuddy-code` 的 Node 入口。所有由插件启动的 CodeBuddy 进程（运行、目录查询、账号终端）MUST 设置 `DISABLE_AUTOUPDATER=1`，不得触发真实安装的自动更新。参数 MUST 以数组传递。

#### Scenario: Desktop 不加载 shell 配置
- **WHEN** Desktop 的 PATH 不含 `/opt/homebrew/bin`，CodeBuddy 安装在该目录
- **THEN** 自动发现找到 `codebuddy`，并核对其为官方包的入口

#### Scenario: 未安装
- **WHEN** 所有候选位置都没有 CodeBuddy
- **THEN** 设置页显示未找到并提示配置 `codebuddyExecutable`，不启动任务

### Requirement: CodeBuddy 账号与站点
插件 SHALL 只依据认证文件 `CodeBuddyExtension/Data/Public/auth/*.info` 与同名 `.logged-out` 标记是否存在判断登录状态，MUST NOT 调用会返回访问令牌的 `_codebuddy.ai/getUserInfo`。插件 MUST NOT 自行设置 `CODEBUDDY_INTERNET_ENVIRONMENT` 或替用户选择站点。CodeBuddy 没有登录或退出子命令，账号窗口 SHALL 打开原生交互终端并提示使用 `/login`、`/logout`。

#### Scenario: 未登录或已退出
- **WHEN** 认证文件不存在，或存在 `.logged-out` 标记
- **THEN** 账号区显示未登录，派遣与续聊被拒绝并提示在 CodeBuddy 原生终端使用 `/login`

#### Scenario: 原生会话报告需要认证
- **WHEN** 目录查询或运行中 `session/new` 返回 `Authentication required`
- **THEN** 账号显示为认证失效，不发布目录，任务不启动

### Requirement: CodeBuddy 站点只读识别
站点 SHALL 按以下优先级取第一项可用来源：`~/.codebuddy/settings.json` 的 `env.CODEBUDDY_INTERNET_ENVIRONMENT`（只在内存中取该键）、进程环境中的同名变量、认证文件中的 `auth.domain`（2026-11-07 用户批准“允许只读站点”）。读取认证文件时 MUST 只在内存中解析并只取出 `auth.domain`，令牌等字段 MUST NOT 读出或传递；域名按已安装 CLI 的 `product.json` 域名表映射为中国站、国际站、企业域或 iOA，匹配不到时不猜。域名与文件内容 MUST NOT 写入日志、事件、持久化或测试快照；无法判断时显示“站点未公开”，错误信息 MUST NOT 带文件内容。

#### Scenario: 已登录且未声明站点
- **WHEN** 认证文件存在、没有退出标记、`auth.domain` 为 `www.codebuddy.cn`，环境与 `settings.json` 都没有声明站点
- **THEN** 账号区显示已登录、中国站，任务可正常运行

#### Scenario: 显式声明优先
- **WHEN** `settings.json` 或环境中声明 `CODEBUDDY_INTERNET_ENVIRONMENT=ioa`，认证文件域名属于国际站
- **THEN** 账号区显示 iOA，不读取认证文件

#### Scenario: 认证文件无法解析
- **WHEN** 认证文件不是合法 JSON，或没有 `auth.domain`，或域名不在域名表中
- **THEN** 账号区显示“站点未公开”，错误与日志不含文件内容

### Requirement: 站点或账号切换后目录失效
CodeBuddy 的账号绑定 SHALL 由站点 ID（不含域名原值）与当前原生模型目录摘要（排序后的模型 ID 与积分倍率）组成。绑定变化时，SHALL 使已缓存目录、项目默认设定与 Worker 偏好校验失效，新任务与续聊 MUST 按当前目录重新确认模型。

#### Scenario: 用户在原生终端切换站点
- **WHEN** 用户从中国站改为国际站重新登录，新站点的模型目录与原目录不同
- **THEN** 设置页刷新后旧模型不可选；已有 Worker 续聊前提示重新确认模型，不按旧目录运行

#### Scenario: 两个站点目录完全相同
- **WHEN** 切换站点后模型 ID 与积分倍率都不变
- **THEN** 绑定不变；运行时仍由 ACP 回读确认所选模型与强度，回读不符时拒绝运行

### Requirement: CodeBuddy 模型目录与强度
模型目录 SHALL 来自 CodeBuddy ACP `session/new` 的 `models.availableModels`。目录查询 MUST 以 `--acp --no-session-persistence` 在插件私有临时目录中运行，只发送 `initialize` 与 `session/new`，不发 prompt，有时限，结束后确认进程退出。每个模型的强度 SHALL 为“默认”加该模型 `_meta.effortOptions` 中的取值，MUST NOT 使用 `--help` 的通用强度列表。“默认”对应原生 `thought_level` 的 `enabled`。积分倍率为 `x0.00` 时标为免费，大于零时标为付费，缺失时为未知。同名模型 SHALL 以模型 ID 区分显示名。

#### Scenario: 切换模型后强度变化
- **WHEN** 用户把模型从 `hy3`（low/medium/high/xhigh）改为 `hy4free`（只有 high）且原强度为 medium
- **THEN** 选型界面只提供默认与 High，并要求重新选择强度

#### Scenario: 运行时选择强度
- **WHEN** 任务以模型 `hy3`、强度 xhigh 启动
- **THEN** runner 经 `session/set_config_option` 设置 `model` 为 `hy3`、`thought_level` 为 `xhigh`，回读一致后才发送 prompt

#### Scenario: 默认强度续聊
- **WHEN** 续聊的会话此前设置过 `thought_level`，本次偏好强度为默认
- **THEN** runner 显式设置 `thought_level` 为 `enabled`，不沿用上一轮的强度

### Requirement: CodeBuddy 权限三档与规划模式
CodeBuddy SHALL 以 ACP 配置项 `mode` 设置原生权限模式：询问 → `default`，自动审批 → `auto`，完全权限 → `bypassPermissions`，规划模式 → `plan`。`fullAccess`、`dontAsk`、`acceptEdits` MUST NOT 映射到任何档位。所选模式未被 ACP 列出或回读不一致时，按 worker-permission-levels 降级（完全权限 → 自动审批 → 询问）并在时间线写明实际模式；询问也不可用时拒绝启动。规划模式不可用时 MUST 拒绝规划任务，不降级为其他模式。自动审批档的说明 SHALL 写明 CodeBuddy 原生审查失败只拦截该操作、不会转为询问。

#### Scenario: 询问档执行命令
- **WHEN** Worker 以询问档运行，CodeBuddy 请求执行 `echo probe > cmd.txt`
- **THEN** 主页面或 Worker 窗口出现审批卡片，用户拒绝时文件不产生

#### Scenario: 规划模式
- **WHEN** 用户在 CodeBuddy Worker 开启规划
- **THEN** runner 设置并确认 `mode` 为 `plan` 后才发送 prompt

#### Scenario: 运行中模式被改
- **WHEN** 本轮运行中 CodeBuddy 发出 `current_mode_update`，模式与所选不一致
- **THEN** runner 取消本轮并报告实际权限与所选模式不匹配

### Requirement: CodeBuddy 原生会话、续聊与停止
runner SHALL 通过 ACP 新建会话并以 `session/new` 返回的 ID 作为原生会话 ID；续聊 MUST 用 `session/load` 恢复同一 ID，恢复失败时报错，不新建会话、不换 CLI。恢复时 CodeBuddy 重放的历史 MUST NOT 进入本轮正文。停止 SHALL 先发 `session/cancel`，再由 Host 关闭进程并确认进程范围退出后才报告停止成功；CodeBuddy 关闭 stdin 后不会自行退出，Host MUST 主动结束进程。正文、公开思考与工具（实际 ID、输入、输出、终态）分开投影；缺少工具终态时 MUST NOT 报告成功。

#### Scenario: 同一 Worker 续聊
- **WHEN** 用户在已完成的 CodeBuddy Worker 中继续提问
- **THEN** runner 加载原会话 ID，重放内容不重复显示，回复能引用上一轮内容

#### Scenario: 会话已不存在
- **WHEN** `session/load` 返回错误
- **THEN** 本轮失败并显示原因，不新建替代会话

#### Scenario: 运行中停止
- **WHEN** 用户停止运行中的 CodeBuddy Worker
- **THEN** runner 发送 `session/cancel`，CodeBuddy 以 `cancelled`（`codebuddy.ai/outcome: CANCELLED`）结束本轮，Host 确认进程退出后显示已停止

### Requirement: CodeBuddy 审批转交与拒绝结束
CodeBuddy 的 `session/request_permission` SHALL 按 native-permission-relay 转交 DSH。审批卡片的标题、类型与路径 SHALL 取自同一 `toolCallId` 此前的 `tool_call` 事件。只有 `allow_always`（实测不写入设置文件，为会话级）可映射为「本会话始终允许」。用户、预设或规划模式拒绝后，CodeBuddy 以 `stopReason: cancelled` 结束本轮、用户未停止且没有其他失败时，Worker SHALL 以 SUCCESS 结束并显示“因拒绝审批而结束”，被拒工具标为已拒绝，MUST NOT 显示为用户停止或已取消；用户可以在同一 Worker 续聊。未知的 CodeBuddy 私有请求（如 `_codebuddy.ai/requestSensitiveApproval`、`_codebuddy.ai/question`）MUST 以“客户端不支持”拒绝。

#### Scenario: 允许写文件
- **WHEN** CodeBuddy 请求写 `notes.txt`，用户允许一次
- **THEN** 回复原生 `allow`，文件按内容写入，工具终态为完成

#### Scenario: 拒绝命令后整轮结束
- **WHEN** CodeBuddy 请求执行命令，用户拒绝
- **THEN** 命令不执行；Worker 状态为 SUCCESS，结果说明为“因拒绝审批而结束”，被拒工具显示已拒绝；之后续聊正常加载原会话

#### Scenario: 拒绝与停止区分
- **WHEN** 用户主动停止，CodeBuddy 以 `cancelled`（outcome `CANCELLED`）结束
- **THEN** 按停止处理，不显示“因拒绝审批而结束”

### Requirement: CodeBuddy 原生功能、工具桥与遥测
子 Agent、记忆（`CODEBUDDY.md` 或 `AGENTS.md`）、skills 与 hooks SHALL 跟随用户原生设置；`sandbox` 与 `multitask` 配置项保持用户原生值，插件不改写。DSH 工具桥 SHALL 通过 ACP `mcpServers` 注入，但在真实核验前只声明传输可用、执行未核验。遥测 SHALL 只采用本会话 `usage_update` 的 `used`/`size` 作为上下文统计；没有每轮积分回执时积分保持未公开，MUST NOT 以默认零代替。私有阶段事件（`codebuddy.ai/agentPhase`）MUST NOT 被投影为伪造的进度。

#### Scenario: 上下文统计
- **WHEN** CodeBuddy 在本会话发出 `usage_update`（used 23742，size 960000）
- **THEN** 遥测显示原生上下文统计 23742 / 960000

#### Scenario: 工具桥未核验
- **WHEN** 当前运行建立了 DSH 工具桥
- **THEN** 能力显示传输可配置、执行尚未核验，不自动放行桥工具的审批

### Requirement: CodeBuddy 图标、设置页与验证边界
Client SHALL 本地打包可追溯来源的 CodeBuddy 官方图标，复用既有尺寸、明暗主题与设置页布局。文档 MUST 分别记录模拟、离线协议探测、真实模型、Desktop 与平台验证范围；国际站、企业域、iOA 与 Windows 未执行时保持未验证。

#### Scenario: 打开连接页
- **WHEN** 用户打开 CodeBuddy Code 连接页
- **THEN** 账号区显示登录状态与站点（或站点未公开），文字层级、留白与控件与其他 CLI 页一致

#### Scenario: 只完成部分验收
- **WHEN** 只完成了中国站的真实任务
- **THEN** tasks.md 记录中国站证据，国际站、企业域、iOA 与 Windows 标为未验证
