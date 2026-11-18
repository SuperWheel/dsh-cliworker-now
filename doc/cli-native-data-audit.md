# v0.8.1 全 CLI 原生通信与统计复查

日期：2026-10-16 至 2026-10-17。用户要求 GPT-6.1-sol 复查 Hermes 以外的十个 CLI，并参考 codex-host、Codingns4DSH 及相关官方实现补齐数据接口。本次在已有协议复查之上接入 Kimi 持久化回执、Hermes 官方生命周期观察、OMP 原生分类与额外账单字段、OpenCode 原生会话计数。下表区分当前源码候选、原生版本证据和真实模型验收；旧报告中的“当前不支持”须结合本轮补充接口阅读。

## 当前实际通信

`src/host/native-worker.ts` 的 NATIVE_TRANSPORTS、WorkerRuntime.initialTransport 与执行时 usesNativeBridge 是实际分派入口。此前已核已安装 lib 使用相同 transport 映射，本轮最终正式构建和四包安装另有哈希及桌面验收记录。不能只看仍为旧任务保留的 argv builder 就判断没有迁移。新 Worker 自动保存下列 transport；旧 Worker 的 transport 缺省或 legacy 时继续旧协议，未知标记直接拒绝。

| CLI | 新建 Worker 实际通信 | 本轮修复 / 已核实边界 |
| --- | --- | --- |
| Antigravity | agy-stream-v1；input/output stream-json 双向 stdio | 沿真实 step/DONE 结算，缓存与上下文元数据保留；没有 control_request/control_response，也不伪称运行中 steer |
| Codex | codex-app-v1；app-server --stdio | 补 cacheWrite/reasoning 及真实 thread/turn 身份；新线程零基线、恢复线程必须观察并确认历史终态基线后才能差分本轮；不能把 last 当整轮 |
| Claude Code | claude-stream-v1；双向 stream-json + include-partial-messages | 真实 message ID/block、message_delta 最终 usage/message_stop，公开 thinking 和数值 thinking_tokens 子桶；result 仅本轮合计 |
| Kimi | kimi-acp-v1；acp stdio | ACP usage_update 仅上下文；新增精确当前会话 main wire 只读观察，满足请求覆盖及终态条件才提供 run 账单；不切换旧 Wire transport |
| MiMo Code | mimo-http-v1；mimo serve HTTP + SSE | 独立验证 MiMo 类型；message/part 身份、终态公开过程、同 prompt 已公开消息回执和模型容量；reasoning 独立于 output，规范后只加一次；不冒称包含未观察辅助调用的完整账单 |
| ZCode | zcode-app-v1；自身 app-server NDJSON | main_turn 的 model_complete 精确响应，补缓存、公开过程和旧 turn.completed 用量；不用 Codex 协议 |
| Grok Build | grok-acp-v1；agent --no-leader stdio | 真实 response 扩展和 prompt 合计分开；本机模型元信息提供上下文容量，严格确认所选模型与窗口覆盖；进程累计不冒称持久会话累计 |
| OMP | omp-rpc-v1；--mode rpc 双向 stdio | 新增原进程 builtin /context 分类；stats 标 native-active-context/reported；透传真实 orchestration 桶，四桶不足时保留 unknown |
| Pi | pi-rpc-v1；--mode rpc 双向 stdio | 1.0.4 原生 stats 遍历全部 Session entries，包含压缩等计费记录；真实 response、contextUsage、原生 steer/abort 生命周期；扩展没有分类计数 API |
| Hermes Agent | hermes-http-v1；原生 Runs API + SSE、stop/approval/协商后的 steer | 原 API 之外新增官方 request hooks 的精确 run/turn/request 观察；CLI canonical 默认零不冒称 provider 已报告零；旧 stream-json 与本地会话累计独立保留 |
| OpenCode | opencode-http-v1；opencode serve HTTP + SSE | 新增 GET 同 session 的原生持久 counter 快照，可下降、清零并替换；不与响应/run 再相加；旧 JSONL 保留兼容 |

新协议并不意味着跨所有聊天轮次常驻进程，也不意味着所有协议支持实时引导。目前运行中原生引导已接 Codex、Hermes（能力协商）、Pi、OMP；其他 CLI 在完整 run 结束清理后消费原生 Inbox。没有接收证据时不宣称模型已执行引导。

## 十一 CLI 数据来源矩阵（本轮源码候选）

“原生”表示该 CLI 实际公开或持久化的数据，不表示服务器账单已被独立复核。“每响应”与整 run、当前记录、会话 counter、上下文分别处理；缺少完整性证明时不提升范围。以下版本用于来源核查，不能代替 README 历史执行表或新模型验收。

