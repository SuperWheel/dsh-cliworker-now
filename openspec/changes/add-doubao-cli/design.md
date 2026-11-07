# Design

## 背景与推翻理由

PRD 需求 5.8 与接入流程 1.5 节把“没有可程序化消费的输出”列为立项阻断条件，豆包因此原定不接入。2026-11-07 用户明确要求本期接入。本设计以重新调研的证据（见 proposal 调研表）说明：1.5 节的四个阻断条件中，

| 阻断条件 | 豆包 2.31.3 的实际情况 | 处理 |
| --- | --- | --- |
| 没有可程序化消费的输出 | 正文、工具、终态无法区分（工具步骤不输出）；但会话行是 JSON，正文只在结束时整体写到 stdout，错误有固定前缀 | 纯文本受限模式：只显示最终正文，不伪造过程 |
| 拿不到真实会话 ID | stderr 会话行给出真实 ID | 只用该 ID；取不到即本轮失败、不提供续聊 |
| 无法确认进程范围退出 | CLI 自身取消路径会等待服务端停止后再退出；共享服务是独立进程组 | 只有 CLI 自行以取消结束，或强制结束后本次启动的共享服务也退出，才报告成功 |
| 需要代填密码等 | 扫码登录由用户在原生终端完成 | 不代登录 |

因此按用户决定接入，但以受限模式交付，并在界面如实标注。豆包日后开放 `--output-format stream-json` 或 ACP 时，应新建 transport（如 `doubao-stream-v1`）按常规原生桥接入；`doubao-text-v1` 保持不变，旧 Worker 不迁移。

## 通道选择

已排除的结构化候选：

- **`json`/`stream-json`**：业务 JS 已实现，但原生前端固定 `output_format: "text"`，未知参数 `--output-format` 被拒（退出码 2），也没有环境变量入口。不能通过修改安装目录或注入 JS 打开：违反“不修改用户安装、只用原生能力”。
- **`--service-start`**：远程派发服务，经字节 WebSocket 推送通道收任务，本地无监听端口；且常驻、越出 Worker 生命周期。PRD 范围外第 6 条已列为不做。
- **标准错误接终端获取进度**：`progress` 只在 stderr 是 TTY 时开启，可得到 `· <工具标题>` 与“Automatically rejected: …”提示。需要为 stderr 分配伪终端，项目在 macOS 上没有 PTY 设施，且输出是给人看的文本。本期不做，记为后续可选项。

结论：transport `doubao-text-v1`，每轮一个一次性进程。

## 模块边界

| 层 | 位置 | 内容 |
| --- | --- | --- |
| 共享 | `src/shared/types.ts` | `CLI_IDS` 追加 `doubao`，`CLI_LABELS.doubao = '豆包 CLI'`，短名 `doubao` |
| 共享 | `src/shared/worker-permissions.ts` | `LEVELS.doubao = { auto }`（无 ask）；`workerPlanSupported` 对豆包返回 false；`runsUnderViewOnly` 自然为 false |
| 共享 | `src/shared/conversation-features.ts` | 分支不支持（无原生 fork）；规划不支持的提示沿用现有文案 |
| 共享 | `src/shared/account-links.ts` | 单账号；扫码登录不打开浏览器链接，`ACCOUNT_LOGIN_HOSTS.doubao` 为空或不登记 |
| 共享 | `src/shared/cli-limitations.ts`（新） | `cliLimitedMode(cli)`：豆包返回受限模式标签与缺失能力列表，供连接页与 Worker 卡片共用 |
| Host | `src/host/routing.ts` | 别名：`豆包`、`豆包 cli`、`doubao`、`doubao cli`、`doubao-cli`；单一入口直接路由 |
| Host | `src/host/index.ts`、`process.ts` | 配置项 `doubaoExecutable`，默认 `doubao` |
| Host | `src/host/doubao-adapter.ts`（新） | 程序发现与身份核对、环境变量、argv、目录、账号状态解析的纯函数 |
| Host | `src/host/native-worker.ts` | `NATIVE_TRANSPORTS.doubao = 'doubao-text-v1'` |
| Host | `src/host/native-bridge.mjs` | `doubao: ['native-doubao', 'runNativeDoubao']` |
| Host | `src/host/native-doubao.mjs`（新） | 受限 runner：启动、stderr 解析、会话、结果、停止确认 |
| Host | `src/host/native-transport.mjs` | 追加 `io.holdIdle()`（返回释放函数，内部即现有 `onApprovalWait`），不改其他行为 |
| Host | `src/host/accounts.ts` | 状态、登录、退出的 argv 与解析 |
| Host | `src/host/runtime.ts` | 启动分派：豆包走 `doubao-adapter` 生成 argv 后交给 `prepareNativeWorker`；不进入 `workerArguments` |
| Client | `src/client/icons.tsx`、`src/client/assets/doubao.png` | 图标 |
| Client | 设置连接页、Worker 卡片 | 受限模式标注，复用现有说明文字样式 |
| 构建 | `scripts/build.mjs` | `native-doubao.mjs` 进入运行资源清单 |

