# Design

## Context

依据 REQ-0138 的背景 6–7、方案 7、需求 6–7 和风险 6–7。下表是对本仓库现状和 DSH 标签 `dsh-v0.2.2-rc.5`（`9c2670d3bce5275e0d1610272958121af87787bb`）的源码抽查。标签文件通过本地 `.cache/dsh-host-source-022rc2` 的 Git 对象读取；这些结果仅为静态证据。[PRD](../../../doc/prd/2026-11-19-v0.9.2-dsh-rc5-names-omp-PRD.md) · [规格增量](specs/worker-management/spec.md)

| 问题 | 已核实的行为及依据 |
| --- | --- |
| Worker 如何建子会话 | 插件 `src/host/harness-conversation.ts:308–328,1301–1330` 的 provider 实现 `prepareContinuable`，当前分支传预留 `childId` 和 `delivery: 'caller'`，尚未传 `name`。rc.5 的 `packages/subagent/subagent/src/index.ts:267–292` 选用 `manager.startLocal`。`manager.ts:308–322,403–418,532–534` 同步保留名称，在首次消息接纳时写父目录，再释放在途保留。 |
| 名称与创建错误 | 同包 `names.ts` 用 `^[a-z][a-z0-9-]{0,31}$` 并排除 `lead`。显式名无效、同名分别抛 `INVALID_AGENT_NAME`、`DUPLICATE_AGENT_NAME`。省略名称选第一个空闲的 `agent-N`；原生创建工具也向同一服务传 `args.name`。仅针对「caller 交付且指定 name」的拒绝位于 `startExternal`；`UNSUPPORTED_CAPABILITY` 还有其他触发条件，如非本地 provider 带预留 childId。 |
| 目录及运行期名称 | 同包 `catalog.ts` 的 `subagent/catalog` v3 为 continuable/external 登记名称；投影 `subagentCatalog` 的 `stateVersion: 6` 只追加记录。`projection-types.ts:23,31` 的 `name` 可缺省。 `activation.ts:55` 缓存成员路径，`manager.ts` 的 `namesOf`、发送消息、结束消息和激活回执均使用该路径。`activation.name` 是模型用地址，根的直接命名子节点才恰等于名称段，无名时可能为 ID。 |
| 宿主写入边界 | `packages/session/session-projection/src/index.ts:404–417` 同 key 的活动注册复用原定义，版本等不兼容会拒绝。`packages/core/session/README.zh.md:72` 明确仓库外插件不得调用 `appendPluginRecord`。子 Agent 服务的 `@Remote` 只有 `prompt` 与 `interruptByUser`，无 rename。 |
| 工具、身份与显示 | `tool-subagent-control/src/list-agents.ts` 用 `entry.path ?? entry.id` 生成结构化名称；同包 `index.ts` 用 `resolveName` 后调用服务。子 Agent 服务对未命中的单段引用按 Session ID 处理，对未命中的斜线路径报错。`namesOf` 经 `ctx.systemPrompt.context` 生成身份提示；AgentLoop 每步求值，变化时生成新运行期上下文快照，可保留已有前缀。`ui-subagent/.../SubagentHeaderLineage.tsx:216–218,290–293,510–526` 在目录行组装时取名称，描述可作主标题、名称可作副标题。 |

## Goals / Non-Goals

把名称作为用户可变的引用，父会话 ID、Worker ID、childId 和 CLI 原生 conversation ID 各自继续承担归属、操作和续聊。设计覆盖受插件控制的创建、显示和工具入口。宿主目录的权威改名由 DSH 官方提供；本插件只分发客户端页头补丁，不替换 subagent 后台包，不改 DSH 持久化数据，不劫持投影。

## Decisions

### 决定 1：按 DSH 规则共用父会话名称，支持原地改名

