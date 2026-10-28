# Tasks

## 1. 可行性与能力核实

- [x] 1.1 核实 DSH 三档预设的沙箱/审批组合与审批接口语义（Desktop 安装包内置配置与包文档）。
  - 2026-10-28：仅可查看＝read-only+ask，工作区内修改＝workspace-write+ask，完全权限＝danger-full-access+never；另有实验性 auto；`approval.request` 需在 agent 未结束轮次中调用，无应答者即拒绝；DSH 委派子 Agent 审批固定 never。结论已写入 design.md。
- [ ] 1.2 核实插件子 Agent（或父 Agent）在 CLI 运行期间能否发起 `approval.request` 并在 Desktop 弹窗；确认子 Agent 审批策略是否被固定为 never、轮次是否处于活动状态。不可行时回到用户重新决策。
  - 2026-10-28 只读核实（开发依赖 0.2.1-rc.3 源码；DSH Desktop 0.12.1 安装包 `app.asar` 内置 0.2.1-rc.2，相关实现一致；未启动 Desktop）。结论：**按现方案不能保证「每次都弹窗」，已停下等待用户决定**。
  - 子 Agent 审批策略：`dsh-subagent` `captureDelegatedPolicyOverrides` 把子会话固定为 `never`（`source: 'delegation'`），但「之后的子会话切换优先」；插件可用公开的 `approval.setPolicy(child, 'ask')` 或 `setApprovalPolicy(child.session, 'ask')` 改回 ask（前者会给子会话下一步注入一条「由用户更改」消息）。目前插件未改，桥接 DSH 工具的审批也因此被 `never` 直接拒绝。
  - 轮次：CLI 运行期间子 Agent 的 AgentLoop 正在流式输出本轮（`harness-conversation-stream.ts` `segment(agent, turn, step, signal)`），满足 `approval.request` 的开放轮次要求。父 Agent 不满足：派遣在后台执行（`routing.ts` 指引「任务在后台执行并报告完成」），父轮次通常已结束，侧栏续聊也没有父轮次，此时 `request` 会抛错。
  - 弹窗可见性（关键）：Host `approval/request` waterfall 经 `dsh-api-remotes` 按 agentId 转发；客户端 Gateway（`dsh-api-gateway` `client.browser.js` `answer()`）用 typert `agent` 适配器解析 agentId，客户端未持有该会话时直接 `next`，Host 结果为 `unavailable`（拒绝）。`dsh-client-ui-approval` 的面板注册为该会话的待处理交互，只在该会话的 `conversation.composer` 中显示。插件客户端仅在用户打开某 Worker 的原生会话时才 `sessions.retain` 子会话（`src/client/harness-conversation.tsx`）。因此以子 Agent 发起时，只有用户正好打开该 Worker 会话才会看到弹窗，否则静默拒绝；主对话不会出现弹窗。
  - 结果词汇只有 `allowed-once | rejected | cancelled | unavailable`，没有「本会话始终允许」（关系到 1.4）。
- [ ] 1.3 逐个核实 design.md 映射表中「待核实」的 CLI 原生模式与审批事件（Kimi/Grok/Qoder 免确认模式、ZCode、Hermes、Antigravity 去掉免确认后的审批事件），更新映射表。
- [ ] 1.4 核实 DSH 审批结果是否提供「本会话始终允许」语义，以及 Codex 等 CLI 的对应回复。
- [ ] 1.5 用 openspec-update-change 修订 `report-denied-permission-as-unverified` 与 `worker-dispatch` 相关规格（拒绝来源、仅可查看可只读派遣）。

## 2. 实施

- [ ] 2.1 Host：读取父会话预设/规划模式，每轮快照沙箱映射；授权请求按当前预设决定。
- [ ] 2.2 桥控制通道新增授权请求/应答消息，带运行身份校验、停止撤回与清理。
- [ ] 2.3 Host 调用 DSH 审批，弹窗文案含 Worker、CLI、请求内容、工作目录；等待期间暂停空闲时限。
- [ ] 2.4 Codex：按映射设置 thread/turn 沙箱与审批策略，改写 `native-codex.mjs:228` 一致性检查为「不比预设更宽」，不再覆盖用户原生网络/可写目录配置。
- [ ] 2.5 Claude、ACP 系、ZCode、OpenCode/MiMo、Hermes、Antigravity：按映射调整启动参数，授权请求改走 Host。
- [ ] 2.6 `index.ts`：仅可查看模式允许只读派遣（Antigravity 等无整进程只读的 CLI 仍拒绝）。
- [ ] 2.7 完全权限下残余授权请求自动放行（不弹窗），规划模式除外。
- [ ] 2.8 时间线记录授权请求、决定与决定来源。

## 3. 自动检查

- [ ] 3.1 夹具矩阵：三档预设 × 规划模式 × 批准/拒绝/关闭/无应答者/停止 × 运行中切换预设；完全权限残余请求自动放行并记录、规划模式下仍拒绝写入；继承网络配置不再启动前失败。
- [ ] 3.2 每个 CLI 的启动参数映射测试，确认不比预设更宽。
- [ ] 3.3 `pnpm typecheck`、关联测试、`pnpm build:preview`。

## 4. 验收

- [ ] 4.1 Desktop 实机：三档预设下派遣 Codex，核对弹窗出现与否、批准/拒绝结果、产物与时间线（真实模型调用需已有选型授权）。
- [ ] 4.2 至少一个 ACP 系 CLI 与 Claude Code 同类复验；未验证的 CLI 在本任务下列出。

## 5. 文档

- [ ] 5.1 README（中英）权限说明：三档预设对应的 CLI 行为、完全权限的风险提示；`doc/design.md` 同步。验证记录写在本文件对应任务下。
