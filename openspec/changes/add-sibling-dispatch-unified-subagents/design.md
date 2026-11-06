# Design

## Context

- CLI Worker 本身就是 DSH 原生子会话（`origin: 'subagent'`）。Worker 通过工具桥调用 DSH 工具时，工具在 Worker 子会话的 Agent 上下文中执行。`assertExecution` 看到 `origin === 'subagent'` 就拒绝；工具桥 `classifyHarnessTool` 用 `forbidden` 正则把 `cliworker*`、`agent`、`subagent`、`run_code` 等判为 `dispatch` 并拒绝。
- DSH 0.2.2-rc.1 的 `ctx.subagents` 提供 `listChildren(parentSessionId)`（目录条目：`id`、`createdAt`、`mode`、`label`）、`prompt`（可续聊子会话投递消息）和 `interruptByParent`（中断）。CLI Worker 窗口已经复用 DSH 原生子会话的对话界面渲染 Worker。
- `cliworker_status` 只读、不阻塞；Worker 结束由 DSH 以 `subagent-settled` 通知送到主对话。

## Goals / Non-Goals

**Goals**：子 Agent 可以发起同级 Worker；CLI 原生子 Agent 跟随原生设置；DSH 子 Agent 在 CLI Worker 窗口统一显示，开关默认开启。

**Non-Goals**：孙层级；跨主对话派遣；为 DSH 新增 CLI 连接页；修改 DSH 核心或原生子 Agent 面板；复制或改写 DSH 会话数据；开放 `cliworker_followup` 等其他插件工具给 Worker。

## Decisions

1. **父对话解析**：`cliworker_start`／`cliworker_status` 收到子会话调用时，沿子会话的父会话找到主对话 Agent，之后一律以主对话为派遣主体（项目、并发、选型确认、权限状态都取主对话的）。父会话本身也是子会话（第三层）或无法解析时拒绝。不新增第二种派遣路径，只在入口处换主体，降低回归面。
2. **发起者字段**：Worker 记录新增可选 `initiator: { kind: 'worker' | 'subagent'; id: string; name: string }`，持久化在现有 Worker 记录中；旧记录没有该字段，按主对话派遣处理。Client 只用它显示「由 X 发起」，不改变列表层级。
3. **工具桥放行**：在 `forbidden` 判断之前，精确匹配 `cliworker_start` 与 `cliworker_status`，且仍要求该工具出现在 Worker 当前可见的 DSH 工具 schema 中才判为 `host`。正则其余部分不变，`cliworker_followup`、带前缀或后缀的变体仍判为 `dispatch`。
4. **询问位置**：沿用 `decideNativeApproval` 已有的判断：发起者当前轮由主 Agent 发起时，在主对话页面询问；由 Worker 窗口续聊发起时，在该 Worker 子会话询问。DSH 原生子 Agent 发起时在主对话页面询问。PRD 写的是「主页面」，这里按现有审批位置规则细化，避免用户在 Worker 窗口操作时错过主页面卡片。
5. **上限**：并发仍用全局「最高同时对话数」排队。另外按主对话统计 `initiator` 存在、状态为运行中或排队中的 Worker，达到 6 个时拒绝新的子 Agent 派遣。PRD 写的是「每轮 6 次」；后台 Worker 跨越主对话轮次，按轮计数没有稳定边界，改为「未结束的同时数量」。由于派遣与查询都不阻塞，不会出现 PRD 担心的等待环路，因此不实现环路检测。
6. **原生子 Agent**：Grok 与 ZCode 的子 Agent 相关开关改为读取用户原生生效设置，做法与已实施的「CLI 记忆跟随原生设置」相同：用户关闭的保持关闭，用户没设置的取 CLI 默认值。只有找到 CLI 实际默认值的证据后才启用，不猜测。ZCode 续聊（`zcode-resume.mjs`）的参数校验改为接受与首轮相同的禁用列表。原生子 Agent 过程按现有过程渲染显示在 Worker 对话内；目前接入的协议都没有把 CLI 内部子 Agent 公开为独立会话，所以不新增条目。
7. **DSH 子 Agent 列表**：新增 Host 模块（如 `src/host/dsh-subagents.ts`）和对应 Gateway 方法：按主对话会话 ID 调 `listChildren`，排除插件已登记为 CLI Worker 的子会话 ID，再合并插件私有「已隐藏」集合。状态取 DSH 原生公开投影（运行中、正常完成、异常）；拿不到的显示为「状态未知」，不推断。刷新跟随主对话或子会话的原生事件，没有事件来源时只在面板可见期间定时刷新。
8. **打开与操作**：点开时复用现有子会话窗口组件，以子会话 ID 渲染原生记录与统计，隐藏 Worker 专属控件（CLI 模型菜单、档位、进程、账号）。`continuable` 模式开放续聊（`subagents.prompt`）与停止（`interruptByParent`，等原生子会话结束后才显示已停止）；其他模式只读。
9. **设置**：`showDshSubagents` 布尔值，默认 `true`，与现有 CLI Worker 通用设置一起持久化。界面放在「CLI Worker 设置」中「任务调度」之前或之后的合适分组，遵循 `doc/settings-ui-design.md` 的文字层级、间距与开关样式。
10. **隐藏集合**：存放在插件私有目录（0700/0600），按主对话会话 ID 分组；只影响 CLI Worker 窗口，不调用任何 DSH 删除接口。
11. **DSH 名称与图标**（2026-11-05 实测后用户追加）：DSH 子 Agent 按 `dsh-<n>` 命名，存于插件私有 `dsh-names.json`（按主对话），按首次出现顺序（同批按创建时间）递增，隐藏后不复用；CLI Worker 改名或指定名称时拒绝 `dsh-<n>`，因此两类名称不会冲突。`cliworker_followup`／`cliworker_status` 先按原逻辑解析 CLI Worker，只有未匹配且名称形如 `dsh-<n>`（或给出 DSH 子会话 ID）时才查 DSH 目录；续聊走原生 `prompt`（queue），回复由 DSH 原生子→父消息带回，不另行轮询。卡片版式与 CLI Worker 卡片一致（名称｜模型、右侧箭头、右键菜单「打开对话／删除」，菜单内用说明行注明只在本窗口隐藏）。分组图标使用 DSH 官方 favicon 的单色路径（内联 SVG，深色主题反色），仅作为 DSH 界面内对 DSH 原生子 Agent 的如实标识。
12. **同级派遣措辞**：Windows 实测中 GLM-5.3-Flash 把「第三层调用拒绝」理解成「Worker 不能派遣」。提示改为明确「CLI Worker 与 DSH 原生子 Agent 都是主对话的直接子 Agent」，用户要求「让某个 Worker 再派另一个 CLI」时照常派遣，只有父会话本身是子 Agent 的调用者才被拒绝。

## Risks / Trade-offs

- 子 Agent 自行派遣会更快消耗额度：发起上限和全局并发兜底；主对话停止全部 Worker 的现有操作仍然生效。
- 权限绕过：新 Worker 不继承发起者档位，选型和原生审批照常询问用户。
- DSH 原生子 Agent 接口仍是预发布版：Host 模块只用公开方法；接口不可用时整个 DSH 分组不显示，并在日志记录原因，不影响 CLI Worker。
- Antigravity 生图依赖子 Agent 的说法未经核实，需要真实验收确认；Antigravity 当前没有插件侧的子 Agent 关闭项。
- 回退：开关关闭即隐藏 DSH 分组；同级派遣可通过恢复 `assertExecution` 拒绝与工具桥正则回退，不涉及数据迁移（`initiator` 为可选字段）。
