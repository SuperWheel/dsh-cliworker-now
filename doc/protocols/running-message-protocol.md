# 运行中发送的原生依据

本页记录 v0.7.10 在 2026-10-16 重新核对的全部 11 CLI 通路。已接通 Codex、Hermes、Pi 和 OMP 的当前运行引导；其余通路默认排队。本页的“不启用”指当前安装版与所用通信入口缺少满足插件契约的严格能力证据，不代表整个产品永远不支持引导。引导使用当前进程、模型及会话，不新建轮次；原生接收回执表示 CLI 已接收消息，不代表模型已执行。2026-10-15 的实际验收记录保留在文末。

## 11 CLI 证据矩阵（2026-10-16）

| CLI / 已核对版本 | 当前入口与追加输入证据 | 原生身份 / 接收回执 | 本次默认 |
|---|---|---|---|
| Codex 0.162.1 | `app-server` 的 `turn/steer` 明确追加到正在执行的轮次，不创建新轮 | `threadId` + `expectedTurnId`；响应 `turnId` 必须一致 | 引导 |
| Hermes 3f2abce7f4 | Runs API 专用 `POST /v1/runs/{run_id}/steer`；服务端仅在该 run 正在运行时接受 | `object:hermes.run.steer`、同一 `run_id`、`accepted:true`；本机 API 无 steer 幂等键，桥端未知结果不重投 | 引导 |
| Pi 1.0.2 / 1.0.4 | 原有 RPC `steer`；空闲不自动启动新轮 | 匹配请求 id、`command:steer`、`success:true`，区分原生终止事件 | 引导 |
| OMP 16.4.4 | 原有 RPC `steer`，不依赖其他版本新增命令 | 匹配请求 id、`command:steer`、`success:true` | 引导 |
| Claude 2.1.287 | 官方 streaming input 定义顺序处理多个 user 消息；双向 stdin、消息重放 ACK 不能证明严格属于当前轮 | 本机内部可见 mid-turn fold 元数据，但没有已确认的当前轮前置条件和可靠拒绝契约；不以普通 user ACK 代替 | 排队 |
| Antigravity 1.3.6 | 官方 `--input-format stream-json`：每个 user prompt 完整执行一轮，应等该轮 `result` 再发下条 | 同一 `conversation_id` 可跨多轮，不能证明是当前轮引导 | 排队 |
| Kimi 2.1.1 | 安装包 ACP `AcpSession.assertNoActiveTurn()` 在第二个模型 prompt 到来时明确拒绝 busy | `session/prompt` 以 `stopReason` 结束整轮，没有所需 steer 接收回执 | 排队 |
| Grok 1.0.50 | 有专门 `x.ai/interject`；官方实现允许 idle / final-drain 竞争时转成后续普通 prompt | 只回 `status:queued`，不绑定预期轮次，不能确认严格属于当前 run | 排队 |
| ZCode managed 0.16.9 | legacy `session/send` 明确拒绝 active prompt；本机 v4 `sendText(requestedDelivery:guide)` 有内部引导能力，也可能走普通启动/排队 | 公开 v4 payload 无预期 turn 前置条件，`inputAccepted` 的 `queue/startNow` 不足以确认当前轮 steer | 排队 |
| OpenCode 1.19.0 | `prompt_async` 是会话 prompt 入口；官方 `PromptInput` 没有预期活动 run/turn，`loop()` 使用 `ensureRunning` | HTTP 204、用户消息 ID 或随后 SSE 仅证明 prompt/会话活动，不是同轮 steer 的专用回执 | 排队 |
| MiMo 0.1.15 | 同类 HTTP `prompt_async`；官方 `PromptInput` 没有活动 run/turn 前置条件，`loop()` 可启动或加入会话执行 | 无满足当前轮身份绑定的专用接收回执；不把普通 prompt 或 HTTP 204 当引导 | 排队 |

### 未启用通路的依据

