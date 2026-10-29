# 原生 CLI 的 Harness 工具与技能桥

适用开发版本：v0.8.4 之后的开发版。更新日期：2026-10-28（原生优先目录，见 `openspec/changes/archive/2026-10-29-scope-harness-bridge-tools/`）。CLI 继续运行自己的 Agent、已选模型、思考强度及原生会话；Harness 提供真实子 Agent 身份、工具权限链和完整原生对话页。CLI Worker 通过宿主公开导航打开该直接子会话，保留父绑定和 `origin: subagent`；不在普通会话列表新增根会话。本文区分当前实现、模拟回归及此前冻结预览的真实证据。

## 能力与验收等级

这里区分三件事：CLI 有接入口、插件能在现有隔离下临时注入、真实 CLI 模型已经调用并收到 Host 工具结果。前两项不能代替第三项。`executionReady` 表示当前已实现明确的原生准入与 Host 执行链；实际工具执行仍逐次鉴权。未准入的接入口只能提供目录，不允许执行。

| CLI | 当前任务协议 | 本轮临时接入口与隔离 | 当前工具执行准入 | 本轮已有证据 |
|---|---|---|---|---|
| Codex | app-server JSON-RPC / stdio | 参数内配置专属 `mcp_servers.dsh_worker_tools`；私有连接只通过子进程环境传递 | 仅该 server 的 `default_tools_approval_mode=approve`，Host 继续鉴权 | 冻结预览下真实只读 canary 一轮通过，Host 调用 1 次，工具、端口与进程退出均有证据 |
| Claude Code | 双向 stream-json / stdio | 临时 `--mcp-config`；`env` 用变量引用，参数不含连接令牌 | 仅 `mcp__dsh_worker_tools__*` 加入 `--allowedTools` | 参数、模拟 MCP 回归；尚需检查原生 init 中 server 状态与实际工具回执 |
| OpenCode | 私有 serve HTTP + SSE | 合并本轮 `OPENCODE_CONFIG_CONTENT.mcp`，保留其它配置；同名 namespace 冲突拒绝 | 仅 `dsh_worker_tools_*` allow，原有 `* ask` 与原生工具限制保留 | 冻结预览包只读 canary 真实调用一次通过；续聊/工具取消已取证，整体还有父会话通知唤醒边界待修，见下文 |
| 官方 MiMo Code | 私有 serve HTTP + SSE | 同上，使用其自身 `MIMOCODE_CONFIG_CONTENT`，不套用其它品牌环境变量 | 同 OpenCode 的精确桥 namespace 准入 | 官方 v0.1.15 schema 与模拟桥回归；本轮未新增真实模型调用工具验收 |
| Kimi | ACP / stdio | `session/new`、`session/load` 的 `mcpServers` stdio 描述符 | 本轮实时目录内精确结构化工具名可选 allow_once，Host 再逐次鉴权 | 配置和准入分支的模拟回归通过；真实模型工具调用待核验 |
| Grok Build | ACP / stdio | 同 ACP 的 run 专属 stdio MCP 描述符 | 同 Kimi 的精确目录与一次准入 | 配置和准入分支的模拟回归通过；真实模型工具调用待核验 |
| Qoder | ACP / stdio | 原生 session/new、load 的本轮 stdio MCP 描述符 | 同 Kimi 的精确目录与一次准入 | 结构化工具名及 prompt 附件回归通过；Windows 实际验收见 doc/tasks.md |
| ZCode | app-server JSON-RPC / stdio | 不注入目录（2026-10-28 起）；session create/resume 的 `mcpServers` 入口保留在代码中，待执行核验后再启用 | 未准入执行；任务记录写明「ZCode 工具桥执行尚未核验，未注入 DSH 工具目录」 | 安装版 schema 与定向回归；未做真实模型工具验收 |
| Pi | `--mode rpc` | 保留 `--no-extensions`，只显式加载插件扩展；先读取获准 schema，再精确扩展 `--tools` | 只注册 run 目录内工具；每次调用使用原生 toolCallId，经 Host 执行 | 安装版 loader 无模型往返及冻结预览真实只读 canary 一轮均通过；真实 Host 调用 1 次 |
| OMP | `--mode rpc` | 当前不可用；不移除 `--no-extensions` | 禁用，给出隔离模式忽略显式扩展的原因 | OMP 16.4.4 零 prompt `get_state` 正常退出，但未加载扩展、无桥 schema 请求；见下文 |
| Hermes | 私有 gateway Runs HTTP + SSE | 当前 `HERMES_SAFE_MODE` 的隔离运行没有已核验的 run 专属注入方案 | 禁用并说明原因 | 不因普通 MCP 配置存在就解除当前隔离；未做真实模型工具验收 |
| Antigravity | 双向 stream-json / stdio | 本轮私有 `agy-tools` 工作区（`.agents/mcp_config.json` + PreToolUse Hook）经 `--add-dir` 加入；服务器名 `dsh_worker_<绑定哈希>`，不改用户项目与全局配置，见 [antigravity-harness-bridge.md](antigravity-harness-bridge.md) | Hook 仅对与本轮实时目录完全匹配的桥工具返回 `auto_approve`，Host 仍逐次鉴权 | 离线回归与隔离构建通过；Windows Desktop 真实工具/Skill 验收未完成（`integrate-native-cli-conversations` 20.4 未勾选） |