“为什么不进 `workerArguments`”：该函数是历史执行路径的 argv 构建点，接入流程要求新 CLI 不再加入。豆包虽是一次性进程，仍走原生桥（`prepareNativeWorker` → `native-bridge.mjs` → runner → `io.spawn`），复用现有的请求文件、停止信箱、时限、输出预算与进程清理设施；argv 在 `doubao-adapter.ts` 生成。实现时若发现扩展适配器（`extended-adapters.ts`）的分派更贴合，可加入 `EXTENDED_CLIS`，但不得改变已有扩展 CLI 的行为。

## 程序发现与启动

1. 手动路径、部署配置、自动记录优先（沿用 `resolveCliExecutable`）。
2. 自动发现：PATH 中的 `doubao`；若它是 npm 启动器（`…/@bytedance/doubao-cli/scripts/run.cjs`，且同包 `package.json` 的 `name` 为 `@bytedance/doubao-cli`），改为 `<appRoot>/current/doubao[.exe]`；PATH 未命中时直接检查 `<appRoot>/current/doubao[.exe]`。`appRoot` 与启动器 `runtime.cjs` 一致：win32 `%LOCALAPPDATA%\doubao_cli\app`，darwin `~/Library/Application Support/doubao_cli/app`，其他平台 `$XDG_DATA_HOME/doubao_cli/app` 或 `~/.local/share/doubao_cli/app`。macOS Desktop 不读 `.zshrc`，补 Homebrew 前缀与 npm 全局目录。
3. 身份核对：`--version` 输出须匹配 `^doubao \d+\.\d+\.\d+`；不符即拒绝（防止同名程序）。
4. 不执行启动器，不触发更新；每个豆包子进程环境都设 `DOUBAO_CLI_NO_UPDATE_CHECK=1`。参数一律数组。
5. Windows：发现规则可解释（`%LOCALAPPDATA%` 路径、npm `.cmd` shim 对应同一 appRoot），但未实测。

## argv 与权限映射

```
<bin> [--resume <id>] (--permission-mode always_allow | --dangerously-bypass-approvals-and-sandbox) -p <prompt>
```

- `-p <prompt>` 放在最后（原生解析器对 `-p` 后的多余参数报错的提示文案，提示词作为单个 argv）。2026-11-07 已验证以上顺序在原生层通过（停在登录检查，退出码 4）；JS 层对取值的校验因账号门槛未能验证。
- 不传 `--model`、`--effort`（目录只有原生默认 Auto）；不传 `-C`（以子进程 cwd 作工作目录，待真实验收核对）。
- 提示词：UTF-8 超过 1 MiB 时拒绝（二进制中有 1 MiB 限制文案，具体对象待核实，按保守处理）。
- 续聊 ID：须匹配 `^[A-Za-z0-9_-]{1,128}$`，否则拒绝续聊。
- stdin：建立后立即关闭（空输入不会成为附件）。

