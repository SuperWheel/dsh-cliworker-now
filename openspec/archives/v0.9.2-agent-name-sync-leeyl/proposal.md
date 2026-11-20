# Proposal

## Why

同一 Worker 目前在插件面板叫 `codex-1`，在 DSH 页头可能叫 `agent-1`，用户难以判断按名续聊会送到哪个子会话。本变更落实 REQ-0138 第 6、7 条，覆盖新建、改名和升级后的历史引用。[需求快照（pm.prd）](../../../doc/prd/2026-11-19-v0.9.2-REQ-0138.md) · [PRD](../../../doc/prd/2026-11-19-v0.9.2-dsh-rc5-names-omp-PRD.md)

## What Changes

- 新建 Worker 时将插件名传入 DSH，以实际接纳的名称显示、查询和续聊。自动编号避开同父会话所有已占用名称。
- **BREAKING** 新分配的自动名、自定义名和改名按 DSH 的 1–32 位规则校验。存量 Worker 采用 DSH 登记名，保留原插件名及既有别名。原生子 Agent 采用目录名，兼容旧 `dsh-N` 引用。
- 提供一个原地改名入口，空闲和运行中均可用。rc.5 通过插件私有名称覆盖表同步插件、随包页头与主 Agent 工具。官方接口可用后采用官方接口并逐条迁移。
- 准备 DSH 官方改名接口提案，提交需用户批准。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `worker-management` — 修订「简短默认名称与兼容」和「DSH 子 Agent 名称与按名续聊」，补充命名校验、原地改名、工具寻址与迁移契约。

## Impact

Host 涉及 Worker 命名、绑定、存储、原生目录读取和工具钩子。Client 涉及现有名称编辑、原生子 Agent 显示标注和随包 `ui-subagent` 页头。协议涉及 `cliworker_start`、`cliworker_followup`、`cliworker_status` 的名称语义及插件 Gateway 名称读取与变更通知。页头补丁以 `v0.9.2-dsh-rc5-adapt-leeyl` 重建的 rc.5 四包为依赖，沿用现有随包分发入口。

## 成功指标（基线、目标）

| 项目 | 基线 | 目标与验收方式 |
| --- | --- | --- |
| 新建 Worker | PRD 记录同一批 Worker 在页头与面板名称不一致 | Mac Desktop rc.5 同父派遣 Codex、Antigravity、ZCode，按子会话 ID 比对，名称不一致数为 0 |
| 原地改名 | 插件可改卡片名称，rc.5 目录无改名入口 | 空闲、运行中各改一次，新增子会话数为 0；按新旧名所得目标 ID 相同，重启后两处仍显示新名 |
| 原生与历史名称 | 插件为原生条目另编 `dsh-N` | 有目录名的条目按目录名显示；可续聊的旧 Worker 与原生条目通过无歧义旧名仍命中原 ID |

## 范围外

宿主依赖升级与四包基线重建、原生派遣路由与分组标题、OMP 服务商表单由各自变更负责。DSH 子 Agent 后台包替换、宿主日志写入、目录投影劫持及团队看板、工作区树的显示改造均排除在本变更之外。上游实现、外部提交和发布另行处理。
