## ADDED Requirements

### Requirement: 豆包 CLI 身份与发现
插件 SHALL 以 CliId `doubao`、名称「豆包 CLI」、transport `doubao-text-v1` 注册豆包 CLI，并登记别名「豆包」「doubao」。自动发现 SHALL 把 npm 启动器 `@bytedance/doubao-cli` 映射到其 appRoot 下的 `current/doubao` 程序，以 `--version` 输出 `doubao <版本>` 核对身份，MUST NOT 执行启动器或触发更新；每个豆包子进程 MUST 设置 `DOUBAO_CLI_NO_UPDATE_CHECK=1`。豆包 MUST NOT 加入历史执行路径 `workerArguments`。

#### Scenario: 发现 npm 启动器
- **WHEN** PATH 中的 `doubao` 指向 `@bytedance/doubao-cli/scripts/run.cjs`
- **THEN** 插件使用 `<appRoot>/current/doubao`，以 `--version` 核对后保存，不运行启动器

#### Scenario: 同名程序
- **WHEN** 找到的 `doubao` 的 `--version` 输出不是 `doubao <版本>`
- **THEN** 拒绝该入口并提示配置 `doubaoExecutable`

#### Scenario: 泛称豆包
- **WHEN** 用户说“让豆包做”且豆包 CLI 已安装
- **THEN** 路由到 `doubao` 入口；用户说的是在其他 CLI 中使用豆包模型时不改路由

### Requirement: 纯文本受限执行
豆包 Worker SHALL 每轮启动一个 `-p` 一次性进程，`-p <提示词>` 作为最后两个参数。本轮结束时 SHALL 把标准输出原文作为一条回复显示，并视为不可信文本。插件 MUST NOT 伪造工具事件、进度、推理或审批请求。连接页与 Worker 卡片 SHALL 标注「纯文本受限模式」及缺失能力。CLI 在完成前没有输出，空闲时限 SHALL 不适用，总时限仍生效。

#### Scenario: 成功的一轮
- **WHEN** 豆包以退出码 0 结束，stderr 有会话行，stdout 有正文
- **THEN** Worker 显示该正文为本轮回复，轮次成功，期间没有工具或进度条目

#### Scenario: 长时间无输出
- **WHEN** 豆包运行超过空闲时限仍无输出，但未到总时限
- **THEN** 不因空闲时限停止；到达总时限时停止并说明原因

#### Scenario: 界面标注
- **WHEN** 用户打开豆包的 CLI 连接页或查看豆包 Worker 卡片
- **THEN** 看到「纯文本受限模式」及无工具过程、无审批转交、无规划模式等说明

### Requirement: 会话 ID 与续聊
会话 ID SHALL 只取自 stderr 中 `{"type":"session","session_id":…}` 行，且须匹配 `^[A-Za-z0-9_-]{1,128}$`。取不到时本轮 MUST 报错且不提供续聊，MUST NOT 猜测或从其他输出推断。续聊 SHALL 使用 `--resume <已确认 ID>`；回执 ID 与请求不一致时 MUST 失败，MUST NOT 新建会话、换 CLI 或改用其他会话。

#### Scenario: 没有会话行
- **WHEN** 豆包以退出码 0 结束但 stderr 没有合法会话行
- **THEN** 正文照常显示，本轮报告“豆包 CLI 未报告会话 ID，无法续聊”，该 Worker 不保存会话 ID

#### Scenario: 续聊回执不一致
- **WHEN** 以 `--resume A` 续聊，而 stderr 会话行给出 B
- **THEN** 本轮失败，Worker 仍绑定 A，不绑定 B

### Requirement: 豆包权限映射
豆包 SHALL 只提供「自动审批」（`--permission-mode always_allow`）与「完全权限」（`--dangerously-bypass-approvals-and-sandbox`），MUST NOT 提供第一项，MUST NOT 使用 `ask_always` 或 `ask_risky`。豆包 SHALL 不支持规划模式。

#### Scenario: 自动审批档
- **WHEN** 豆包 Worker 档位为自动审批
- **THEN** argv 含 `--permission-mode always_allow`，不含 `--dangerously-bypass-approvals-and-sandbox`

#### Scenario: 完全权限档
- **WHEN** 豆包 Worker 档位为完全权限
- **THEN** argv 含 `--dangerously-bypass-approvals-and-sandbox`，不含 `--permission-mode`

#### Scenario: 规划任务
- **WHEN** 派遣豆包执行规划任务，或用户在豆包 Worker 输入 `/plan`
- **THEN** 拒绝并提示当前 CLI 不支持规划模式

### Requirement: 豆包停止确认
停止 SHALL 先向 CLI 发 SIGINT。只有 CLI 在强制结束前自行退出且报告取消，或被强制结束后本次 CLI 启动的共享服务进程也在停止宽限内退出，插件才 SHALL 报告停止成功；否则 MUST 报告停止未经豆包确认。插件 MUST NOT 终止豆包共享服务。

#### Scenario: CLI 自行取消
- **WHEN** 用户停止，豆包收到 SIGINT 后写出 `Cancelled.` 并退出
- **THEN** 停止成功

#### Scenario: 强制结束后服务仍在
- **WHEN** 豆包未在宽限内退出被强制结束，且它启动的共享服务仍在运行
- **THEN** 本轮报告“停止未经豆包确认”，不终止共享服务

### Requirement: 豆包账号与订阅提示
账号状态 SHALL 通过有界、无 prompt 的 `auth status` 查询，并区分已登录、未登录、已登录但不是团队或企业订阅账号、正在切换账号与未知。登录 SHALL 由用户在原生终端运行 `doubao login` 扫码完成，插件 MUST NOT 代登录。来源绑定 MUST 只用登录状态文件的元数据，MUST NOT 读取凭据内容。未登录或订阅不足时 MUST 拒绝任务且不发布目录。

#### Scenario: 订阅不足
- **WHEN** `auth status` 或任务返回 `login_required` 且消息说明需要企业账号
- **THEN** 提示当前账号不是团队或企业订阅账号，豆包 CLI 仅对这类账号开放，并引导重新登录

#### Scenario: 未登录
- **WHEN** `auth status` 返回 `login_required` 且不涉及企业账号
- **THEN** 显示未登录并提供原生终端登录

### Requirement: 豆包模型目录
豆包目录 SHALL 只包含原生默认 Auto（执行 ID `default`，强度仅 `default`），启动时 MUST NOT 传 `--model` 或 `--effort`。插件 MUST NOT 通过发送 `-p` 探测模型列表。

#### Scenario: 首次选型
- **WHEN** 用户首次派遣豆包
- **THEN** 选型界面只提供「Auto（豆包 CLI 默认）」，确认后才启动
