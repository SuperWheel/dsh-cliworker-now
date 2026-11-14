# Design

## Context

- Claude Code Worker 只走原生 Runner：`native-bridge.mjs` 把 `claude` 映射到 `native-claude.mjs` 的 `runNativeClaude`。新派遣、续聊（`--resume`）、原生会话恢复和分支（`--fork-session`）都进同一个 `runClaudeSession`，规划与否只由 `claudePermissionMode(config)` 是否为 `plan` 决定。
- Antigravity ACP 的后台子 Agent 等待在通用 `runNativeAcp` 的 `awaitBackground` 中，参数来自 `native-agy-acp.mjs` 的 `AGY_BACKGROUND`。只有 agy 开启该设置。

## Goals / Non-Goals

- 目标：规划模式下 Claude Code 的方案作为成功结果交回；Antigravity 生图子 Agent 完成后不再误报超时。
- 非目标：不支持 Claude Code 的其他交互回调（如提问工具）；不改 agy stream 后备路径；不改变跟进间隔和 10 分钟上限的数值；不读取 agy 私有目录来判断产物。

## Decisions

### 1. `ExitPlanMode` 直接判「规划完成」，不转交 DSH 审批

- 依据 `openspec/specs/worker-permission-levels/` 的「规划模式独立于档位」：规划开启时，授权请求 MUST 直接拒绝。`native-approval-policy.ts` 的 `decideApproval` 在规划模式下也固定返回 `{ decision: 'deny', source: 'plan' }`。
- 依据审批转交规则（`native-permission-relay`）：转交 DSH 的是「是否允许本次操作」的授权，而 `ExitPlanMode` 请求的是「离开规划、开始执行」，这一步属于用户对规划状态的决定。在 Worker 中关闭 `/plan` 或主对话退出规划，下一轮自然按所选档位执行。在 Worker 内批准或弹卡，都会绕开宿主规划模式。
- 因此插件只把方案作为本轮结果，并回复 `deny + interrupt: true`，让 CLI 立即停下，不执行方案中的任何步骤。选 `interrupt: true` 而不是继续：不中断时模型可能在被拒后改写回复或再次尝试退出规划，结果不可预期。
- 中断后 CLI 给出的 `error_during_execution` 是插件自己造成的，不计为失败；`permission_denials` 中的 `ExitPlanMode` 也不计为用户拒绝。其他终态子类型（如轮数或预算用尽）、非零退出、未完成工具仍判失败。
- 方案为空时不伪造结果，沿用原失败判定。非规划模式下的 `ExitPlanMode`（例如模型自己进入了规划）也沿用原判定：那时批准等于开始执行，超出本次范围，见 `tasks.md` 的「跟进」。
- 结果附 `notice`「规划模式：Claude Code 已提交方案，未退出规划、未执行；关闭规划后续聊即可按方案执行」，让主 Agent 和用户知道没有执行。
- 工具行定位：优先使用请求中的 `tool_use_id`，缺失时取尚未完成的最近一个 `ExitPlanMode` 调用；CLI 没回 `tool_result` 时在终态处补记完成。

### 2. 后台等待上限从主回合结束时起算，只计等待间隔

- 原实现 `deadline = started + min(budgetMs, timeoutMs)` 把主回合时长算进后台等待。改为累计每次跟进前的等待间隔，上限仍为 `budgetMs`（10 分钟）。另以任务总时限 `started + timeoutMs` 约束整轮，跟进轮请求超时取任务剩余时间：用户在跟进轮中审批得慢，不再被 10 分钟的后台上限截断。
- 传输层的总时限与空闲时限（`native-time-limit.mjs`）不变，仍会在任务超时时终止进程。

### 3. 跟进提示以结果消息或产物为完成依据

- 本机 agy（`~/.local/bin/agy`）中子 Agent 状态枚举只有 `SUBAGENT_STATE_ALIVE`、`SUBAGENT_STATE_KILLED`、`SUBAGENT_STATE_UNSPECIFIED`。已汇报的子 Agent 仍是 ALIVE，旧提示「必要时用 manage_subagents 查看状态，仍有未完成就回复标记」会让模型一直等待。
- 新提示要求先读已送达的子 Agent 消息并检查要求的产物是否存在，二者满足其一即视为完成，并说明 ALIVE 不表示仍在工作。是否回复标记仍由模型判断，插件只从协议上判断标记是否为本轮最后内容，规则不变。

