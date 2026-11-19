# Tasks

2026-11-19 实施：主任务 1–3、5 与 4.1 已完成并通过模拟回归；4.2、4.3 页头补丁已在 rc.5 基线上完成；分支已变基到合入 #14、#15、#16 后的 main（72464ed）；主任务 6 的 Desktop 实机、真实派遣与真实工具寻址未执行（留待四个变更合并后统一验收）。工时为规划估算。实施 worktree `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/worktrees/2026-11-19-agent-name-sync`（分支 agent-name-sync，已变基到 `dsh-022rc5-adapt`，即 PR #15 之上）。下列测试除注明外均为模拟夹具（标注见各测试文件），环境 macOS、Node 22.23.1、corepack pnpm 11.25.0。跨变更前置为 `v0.9.2-dsh-rc5-adapt-leeyl` 完成 rc.5 的 ui-session、ui-conversation、ui-subagent、ui-chat 四包重建；主任务 4 的页头补丁及主任务 6 的集成验收须在该基线交付后开展。

## 1. 同父会话命名与 Worker 创建 〔后端｜8h〕

- [x] 1.1 把新名校验与历史引用、角色预设、聊天标题的读取分开。用边界用例核对 1 位、32 位合法，空串、33 位、中文、大写、空格、下划线、数字或连字符开头及 `lead` 返回对应原因；旧中文角色仍能载入。
  - `src/shared/agent-names.ts` 的 `agentNameProblem` 给出逐类原因；`roles.ts` 宽松 schema 仅用于角色预设、旧记录与查找入参。`tests/agent-names.test.ts` 7 项：1 位、32 位通过，空串、33 位、中文、大写、空格、下划线、数字/连字符开头、`lead` 各得对应原因；`tests/roles.test.ts` 6 项含旧中文角色载入。
- [x] 1.2 合并插件 Worker 与别名、DSH 全目录、兼容编号、覆盖表及在途保留。验证隐藏、已结束、同级派遣、跨父会话、已占用与空闲 `dsh-N`，目录不可读时不误判为空。
  - `DshSubagents.occupiedNames` 合并 Worker 现名与别名、覆盖表现名/曾用名/登记名、全目录（含插件自有、隐藏、已结束）名称、`dsh-names.json` 与 `PendingAgentNames`；目录读取失败返回「无法读取 DSH 子 Agent 目录，请重试；任务尚未启动」，sessionQuery 整体缺失视为无目录。`tests/worker-management.test.ts`（56 项）与 `tests/dsh-subagents.test.ts`（34 项）覆盖隐藏、已结束、同级派遣、跨父会话、占用与空闲 `dsh-N`、目录不可读。
- [x] 1.3 在 rc.5 local 创建时显式传名，比较请求与回执、childId 和目录。验证 Codex、Antigravity、ZCode 的自动名、显式名及 `label`；分别记录旧 activation、legacy continuable 分支接纳或无法确认名称的依据与兼容行为。
  - `harness-conversation.ts` 在当前 activation 分支顶层传 `name`，保留 childId、`delivery:'caller'` 与 `label`；回执名与请求不同时以 DSH 接纳名为准。旧 activation 形状与 legacy `startContinuable` 不传 name（无接纳证据，保持旧路径）。`tests/harness-conversation.test.ts` 46 项覆盖 Codex、Antigravity、ZCode 自动名、显式名与 label；真实 rc.5 回执比对见 6.2（未执行）。
- [x] 1.4 模拟预检后原生工具占用自动名、两个并发创建、显式重名、格式错误、取消及接纳后回执丢失；核对只有明确的自动名冲突换号，最终仅一个绑定、一次首条投递，无泄漏保留。
  - 仅自动名遇 `DUPLICATE_AGENT_NAME` 且子会话未建立时刷新目录、跳过已试序号重试（≤5 次）；显式重名、`INVALID_AGENT_NAME`、取消与其他失败给出原由并释放保留；接纳后回执丢失时保留原绑定、不重复建会话或重发首条。同上测试文件核对只有一个绑定、一次首条投递、无泄漏保留。

## 2. 原地改名、历史兼容与持久化 〔后端｜10h｜前置 1〕

- [x] 2.1 实现单一改名入口及 rc.5 私有覆盖表，验证连续改名、运行中事件回写、并发保存、取消和磁盘写失败；持久化成功后发布，目录 0700、文件 0600，重启恢复现名与全部曾用名。
  - `src/host/agent-name-overrides.ts`：父会话 → childId → `{name, registeredName, formerNames, kind}`，先落盘后通知，目录 0700、文件 0600（`tests/agent-names.test.ts` 读权限位核对）。Worker 与原生子 Agent 共用改名流程：官方接口存在时调用官方、失败直接报错，缺失时写覆盖表，再保存 Worker 并同步运行中共享引用。`tests/worker-management.test.ts` 覆盖连续改名、运行中事件不回写、并发 expected 冲突、写盘失败回滚与重启恢复。
