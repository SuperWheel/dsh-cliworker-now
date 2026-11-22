# CLI Worker 原生会话界面

v0.8.1 为 Worker 增加真实 Harness 直接子 Agent 绑定。Worker ID、Harness child Session ID 和 CLI conversation ID 分别保存。点击 Worker 在右侧 CLI Worker 栏打开其原生对话，主对话保持当前位置；子 Agent 仍绑定所属主对话，不进入普通会话列表。

Client 通过原生 Gateway 请求 `ensureHarnessConversation`，只获取或建立绑定，不为显示界面再次提交任务。`sessions.retain` 取得真实直接子会话的 `SessionReference`，核对身份及读取状态后，由侧栏自己的 `SessionProvider` 绑定该引用。插件复用官方 `sidebar.chat.conversation` 的完整 `ConversationSlotPanel` 注册入口，phase、hero、消息、输入和队列由该原生视图统一决定；插件不再自行组装 ChatView 或维护第二套对话状态。

顶部保留原 CLI Worker 返回、Worker 名称/标题与任务操作；该正文入口不包含主页面 Header/frame。窗口及全局侧栏开关由外层宿主保留，打开 Worker 不调用主页面的 `uiWorkspace.openSession`。原入口的组件、注入、Store、locale 保持一致。

2026-10-16 用户明确允许在官方 rc.2 源码开发宿主扩展，并要求安装前先验收。`composerPresentation: 'main'` 使真实子 Agent 采用主对话原有按钮切换规则，`commandSource` 只传递当前 CLI 可用指令的数据来源。两者经过同一官方侧栏、content 和 composer 路径；默认 DSH 会话保持原行为，子 Agent 身份、停止对象和 Inbox 不变。统计通过新增 `uiSession.provideProjections(reference, sources)` 从会话层提供，删除逐个组件的统计包装。源码、构建和回退说明见 [宿主扩展](native-conversation-host-extension.md)，实际安装状态以实施记录为准。

切换 Worker、关闭侧栏和插件卸载会取消读取等待并释放插件持有的引用，不停止已运行的 CLI。迟到的绑定回执不会切换当前 Worker；读取失败显示真实错误，不借用父会话。普通主对话及其他会话的控件数据和行为保持原样。

首次挂接旧 Worker 时，原生投影只从本次接入的最近一轮继续，不声称已经导入完整历史。“任务选项”说明“原生对话从本次挂接开始；更早记录见旧历史”，并提供只读“旧历史”对话框，通过原有 Gateway 分页读取 WorkerStorage。该页面展示固定读取快照，关闭、切换 Worker 后丢弃迟到页，不重发、改写或复制历史，也不增加输入框。

## 原生输入与排队

InputBar、QueueDock、审批、提问、菜单及键盘行为都由完整原生视图运行。设置以原生控件数据合同连接 CLI，累计统计以会话作用域来源连接 CLI；不复制内部组件、不代理 ComposerKeyboard，也不伪造 Session 或 Inbox。原生模式不另设 Worker form 或第二套队列。

发送走真实 continuable 子 Agent 的 `Session.prompt → subagents.prompt → Agent inbox`。普通排队、编辑、移除及停止使用 DSH 原生行为；Host 在原生 Agent 领取消息后进入原有 Worker launch，继续核验项目、账号、模型与同目录执行互斥。原生启动的 run 在工具桥准备阶段不再注入第二个显示请求。

每条消息的原生 RPC 身份、正文摘要、所属批次及接收状态持久保存在私有绑定记录 `nativeInputs` 中。合批执行后，即使冷恢复并单独重试其中一条，仍按原消息身份去重；已接收重复项不会再次写入用户消息，也不阻止后续不同输入按原生顺序继续。接收状态不明时明确失败并把已领取消息按原 ID 放回真实 next-step 队列，保留编辑/移除能力，不自动重发。