### 4. Claude 子进程不在 settings 中设置 `CLAUDE_CONFIG_DIR`

- 原做法：`claudeNativeSettingsArguments` 在 `--settings` 的 `env` 中写 `CLAUDE_CONFIG_DIR=<选定目录>`，以固定账号目录，并在状态中核对 `configDirectory`。
- 2.1.311 的只读证据（proposal 第 3 条）：这个变量一旦设置，钥匙串条目名和全局配置文件都会换；而且 settings 中的值只影响插件发起的登录，不影响状态查询。
- 备选方案及取舍：
  - 改在进程环境中强制设置：插件内部能保持一致，但会把用户在终端里登录的账号（不带后缀的条目和 `~/.claude.json`）当成未登录，与「使用各 CLI 原生设置」相悖。
  - 去掉 settings 中的值、只继承 Host 自己的环境：插件和用户终端读写同一处，`configDirectory` 核对照常有效（不设置时 Claude 报告的就是 `~/.claude`，已只读核对）。选用此方案。
- API／代理路由的私有 settings 同样去掉该值，理由相同。
- 代价：此前经旧版插件登录、凭据写在带后缀条目里的用户，升级后会显示未登录，需要重新登录一次。插件不读取、不搬移钥匙串，保持凭据边界。

### 5. Haiku 规划回合接受本进程的 Sonnet 映射

- 2026-11-14 Mac 实测（Worker `4a976b54`）：选 Haiku 进入规划时，`system/init` 报 `claude-haiku-5-5`，主回复的 `message_start` 为 `claude-sonnet-5-5`，与官方「haiku in plan mode」说明一致；原实现按「原生回复模型与明确选型不一致」中止。
- 用户决定接受这种情况。只在规划模式、且选型或其映射是 Haiku 时，把初始化 `models` 中唯一 `value: "sonnet"` 行的 `resolvedModel` 加入可接受集合；不写死模型 ID，不放宽非规划模式，`observedModel` 与保存的选择不变。
- 备选：完全放开规划模式的回复模型校验。不采用，因为那会失去对配置错位的发现能力。

### 6. 规划服务不可见时读 `plan` 投影，读不出即拒绝

- 根因（2026-11-14 Mac Desktop 探针）：rc.3 的 dsh-web-app 设 `plan-mode disabled: true`，预设包在每个 Agent 的 `planning` 组内以 `isolate: { planMode: true }` 挂载 `@deepseek-ai/dsh-plan-mode`。Cordis 按隔离键查找，插件上下文与 `agent.ctx` 的 `get('planMode')` 都是 undefined，而同一会话的 `plan` 投影 `active: true`。原实现把读不到当作未规划。
- 做法：`readHostPlanActive` 先用服务（旧宿主与测试环境）；取不到时读进程级 `sessionProjections.stateOf(session, 'plan')`。返回 undefined 表示宿主未注册规划投影，视为未规划；返回值不是带布尔 `active` 的对象时按规划处理，拒绝执行而不是绕过边界。`assertExecution` 与 `permissionState` 共用此判断。
- 备选：在插件里挂一份 `plan-mode` 或调用宿主内部 API。不采用：会产生第二份规划状态，或依赖未公开的预设结构。`stateOf` 已标注弃用（首次调用告警一次），后续 DSH 提供替代接口时再迁移。
- 影响：规划中「主 Agent 传 `read_only` 派遣」也会被拒绝，与 `worker-dispatch` 规格一致；Worker 子会话的 `planMode.set` 在 rc.3 无作用，作为跟进项。

## Risks / Trade-offs

- Claude Code 后续版本若改变 `ExitPlanMode` 的请求形状（例如方案不在 `input.plan`），会回到原失败判定，不会误判成功。
- 后台等待现在可能长于原先的「主回合 + 等待 ≤ 10 分钟」，但仍受任务总时限约束，停止操作照常有效。
- 提示词修改的效果依赖模型，只能用真实 agy 验证；模拟测试只能保证提示内容与协议流程。

## Rollback

各 Host 文件的改动互相独立，可分别回退；无插件存储、协议或安装入口变化。回退第 4 项会重新出现 2.1.311 下登录后不认的问题。
