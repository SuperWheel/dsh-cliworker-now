# v0.7.10 原生回复、公开过程与上下文

本说明针对当前原生通信通路；历史通路不静默升级。公开过程只展示 CLI 实际返回的内容，不生成缺失的思考、参数、结果或调用层级。累计 token 用量与当前上下文窗口是不同指标。

## 消息流与工具

| CLI | 回复边界 | 工具与公开过程 |
| --- | --- | --- |
| Antigravity | 原生 `step_index`；最终汇总按已观察步骤核对 | `tool_name`、`tool_info.parameters`；没有调用 ID 时保留平级，不把步骤编号当父调用 |
| Codex | 原生 agentMessage item ID；最终响应是最后一个回复 | 只展示原生 reasoning summary；工具 item ID、参数、命令、结果和退出码按实际字段保留 |
| Claude Code | message ID + content block index；最终响应单独核对 | 公开 thinking block、tool_use/tool_result；签名与不可见推理不展示 |
| Kimi / Grok | ACP assistant chunk 连续片段；明确工具边界后新建片段 | ACP toolCallId、rawInput、rawOutput/content；只按明确的原生父调用建树 |
| MiMo / OpenCode | 原生 messageID + partID；delta、完整快照及最终读取相互核对 | reasoning part 与 tool part 保持原生顺序；同 part 状态更新不新建消息 |
| ZCode | 原生文本片段，明确工具边界后分段 | 原生 toolCallId；调度依赖不冒充父子关系，省略的输入不反查未授权路径 |
| Pi / OMP | 原生 message_start 对应片段 | 原生工具调用 ID、开始参数及完成结果；按实际消息顺序展示 |
| Hermes | 连续 message.delta 片段；工具/中间消息边界单独分段 | 原生工具调用字段；final.output 不擅自当作全部历史回复的拼接 |

此前 OpenCode/MiMo 的增量缺少稳定步骤标识，导致一条回复显示成多个段落。新流按真实消息和 part 归并；最终汇总仅在明确为本轮聚合时移除已经展示的完整前段，保留正文空白。旧记录只在有界原始记录能够证明“同一会话、一个 assistant message、一个 text part、全部片段与终态完全一致”时只读恢复，不改写历史文件。多 part、跨工具、读取中变化或证据不足的记录不盲合并。

## 上下文数据能力

以下是字段能力，不能代替每个账号/模型/平台的实际验收。缺失、压缩后待计算和不支持均显示未知，原生明确的 0 才显示 0。

| CLI | 当前窗口与容量来源 | 系统提示词 / 工具定义 / 对话消息 |
| --- | --- | --- |
| Antigravity | 同原生 conversation 的本地 `ContextWindowMetadata` | 读取原生 TokenBreakdown 分类，标为原生估算 |
| Codex | `thread/tokenUsage/updated.last.totalTokens` 与 `modelContextWindow`；`total` 单独作累计用量 | 当前公开通知没有三项分类，保持未知 |
| Claude Code | assistant 最新 input + cache_read + cache_creation；已核验 modelUsage.contextWindow | 只接受同会话原生 context summary 实际返回的分类；不为探分类调用额外生成或 full 计数 API |
| Kimi / Grok | ACP 实际 `usage_update.used / size` | ACP 未返回分类时未知；Grok 是否实际发出该更新须以运行证据为准 |
| OpenCode | 最新 assistant input + cache.read + cache.write；容量只用匹配 providerID/modelID 的 `limit.context` | 新请求可通过精确 endpoint 的 run-only relay 读取实际请求组成，按官方算法提供三项估算；旧记录未知，累计 tokens.total 不充当窗口占用 |
| MiMo | 按本机 0.1.15 原生 ACP 口径使用最新 input + cache.read；容量绑定原生 provider/model 的 `limit.context` | 新请求可通过 run-only relay 对实际组成提供官方算法三项估算；旧记录未知，不套用 OpenCode 对 cache.write 的不同口径 |
| ZCode | 原生 snapshot.projection.contextUsed/contextWindow | 没有分类时未知；使用原生压缩后投影，不拿累计 totalTokenCount 推算 |
| Pi / OMP | 原生 get_session_stats.contextUsage.tokens/contextWindow，标为原生估算 | 分类未知；压缩后 tokens=null 保持未知；不将 session_stats.tokens 累计值当窗口 |
| Hermes | Runs API 之外，原进程官方 post_api_request 提供已绑定请求的 input/context_length；不拿会话累计当占用 | 新的已核验 chat_completions 请求可由官方 pre_api_request + Hermes 原生估算器提供部分/完整分类；旧记录无快照保持未知，不借 TUI 当前 Agent 数据 |