- 最终决定：2026-11-19 用户第一次决定，将自动名、自定义名和改名统一纳入 DSH 规则。支持空闲及运行中改名，子 Agent 留在原父会话和原 childId。
- 放弃的方案：退役旧子 Agent 后以新名称重建 —— 原因：重建会新增目录记录，打断原子会话的寻址与运行。
- 影响：把名称分配和历史名称查找拆开。新名严格校验；已存中文、大小写或超过 32 位的旧名仍可作为原样引用。角色预设名、聊天标题保持原有校验。`roles.ts:13–17` 同一个 schema 当前还用于角色快照，`storage.ts:134–136` 用它读 Worker 和别名，数组上限为 32；直接收紧会让历史记录加载失败，截掉早期别名会重新释放名称。

**创建时传名与重试**

1. 以实际创建 Worker 的主会话作为命名范围，即使派遣由同级子 Agent 发起。读取该父会话所有 Worker 的现名与 `nameAliases`、完整公开 DSH 目录、旧 `dsh-names.json` 和覆盖表的现名与曾用名；有官方 `formerNames` 时一并读取。按 childId 去重，保留已结束、隐藏、退役记录的占用。目录读取失败时返回可重试错误，避免把不可读当作空目录。
2. `availableAgentName` 按 `CLI_SHORT_NAMES` 选 `codex-1`、`agy-1` 等；保留序号所需长度。`checkAgentName` 移除对 `dsh-数字` 的整段封禁，改查实际占用。对旧别名沿用既有查找兼容性，分配时避免大小写造成的歧义。对当前名重复保存可作幂等成功；已转为曾用名的字符串继续占用。
3. 在同父的分配、改名及创建预检间协调待提交名称。当前 rc.5 分支将候选名置于 `startActivation` 顶层，保留原 `childId`、`delivery: 'caller'`、`label: worker.title` 和已有启动授权。返回时校对子会话 ID 及实际 `activation.name`，已建立条目可按 childId 读回目录。将确认名写入 Worker 并发布回执；遇到已经建成但结果不明，先对账，避免重复建会话或重发首条任务。
4. 只有 DSH 明确以 `DUPLICATE_AGENT_NAME` 拒绝自动名且尚未建立子会话时，释放该尝试、刷新目录、跳过本次已试序号，在原派遣内有界换号重试。显式名冲突、格式错误、取消及其他失败分别返回原由并清理保留；重试耗尽给出可操作的冲突提示。插件的 `activationSubagents` 和 `legacySubagents.startContinuable` 的入参形状与回执不同，尚无旧宿主接纳 name 的证据；分别做契约检查，保留其旧创建路径，缺少回执或目录证据时明示同步能力限制。

### 决定 2：用插件名称覆盖层过渡，向 DSH 官方提原地改名接口

- 最终决定：2026-11-19 用户第二次决定，插件只暴露一个改名入口。探测 `typeof ctx.subagents.rename === 'function'`，可用则调用官方服务，缺失则写插件私有覆盖表。向上游准备 rename 草案，提交须经用户批准。
- 放弃的方案：随包替换 DSH subagent 后台、向父会话日志写插件事件、重新注册或包装目录投影 —— 原因：替换后台可能引入重复模块实例，写日志和接管投影越过宿主扩展边界，并使回放及恢复依赖插件。
- 影响：rc.5 的原生身份和发送者名仍来自原激活路径。界面给通过覆盖层改名的 DSH 原生子 Agent 标注「仅修改显示名」。CLI Worker 的 CLI 会话与缓存随原 Worker 和 CLI 绑定续用；仅在新 CLI 会话且选有角色时，`roles.ts:89–92` 在首条提示中带入当时的智能体名。`harness-conversation.ts:1415–1419` 转送原任务，不把改名追加为 CLI 输入，也无需通知主 Agent 修订旧上下文。

**持久化与运行中改名**

Host 按 `父会话 → childId → { name, formerNames }` 保存，曾用名按改名顺序去重。先复核父子绑定、名称和占用，再把预期旧名更换为新名并原子写入。目录 0700、文件 0600。覆盖项是过渡期显示与寻址的依据；Worker 快照是派生读值。更新运行中共享 Worker 引用后再推送同一版快照，避免后到的进程事件写回旧名。若断在落盘与通知之间，重启从覆盖项恢复。并发更新以父会话顺序提交，跨父会话写同一文件也须合并，防止互相覆盖。写入失败保留上个已提交状态和可编辑输入。

