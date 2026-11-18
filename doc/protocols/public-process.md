# CLI 公开过程展示

本页记录公开协议边界、v0.8.1 原生会话行为与保留的 v0.7.10 兼容视图适配。过程只展示 CLI 已返回的公开可读内容，不请求、推断或解密未公开内部推理。协议能力、当前安装版是否实际返回、具体模型是否输出，是三个独立事实。

## 原生公开字段

| CLI | 当前原生通路的公开内容 | 身份与展示边界 |
| --- | --- | --- |
| Antigravity | stream-json 的工具步骤与 `tool_info.parameters` | 按原生 `step_index` 更新；没有公开思考字段时不从工具参数生成思考。 |
| Codex | app-server reasoning `summaryTextDelta` / reasoning item `summary[]`，工具 item 的参数、命令、结果与 `changes` | 按 item ID 和摘要 index 更新；不读取 raw reasoning。`fileChange` 的统一补丁只展示已验证的局部 hunk。 |
| Claude Code | stream-json 的公开 thinking block，`tool_use` / `tool_result` | 按 message ID 与 block index 更新；工具关联只用 `tool_use.id`、`tool_use_id` 与明确的 `parent_tool_use_id`。 |
| Kimi / Grok Build | ACP 的 `agent_thought_chunk`、`tool_call` / `tool_call_update` | 只接收 text 内容；工具按 `toolCallId` 更新。不能从工具名字或调度依赖猜父调用。 |
| MiMo / OpenCode | HTTP/SSE 的 reasoning part、tool part | 按原生 session、message、part 身份更新；增量和完整快照不重复显示。 |
| ZCode | app-server 的公开 `reasoning_delta`、工具事件 | 只投影公开文本；工具按原生 `toolCallId` 更新。 |
| Pi / OMP | RPC `thinking_delta` / `thinking_end` 和最终 message 的 thinking block，工具开始与结果 | 按消息和 contentIndex 更新；最终公开快照覆盖增量，redacted 或已撤回内容清除。 |
| Hermes Agent | Runs SSE 的 `reasoning.available`、工具开始和结束事件 | 只展示实际公开摘要；当前没有已确认工具调用 ID 时保持平级，不把 FIFO 配对序号伪装成原生父调用。 |
| Qoder CLI | ACP 的 `agent_thought_chunk` 与公开工具事件 | 按原生会话和消息更新；没有公开文本时不从用量或最终正文构造摘要。 |

新 Worker 的完整协议、恢复与停止边界见 [原生通信协议](../native-protocols.md)；既有 Worker 保留持久 transport 所属的旧通路。表内字段是接入范围，并不意味着每个模型和每轮任务都返回公开摘要。

v0.8.1 原生会话的完成行仅在确有公开思考、计划或工具记录时提供展开。Grok / OMP 没有这些内容的轮次保留原生完成状态，不在回复正文或轮次尾部插入缺失说明。reasoning token 数、空片段、签名和最终正文都不能用来补造思考内容。

OMP 的 OpenAI 订阅通路使用原生公开摘要配置；实际安装版 16.4.4 的隔离本机探针确认请求 `reasoning.summary=detailed`、`effort=low`，公开 summary 经原生 RPC 与生产桥完整传递。Grok 官方 Responses 通路默认请求 `concise` 摘要，`reasoning_summary` 是原生模型配置；TUI 的 `show_thinking_blocks` 只控制终端展示，不作为 ACP 的摘要开关。两者仍取决于该轮实际返回内容，旧轮次没有公开摘要时不可补回。实际请求探针与真实历史核查的范围见 [验收记录](../tasks.md)。

## 每轮思考记录

12 种 CLI 的已采集公开思考共用“思考记录”入口；这不表示每种 CLI、模型或每轮请求都提供思考文本。生成期间保留原生思考预览；本轮结束后，先展开“已完成，用时…”的原生过程，再展开分析/工具步骤组及其中的“思考记录”。记录沿原生步骤与工具顺序显示，随外层过程收起，不在答复功能条前重复展示。完成、停止和失败均保留已记录内容，关闭重开子对话后仍可查看。只有工具、正文、空白或非公开字段时不显示空的思考面板或缺失提示；只有真实工具时仍可展开工具过程。

面板沿用当前原生子会话已合并的 `assistant-step` reasoning blocks 及原生 ReasoningRow，保留原文、顺序和独立段落；不新增文本存储、伪工具调用或原始日志读取。绑定必须同时匹配 Host-issued Worker、child session 和 parent session；主聊天不增加此入口。展开内容使用原生安全 Markdown，长度较大时在面板内滚动。

Codex 后续 `turn/start` 显式设置 `summary: auto`，保持用户选择的模型和强度，只采集原生 `summaryTextDelta` / `summary[]`。`codex-app-v1` 的公开增量到达后即进入原生思考过程，完成快照不重复，停止或失败保留已公开前缀。开启请求选项不保证每个模型每轮返回内容；是否有记录以实际公开摘要事件为准，不能用 rollout 的兼容字段 `turn_context.summary: none` 判断请求未生效。

2026-10-18 用户再次确认：仅在有公开思考或工具记录时允许展开，不为无内容的完成行添加模型、耗时或用量占位。只读复核当天新增的 `agy-new`、`codex-new`、`zcode-new`、`grok-new`、`pi-new` 问好轮次，均未采集到公开思考或工具记录。实际 Desktop 的 `pi-2` 和 `zcode-1` 第二轮已有公开文本，均可按上述原生层级展开；ZCode 同一会话的其他无内容轮次仍不可展开。这些是既有记录复核，不是新模型调用或五种 CLI 的全部能力验收。后续用安装中 Codex 0.162.1 与隔离本机模拟服务确认 `reasoning.summary: auto` 实际发送，公开摘要可经适配器传入；这不代表问好轮次已产生摘要或完成了真实订阅验收。详见 [数据核查](../cli-native-data-audit.md)。