OpenCode 的窗口口径核对官方 [ACP usage 实现](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/opencode/src/acp/usage.ts)，MiMo 单独核对安装版原生实现。Codex 按安装版本 app-server schema 和原生 token usage 定义核对，缓存与 reasoning 不重复加入 totalTokens。原生快照、模型容量、来源和估算标记经 Host 白名单投影；Client 不读取本机 CLI 文件或父会话统计。

## 与 Harness 原生界面的一致性

过程展开复用 Harness 公开的 DisclosureRow、Markdown、状态与工具结果 primitives，读取宿主 `ui-chat` 工作详情模式。保持思考、工具与正文的实际顺序；失败、停止及中途输入仍可展开核查。工具树只接受真实的调用 ID 和父调用 ID，缺失父项或循环关系不伪造层级。具体尺寸与交互见 [公开过程设计](public-process.md)。

上下文菜单沿原生 ContextMeter 的 264px 宽度、圆环、分段条和三项图例。已知总量但分类缺失时，保留总量并将缺失项显示为 `—`；不靠相减补分类。估算值带 `~`，分类比例只按已公开数据计算。原生完整 ReasoningRow/ToolCallTree/ContextMeter 没有作为公共组件导出，因此通过公共 primitives 适配，不导入私有组件或伪装父会话。

实际测试、真实调用及平台缺口记录在 [验收记录](../tasks.md)，不得将模拟夹具或只读元数据检查计为真实生成通过。


## 第16节 HTTP 请求组成的检查边界（2026-10-17）

MiMo 0.1.15 和 OpenCode 1.19.0 的原生 usage 不含分类。当前实现从原生有效 `/provider`／`/config` 核对已选模型的真实 endpoint，仅在 owned 进程内通过内联原生配置路由到随机 nonce loopback relay。HOME、PURE、cwd、data、permissions 保持；不开放用户插件，不改源配置。原 metadata server 退出后再启动临时路由 server，不并行写同一 data。relay 透明转发请求字节、headers、响应/SSE 和 abort，关闭时清理自身 socket/agent；只输出数值与绑定身份，不存请求或秘密。

分类须同时匹配 native session header、确切当前 user 文本、原生 API model 与主请求结构，title／foreign 请求不进入分类。匹配的新请求先清空旧分类，再发布完整有效三项；oversized、无效 JSON 或同会话无法分类时保持 unknown。原生总占用、模型容量与分类独立，分类不会覆盖 usage，也不生成成功回复。

三项采用本机官方估算算法 `Math.max(0, Math.round(text.length / 4))`，明确 `estimated:true`，并非精确 tokenizer 计数或账单比例分摊。最终 preview 的精确保存选型真实隔离单轮结果如下：

| CLI / 保存选型 | 系统 / 工具 / 消息（估算） | 原生占用 / 容量 |
| --- | --- | --- |
| MiMo `xiaomi/mimo-v2.6-flash` / low | 3868 / 16987 / 38 | 21125 / 1048576 |
| OpenCode `zhipuai-coding-plan/glm-5.3-flash` / low | 2294 / 4113 / 39 | 6041 / 1000000 |

每次一个用户轮次、一个已绑定主请求，三项经真实共享投影保留；完成、回复标记、无意外工具、进程范围退出及原 source hashes 未变均已核验。私有报告为 `.test-data/seven-cli-regression-20261017/http-mimo-4EkKKR/report.json` 与 `http-opencode-erdy4T/report.json`。先前 MiMo `http-mimo-749TJY/report.json` 生成成功但观察 0，原因是 PURE 禁用外部 plugin，分类验收失败；保留该失败证据，最终 relay 重验成功不能覆盖它。4 文件 81 项关联离线回归通过，官方 CLI 零模型配置探针通过；不代表 Desktop 安装或完整工具／续聊／取消／Windows 验收。

旧截图与旧 raw 未保存真实请求组成，三项继续显示 `—`，不从 DSH 镜像、账单或当前 CLI 请求倒推。实现、失败调查和完整证据范围见 [数据审计第16节](../audits/cli-native-data-audit.md)。