- [x] 2.2 按目录 childId 迁移旧 Worker 的自动名、自定义名和既有别名。模拟无目录、中文旧名、长名、超过 32 次改名及历史歧义；复验原绑定、角色、CLI 会话、历史不丢，二次启动不重复写入或释放别名。
  - 读到目录时按 childId 对账：有覆盖项采用覆盖名，无覆盖项且目录名不同则采用目录名（origin `custom`，原名与原别名并入别名，`migrateAutomaticNames` 跳过），二次读取不重复写入。replacement 遇不合规历史名时采用新子会话登记名，历史名保留为可续聊别名（Codex 实施取舍，已核对代码）。
- [x] 2.3 原生子 Agent 优先采用目录名，保留已存 `dsh-N`；验证 v3 前记录、one-shot、unknown、无现成编号、隐藏恢复和跨父会话占用。以同一 childId 核对原生条目与 Worker 不重复列出。
  - 原生行有效名 = 覆盖名 › 目录名 › 已存 `dsh-N`；只为无目录名条目分配兼容编号，已分配编号保留为别名。`tests/dsh-subagents.test.ts` 覆盖 v3 前记录、one-shot、unknown、隐藏恢复、跨父会话占用及与 Worker 同 childId 不重复列出。
- [x] 2.4 修正 `cliworker_status`、`cliworker_followup` 和派遣指引中的编号假设；模拟按现名、历次曾用名和旧大小写编号续聊，核对原生排队回执、只读/隐藏/开关关闭/歧义的拒绝及 Worker 互斥。
  - `dshFallback` 只在 Worker 缺失（`WorkerReferenceMissing`）时尝试原生目录，去掉「仅 dsh-N」限制；歧义、ID 与名不符不转投。`routing.ts`、`service-tools.ts` 指引改为 DSH 目录名与 DSH 命名规则。现名、曾用名、旧大小写编号续聊及只读/隐藏/开关关闭/歧义拒绝由上述测试覆盖。

## 3. DSH 创建、发现与控制工具 〔后端｜8h｜前置 2〕

- [x] 3.1 在 `tools/pre-execute` 拦截原生创建工具显式占用现名或曾用名。模拟主 Agent 与子作用域、同名不同父、并发创建与卸载，核对拒绝发生在创建前且释放临时保留。
  - `src/host/agent-name-tools.ts` `tools/pre-execute`：`subagent` 工具显式 name 命中现名、曾用名、登记名或在途保留时创建前 deny（中英原因），其他放行。`tests/agent-name-tools.test.ts`（9 项，使用已安装 DSH 管线与原生控制工具，身份与投递端为模拟）覆盖主 Agent/子作用域、同名不同父、卸载后不再触发。
- [x] 3.2 在 `tools/execute` 按覆盖名或别名为 `send_message`、`interrupt_agent` 解析 childId。模拟许可、拒绝、自发消息、无祖先权限、跨树、取消与未命中，核对原 caller、单次投递、中断回执及无关调用按原工具执行。
  - `tools/execute`：按覆盖名/曾用名/Worker 别名解析 childId，以实际 caller 调 `sendMessage`（传原 signal）或 `interrupt`（ancestor 权限），自行返回同形结果，不调 next、不改入参；未命中或等于登记名走原工具；歧义抛错。依据 `node_modules/@deepseek-ai/dsh-tools/src/pipeline.ts:329,394,719`：包装器抛错经 `toolErrorResult` 成为失败结果。测试核对单次投递、歧义零投递、取消与权限沿用。
- [x] 3.3 在 `tools/post-execute` 替换 `list_agents` 的结构化名称字段，用同名文本出现在描述、路径具有相似前缀、诊断和错误结果的用例核对只改目标路径，保留状态、可见性和工具原有渲染。
  - `tools/post-execute`：只替换 `list_agents` 成员行（running/inactive）路径首段，`lead`、诊断行、描述、状态、顺序不变；描述含同名文本、相似前缀路径、错误结果不改。
- [x] 3.4 对照 rc.5 的工具名、入参和输出声明记录兼容点；检查热卸载/重载后无重复监听，与宿主审计和渲染的实机对照见 6.3。
  - rc.3 与 rc.5 的 `packages/subagent/**`、`packages/core/tools/**` 源码除 package.json 版本号外无差异（`git diff --stat dsh-v0.2.2-rc.3 dsh-v0.2.2-rc.5`）。钩子经 `ctx.effect` 注册（`service-lifecycle.ts` `cliworker:agent-name-tools`），返回的 disposer 一次卸载三个监听；测试核对卸载后不再触发。与宿主审计、渲染的实机对照见 6.3（未执行）。