| DSH 档位 | 豆包参数 | 理由 |
| --- | --- | --- |
| 询问 `ask` | 不提供 | 非交互下 CLI 自动拒绝审批请求，无法转交 DSH；文本模式连拒绝都不输出，无法如实说明 |
| 自动审批 `auto` | `--permission-mode always_allow` | 原生“全部放行”，保留豆包原生沙箱 |
| 完全权限 `full` | `--dangerously-bypass-approvals-and-sandbox` | 原生“放行并关闭沙箱”，与其他 CLI 的完全权限语义一致；需 DSH 原生完全权限确认后才能保存 |

不使用 `ask_always`、`ask_risky`：二者在非交互下都会把需要审批的操作静默拒绝，Worker 看似成功却跳过了操作。未选档位且主对话为仅可查看时拒绝派遣，提示先在 Worker 菜单选择档位（与 Hermes 一致）。不支持规划模式：`workerPlanSupported` 返回 false，规划任务被拒绝。

「自动审批」的悬停说明使用豆包专属文案：需要审批的操作全部自动放行、保留豆包原生沙箱；豆包要你回答问题时本轮会结束（非交互模式无法转交）。

## runner：`native-doubao.mjs`

1. 用 `io.spawn(argv, { stopSignal: 'SIGINT', onStdout, onStderr })` 启动，随后关闭 stdin，调用 `io.holdIdle()`：CLI 在完成前不输出，空闲时限不适用；总时限仍生效。进程结束时释放。
2. stderr 按行解析（行长受 `maxNativeLineBytes` 限制）：
   - 整行是 JSON 且 `type === 'session'`、`session_id` 为合法 ID → `io.session(id)`（续聊时 `io.session` 已校验与请求 ID 一致，不一致即失败）。
   - `Error: <消息>` → 记录为 CLI 错误。
   - `<code>: <消息>`，`code` 属于已知集合（`invalid_arguments`、`not_configured`、`auth_unavailable`、`host_unavailable`、`login_required`、`enterprise_required`、`cancelled`、`timed_out`、`conflict`、`internal_error`、`interaction_required`）→ 记录代码与消息。
   - 其他行只作诊断，不进入正文。
3. stdout 累积（受 `maxRunBytes` 限制，超限按输出预算截断并标注）。
4. 结束判定：
   - 退出码 0、无错误、有会话 ID → 发一条 `assistant` 事件（stdout 原文，去掉末尾单个换行），`io.result('SUCCESS', 正文)`。
   - 退出码 0 但没有会话 ID → `ERROR`「豆包 CLI 未报告会话 ID，无法续聊」，正文仍作为本轮回复显示。
   - 非零退出 → `ERROR`，按错误映射给出说明，附 CLI 原始消息（截断）。
5. 不发 `tool`、`reasoning`、`status` 进度事件，不合成审批请求。

### 错误映射

| CLI 信号 | 用户提示 |
| --- | --- |
| `login_required` 且消息含“企业账号”或 `enterprise_required` | 当前豆包账号不是团队或企业订阅账号，豆包 CLI 仅对这类账号开放；请在 CLI 连接页用订阅账号重新登录 |
| `login_required` | 豆包 CLI 未登录，请在 CLI 连接页登录 |
| `conflict` | 豆包正在切换账号，请稍后重试 |
| `interaction_required` 或 stderr 含 “User input is required” | 豆包需要你回答问题，非交互模式无法转交，本轮已结束；CLI 未确认服务端已终止 |
| `invalid_arguments` | 显示 CLI 原文 |
| 其他 | `豆包 CLI 运行失败（退出码 N）：<原文>` |

退出码只用已观察到的（2/4/7）辅助判断，以前缀为准。

## 停止

1. 收到停止（`io.signal` 中止）时，POSIX 上先用一次 `ps -A -o pid=,ppid=,command=`（参数数组、有界超时）记下本次 CLI 进程的 `--type=service` 子进程 PID（若有）。
2. `owned.stop()` 发 SIGINT：豆包 JS 在中止时调用 `chat.stop` 并等待其完成，再写 `Error: Cancelled.` 退出。
3. 判定：
   - CLI 在 SIGKILL 之前自行退出，且 stderr 含 `Cancelled.` 或 `cancelled:` → 停止已由 CLI 确认。
   - 被强制结束 → 若第 1 步记下了服务 PID，在 Host 停止宽限内（默认 5 秒，扣除已用时间，上限 2 秒）轮询该 PID 是否退出；退出 → 确认；仍在或第 1 步没取到 → 本轮以 `ERROR`「停止未经豆包确认：CLI 已被强制结束，其共享服务（独立进程组）可能仍在完成本轮」结束。
