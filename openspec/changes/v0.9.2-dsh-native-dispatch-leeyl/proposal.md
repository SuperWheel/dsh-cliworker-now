# Proposal

## Why

主对话中的 DSH 派遣指令目前可能得不到路由指引，也可能被当作已退役的外部 Harness CLI 或未知 CLI。CLI Worker 面板的原生子 Agent 分组目前显示「DSH」，需要使用用户指定的标题「Deepseek Harness」。本变更对应 REQ-0138 的第 8、9 项需求。 [需求快照](../../../doc/prd/2026-11-19-v0.9.2-REQ-0138.md) · [PRD](../../../doc/prd/2026-11-19-v0.9.2-dsh-rc5-names-omp-PRD.md)

## What Changes

- 识别主对话中的明确 DSH 派遣指令，在同一次模型请求中指导主 Agent 将任务交给宿主 `subagent`。混合指令中的 DSH 与外部 CLI 子任务走各自的入口。讨论、比较、否定和引用不触发派遣指引。
- 当前主 Agent 缺少 `subagent` 时，引导用户在「设置 → Agent 预设」改选包含子智能体委派工具的预设（如「标准模式」）后新开任务（rc.5 没有按预设开关单个工具的设置项）。旧外部 Harness CLI 历史仍可查看，沿用只读边界。
- 将 CLI Worker 面板中 DSH 原生子 Agent 分组的中英文标题改为「Deepseek Harness」，无障碍名称使用同一产品名。沿用现有图标、计数和分组交互，窄宽度下保持可读。

## Capabilities

### New Capabilities

### Modified Capabilities

- `worker-dispatch`：补充主对话的 DSH 原生派遣指引、混合指令及退役 CLI 的路由边界。
- `worker-management`：更新现有原生子 Agent 分组的标题、无障碍名称和窄宽度要求，并同步显示开关相关场景中的标题。

## Impact

- Host 的自然语言识别和当前请求提示涉及 `src/host/routing.ts`，复用宿主的 `agent/pre-step` 和 `subagent`。外部 CLI 工具参数、Gateway 协议、存储格式和安装入口沿用现有契约。 [路由源码](../../../src/host/routing.ts)
- Client 的分组标题涉及 `src/client/panel.tsx`，复用翻译模板，按窄栏结果决定是否对该标题补充样式。 [面板源码](../../../src/client/panel.tsx) · [翻译词条](../../../src/client/i18n-messages.ts)
- Mac Desktop 0.2.2-rc.5 真实验收依赖 `v0.9.2-dsh-rc5-adapt-leeyl` 合入。

## 成功指标（基线、目标）

| 指标 | 基线 | 目标与验证 |
| --- | --- | --- |
| 明确 DSH 指令派往原生子 Agent | 当前没有专用路由，已观察到未识别、退役提示和 workflow 绕行，未统计派遣率 | `subagent` 可用且宿主允许执行时，明确指令的目标路由覆盖率为 100%。回归覆盖别名、讨论和混合指令，Mac Desktop 以两条真实指令分别核对工具调用和子 Agent 结果 |
| 原生分组标题与无障碍名称 | 两者使用「DSH」 | 中文和英文界面均使用「Deepseek Harness」，窄栏无溢出，原有图标与计数显示一致 |

## 范围外

- rc.5 依赖和随包界面适配、Agent 名称同步及改名、OMP 服务商配置由其他变更负责。
- 宿主 Agent 预设的默认配置、插件设置页文案和其他产品名、旧外部 Harness CLI 的恢复及数据迁移均不在本变更范围内。
