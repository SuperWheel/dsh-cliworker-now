# 新 CLI 接入流程

本文是接入一个新 CLI 的完整执行规范，按开发顺序列出每一步要改的文件、接口、判定规则和交付证据。同目录的原子笔记解释各环节的原理，本文负责把它们串成一条可以逐项打勾的流程。

- **核对基线**：2026-11-07，分支 `feat/general-settings`（提交 `7952682`，v0.8.7 源码）。文中的文件与函数名均已对照该版本源码。
- **参照例子**：主要以 Qoder 国际版 `qoder` 与中国版 `qodercn` 为参照（两个独立 CLI，共用 ACP 协议）。“同一 CLI、按区域区分账号”的情况以 Kimi 为参照。
- **首次应用**：v0.8.8 接入 CodeBuddy、WorkBuddy、TRAE CLI 与豆包 CLI，见 [v0.8.8 PRD](../../prd/2026-11-07-v0.8.8-PRD.md)。
- **约束来源**：[AGENTS.md](../../../AGENTS.md) 中的项目规则优先于本文。本文只说明怎样落实，不放宽任何规则。

## 0、总览

| 阶段 | 内容 | 主要产物 |
| --- | --- | --- |
| 0 | 调研，判定国内版与国际版的形态 | 调研表；形态判定（A/B/C/D） |
| 1 | 创建 OpenSpec 变更 | `openspec/changes/add-<cli>-cli/` |
| 2 | 注册 CLI 身份与能力声明 | `CLI_IDS`、别名、配置项、transport |
| 3 | 可执行文件发现与启动 | 路径解析、平台安装线索、构建资源 |
| 4 | 账号登录、隔离与退出 | 账号状态、登录窗口、来源绑定 |
| 5 | 模型目录与思考强度 | 目录发现、精确解析、缓存绑定 |
| 6 | 参数生成与权限三档 | argv、档位映射、规划模式 |
| 7 | 通信协议与流解析 | 桥 runner、事件、会话 ID、恢复 |
| 8 | 原生会话、续聊、运行中输入与分支 | 会话 adapter、能力矩阵 |
| 9 | 原生工具与 DSH 工具桥 | 工具注入、能力类别、skill 路径 |
| 10 | 原生审批转交 | 授权请求映射、会话级授权 |
| 11 | 子 Agent、记忆与其他原生功能 | 跟随原生设置；关闭须写理由 |
| 12 | 遥测与用量 | 原生事件白名单、积分或 token 口径 |
| 13 | 品牌图标 | `doc/assets/cli-icons/v<N>-<name>/`、运行图 |
| 14 | 设置页 | CLI 连接页，遵循设置页规范 |
| 15 | Windows 与 macOS 平台差异 | 平台安装线索、代理、凭据存储 |
| 16 | 自动化测试 | 关联回归与夹具 |
| 17 | 真实验收 | 分层证据清单 |
| 18 | 文档同步与归档 | README、设计、协议文档、规格 |

**最快的漏项检查方法**：选一个形态最接近的已有 CLI，在源码和测试中搜索它的 ID，例如 `grep -rn "qodercn" src tests scripts`。很多分派写成 `cli === 'x'` 或 `Partial<Record<CliId, …>>`，漏掉一处不会报类型错误，只会在运行时走进默认分支（例如 `workerArguments` 末尾的 `${CLI_LABELS[cli]} 尚未接入`）。新 CLI 的每个命中点都要有对应处理，或写明不支持的理由。

---

## 1、阶段 0：调研与形态判定

### 1.1 调研表

每个 CLI 先填完下表，每一项写明来源：官方文档 URL、`npm view` 输出或本机 `--help`。查不到的写“待核实”，不得按别的 CLI 推测。

| 项目 | 需要确认的内容 |
| --- | --- |
| 发布方与包 | 官方包名、命令名、版本、安装方式（npm、原生安装器、应用内置）、Node/Bun/Python 运行时 |
| 国内版与国际版 | 是否为不同的包或命令、配置根、环境变量前缀、登录站点、端点（见 1.2） |
| 使用门槛 | 订阅、套餐、企业版或白名单限制（会直接阻塞真实验收） |
| 登录 | 登录方式（OAuth、扫码、PAT、API Key）、状态查询命令、退出命令、凭据存储位置（文件、钥匙串、Credential Manager） |
| 非交互与流 | `-p`/`exec`、输出格式（text/json/stream-json/JSONL）、双向输入、ACP、app-server、HTTP/SSE |
| 会话 | 会话 ID 从哪里返回、恢复与续聊参数、分支（fork）、会话存储位置 |
| 模型与强度 | 模型参数、模型列表来源（命令、ACP `session/new`、配置文件）、强度是参数、配置项还是不同模型 ID |
| 权限 | 原生权限模式全集、沙箱、审批策略，以及非交互模式下能否把审批交给调用方 |
| 规划模式 | 是否有原生只读规划模式，以及启动方式 |
| 工具与扩展 | 原生工具、MCP 配置入口、skill 目录、子 Agent、记忆文件、hooks |
| 用量 | token、积分、上下文的公开字段与范围 |
| 副作用 | 探测命令是否会自动升级、联网、写缓存或弹出界面（Kimi 曾因探测自动升级真实安装） |

调研结论写进该 CLI 的 OpenSpec 变更 `proposal.md`；协议细节写进 `doc/<cli>-protocol.md`（参照 [qoder-protocol.md](../../qoder-protocol.md)、[qodercn-protocol.md](../../qodercn-protocol.md)）。

### 1.2 国内版与国际版的四种形态

判定依据只能是可核查的证据：包名、可执行文件名、配置根、环境变量前缀、凭据存储、登录站点、端点和协议初始化回执里的身份。产品名称和营销页面不能作为依据。