4. 插件不终止共享服务：它可能同时服务用户自己的其他豆包会话。
5. Windows 上不做第 1 步，强制结束一律报告未确认。

正常完成后不等待共享服务退出：它是 CLI 自行管理的共享基础设施，空闲约 10 秒自行退出（已实测）。

## 账号

- 状态：`<bin> auth status`，有界、无 prompt、stdin 关闭。退出码 0 → 已登录（成功时的输出格式未观察到，不解析账号名）；`login_required` 含“企业账号” → 「已登录但不是团队或企业订阅账号」；`login_required` → 未登录；`conflict` → 正在切换账号；其他 → 状态未知。
- 登录：原生终端运行 `<bin> login`（终端扫码），沿用现有账号终端；插件不代登录、不读取二维码内容以外的凭据。
- 退出：`<bin> logout`，等待退出后刷新状态与目录。
- 来源绑定：仅用 `<数据目录>/doubao-cli-pc-login/generation` 文件的元数据（存在性、大小、mtime、inode）作指纹，**不读取任何文件内容**；指纹变化即目录与选型失效。数据目录与 appRoot 同级（`…/doubao_cli/`）。

## 模型目录

只有一项：执行 ID `default`、显示「Auto（豆包 CLI 默认）」、强度仅 `default`；启动时不传 `--model`/`--effort`。目录发布前须账号状态为已登录（订阅不足或未登录时不发布目录，提示原因）。

未采用的方案：用不存在的 `--model` 触发“Available models: …”报错取模型名。它是 `-p` 调用，若哨兵值意外命中会真的发送提示词；返回的是显示名不是执行 ID；且当前账号无法验证。待企业账号可用后再评估。

## 其他原生功能

- 工具桥：豆包没有加载 MCP 的命令行参数，不注入 DSH 工具（`nativeHarnessExecutionReady` 不包含豆包）。
- 原生能力类别：二进制中可见 `cli_fs_service`（读写、grep）与 bash 服务，登记 `file-read`、`file-write`、`search`、`shell`；skill 目录待核实，不登记。
- 子 Agent、记忆（`AGENTS.md`）：跟随原生设置，不加开关；文本模式看不到它们的过程。
- 运行中引导、附件、分支：不支持。
- 用量与上下文：无公开数据，保持未知。

## 界面标注

连接页（CLI 说明区）与 Worker 卡片（CLI 名称旁）显示「纯文本受限模式」，悬停或说明列出：只显示最终回复、无工具过程、无审批转交（需要审批的操作在「自动审批」下由豆包放行，无「询问」档）、无规划模式、无运行中引导、无用量统计、仅团队或企业订阅账号可用。文案进 i18n，`CLI_LABELS` 不翻译。

## 图标

本机豆包桌面版 `/Applications/Doubao.app`（`com.bot.pc.doubao` 2.32.6）`Contents/Resources/app.icns`，用 `sips` 转 PNG，素材目录 `doc/assets/cli-icons/v5-doubao/`（目录编号可能与并行分支冲突，合并时由协调会话调整）。彩色图标，不做暗色反色。

## 兼容性、风险与回退

- 新增 transport，不影响已有 Worker；未知 transport 仍拒绝。
- 风险：JS 层参数校验、`always_allow` 的实际放行范围、SIGINT 取消路径、cwd 作为工作区、成功时的 `auth status` 输出、续聊回执，均因账号门槛未实测。真实验收前这些都标为未验证。
- 风险：豆包后续版本可能改变 stderr 会话行或错误前缀；解析失败时按“未报告会话 ID”失败，不猜测。
- 回退：从 `CLI_IDS` 移除即可隐藏入口；已有 `doubao-text-v1` Worker 会因 CLI 未注册而只读显示。