| CLI／核查版本 | 账单与缓存来源／范围 | 上下文及分类 | 每响应、公开过程与本轮限制 |
| --- | --- | --- | --- |
| Antigravity 1.3.6 | 原生 step/DONE 回执与精确会话累计；AGY input 不含 cache，reported total 不含 cache；缓存按其协议归一化 | 精确 CLI 会话只读元数据，保留原生估算、容量及已公开分类 | 使用真实 step/响应边界；工具和公开过程按原事件投影。无 native steer 控制通路；本轮没有新增分类推算或生成 |
| Codex 0.162.1 | app-server tokenUsage 的 total／last；只有新 thread 零基线或已确认恢复基线才能生成精确 run；cacheWrite/reasoning 显式存在才使用 | last.totalTokens 与真实 modelContextWindow；不把 thread 累计当窗口 | thread/turn/response 身份分开；公开 reasoning/tool 按原事件；恢复基线不明不差分、不把 last 充当整 run |
| Claude Code 2.1.287 | message_delta 最终 usage／message_stop 每响应；result 是当前调用合计；input/cache 分离，thinking_tokens 为 output 子集 | 同进程 get_context_usage(detail:summary)，750ms 可选查询，原生总量／窗口／分类估算；不调用 full 计数或额外模型 | 保留真实 message/block、公开 thinking/tool；summary 不支持或迟到不改变生成结果，不靠模型名猜窗口 |
| Kimi Code 2.1.1 | **新增**同 session main/wire.jsonl 的 durable usage.record、step.end、turn.ended；完整请求覆盖、模型/turn 唯一、无 aux/重试/子 agent 缺口时 scope:run，否则 reported | ACP usage_update.used/size 独立表示当前占用估算与容量；没有已证实的 system/tool/message 分项 | 真实 step UUID/provider messageId 可另发响应回执；ACP 正文未保留该身份时不硬绑。四零可能来自 CLI emptyUsage，不能证明完整账单；旧 print 缺 usage 仍未知 |
| MiMo Code 0.1.15 | HTTP message/step-finish 明确 input/output/reasoning/cache；只认已公开回执，不发不存在的 Session counter | /provider.limit.context 与原生最新请求占用；第16节新增真实请求组成的官方算法分类估算，非精确 Token 查询 | 真实 message/part 与公开 reasoning/tool。plugin session.userQuery.post／session.llm.request 只有 trajectory／文本等，不额外解锁分类或全部辅助账单；metrics.model_call 缺独立请求去重与完整桶 |
| ZCode 0.16.9 | 自身 app-server main_turn.model_complete 每响应，turn.completed 为 run；snapshot 总数保留为本次进程的 run 读数，不作为跨进程 session 总数；inclusive input 的缓存只扣一次 | 精确 session projection.contextUsed/contextWindow；缺分类不补 | 有序 model_complete 与 streaming assistantMessageId 核对；不借用 Codex 协议、网络通知或 task 汇总伪造响应 |
| Grok Build 1.0.50 | ACP prompt.result._meta.usage 为 prompt 合计，usageIsIncomplete 阻止完整 run；旧 streaming-json end.usage 独立规范化 | 精确选中模型 totalContextTokens／contextWindows 提供容量；ACP 当前占用估算分开；没有已证实分类 | 原生 response_started/completed 扩展才形成响应身份；缺 started 保留过程但不造响应；重放 eventId 去重；不称进程累计为持久 session |
| OMP 16.4.4 | **纠正范围** get_session_stats 遍历当前 state.messages，scope:reported／native-active-context，压缩后不等于完整历史；**新增**显式 orchestration.input/output/cacheRead，绝不按总量差额造桶 | **新增**原进程声明的 builtin /context；五类原生估算和 buffer/free，缺项不补零；used 单取同次 stats，不由百分比或分类总和反推 | message_end 的普通四桶无法容纳正 extra 时原生 response usage 保持 unknown，详情可保留真实 total/extra；不自动 /usage（可联网）或 /stats（会启动 dashboard）；保留 no-extensions 隔离 |
| Pi 1.0.4 | get_session_stats 汇总 ALL entries，包括 compaction、branch_summary、独立 usage 和 toolResult；可提供原生全历史 session 账单；message_end 单响应分开 | 原生 getContextUsage；压缩后 tokens:null 保持未知；公开 ExtensionContext 无分类 Token API | reasoning 已含 output；只映射公开 thinking 和真实工具；现有扩展没有为分类自行分词或改用户消息 |
| Hermes 当前安装源码 3f2abce7 | **新增**原进程 pre_api_request/post_api_request/api_request_error/on_session_end；精确 native run/turn/request 配对及覆盖总结；canonical 默认零不当 provider 缓存零。原 Runs 合计与精确本地 Session DB/WAL 快照保持独立 | 观察到有效单请求 canonical prompt 与 context_length 时可提供 provider-prompt 总量／窗口；MoA、缺完整回执等保持未知；2026-10-17 补充官方 pre_api_request 的实际 Chat Completions 输入，调用 Hermes 原生估算原语，支持部分分类并与精确总量分开标注；旧分类无法恢复 | 安全模式保留，不发现用户插件；本轮观察只接计数/身份、不生成公开 reasoning。旧截图没有 hook 时仍未知；API request 不是必然可与显示响应块一一绑定 |
| OpenCode 1.19.0 | **新增**GET /session/{id}.tokens 持久 counter，按 step-finish 更新／删除维护；scope:session 的当前保留回执累计，可下降、清零；原生快照覆盖，不累加或取最大值 | /provider.limit.context 与最近请求输入；第16节新增真实请求组成的官方算法分类估算，非精确 Token 查询 | message/part 每响应与 session counter 分开；output 原生不含 reasoning，由统一层加一次。删除/回退后的原生读数不称终身账单；旧 JSONL 不自动获得新 HTTP 查询 |

本轮专用接口都保留原 Agent、选型、权限与 transport。Kimi 只读当前精确路径，不枚举用户历史；Hermes 官方 observer 使用临时私有目录、nonce、连续序号和精确绑定，结束即清理；OMP 只认原进程 builtin 能力及 agentInvoked:false 回执；OpenCode 只接同 ID／目录的有界 GET。初始化失败、字段缺失或来源不符时不改为另一种协议、不重发任务、不补零。