运行中的 next-step 消息按当前 CLI transport 分流。已接通且就绪的原生 steer 通路面向当前 run 发送，以真实 CLI 接收回执为准；接收不等于模型已执行，拒绝或结果未知不得自动改为下一轮发送。没有该运行中通路时，当前完整 CLI run 视为执行步骤，消息留在真实 Inbox，待该 run 完成清理后沿同一 CLI 会话进入下一步。显示消息分段不是新执行边界；后者不停止重启，也不声称已实时注入 CLI。已接通 Codex app-server、Hermes HTTP、Pi RPC 和 OMP RPC 的原生引导，模拟协议与真实 DSH Inbox 回归已通过；真实账号、模型和平台范围以实施记录为准。

原生停止与快捷键保持官方界面行为，通过当前 stream 的取消信号停止对应 CLI run；Agent 等待进程与工具清理后才进入 idle，旧轮回执不能停止新轮。既有 Worker 自定义队列保留为历史兼容数据，不映射为原生 Inbox，未发送历史不自动迁移或重放。

## 控件与上下文

模型和强度复用实际原生 ModelSelect，公开目录和选择回调接当前 Worker 对应 CLI 的真实目录与保存接口；不再绘制只读替代按钮。权限和规划复用实际原生 PermissionSelect、PlanChip，以 Host 返回的当前 CLI 可选范围及保存结果为准。未就绪、身份不匹配、不可写或不支持时保留原生禁用行为和具体原因，不编造模型、强度或权限能力。

PermissionSelect 的公开预设仅作界面映射：`read-only` 对应 CLI `plan`，`workspace-write` 对应 CLI `accept-edits`。保存及执行保留 CLI 模式和自身保护；不把原生全访问或自动批准预设当作新增 CLI 能力。

运行、消息准入与清理期间，或者存在任何原生 next-turn/next-step 待发项、兼容队列项（包括 paused）时，模型、强度和权限设置均锁定。先完成或移除待发消息再修改；设置操作不改变已经排好的内容。所有数据适配按 Host 登记的 parent/child/Worker 身份精确核对，不因项目相同而影响普通主对话。

原生 ContextMeter 与 StatsPills 及其弹层接收匹配 Worker 的实际遥测。当前窗口占用、容量、累计用量及分类分别校验；不使用 DSH 显示投影估算代替 CLI 上下文，不把累计 Token 当窗口占用，不把缺失分类补成零。首轮尚无数据、未报告或连接断开时，由可选 telemetryAvailability 来源使原生组件自己保留三个模块，以“—”和原生详情说明缺失原因，不增加自绘统计区或替代占位组件；未提供该来源的普通 DSH 会话行为不变。统计来源绑定精确 SessionReference 代际及 parent/child/Worker 身份；同一子会话的多个视图共享订阅，最后释放、会话销毁或插件卸载时清理。未知值明确覆盖 DSH 显示估算；运行开始时保留同一 CLI 会话上次已确认的累计快照，换 CLI 会话立即失效。

AGY 的 `input_tokens` 是未缓存输入，`cache_read_tokens` 为独立缓存读取；其 `total_tokens` 按输入加输出校验，不包含缓存读取。原生 StatsPills 按未缓存输入、缓存读取、缓存写入和输出四桶汇总，因此原生总量会比 AGY 报告总量多出缓存读取，缓存命中率以完整输入为分母。已核验的 AGY `steps.JSONUsage` 输出结构没有独立缓存写入字段，该类别规范为零；缺少实际输入、输出或缓存读取值时仍保持未知，不从其他会话补齐，也不另加未经确认的 thinking 计数。

AGY 上下文只读当前 CLI conversation 对应本地数据库的原生 `gen_metadata`，取得最近一次请求的 `estimated_tokens_used`、`max_context_tokens` 及可用分类。它是 CLI 原生估算，不是累计计费用量。ContextMeter 需要已用量和正容量；分类是可选信息，缺少分类不会移除已有占用读数。读取失败或元数据不完整时保持缺失，具体 Desktop 验证范围以实施记录为准。

