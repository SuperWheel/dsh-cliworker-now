# 原生子对话与主对话体验的宿主接口缺口

2026-10-30 当前源码候选迁移至 **0.2.1-rc.5**，公开 tag commit 为 `b830ec950faba0a46dda564be3e2d854afed94f1`。rc.3 的 48 文件扩展在 rc.5 上无冲突应用，增删行与 rc.3 相同；随源码保留官方 rc.4/rc.5 的推理显示文本（去掉开头 `<signature>…</signature>`、Body Slot 增加 `rawText`）与视图标签提示调整。新输入见 `host-extensions/dsh-0.2.1-rc.5`，验证与未验证边界见 `openspec/changes/upgrade-host-rc5/tasks.md`。

2026-10-24 当前源码候选已完整迁移至 **0.2.1-rc.3**，公开 tag commit 为 `1f81c047fc48fa190a683e469daa699857e9afe8`，应用 build identity `be72761` 未解析为公开提交。新输入见 `host-extensions/dsh-0.2.1-rc.3`；保留 rc.3 的视图动作、草稿和快照语义，隔离 rc.2/rc.3 界面与原生设置均可用。下文 rc.2 记录保留为历史，实际最终验收见 `doc/tasks.md`。

2026-10-17 当前候选：本次四包构建输入为用户实际更新的 Desktop **0.2.1-rc.2**。官方源码 tag `dsh-v0.2.1-rc.2` 对应 `687f282e8625c6b8d11ff58211a90524be2e4317`，实际应用构建标记为 `332895e0f7c9d4dbfb29729f5eb367fa263ff986`，两者分别记录，不视为同一提交。源码补丁位于 `host-extensions/dsh-0.2.1-rc.2`，独立候选为 `artifacts/dsh-host-extension-021rc2-data`。四包 manifest 的 220 个文件已校验；实际 Node 24 下四包类型检查与 8 文件、268 项定向回归通过。此处记录构建及验收事实，不作为插件加载的宿主版本白名单；实际安装与 Desktop 验收以 `doc/tasks.md` 对应阶段记录为准。

官方 rc.1 到 rc.2 在四个 UI 包及 slot 文档范围仅四个 package.json 的版本变化；迁移后的 229 个生产源码文件与前一候选字节一致，保留原生 `conversation.chat.flow`、真实子 Agent 和已授权可选接口。新补丁只另修正一项遗留测试，使其使用新版拆分后的原生 UsagePill。构建依赖、内容地址 store、四包产物均独立保存，不替换根 node_modules、旧候选或用户资料；SDK 别名使用本次官方依赖或同版源码，不回落到旧 SDK。

插件是否加载与调用按实际接口能力判定。运行时继续核验子 Agent 生命周期方法、精确 SessionReference/代际、原生侧栏 Slot 合同和 `provideProjections`；缺少能力时明确失败，不以版本号代替能力检测。可选四包仍以实际官方源码、补丁、manifest 和文件哈希冻结，不能将旧 bundle 重标版本后用于新安装。

### rc.1 阶段历史记录

用户先前更新 Desktop 至 0.2.1-rc.1 时，四包曾基于对应官方源码及原生 flow/统计结构完成迁移，目录 `host-extensions/dsh-0.2.1-rc.1`、候选 `artifacts/dsh-host-extension-021rc1-data` 保留不覆盖；当时独立构建与 514 项宿主关联测试通过。该阶段曾将开发依赖固定为官方 rc.1、peer 精确列出当时验过的两个版本；这是历史配置，不代表当前加载政策。后续用户要求取消刻意的版本白名单，当前支持版本说明仅在 Release 中记录。

新版子 Agent 使用 `startActivation`、caller delivery、精确 activation dispose 与 `drainChildren`；旧生命周期接口保留公开 continuable 路径。两种路径均沿真实 child scope 的工具权限执行，不创建额外模型请求。下文未明确标注新日期的“rc.2”指最初的 **0.2.0-rc.2** 决策与实施记录，不应混同本次 0.2.1-rc.2 候选。

状态：2026-10-16 用户已明确授权“允许开发宿主扩展，安装前先验收”。在官方 rc.2 隔离源码中开发和验证，通过后再更新 Desktop；不直接修改运行中的安装包或现有 node_modules。

## 已确认的产品边界

CLI Worker 继续提供原父级管理页、返回入口、Worker 名称和任务操作。单个 Worker 的对话区域使用官方完整侧栏对话入口；保留真实直接子 Agent 和所属主会话，普通会话列表不显示 Worker。实际生成和工具能力仍由 CLI 及受控 DSH 工具桥承担。

## 1. 输入区按钮规则

rc.2 的 `@deepseek-ai/dsh-client-ui-conversation/lib/client.js` 中，原生 InputBar 使用以下规则：