## 4. 插件面板与 rc.5 随包页头 〔前端｜8h｜前置 2〕

- [x] 4.1 在现有名称编辑器接入统一规则和 Host 冲突反馈；用组件用例核对空闲与运行中可改、失败保留输入、复制与查询使用新名，以及原生子 Agent 显示「仅修改显示名」。
  - `src/client/rename-worker.tsx` 保存前用 `agentNameProblem` 显示具体原因、不合规不发请求、保留输入，上限 32；弹窗加改名副作用说明（Worker：子会话、历史、运行中任务不变，旧名可续聊且保留占用，未接入界面可能显示原名；原生：仅修改显示名）。`dsh-subagents.tsx` 原生行新增「改名」并标注「仅修改显示名」。`tests/rename-worker.test.tsx` 21 项、`tests/panel.test.tsx` 137 项、`tests/dsh-subagents-client.test.tsx` 10 项通过。
- [x] 4.2 在外部前置 `v0.9.2-dsh-rc5-adapt-leeyl` 的四包重建完成后，将按父会话读取的插件 Remote 快照与更新接入随包 `SubagentHeaderLineage`。增加页头组件回归，核对同名不同父、冷启动、切换会话、断线恢复、订阅释放，以及描述、状态与导航 ID。
  - 经既有 `slots.provideRoot` 传入可选根属性 `cliworkerHeaderNames`（与 sidebar-chat 补丁同样用 Slot 属性传值，source.patch 既有用法；rc.5 renderer 把根属性并入会话 Slot 并随 Cordis 生命周期撤销），不改 Harness 核心、不替换 subagent 后台包、不劫持目录投影。插件 Client 入口 `src/client/index.tsx` 以 `scope.effect` 注册 `src/client/header-agent-names.ts`：页头挂载时按目录父 ID 订阅 Host `agentNames` + `watchAgentNames`，同父多视图共享一条流，最后一处卸载即释放，断线回退官方名称。Host 快照对真实覆盖项加 `overridden: true`，未改名的 `dsh-N` 兼容编号不进入页头。
  - 上游补丁内新增页头组件用例：同名不同父、冷启动、切换会话、订阅释放、描述/状态/导航 ID 保持；插件侧 `tests/header-agent-names.test.ts` 与 `tests/client-registration.test.ts` 覆盖订阅共享、释放与断线重连。
- [x] 4.3 在上述 rc.5 基线上复核页头补丁及 vendor 产物，运行相关上游组件用例，记录补丁和构建校验结果。同步中英文 README、设计与宿主扩展协议中关于有效名称、旧名及未覆盖界面的说明。
  - 补丁 50 个文件，SHA256 `54d15e80f63e2df11e5eed95c206cf222d66120689f1d35f99114324804be920`，两份本地 checkout 从干净 tag `dsh-v0.2.2-rc.5` 应用并通过反向应用检查。上游四包 Vitest（Node 24.22.1，保留代理）128 文件 2,219 项全部通过：session 36、conversation 964、subagent 124、chat 1,095。`build-host-extension.mjs --target 0.2.2-rc.5 --prepare-links`、`check-client-types.mjs`（四包 0 错误）、build、`--verify`（631 个文件）、两步 vendor（4 包 217 文件）均退出 0。ui-session 产物逐字节不变，ui-conversation、ui-chat 仅生成的 CSS 模块名前缀不同。runtime manifest SHA256 `25267328b96715706e2eb080206ec5cf424e307ed49ecd0ba11d84f02bdcc971`。构建缓存全部放本 worktree `.cache/`，rc.5 适配 worktree 的缓存只读克隆。
  - 中英 README、`doc/design.md`、`doc/feature-details*.md`、`doc/protocols/native-conversation-host-extension.md` 与 `host-extensions/dsh-0.2.2-rc.5/README.md` 已同步有效名称、旧名与未覆盖界面说明。

## 5. 官方改名接口接管与提案 〔后端｜6h｜前置 2〕

- [x] 5.1 探测 `typeof ctx.subagents.rename === 'function'` 并实现逐条迁移；用标注为模拟的两代接口验证缺失时写覆盖、存在时调用官方、官方拒绝时不上报本地成功。
  - `officialRename` 结构探测 `typeof subagents.rename === 'function'`；`renameThroughOfficial` 官方拒绝即抛错。`tests/agent-name-official.test.ts`（14 项，官方接口为**模拟**）覆盖缺失写覆盖、存在调官方、拒绝不报本地成功。
- [x] 5.2 用多次改名和历史别名夹具验证迁移成功项删除、冲突项保留并提示、非法旧名仍可在插件寻址、部分失败后继续，以及官方成功但本地未清理即重启时的复核和安全重试。
  - `migrateOverridesToOfficial` 按父会话、childId 逐条：先登记合规中间名再登记现名，跳过目录已确认的步骤，重读目录核对后才删除；不合规历史名保留覆盖项并说明；冲突/失败保留并记录原因、不阻塞其余条目；「官方成功、本地未清理」重启只复核不重复调用（模拟目录提供 formerNames 时）。启动时经 `cliworker:agent-name-official-migration` 后台执行。
