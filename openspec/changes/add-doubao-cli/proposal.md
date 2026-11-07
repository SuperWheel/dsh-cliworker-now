# Proposal

## Why

v0.8.8 PRD（§四.五、需求 5.8）原本因豆包 CLI 只有纯文本输出决定本期不接入。2026-11-07 用户明确要求本期也接入豆包，推翻该结论。本变更按 `doc/knowledge/cli-integration/new-cli-onboarding.md` 重新调研安装版 2.31.3，确认没有可开启的结构化通道后，以「纯文本受限模式」接入，并如实标注能力缺口。PRD 文件不在本分支修改，由协调会话合并时统一更新；本变更的 design 与 tasks.md 记录推翻理由与证据。

## 调研结论（2026-11-07，本机 macOS arm64，未发送任何 prompt）

| 项目 | 结论 | 来源 |
| --- | --- | --- |
| 包与命令 | npm `@bytedance/doubao-cli` 2.31.3，bin `doubao` → `scripts/run.cjs` 启动器；真正程序为 `<appRoot>/current/doubao`（macOS `~/Library/Application Support/doubao_cli/app/current/doubao`，arm64 原生，`--version` 输出 `doubao 2.31.3`）；Windows 为 `%LOCALAPPDATA%\doubao_cli\app\current\doubao.exe`，Linux 为 `$XDG_DATA_HOME` 或 `~/.local/share` 下同名目录 | 本机、启动器源码 `scripts/run.cjs`、`scripts/runtime.cjs` |
| 业务代码 | 原生程序加载 `current/resources/js_app/` 内的 JS 包（`entry-cli-router`、`entry-cli-chat`、`entry-moa`），PRD 只检索了原生二进制 | `cli-manifest.json`、`manifest.json` |
| 形态 | 只找到国内版，单一命令与配置根（形态判定：单 CliId，单账号） | npm、官方文档、本机 |
| 门槛 | 仅豆包团队订阅、企业订阅账号开放。用户 19:05 扫码登录后，`doubao auth status` 返回 `login_required: 豆包 CLI 需要企业账号，请使用企业账号登录后重试。`（退出码 4），当前账号不满足 | 官方文档、本机实测 |
| 输出格式 | JS 实现了 `text`/`json`/`stream-json`（Claude 风格的 `system/init`、`assistant`、`tool_use`、`tool_result`、`result`、`permission_denials`），但原生前端只接受 `-p`、`--list`、`--resume`、`--model`、`--effort`、`--permission-mode`、`--dangerously-bypass-approvals-and-sandbox`、`-C`、`--service-start`、`--limit`/`--cursor`（JS 层），构造请求时 `output_format` 固定为 `text`；`--output-format stream-json` 返回 `invalid_arguments: 未知命令或选项`（退出码 2）；二进制中没有可设置输出格式的环境变量 | JS 包检索、本机实测 |
| 文本模式输出 | 会话建立或绑定时，标准错误写一行 `{"type":"session","session_id":"<id>"}`；正文在本轮结束时一次性写到标准输出；JS 层错误写 `Error: <消息>`；原生层错误写 `<code>: <消息>`；工具步骤与进度只在标准错误是终端时输出 | JS 包 `entry-cli-router` 输出模块、本机实测 |
| 会话 | 真实会话 ID 来自上面的 stderr 会话行；`--list` 文本输出每行 `<conversationId>  <标题>`；`--resume <id> -p <prompt>` 续聊；会话存于云端，用户数据目录内无本地会话记录文件 | JS 包、本机目录结构 |
| 审批 | 非交互运行时，可拒绝的审批请求被 CLI **自动拒绝**（文本模式下无任何输出，仅 json 结果的 `permission_denials` 记录）；需要用户回答的提问（agent question 等）会让本轮停止并以 `interaction_required` 结束，CLI 自述“remote termination is not confirmed” | JS 包 `runTask` |
| 权限 | `--permission-mode ask_always|ask_risky|always_allow`（默认 `ask_risky`）；`--dangerously-bypass-approvals-and-sandbox` 等价于 `always_allow` 并关闭沙箱，不能与 `--permission-mode` 同用；无规划模式 | `--help`、JS 参数解析 |
| 模型与强度 | `--model`（默认 Auto），没有列出模型的命令；未知 `--model` 时 CLI 报错并列出可用模型名称；强度按模型给出（全集 `none`…`max`），帮助写 `Low|Medium|High` | `--help`、JS 包 |
| `--service-start` | 远程派发服务：连接字节 WebSocket 推送通道接收其他设备派来的任务，本地不监听端口，不是可用的结构化或审批通道；会越出单个 Worker 生命周期 | JS 包 `entry-cli-chat`（无 `listen(`、`localhost`、`127.0.0.1`） |
| 进程 | CLI 启动 `--type=service` 共享服务与 `--type=crashpad-handler`，二者各自 `setsid` 成独立进程组；CLI 退出后被 init 收养，空闲约 10 秒自行退出；多个 CLI 实例共用同一服务 | 本机 `ps -o pid,ppid,pgid` 实测 |
| 退出码 | 已观察：0 成功、2 `invalid_arguments`、4 `login_required`、7 `conflict`（正在切换账号）；其余代码（`not_configured`、`auth_unavailable`、`host_unavailable`、`enterprise_required`、`cancelled`、`timed_out`、`internal_error`、`interaction_required`）的退出码未观察到 | 本机实测、二进制字符串 |
| 自动更新 | 启动器只在三个标准流都是终端时询问更新；插件直接启动 `current/doubao`，不经过启动器，并始终设置 `DOUBAO_CLI_NO_UPDATE_CHECK=1` | 启动器源码 |

