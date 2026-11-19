# Design

## Context

- `src/host/routing.ts` 的 `invocationResolution` 当前只产出外部 CLI 解析结果。`harness` 和 `deepseekharness` 规范化后由 `resolveCliName` 判为 `retired`，进入该分支时 `invocationHint` 使用 `src/shared/types.ts` 的 `RETIRED_HARNESS_NOTICE`（「外部 Harness CLI 入口已移除；历史记录仅供查看。请新建 Hermes Agent 任务。」）。无 `cli` 或「命令行」标记时，这些名称也不在前缀名称表中。`dsh` 同样不在名称表，`dsh cli` 则会进入显式 CLI 解析的 `unknown` 分支并列出候选。 [路由源码](../../../src/host/routing.ts) · [共享类型](../../../src/shared/types.ts)
- `registerCliRouting` 在 `agent/pre-step` 读取已准入消息，要求当前作用域能看到 `cliworker_start`，并把指引以独立来源追加进同一次模型请求。`CLI_DELEGATION_GUIDANCE` 当前在 `routing.ts` 第 214 行用 `dsh-1`、`dsh-2` 举例说明原生子 Agent 的按名续聊。Agent 名称将由并行变更 `v0.9.2-agent-name-sync-leeyl` 从 DSH 目录读取，本设计的派遣、显示与验收按原生子 Agent 身份判断。 [路由源码](../../../src/host/routing.ts) · [工具注册](../../../src/host/service-tools.ts)
- 只读核对本地 `.cache/dsh-host-source-022rc2` 中 `dsh-v0.2.2-rc.5:packages/bundle/base/cordis.patch.yml` 第 386–405 行。基础包默认声明 `tool-subagent`（`provider: spawn`，`toolName: subagent`）与 `tool-subagent-fork`（`provider: fork`，`toolName: subagent_fork`）。同一 tag 的 `packages/subagent/tool-subagent/README.zh.md` 说明工具随提供方和所属 preset 作用域注册，Host 管理 activation 和完成通知。`packages/subagent/tool-subagent/src/index.ts` 第 223–237 行确认 `description` 与 `prompt` 为必填字段。
- PRD 记载的用户实测中，主 Agent 称工具列表没有直接创建原生子 Agent 的工具，改用 workflow 的 `agent()`。源码中的基础包配置只证明默认声明，当前预设是否挂载以及本轮工具作用域是否过滤 `subagent` 待核实。 [PRD 背景第 9 项](../../../doc/prd/2026-11-19-v0.9.2-dsh-rc5-names-omp-PRD.md#一背景与问题)
- `src/client/panel.tsx` 第 728–731 行用 `DSH` 渲染分组标题并填入 `t('{cli} 子 Agent', { cli: 'DSH' })`。`i18n-messages.ts` 已有该无障碍模板和计数模板的英文词条。设置规范中的「在 CLI Worker 窗口显示 DSH 子 Agent」控制可见性，属于独立设置行。 [面板源码](../../../src/client/panel.tsx) · [翻译词条](../../../src/client/i18n-messages.ts) · [设置界面规范](../../../doc/settings-ui-design.md)

## Goals / Non-Goals

- Host 在原有模型请求入口识别派遣意图并提供指导，DSH 宿主执行原生委派、检查权限及层级、管理生命周期和交付结果，Client 继续从现有原生子 Agent 投影显示分组。
- 保留外部 CLI 的工具参数、选型和偏好协议。宿主 Agent 设置、插件存储格式、Gateway 及安装入口没有设计变更。按名续聊依赖实际目录名称和现有查询入口，命名策略由名称同步变更负责。

## Decisions

### 决定 1：自然语言路由中的 DSH 原生目标

- 最终决定：在主对话自然语言路由中增加独立的原生目标。精确别名清单为 `dsh`、`DeepSeek Harness`、`deepseekharness`、`harness`、`DeepSeek Harness 原生子 Agent`。名称比较忽略大小写与空格差异，接受紧随目标的 `cli` 或「命令行」，优先匹配最长完整名称并保证词边界，原生别名不采用模糊匹配。
- 识别规则：复用 `command` 的直接调用、已知前导名称匹配 `leadingNames` 及尾部的 `isDiscussion` 判断。沿用当前已准入人类消息、引文/代码排除和次数前缀处理，继续跳过插件工具自身的入口说明。显式 `cli` 的分支先判断完整原生别名，以覆盖 `调用 dsh cli …`。在带分隔词的目标列表后检查讨论语气，避免将「调用 dsh 和 codex 有什么区别」当作派遣。否定、引用、讨论和非本轮人类输入均不派遣。
- 放弃的方案：将原生别名并入 `CLI_ALIASES` 或将历史 `harness` ID 重新标为活动 CLI。两者都会混淆外部工具参数和原生目标。
- 影响：当前请求的自然语言解析可表达原生目标；`resolveCliName`、`cliworker_resolve`、`cliworker_start` 的外部 CLI 契约仍由 `CLI_IDS` 和退役判断约束。

### 决定 2：当前请求的原生工具指引与工具缺失处理

- 最终决定：继续在 `agent/pre-step` 的准入结果上追加 `cliworker-invocation` 来源指引，分别按原生与外部目标判断实际工具作用域。对主 Agent 核验本轮可见的原生 `subagent`，使用宿主有效工具作用域和工具可见性规则，避免把基础包默认声明当作可用性证据。原生提示分支不依赖 `cliworker_start` 是否可见，外部提示沿用该工具的可见性门槛。被拒绝、取消的步骤不注入，子 Agent 不获得原生派遣指引，外部同级派遣按已有机制处理。
- 工具可见时的提示要点：本步用户明确要求 DSH 原生派遣，调用 `subagent`，用 `description` 写简短任务说明，用 `prompt` 传递用户交办的任务及必要上下文。DSH 部分不调用 `cliworker_start` 或 `cliworker_resolve`，不走外部 CLI 选型，不猜模型、强度或会话 ID，遵循宿主权限和层级检查。常驻委派说明与当轮指引采用同一边界，原生子 Agent 的已有名称按实际列表识别。
- 工具不可见时的提示要点：告知用户当前 Agent 的原生子 Agent 工具不可用，请在 Agent 设置中为当前预设启用子 Agent 工具后再试。宿主明确拒绝调用时如实报告原因。`workflow`、`agent()`、`subagent_fork` 和外部 CLI 均不替代原生 `subagent`。
- 放弃的方案：由插件 Host 直接启动 activation，或把任务交给 workflow。前者绕开了主 Agent 当前有效工具和原生调用结果链路，后者改变了用户指定的执行入口。
- 影响：权限、预设及生命周期由 DSH 自己管理。插件复用现有 Cordis hook 及其清理方式，无新增执行器或持久化状态。

### 决定 3：混合指令与旧 Harness 记录的处理边界

- 最终决定：在聚合前保留完整目标列表，支持同句并列和同批分句，例如「调用 dsh 和 codex 分别审查这个模块」。先完成讨论和歧义判定，再为明确分别交办的任务生成两段指引。DSH 任务使用 `subagent`，Codex 部分使用 `cliworker_start` 且显式传 `cli='codex'`、任务标题和内容，继续由插件处理选型与授权。一个入口缺失时只反馈对应任务的阻塞，明确单独交办、入口可用的另一任务仍按自身规则处理。重复目标可以合并指引，不据此合并用户分配的任务。多个不同外部 CLI 仍沿用既有歧义处理，择一或目标不明的指令不能被当成明确要求两路执行。
- 历史边界：`harness` 和 `deepseekharness` 作为明确自然语言命令的原生别名时，不进入外部 `retired` 提示。`CliId` 中 `harness`、`isRetiredCli` 与 `RETIRED_HARNESS_NOTICE` 保留给外部工具退役校验和历史记录。历史查看、按旧记录或 ID 续聊时以存量身份判定；旧记录可读，续聊及重新执行遭拒，且无迁移或其他派遣。 [运行时](../../../src/host/runtime.ts) · [存储](../../../src/host/storage.ts) · [面板](../../../src/client/panel.tsx)
- 放弃的方案：遇到两个不同目标一律报歧义，或检测到 DSH 后跳过其他目标。前者拒绝合法的分别交办，后者遗漏外部任务。
- 影响：仅扩展明确的原生与外部混合路由，不把外部 CLI 工具变为多目标入口。`conversation-feature-bridge` 的外部 CLI 工具桥职责不涉及主 Agent 的原生派遣。

### 决定 4：分组统一使用 Deepseek Harness

- 最终决定：采用用户 2026-11-19 指定的 `Deepseek Harness`（`s` 小写），仅作为面板中该分组的可见标题及无障碍标签中的产品名。两处使用同一固定名称；现有模板分别生成 `Deepseek Harness 子 Agent` 与 `Deepseek Harness sub-agents`，现有计数模板、`DshIcon`、折叠及分组成员逻辑沿用。现有 `i18n-messages.ts` 无需新增品牌词条。
- 窄栏处理：先利用 `.cwn-cli-heading strong` 的 `flex: 1`、`min-width: 0` 和标题自然换行。受支持的最窄面板宽度若出现裁切，局部允许该分组标题继续折行；保持图标、计数及箭头可见，沿用现有主题 token 和排版。设置页的文字、分隔线、间距与控件规则本次均无需调整。
- 放弃的方案：替换所有 `DSH` 或 `DeepSeek Harness` 文案，或为该产品名添加不同的中英文翻译。用户指定拼写只涉及该分组，现有无障碍模板已能本地化后缀。
- 影响：变化位于面板分组标题和无障碍标签，设置开关、连接入口、页签和其他产品名仍由各自现有文案控制。

## Risks / Trade-offs

- 当前会话可能因预设组成、提供方注册或工具作用域而缺少 `subagent`。实施时分别核对 preset 声明与本轮模型实际工具清单，保留观察结果，原因未知时记录「待核实」。
- 「Harness」也是退役外部 CLI 的历史标识。以自然语言目标和已存 `cli` 身份分别判断，回归历史读取、拒绝续聊及直接传入退役参数。
- 模型可能不遵循当轮提示。模拟测试核对路由及提示，rc.5 实机另查 `subagent` 工具调用、原生子 Agent 创建与完成事件、主对话结果及面板显示。
- 英文计数和窄栏可能挤压标题。验证中文与英文的窄栏布局，并核对无障碍名称及折叠交互。

## Migration Plan

实施完成后先验证路由及组件回归，待 `v0.9.2-dsh-rc5-adapt-leeyl` 合入后进行 Mac Desktop 0.2.2-rc.5 真实验收。此变更没有数据迁移。若需回退，回退路由指引及面板标题改动即可，宿主创建的原生子会话和旧外部 Harness 历史可继续按其原始身份读取。

## Open Questions

- 用户实测会话所用预设、该预设的 `subagent` 挂载状态，以及插件工具作用域是否影响本轮可见性待核实。对应 `tasks.md` 的调查任务，基础包声明和模型自述分别作为静态来源及观察线索。
