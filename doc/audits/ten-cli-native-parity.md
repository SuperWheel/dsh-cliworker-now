# 十 CLI 对齐当前 Hermes 原生侧栏复查

2026-10-17，v0.8.1，第15阶段及第16阶段真实截图补充回归。继续使用同一个 DSH 官方完整 `sidebar.chat.conversation` 与原生 Session/Inbox/AgentLoop；本轮修复协议适配，并最终新增 `context-clean` 四包宿主扩展候选，统一清理原生上下文弹层的额外展示行。

## 数据来源与修复

| CLI | 统计/上下文来源 | 本次核查与修复 | 原生分类边界 |
| --- | --- | --- | --- |
| Antigravity | step/DONE逐响应、精确会话本地元数据 | 已有公开过程、用量与窗口链，无新增已证实缺口 | 有原生三分类；没有公开的隐藏推理不补造 |
| Codex | app-server线程累计、确认基线后的run差分、last/modelContextWindow | 补运行中命令输出、MCP进度、dynamic工具结果；完成帧省略输出时保留已观测内容 | 缺分类；当前协商未建立精确逐请求usage通路。官方internal-only rawResponse类型存在，不据此假设可调用 |
| Claude Code | message/block响应usage、同进程get_context_usage summary | 已隔离主/子Agent流身份；主响应未结束时暂存子流公开事件，主响应结算后再投影，避免打断原生桥；子流不挂主usage | 原生summary提供已知分类；缺失分类和缺少完整响应边界的usage保持未知 |
| Kimi | ACP used/size、同会话durable usage回执 | 修复正文→公开思考→正文时后段被折回前段 | 无已证实分类；ACP正文缺对应response身份时不强绑durable usage |
| Grok Build | ACP response扩展、prompt账单、选中模型窗口 | 修复同上公开过程顺序 | 无已证实分类；未发usage_update时不拿账单推占用 |
| ZCode | 自身app-server主请求usage、snapshot projection窗口 | 修复同上公开过程顺序，保持独立协议 | 无已证实分类；累计总量不推占用 |
| OpenCode | HTTP/SSE message/part响应、session counter、provider.limit.context | 已区分初始零值占位、原生完成回执的真零、完成时缺失统计；初始占位不覆盖已知占用，完成回执缺少统计字段时不沿用旧值 | 无已证实分类；counter允许下降/清零，不能充当当前上下文 |
| MiMo | 自身HTTP message/step-finish及provider容量 | 同上修复HTTP零值上下文边界；仍按自身input+cache.read口径，不套用OpenCode session counter | 无已证实分类或全历史counter；缺失cache字段不补零 |
| Pi | 原生RPC全部session entries统计、contextUsage；实际请求`context_with_system`与同安装版估算原语 | 确认选型后即发容量；首轮前和响应间有界只读stats更新；第16阶段通过受控fd3数字通道补三分类 | 三分类明确为实际请求的原生估算，不与账单强制闭合；压缩后tokens:null仍未知，无法估算的新请求显式清除旧分类 |
| OMP | 原生RPC当前活动记录统计、结束后builtin /context | 同Pi补实时容量/stats；用量保留额外orchestration桶 | 原生五类及free/buffer仅在底层独立保留；上下文弹层只三行，不伪装闭合三桶 |

实时RPC元查询使用独立请求ID、最多一个在途请求和750ms超时；终态之后的迟到读取不覆盖已结算状态，失败不重发用户任务。没有为统计增加模型请求。

## 技术边界

十 CLI 复用同一个官方原生侧栏，但各自保留原协议的数据边界。公开正文、公开思考和已执行工具过程来自实际事件；没有公开思考的CLI不生成替代内容。逐请求usage、run账单、session累计和当前上下文分别保存；不能把账单、累计总量或输出tokens当成上下文占用，也不能为缺失值借用另一个CLI的公式、默认窗口或分类。

上下文弹层统一只显示原生占比、进度条及系统提示词／工具定义／对话消息三行，保留未知、真零、估算和缺值原因。完整、部分、全未知及等待状态均不展示“分类来源／数据来源”或额外分类行；来源和额外分类仍在底层留存，计账范围说明不删除。