附件菜单复用原生输入：macOS / Windows Desktop 普通文件以真实路径引用进入草稿，图片由显式 childImageUploads 开关和原生 File action 上传、保存历史，Host 按 CLI 转换内容块及路径；旧协议或失效附件仍返回真实原因。运行中附件保留原生队列，不转为纯文本引导；重试校验包含附件身份。分支仍受限。加号始终保留可用指令菜单；指令弹窗由原生 controller 管理，尚未桥接的命令在 Host 返回具体错误，不调用未知模型路径。能力详情保留在任务选项中，不增加一排不可用按钮。逐 CLI 接入见 [能力矩阵](cli-harness-capabilities.md)。

## 响应边界与单次用量

CLI 的真实响应块和结束边界进入 DSH AgentLoop，同一响应的公开思考、正文和工具回执保持顺序。单次响应的真实 usage 只结算一次，使原生过程详情和消息尾用量自行显示；累计快照不能充当单次响应 usage。工具记录经 child 作用域的只读回执定义投影，不能重新执行 CLI 已做过的工具操作。

2026-10-16/17 复查后，AGY 的 step/DONE、Claude 的 API message/block、OpenCode/MiMo 的 message/part、Pi/OMP 的 message_start/message_end、Grok 的显式 response 扩展以及 ZCode 的 main_turn model_complete 均按各自证据映射响应边界。Codex 仅公开 token 通知与 thread/turn 身份，不伪造 provider response；完整 run 用量只用已证实基线或旧 exec 的明确 turn.completed。CLI 没有公开思考或工具过程时，不创建虚假过程来使展开按钮可点；没有单次 usage 的旧消息也不回填累计统计。模拟过程和用量明确标注模拟，不能作为真实模型思考证据。

rc.2 原生“本轮用量”详情的提供方/模型直接读取 AgentLoop 写入的执行路由，因此适配会话可能显示 `cliworker-native/worker/<id>`。这与输入框的真实 CLI 模型选择是不同字段。现有公开流没有独立的响应来源合同，原有三包扩展不改写路由或历史来源；本轮候选另增加 ui-chat 的可选整轮用量来源；不能根据 CLI 名称推测提供方，也不声称该详情已显示实际上游模型。

## 停止与恢复

主动停止在 CLI 受管范围退出后映射到原生 aborted/user，保留已显示内容，超时和真实失败仍显示错误。已公开但未获得结果的工具通过官方 ToolCallRecovery 结算为结果未知，禁止盲目重试；原生格式必须能通过 V4 冷恢复校验。

对于早期投影缺少工具终结而无法冷恢复的内部子会话，不删改日志。普通打开或“重新打开”仅重读绑定，不自动修复、不重试任务。读取错误页在存在原绑定且 Host 提供入口时显示“修复显示会话”；用户明确点击后，Client 通过 `repairHarnessConversation` 传入所属父会话、Worker 和当前失败的显示会话 ID。

修复仅针对显示绑定：Host 必须确认原项目及精确归属，并在 Worker 无运行、消息准入或停止清理时取得互斥准备占用。原 child 不得有活动 Agent、stream 或投影准备。Host 使用官方只读 `sessionQuery.observeSession` 校验；只有明确返回 `SESSION_QUERY_CORRUPT_SESSION`，且校验后原 run 和空闲状态仍一致，才允许 CAS 更换内部显示绑定。可正常读取、身份已变化、网络或权限错误均保留原绑定并显示原因。新绑定仍为同一父会话的真实子 Agent，保留旧 Session 引用及 Worker 历史；只挂接已有运行记录，不启动 CLI，也不重跑原 prompt。创建失败按既有回滚与清理规则处理，不把结果未知显示为修复成功。

