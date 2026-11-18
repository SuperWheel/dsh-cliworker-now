# 当前 Kimi Code 计费用量补充接口

2026-10-17，v0.8.1，活动变更 `integrate-native-cli-conversations` 第 11 节。保留当前 Kimi ACP 进程、模型确认及原生保护，不切换旧 Python Kimi CLI/Wire，不启动 Web 服务。对本次已确认的 session 做严格只读补充；没有读取凭据或无关用户会话。

## 当前版本证据

本机 `~/.kimi-code/bin/kimi --version` 为 `2.1.1`；离线 `--help` 公开 `acp/web/server` 等，没有旧版 `--wire/wire`。其安装包内嵌源码与下列官方同版本关键字段逐项核对。官方 tag `@moonshot-ai/kimi-code@2.1.1` 对应固定 commit `f67e6398fb3210ad8ace970e2dfd5bcc984ed61f`；源码仅下载到 `/tmp`，没有构建或运行。

- [`usageOps.ts:13–29`](https://github.com/MoonshotAI/kimi-code/blob/f67e6398fb3210ad8ace970e2dfd5bcc984ed61f/packages/agent-core-v2/src/agent/usage/usageOps.ts#L13-L29)：`usage.record` 是 durable 事件，含真实 agent、model、四个 Token 桶及 `usageScope`。输入 `inputOther` 不含两个缓存桶；`output` 没有独立 reasoning 数量。
- [`usageAgentModel.ts:27–76`](https://github.com/MoonshotAI/kimi-code/blob/f67e6398fb3210ad8ace970e2dfd5bcc984ed61f/packages/agent-core-v2/src/session/usage/usageAgentModel.ts#L27-L76)：按 agent 累加 `byModel/total`，内存另有 `currentTurn`。主 agent 累计不能自动代表全部子 agent 会话账单。
- [`loopService.ts:1783–1834`](https://github.com/MoonshotAI/kimi-code/blob/f67e6398fb3210ad8ace970e2dfd5bcc984ed61f/packages/agent-core-v2/src/agent/loop/loopService.ts#L1783-L1834)：`context.append_loop_event.event.type='step.end'` 保存 `uuid/turnId/step/usage/messageId`；[`2030–2068`](https://github.com/MoonshotAI/kimi-code/blob/f67e6398fb3210ad8ace970e2dfd5bcc984ed61f/packages/agent-core-v2/src/agent/loop/loopService.ts#L2030-L2068) 在终态前 drain 已排队的持久化，再发 `turn.ended`。
- [`llmRequesterService.ts:477–490`](https://github.com/MoonshotAI/kimi-code/blob/f67e6398fb3210ad8ace970e2dfd5bcc984ed61f/packages/agent-core-v2/src/agent/llmRequester/llmRequesterService.ts#L477-L490)：缺 provider usage 会规范化为 `emptyUsage()` 四零，因此四零不能证明账单完整。本补充层保留 unknown；输入或输出为零但四桶总数大于零的真实回执仍可使用。这里读取的是 CLI 规范化账单，不声称独立验证服务端计费准确性。
- [`workdir-slug.ts:17–23`](https://github.com/MoonshotAI/kimi-code/blob/f67e6398fb3210ad8ace970e2dfd5bcc984ed61f/packages/agent-core-v2/src/_base/utils/workdir-slug.ts#L17-L23) 与 [`addressing.ts:3–17`](https://github.com/MoonshotAI/kimi-code/blob/f67e6398fb3210ad8ace970e2dfd5bcc984ed61f/packages/agent-core-v2/src/workspace/sessionLifecycle/internal/addressing.ts#L3-L17) 定义精确 home、workspace、session、agent 路径。

## 接线与真实性边界

`KimiDurableUsageObserver` 在 ACP 模型确认之后、发送 prompt 之前保存 cursor，只计算官方路径 `<KIMI_CODE_HOME>/sessions/<workspaceKey>/<sessionId>/agents/main/wire.jsonl`，不枚举或扫描其他会话。核 `state.json` 的版本、真实 sessionId、项目和主 agent；逐层要求私有目录、同用户、非 symlink，文件同样检查所有者、权限、大小上限与 no-follow。运行前后 inode、device、原字节前缀必须一致；部分行、截断、替换、未知版本或身份变化均不借用历史数据，不修改目录、权限或文件。

只接受 cursor 之后唯一新增的主 `turn.prompt`，核未复用的 promptId/turnId、原始输入一致性、实际 step UUID、逐请求 `llm.request` 模型/`turnStep`、对应 `step.end` 与匹配 `turn.ended`。时间和文本不是唯一身份。多个新 turn、steer、分支/undo、未完成历史、错误模型或无法确认的路径保持未知。当前分支历史没有复刻上游 reducer，保守不补；大于 16 MiB 的 wire 或非私有存储同样保留未知。终态尾部最多等待 500 ms，防止异步 `turn.ended` 尚未落盘。

完整请求数、step 账单与 `usage.record` 桶一致，且成功终态、没有子 agent、辅助调用或重试缺口，才发送 `scope:'run'`。其他已确认的主 agent 样本只标 `reported`。不发送冒充全部会话的 session 合计。缺 provider messageId 只省单响应回执，不阻塞能独立证明的整 run 账单；不会将这些回执硬绑到已丢失原生 response identity 的 ACP 正文行。

只输出以下白名单数据，无 prompt、对话、工具内容、签名或路径：

```json
{"type":"cliworker.kimi_usage","source":"kimi.durable.main-wire","sessionId":"synthetic-session","model":"synthetic-model","turnId":"0","scope":"run","usage":{"inputOther":11,"output":3,"inputCacheRead":7,"inputCacheCreation":2}}
```

逐响应另发 `cliworker.kimi_response_usage`，携带同一 source/session/model/turnId、真实 `stepId/responseId` 和四桶 usage。取消/拒绝时允许保留已完成模型步骤的真实 `reported` 回执，不声称全部 run 账单。

Web API 亦公开 `agent.status.updated.usage.{byModel,total,currentTurn}` 和 `turn.step.completed.usage`，可作后续支持新 transport 的官方证据；本次不启动服务、不更换运行协议。上下文 ACP `used/size` 保持独立；内核 `statusSize` 可取 measured/estimated/hybrid，不能把它当四桶账单，也没有确证的 system/tool/对话细分数量供伪造分类。

## 验证

新增离线模拟回归核已完成/取消账单、真实零输出、缺缓存、四零未知、多响应、请求覆盖、旧账单不混入当前 run、重试/aux/子 agent 降级、身份歧义、分支、迟到落盘、inode/前缀变化、权限、symlink、路径穿越与不写源文件。实际执行记录由主任务统一写入 `doc/tasks.md`；本补充接口尚未进行真实账号/模型、Windows 或 Desktop 最终验收。