- Antigravity的原生分类是估算；未返回的分类、容量或公开思考仍未知，不从模型名称推算。
- Codex的`last`窗口与`total`累计分开；当前协商未建立的精确逐请求usage和原生分类仍未知，不能因官方存在internal-only类型便宣称已接通。
- Claude Code只有完整主响应边界才能归属主usage；子Agent公开事件保留自身身份，不能混入主响应账单。summary未返回的项目保持未知，不增加生成请求补统计。
- Kimi当前上下文只采ACP的实际used/size；durable请求回执与ACP正文缺少对应response身份时保持独立。无已证实分类；原生emptyUsage的全零不能证明provider提供了完整零账单。
- Grok Build只以实际usage_update确认占用，以精确选中模型元数据确认容量；prompt账单不能反推窗口。缺分类、缺请求完成回执时保持未知，加密签名不当作公开思考。
- ZCode使用自身app-server和压缩后的snapshot projection；没有分类时未知，不借用Codex app-server字段或累计totalTokenCount推算占用。
- OpenCode的上下文按自身input+cache.read+cache.write口径；初始assistant全零只是占位，只有原生完成回执才能确认真零。缺完整输入字段的完成回执使占用回到未知；分类未知。
- MiMo的上下文按自身input+cache.read口径，不能照搬OpenCode的cache.write或全历史counter；完成回执缺失字段时保持未知，分类未知。
- Pi没有直接返回三分类计数的RPC方法；第16阶段改用本次实际请求的`context_with_system`钩子，以及同安装版官方`estimateTokens`／`getCurrentSystemMessage`原语独立估算三类。`contextUsage.tokens`为null时保持未知，不用session累计tokens替代，也不调用OMP的`/context`猜分类。容量和分类本身不推进占用，分类合计不要求等于原生上下文统计。
- OMP只接受已广告的builtin /context报告；原生五类与free/buffer仅在底层留存，不增加上下文弹层行；用量的orchestration范围仍独立保留。未返回的类别未知，不能把四舍五入百分比或类别合计倒推占用，不能硬拼为闭合三桶。

## 验收边界

截至本次更新，根任务关联回归14文件、280项通过，Host／Client类型检查及preview通过；原生ContextMeter单文件39项和ui-conversation client类型检查通过。干净的`context-clean`候选已通过十CLI×等待／生成中／完成共30个模拟浏览器状态，且已按四路径CAS安装Desktop。现有AGY／Hermes历史会话的只读UI复核已通过：上下文分别为12%和0.39%，原生分类、缺失说明及父会话统计保留，来源说明全部移除。

协议夹具、原生AgentLoop和30状态浏览器验收均为明确标注的模拟证据；Desktop安装成功不等于十CLI真实账号与模型全部通过。实际命令与结果在 `doc/tasks.md` 第15阶段及私有 `.test-data/ten-cli-parity-20261017/`。

源码和离线测试不代替真实账号、模型或Windows实机验收；Kimi缺订阅保持离线。尚未完成的全CLI/订阅/外部MCP/Windows范围保留于OpenSpec第7节，不通过归档隐藏。


## 第16阶段：Pi 实际请求分类与公开思考边界

本轮针对用户真实截图定位精确 Worker／run 后读取原始 wire、WorkerEvents 和该 CLI 自己保存的原生 Session，没有改写旧会话。`pi-1`（Worker `9a098238-fa76-4a6c-b35f-e9b5fee9d72a`，run `b5179812-68fd-40cb-8ba5-ffeefd249f40`）及 `omp-hello-2`（Worker `6cd8fe3b-9fb9-4ee6-90c3-bf8e9b6f30e7`，run `ad765ba4-b203-4397-ba38-4501d24dea5a`）的精确原生助手消息都只有正文；两者原生 Session 均记录 `thinking_level_change: low`，没有可恢复的公开 thinking 块。Pi 该旧响应还明确报告 reasoning 为零。OMP 已有原生分类不代表必有公开思考；本轮 AGY 无公开思考的实际样本同样不补造内容、展开按钮或解释性推理。上述结论只属于已核对的具体响应，不能外推为对应 CLI 从不提供公开思考。