## 完整原生视图与数据口径

侧栏继续使用官方 `sidebar.chat.conversation` 的同一个组件、注入、Store 和 locale，挂在真实 child SessionProvider 内。父级管理页和顶部返回/任务栏保持原版。没有重新拼装消息区、输入框或统计按钮。

本轮候选扩展 ui-chat 的可选数据源：精确绑定 turn/run 的整轮账单供原生 TurnTailNodeView/TurnUsagePanel 消费；原生 per-response 账单与外部 run 合计只选一个来源，不相加、不伪造 assistant/attempt。没有公开过程就保持原生不可展开；有公开块才通过原生过程展示。

StatsPills 接真实四桶；OMP 明确额外桶和无法归类的 reported total 通过可选原生详情保留，不伪造 input/output 使其闭合。已确认会话累计在新 run 中保留；只有 run 账单时保留最近一次完整账单且明确范围，详情显示“最近已确认运行”。OMP reported 当前记录不持久化为完整 session。OpenCode 原生 counter 的新快照允许下降或清零，不被旧最大值遮住。未知缓存或不一致总数不补零。

上下文占用必须来自 CLI 自身，容量必须有原生窗口/模型证据，不把累计用量充当上下文。本轮可选投影保留原生 partial 分类、category 名称、来源和估算标签，交给真正 ContextMeter；只有部分分类时也不制造缺失桶来迎合原生三桶结构。普通 DSH 会话没有外部来源键时维持原有数据路径。

## 用户截图 Hermes 的实际只读结果

该 Worker 未记录新 transport，仍是旧 stream-json；没有自动改会话或重新执行。按 accepted nativeInputs、Worker 运行回执和真实 child 的 user/message.source.rpcId，唯一恢复到 turn 3。

- 本轮：3901 token = 未缓存输入 3673 + 输出 4 + 缓存读 224 + 缓存写 0。
- 同一 CLI 会话累计：8669 = 8160 + 93 + 416 + 0。
- 该轮未返回公开思考、工具、单次响应用量或可核实上下文容量；不能为了补三个图标而伪造。
- 9 个相关用户源文件读取前后哈希一致；旧 binding 和 Session 未改写。DB/WAL 只在私有临时快照读取数值，随后销毁；没有把旧会话加载成新 Agent。

以上是安装前只读核对证据；本轮随后已在 Desktop 验证同一 Hermes 本轮和累计数值，见下方安装记录。私有数值证据保存在 `.test-data/native-turn-usage-hermes-readonly/combined-real-hermes-usage-report.json`，不纳入 Git。

## 参考项目

定向审查固定 HEAD，未运行外部仓库代码：