2026-10-18 的附件、平台及逐 CLI 当前状态统一见 [能力矩阵](cli-harness-capabilities.md)。下文冻结预览的真实 canary 属此前证据，不等于本次 Windows 已验证所有 CLI。

此矩阵只描述新增 DSH 工具桥。CLI 自己的工具、既有登录、模型路由、严格引导或排队能力继续按各自协议处理；工具桥不会把双向 stdin 解释成当前轮引导。

## 原生工具优先（2026-10-28）

CLI 默认使用自己的原生工具和 skill，DSH 工具只作备选。`src/host/cli-native-capabilities.mjs` 按 CLI 与任务模式给出当前启动参数下实际启用的原生能力类别（file-read、file-write、search、shell、web、image-read、skills）；Pi 的 `--tools` 白名单与 Grok 的网页开关直接读同一模块，日后重新启用某原生能力时，对应 DSH 工具自动退出目录。

- DSH 工具按精确名称映射类别（dsh-base 0.2.1-rc.2 的子 Agent 目录已用无模型方式导出核对）：`read`→file-read；`write`/`edit`/`str_replace_editor`→file-write；`grep`/`glob`→search；`bash`/`pwsh`/`working_directory`/`terminal_*`/`job_*`→shell；`web_search`/`web_fetch`→web；`read_image`→image-read；`skill` 不交出（DSH 技能只经 `dsh_read_skill` 按需读取）。`tools.schemas()` 不暴露来源插件，因此不按插件判断；未列名称视为 DSH 独有，照常作为备选。
- 类别已被原生覆盖 → 不交出，也不可经桥调用；规划模式刻意不提供写入，DSH 写工具同样不作备选。其余交出，描述前缀「备选（DSH）：仅在 CLI 自身工具无法完成时使用。」。能力表为空（未知 CLI）时恢复全部交出。
- 同名 MCP：Host 只读取 CLI 原生配置中的服务器名称（不读值），DSH 中只有身份确定的 `mcp__<同名>__<工具>` 不交出；名称经过规范化或加哈希，或剩余部分仍含 `__` 时，仍保留为备选。已禁用的原生服务器不算覆盖。来源：Codex `$CODEX_HOME/config.toml`，以及从项目根到当前目录各层的 `.codex/config.toml`。项目根与 Codex 0.162 一致：取最近的 `project_root_markers`（默认 `.git`，空目录不算）；没有项目根或标记为 `[]` 时，只读当前目录这一层。后层的 `enabled` 生效，多行字符串内的示例行不计；`developer_instructions` 检测使用同样的层次；Claude `~/.claude.json` 的用户与当前项目服务器（扣除 `disabledMcpServers`），以及项目 `.mcp.json` 中已批准的服务器；Kimi `$KIMI_CODE_HOME/mcp.json`、git 根 `.mcp.json`、项目 `.kimi-code/mcp.json`；Grok（私有 `GROK_HOME` 不继承 `~/.grok`，但仍扫描）`~/.claude.json`、`~/.cursor/mcp.json`、项目 `.mcp.json`；Antigravity `~/.gemini/config/mcp_config.json`。Qoder 的用户 MCP 位置未核实，不去重；OpenCode/MiMo/Pi 的用户 MCP 已被插件隔离。
- 技能声明的 `requiredTools` 按「获准」而非「交出」判断：被原生覆盖而未交出的工具仍算满足，技能步骤由 CLI 原生工具完成。2026-10-28 本机已安装技能均未声明 `requiredTools`。