此外，下一次明确新发的准备阶段，在尚未启动 CLI、官方明确返回 `subagent/not-resumable` 且原 child 无活动 Agent 时，也可按相同身份保护轮换内部显示绑定；这与错误页显式修复是两个入口。两者均保持 Worker ID、CLI conversation ID、账号与模型。切换 Worker 或关闭当前视图会取消本次修复等待，迟到的旧绑定快照不能覆盖已经返回的新绑定。

所属子会话结算通知不会生成额外父 turn；普通 DSH 的既有后台任务通知及模型摘要仍保留正常行为，不应将其计为 Worker 的模型回退。

工具能力为 true 表示本轮桥可执行当前真实子 Agent 获准的 DSH 工具和已配置 MCP；新列表按实时目录生成，调用和旧回执重放均重核目录，执行进入原生权限与审批链。递归派遣和未接通的模型辅助被拒绝。非文本输出、各 CLI 临时注入和订阅限制见工具桥说明，不把通用转发实现当成所有外部服务都已真实验收。

## 验证范围

当前侧栏路径的验收需核对准确子地址、引用清理、失败和迟到回执、原 Worker 顶栏和原生输入/队列/菜单/统计、侧栏内导航，以及主页面和普通父会话不受影响。设置需核对真实 CLI 保存与各类运行/队列锁定，steer 与整轮后接续分别验证。组件模拟、先前局部 content 预览或主页面导航截图不能替代最终侧栏检查，也不能证明真实 CLI 或模型执行。实际关联回归、preview、浏览器、Desktop 和平台结果由 `doc/tasks.md` 记录；未完成验证继续保留在活动 OpenSpec 任务中。

## 历史方案边界

此前先后使用过仅嵌入 `conversation.content`、内部 keyboard/队列代理以及通过 `uiWorkspace.openSession` 打开完整主页面的方案。前两者未满足完整原生交互要求，后者不符合对话留在右侧 CLI Worker 栏的要求，均已被当前方案替代。后续完整 Header/frame 侧栏方案也因最新截图要求撤回；顶部恢复原 Worker 布局，正文与输入交互保持原生。历史实现和验证记录保留在 `doc/design.md` 与 `doc/tasks.md`，不作为当前侧栏验收证据。

## 2026-10-17 全 CLI 数据复查候选

新建 Worker 已选择原生双向协议；未标记 transport 的历史 Worker 仍保留原协议。具体实际入口及统计证据见 [全 CLI 复查](../audits/cli-native-data-audit.md)。

只有完整 run 账单而没有单次响应 usage 时，Host 将真实 turn/run 绑定交给会话作用域的 `externalTurnUsage`；原生 TurnTailNodeView/TurnUsagePanel 显示该轮合计，来源注明 CLI 运行合计，不新增伪造 assistant 或 request/attempt。无外部 key 继续使用原生完整响应账单，null 显式表示未知，两者不重复计数。旧绑定可经 accepted nativeInputs、Worker queuedFollowupId/admittedRunId 及原生 user/message.source.rpcId、真实闭合 turn 唯一对应，仅读取并在内存恢复，绝不按正文/时间猜测或改写历史。

运行中优先保留已确认的同 CLI 会话累计；只有 run 账单的 CLI 独立保留最近一次完整账单，继续标记 scope=run、原 usageRunId。原生用量详情补充“本轮运行”或“最近已确认运行”来源；不把本轮账单改成会话累计。当前部分响应统计也明确注明范围，不补缺失桶。

Hermes stream-json 的 input 不含缓存，HTTP input 已含缓存，分别规范化后进入同一原生四桶。Hermes 累计仅查询精确账号目录、session/source/project 的数值列：无 WAL 用 immutable 只读，有 WAL 时在私有临时 DB/WAL 快照读取并立即销毁，不改用户 DB/SHM 文件。该来源没有可核实的上下文容量，也不会从累计用量推算。