| 形态 | 特征 | 已有参照 | 接入方式 |
| --- | --- | --- | --- |
| **A 独立 CLI** | 两个包、两个命令、两套配置根和环境变量 | Qoder：`qodercli`/`@qoder-ai/qodercli`/`.qoder`/`QODER_`，对比 `qoderclicn`/`@qodercn-ai/qoderclicn`/`.qoder-cn`/`QODERCN_` | **两个 CliId**。路径、偏好、目录缓存、清理保护、会话和 transport（`qoder-acp-v1` 与 `qodercn-acp-v1`）全部分开；泛称时按安装情况路由，两版都装时询问用户 |
| **B 同一 CLI，可同时持有多个区域的登录** | 一个命令，按区域登录，不同区域的凭据可并存 | Kimi：`kimi login --region mainland-cn\|global`，对应 provider `kimi-code-cn` 与 `kimi-code` | **一个 CliId**，进 `MULTI_ACCOUNT_CLIS`；区域作为账号或提供方属性，模型目录按账号绑定 |
| **C 同一 CLI，一次只能登录一个站点** | 一个命令、一个配置根，登录时选站点 | CodeBuddy Code（v0.8.8 确认单入口）：ACP 初始化回执的 `authMethods` 分别列出 `internal`（中国站）与 `external`（国际站） | **一个 CliId** 加单账号（`SINGLE_ACCOUNT_CLIS`）：站点作为账号属性显示，切换站点就是重新登录，目录随站点失效。站点从原生回执或认证域名判断，不靠猜。只有用户明确要求两站点同时可用时才拆成两个 CliId；拆分前必须核实凭据存储是否随配置根隔离（CodeBuddy 的认证文件按 HOME 存放，不随 `CODEBUDDY_CONFIG_DIR` 变化） |
| **D 宿主应用内置 CLI** | CLI 随桌面应用分发，不单独安装 | Windows 上 ZCode、OpenCode 的 Desktop 内置入口（`windows-desktop-cli-installation.ts`）；v0.8.8 WorkBuddy（试验性） | 发现入口指向应用包内的路径；版本跟随应用更新。先确认该入口能否独立运行：WorkBuddy 5.9.3 的内置 CLI 是桌面端托管的 sidecar，凭据密钥由桌面端下发，直接启动会卡在初始化。需要从应用私有接口取密钥的方案，必须由用户明确决定（v0.8.8 用户选定 WorkBuddy 走密钥引导，不依赖桌面端运行）。选定后：引导代码自行实现；密钥只在插件启动的子进程与一次性私有 socket 之间传递，不入日志、事件、消息、持久化与测试快照；引导失败时结束进程并清理 socket。界面标注“试验性”，规格写明非公开接口的风险 |

形态判定结果、依据和来源写进 PRD 与 OpenSpec 提案。形态 A 的两个版本都要有独立的 `<cli>-cli` 规格，参照 [qodercn-cli 规格](../../../openspec/specs/qodercn-cli/spec.md)。

### 1.3 参考实现与许可