| CLI | 原生类别（写任务） | 原生优先说明入口 | MCP 图片结果 |
|---|---|---|---|
| Codex | 读、写、搜索、shell、看图、skills | `thread/start`/`thread/resume` 的 `developerInstructions`；用户已配置 `developer_instructions` 时不发送（该字段会取代而非拼接） | 未核实，按不支持处理 |
| Claude Code | 读、写、搜索、shell、web、看图、skills | `--append-system-prompt`（追加；恢复会话默认沿用首轮系统提示快照） | 支持 |
| OpenCode / MiMo | 读、写、搜索、shell、web、看图 | `prompt_async` 的 `system`（MiMo 加 `systemMode: "append"`，只取首轮） | 支持 |
| Pi | 读、搜索、看图（写任务加写）；无 shell、web | `--append-system-prompt`（进入原生 addendum） | 扩展桥当前只接受文本，按不支持处理 |
| Grok | 读、写、搜索、shell、skills；web 关闭（规划模式无写和 shell） | 新会话 ACP `_meta.rules`（追加）；恢复会话不重发，持久性未核实 | 未核实 |
| Kimi | 读、写、搜索、shell、web、skills | 当前 ACP 无已核实入口，不加说明 | 支持 |
| Qoder | 读、写、搜索、shell、web、skills | `--append-system-prompt` 在 ACP 下是否生效未核实，不加说明 | 未核实 |
| Antigravity | 读、写、shell；原生 grep/glob 已退役、web 暴露未核实，DSH 搜索与网页保留为备选 | 无追加入口（自定义 agent 会替换提示），不加说明 | 未核实 |

说明只列实际交出的工具名（目录在运行开始时的快照），内容为三行：原生工具与 skill 优先；`dsh_worker_tools` 仅在原生工具缺失或失败时使用；备选工具执行仍需宿主授权。不改写用户任务，不覆盖 AGENTS.md/CLAUDE.md 等指令文件。

Codex 注入同时设置 `mcp_servers.dsh_worker_tools.tool_timeout_sec` 为本次任务时限（秒）：宿主审批没有独立等待上限，Codex 默认 60 秒会先于审批或长工具超时。

非文本结果：CLI 的 MCP 支持图片时，Host 把 `ToolExecutionResult` 中的图片附件读为内联 base64 透传（受桥 1 MiB 响应上限约束）；不支持的 CLI 保持「非文本内容尚不支持」并标为错误。`read_image` 只能返回图片：CLI 原生能看图时按重叠排除，原生不能看图且 MCP 不支持图片时在目录阶段排除。

## 身份、权限与模型边界

`native-harness-tools.ts` 创建只监听 `127.0.0.1` 的 run 专属 HTTP 端点。MCP carrier 或显式扩展使用随机令牌及固定的 parent / Harness child / Worker / run / CLI 五元身份；浏览器 Origin 请求、令牌错误和身份替换均拒绝。连接令牌只注入当前子进程环境，不进入任务 argv、request JSON、账号快照或公开事件。

工具目录通过动态回调读取真实子 Agent 的 `child.ctx.tools.schemas(child)`，包含其作用域下已配置的 MCP 与普通工具。分类依据是当前目录中的精确身份，不再以 read/write/edit/bash 固定白名单排除全部 MCP；目录外名称仍为 unknown，名称或 MCP 前缀本身不构成授权。新工具列表按当前目录生成；调用、缓存回执和技能依赖重新核验目录，运行中撤销的工具不能继续调用或返回旧回执。实际执行使用 `child.ctx.tools.execute({ agent: child, callId, name, arguments, signal })`，保留宿主权限、审批、取消和规划策略；不直接调用 definition.execute。

内部子 Agent 继承所属父会话权限；plan Worker 设置宿主公开 read-only sandbox 和 planMode，目录与执行仍由其真实作用域和宿主工具策略决定。桥本身不自动批准宿主工具，不把读取目录视为执行授权。专属 MCP namespace 的 CLI 准入仅用于访问这条受控桥。

明确的 CLI Worker/Agent 递归派遣入口、run_code 与子 Agent 管理入口继续排除。工具中的 DSH 额外模型生成由 `withinCliTool` 的异步调用归属和 `llm/stream` 守卫明确拒绝，不能回退到 DSH API。已配置 MCP 的服务端模型能力仍归该 MCP 服务本身；桥不接管外部服务的内部执行。该目录继承并不等于每个第三方服务均已完成真实调用验收。

