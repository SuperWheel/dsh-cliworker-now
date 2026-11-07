# Proposal

> **状态：暂不接入（用户决定，2026-11-07）：豆包不太适合本项目，先暂时不做。**
> 本变更只保存调研结论与备用实施方案，不包含功能代码，不改共享注册清单，不新增 CliId。2026-11-07 用户扫码登录后被服务端拒绝（`login_required: 豆包 CLI 需要企业账号，请使用企业账号登录后重试。`），并确认自己没有豆包企业或团队身份；协调会话先改为“只调研、不实现”。随后又核查了 Codingns4DSH 的豆包接入与豆包工作客户端（见下文「其他接入途径」），都不能替代 CLI 或绕开门槛。用户据此决定暂不做。

## 结论

豆包不太适合本项目，暂不接入。理由：

1. **门槛**：唯一的 CLI（`@bytedance/doubao-cli`）只对团队订阅、企业订阅账号开放，由服务端判定，没有本地开关；个人订阅（含豆包工作客户端赠送的 30 天）也不在开放范围内。用户没有此类身份，无法完成任何真实验收。
2. **通道**：安装版 2.31.3 只开放纯文本输出，只能以受限模式接入：没有工具过程，没有审批转交，没有「询问」档，没有规划模式。这与其他 CLI Worker 的体验差距很大。
3. **替代途径都不合适**：Codingns4DSH 是通过 CDP 驱动豆包 App 的私有接口，只有云端工具，不能处理本地项目；豆包工作客户端没有 CLI；内部 Mojo IPC 是非公开协议。

重新评估的条件（满足其一即可另行立项）：豆包 CLI 开放 `--output-format stream-json`、ACP 或其他公开结构化通道；或者向个人账号开放；或者用户拿到团队或企业订阅并明确要求接入。届时以本目录的调研和 design 为起点，先复核 tasks.md 0.4 节。

## Why

v0.8.8 PRD（§四.五、需求 5.8）原本因豆包 CLI 只有纯文本输出决定本期不接入。2026-11-07 用户明确要求本期也接入豆包，推翻该结论。本变更按 `doc/knowledge/cli-integration/new-cli-onboarding.md` 重新调研安装版 2.31.3，确认没有可开启的结构化通道后，以「纯文本受限模式」接入，并如实标注能力缺口。PRD 文件不在本分支修改，由协调会话合并时统一更新；本变更的 design 与 tasks.md 记录推翻理由与证据。

## 调研结论（2026-11-07，本机 macOS arm64，未发送任何 prompt）

