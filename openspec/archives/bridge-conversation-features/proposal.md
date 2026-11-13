## Why

v0.8.1 起每个 CLI Worker 以 Harness 原生子会话呈现，但 Harness 的目标（goal）、规划（plan）、反馈（feedback）和分支（branch）在 CLI 子会话中要么被命令屏蔽返回错误（`src/host/harness-conversation-commands.ts:16` 的 `goal/plan/fork`），要么能力被硬编码（`src/host/harness-conversation.ts` 中 `plan: true`、`fork: false`），对不支持规划的 CLI 点击后才报“当前 CLI 不支持规划模式”。用户要求把这四项桥接到全部 CLI；无法桥接时控件保持可见但禁用，悬停提示当前 CLI 不支持，避免报错。

## What Changes

- 新增共享能力表 `src/shared/conversation-features.ts`：按 CLI 与 transport 计算 goal/plan/feedback/fork/forkEarlier 的支持与不支持原因；子会话绑定 `capabilities` 增加 `goal`、`feedback`、`forkEarlier`，旧持久化绑定与旧 Host 兼容为不可用。
- goal：插件自有持久目标（Worker.goal：objective/status/revision），可设置、编辑、暂停、恢复、清除；活动目标在每轮发给 CLI 的输入前以带界定的指令注入。**不自动续轮**，不使用 Codex `thread/goal` 或 ZCode `session/goal` 等可能自动续轮的原生目标。
- plan：保留既有 TaskMode 映射；Hermes、Qoder、Qoder CN、非 ACP Kimi 的规划入口禁用并提示，不再点击后报错。
- feedback：复用 Harness 消息评价与会话反馈服务，在插件“+”菜单加入反馈入口；反馈只记录在 Harness，不上传 CLI 厂商，不进入模型上下文。
- branch：插件 Host API 调用各 CLI 原生分支生成新的原生会话，新建同父 Worker 与 Harness 子会话并复制截点前历史；经本机源码/协议核实后，Codex、Claude Code、Kimi（ACP）、MiMo、ZCode、Pi、OpenCode、Qoder、Qoder CN 可从最新完成轮分支，仅 Codex 支持较早完成轮；Antigravity、Hermes、Grok、OMP 及其余较早截点禁用并提示（原计划 OpenCode/Pi/ZCode 较早截点因缺少可靠原生截点映射而降级）。覆盖消息分支按钮、工作区会话菜单和快捷键入口。

## Capabilities

### New Capabilities
- `conversation-feature-bridge`: CLI 子会话中 goal/plan/feedback/branch 的桥接、能力判定与禁用提示。

### Modified Capabilities
- 无（plan 既有映射保持；`worker-conversation-interaction` 的既有行为不变）。

## Impact

- Host：`src/host/harness-conversation.ts`、`harness-conversation-commands.ts`、`runtime.ts`（目标注入）、`storage.ts`（Worker.goal）、`index.ts`（goal 与 fork Remote）、新增 `worker-fork.ts` 及各原生桥的分支方法。
- Client：`src/client/harness-native-commands.ts`、`harness-control-guards.tsx`、`harness-dom-guard.ts`、GoalBar 子会话替换、分支入口改道。
- 协议：Gateway Remote 新增 goal 读写与 `forkWorker`；绑定能力键扩展且向后兼容。
- 范围外：Harness 自动目标续轮、厂商反馈上传、修改 Harness 核心、Antigravity 非公开分支实现。