`ToolExecutionResult` 的公开 text 内容按原文及顺序转成 MCP content，并保留 `isError`，不把 Host 拒绝转换为 MCP 成功文本。执行内部的 value/error/meta 不作为另一段 JSON 泄露。图片在支持的 CLI 上按上一节透传；其余图片、文件附件引用和额外上下文尚无忠实的跨 CLI 投影：混合结果保留已有文本，在不支持的内容位置给出明确说明，并将整体标为 `isError: true`；额外上下文以附加说明标明。桥不读取 execution-local value 绕过宿主输出策略，也不泄露附件引用。

每个 carrier 的请求 ID 保持稳定。同一 ID、同一参数共用同一个执行结果；同一 ID 改参数拒绝。连接中断或状态不明不会自动重试。MCP cancellation 和 Pi 的原生 AbortSignal 取消精确调用；停止后拒绝新请求，并等待已在执行的工具结束，随后回收端点和子进程。忽略取消的 Host 工具仍必须结束后才能确认清理完成。

## 技能与资源

桥通过当前子 Agent 的公共 `skills.list/get` 按需读取，只显示 `modelInvocable` 的获准技能摘要；读取正文前再次验证目录归属，不把所有技能正文写入初始 prompt，也不修改用户 global skills。三个管理工具是 `dsh_list_skills`、`dsh_read_skill`、`dsh_read_skill_resource`。

技能声明的 `requiredTools` 必须均在当前 Host 授权目录中，否则读取拒绝；正文和资源即使重发同一请求 ID，也在返回缓存结果前重核技能可见性和依赖。未声明依赖时明确标为 `unverified`，不把它解释为外部 MCP 和模型依赖都已接通。本地资源只允许技能公共 `resourceBase` 目录内的相对文件，拒绝目录逃逸、外部软链接、硬链接和读取期间路径替换；返回有界 base64。MCP resources/read 只接受该技能资源 namespace，不调用宿主的私有资源运行时，也不开放任意文件读取接口。

## 本轮目录继承回归

2026-10-16 执行 `pnpm test tests/native-harness-tools.test.ts tests/native-harness-extended.test.ts tests/harness-model-guard.test.ts`，3 个文件、32 项通过。测试使用已安装 rc.2 的 ToolRuntime、MCP 适配器及真实父子 scope 权限链，上游 MCP 和模型响应为明确模拟：覆盖父权限隐藏、原生 pre-execute 拒绝、同请求去重、目录撤销后的新调用及旧回执拒绝、技能撤销、MCP 错误、精确取消，以及 MCP 工具内部 DSH 模型调用被守卫阻止。这些测试没有调用真实 CLI、外部 MCP 或真实模型；完整原生界面和后续构建验收另见 `doc/tasks.md`。

## 此前 Pi / OMP 安装版核验

Pi 1.0.4 的安装源码 `dist/core/resource-loader.js:405` 在 `noExtensions` 时保留 CLI 显式 extension 路径。`dist/core/extensions/loader.js:231` 提供公开 `registerTool`，`types.d.ts:494` 的 execute 参数包含原生 toolCallId 与 AbortSignal。无模型核验实际使用已安装的公共 loader 加载本插件扩展、注册一个模拟 schema，并通过本轮端点调用一次模拟 Host 工具：loader errors=0、注册成功、Host calls=1、model requests=0。这证明 loader 和桥执行链，不是模型选择工具的真实验收。

OMP 16.4.4 的帮助文本虽然声称显式 `-e` 在 `--no-extensions` 下仍可用，安装 binary 的 startup 实现却先在 noExtensions 时将扩展列表置空，随后再次将 `additionalExtensionPaths=[]`。2026-10-16 零 prompt 核验使用全新临时 HOME、模拟离线模型元数据、`get_state`，确认 exit=0、signal=null、桥目录请求=0、state 中没有该扩展工具、生成请求=0。不能以帮助文本和 Pi 的实现代替这个结果，因此 OMP 保持禁用，不移除隔离参数去恢复用户扩展发现。

## 代码与公开依据

### 2026-10-16 此前冻结预览的最小真实 OpenCode 验收

沿项目保存的 `zhipuai-coding-plan/glm-5.3-flash`、`low`，使用隔离预览 Host SHA-256 `5dd7f0a6c573012bc82d0c4839ea1c37a1beb0e8a2e905e935d7e0a698734243`。测试只授予已知只读的 `read_canary`，使用真实 rc.2 内部 child 与 `tools.execute`，不代表所有生产工具均已逐个真实验证，也不代表 plan 模式允许一般工具。