- [Claude 官方 streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)将多消息描述为顺序排队并允许中断。本机 2.1.287 的 `priority`、`isReplay` 和 `user_message_uuids` 能辅助归属，但不能据此保证追加只作用于当前轮、终态竞争时不创建下一轮；本次不开放通用 stdin。
- [Antigravity 官方 headless](https://antigravity.google/docs/cli/headless#stream-prompts-from-stdin)明确一个输入对应一个完整 turn / result，并建议等待 result 后发送下一条。连续进程复用只是减少启动开销。
- [Kimi ACP 入口](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp)对照本机 2.1.1 内嵌的 `packages/acp-server` 源码：模型 prompt 先执行 `assertNoActiveTurn()`，活动 driver 未结束时抛出 `turn.agent_busy`。不绕过 ACP 去调用内部 agent 接口。
- Grok 2026-10-16 获取的[官方 interject handler](https://raw.githubusercontent.com/xai-org/grok-build/main/crates/codegen/xai-grok-shell/src/extensions/interject.rs)仅将请求送入会话命令通道并回 `status:queued`；[官方会话处理](https://raw.githubusercontent.com/xai-org/grok-build/main/crates/codegen/xai-grok-shell/src/session/acp_session_impl/interjection.rs)在空闲或错过本轮最后 drain 时调用后续 prompt fallback。安装版 1.0.50 的静态字符串交叉证实 endpoint / 字段；不将获取的 main 源码声称为安装版的固定 commit。即使确有 interject 功能，这个契约也不满足“不新开下一轮”的本次边界。
- ZCode 核对本机受管 `cli/zcode.cjs` 的 `sendPrompt`、`commandPayloadSchemas.sendText`、`sendText`、`startPromptTurn`：legacy active prompt 返回错误；v4 使用 `sendInput(delivery:start_turn, queueDelivery:guide)`，可能创建新轮，且回执不足以绑定原轮。内部 Core `steerTurn(expectedTurnId)` 的存在不等于当前 app-server 对外暴露了等价严格入口。
- OpenCode 核对[官方 Server API](https://opencode.ai/docs/server/)、[1.19.0 PromptInput / loop](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.0/packages/opencode/src/session/prompt.ts)及[运行状态服务](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.0/packages/opencode/src/session/run-state.ts)。MiMo 核对[0.1.15 PromptInput / prompt / loop](https://raw.githubusercontent.com/XiaomiMiMo/MiMo-Code/v0.1.15/packages/opencode/src/session/prompt.ts)。两者普通 prompt 可能影响正在执行的会话，但 API 缺少“仅限当前运行，已结束则不启动”的原子前置条件及对应回执，故本次保留排队；不是因为插件尚未写 steer 分支而判定不支持。

## Codex

- [官方 app-server 引导协议](https://developers.openai.com/codex/app-server/#steer-an-active-turn)与安装版 0.162.1 生成的 JSON Schema 一致：`turn/steer` 必须携带当前 `threadId`、`expectedTurnId` 和结构化 `input`；当前轮不存在或身份不符时原生拒绝，不产生新的 `turn/started`。
- 桥将稳定消息 ID 放入 `clientUserMessageId`，每次受准许尝试使用独立 RPC id，只认可匹配 `turnId` 的响应。不把该字段当未经证实的服务端幂等保证；桥端先登记请求，成功和未知结果都不重投。
- 回复和终态可能在同一 stdout chunk。桥在同步帧分发时记录接收回执发生在终态之前，避免 Promise 微任务恢复时被紧随其后的 `turn/completed` 错判；若先观察到终态再收到回执，保持未确认。
- 当前轮未就绪、已结束、停止、权限/工具失败或恢复身份改变时不投递；引导不携带模型、目录或权限覆盖。

## Hermes

- 本机 3f2abce7f4 的 `gateway/platforms/api_server_runs.py` 对照[官方 Runs 实现](https://raw.githubusercontent.com/NousResearch/hermes-agent/main/gateway/platforms/api_server_runs.py)：能力需明确声明 `run_steer`，专用 endpoint 验证该 run 仍在运行，再调用该代理的 `steer`。插件复用本轮受管回环地址、Bearer 凭据和已绑定 `run_id`，不创建另一个 run。
- 仅认可 `object:hermes.run.steer`、原 `run_id`、`accepted:true` 的原生响应。服务端明确拒绝与连接中断/500/无效回执分开；未知结果不会自动重试或转入排队。该版本没有 steer 幂等键，由私有桥按稳定请求 ID 去重。
- accepted 只代表代理已接收待消费引导。原生若在下个安全点前结束，会在 final 的 `pending_steer` 留下未消费内容；插件保留原生记录并给出诊断，不能称模型已执行，也不自动改成下一轮。
- 当前 run 终态或停止后关闭引导准入。Steer 与 Stop 使用不同私有邮箱、nonce 和命令类型；两者不会互相解释输入。

## Pi

- [官方 RPC 命令](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc-commands.md#steer)定义 `{id,type:"steer",message}`，响应重复请求 id，包含 `command:"steer"` 和 `success`。本次同时核对本机官方 1.0.2、1.0.4 包中的同名文档，以及 1.0.4 的 `dist/modes/rpc/rpc-mode.js` 与 `dist/core/agent-session.js`。
- 新版成功响应可能携带 `data.disposition:"queued"` 或 `"handled"`；前者代表进入原生引导队列，后者代表输入处理器已接手，均不能解释为模型已经完成。
- 文档规定引导在当前 assistant 的工具调用结束后、下一次模型调用前生效，并不保证打断正在输出的内容。纯 `steer` 在空闲状态不会自动创建新一轮，插件只在本轮尚未收到终止事件时发送。
- [官方 RPC 生命周期](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md#run-lifecycle)区分 `agent_end` 和 `agent_settled`；插件沿用后者作为终止信号，并在退出前复核原生状态。

## OMP

- 本机直接读取的 CLI 版本为 `omp/16.4.4`。核对[该版本官方 RPC 实现](https://github.com/can1357/oh-my-pi/blob/v16.4.4/packages/coding-agent/src/modes/rpc/rpc-mode.ts)，`steer` 分支调用 `session.steer(command.message,command.images)`，完成后返回匹配 id 的 `command:"steer",success:true`；失败返回 `success:false`。
- 不依赖新版才有的额外控制命令，不要求成功回执含 Pi 的 disposition 字段。本机另一个 Bun 包版本更高，其源码仅作为补充交叉检查，不作为 16.4.4 的能力证明。
- 插件沿用已接入的终止 `agent_end` 判断与最后 `get_state` 校验；本次没有迁移到新版 OMP 的其他生命周期协议。

## 插件通路与边界

当前 Host 保持原有进程树管理，未开放通用 stdin、终端按键或 shell。支持引导的每次准备执行，在该次私有请求目录建立独立控制邮箱：目录 0700、文件 0600，随机运行凭证、请求 id 摘要及文本长度限制；引导邮箱只接受 `steer`，停止使用另一个 namespace。读取拒绝符号链接、硬链接、越界长度及读取期间变化；目录身份变化后拒绝操作。不支持的 7 条通路不创建引导邮箱，历史 transport 独立判定，不因新能力自动迁移。

Host 对重复请求复用原结果；同一 id 对应不同文本会被拒绝。明确未准备且未投递、或原生返回 `success:false` 时，以 `STEER_REJECTED` 标识确定未接收，允许用户重试；每次尝试使用独立文件名和原生请求 id，最多三次。成功与未知结果不会重投，每轮最多 200 条不同消息。

桥将请求关联至唯一原生 id，只在明确匹配的成功回执后确认接收。原生拒绝只影响该条引导，不改变原任务的正常完成结果。先观察到终止再收到回执时，不报告引导接收成功；所有未决回执结束后才进行最终状态校验。已发布的匹配回执优先于停止等待信号，关闭通路会先等 Host 读完已发布回执再清理邮箱，避免成功接收被退出竞态覆盖。原生异常退出或停止会拒绝未决请求，结束后关闭控制通路。超时或连接中断不自动改为排队、插队或重投。

桥不转发原生 user 消息，已确认的引导用户消息由 Host 统一追加，避免重复；原生的后续 assistant、公开过程与工具记录继续沿现有协议展示。

## 2026-10-16 协议回归

模拟原生进程与回环 HTTP 夹具覆盖 Codex/Hermes 同一进程、会话及 run 的引导，成功/明确拒绝/未知/错误 run 或 turn、稳定 ID 去重与不同正文拒绝、终态先后、停止、能力缺失和进程清理。Codex 另覆盖回执与终态同 chunk 的次序；端到端测试通过实际私有 mailbox 和原生桥进程，确认仅一个原始 turn/start、一个 steer，终态后不再投递。所有进程均明确为合成夹具，不接触真实 CLI 账号或模型。

本次关联 `native-guidance`、`native-primary-runners`、`native-transport`、`native-http`、`pi-omp-control`、`native-stop`、`native-runtime` 共 7 个测试文件 128 项通过。HTTP 夹具使用本机回环端口。真实模型引导、Desktop 与平台结果另记 `doc/tasks.md`，不由夹具或协议存在替代。

## 历史协议验证（2026-10-15）

受限邮箱测试使用模拟处理器，验证成功回执、重复请求只投递一次、拒绝后可继续、关闭、取消、超时、错误凭证、非 steer 命令及链接文件拒绝。原生桥测试使用明确标注的模拟 Pi/OMP RPC 进程，验证两种成功响应、相同进程/会话、重复投递、原生拒绝、终止先于回执及异常退出；不调用真实账号或模型。

真实模型执行、Windows 实机及已安装 Desktop 不由这些模拟结果替代。具体运行结果与集成验收记录于 `doc/tasks.md`。


### 已安装 Desktop 补验（2026-10-15）

用户授权后，在 macOS 已安装 Desktop 使用保存的 Pi GLM-5.3 / Low 完成一次真实引导。消息在当前输出期间获得接收确认，原生会话中也存在该消息；插件 runId、原生会话和连接保持不变。Pi 完成当前输出后，在同轮下一条 assistant 回复中执行引导，回复 `PI_STEER_OK`；这不代表即时截断当前生成。无工具调用，Host 完成且待发送为空。

同轮 Codex 验证了正常完成后自动排队发送、卡片插队先停止再发送，以及其余队列顺序保留。OMP 本轮仅确认实际设置页默认引导，没有进行真实模型引导；Windows 未复验。前两次 Pi 尝试在引导发送前结束，不计入原生引导通过。详细证据边界见 `doc/tasks.md` 的 Desktop 最小验收记录。


## 引导与普通排队的独立入口

按用户追加要求，Client 使用独立 `steerMessage`，Gateway 和 Host 同名入口只处理 `expectedRunId` 的当前运行输入；普通排队的 predecessor、队首、暂停、代际与正常完成后自动续发不适用于引导。旧暂停卡片或等待排队回执不阻止当前运行接收引导。多条引导各自核对原生接收，不用本地普通提交链串队；原生通路自身遵循各 CLI 输入语义。未就绪、停止中或终轮竞争明确保留输入/核查状态，不迁移到下一轮。