**覆盖层的四处生效点**

| 入口 | 按身份合并及应保持的行为 |
| --- | --- |
| 1. 插件面板、查询与续聊 | 面板、复制、`cliworker_status` 共用有效名。`cliworker_followup` 接受现名和曾用名，查到 Worker 走既有续聊，原生子 Agent 走既有 `prompt`。修正 `service-harness.ts` 对非 `dsh-N` 的提前拒绝、`dsh-subagents.ts` 的编号查找及 `routing.ts`、`service-tools.ts` 里的旧工具说明。创建新名的校验不用于查询历史别名。歧义、ID 与名不符、只读或权限失败不能触发转投其他条目。 |
| 2. 随包 DSH 页头 | 在依赖变更重建 rc.5 的 ui-session、ui-conversation、ui-subagent、ui-chat 后，再改随包 `SubagentHeaderLineage.tsx`。按目录父 ID 与行 childId 在客户端组装有效名称，保留标题、描述、状态、模式和导航目标。采用插件 Remote 经原生 Gateway 提供父会话快照与变更订阅，支持未开面板的冷启动。已有 `ctx.uiSession.provideProjections` 可作客户端通道参考，但 `harness-native-telemetry.tsx:20,111` 现有类型仅覆盖遥测，不能据此认定已支持名称。切换会话、断线重连及卸载时清理旧订阅并按父 ID 重取。 |
| 3. DSH 成员发现及控制 | `tools/post-execute` 处理成功的 `list_agents` 结构化数组，仅替换已核对成员的 `name` 路径段，以 `{kind:'accept', value}` 交原渲染器。原样保留根、诊断、顺序、描述、状态和原工具过滤。`tools/execute` 对 `send_message`、`interrupt_agent` 的覆盖名及曾用名，按调用者所在树和父目录解析到 childId，再以实际 caller 调 `ctx.subagents.sendMessage`（传原 signal）或 `interrupt`（传原 ancestor 权限）。命中后自行返回同形的消息 ID 或中断接纳回执，不能再调 `next()` 或改写入参；未命中走原工具。保留取消、授权、错误和审计语义。中断被接纳与进程已结束分开呈现。 |
| 4. DSH 创建时防止重名 | `tools/pre-execute` 对当前版本已核实的原生创建工具（包括主 Agent 的 `subagent`）按实际父会话检查显式 `name` 与现名、曾用名；占用时在派遣前 deny，并说明原因。未占用时委托下一钩子。与插件命名协调并发占位，在失败、取消、结束或卸载时释放临时保留。其他工具和无关参数保留原行为。 |

**上游接口草案（尚未提交）**

- 由父会话所有者追加新的 `subagent/rename { childId, name }` 事件，创建事件 `subagent/catalog` 沿用现有版本。宿主提升投影 `stateVersion`，重放创建和改名事件，旧名按 childId 追加至 `formerNames`。旧 checkpoint 可由原日志重建。
- 新增 `manager.rename(parent, childId, name)`，校验直接亲子归属；对同父会话中全部现名、曾用名及在途创建同步保留新名，拒绝冲突，失败释放临时保留。持久提交后更新本成员及所有常驻后代的缓存路径；后续冷恢复也从新目录取名。旧路径的各段可按曾用名解析，曾用名永久保留。
- 通过 `ctx.subagents.rename`、具有目标会话资源授权的 `@Remote rename` 提供同一操作；发布 `subagent/renamed` 生命周期事件供界面刷新。再次请求同一 childId 的现名应可安全对账。目录、`resolveName`、身份提示与发信署名同步采用宿主结果。

## Risks / Trade-offs