- 可以参考其他开源桥接项目（如 [Codingns4DSH](https://github.com/jingyi0605/Codingns4DSH)、codex-host）了解 CLI 的公开事实：参数、环境变量、文件位置、协议形态。
- 本项目为 MIT 许可。Codingns4DSH 为 GPL-3.0，codex-host 的部分代码为 LGPL-3.0，**不得复制或改写其代码**；只记录事实与来源，并在本项目内重新实现、重新验证。
- 参考实现的结论也要在本机安装版上复测，记为“第三方（待实测）”，直到有本项目自己的证据。

### 1.4 探测注意事项

- 探测只发元数据请求（`--version`、`--help`、ACP `initialize` 与 `session/new`），不发 prompt、不调用模型。
- 先只看认证文件是否存在来判断登录状态，不读取凭据内容。
- 关闭自动更新：CodeBuddy 用 `DISABLE_AUTOUPDATER=1`；豆包启动器只在终端交互时询问更新，非交互调用不受影响，也可设 `DOUBAO_CLI_NO_UPDATE_CHECK=1`。
- 国内厂商的安装地址可能限制境外 IP（TRAE CLI 安装脚本返回 `denied by region block`）。代理是用户的系统设置，插件和维护者不修改，记录为阻塞，请用户处理。
- npm 包可能只是启动器，实际程序在用户数据目录（豆包为 `~/Library/Application Support/doubao_cli/app/current/doubao`）；发现、版本与身份核对要指向真正的程序。
- 探测结束后核对没有残留进程。

### 1.5 立项前的阻断条件

以下任一项不满足时，只登记限制，不进入实现：

- 没有可程序化消费的输出（只有给人看的纯文本），无法区分正文、工具和终态。例：豆包 CLI 2.31.3 只有 `-p` 纯文本输出，v0.8.8 因此不接入。
- 拿不到真实会话 ID，无法续聊。
- 无法确认进程范围退出，停止无法如实报告成功。
- 需要插件代填密码、绕过验证码或修改系统安全设置才能登录。

---

## 2、阶段 1：OpenSpec 变更

1. 阅读 [OpenSpec 开发指南](../../openspec.md) 与 `openspec/config.yaml`。
2. 创建 `openspec/changes/add-<cli>-cli/`：`proposal.md`（调研结论与形态判定）、`design.md`（transport、权限映射、账号隔离）、`specs/<cli>-cli/spec.md`（新增能力规格），以及受影响主规格的增量。常见的受影响主规格有：[cli-account-isolation](../../../openspec/specs/cli-account-isolation/spec.md)、[cli-model-discovery](../../../openspec/specs/cli-model-discovery/spec.md)、[worker-permission-levels](../../../openspec/specs/worker-permission-levels/spec.md)、[native-permission-relay](../../../openspec/specs/native-permission-relay/spec.md)、[harness-cli-tool-bridge](../../../openspec/specs/harness-cli-tool-bridge/spec.md)、[cli-native-features](../../../openspec/specs/cli-native-features/spec.md)、[native-cli-conversations](../../../openspec/specs/native-cli-conversations/spec.md)、[worker-dispatch](../../../openspec/specs/worker-dispatch/spec.md)、[harness-cli-path-settings](../../../openspec/specs/harness-cli-path-settings/spec.md)、[platform-runtime](../../../openspec/specs/platform-runtime/spec.md)。
3. `tasks.md` 按本文阶段拆分任务；每项任务下用缩进子项记录实际命令、结果和未验证范围。不写入 `doc/tasks.md`。
4. 多个 CLI 可以一个 CLI 一个变更，也可以共用一个变更；形态 A 的两个版本放在同一个变更里，方便核对两版隔离。
5. 运行 `pnpm spec status --change <name>` 与 `pnpm spec:check`。格式校验通过不等于业务验收通过。

---

## 3、阶段 2：注册身份与能力声明

下表是新增一个 CliId 时必改的入口。“按能力”一列表示：CLI 不具备该能力时，在对应表中省略即可，但要在规格里写明理由。

| 层 | 文件 | 入口 | 要做的事 |
| --- | --- | --- | --- |
| 共享 | `src/shared/types.ts` | `CLI_IDS`、`CLI_LABELS`、`CLI_SHORT_NAMES` | 稳定 ID（小写、不含空格，形态 A 的国内版加 `cn` 后缀）、用户可见名称、自动命名短名 |
| 共享 | `src/shared/worker-permissions.ts` | `LEVELS`、`workerPlanSupported`、`runsUnderViewOnly`、`askRunsAsPlan` | 三档名称与说明、规划模式支持（见第 7 节） |
| 共享 | `src/shared/conversation-features.ts` | `forkSupport`、`noForkReason`、`expectedTransport` | 按能力：分支支持或不支持理由 |
| 共享 | `src/shared/running-message.ts` | `NATIVE_STEERING_TRANSPORTS` | 按能力：运行中引导（steer） |
| 共享 | `src/shared/account-links.ts` | `ACCOUNT_LOGIN_HOSTS`、`GUIDED_ACCOUNT_CLIS`、`SINGLE_ACCOUNT_CLIS`、`MULTI_ACCOUNT_CLIS` | 登录窗口允许打开的域名；单账号或多账号 |
| 共享 | `src/shared/native-usage-report.ts` | 用量口径分支 | 输入 token 是否含缓存、是否为积分 |
| Host | `src/host/routing.ts` | `CLI_ALIASES` 及泛称路由 | 中英文别名；形态 A 还要实现泛称路由，参照 Qoder：只装一版用该版，两版都装时询问，未知不改版 |
| Host | `src/host/index.ts`、`src/host/process.ts` | 配置 schema 中的 `<cli>Executable`、`RuntimeConfig`、Gateway 方法 | 默认命令名；形态 A 需要两项配置（如 `qoderExecutable`、`qodercnExecutable`） |
| Host | `src/host/native-worker.ts` | `NATIVE_TRANSPORTS` | 持久化的 transport 标记 `<cli>-<族>-v1`，一经发布不改 |
| Host | `src/host/native-bridge.mjs` | runner 映射表 | `<cli>: ['native-<cli>', 'runNative<Cli>']`；形态 A 两版可以指向同一 runner |
| Host | `src/host/native-attachments.mjs` | `supported` | 按能力：附件 |
| Host | `src/host/native-harness-injection.mjs` | `nativeHarnessExecutionReady` 与注入列表 | 按能力：DSH 工具桥（见第 9 节） |
| Host | `src/host/cli-native-capabilities.mjs` | 能力类别表、`nativeSkillPaths` | 原生工具类别（`file-read`、`file-write`、`search`、`shell`、`web`、`image-read`、`skills`）与 skill 目录 |
| Client | `src/client/icons.tsx` | `icons`、`optical` | 图标（见第 13 节） |
| 构建 | `scripts/build.mjs` | 运行资源清单 | 新增的 `.mjs` runner 和辅助脚本必须进入清单，否则打包后找不到 |

形态 A 的两个版本建议加一个 variant 模块统一差异项，参照 `src/host/qoder-variant.ts`：`label`、环境变量前缀、站点、配置目录、可执行名、npm 包名，以及初始化回执中的 agent 身份。各处分派统一读这一个函数，不在业务代码里散落字符串。

原理见 [注册 CLI 与能力声明](cli-registration.md)。

---

## 4、阶段 3：可执行文件发现与启动

| 文件 | 入口 | 要做的事 |
| --- | --- | --- |
| `src/host/adapters.ts` | `executableFor`、`configuredCliExecutable`、`resolveCliExecutable` | 手动路径优先，其次部署配置和自动记录，最后是 CLI 专属发现；形态 A 拒绝把对侧版本的程序当成本版 |
| `src/host/cli-executable-paths.ts` | 按机器保存路径 | 不改动，确认新 CLI 能正常写入和失效 |
| `src/host/windows-cli-installation.ts` | 用户目录、npm 入口、安装器默认目录 | Windows 安装线索；缺失时报出“未找到，请配置 `<cli>Executable`” |
| `src/host/windows-desktop-cli-installation.ts` | 卸载信息、App Paths、快捷方式 | 只用于形态 D 或 Desktop 内置入口 |
| `src/host/native-launch.mjs`、`native-spawn.mjs` | 入口归一化 | npm shim 读取 `package.json` 的 `bin`，核对包名后改为固定的 Node/Bun 入口；不执行包装脚本 |
| `scripts/build.mjs` | 资源复制 | 见第 3 节 |

规则：

- 自动发现找到的文件要再核对身份：包名、`--version` 或初始化回执。Qoder 要区分 `qoder` 分发器、IDE 与独立的 `qodercli`。
- 安装器可能建多个别名链接，其中有的与其他产品重名。TRAE CLI 0.213.1 在 `~/.local/bin` 建了 `traecli`、`trae-cli`、`trae-agent`、`coco`、`ta`，都指向 `~/.local/share/traecli/current/traex`；`trae-cli` 与开源 trae-agent 同名。只认官方文档给出的命令名，并以 `--version` 或初始化回执确认。
- macOS Desktop 不加载 `.zshrc`，需要补齐官方用户安装目录（如 `~/.local/bin`、Homebrew 前缀、应用包内路径）。
- 探测过程不得触发自动升级或写入真实配置。必须关闭自动更新时，写明使用的环境变量或参数及其来源；查不到关闭方式时，在隔离 HOME 中探测。
- 参数一律用数组传递，禁止拼接 shell 命令；带空格的路径作为单个 argv 值。

原理见 [可执行地址发现](executable-discovery.md) 与 [跨平台启动](cross-platform-launch.md)。

---

## 5、阶段 4：账号登录、隔离与退出

图形账号入口按 [图形化登录窗口开发指南](graphical-login.md) 实施：先判定单账号、多账号或桌面端托管，再核对模板、隔离 HOME 画面采集、状态确认、自动退出与原生回退；没有 CLI 登录命令的桌面托管账号不得套用 PTY 登录流程。

| 文件 | 入口 | 要做的事 |
| --- | --- | --- |
| `src/host/accounts.ts` | 状态查询、登录与退出的 argv、引导文案、超时 | 只读取本 CLI 自身的来源；状态查询有界、无 prompt |
| `src/host/account-guide/flows.ts` 及 `single-account.ts`、`multi-account.ts`、`<cli>-flow.ts` | 分步登录窗口 | 只在 CLI 原生提供可引导的登录时才使用；否则保留原生终端 |
| `src/shared/account-links.ts` | `ACCOUNT_LOGIN_HOSTS` | 只列出该 CLI 原生登录实际打印的域名，并注明观察版本与日期 |
| `src/host/cli-account-binding.ts`、`account-identity.ts` | 来源绑定 | 稳定主体与 token 字节分开；绑定变化时目录失效 |
| `src/host/windows-account-terminal.ts`、`windows-account-*.ps1` | Windows 原生账号终端 | 确认 ConPTY 下的交互与链接提取 |
| `src/client/account-login/` | 账号窗口 | 复用现有窗口，不新增风格 |

隔离规则（来自 [cli-account-isolation](../../../openspec/specs/cli-account-isolation/spec.md) 与 [qodercn-cli](../../../openspec/specs/qodercn-cli/spec.md)）：

- 选中某个版本时只用它自己的配置根和凭据；启动前清除对侧版本的运行控制变量（Qoder 清除另一前缀的 `QODER_`/`QODERCN_` 变量）。
- 检测到配置文件不等于已登录；未登录、来源改变或目录无法确认时拒绝任务，不借用另一版本的登录或已缓存选型。
- 模型列表为空不等于没有模型：TRAE CLI 未登录时 `traecli models --json` 输出 `[]` 且退出码为 0。先查登录状态，再解读目录。
- 登录方式可能藏在特性开关后面：TRAE CLI 0.213.1 的个人账号登录由 `personal_user_login`（under development，默认关）控制，只在 `--enable personal_user_login` 时出现 `login --personal`，ACP 的 `authMethods` 也不列出。用户反馈“不能登录”时，先查 `features list` 与程序字符串，再判断是否真的不支持。需要开关时只在插件启动的命令上附加，不改用户配置文件。
- 强度选项可能随模型变化：CodeBuddy 2.181.0 在 `session/new` 的每个模型 `_meta.effortOptions` 中给出各自的强度列表，帮助里的通用 `--effort` 列表不能代替。
- ACP 返回的配置项可能取决于启动参数：TRAE CLI 0.213.1 只有以 `--permission-mode <mode>` 启动 `acp serve` 时，`session/new` 才返回 `modes`（含 `plan`）；不带参数时只有 `model`。探测时要把可能影响会话的启动参数逐个试一遍，再下“不支持某模式”的结论。
- 同一模式的帮助描述与 ACP 描述可能不一致（TRAE `default` 的联网是否需审批两处说法相反），以真实任务中的审批请求为准。
- 测“工作区外需审批”时，目标路径不要放在 `/tmp` 或 `$TMPDIR`：TRAE CLI（Codex 系沙箱）把它们算作可写目录，会自动批准，得出错误结论。用用户目录下专门新建、测完即删的目录。
- 拒绝审批后的行为各 CLI 不同：CodeBuddy 拒绝一次即以 `cancelled` 结束整轮（`_meta` 带 `PERMISSION_DENIED`），TRAE 拒绝后工具失败并结束本轮。runner 要区分“因拒绝审批结束”与用户主动取消。
- 插件不代填密码、不读取凭据内容写入日志、消息或仓库；持久化目录 0700、文件 0600。
- 退出操作要等到 CLI 原生回执后再报告，并刷新绑定与目录。
- 形态 C 切换站点等同于切换账号：旧站点的目录和偏好校验全部失效。

原理见 [账号来源与执行身份绑定](account-binding.md)。

---

## 6、阶段 5：模型目录与思考强度

| 文件 | 入口 | 要做的事 |
| --- | --- | --- |
| `src/host/adapters.ts` | `catalogFor`、`validatePreference` | 新 CLI 的目录分支；扩展类 CLI 也可以走 `extendedCatalog`（`src/host/extended-adapters.ts`） |
| `src/shared/types.ts`、`src/shared/models.ts` | `ModelChoice`、`resolveModel` | 执行 `id`、显示 `label`、`efforts`、`variants` 分开保存 |
| `src/host/authorized-catalog.ts`、`settings-catalog-cache.ts`、`catalog-notice.ts` | 目录缓存与提示 | 缓存附带来源绑定；查询失败不发布成功目录 |
| `src/client/native-cli-model-directory.ts` | 子会话模型目录 | 不改动，确认新 CLI 的目录能正确显示 |

规则（来自 [cli-model-discovery](../../../openspec/specs/cli-model-discovery/spec.md)）：

- 目录只能来自当前账号实际公开的原生来源（命令输出、ACP `session/new` 的模型列表、官方元数据接口），不从显示表格或模型名推测执行 ID。
- 强度先确定属于哪一类：CLI 参数（Claude `--effort`）、配置项（Codex `-c model_reasoning_effort=…`）、ACP 配置项（Qoder `effortId: 'reasoning_effort'`），还是不同的模型 ID（`variants`）。只展示该来源实际支持的强度，不把共享 `EFFORTS` 全部列出。
- 不默认选第一项。首次选型前不启动任务（例外见 AGENTS.md：用户关闭“调用前询问模型”且已保存的完整设定仍有效）。
- 原生只提供“Auto”或“默认”这类选项时，按原生 ID 保存和显示，不替它解释成某个具体模型。

原理见 [模型与思考强度接入](model-effort-selection.md)。

---

## 7、阶段 6：参数生成与权限三档

### 7.1 参数入口

- 走原生桥的 CLI（当前除 Pi/OMP 外全部）：argv 在 runner 中生成，例如 `src/host/native-qoder.mjs` 的 `qoderAcpArgv`；模式、模型和强度在协议握手后再次确认。
- 历史执行路径：`src/host/adapters.ts` 的 `workerArguments`。新 CLI 不应再加入这条路径；如果确实只能用一次性进程，也要在规格中说明。
- 运行环境变量在 `src/host/runtime.ts` 拼装（参照 `qoderEnvironment(cli)`），只注入本版本的变量。

### 7.2 三档映射

档位定义见 [worker-permission-levels](../../../openspec/specs/worker-permission-levels/spec.md)：用户没选过档位的 Worker 跟随主对话权限（`read-only`→询问、`workspace-write`→自动审批、`danger-full-access`→完全权限）；用户选过的按所选档位运行。`levelAccess` 把档位转成 runner 收到的 `NativeAccess`。

| 档位 | 含义 | 已有映射示例 |
| --- | --- | --- |
| 询问 `ask` | 只读直接执行，改动和有副作用的命令经 DSH 审批 | Claude `--permission-mode manual`；Qoder ACP 模式 `default`；Codex `approval_policy=on-request` |
| 自动审批 `auto` | 使用 CLI 原生的自动审批 | Claude `auto`；Qoder `auto`；Codex `approvals_reviewer=auto_review` |
| 完全权限 `full` | 不再询问 | Claude `bypassPermissions`；Qoder `yolo`/`bypass_permissions`；Codex `approval_policy=never` |

规则：

- 只映射到该 CLI 实际存在的原生模式，不能把另一个 CLI 的开关套过来。
- CLI 没有原生自动审批时，中档按它真实的原生编辑模式命名（参照 ZCode、OpenCode 的“仅工作区编辑”）；第一档无法把请求转给用户时，按实际行为命名或省略（参照 Antigravity 的“仅规划”、Hermes 没有第一档）。
- 第一档要求能把审批转给 DSH（见第 10 节）。非交互模式不能转交审批时，这条通道就不能提供“询问”档。
- 未知模式和未知审批请求一律拒绝，不能默认放行。

### 7.3 规划模式

- 有原生只读规划模式时，在 `workerPlanSupported` 中声明，并在 runner 中映射（Claude `--permission-mode plan`、MiMo `--agent plan`）。
- 没有时（当前 Hermes、Qoder），`conversation-features.ts` 显示“当前 CLI 不支持规划模式”，`runtime.ts` 拒绝规划任务。不要用只读沙箱冒充规划模式，除非规格明确这样定义并写明差异。
- 主对话处于规划模式时，派遣规则以 [worker-dispatch](../../../openspec/specs/worker-dispatch/spec.md) 为准。

原理见 [权限映射与进程清理](permissions-and-cleanup.md)。

---

## 8、阶段 7：通信协议与流解析

### 8.1 选择协议

以安装版实际握手和事件为准，选择 CLI 原生的结构化通道。优先级大致为：双向且能转交审批的协议（ACP、app-server、双向 stream-json）优于一次性 JSONL，再优于纯文本。

| 协议族 | 现有实现 | 可复用部分 |
| --- | --- | --- |
| stdio ACP | Kimi、Grok、Qoder（`src/host/native-acp.mjs` 的 `runNativeAcp`） | 初始化、`session/new`/`session/load`、模型与模式配置、`session/request_permission`、取消与清理 |
| 双向 stream-json | Claude（`native-claude.mjs`）、Antigravity | 逐行 JSON、partial message、resume |
| app-server | Codex（`native-codex.mjs`）、ZCode（`native-zcode.mjs`），二者协议不同 | 只复用桥的外壳，不复用解析 |
| 原生 RPC | Pi、OMP | 独立路径，`usesNativeBridge` 返回 false |
| HTTP + SSE | MiMo、Hermes、OpenCode（`native-http.mjs`） | 回环监听、每轮认证 |

**协议同名不等于可以复用解析器。** 参数长得像 Codex 或 Claude Code 的 CLI，也要对安装版逐字段核对事件格式，不能直接套用 `codex-app-v1` 或 `claude-stream-v1` 的解析。

### 8.2 ACP 接入要点（以 Qoder 为例）

`src/host/native-qoder.mjs` 把 Qoder 的差异作为参数传给共享 runner：

- `name`、`agentName`：显示名和初始化回执中必须匹配的 agent 身份（`qoder-cli` 与 `qoder-cli-cn`）。身份不符时拒绝任务，用来防止跨版。
- `argv`：启动参数（`--acp`、权限模式、模型）。
- `effortId`、`off`：强度配置项 ID，以及“关闭”对应的值。
- `editMode`、`fallbackModes`、`modeConfigId`：三档对应的原生模式，以及某个模式不可用时允许回退到的模式。
- `sessionOption`：只选择会话级的“始终允许”（`proceed_always`），绝不选择会持久化的选项（`proceed_always_and_save`）。
- `toolName`、`onResult`：工具名提取，以及终态用量事件 `cliworker.<cli>_prompt_usage`。

### 8.3 必须实现并测试的行为

- 会话 ID：从初始化或首个事件取得原生 ID，经 `identify` 回报；恢复只能用已确认的 ID。恢复失败时不新建会话、不换 CLI、不换版本。
- 事件：正文、公开思考、工具（实际 ID、父 ID、输入、输出、终态）分开投影；没有公开 reasoning 就不合成。
- 重放：恢复时 CLI 重放的历史不得重复进入当前轮正文。
- 终态：区分正常结束、错误、取消、超时；缺少工具终态时不能报告成功。
- 取消：先发原生 cancel/interrupt，再由 Host 终止进程并核对进程范围退出；清理未确认时保留阻塞。
- transport 标记：缺省或 `legacy` 进入历史路径，未知标记直接拒绝；升级插件不改已有 Worker 的 transport。

原理见 [选择并固定原生通信协议](native-transports.md) 与 [原生通信说明](../../native-protocols.md)。

---

## 9、阶段 8：原生会话、续聊、运行中输入与分支

| 文件 | 要做的事 |
| --- | --- |
| `src/host/harness-conversation.ts`、`harness-conversation-types.ts` | 发送、目录、选型、权限、停止接到 WorkerRuntime；一般无需按 CLI 分派，确认能力矩阵正确即可 |
| `src/host/harness-conversation-stream.ts` | 事件投影成原生消息与块 |
| `src/client/harness-conversation.tsx`、`native-presentation.tsx` | 原生子会话界面，一般不改 |
| `src/shared/running-message.ts` | 有原生 steer 通道时声明；否则用原生 Inbox 在轮次清理后消费，不能把“已排队”显示成“模型已执行” |
| `src/shared/conversation-features.ts`、`src/host/worker-fork.ts` | 分支：只有安装版确认了原生 fork 接口与回执才声明支持 |

续聊必须核对同一 CLI、同一版本、同一 transport 和同一账号。账号变化后的续接规则见 `src/host/cross-account-resume.ts` 与 `carryover-context.ts`。

原理见 [接入 Harness 原生会话](native-conversation-integration.md)。

---

## 10、阶段 9：原生工具与 DSH 工具桥

- **原生优先**：CLI 自带的文件、命令、搜索、网页和 skill 工具优先使用；DSH 工具只作为备选，经工具桥提供。
- 在 `cli-native-capabilities.mjs` 声明能力类别；在 `nativeSkillPaths` 登记该 CLI 读取的用户与项目 skill 目录。
- 工具桥（规格见 [harness-cli-tool-bridge](../../../openspec/specs/harness-cli-tool-bridge/spec.md)）：
  - `native-harness-injection.mjs`：把新 CLI 加入注入列表与 `nativeHarnessExecutionReady`，前提是该 CLI 能通过命令行参数或 ACP `mcpServers` 加载 MCP，且不改写用户自己的 MCP 配置。
  - `native-harness-mcp.mjs`：stdio MCP 服务，读取 `CLIWORKER_HARNESS_TOOLS` 连接信息，一般不改。
  - `native-harness-tools.ts`、`native-harness-executor.ts`：执行与回执，一般不改。
- 工具调用的展示：只有命令的工具条目以命令作参数（[native-cli-conversations](../../../openspec/specs/native-cli-conversations/spec.md)）；超大工具事件按 [native-output-budget](../../../openspec/specs/native-output-budget/spec.md) 截断成摘要。

原理见 [工具桥](../architecture/authorized-tool-bridge.md) 与 [原生 Harness 工具](../../native-harness-tools.md)。

---

## 11、阶段 10：原生审批转交

规格见 [native-permission-relay](../../../openspec/specs/native-permission-relay/spec.md)，纯函数决策在 `src/host/native-approval-policy.ts`。

1. 把原生授权请求映射为 `NativeApprovalRequest`（`kind`、`summary`、`detail`、`allowSession`）。ACP 统一用 `native-acp.mjs` 的 `acpApprovalRequest`。
2. 决策来源按规格处理：完全权限、规划模式、预设、用户回复、不可用、已停止、无效。
3. 弹窗位置：主 Agent 发起的轮次，在主页面以提问卡片询问；用户在 Worker 窗口续聊的轮次，用子会话原生审批面板。
4. “本会话始终允许”只能映射到 CLI 的会话级授权，不能写入持久规则。
5. 等待审批期间暂停空闲时限；用户拒绝时 CLI 不执行该操作。
6. CLI 的非交互模式不能转交审批时（例如文档写明不支持 permission prompt 工具），这条通道只能提供不需要询问的档位，或者改用能转交审批的通道（如 ACP）。

---

## 12、阶段 11：子 Agent、记忆与其他原生功能

- 原生功能默认启用，关闭必须在 [cli-native-features](../../../openspec/specs/cli-native-features/spec.md) 中写明理由。
- 子 Agent：v0.8.7 起跟随原生设置（变更 `add-sibling-dispatch-unified-subagents`，合入主规格前以该变更为准）。协议公开了子 Agent 的独立会话与事件时，作为同级条目显示；否则作为该 Worker 对话里的工具步骤显示，不伪造独立会话或进度。任务树始终只有“主对话 → Worker”两层。
- 记忆：跟随用户原生设置。启用时与用户直接使用该 CLI 共用同一份原生记忆目录，不复制；判断开关时不读取凭据文件（参照 `shareNativeMemory`、`grokTomlMemory`）。
- 其他原生功能（定时任务、远程服务、worktree、联网搜索等）：逐项判断是否会越出单个 Worker 的生命周期或权限边界。会越出的功能默认不在 Worker 中启用，并写明理由（例如会常驻后台的远程服务模式）。

---

## 13、阶段 12：遥测与用量

| 文件 | 要做的事 |
| --- | --- |
| `src/host/telemetry.ts` | 新原生事件类型 `cliworker.<cli>_*` 进入白名单，并核对 CLI、会话、轮次与来源 |
| `src/shared/native-turn-usage.ts`、`native-usage-report.ts`、`native-model-display.ts` | 每响应、本轮、会话累计、当前上下文分开；积分单独标记单位 |
| `src/host/harness-turn-usage.ts`、`native-supplemental-context.ts` | 逐轮归属与补充上下文 |
| `src/client/telemetry.tsx`、`harness-telemetry-data.ts` | 积分型 CLI 设置 `creditsBased`（参照 Qoder） |

没有公开的数据保持“未知”或“未公开”，默认零不能当作已报告的零。形态 A 的两个版本不能互相补读用量或上下文。原理见 [原生数据接口](native-data-interfaces.md) 与 [遥测口径](../architecture/telemetry-semantics.md)。

---

## 14、阶段 13：品牌图标

1. 素材目录：`doc/assets/cli-icons/v<N>-<name>/`，编号接着已有目录（当前到 `v4-qoder`）。
2. 目录内容（参照 [v4-qoder](../../assets/cli-icons/v4-qoder/README.md)）：
   - 原图 PNG，透明背景；
   - `manifest.json`：`name`、`file`、`runtime_file`、`downloaded_on`、`source_page`、`source_context`、`source_url`、`source_bytes_unchanged`、`generated`、尺寸、`corner_alpha`、`alpha_extrema`、主体包围盒、`optical_scale`、`optical_translate_percent`、`dark_filter`；
   - `README.md`：来源、处理方式与透明度检查；
   - `preview.html`、`preview.png`：明暗背景、常用尺寸的预览；
   - 生成或改绘素材时附 `prompts.json`，并把 `generated` 记为 `true`。
3. 运行图复制到 `src/client/assets/<cli>.png`，在 `src/client/icons.tsx` 静态导入，填写 `icons` 与 `optical`（`scale`、`x`、`y`、`mono`）。
4. 明暗主题：单色图标设 `mono: true`，暗色主题统一反色；彩色图标需要明暗两版时按 Kimi 的做法提供 `<cli>-light.png` 与 `<cli>-dark.png`。不能对所有彩色图标直接反色。
5. 形态 A 的两个版本品牌相同时可以共用一张图（`qodercn: qoder`）；品牌不同时分别提供。
6. 只用官方页面上可追溯的原件，记录 URL 与下载日期，不远程加载。
7. 验收：在设置列表、Worker 卡片、选择器的明暗主题下目视核对，并检查透明边缘与裁切。

原理见 [品牌图标接入](brand-icons.md)。

---

## 15、阶段 14：设置页

- CLI 连接列表由 `CLI_IDS` 驱动（`src/client/settings-dialog.tsx`），新 CLI 注册后自动出现；默认启用状态、排序与已有项目保持一致。
- 连接页的内容（账号与登录、项目默认设置、高级设置中的运行中发送与 CLI 路径管理）复用现有组件：`cli-executable-settings.tsx`、`running-message-settings.tsx`、`native-settings-choice.tsx`。
- 新增或调整任何设置项之前，先读 [设置页统一设计规范](../../settings-ui-design.md)，沿用其中的文字层级、16px 内容留白、分隔线与控件规则。修改设计参数时同步该文档。
- 新的界面文案加入 `src/client/i18n-messages.ts`；CLI 产品名（`CLI_LABELS`）保持原文，不翻译。
- 不为某个 CLI 单独设计新的页面结构；确有需要时先在 OpenSpec 设计中说明。

---

## 16、阶段 15：Windows 与 macOS 平台差异

| 方面 | macOS | Windows |
| --- | --- | --- |
| 发现 | Desktop 不读 `.zshrc`；补用户安装目录、Homebrew、应用包内路径 | npm shim（`.cmd`/`.ps1`）、用户目录、安装器默认目录、App Paths、卸载信息 |
| 启动 | 固定 Node/Bun 入口 | 后台隐藏窗口（`windows-hidden-process.ts`）、ConPTY 账号终端、进程树回收 |
| 凭据 | 钥匙串（参照 Antigravity 的 macOS 账号读取） | Credential Manager 或用户目录文件 |
| 网络 | 系统代理一般已被继承 | 只开 WinINET 代理时 CLI 拿不到代理，插件自动注入（`windows-system-proxy.ts`）；注意代理分支缺 UA 等问题 |
| 沙箱 | CLI 原生 seatbelt 等 | 原生沙箱初始化可能需要首次交互（TRAE CLI 文档建议优先 WSL2） |

两个平台的证据分别记录，不能互相代替。Windows 远程测试见 [Windows 远程测试指南](../../windows-remote-testing.md) 与 [windows-remote-verification](../../../openspec/specs/windows-remote-verification/spec.md)。

---

## 17、阶段 16：自动化测试

参照 Qoder CN 的测试文件，为新 CLI 至少补齐以下回归。模拟夹具在文件名或用例名中标明“模拟”。

| 主题 | 参照文件 | 覆盖内容 |
| --- | --- | --- |
| 接入与路由 | `tests/qodercn-integration.test.ts`、`tests/qoder-routing.test.ts` | 身份、别名、泛称路由、两版同时安装时的询问、跨版拒绝 |
| 协议 runner | `tests/native-qoder.test.ts` | 握手、身份校验、分帧、迟到与重放、缺字段、错误、取消、恢复 |
| 账号 | `tests/qodercn-accounts.test.ts`、`tests/cli-account-binding.test.ts` | 只读自身来源、对侧变量清除、未登录拒绝、退出 |
| 遥测 | `tests/qodercn-telemetry.test.ts` | 来源核对、未知保持未知、两版不互补 |
| 权限 | `tests/worker-permissions.test.ts` | 三档名称、映射、规划模式拒绝、仅可查看下的行为 |
| 工具桥 | `tests/native-harness-tools.test.ts` | 注入与回执 |
| 分支 | `tests/native-fork.test.ts`、`tests/worker-fork.test.ts` | 支持或拒绝理由 |
| Windows | `tests/windows-cli-installation.test.ts`、`tests/windows-cli-resolution.test.ts`、`tests/windows-accounts.test.ts` | 安装线索、路径解析、账号终端 |
| 账号界面 | `tests/account-terminal.test.tsx` | 登录链接域名白名单 |

日常执行与改动范围对应的最小集：`pnpm typecheck`、相关 `pnpm test -- <文件>`、`pnpm build:preview`。发布验收范围见 [development-workflow](../../../openspec/specs/development-workflow/spec.md)。

---

## 18、阶段 17：真实验收清单

真实验收需要已安装的 CLI、可用账号和用户的选型授权。CLI 自己说“完成”不算证据，必须检查事件、退出状态和实际产物。

| 层级 | 检查项 | 证据 |
| --- | --- | --- |
| 安装与初始化 | `--version`、`--help`、协议握手、初始化回执中的身份 | 命令输出摘要、版本号 |
| 账号 | 未登录状态、登录、状态查询、退出；形态 A/C 的两版或两站点隔离 | 状态回执（不含凭据） |
| 目录 | 模型与强度列表、来源绑定、切换账号后失效 | 目录快照（模型 ID 与来源） |
| 隔离包与 Desktop | `pnpm build:preview` 后在 Desktop 加载；连接页、图标明暗、Worker 卡片 | 截图或页面文本核对 |
| 真实任务 | 读文件、改文件（产物核对）、命令审批（允许与拒绝各一次）、同会话续聊、运行中停止（进程退出核对）、规划模式或其拒绝 | 事件记录、退出码、文件 diff |
| 工具桥 | 调用一次 DSH 备选工具并核对回执 | 工具事件 |
| 平台 | macOS 与 Windows 分别执行 | 两份记录 |

订阅、套餐或权限阻塞、未执行的平台、缺失的指标，都要在该变更的 `tasks.md` 中如实保留，不能虚勾。证据层级说明见 [新 CLI 最小验收](integration-acceptance.md) 与 [证据层级](../verification/evidence-levels.md)。

---

## 19、阶段 18：文档同步与归档

| 文档 | 更新内容 |
| --- | --- |
| [README.md](../../../README.md)、README.en.md | “支持的 CLI”列表、安装与登录要点 |
| [AGENTS.md](../../../AGENTS.md) | “目标与边界”中的 CLI 列表 |
| [doc/usage-details.md](../../usage-details.md)、usage-details.en.md | 账号、路径、模型规则、支持范围与验证边界 |
| [doc/design.md](../../design.md) | 架构与决策记录 |
| `doc/<cli>-protocol.md` | 协议与安装版实测结果 |
| 本目录的原子笔记 | 行为变化时同步相关笔记；新增的通用方法补进本文 |
| `openspec/specs/` | 增量合入主规格后归档变更；先核对规格、实现和验收证据 |

---

## 附录 A：Qoder CN 接入对照表

| 阶段 | Qoder CN 的实际落点 |
| --- | --- |
| 形态判定 | 形态 A：`qoderclicn`、`@qodercn-ai/qoderclicn`、`.qoder-cn`、`QODERCN_`、站点 `cn`（`src/host/qoder-variant.ts`） |
| 规格 | [qodercn-cli](../../../openspec/specs/qodercn-cli/spec.md)、[qoder-cli](../../../openspec/specs/qoder-cli/spec.md)；协议见 [qodercn-protocol.md](../../qodercn-protocol.md) |
| 身份 | `CLI_IDS` 中的 `qodercn`、名称 `Qoder CN CLI`、短名 `qodercn`；别名包括“qoder 中国版”“国内版 qoder” |
| 路由 | `src/host/routing.ts`：泛称 qoder 时按安装分流；`src/host/index.ts`：两版都安装时用宿主原生询问框选择 |
| 配置 | `qodercnExecutable`，默认 `qodercn` |
| 发现 | `src/host/windows-cli-installation.ts` 的 Qoder 分支，拒绝把对侧版本当本版 |
| transport | `qodercn-acp-v1`；runner `native-qoder.mjs` 的 `runNativeQoder`，与国际版共用 |
| 账号 | `accounts.ts` 中的本版 PAT 与 `/login`、`/logout` 指引；`ACCOUNT_LOGIN_HOSTS.qodercn = ['qoder.cn']`；单账号 |
| 目录 | `discoverQoderModels`：原生结构化目录，自验证发现（`selfVerifiedDiscovery`） |
| 权限 | 三档：`default` / `auto` / `yolo`；无规划模式（`workerPlanSupported` 返回 false） |
| 审批 | ACP `session/request_permission`；会话级只选 `proceed_always` |
| 遥测 | `cliworker.qodercn_prompt_usage`、`cliworker.qodercn_context`；积分口径 |
| 图标 | 与国际版共用 `qoder.png`（`v4-qoder`） |
| 测试 | `tests/qodercn-integration.test.ts`、`qodercn-accounts.test.ts`、`qodercn-telemetry.test.ts` 等 |

## 附录 B：交付物核对表

- [ ] 调研表与形态判定已写入 PRD 与 OpenSpec 提案，每一项都有来源
- [ ] OpenSpec 变更创建，`pnpm spec:check` 通过
- [ ] 第 3 节表中的入口逐项处理，或写明不支持的理由
- [ ] 发现、启动、构建资源在 macOS 与 Windows 上都能解释
- [ ] 账号只读自身来源，登录、状态、退出都有回执
- [ ] 按 [图形化登录指南](graphical-login.md) 核对窗口形态、真实画面 marker、模板与链接白名单、退出/换号状态确认及清理；桌面托管账号单列外部管理入口，未采集和未验收项保持可见
- [ ] 目录来自原生来源，强度映射有依据
- [ ] 三档映射与规划模式按实际能力声明，未知请求拒绝
- [ ] 协议 runner：会话 ID、事件、重放、终态、取消、恢复都有测试
- [ ] 审批转交、工具桥、子 Agent、记忆按规格处理
- [ ] 图标素材目录、运行图、明暗核对完成
- [ ] 设置页遵循设计规范，新文案已加入 i18n
- [ ] 关联回归、类型检查与隔离构建通过
- [ ] 真实验收分层记录，阻塞与未验证项如实保留
- [ ] README、AGENTS.md、usage-details、design、协议文档与规格同步

## 关联笔记

[接入索引](README.md) · [注册与能力声明](cli-registration.md) · [通信协议](native-transports.md) · [账号绑定](account-binding.md) · [模型与强度](model-effort-selection.md) · [权限与清理](permissions-and-cleanup.md) · [最小验收](integration-acceptance.md) · [v0.8.8 PRD](../../prd/2026-11-07-v0.8.8-PRD.md)