- [x] 5.3 向 DSH 官方提交改名接口提案（本阶段只准备草稿，实际提交须用户批准）。核对草稿含 `subagent/rename` 事件、投影升级、曾用名占用与解析、常驻后代路径、manager/服务/Remote 授权及 `subagent/renamed` 通知。
  - 草稿见 [upstream-rename-proposal.md](upstream-rename-proposal.md)，含 `subagent/rename` 事件、投影升级与 `formerNames`、曾用名占用与解析、常驻后代路径、manager/服务/Remote 授权与 `subagent/renamed` 通知。**未提交**，提交需用户批准。

## 6. Mac Desktop rc.5 跨入口验收 〔测试｜6h｜前置 3,4,5〕

- [ ] 6.1 准备隔离预览，运行相关类型检查、命名与工具回归、预览构建；以隔离 DSH_HOME 检查页头补丁确已载入，核对 Desktop 无活动任务后才更新验收版本。记录 SDK、Desktop、四包版本与预览产物。
  - 计划证据目录为 `/Users/leeyl/AI-Project/DeepSeekHarness/cliworker-now-test/test/2026-11-19-agent-name-sync/`，测试根权限 0700。若实际在其他日期开始，按当天日期新建并回填此处。临时 HOME、DSH_HOME、工作区和脱敏验收产物均置于该次目录。（未执行：本次仅撰写提案。）
  - 2026-11-19 在合入 #14、#15、#16 的 main（72464ed）之上：`corepack pnpm typecheck` 通过（DSH 0.2.2-rc.5）；全量 `HOME=<验收目录>/home KIMI_CODE_NO_AUTO_UPDATE=1 corepack pnpm exec vitest run --maxWorkers=2` 退出 0，370 文件（366 通过、4 跳过），9,043 项（9,028 通过、0 失败、15 跳过），262.67 秒；`corepack pnpm lint` 0 error、334 warning，本分支改动文件的 warning 数与 main 逐文件相同；`corepack pnpm build:preview` 退出 0。
  - `format:check` 仍报若干文件：经逐个比对，其中 25 个在 main 上原本就未按 Prettier 排版（如 `src/host/runtime.ts`、`src/host/routing.ts`），按规则不整体格式化；新文件及原本合规、被本次改动的文件已用 Prettier 修正。
  - 隔离 `dsh web`：验收目录 `web/` 下临时 `HOME`、`DSH_HOME`（0700）；Desktop 自带 `runtime/cli/bin/dsh --version` 为 0.2.2-rc.5，`dsh plugin --profile web add` 装入预览 tgz 后以 `--profile web --no-open --host 127.0.0.1 --port 0` 启动，内置浏览器打开（令牌已从日志脱敏、未另存）。浏览器实际加载的客户端合包含页头补丁标记 `cliworkerHeaderNames`；主界面与 CLI Worker 面板（空态）正常渲染，控制台无错误，Host 日志只有启动地址一行。停止后进程退出、无 `host.lock` 残留。
  - 未执行：Mac Desktop 实机加载与更新（四个变更合并后统一做），因此本项不勾选。
- [ ] 6.2 **真实派遣与原地改名。** 在 Mac Desktop rc.5 的同一父会话派遣 Codex、Antigravity、ZCode 及 DSH 原生子 Agent，对照面板、页头、目录与派遣回执；另验证原生工具抢先占用 `codex-1` 后自动换号。空闲与运行中各改名一次，记录改名前后 childId、目录条目数、CLI 会话、原有历史、后续输出和终态。
  - （未执行：等待实现、rc.5 四包和已有 CLI／模型选型授权。实机证据记录事件、退出状态与实际产物。）
- [ ] 6.3 **真实工具寻址。** 对照 `list_agents` 的模型可见结果与工具卡，用新名和旧名分别发送、续聊，在可控的独立轮次中验证按新旧名中断。核对送达 childId、消息 ID、审计、接纳与实际停止；验证主 Agent 用新名或曾用名显式创建被拒绝，并观察主 Agent 与子 Agent 作用域钩子是否触发。
  - （未执行：需真实 rc.5 工具执行记录。）
- [ ] 6.4 **真实重启与存量对照。** 冷启动时先看页头再打开插件面板，分别回读列表、面包屑、侧栏的名称，旧名仍定位原 ID；核对旧 Worker 采用 `agent-N`、原生条目沿用目录名、原生显示改名标注与实际署名。记录未覆盖界面或无法验证的平台、账号与官方接口。
  - （未执行：需完成改名后重启 Desktop 并回读。）