- **覆盖层只在已接入的读写入口生效。** rc.5 的真实目录、运行期身份和原生发送者仍用登记名。未打补丁的界面或第三方读取者如显示目录名称，仍会显示原名。抽查 `TeamBoard.tsx:84`、`ui-workspace/src/client/tree.ts:382` 只证实目录用于成员存在性或运行数量，具体名称字段未核实。
- **官方名称池看不到覆盖名。** 显式走主 Agent 创建工具可在入口拦截；DSH 默认分配的 `agent-N`、直接服务或其他未拦截的创建入口仍可能撞名。发现冲突时保留双方记录，显示父会话与对应身份，禁止按歧义名发送或中断；可按明确 ID 处理。插件无法对其他入口声明全局占用，需官方服务消除竞态。
- **工具协议和作用域随版本变化。** 钩子依赖三个控制/发现工具名、创建工具名和 `list_agents` 输出结构。rc.5 的 `packages/core/tools/src/events.ts:8–41` 声明作用域过滤；`pipeline.ts` 会校验环绕结果，按替换值重新渲染。实施时只处理预期定义、合法成功结果及可解析的路径，保留其他结果。每次升级复核名称、结果契约、工具开关、全局监听对各作用域的覆盖。
- **静态核对的限定。** rc.3 的 `source.patch` 有 48 个文件差异；其中 ui-subagent 有一处生产改动 `sidebar-chat/index.tsx`，另有配套 `sidebar-chat.client.spec.tsx`。页头是新增补丁。面包屑、侧栏标题可能来自其他显示路径，须分别实测；保留用户的聊天标题，只把名称出现的位置纳入核查。

## Migration Plan

1. 首次加载父会话，用已经持久化的 Worker/子会话绑定关联目录。对于 DSH 已有名的存量 Worker（如 `agent-4`），采用该名，原插件名及原 `nameAliases` 作为曾用名，保持既有 ID。启动时协调 `storage.migrateAutomaticNames`，防止旧自动改短名逻辑反向覆盖目录结果。仅能读到旧 Worker、无可靠目录名时保留原资料，下一次目录可读再对账。
2. 原生子 Agent 取 `entry.name`；v3 以前、one-shot、unknown 等无名记录继续使用已存 `dsh-N`。确无名又无历史编号时按原顺序分配空闲兼容编号。有目录名的原生条目不再另编新号，已分配的号继续作别名。跨父会话同名分开处理；同父历史别名碰撞只报告和保留，不猜测目标。
3. 每次启动探测官方能力。存在时，新改名走官方；显式冲突或授权失败不可回退为“本地成功”。逐父逐条核对覆盖项、最新目录与 childId，将尚未同步且符合官方规则的中间名按序、最后将现名通过官方服务登记，以保留旧引用。跳过已被该 childId 确认拥有的步骤；已登记的现名即目标时也核对曾用名。历史中文等官方不能接纳的旧引用持久保留在插件兼容别名中。只有目录读回和旧引用归属均确认后删除该覆盖项；部分失败留项、提示原因，不阻塞其余条目。重启从现有目录与覆盖记录接续，避免中途崩溃导致重放错序或丢名。
4. 回退时卸载钩子、订阅及页头视图，保留插件覆盖表、别名和原始绑定。rc.5 宿主仍可按原目录打开子会话，恢复本版后可再次加载覆盖项；已由未来官方服务提交的名称继续由宿主维护。回退不通过手改日志或重建子会话逆转改名。

## Open Questions

- 两条旧服务分支是否接受 `name`、返回何种身份，以及能否按 childId 读回名称，分别验证，不从 rc.5 推断。
- 在真实 rc.5 中验证全局钩子能否收到主 Agent 和各子 Agent 作用域调用；环绕钩子自行完成操作时，核对实际投递、中断、取消、审计和工具卡；对照 `list_agents` 的模型可见文本与界面结果。
- 在 Mac Desktop rc.5 分别检查页头列表、面包屑、侧栏名称、切换与重启后的显示，并验证不打开 Worker 面板也能恢复覆盖。模拟未来官方接口仅能验证切换逻辑，真实官方迁移须待接口可用。
