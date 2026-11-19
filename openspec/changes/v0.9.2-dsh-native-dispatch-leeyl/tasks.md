# Tasks

实施位置：worktree `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/worktrees/2026-11-19-dsh-native-dispatch`（分支 `dsh-native-dispatch`，基于 main `c6df94a`）；验收目录 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-19-dsh-native-dispatch/`（0700，存放安装、测试、类型检查、lint、格式、构建日志与窄栏检查页 `narrow-heading.html`）。全部测试为模拟，未调用模型、DSH 子 Agent 或 CLI。

## 1. 原生工具调查与 DSH 指令识别 〔后端｜4h〕

- [x] 1.1 对照 rc.5 基础包的 `tool-subagent` 声明、实测会话对应的 Agent 预设、提供方注册状态和当步工具作用域，核实 `subagent` 是否进入模型工具清单，以及插件作用域是否影响可见性。记录可核查的配置或工具列表证据，缺失的信息记为「待核实」。
  - 2026-11-19 只读源码调查（Codex gpt-6.2-sol high 调查，主会话抽查 `standard.patch.yml` 第 89–110 行与 `ui-agent-preset` 中文词条）；tag `dsh-v0.2.2-rc.5`
  - Web/桌面标准、PTC、创造模式在 `delegation` 组加载 `tool-subagent`（`toolName: subagent`、`modelSelection: true`）与 `tool-subagent-fork`；极简模式不加载；内置默认预设为标准模式
  - `tools.get(name, scope)` 读 Agent 作用域视图，预设注册的工具对插件根 ctx 可见，`tools.restrict` 拒绝同样生效（源码测试以根 ctx 取得预设注册的 `subagent`）；本插件写法 `ctx.tools.get('subagent', assembleContextFor(agent).scope)` 可用
  - rc.5「设置 → Agent 预设」只能查看配置与「设为新任务默认」，没有按预设开关单个工具的控件，因此提示文案改为「为新任务选择包含子智能体委派工具的预设（如『标准模式』）后新开任务」，并同步修改 proposal、spec 场景与 design
  - 宿主默认最大递归深度 1，子 Agent 即使看得到 `subagent` 也会被拒；PTC 模式经 `run_code` 内 SDK 调用
  - 待核实：PRD 中用户实测会话实际绑定的预设（无会话证据，推测为极简或自定义预设）
- [x] 1.2 在 `src/host/routing.ts` 实现独立原生目标，复用直接指令与讨论判定，处理可选 `cli` 和同句、同批并列目标。以全部列明的别名及 DSH、Codex 分别交办示例核对解析结果。
  - 新增 `DSH_NATIVE_ALIASES`、`leadingNative`（忽略别名内大小写与空格、可带 cli／命令行、词边界排除 `dsh-1`）、`targetList`（同句「和／与／、／或」并列）与 `invocationTargets`（返回 `{ native, external }`）；`invocationResolution` 改为返回其外部部分，原有外部 CLI 结果不变
  - 外部 CLI 开头的并列（「codex 和 dsh」「codex cli 和 dsh」「agy（CLI Worker）和 harness」）及显式 cli 列表中的 DSH 均识别；不含 DSH 时外部开头沿用原路径
  - 「或」与外部 CLI 组合、DSH 加未知或多个外部 CLI 返回不确定；「让 dsh 继续」「调用 DSH 子 Agent dsh-1 …」按续聊排除
  - 工具参数层不变：`resolveCliName('harness'/'deepseekharness')` 仍为 retired，`dsh` 仍为 unknown
  - Codex 审查（codex-reviewer，gpt-6.2-sol high）报 11 项，已逐项修复并加回归：「或者／还是／或使用」与 DSH 并列判为二选一；列表内 Qoder 版本限定与「Codex（agy）」注释保留；「Foo Bar CLI」等多词未知目标保留为未知；「dsh、codex」「codex/dsh」紧凑并列；外部 CLI 开头列表中的「DSH 子 Agent dsh-1 继续」按续聊处理且不丢外部目标；「用 dsh，但不要实际运行」不派遣（「不要执行测试」「不要修改文件」等约束照常派遣）；「DSH 或 Harness」不再把同批其他句的 Codex 判为歧义；「，再用 X」拆句；子 Agent 会话不注入常驻原生说明；混合请求外部入口不可见时说明该部分无法执行；面板计数断言收窄到原生分组标题
  - 外部 CLI 路由对比：HEAD 与当前实现在 79,833 条合成外部输入（全部 CLI 别名 × 17 种句式）上逐条比较，唯一差异为「用 A cli 检查，再用 B cli 检查」句式 7,232 条：HEAD 只取 A，现返回 A、B 歧义（符合「本步指定多个不同外部 CLI 须返回候选」），其余句式无差异，结果见验收目录 `external-routing-compare.txt`
- [x] 1.3 用明确标注的模拟输入回归别名、大小写及空格、`cli` 和「命令行」后缀、讨论、引用、否定、同句和同批混合指令，覆盖纯外部歧义与未知目标。核对 `cliworker_resolve`、外部工具的退役目标拒绝及活动 CLI 原有结果。
  - `tests/routing.test.ts` 新增 describe「native DSH dispatch from this human step」：15 条纯原生、6 条 DSH＋外部、17 条非派遣（讨论、引用、否定、代码块、`dsh-1`、`DSH-2`、续聊、`dshx`、`harnesses`）、或／未知／多外部、全部 CLI 别名不被判为 DSH 且全部 DSH 别名判为原生、`resolveCliName`/`requireCliName` 工具层契约
  - 原有外部 CLI 用例（含 `cliworker_resolve`、`f.start('harness')` 拒绝、全部 `CLI_IDS` 派遣）原样通过
  - `KIMI_CODE_NO_AUTO_UPDATE=1 corepack pnpm exec vitest run tests/routing.test.ts`：128 passed（含审查回归）

## 2. 同次请求的委派提示与存量兼容 〔后端｜4h｜前置 1〕

- [x] 2.1 按已准入消息及本轮工具作用域注入指引，使用 `subagent` 的 `description` 和 `prompt` 承载 DSH 任务，明确工具缺失时提示改选包含该工具的预设。混合指令保留独立的外部 CLI 选型指引。核对常驻委派说明与当轮提示一致，并与名称同步变更衔接，按实际列表识别已有名称。
  - `registerCliRouting`：原生提示不再依赖 `cliworker_start` 可见；主 Agent 按 `subagent` 可见性给「直接调用 subagent（PTC 经 run_code）／宿主拒绝原样报告」或「改选预设后新开任务」两种提示，均禁止改用 workflow、`agent()`、`subagent_fork`、外部 CLI；`origin === 'subagent'` 不给原生提示，外部同级指引照旧
  - 混合：两段指引前加「分别交给 DSH 原生子 Agent 与外部 CLI」说明；不确定组合只给一段不确定提示，两边都不派遣
  - 常驻说明由 `delegationGuidance(context)` 按装配作用域生成：主 Agent 为 `CLI_DELEGATION_GUIDANCE` 加 `DSH_NATIVE_GUIDANCE`，`origin === 'subagent'` 只有前者（`service-lifecycle.ts` 的 `cliworker:delegation` section）；混合请求的外部入口不可见时追加「该部分无法执行」说明；未改 `CLI_DELEGATION_GUIDANCE` 中 `dsh-1` 名称的那句，名称规则由 `v0.9.2-agent-name-sync-leeyl` 负责，路由用词边界排除 `xxx-N` 形式的已有名称，与新命名兼容
- [x] 2.2 在模拟宿主中核对同次请求的提示来源、`subagent` 参数说明、预设提示、禁止 workflow 绕行及 DSH 部分不走 `cliworker_start` 和外部选型。覆盖两个入口的独立可见性、混合指令、宿主拒绝、步骤取消、子 Agent 边界，确认无误报退役或未知候选，通用提问工具照常可用。
  - `tests/routing.test.ts` 用真实 Cordis prompt/tool 服务与模拟 `subagent` 工具：首个请求即含原生指引且来源为 `cliworker-invocation`、不含「外部 Harness CLI 入口已移除」「无法确定」或外部选型提示；`subagent` 未注册及被 `restrict` 拒绝时给预设提示；混合指令两入口各自可见或缺失；拒绝、取消、子 Agent、讨论不注入；`ask_user_question` 可见可执行；`subagent`、`chooseDispatch`、`launch` 均未被调用
  - 宿主实际拒绝原生调用的报告只能在真实宿主核对，见 4.2
- [x] 2.3 使用模拟存量 `cli='harness'` 任务，核对旧记录可读，Client 不能续聊，Host 也拒绝续聊或重新派遣，无原生或外部启动。核对 `harness` 仍不在活动 CLI 中。
  - 未改存量逻辑；`tests/panel.test.tsx`「keeps retired Harness history readable…」、`tests/runtime.test.ts`「allows reading retired Harness history but rejects…」、`tests/dispatch-storage.test.ts`「cannot revive the retired Harness identity…」通过
  - 关联回归 14 个文件（routing、qoder-routing、qoder／qodercn／traecn／codebuddy 集成、workbuddy-registration、sibling-dispatch、panel、runtime、dispatch-storage、settings-dialog、dsh-subagents、dsh-subagents-client）：753 passed，日志 `vitest-related.log`
  - 涉及宿主服务／系统提示注册的 36 个测试文件（含 native-guidance、dispatch-flow、harness-service-integration）：1,723 passed，日志 `vitest-host-service.log`
- [x] 2.4 同步 README 的中英文用户说明和 `doc/design.md` 的路由说明，核对原生与外部入口、工具缺失处理及退役历史描述与规格一致。
  - README.md／README.en.md 在「简称」后新增「调用 DSH」一条；`doc/design.md` 在 v0.6.7 路由小节追加 v0.9.2 说明

## 3. 原生子 Agent 分组标题 〔前端｜3h〕

- [x] 3.1 更新 `src/client/panel.tsx` 的分组标题与无障碍模板入参，复用现有翻译模板。核对仅该分组使用 `Deepseek Harness`，继续显示现有图标和计数，设置开关文案保持既有写法。
  - 新常量 `DSH_GROUP_TITLE = 'Deepseek Harness'` 同时用于 `<strong>` 与 `t('{cli} 子 Agent', { cli })`；设置开关「在 CLI Worker 窗口显示 DSH 子 Agent」未改
  - `src/client/styles.ts` 新增 `.cwn-cli-heading strong{overflow-wrap:anywhere}`，仅在单词超出标题列时折断（见 3.2）
- [x] 3.2 用模拟面板覆盖中英文标题及无障碍名称、图标、计数、折叠和显示开关，核对外部 Worker 不混入该分组。在支持的窄宽度验证标题可读且无溢出，记录实际宽度、语言和布局证据。
  - `tests/panel.test.tsx` 新增「titles the native group Deepseek Harness…」：中文 aria-label `Deepseek Harness 子 Agent`、英文 `Deepseek Harness sub-agents`，标题文字两种语言均为 `Deepseek Harness`，图标 1 个，计数「2 个 Agent」／「2 agents」，折叠生效，分组内无 CLI Worker；显示开关沿用原有用例通过
  - 窄栏：`narrow-heading.html` 用真实 `styles.ts` 样式（宿主 token 用近似值，模拟），内置浏览器测量 200/240/280/320/400px × 中英文：按钮、标题、计数、箭头均无溢出与重叠，图标 22px；280px 起单行，240px 两行按词折行；200px 修改前「Harness」溢出标题列，加 `overflow-wrap:anywhere` 后不溢出（词内折行）
  - 未在真实 Desktop 侧栏量取最窄宽度，见 4.2
- [x] 3.3 同步 README 和 `doc/design.md` 的分组说明，核对设置页文案及页面设计参数无需调整。
  - README「调用 DSH」条与 design.md 路由说明写明「Deepseek Harness」分组；设置页文案与 `doc/settings-ui-design.md` 参数未改

## 4. rc.5 派遣与面板联动验收 〔测试｜3h｜前置 2,3〕

- [x] 4.1 完成影响范围内的类型检查及隔离预览检查，核对预览包可在 rc.5 加载并显示该分组，记录实际命令、版本和结果。（rc.5 加载待合并后统一验收）
  - `corepack pnpm typecheck`：通过（对 DSH 0.2.2-rc.3 开发依赖；新 worktree 首次缺 `lib/typert.remote-client.d.ts`，先在 worktree 内跑 `corepack pnpm build` 生成后通过，该构建只写 worktree 的 `lib/`，未动 Desktop）
  - `corepack pnpm lint`：0 errors；改动文件中仅 `panel.tsx` 3 条既有 `react-hooks/exhaustive-deps` 警告（行号因新增常量下移 3 行），无新增警告
  - `corepack pnpm format:check`：报 8 个改动文件不符合 Prettier；逐个核对 main 版本同样不通过（README.md、README.en.md、doc/design.md、proposal.md、panel.tsx、routing.ts、panel.test.tsx、routing.test.ts），按项目规定不整文件重排，`styles.ts`、`service-lifecycle.ts` 通过
  - `corepack pnpm build:preview`：通过，隔离包 `.cache/preview-package`
  - 未执行：预览包在 rc.5 宿主加载。本分支开发依赖仍为 rc.3，rc.5 适配在 `v0.9.2-dsh-rc5-adapt-leeyl`（分支 `dsh-022rc5-adapt`），待合并后统一验收
- [ ] 4.2 Mac Desktop 0.2.2-rc.5 真实验收：在 `v0.9.2-dsh-rc5-adapt-leeyl` 合入且已有模型选型授权后，在主对话分别发送一次「调用 dsh 帮我总结 README」和「用 DeepSeek Harness 检查这个目录」。逐条核对实际 `subagent` 工具调用、原生子 Agent 创建与完成事件、返回主对话的结果、无外部选型及 CLI Worker 面板 `Deepseek Harness` 分组。核对中英文界面的可见标题、无障碍名称、图标、计数及窄栏展示。（未通过：Desktop 主 Agent 工具列表缺少 `subagent`，见下）
  - 实施验收时，在 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/<YYYY-MM-DD>-dsh-native-dispatch/` 新建权限为 `0700` 的独立验收子目录，保存实机工作区及脱敏证据，并在本任务填写实际路径和结果。若需临时 `HOME` 或 `DSH_HOME`，放在同一验收子目录。
  - 同时核对：极简模式会话的预设提示、宿主深度拒绝时的报告、PTC 模式经 `run_code` 调用。
  - 2026-11-19 第一轮（main 3c5b3f0，Desktop 0.2.2-rc.5，验收工作区 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-19-v092-desktop-acceptance/ws`）：17:21 发「调用 dsh 帮我总结 README」、17:23 发「用 DeepSeek Harness 检查这个目录」。两次都没有外部选型卡（符合），插件注入了「无 subagent 工具」分支的提示，主 Agent 如实告知无法派遣，未改用其他工具（符合降级要求），但没有产生 DSH 原生子 Agent，面板无「Deepseek Harness」分组，标题、计数、图标未能验证。
  - 会话记录 `request/header.tools` 有 `list_agents`、`send_message`、`wait_agent` 与 `cliworker_*`，没有 `subagent`、`subagent_fork`，也没有 Desktop profile 用户补丁加的 `subagent_oar`；rc.5 基础包 `packages/bundle/base/cordis.patch.yml` 仍注册 `tool-subagent`（toolName `subagent`）。缺失原因未查明（可能是 Agent 预设过滤或用户 profile 的实验性 oar 配置），待排查。