- [codex-host / 1aa9f65d](https://github.com/BytePioneer-AI/codex-host/tree/1aa9f65d6abf8f15b3a390f10de0b97ad85ae847)：Codex 的 total/session 与 last/context 区分、Claude 的 message_delta 最终账单可参考。本机 Claude 2.1.287 已核实 thinking_tokens 并补接。其 Hermes 走 TUI gateway 的 session.usage；本机该接口只接受活跃内存 runtime，不能无副作用查询截图里的任意 oneshot/API 历史会话。合成零值和丢失估算来源的兜底不采用。
- [Codingns4DSH / e136681d](https://github.com/jingyi0605/Codingns4DSH/tree/e136681d753061d6e409ccd390c664da19c2ce15)：选中 Grok 模型的 totalContextTokens/窗口元信息提供了容量线索，经本机 1.0.50 和官方类型验证后独立实现。其缺 token 补零、累计差 clamp、空白 reasoning 占位及 DOM 隐藏统计的方法不采用。它通过 llm/stream 投射原生主会话，不能直接证明本插件的完整侧栏视图挂载。

相关官方项目的具体帮助与版本证据：

- [Kimi Code 固定 commit 的 usageOps](https://github.com/MoonshotAI/kimi-code/blob/f67e6398fb3210ad8ace970e2dfd5bcc984ed61f/packages/agent-core-v2/src/agent/usage/usageOps.ts) 与 loop 持久化顺序，证明当前 ACP 之外可以只读 durable 回执；未照搬参考项目的旧 Kimi Wire 回退。
- [Hermes Agent 安装源码对应 commit](https://github.com/NousResearch/hermes-agent/tree/3f2abce7f468cf194bb7f9ff9c6a033b075d834c) 的公开 PluginContext/request hooks，支持同进程只读观察；TUI 活跃 runtime 查询不能替代任意历史 API session。
- OMP 16.4.4 安装 binary 中的 builtin/RPC、context report 和 OpenAI orchestration 解析器，证明无需移除隔离就能取得 native 分类与额外字段。Bun 全局 17.0.1 只辅助定位，不冒称实际运行版。
- Pi 1.0.4 安装 SDK 的 AgentSession／ExtensionContext，证明已有全历史 stats 已覆盖压缩等调用，同时限定扩展只公开总占用，没有分类计数方法。
- [OpenCode 1.19.0 原生 projector](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/core/src/session/projector.ts) 的增减 counter 规则，经安装 binary 对照，证明 session snapshot 应替换而非累加；MiMo 0.1.15 的独立 SDK/plugin 没有同一 counter，不套用 OpenCode 新字段。

细节见 [前轮 ACP 组](audits/cli-usage-audit-acp.md)、[前轮 HTTP/RPC 组](audits/native-http-rpc-audit.md)、[本轮 Kimi 持久回执](kimi-durable-usage-audit.md)、[本轮 Pi／OMP／HTTP 接口](native-http-rpc-data-interfaces.md)、[两个参考的定向核查](codingns-reference-audit.md) 和 [原生每轮用量](protocols/native-turn-usage.md)。

## 验收状态

此前第 10 节候选的验收是历史记录；第 11 节补充接口已完成最终 preview、集成回归和明确模拟数据的原生浏览器验收，源码冻结。当前候选四包位于 `artifacts/dsh-host-extension-rc2-data/`。Desktop 已完成四包扩展安装、冷启动与真实历史会话原生侧栏验收，范围见本节最终安装记录。版本保持 v0.8.1，未提交 GitHub、推送或发布。最新实际结果和候选哈希以 doc/tasks.md 对应轮次为准。

本轮按保存选型新增隔离真实单轮验证，五个 CLI 通过、两个阻塞、四个未启动，具体如下。它不覆盖全部 CLI 的完整真实工具链、续聊、停止、外部 MCP 或 Windows 实机；原有 OpenSpec 第 7 节边界仍保留。上游未公开的数据继续未知，不把这些限制写成全部功能已验收。

此前第 10 节实际通过：14 文件 292 项协议回归，9 文件 125 项最终集成回归，5 文件 196 项原生宿主回归；分组可能重叠，不合计为独立测试数。Host/Client 类型检查、preview 与四包产物校验通过。隔离浏览器确认原生每轮用量弹层、两层公开过程展开、运行中保留已确认用量、单一停止按钮及停止后恢复选择；父管理页/主对话保持，子会话不进入根列表。浏览器中的 25% 上下文是明确模拟值，不能用来证明截图 Hermes 已有上下文数据。验收任务和隔离服务已清理。

第 11 节 Pi／OMP／HTTP 组 7 文件 186 项离线模拟回归通过；OMP scope 合同最后调整后 5 文件 53 项及 Host 类型检查复验通过。Kimi、Hermes 及共享原生详情的关联验证由各专用报告与主任务记录，未将源码核查、mock 或旧轮通过算作新增真实账号／模型、Windows 或最终 Desktop 验收。

### 第 11 节最终集成与真实单轮验证

证据根目录 `.test-data/cli-native-data-20261017/` 为私有验收资料，不纳入 Git。

| 检查 | 实际结果与范围 |
| --- | --- |
| 插件最终集成 | `integration-tests.json`：17 个 testResults 文件，295/295 通过；JSON 的 40 个 suites 不是文件数 |
| 原生宿主 | 6 文件、211/211 通过，`/private/tmp/cwn-ui-chat-partial-usage-final-tests.json`；上下文补充 11/11 单独记录，不与 211 相加 |
| 最后定向修复 | Hermes 12/12；ZCode 工具输入修复 3 文件、29/29，旧真实 raw 离线重放通过；修复后没有再次调用模型 |
| 构建 | 最终 preview 已通过，包含最后 ZCode 修复；源码冻结。Host/Client 类型检查及候选四包校验由主任务记录 |
| 完整原生浏览器 | `browser-acceptance.json`：官方完整侧栏、父管理页保持、子会话根列表隐藏、两层公开过程、单停止按钮、运行中已知统计保留、停止后选择器恢复；计数和上下文均为明确模拟 |
| Desktop | 已安装并冷启动通过；Hermes 3901/8669、AGY 三项统计和上下文来源、原管理页和工作流已核验；不代表全部 CLI 真实全链路 |

浏览器检查还验证原生 total-only 详情保留总量 43／输入 35／输出 8，并省略未知缓存；原生上下文详情为模拟 35/1000，保留 source 和非估算标记。每轮 3901 仍是明确模拟回执；partial 每轮用量由宿主组件测试覆盖，浏览器临时快照覆盖未替换 service-level 每轮来源，不冒称该浏览器动作已经验证 partial 每轮分支。

`real-cli-summary.json` 的真实隔离检查均沿已保存模型／强度，每次只提交一个用户轮次，并核工具回执、随机标记、实际 artifact 内容和 wire。五个 CLI 通过是 OMP、OpenCode、Antigravity、Pi、ZCode；其中 OMP 真实读到原生 /context 分类及 9471/272000，总用量 18938 明确 reported，未称完整历史账单。ZCode 真实产物通过后发现的工具输入字符串形态已修复，最后用原 raw 重放及 29 项回归验证，未把离线重放称作再次真实模型通过。

Codex 在进程准入前检测当前账号额度耗尽，nativeProcessStarted=false，没有重试或改模型。Hermes 的两次已授权隔离轮次均遇所选 Nous 模型上游容量 HTTP 429；每次官方内部出现 3 个请求错误、0 模型响应，observer 初始化和 session 绑定已确认，截止后停止清理完成。此处不能改写为账号额度错误，也不能把 hook 就绪当作成功响应／账单／上下文验收。

Kimi 因无订阅未调用；Claude、MiMo、Grok 因无保存选型未调用。八次脚本准入尝试包含 Codex 未启动和 Hermes 两次阻塞，不等于八次成功生成；没有额外续聊或取消模型轮次。实际启动的 CLI 进程均已结算。退出证据来自 smoke 进程状态、桥终态及 Runtime 的 exitCode 检查，报告没有逐个持久保存嵌套 CLI 的直接退出码，不能声称已直接取得这些退出码。真实检查期间 profile、Hermes 配置及九项保存偏好哈希保持；安装阶段的后续变化另记。

### 第 11 节最终 Desktop 安装与冷启动结果（2026-10-17）

- 已按授权完成安装；版本仍为 v0.8.1。确认 28 个 Worker 无活动任务并退出全部 Desktop 进程，备份 4 份 profile 文件和旧 lib 后正式构建。与 preview 比较：Host 字节一致；Client 仅 18 处生成依赖来源路径注释不同，运行代码一致；77 个 sidecar 一致。最后 3 文件 36 项 backend 定向复验通过（覆盖 Hermes 身份与 ZCode 输入，不与前述组数相加）。
- 四包候选 `artifacts/dsh-host-extension-rc2-data/` 共 204 文件按 manifest 核验；官方 rc.2 commit `639ed015397290b3745d163aafe02ffee4aa3f84`，源码补丁 SHA-256 `1fadffe5db8988323838e0a791f2bf746b703bbbe2baad13b191db60e76a6126`。只替换三个旧扩展路径并加入 ui-chat 扩展，保留原 ui-chat 配置与其他 profile 字节，未修改 app.asar。工作流和依赖配置哈希未变。
- 真实 Electron Desktop 冷启动后，沿原父管理列表打开截图对应的 `hermes-1`：原生本轮用量弹层为 **3901 = 3673 + 224 + 0 + 4**；原生会话用量为 **8669 = 8160 + 416 + 93**；权限与模型原生弹层可打开。该旧轮无公开过程和上下文容量，继续不可展开／不显示未知上下文，没有伪造历史。Desktop UI 这一步未发送模型请求。
- 原有 `agy-1` 侧栏显示运行统计、132K Token／缓存命中 46%、上下文 12%；原生上下文弹层显示约 31.1K/256K、三类占用及“Antigravity 最近一次请求的本地上下文估算”。父会话模型和统计保持；原 Worker 标题/返回、管理列表及根会话隐藏通过；工作流页仍可打开，3 个既有流程可见。
- 安装前记录的 228 个 Worker 数据文件有 226 个最终哈希不变。两个变化为打开 Hermes 时原有 ensure 路径重存的 Worker 绑定元数据，以及 Host 重启后仍处于 paused 的旧队列说明；队列没有发送。原始事件／日志、账号绑定、偏好及会话身份保持；正常启动新增 host.lock。不把这两次运行时写入描述为全部文件逐字节未变。
- 验收采用仅本机临时 CDP 观察实际 `dsh-app://app` 页面；结束后正常退出，再不带调试参数启动。5 个正常 Desktop 进程存活、19389 调试端口和 18790 模拟服务均关闭、活动 Worker 为零；本任务浏览器页面已关闭。已向授权协调的“介绍项目亮点”任务告知安装窗口释放。
- 私有证据：`.test-data/cli-native-data-20261017/desktop-acceptance.json`、`desktop-profile-install.json`、`formal-build-equivalence.json`、`data-final.json`、`desktop-hermes-turn.png`、`desktop-agy-context.png`。备份及 CAS 回退脚本在同目录；不入 Git。
- 五个 CLI 的真实验证仍是隔离单轮，按 `real-cli-summary.json` 保留各自包哈希；最终 ZCode/Hermes 后端修复由回归和原 raw 重放验证，未额外调用模型。Codex 额度、Hermes 容量 429、四个未启动 CLI、Windows 和外部 MCP 全链路边界不变；OpenSpec 第 7 节仍未完成，不归档。


## 2026-10-17 Hermes-2 上下文完整性复查

截图同一成功请求 input=4091、context_length=1048576（0.390148%），账单4101独立。共享原生百分比由取整零修复为0.39%，环/条保留实际比例；三类原生行始终保留，旧记录没有来源的分类显示 — 与原因。Hermes新请求只在已核验chat_completions下从公开请求hook使用本机官方估算原语获取分类，仅写数值；系统提示去重、截断工具未知、请求和会话严格配对，估算分类不覆盖provider-exact总量。新成功回执无上下文时清除旧占用和分类。原语离线模拟system22/message20/tools14通过；本轮未做新增真实生成，不能将未来分类称为已完成真实模型验收。完整验收见doc/tasks.md第14节。

## 2026-10-18 CodexHost 用量采集复查

本节为用户指定参考项目的源码调查与既有记录复核，未修改插件运行逻辑。参考固定在 [CodexHost a8adb78b](https://github.com/BytePioneer-AI/codex-host/tree/a8adb78b519a81795fc05b787811f20a9738d7f0)，本机 Hermes 对应 `3f2abce7f468cf194bb7f9ff9c6a033b075d834c`。不将参考项目的支持清单、模拟测试或字段类型当作当前账号已经返回该数据的证据。

### Qoder：SDK、历史计数和 Credits 分开

参考项目有三条读取路径：

1. 实时 SDK `assistant.message.usage` 与最终 `result.usage` 提供 input/output/cache read/cache creation；`total_credits` 为会话累计快照，覆盖而非重复相加。[实时采集](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/packages/adapters/qoder/src/qoder-usage.ts#L58-L161)
2. 可选 `getContextUsage()` 提供上下文；`getUsageInfo()` 在该适配器中用于 Credits、套餐占比和重置时间，不能将其当作另一个精确 Token 查询接口。[SDK 查询](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/packages/adapters/qoder/src/qoder-sdk-transport.ts#L1164-L1200)
3. 历史统计读取原生 `projects/<project>/<session>.jsonl`，按 `message.id` 去重，排除复制分支、错误和合成消息；计费输入为 `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`。全零四桶显式标记 `tokensUnknown`，可独立保留 Credits。[历史读取](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/packages/adapters/qoder/src/qoder-usage-statistics.ts#L51-L128)

当前插件的实际差异：任务仍走 Qoder 原生 ACP，ACP 只提供整轮 input/output/total；现有严格绑定的 transcript reader 只补上下文比例，未接历史文件中可能存在的非零缓存桶、推理分类或 Credits。因此，后续可在同一原生 project/session/user-message 的 parent 链内补读这些字段，并按原生消息 ID 去重；不能直接将参考项目遍历全分支的全局账单合并成当前轮账单。历史四桶齐全且非零时才建立精确计费口径；缺字段、隐藏全零、跨轮或错误归属继续未知。Credits 需独立标注单位，不换算成 Token。

本次重新读取用户 Qoder 截图对应既有记录：ACP 三项及 transcript 四桶仍全零；可确认的其他数值为 `credits=0.2834514285714286`、`context_usage_ratio=0.17617777777777777`。这两项不支持恢复 Token 数和缓存命中率。该复核没有创建或恢复模型任务。

参考实现也有不能直接搬用的逻辑：实时 tracker 使用默认/按模型名推定的窗口，并可用比例反推占用 Token；缓存率使用 `cache_read_input_tokens / input_tokens` 后截到 100%，与它自己的历史“input 不含 cache”口径不一致。按该历史口径，正确分母应包含读写缓存；例如未缓存输入100、缓存读400、缓存写20时应为约76.9%，不能截成100%。这是一组源码算例，不是真实模型测量。

### Hermes：命中率来自同一套原生缓存计数

CodexHost 启动 Hermes `tui_gateway.entry`，调用 `session.usage`，并直接将 `cache_hit_pct` 映射为命中率；它的数据库历史路径也只在缓存读或写大于零时公开缓存字段。[Gateway 投影](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/packages/adapters/hermes/src/hermes-usage.ts#L1-L38)、[历史数据库](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/packages/adapters/hermes/src/usage-statistics.ts#L46-L89)

已核对本机官方实现 `tui_gateway/server.py::_get_usage`：只有 `session_prompt_tokens > 0` 且 `session_cache_read_tokens > 0` 才输出 `cache_hit_pct`，计算为 `round(cache_read / prompt * 100)`；prompt 包含未缓存输入、缓存读和缓存写。该接口并不额外查询提供方的隐藏缓存数据，也不是任意历史 HTTP session 的无副作用查询器。[本机对应上游源码](https://github.com/NousResearch/hermes-agent/blob/3f2abce7f468cf194bb7f9ff9c6a033b075d834c/tui_gateway/server.py#L2198-L2223)

当前插件已通过同进程官方 request hooks、HTTP Runs 与精确会话 DB 接收真实计数；有正缓存读数和有效 prompt 时可计算命中率。问题在于 Hermes 先将缺失缓存字段规范化为0，随后 `post_api_request` 删除 `raw_usage`，使“明确0”和“未返回”丢失区别。单纯换用 CodexHost 的 TUI 读取路径不能恢复这个区别。[原生 hook](https://github.com/NousResearch/hermes-agent/blob/3f2abce7f468cf194bb7f9ff9c6a033b075d834c/agent/api_request_hooks.py#L35-L49)

本次按截图会话重新读取原始 HTTP/hook 回执，并在私有临时 DB 副本查询精确 session：input4091、output10、total4101、reasoning1，规范化 cache read/write 均0。只离线执行原生缓存比例计算片段的三个模拟输入：4091/0不输出命中率，520/400输出77%，0/0不输出；没有启动 Gateway。当前旧记录仍无法确定真实缓存率。

要区分未来请求的真实0%和未知，需要原生公开接口保留缓存字段是否存在，或另行返回可靠的命中率；当前官方 hook 的摘要不具备该信息。此项是已定位的数据来源缺口，不是已实施修复；不修改用户 Hermes 安装、不从签名或上下文占比推算缓存。

### 其他 CLI 的参考价值与当前边界

| CLI | CodexHost 的读取方法 | 与当前插件的对照结论 |
| --- | --- | --- |
| Codex | 原生 rollout 的 request/thread token counters，区分压缩计数域并去重 | 历史账单恢复可参考；当前已有 app-server run 基线与累计区分，不能跨不同计数域直接相减 |
| Claude Code | message_delta 最终计数；历史按 message.id 去重；thinking 为 output 子集 | 当前已有最终响应与 thinking 字段；参考项目还保留1小时缓存写入分类，当前未单列该分类 |
| Pi / OMP | message.usage 四桶及 get_session_stats；输入加回缓存；推理已含 output | 当前已有相同主字段；OMP stats 是当前保留记录，不能直接宣称完整历史累计，另有原生 orchestration 桶 |
| Grok | response_completed 和 prompt 结算，两个入口的输入缓存口径不同 | 当前已有对应归一化与 incomplete 检查；不重复累计响应和整轮快照 |
| OpenCode | assistant tokens 的 input/output/reasoning/cache；v2 将 reasoning 加入输出 | 当前已接相同字段及原生 session counter；MiMo 无对应适配器，不能由该仓库直接证明它有更多接口 |
| ZCode | 原生完成消息及请求事件；验证 total=input+output | 当前已有等价计数口径与响应归属；参考版本与本机不同，不能直接搬运事件名 |
| Kimi / Antigravity | 原生会话用量、上下文；另有账号套餐查询 | 账号限额不等于每轮Token；当前原生计数接入与各自未验收边界保持 |

源码入口分别为参考仓库的 `packages/adapters/{codex-usage,claude-code,pi,omp,grok,opencode,zcode,kimi-code,antigravity}/src/`。本次没有对所有 CLI 新做账号或模型调用，以上是来源与字段对照，不是全量功能验收。

本次可落实的补全方向是 Qoder 非零历史桶与独立 Credits、明确返回时的缓存/推理细分；Hermes 旧记录仍受原生字段缺失限制。本轮只完成调查记录，没有将这些候选项标成已实现或部署。数值、来源哈希及读取保护证明保存在私有 `.test-data/codex-host-usage-reference-20261018/readonly-audit.json`；两份 Worker、两份原 raw、Qoder transcript 与精确 Hermes DB 的读取前后哈希一致。

### Codex 思考记录与三类上下文

同一固定版本的 CodexHost 对外部 CLI 使用两路展示：原生 reasoning 预览与持久 transcript。后者将公开文本投影为 commandExecution 的 `thinking` 哨兵，并非实际执行命令；[实现源码](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/packages/protocol-core/src/codex-ui-projector.ts#L583-L617)。这不能证明原生 Codex 未公开的内部推理可恢复；它自己的 Codex runtime 主要转发官方 app-server 通知。

本插件已有原生 reasoning blocks 存储，本次通过公开 assistant-step 节点入口复用原生思考行，在原生过程内提供“思考记录”，不制造工具调用或答复尾部面板。Codex `turn/start` 增加 `summary: auto`，对应官方协议的可选 ReasoningSummary 参数；读取 `summaryTextDelta` 和最终 `summary[]`，不读取 `textDelta` / raw reasoning。[官方 app-server 文档](https://developers.openai.com/codex/app-server)说明 summary 与 content 通知的区别；[公开摘要说明](https://developers.openai.com/api/docs/guides/reasoning)说明摘要须显式请求且不等于内部推理。

对用户截图对应 Codex 旧轮的只读核查：本地 rollout 的 `turn_context.summary` 为 `none`，模型目录的默认摘要也为 `none`；没有 reasoning item 或 summary delta。已报告 input 24,794、cached input 12,544、output 5、reasoning output 0、total 24,799。新设置不会追溯生成旧轮没有保存的摘要，旧文件读取前后哈希一致。

后续最小复核补充：Desktop 更新后的 `codex-new`（原生 CLI 0.162.1、GPT-6-Luna / Low）没有 reasoning item，reasoning output 为0。此前本机探针收到502且模拟服务未收到请求，因此那批回执没有证明摘要是否生效；保留在 `.test-data/cli-thinking-regression-20261018/`，不能当作成功验收。

2026-10-18 继续排查已纠正 `summary: none` 的判断依据：官方 [turn context 序列化](https://github.com/openai/codex/blob/8c076942cb70fba8e5c4732c23f1faabc4aed484/codex-rs/core/src/session/turn_context.rs#L889-L915)将兼容字段固定写为 none，而[实际请求](https://github.com/openai/codex/blob/8c076942cb70fba8e5c4732c23f1faabc4aed484/codex-rs/core/src/client.rs#L934-L951)从有效摘要配置构造。安装中 0.162.1 的隔离实测也确认：实际 HTTP 请求包含 `reasoning: { effort: low, summary: auto, context: all_turns }`，同一轮 rollout 仍为 `summary:none`。502 是测试请求被 macOS 本机7897代理转发造成；模拟进程显式使用只接受本机目标的测试代理后，请求成功。未修改用户代理、账号或模型配置。

安装中 CLI 加生产 `runNativeCodex` 适配器的三项模拟验证均成功：流式摘要按段累计；仅最终条目返回的摘要可接收；空摘要不生成思考事件；私密 raw/encrypted 标记未进入插件输出。修复点位于 Host 原生投影：此前仅 Hermes 允许公开增量在完成前展示，现为当前 run 的 `codex-app-v1` 开放同一通路，保持旧 transport 的完成门槛。参考 codex-host 的[原生通知转发](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/packages/host-runtime/src/app-server-host.ts#L2200-L2240)，不把其外部 CLI 的 thinking 哨兵当真实工具。私有模拟回执在 `.test-data/codex-summary-fix-20261018/bridge-*.json`；没有新增真实模型调用，问好轮次仍无可恢复摘要。

截图中的“系统提示词／工具定义／对话消息”是上下文来源分类，不是计费输入／输出／缓存分类。CodexHost 的 [Codex 用量观察器](https://github.com/BytePioneer-AI/codex-host/blob/a8adb78b519a81795fc05b787811f20a9738d7f0/packages/adapters/codex-usage/src/session-observation.ts#L8-L47)仅映射原生账单桶、最近一次上下文总量及窗口；HostUsage 和 renderer 用量详情也没有这三类来源统计。当前官方 ThreadTokenUsage/TokenUsageBreakdown 同样不提供三类拆分。因此本次不能从该项目取得精确三类计量或三类计价；原生字段缺失时继续显示未知，不按文本长度或总量分摊。

## 2026-10-17 其余十 CLI 对齐复查

按用户要求使用 GPT-6.1-sol 分组复查全部其他 CLI，补 Codex 工具输出、Claude 主子公开流隔离、ACP/ZCode 公开过程分段、Pi/OMP 运行中统计与已选模型容量、OpenCode/MiMo 初始零占位及完成缺值边界。采用同一官方完整原生侧栏，不改父管理界面。逐 CLI 数据来源、未知项和验证边界见 [十 CLI 对齐报告](ten-cli-native-parity.md) 与 `tasks.md` 第15节；新增离线证据不替换上文真实模型的历史结论。


## 2026-10-17 第16节 MiMo／OpenCode 请求分类与真实验收

原生 HTTP message/usage 接口没有返回系统提示词、工具定义、消息三项分类。新通路在当前 owned 运行中读取原生 `/provider` 与 `/config` 的有效配置，精确解析已选 provider/model 的实际 endpoint；只将该子进程的内联 provider baseURL 临时指向带随机 nonce 的本机 loopback relay，不猜 endpoint、不改模型或强度。HOME、PURE、cwd、data 与原生权限保持原值，用户源配置只读。metadata 探测进程关闭后才启动路由进程，避免同 data 并行；结束时关闭进程和 relay。没有为了启用观察而放开 PURE 或加载用户插件，也没有交付改变 HOME 的配置视图。

Relay 转发实际请求字节、响应状态/headers、SSE 与中断，不持久保存请求、系统提示词、工具 schema 或密钥。分类只接受已绑定 native session header、确切当前用户文本、实际 API model 和主请求工具结构；foreign session/model、标题等后台请求不提供分类。每个匹配请求先发 `breakdown:null` 再发有效分类；同会话 oversized、无效 JSON、不能分类的新请求清空旧分类，避免把旧值附到新 usage。缺匹配时保持未知。观察失败不改变原生生成结果。

三项数值来自实际转发请求的组成，调用本机两版 CLI 已核实的官方估算算法 `Math.max(0, Math.round(text.length / 4))`，来源标为原生请求分类估算、`estimated:true`、`basis:native-chars-per-token-4`。系统、工具、消息分别估算，不按账单比例分摊；分类之和不等于 provider tokenizer 的精确输入数。总占用和容量继续采用原生回执及模型目录，分类不覆盖它们。OpenCode 固定版本算法见 [v1.19.0 token.ts](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/core/src/util/token.ts)；MiMo 0.1.15 对照本机安装 binary 独立核实，未套用 OpenCode 其他协议。

| 真实隔离单轮 | 保存选型 | 系统 / 工具 / 消息（估算） | 原生占用 / 容量 | 结果与私有报告 |
| --- | --- | --- | --- | --- |
| MiMo 0.1.15 | `xiaomi/mimo-v2.6-flash`，`low` | 3868 / 16987 / 38 | 21125 / 1048576 | completed；`http-mimo-4EkKKR/report.json` |
| OpenCode 1.19.0 | `zhipuai-coding-plan/glm-5.3-flash`，`low` | 2294 / 4113 / 39 | 6041 / 1000000 | completed；`http-opencode-erdy4T/report.json` |

报告位于 `.test-data/seven-cli-regression-20261017/`，不入 Git。两次各提交一个用户轮次、观察到一个已绑定主请求；null→valid 同 requestId，经 TelemetryReader／共享 telemetry 到真实原生组件投影后三项一致。随机回复标记匹配、无意外工具执行、WorkerRuntime 确认进程范围退出；原保存选型、配置、凭据及指定旧 Worker/事件/raw 哈希未变。报告记录的五个 HTTP sidecar hash 在验收后再次与源码核对一致，未在完成后修改源码。这是隔离 preview 验收，不冒称已经安装 Desktop 或覆盖真实工具、续聊、停止与 Windows。

先前一次已授权 MiMo 单轮 `http-mimo-749TJY/report.json` 实际生成成功但观察记录为 0，分类验收失败，不能删除或计为成功分类。零模型查证发现 PURE 禁用外部 plugin，使原 plugin observer 未加载；另有空 `MIMOCODE_CONFIG_CONTENT` 解析问题在调查中修正。未放开用户插件，最终改为上述 relay 后，按授权仅重验一次取得有效分类；OpenCode 最终为本阶段首次真实模型验收。两版官方 CLI 的零模型 metadata/config probe 也通过，分别见 `http-config-zero-mQkuMR/report.json` 与 `opencode-config-zero-uFoDR3/report.json`，prompt_async 在提交前阻断，模型调用为 0。

本轮关联离线测试为 4 文件 81 项通过，覆盖估算、严格身份、unknown 清空、字节/压缩 SSE 透传、abort/清理及明确模拟 provider 的完整投影链，不把它们计为真实模型结果。旧截图与历史 raw 没有实际请求组成，仍显示未知分类；不读 DSH 镜像冒充 CLI 输入，不倒推历史。完整阶段验收由 `doc/tasks.md` 第16节统一记录。