| 项目 | 结论 | 来源 |
| --- | --- | --- |
| 包与命令 | npm `@bytedance/doubao-cli` 2.31.3，bin `doubao` → `scripts/run.cjs` 启动器；真正程序为 `<appRoot>/current/doubao`（macOS `~/Library/Application Support/doubao_cli/app/current/doubao`，arm64 原生，`--version` 输出 `doubao 2.31.3`）；Windows 为 `%LOCALAPPDATA%\doubao_cli\app\current\doubao.exe`，Linux 为 `$XDG_DATA_HOME` 或 `~/.local/share` 下同名目录 | 本机、启动器源码 `scripts/run.cjs`、`scripts/runtime.cjs` |
| 业务代码 | 原生程序加载 `current/resources/js_app/` 内的 JS 包（`entry-cli-router`、`entry-cli-chat`、`entry-moa`），PRD 只检索了原生二进制 | `cli-manifest.json`、`manifest.json` |
| 形态 | 只找到国内版，单一命令与配置根（形态判定：单 CliId，单账号） | npm、官方文档、本机 |
| 门槛 | 仅豆包团队订阅、企业订阅账号开放。用户 19:05 扫码登录后，`doubao auth status`、`--list`、`-p` 均返回 `login_required: 豆包 CLI 需要企业账号，请使用企业账号登录后重试。`（退出码 4；`--list`/`-p` 另附“请运行 `doubao login` 后重试”）。该文案不在本地程序或 JS 包中，JS 通过 `/alice/dispatch/setting/user` 由服务端判定，并有 `passport_enterprise_user_type` 字段；没有本地开关（不同于 TRAE 的个人登录特性开关）。用户确认没有企业或团队身份 | 官方文档、本机实测、协调会话转告 |
| 输出格式 | JS 实现了 `text`/`json`/`stream-json`（Claude 风格的 `system/init`、`assistant`、`tool_use`、`tool_result`、`result`、`permission_denials`），但原生前端只接受 `-p`、`--list`、`--resume`、`--model`、`--effort`、`--permission-mode`、`--dangerously-bypass-approvals-and-sandbox`、`-C`、`--service-start`、`--limit`/`--cursor`（JS 层），构造请求时 `output_format` 固定为 `text`；`--output-format stream-json` 返回 `invalid_arguments: 未知命令或选项`（退出码 2）；二进制中没有可设置输出格式的环境变量 | JS 包检索、本机实测 |
| 文本模式输出 | 会话建立或绑定时，标准错误写一行 `{"type":"session","session_id":"<id>"}`；正文在本轮结束时一次性写到标准输出；JS 层错误写 `Error: <消息>`；原生层错误写 `<code>: <消息>`；工具步骤与进度只在标准错误是终端时输出 | JS 包 `entry-cli-router` 输出模块、本机实测 |
| 会话 | 真实会话 ID 来自上面的 stderr 会话行；`--list` 文本输出每行 `<conversationId>  <标题>`；`--resume <id> -p <prompt>` 续聊；会话存于云端，用户数据目录内无本地会话记录文件 | JS 包、本机目录结构 |
| 审批 | 非交互运行时，可拒绝的审批请求被 CLI **自动拒绝**（文本模式下无任何输出，仅 json 结果的 `permission_denials` 记录）；需要用户回答的提问（agent question 等）会让本轮停止并以 `interaction_required` 结束，CLI 自述“remote termination is not confirmed” | JS 包 `runTask` |
| 权限 | `--permission-mode ask_always|ask_risky|always_allow`（默认 `ask_risky`）；`--dangerously-bypass-approvals-and-sandbox` 等价于 `always_allow` 并关闭沙箱，不能与 `--permission-mode` 同用；无规划模式 | `--help`、JS 参数解析 |
| 模型与强度 | `--model`（默认 Auto），没有列出模型的命令；未知 `--model` 时 CLI 报错并列出可用模型名称；强度按模型给出（全集 `none`…`max`），帮助写 `Low|Medium|High` | `--help`、JS 包 |
| `--service-start` | 远程派发服务：`cli-manifest.json` 把它映射到 `services.dispatch` = `entry-cli-chat/main.js`；router 层遇到 `service` 模式只把控制权交给原生侧后退出。该入口连接字节 WebSocket 推送通道（frontier 长连接、QoS ack）接收其他设备派来的任务，本地不监听端口（无 `listen(`、`localhost`、`127.0.0.1`），不是可用的结构化或审批通道；常驻且同机仅 1 个，越出单个 Worker 生命周期。未实际运行（会注册远程派发服务，且需登录） | JS 包、二进制字符串 |
| 内部 IPC | 原生程序含 `ipc/service_server.cc`、`service_client.cc`、`shared_auth_*.cc`、`shell_api_*.cc`，接口为 Chromium Mojo（`doubao_cli.mojom.ServiceControl`、`ServiceEvents`、`AuthControl`、`LoginEvents`、`SessionEvents`、`CookieAccess`、`ShellApiEvents`）。共享服务只监听 `doubao_cli/control/js-service.sock`（Unix 套接字，0600），连接前做服务发现与对端校验（错误码含 `untrusted_peer`、`protocol`）；工具宿主之间的 `agent_tool_ipc` 用加密帧与 HMAC 挑战握手。运行中服务的 TCP 连接只有到本机代理 7897 端口的出站连接，没有 TCP 监听。结论：这是未公开、带对端校验的内部协议，没有文档与版本承诺，外部调用需要重新实现 Mojo 并通过对端校验，不作为接入通道（试验性也不采用） | 二进制字符串、`lsof -U`/`lsof -i`（`auth status` 运行期间，2026-11-07） |
| 进程 | CLI 启动 `--type=service` 共享服务与 `--type=crashpad-handler`，二者各自 `setsid` 成独立进程组；CLI 退出后被 init 收养，空闲约 10 秒自行退出；多个 CLI 实例共用同一服务 | 本机 `ps -o pid,ppid,pgid` 实测 |
| 退出码 | 已观察：0 成功（`--version`）、2 `invalid_arguments`（未知选项、`-p` 后空提示词、`--resume` 与 `--list` 同用）、4 `login_required`（`auth status`、`auth status --verify`、`--list`、`-p`）、7 `conflict`（用户扫码期间运行任意命令：“正在切换账号，请稍后重试”）；原生层错误格式为 `<code>: <中文消息>`，写 stderr，stdout 为空；原生层先做登录检查，`--permission-mode bogus` 这类取值错误在未登录时不会暴露；其余代码（`not_configured`、`auth_unavailable`、`host_unavailable`、`enterprise_required`、`cancelled`、`timed_out`、`internal_error`、`interaction_required`）的退出码未观察到 | 本机实测、二进制字符串 |
| 自动更新 | 启动器只在三个标准流都是终端时询问更新；插件直接启动 `current/doubao`，不经过启动器，并始终设置 `DOUBAO_CLI_NO_UPDATE_CHECK=1` | 启动器源码 |