## What Changes

- 新增 CliId `doubao`，名称「豆包 CLI」，transport `doubao-text-v1`（纯文本受限模式），原生桥 runner `native-doubao.mjs`。每轮一个 `-p` 一次性进程，标准输出原样作为 Worker 正文（不可信文本），不伪造工具事件、进度或推理。
- 会话 ID 只取 stderr 会话行；拿不到时本轮报错且不提供续聊；续聊用 `--resume <id>`，回执 ID 不一致即失败，不新建会话。
- 权限只提供「自动审批」（`--permission-mode always_allow`）与「完全权限」（`--dangerously-bypass-approvals-and-sandbox`），不提供第一项；仅可查看下未选档位时拒绝派遣；不支持规划模式。
- 停止先发 SIGINT 让 CLI 自行取消；只有 CLI 自行以取消结束，或被强制结束后本次启动的共享服务也已退出，才报告停止成功，否则如实报告未确认。
- 模型目录只提供原生默认「Auto」（不传 `--model`/`--effort`）；其他模型待企业账号实测后再接入。
- 账号：`doubao auth status` 查询，区分未登录与「需要团队或企业订阅」；登录走原生终端 `doubao login` 扫码；退出用 `doubao logout`。
- 连接页与 Worker 卡片标注「纯文本受限模式」及缺失能力；图标取自本机豆包桌面版官方应用包。
- 共享清单只做追加式改动；不加入历史执行路径 `workerArguments`。

## Capabilities

### New Capabilities

- `doubao-cli`: 豆包 CLI 的身份、发现、账号、纯文本受限执行、会话、权限、停止与界面标注。

### Modified Capabilities

- `worker-permission-levels`: 增加豆包的档位名称（无第一项）与仅可查看下的拒绝。

## Impact

共享注册（`src/shared/types.ts`、`worker-permissions.ts`、`conversation-features.ts`、`account-links.ts`）、Host 路由与配置、可执行发现、账号、原生桥（`native-worker.ts`、`native-bridge.mjs`、新 runner）、构建清单（`scripts/build.mjs`）、Client 图标与受限标注、i18n、README/AGENTS/usage-details/design 与 `doc/doubao-protocol.md`。无新运行依赖，不改 Harness 核心，不升版本、不推送发布。真实模型验收受账号门槛阻塞（当前账号被判为非企业账号），模型选型也尚未获批；二者均在 tasks.md 保留为未验证。