```ts
const primaryStops = running && subagent === null && (empty || blocked !== undefined)
const interruptible = running && continuable
```

因此可续聊子 Agent 运行时出现独立 Stop 与 Send；主对话在对应条件下把主按钮切换成 Stop。这是原组件自己的逻辑。公开 `ComposerBarOwnerProps` 只有布局、锁定、占位等参数，没有呈现策略选项。直接使用官方 `sidebar.chat.conversation` 不会改变该规则。

在隔离宿主源码新增**纯呈现选项** `composerPresentation: 'default' | 'main'`。由官方侧栏入口传到官方 conversation/composer，其默认值保持现状；CLI Worker 的完整侧栏对话可明确选择 `main`，仍用原生主按钮切换规则。

该选项不得改变真实 subagent 地址、parentAvailable、Inbox、模型路由、权限或停止对象。停止继续调用当前真实子 Agent 的官方 stop；输入、队列和引导仍由官方 keyboard/Inbox 决定。插件不得伪造根会话或隐藏按钮。

需改动：宿主公开对话参数、官方侧栏入口的参数传递、InputBar 的按钮呈现判定及对应原生测试。无需改 Worker 父级管理或 CLI runner。

验收：默认主会话与默认子会话无回归；指定呈现策略的真实子 Agent 在空输入、非空输入、运行、停止清理、权限阻塞和不支持引导时均沿用目标原生规则，停止只影响当前 Worker。

## 2. 完整对话的数据来源

rc.2 的嵌套 Factory/Slot 会重新注入 useProjection。给最外层官方入口传入替代 hook 不会自动传递到所有子组件；重复注册官方 projection source 也不是合法覆盖方式。目前插件必须保留少量实际 CLI 数据适配，原生组件本身仍负责布局与状态。

隔离宿主源码新增 `ctx.uiSession.provideProjections(reference, sources)`，接收精确 `SessionReference` 和键到原生 `HostObservable` 的映射。插件注册 tokenUsage、contextPressure、contextBreakdown 和可选 externalTurnUsage 四个统计键；其余会话状态直接使用官方投影。数据须绑定精确 child/Worker/CLI 会话身份，可订阅、可取消并随 Provider 卸载清理，不影响父会话。

必须区分两类事实：真实单次模型调用 usage 可进入标准 assistant/step 事件；CLI 会话累计、真实上下文占用及分类是独立快照，不得写成单次 usage 造成重复计数或错误上下文推导。新一轮尚无统计时保留同身份已确认值；换 CLI 会话立即失效。

验收：原生输入区和消息尾使用各自正确口径；运行中已知累计统计不消失；未知字段不补零；普通 DSH 会话、父会话和其他子 Agent 不受影响。

## 3. 实施与回退

独立插件范围先完成官方完整入口复用、真实事件与用量接入、跨 run 累计稳定性及回归。用户已于 2026-10-16 明确授权本页限定的宿主扩展；此授权仅覆盖本次原生视图的数据与呈现入口，不扩展到无关核心改动。

在官方 rc.2 源码中形成补丁与测试，构建独立可验证的四个 UI 包，经预览验收后以 profile 插件覆盖安装；不直接修改已安装应用或 node_modules。若没有合法可维护的宿主源码入口，保留缺口，不宣称与主对话完全一致。

两个新增选项均默认关闭，回退至官方 rc.2 默认行为不改写任何会话历史、CLI 账号或用户配置。宿主构建、安装和真实账号验证须分别记录。

## 4. 原生指令数据透传

移除旧 composer 包装后，原生“＋”菜单仍须接收当前 CLI 指令来源。因此同一 owner 路径增加可选 `commandSource`，默认仍为 `command`；菜单开关、选择和关闭继续由原生 controller 执行。这只是原有菜单数据的传递，不新增输入按钮或第二套菜单状态。

接口的来源注册属于精确会话代际；重复键原子拒绝，来源卸载通知整棵视图重新选择来源，返回 undefined 时不回退成其他 Agent 的估算。同 ID 的新会话代际不继承旧来源。

## 5. 2026-10-16 CLI 每轮用量接入补充（候选，未安装）

复查确认 Hermes、Claude、Grok 等部分协议只给出整轮执行合计，不能把该合计写成最后一次模型响应。因此扩展范围增加 `ui-chat`：原生 `TurnTailNodeView` 读取同一会话 Provider 的可选 `externalTurnUsage`，把精确 turn/run 合计交给原有 `TurnUsagePanel`，保留原按钮、弹层和布局。不存在外部 key 时沿用原生单次响应汇总，显式 null 表示此 turn 已知不可核算；两种来源只选一方，不相加。普通会话没有该来源时保持原行为。

