## Context

调研依据（2026-10-20，两路 Codex gpt-6.1-sol 只读调研，主会话抽查）：Harness 原生 goal 依赖 Agent 循环与 goal-round-driver 自动续轮，模型工具需顶层人工授权；原生 fork 只复制 Harness 事件前缀并以宿主默认模型新建会话，不复制 CLI 会话；feedback 不进入模型上下文、无需 CLI 参与；plan 已由插件映射到 CLI 原生规划/只读模式（`src/shared/worker-permissions.ts`）。

## Decisions

1. **能力表单一来源**：`bridgedFeatureSupport(worker)` 由 Host 计算写入绑定；Client 只消费绑定，不自行推断 CLI 能力。能力（是否支持）与运行状态（忙、排队）分开；忙碌时沿用既有错误/禁用，不改写为“不支持”。
2. **goal 采用插件自有状态并统一注入**：不复用 Harness `ctx.goals`（会武装 round driver 自动续轮，且工具授权要求顶层人工输入）。Worker.goal 持久保存；活动目标在 runtime 构造每轮 CLI 输入时以固定界定块前置（例如 `【当前目标】…【目标结束】` 后接用户输入），暂停或清除后不注入。修改目标只影响下一轮。全部 CLI 统一使用此方式，故 goal 对所有 CLI 均为支持。CLI 子会话中 GoalBar 槽位由插件替换为读写 Worker.goal 的同款组件；普通会话委托原组件。
3. **plan**：沿用 `permissionForWorker/configureWorkerPermission`。所有入口（“+”菜单、PermissionSelect、PlanChip、`/plan`）读取 `capabilities.plan`；不支持时保留入口、禁用并以共享 Tooltip 显示原因。
4. **feedback**：赞踩与反馈对话框保持 Harness 原生服务；插件“+”菜单增加“反馈”，调用 `feedbackUi.openSession(childSessionId)`。不向 CLI 发送 `/feedback`，不上传厂商。
5. **fork**：新增 Host Remote `forkWorker(parentSessionId, workerId, atTurn?)`。流程：校验父权限、Worker 空闲且无排队；按 CLI 调用原生分支（Codex `thread/fork`+`lastTurnId`、OpenCode `POST /session/:id/fork {messageID}`、Pi RPC `clone`/`fork {entryId}`、ZCode `session/fork`、Claude/Grok/Qoder `--fork-session`、Kimi ACP `session/fork`、MiMo `session.fork`、OMP RPC 分支）得到新原生会话 ID；新建同父 Worker（复制偏好、模式、目标）并建立新的 Harness 子会话，复制截点前历史；全部成功后才发布绑定，任一步失败清理已创建资源并报告，不重发原任务。实现中无法以原生证据确认的 CLI/截点，在能力表中降级为不支持并写明原因，不伪造分支。
6. **禁用提示**：沿用 `harness-control-guards.tsx` 的“span 包裹禁用控件 + 共享 Tooltip”与 `harness-dom-guard.ts` 的 aria-disabled 方式；插件命令源的菜单项不支持禁用状态时，以候选描述显示原因且选取为无操作。
7. **原生状态与 ZCode 消息分支修复**：Pi、OpenCode、ZCode 在私有 `.fork.json` 保存 `nativeStateWorkerId`，沿用源会话状态根（嵌套分支直接指向最初状态根）；`runtime.nativeStateDirectory` 同时用于后续任务、元数据分支和回滚。OpenCode 的 `OPENCODE_DB` 和 ZCode 的 `ZCODE_SESSION_DB_PATH` 都依赖该目录。ZCode 0.16.9 的 `Usr/mGt` schema 支持 message 目标，`ZKo → vXa → forkFromCheckpoint → mRo → lRo → oRo` 在无后续 checkpoint 时复制至助手消息（`P6e/R6e` 为包含式截取），无需工作区快照。最新分支先 resume，再 `session/messages` 读取活动链的最新助手 ID，以 `{kind:'message',messageId}` 调用 fork，不使用默认 latestCheckpoint，也不开放未经 Harness 轮次映射核实的较早截点。

8. **MiMo / Qoder CN 续聊烟测修复**：MiMo 0.1.15 的原生 `Identifier.create` 为消息生成 `msg_g` 加时间/计数及随机后缀，`existing-assistant` 分类按 `lastUser.id < assistant.id` 判断旧回复是否已回答用户。随机十六进制用户 ID 永远排在原生 `msg_g` 回复前，导致第二轮直接结束；保留已落下的 MiMo 专属原生格式 ID 修复，不改变目标文本或终态校验。Qoder CN 的首次启动会新建 `.models/<uid>/catalog-v7` 和 `.models/default`；不存在的 `customs` 不构成路由输入，绑定仅纳入实际存在的 customs 指纹。账号主体、PAT、真实自定义路由及其删除仍改变绑定，Runtime 的账号变化拒绝保持原样。模拟测试和现有失败证据只能确认修复逻辑，真实模型复验由主会话执行。

## Risks / Trade-offs

- 统一前置注入目标属于普通指令上下文，模型可能弱化遵循；换来所有 CLI 一致且不自动续轮。
- 分支依赖各 CLI 原生协议，版本差异大；以真实低成本模型验收为准，未验收的 CLI 不开放。
- 较早截点语义各异（turn vs message）；统一按“完成轮”截取，非轮边界按钮禁用。

## Rollback

能力表把某项设为不支持即可整体关闭该功能入口；Worker.goal 为可选字段，回退后旧版本忽略。