Pi 原生 RPC 没有直接的三分类查询，因此新增仅本次运行显式加载的只读观察器，继续保留 `--no-extensions`，不启用用户其他扩展。观察器从官方 `context_with_system` 取得实际请求的完整 transcript，用同一已核验安装版 Pi 1.0.4 的官方 `getCurrentSystemMessage` 折叠系统提示与工具增删，再用 `estimateTokens` 分别估算系统提示词、工具定义、对话消息。消息、系统提示、工具 schema、凭据及重放签名不进入统计包；私有 fd3 只传 nonce、连续序号、精确会话／模型身份、容量和数字分类。桥在准入前、停止后或终态后拒绝观察，校验 nonce、连续序号及精确会话／提供商／模型后剥除 nonce，交由真实 `TelemetryReader` 和共享投影提供给完整官方原生上下文组件，不在插件拼装新的统计界面。

真实隔离验收沿用户保存的 `zai-coding-cn/glm-5.3-flash / low` 进行，每次只提交一个新 Worker 用户轮次，未恢复旧会话或换模型。三次尝试分别保留，不能只报告最后成功：

| 尝试 | 结果 | 实际边界与处理 |
| --- | --- | --- |
| `pi-live-2334Aa` | 正文和进程清理通过，分类观察为0，分类验收失败 | Pi RPC 将普通 `stdout.write` 重定向到 stderr，观察包没有进入统计通路 |
| `pi-live-YuTUg7` | 正文和进程清理通过，分类观察仍为0，分类验收失败 | 官方 main 在扩展加载前已接管 stdout，仅在扩展初始化时保存 writer 仍不足；没有把局部模块回放当实际 CLI 成功 |
| `pi-live-lRcgdK` | fd3 修复后的隔离真实验收通过 | 实际上下文观察1条，三分类及逐响应账单均进入真实原生数据投影 |

第三次的系统提示词／工具定义／对话消息为 **714／1108／29**，均明确标为实际请求的原生估算。独立的原生上下文为 **1974／1,000,000**；单响应账单为 input **1954**、output **20**、cache read/write **0／0**、total **1974**、reasoning **0**。三分类不为凑齐1974而重分配差额。该次正文随机标记匹配，没有调用工具或返回公开思考；5个 Host 捕获进程均以0退出，全部 `waitForExit` 确认关闭，原用户来源文件哈希不变，raw 中没有凭据或观察器私有配置。观察钩子证明1次逻辑请求 transcript，不等于已经独立统计所有 provider HTTP 重试次数。

成功后只读复核另发现：若同 run 后续请求的分类估算不支持或抛错，静默跳过会让前次分类附到新占用。随后修复为精确会话／模型身份有效的新钩子先递增序号，再明确发送 `categories:null`；桥保留该未知状态，共享层仅使分类失效，不填零、不改变独立占用与容量。离线回归覆盖有效→未知→抛错→恢复四个连续请求，以及迟到／重放／不支持版本。最终3文件35项通过；这项 unknown 失效修复发生在第三次真实成功之后，仅作离线验证，没有追加真实模型调用，不能称为该边界已经实模复验。

上述新增真实验收是隔离 preview 的 Pi 单轮无工具场景；OMP 的本轮证据是精确旧 Session 的只读核查，AGY 的其他过程由其专属记录说明。它不代表全 CLI、运行中／取消／续聊／工具的所有真实状态均通过，也不追写旧 Pi 分类或为旧样本补造思考。第15阶段的30状态浏览器模拟、既有 Desktop 安装与第16阶段此次真实数据通路证据须分别理解。

私有证据索引：`.test-data/seven-cli-regression-20261017/pi-final-summary.json`、三次 `pi-live-*/report.json`、`.test-data/pi-omp-regression-20261017/shape-evidence.json` 及 `official-cli-fd3-offline.json`。证据只保留必要 shape、数字和来源哈希；用户原始长内容与凭据不进入 Git。
