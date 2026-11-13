# Proposal

## Why

用户在 2026-11-05 修改了 2026-10-29 定下的「子 Agent 不调用子 Agent」规则（PRD：产品面板 REQ-0125，v0.8.7）。改动前的问题：

- `assertExecution`（`src/host/index.ts`）对来源为子 Agent 的会话一律拒绝派遣；工具桥 `native-harness-tools.ts` 用 `forbidden` 正则把 `cliworker*`、`agent`、`subagent` 等工具对 Worker 隐藏。所以 Worker 无法把子问题交给另一个 CLI，只能回到主对话由用户重新派遣。
- `cli-native-features` 规格要求 Grok 子 Agent（`--no-subagents`、`[subagents] enabled = false`、`GROK_SUBAGENTS=0`）以及 ZCode 的 Agent、Task、SendMessage、工作流和 Skill 保持关闭，依赖子 Agent 的原生能力因此不可用。用户转述 B 站评论：Antigravity 生图依赖子 Agent（该机制尚未核实）。
- DSH 原生调用的子 Agent 只在 DSH 自己的子 Agent 面板显示，CLI Worker 在 CLI Worker 窗口显示。同一主对话的子 Agent 分散在两处，打开方式也不同。

## What Changes

- Worker 同级派遣：主对话的直接子 Agent（CLI Worker 或 DSH 原生子 Agent）可以调用 `cliworker_start`，也可以只读调用 `cliworker_status`。新 Worker 挂到同一主对话下，与发起者同级，记录并显示「由 X 发起」。始终不设孙层级。选型、档位、审批、并发上限与宿主模式边界复用主对话派遣的规则；另外增加「同一主对话中由 Worker 发起、尚未结束的任务最多 6 个」的上限。
- 工具桥只对 Worker 放行 `cliworker_start` 与 `cliworker_status`；其他派遣、多 Agent 与代码执行工具仍然拒绝。
- CLI 原生子 Agent 不再因「两层任务树」一律关闭：Grok 子 Agent 和 ZCode 的 Agent、Task、SendMessage、工作流与 Skill 改为跟随用户原生设置。原生子 Agent 的过程只在该 Worker 对话内按 CLI 公开的粒度显示，不新增任务树层级，也不伪造独立会话。
- DSH 子 Agent 汇入 CLI Worker 窗口：列出当前主对话的 DSH 原生子 Agent（排除 CLI Worker 自身），作为「DSH」分组与各 CLI 同级。点开后使用与 CLI Worker 相同的子会话窗口；停止与续聊调用 DSH 原生接口，只对支持的模式开放。删除只隐藏条目，不改 DSH 原生数据。
- 「CLI Worker 设置 → CLI Worker 设置」新增「在 CLI Worker 窗口显示 DSH 子 Agent」开关，默认开启；「CLI 连接」不为 DSH 新增页面。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `worker-dispatch`：子 Agent 派遣从「一律拒绝」改为「同级派遣」，并新增上限与发起关系。
- `harness-cli-tool-bridge`：Worker 工具桥放行插件派遣与状态工具。
- `cli-native-features`：「CLI 内部子 Agent 保持关闭」改为跟随原生设置；「两层任务树」不再作为关闭原生功能的类别。
- `worker-management`：CLI Worker 窗口统一列出 DSH 子 Agent，并新增显示开关。

## Impact

- Host：`index.ts`（`assertExecution`、`cliworker_start`／`cliworker_status`、问题卡位置、Worker 记录的发起者字段）、`native-harness-tools.ts`（放行规则）、`routing.ts`（子 Agent 入口指引）、`grok-adapter.ts`、`zcode-adapter.ts`／`native-zcode.mjs`／`zcode-resume.mjs`（原生子 Agent 开关与续聊参数校验），新增 DSH 子 Agent 列表、停止、续聊的 Gateway 接口。
- Client：`panel.tsx`／`worker-card.tsx`（DSH 分组、「由 X 发起」标注、筛选与搜索）、子会话窗口复用、`general-settings.tsx`（新开关，遵循 `doc/settings-ui-design.md`）。
- 共享协议：`src/shared/types.ts` 中 Worker 的 `initiator`，以及 DSH 子 Agent 条目与设置字段。
- 安装：不变；Desktop 需要在无活动任务时更新链接构建。
- 文档：README（中英）的子 Agent 规则与关闭项列表、`doc/design.md`。