## 共享投影与内容安全

公开思考使用独立 `reasoning` 事件：`text` 是来源标签，`detail` 是当前可读文本快照。相同步骤覆盖快照，空快照移除旧内容；最终答复和任务结果保持独立。原生协议中的签名、加密、redacted 和 raw reasoning 不成为可读摘要，也不通过任意对象序列化绕过白名单。

工具通过 `PublicToolCall` 白名单传递 `callId`、`parentCallId`、`name`、`input`、`output`、`command` 和 `exitCode`。缺字段不补值。Client 只按同轮内可核对的真实 ID 建立缩进关系，缺父项、循环和过深关系回到平级并说明；不会根据时间、相同名称或文件路径构造调用链。源记录次序不因分组重排，中途用户输入和独立引导消息保留原位置。

已明确的命令使用 Harness `TerminalBlock`，保留原生命令、实际输出与退出码；未知工具使用惰性的 `JsonTree` 或文本。Codex `FileUpdateChange.diff` 是局部统一补丁，经过有界、逐 hunk 行数验证后适配 `DiffBlock`；不读工作区文件，不将局部补丁冒充完整文件。无法验证的差异仍作为普通结构化结果。当前没有跨 CLI 已确认、包含行号及文件总行数的读取结果契约，因此不从参数中的路径猜测 `ReadBlock` 内容。

公开 Markdown 使用 Harness `MarkdownText` 的安全渲染，不执行原始 HTML。工具参数与结果保留为数据，HTML 字符串、脚本与命令均不会因展示而执行。

## 旧兼容视图的界面适配依据

本节描述保留的 `worker-process` 兼容渲染器。v0.8.1 新原生会话由 Harness 官方会话组件直接渲染，其无公开过程轮次不注入缺失提示。

安装版完整 `ReasoningRow`、`ToolCallTree`、`TurnProcessNodeView` 和 `ContextMeter` 没有从公共 Client API 导出；插件不导入内部路径，不伪造 Session，也不借用父聊天的 projection。过程适配直接复用公开 `DisclosureRow`、`MarkdownText`、`TextShimmer`、`StateDot`、`JsonTree`、`TerminalBlock` 与 `DiffBlock`。

过程标题沿原生 33px 加内容字号增量、底部 8px 留白和 L2 细分隔线；展开行沿原生 24px 高度、14px 图标与预览省略规则。思考正文缩进 22px，并保留 Markdown；工具子调用使用 L2 左边线与真实 ID 缩进。分组正文上限为 `min(400px, 50vh)`，滚动稳定；小屏、键盘 Enter/Space 与减少动态效果规则沿公开组件及宿主主题。仅旧兼容渲染器的真实过程组在没有公开思考时保留“CLI 未提供公开思考摘要。”；该提示不用于 v0.8.1 原生会话。

Client 只读订阅 `configForms.get('ui-chat')` 的 `transcriptView`，不写设置、不读父会话。紧凑、标准、详细、完整四种工作详情模式分别继承原生过程分组、已完成过程折叠、实时标题详情及思考预览规则；旧 `normal` / `expanded` 沿原生映射到详细。模式修改立即生效，订阅随插件清理。

原生的过程分组也包含仅有思考的片段，并非只分组工具。此时父组沿原生文案显示“已完成分析”或实际运行中的“正在分析请求”，内层摘要行显示“思考”；完整模式不显示父组，详细模式在运行时不分组。不会为消除重复文案删掉原生层级。

过程耗时只取持久化本轮起止边界；正常完成最少显示 1 秒，停止和失败沿安装版原生标题不附用时。CLI 单独报告的回复耗时和会话累计耗时保留其范围。未结束工具在停止后不会标为成功；失败、不确定及中途输入的过程保持可核查。正常状态文字不再重复组成大段过程卡片。

## 上下文查看

菜单沿安装版 ContextMeter：264px 宽度、12px 内边距、圆环、4px 分段条与“系统提示词 / 工具定义 / 对话消息”三项图例；使用同一主题菜单背景、边框、圆角和浮层。锚定、外点关闭、Escape 与视口边距复用现有原生浮层 primitives。

数据只来自当前 Worker 的 `contextUsed`、`contextCapacity` 与可选 `contextBreakdown`。总量与分类独立保存来源和估算标记；估算数值显示 `~`。三项分类均已提供时，按已知分类的相对构成绘制总占用范围内的颜色分段，分类之和不强行等于服务商总量。分类不完整时只显示灰色总占用条，缺项显示 `—`，不通过相减、均分或补零制造分类。仅有占用或容量时仍保留已知值，不生成百分比。原生明确的 0 与未知不同。

各 CLI 的当前窗口、容量和分类来源及缺口见 [原生检查能力](native-inspection.md)。累计 token 用量不会替代当前上下文，父聊天统计也不会替代 Worker 统计。

## 验收边界

组件回归使用明确标记的模拟事件，覆盖工作详情订阅与清理、公开 Markdown、结构化参数与结果、原生命令和局部差异、真实身份树、缺失/循环关系、停止工具状态、原生耗时规则和完整/部分/未知/零值上下文；同时回归既有队列与独立引导。

隔离浏览器验收必须核对实际服务的 preview `lib/client.js` 路径和 SHA-256，使用独立模拟 profile，禁止模型、原生 CLI 和外网请求。模拟展示不替代真实生成证据。实际浏览器、Desktop、真实账号及 Windows 的完成与限制统一记录在 [验收记录](../tasks.md)。