## 其他接入途径（2026-11-07 核查）

| 途径 | 结论 | 来源 |
| --- | --- | --- |
| Codingns4DSH「豆包 App 直接适配器」（spec007.3，状态 IN_PROGRESS） | 不使用 doubao-cli。以 `--remote-debugging-address=127.0.0.1 --remote-debugging-port=9225` 启动豆包桌面 App（macOS 用 `open -g -j`），经 CDP 连接其隐藏后台页 `doubao-background`。通过 Webpack 模块结构特征定位 App 内部的请求封装，再用后台页的 `fetch` 调用豆包自己的 HTTP/SSE 接口。复用 App 内登录，因此不受 CLI 的企业账号门槛限制。档位为快速、专家、工作任务（云端 Agent，固定内部参数，不是真实模型目录），工具都在云端（联网搜索、网页读取、云端文件操作与产物下载），不能读写本地项目文件，也不能执行本机命令。只在 macOS 豆包 App 2.12.8 上验收过（本机为 2.32.6）。不采用：不是代码 Worker；依赖 App 私有内部结构，升级即可能失效；调试端口打开期间，本机任何进程都可以操控已登录的 App；也落在 PRD 范围外第 4 条（豆包桌面应用本身的自动化）。Codingns4DSH 为 GPL-3.0，只记录事实，未复制代码 | Codingns4DSH 仓库 `0454d03`（v0.2.2-beta.4）的 `specs/spec007.3-豆包App直接适配器集成/` |
| 豆包工作（Doubao Work）的“本地版” | 指独立的豆包工作桌面客户端（Windows、Mac，从豆包工作官网下载），官方说明它适合“处理本地文件、操作本地电脑或执行耗时较长的复杂任务”；另有豆包客户端里的“工作”入口和飞书入口。帮助中心的客户端设置、配置要求、常见问题等文章都没有提到 CLI 或命令行。豆包 CLI 在同一帮助中心单独成节，安装方式是 npm `@bytedance/doubao-cli`，概览页写明“仅对‘豆包团队订阅’及‘豆包企业订阅’账号开放”；CLI 与客户端之间的联系是“从其他设备派发任务”（对应 `--service-start`），不是客户端自带 CLI。登录豆包工作桌面端可领 30 天个人订阅；团队订阅可在线购买、由管理员分配席位，企业订阅需联系销售。本机没有安装豆包工作客户端 | doubao.com/work/docs/zh-cn 的豆包工作介绍、打开豆包工作、与豆包和飞书的区别说明、自助购买个人订阅、团队与企业订阅权益、管理员购买等文章及豆包 CLI 概览页（2026-11-07，内置浏览器读取） |
| 豆包桌面 App 2.32.6（本机） | 应用包内只有 Chromium 外壳与辅助程序，没有 CLI 入口，也没有引用 doubao-cli。App 自带本地任务模式：`local_webcontents/apps/entry-moa` 中有 `taskMode`，用户数据中有 `sandbox_runtime`（node、python）、`.doubao/agent_mode/workspace`、`agent_infra`；`task-mode-resource/python-packages` 中有 browser use 与 computer use。这些都只能在 App 内部使用，没有对外接口 | 本机应用包与 `~/Library/Application Support/Doubao/` 目录结构（只看名称，未读取内容） |

## What Changes

**本期**：只提交本变更目录，记录调研结论、不接入的理由与备用方案。不写功能代码，不改 `CLI_IDS` 等共享清单，CLI 连接列表中不出现豆包。

**备用方案**（满足上文「重新评估的条件」并由用户决定重新立项时使用，实施前先重跑 tasks.md 第 0 节的复核项）：

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

共享注册（`src/shared/types.ts`、`worker-permissions.ts`、`conversation-features.ts`、`account-links.ts`）、Host 路由与配置、可执行发现、账号、原生桥（`native-worker.ts`、`native-bridge.mjs`、新 runner）、构建清单（`scripts/build.mjs`）、Client 图标与受限标注、i18n、README/AGENTS/usage-details/design 与 `doc/doubao-protocol.md`。以上为实施后的影响；本期只新增本变更目录。无新运行依赖，不改 Harness 核心，不升版本、不推送发布。真实验收受账号门槛阻塞（用户无企业或团队身份），模型选型也尚未获批；二者均在 tasks.md 保留为未验证。阻塞期间 `specs/` 中的增量规格表示拟定行为，不得在未实施时同步到主规格或归档。