Host 在领取真实 Inbox 请求后持久化 turn/run 精确关系；仅完整、已结束且身份一致的回执可汇总。此接口不新增 assistant、attempt 或推理事件，不重写 Session 日志。新建第四个候选 UI 包须独立验收；已安装的三个包不会在开发过程中自动被替换。


同一 `tokenUsage` 观察值附带可选的 externalScope、externalRunId、externalIsPrevious 来源元信息，仅由原生 StatsPills 详情增加统计范围文字；数字、布局、按钮和弹层仍由原组件实现。缺省时不改变官方会话。这样本轮/最近已确认运行不会被误读为完整会话累计。

### 2026-10-17 数据补充

原生 ui-chat 的 UsagePill 与 TurnUsagePanel 增加可选 `externalUsage`，展示 CLI 已知总量和实际提供的分桶；缓存不全时不计算命中率。官方 ui-conversation ContextMeter 读取 `contextPressure.externalContext` 的精确/估算标记和原生分类。上下文弹层统一保留占比、进度条及系统提示词／工具定义／对话消息三行；额外分类列表及“分类来源／数据来源”不展示，包括未知状态。底层来源和分类数据仍保留用于校验与排查，缺值原因和计账范围说明不删除。仍由整个官方 sidebar conversation 实例承载；插件不注册替代统计组件。宿主扩展通过配置指向四个经过隔离验证的官方包，不改 app.asar。

### 首轮未收到响应的状态

用户 01:21 截图暴露未覆盖状态：新 Hermes 首轮无 chunk、账单或上下文；原生 StatsPills/ContextMeter 按原默认规则隐藏。新增会话级 `telemetryAvailability`，分别说明统计、用量、上下文处于等待数据、未返回数据或连接中断；由同一原生组件保留未知态按钮与原生详情，不填零或继承父会话。没有该可选 source 的普通 DSH 对话保持官方行为。

`externalRequestState` 是同一会话 Provider 的安全请求事实，原生 RunningStatus 展示实际 requesting/failed，收到成功响应或终态清除。Hermes 官方请求/错误 hook 经隔离观察轮询送达，不依赖 SSE 更新；只传 HTTP 状态、有限错误类别、实际重试计数，不传原始错误或敏感请求。官方未报告下一次调度及延迟，故不伪造原生 `llm/retry` 倒计时。

这两个键属于已批准的完整原生会话数据接口；没有新增插件统计/过程组件。真实推理与工具仍走原生 AssistantStream 和 Session 节点；Hermes 已证明只追加的公开推理可以实时显示，其他可撤回快照继续等待完成边界。工具开始可先进入原生 preparing，参数、usage 和回执按真实完整边界确认，不再次执行已发生的外部工具。

## 已有空尾步骤的答案位置恢复

可选 `externalTurnAnswer` 只给原生 ChatView 提供已存在答案的 `answerSeq/answerStep/messageId/turnEndSeq`，不提供替代正文。Host 校验完整连续记录、精确 Worker/父子会话/成功 run/turn；原生视图再核对闭合轮次与节点。后续存在真实输入、工具或新正文时拒绝覆盖。普通 DSH 会话没有来源时维持默认规则，旧 Session 日志不改写；过程头、折叠组和正文共享同一原生状态。

通过二验的历史轮次在原生 ChatView 的有效条目序列中，将晚到的公开过程移到对应答案上方；复用原节点、分组、组件、key 和展开状态。候选答案自身同时含 reasoning/text 时仍使用原生两种分座，正文只显示一次。未知成员或非对应 turn 不参与重排，不靠 CSS order 改视觉顺序。验收同时检查折叠、展开和真实渲染的上下位置。

上下文占用与账单总量分开：Hermes 这条实际历史记录的最近请求占用为 4046，CLI 有效窗口为 1048576，约 0.386%；rc.2 原生 `contextOccupancy` 取整后显示 0%。这不是缺数，也不能将会话累计 Token 当作上下文占用。缺值保留未知，详情显示真实占用/容量和来源；本次未改普通原生百分比格式。


### 2026-10-17 后续上下文完整性修复

此前 4046/1048576 记录只核查了分子分母，未覆盖取整造成图形空白与分类行缺失。后续 Hermes-2 的实际值为 4091/1048576（约 0.39%）。共享原生 ContextMeter 现以未取整比例绘制圆环与条形，并统一底部、详情、ARIA 的低占用精度；普通 DSH 同样适用，真实零与未知仍分开。

`contextPressure.externalContext.breakdown` 增加可选 systemTokens/toolsTokens/messageTokens、estimated/source，保留原生三分类行并容纳部分已知值；完整标准 contextBreakdown 优先。旧记录未保存的分类显示 — 与缺失原因；不从当前 DSH 镜像或累计账单倒推。Hermes 新请求可从官方请求 hook 通过 Hermes 原生估算原语提供分类，仅传数值，分类估算与供应商精确上下文总量分别标记。