首轮报告 `.test-data/native-conversation-081/opencode-tools-run-F8wzq6/report.json`：Host 工具执行 1 次、`tools/pre-execute` 1 次、CLI 返回值精确匹配、Worker completed、两个 managed process ranges 均退出。此前旧预览包漏传连接的失败保留在 `opencode-tools-run-gA8Sp8/report.json`；该轮 Host 调用为 0，未计通过。

同一私有 Worker、Harness child 与 OpenCode 原生 session 恢复后的两轮记录在 `F8wzq6/continuation-report.json`：精确短标记续聊通过；取消轮进入 Host 工具后收到 AbortSignal，stop/done 均为 interrupted，两轮工具桥端口均关闭，四个 managed ranges 全部退出。

这份后续报告仍保持整体 `passed=false`：官方子会话结束通知 `subagent-settled` 唤醒父 Agent，产生一次非 CLI provider 的模型尝试，被测试硬守卫在 API 调用前阻断。此发现不能以协议或取消证据通过掩盖；Host 通知边界修复和相应零模型回归完成前，不把这三轮合并计为完整端到端通过。冻结预览合计 3 个模型轮次，没有重试续聊或取消。

### 2026-10-16 此前冻结预览的 Codex / Pi 协议家族真实调用

复用上述第三预览的冻结协议与 MCP 字节，仍以 `5dd7f0a6...` 校验 Host 构建，并在各报告记录 runner、工具桥和扩展的完整 SHA-256。此处验证独立任务工具协议，不作为之后最终 UI 包 hash 的验收。

- Codex：沿确切保存的 `gpt-5.6-luna`、`low`，私有 `codex-tools-run-PWpkRB/report.json`。一轮只读 canary；Host 调用及真实权限链各 1 次，`codex-app-v1` 原生工具完成、精确回复匹配、真实内部 child、DSH 模型尝试 0、工具桥端口已关闭，两个 managed ranges 均 exit 0、signal null 且 empty。
- Pi：沿确切保存的 `zai-coding-cn/glm-5.3`、`low`，私有 `pi-tools-run-OxJqGt/report.json`。一轮只读 canary；实际走受控显式 extension，Host 调用及真实权限链各 1 次，`pi-rpc-v1` 原生工具完成、精确回复匹配、真实内部 child、DSH 模型尝试 0、工具桥端口已关闭，五个 managed ranges 均 exit 0、signal null 且 empty。

两项均 `passed=true`，没有续聊、取消或重试，未运行没有保存选型的 Claude / MiMo。测试入口在 ignored 的 `.test-data/native-conversation-081/primary-tools.ts`，只加载各自已保存的选型，并只授予已知安全 canary；不代表生产正向集合之外的任意工具已获准或完成验证。

- 实现：`src/host/native-harness-tools.ts`、`native-harness-mcp.mjs`、`native-harness-injection.mjs`、`native-harness-extension.mjs`；原生注入分别进入现有 runner，未新增任务通信协议。
- 定向测试：`tests/native-harness-tools.test.ts`、`tests/pi-omp-adapter.test.ts` 及原有原生 runner suites。模拟夹具与已安装 SDK 无模型核验均不等同于真实 CLI 模型验收，后续真实证据记录到 `doc/tasks.md`。
- 隔离 canary 验收只暴露一个已知只读的测试工具，用来验证真实 CLI→MCP→真实 ToolRuntime 的传输与回执。它不等同于本轮按真实子 Agent 目录转发一般 MCP 工具的端到端验收；旧冻结包的 plan 工具目录为空。
- [Codex MCP 配置参考](https://developers.openai.com/codex/config-reference/)：stdio command/args/env_vars 与该 server 的工具 approval 配置。
- [Claude Code MCP 文档](https://code.claude.com/docs/en/mcp)：临时 MCP 配置、环境变量引用以及 init 中 MCP 加载错误的公开字段。
- [OpenCode MCP 文档](https://opencode.ai/docs/mcp-servers/) 与 [MiMo v0.1.15 config 源码](https://github.com/XiaomiMiMo/MiMo-Code/blob/v0.1.15/packages/opencode/src/config/config.ts)：本地 command array/environment 配置。
- [Pi v1.0.4 resource loader 源码](https://github.com/earendil-works/pi/blob/v1.0.4/packages/coding-agent/src/core/resource-loader.ts) 与 [公开 extensions 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)。OMP 边界以当前安装 16.4.4 的实际 startup 与零 prompt 结果为准，不推断其它版本相同。
- Kimi、Grok、ZCode 任务协议及公开入口继续参考 `doc/native-protocols.md`；MCP 接入 shape 已实现不代表执行权限或真实模型验收已通过。
