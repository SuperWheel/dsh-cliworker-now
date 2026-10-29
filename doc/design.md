# dsh-cliworker-now — 设计与版本演进

## v0.8.3（未发布）：市场安装的宿主 peer 范围（2026-10-24）

- Desktop 0.12.1 的市场安装器要求必选宿主单例 peer 位于 Harness 安装闭包；`@deepseek-ai/dsh-client-store` 在官方包中仅为开发依赖，不能作为本插件的宿主 peer。
- 保留官方 snapshot store 和每个模型目录实例的状态、通知与冻结行为，在 Client 内联 store、Zustand vanilla/middleware/shallow 和 Immer；清单仅移除 store peer，构建 devDependency 与锁文件不变。React、React DOM、Cordis 和 UI primitives 仍由宿主提供。
- Client 构建把 Immer 的 `process.env.NODE_ENV` 和 Zustand 的 `import.meta.env` 固定为 production 常量，防止内联后依赖浏览器中不存在的 Node/Vite 环境。打包回归在无 process 的 VM 中执行模型目录 store，核对同步通知、同引用去重和取消订阅；宿主单例探针使用明确的模拟导出。
- 回归按 app-boot 的声明者 Node 搜索路径和 dependencies + peerDependencies 计算 npm SDK 闭包。本地 SDK 比用户核实的 Desktop 0.12.1 范围少 React、React DOM、UI primitives、UI slots；只对这四项使用明确注释的断言 allowlist，不修改计算器、不放宽其他 peer，也不把 store 改为可选 peer。
- OpenSpec：`openspec/changes/fix-market-install-peer-scope/` 保持未归档；实际版本字段仍为 0.8.2。隔离构建与测试结果见 `doc/tasks.md`；本次不执行 Desktop 市场实装或正式构建。

## 1. 基线与范围

- 本机 macOS；DeepSeek Harness 0.2.0-rc.2（官方标签 `dsh-v0.2.0-rc.2`，提交 `639ed015397290b3745d163aafe02ffee4aa3f84`）；Antigravity CLI 1.2.16。
- 独立包 `dsh-cliworker-now`，包含 Host、React Client、共享类型及 bundle patch。
- 主对话下可有多个 CLI 子 Agent，各自多轮续聊。孙 Agent、其他 CLI、运行中插话及自动 worktree 合并不在首版内。

## 2. 用户流程

1. 用户明确要求使用 Antigravity；主 Agent 调用插件工具。
2. 首次按项目及 CLI 选择真实模型 ID 与思考强度；选择完成前不启动子进程。
3. 后台运行并打开右侧栏；显示任务树、模型与强度、CLI 实际事件、工具结果和状态。
4. 同项目新任务继承默认值；更改默认值仅影响新建子 Agent。
5. 用户可停止；当前轮结束后使用原 conversation_id 续聊。

## 3. 结构与接口

- Host：项目偏好、会话索引、运行调度、Antigravity 适配器和持久化。
- Client：原生右侧栏注册、两层任务树、实时记录、配置入口、停止和续聊。
- 通信：Harness Gateway/Typert RPC；查询配置、快照、事件流和执行操作。
- 模型工具：`cliworker_start`、`cliworker_status`、`cliworker_followup`、`cliworker_stop`；隔离副本的合并与丢弃另有 `cliworker_merge`、`cliworker_discard`。
- 独立保存 workerId、Harness parentSessionId 和外部 conversation_id。每轮运行独立记录，事件带单调递增序号。
- 自然语言路由通过工具描述及作用域内提示规则完成。只管理通过插件启动的进程。

## 4. 生命周期与边界

- 状态：等待配置、排队、运行、停止中、完成、失败、中断。
- 默认最多两个并发；同会话单轮互斥，同目录写任务串行（「同目录写任务并行」开关打开时的例外见文末“隔离副本并行”一节）。
- argv 显式传递 model/effort；解析 stream-json；stderr 与对话区分。失效模型或参数提示重选，不静默回退。
- 沿用旧 skill 的目录校验、默认沙箱、私有文件权限；遵循宿主权限及规划模式。
- 关闭侧栏不取消任务；断线重连恢复记录；宿主重启将遗留运行标为中断。
- 停止等待受管理进程范围清理；认证或权限失败不自动重试。
- 后台任务完成向父 Agent 返回结果摘要；全部过程保留在插件存储。

## 5. 视觉设计

v0.3.0 采用用户确认的 B 桌面侧栏方案：父级为按 CLI 分组的任务总览，子级为独立对话页。圆角矩形、轻透明表面、扁平层级与 Harness 明暗主题同步。话题后显示状态圆点和文字，下行显示模型与强度值（无“思考”前缀）。子级标题左侧是仅箭头的圆角返回按钮，标题下不显示模型/强度标签；底部续聊框保留模型，用户消息居右，Agent 文字居左。工具输出折叠显示。运行时禁用续聊；向上阅读时不强制滚到底部。空态、等待、异常和中断提供明确动作。

## 6. 验收

首次选择、跨项目隔离、流式分片、错误退出、会话 ID 不一致、并发与重复调用、取消清理、续聊、重连、主题及窄屏均需测试。真实 Antigravity 运行、停止、续聊分别留证。模拟验证不得记作真实运行成功。

## 7. 参考

- 官方插件安装：https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/docs/user/develop/basic/publish.md
- 右侧栏：https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/packages/client/ui-sidebar-right/README.md
- Remote API：https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.0-rc.2/docs/cookbook/adding-a-remote-api.md
- 旧 skill：`~/.agents/skills/cliworker-agy/`，仅参考，不改写其状态或文件。

## 8. 实现决策

- Host API：`catalog(parentSessionId)`、`configure(parentSessionId, JSON preference)`、`watch(parentSessionId, workerId)`、`followup(parentSessionId, workerId, prompt)`、`stop(parentSessionId, workerId)`。Gateway 传输采用官方生成器提供的校验契约；模型/配置和快照为 JSON 字符串。恢复父 Agent 使用与原生 Remote Agent 参数相同的 Typert lookup resolver。
- 流每次提供权威快照，客户端整体替换并确认消费，避免断线重连重复追加。事件在磁盘按 worker 内 seq 累加、每轮 runId 隔离。客户端默认保留最近 1000 个逻辑行，原始事件在磁盘完整保存。
- `agy 1.2.16` 使用 `init`、`step_update` 和 `result`；工具输出可能只有 CLI 提供的摘要，不扩写为未收到的详细内容。文本增量合并，最终回答校准最后一条 assistant 消息。
- 独立插件构建时将 npm 已发布的协议声明临时放入 `.cache/typert/packages`，满足官方生成器的 workspace inventory 约定；不修改 Harness，也不依赖上游源码 checkout。
- 所有进程走 `ctx.subprocess`。任务使用原生 terminal 进程树管理，Node bridge 保持 stdout/stderr 独立并转发真实字节；周期观察保留 PID 与启动身份，覆盖 CLI 工具另建进程组的情况。停止和异常均执行 terminate + waitForExit；无法确认清理时拒绝后续派遣，避免同目录写进程重叠。每轮输出和超时有限制。
- `--disable-slash-commands` 会让 Antigravity 的 `--mode plan` 失效，因此不使用该组合；任务文本加普通前缀，防止首行直接成为 slash command。
- 宿主处于规划或只读模式时拒绝派遣。这是 MVP 的显式限制：Antigravity 需写自身状态，原生终端沙箱无法等价实现 Harness 的全进程只读约束。
- 本版界面文案为中文，模型 ID 与强度保留 CLI 原值；颜色、字体和按钮复用宿主主题。对话按纯文本安全展示，工具内容默认折叠。

## 9. v0.1.1 体验与稳定性

- 视图生命周期按父会话隔离；切换 worker 时只保留同父会话任务树，清空旧 worker 内容直到新快照到达。异步提交按原 worker 清理已提交草稿，错误归属原任务，旧请求不能覆盖当前任务输入。
- 草稿仅在面板内存按 worker ID 保存；不写 localStorage，也不包含于服务器日志。关闭面板/刷新页面会丢弃未发送内容。
- 连接失败保留最后快照、禁用续聊并提供重新连接；重新订阅只读快照，绝不自动重发任务。底层 Gateway 的正常自动重连继续由 Harness 管理。
- 用户离开记录底部时保持滚动位置并显示“回到最新消息”。加载中的界面不误显示为空任务。
- 终止事件记录明确的状态；启动恢复会追加一次 interrupted 事件。工具保持 CLI 原始状态，同时标记轮次已结束，未收到最终工具结果不推断成功。旧版当前轮通过 worker 持久化状态兼容显示。
- `build:preview` 创建隔离的包快照供验收，正式构建与 Desktop 升级在验收后完成。

- 每轮完成结果为独立快照，续聊不能改变上一轮的 status/runId/response；后台结果包含 workerId、runId 和任务摘要，续聊通知标签区分新任务，提示父 Agent 读取本轮输出。此机制提供准确上下文，不保证上游模型一定正确复述。

## 10. v0.1.2 历史浏览与任务查找

- `history(parentSessionId, workerId, anchor, direction)` 是只读 Gateway API；Host 校验父任务所有权和 worker 内的逻辑行 ID。anchor 排除在结果之外，direction 仅 before/after，每页最多 200 条；无效、跨任务的 anchor 明确报错。
- 返回 HistoryPage（workerId、items、start/end、total、hasOlder/hasNewer）；区间及总数是读取当时的值。按稳定逻辑 ID 翻页，不使用会被实时新增事件移动的倒数偏移量。
- 历史阅读仅保存当前页，不无限累积 DOM；后台订阅持续更新任务状态和最新记录，旧页冻结且滚动不受影响。返回实时切回当前快照；提交新续聊后回到实时。切换任务忽略旧的异步页响应。
- 列表按 createdAt、id 排序；筛选只改变父级可见行，允许清除筛选，保留各任务草稿；子级返回时恢复列表状态。
- 复制复用 Harness writeClipboard，只有宿主接受写入才显示成功；失败提供手动复制提示。历史消息复制和最新完成结果复制分开，不读取或上传用户剪贴板内容。

## 11. v0.2.0 多 CLI Worker

- 用户要求本轮扩展 Codex、Claude Code、Kimi、MiMo。共享任务树、生命周期、分页、停止和续聊；CLI 专属行为集中在 `host/adapters.ts` 与 `host/cli-protocol.ts`。
- Preference 增加可选 cli。旧记录缺少 cli 时明确解释为 antigravity，旧偏好文件路径保持不变；其他 CLI 使用项目路径与 cli 的组合哈希。已有 worker 的 CLI 固定；v0.3.3 起空闲时可修改模型/强度，续聊仍沿用原会话 ID，不能切换执行器。
- 四个工具保持不变，start 增加 cli 参数，提示规则按用户明确点名路由。主对话首次先选模型，再选择该模型支持的强度；仅一个值时明确沿用该值。配置校验发生在派遣前，不静默替换模型。
- Codex：本机 models_cache.json 提供模型和 reasoning levels；缓存不是远端可用性保证。exec --json，续聊精确 resume ID；read-only/workspace-write 与 approval_policy=never 显式覆盖，不使用全权限 bypass。
- Claude Code：官方 sonnet/opus 别名，强度来自本机 --help。-p --verbose --output-format stream-json，acceptEdits/plan，--resume 精确 ID。保留权限检查，permission_denials 使运行失败。CLI init 报告的实际模型另行展示，防止本机别名映射掩盖真实提供商模型。
- Kimi Code：provider list --json 只提取模型字段，不存储 providers 凭据。当前 0.42.0 的 -p 不接受强度或 plan 参数，强度展示“沿用 CLI 配置”，只读请求在创建 worker 前拒绝。非交互原生 auto 工具策略在选择卡片和设置中说明。仅依据 stream-json 的 session.resume_hint 保存会话 ID，绝不通过“最新会话”猜测；干净退出、回复和会话凭据共同构成完成条件。
- MiMo 指 XiaomiMiMo/MiMo-Code 官方 CLI；不适配同名社区实现。models --verbose 读取模型 variants，run --format json，--agent build/plan，--variant 与 --session。保留权限检查，不添加 --yolo；stop step + EOF + 零退出码才标记成功。CLI 未安装时明确失败，不改为其他 CLI。
- 所有输出按各 CLI 实际公开粒度显示，不承诺逐 token；不展示 reasoning 事件。子 CLI 自行产生的孙 Agent 不纳入任务树。未知协议、非零退出或缺少会话标识不会标记为成功。
- 可分别设置 codexExecutable、claudeExecutable、kimiExecutable、mimoExecutable；原 executable 继续仅指 Antigravity，所有 CLI 共用进程上限和同目录写任务互斥。

协议参考（核验于 2026-10-04）：本机 CLI --help；Claude https://code.claude.com/docs/en/headless；Kimi https://github.com/MoonshotAI/kimi-code/blob/main/apps/kimi-code/src/cli/prompt-render.ts；MiMo https://github.com/XiaomiMiMo/MiMo-Code/blob/main/packages/cli/src/cli/cmd/run.ts。

## 12. CLI 卡片图标（v0.3.0 已接入）

- 父级 CLI 分组名称左侧使用统一 24px／32px 图标槽，等比显示并做光学居中，名称间距 8px；不增加独立不透明底板。
- 基于官方参考素材制作 Antigravity、Codex、Claude Code、Kimi、MiMo Code 的透明扁平 PNG。Kimi 按宿主亮暗主题切换深浅 K 字，其余共用单图。
- MiMo 使用官方像素字标提炼的 M 适配图，不宣称为官方独立图标。素材设计阶段未改变运行界面；v0.3.0 按用户提供的素材包原样接入。
- 素材、原始来源、生成提示词和实际尺寸预览见 [图标说明](assets/cli-icons/v1/README.md)。

项目独立图标：v1 的主终端与子会话块被用户否定，原因是过于接近 Codex。第二轮移除终端符号，提供会话气泡、任务分派、Worker W 三种扁平透明方向，见 [第二轮候选](assets/project-icon/v2/README.md)。第二轮方案未采用；当前采用下述 v3。

项目 Logo 新设计稿 v3：以打开的会话窗口、三条并列会话和状态圆点表达“让每个 Agent 的工作过程可见”。使用蓝色双调、圆角扁平形状及透明背景；同一 PNG 已检查亮暗背景和 24px／32px／48px 展示。见 [会话可见 Logo](assets/project-icon/v3/README.md)，已在 v0.3.0 用作总览标题、侧栏入口和新标签页引导图标。

## 13. v0.3.0 桌面父子页面

- 页面状态由当前 parentSessionId 内的 selected workerId 控制；空值为总览。返回恢复列表滚动位置与键盘焦点，进入子级聚焦返回按钮；草稿仍只在面板内存中保存。
- 总览保留搜索与状态筛选，CLI 分组可折叠；列表保留稳定创建顺序。标题、元数据左侧对齐，长标题/模型省略，完整文本可悬停查看。
- 子级通过原 Gateway watch/history/followup/stop 接口工作；不改 Host、会话协议或进程权限。历史页、断线重连、持久化错误和无法续聊提示继续保留。
- 标题右侧原生 details 菜单展示 CLI、任务模式、实际模型差异、复制最新结果和默认设置。输入框显示会话模型；v0.3.3 起允许空闲时切换已验证型号，不提供 CLI 不支持的附件或权限按钮。
- 样式使用 Harness 的语义主题 token 与原生 Button；不保存独立主题。Kimi 根据宿主 body[data-ds-dark-theme] 切换原图，全部七张 PNG 构建时内联，卸载仍清理注册和样式。
- 根容器与对话内容分别限制滚动；屏幕阅读器标签在消息内定位，避免输入框聚焦时引发宿主面板外层滚动。

## 14. v0.3.1 原生参数与控件

- 搜索使用 `@deepseek-ai/dsh-client-ui-primitives` 的 Input，状态筛选使用 Button size=md。字体、行高、按钮高度、描边、焦点样式由原生组件维护，不用插件 CSS 覆盖。
- 自定义页面使用 `--dsw-font-s-14-font-size/line-height` 与 `--dsw-font-xxs-12-font-size`；对话/续聊使用 `--dsh-content-font-size` 与 `--dsh-content-font-delta`。前者遵循宿主 UI 字体尺度，后者响应宿主会话字号偏好。
- 圆角使用 `--dsw-radius-md/lg/panel`；自定义边框沿用原生 0.5px 描边与 `--dsw-alias-border-l2/l3`，续聊外壳使用主 composer 的 `--dsw-elevation-soft`、`--dsw-elevation-stroke-color` 与 `--dsw-specific-input-major`。
- 主对话 composer 在该版本没有可独立绑定 Worker 发送回调的公开组件出口，它的输入接口由 Harness session 作用域持有；因此复用外观参数与原生基础控件，保留 Worker 的 followup/stop 语义，不引用私有哈希类名、不读取主会话草稿。
- 任务行取消为 CLI 图标预留的 43px 缩进，标题和元数据以 12px 边距左对齐；展开分组标题底部显示全宽细线。窄侧栏不再缩小字体。

## 15. v0.3.2 原生消息、输入框与菜单

- 源码核验：primitives 的 IconSettingsOutlineRegular / IconSendOutlineRegular / IconCopyOutlineRegular / Menu / MarkdownText；ui-chat 的 userStack/bubble/actions；ui-conversation 的 composer card/input/row/primary；ui-sidebar 的 newSession。
- 直接使用上述公开基础组件；自定义 composer 按原生几何：8px 顶内边距、36px 最小正文区、12px 间隙、42px 操作行，空态总高 98px；发送按钮 34px 圆形 info-fill，面板圆角/柔和阴影由宿主参数控制。禁用手动 resize，随输入自动增高，上限 336px。
- 原生 Menu 向上弹出并通过 portal 避免侧栏裁切；取消/切页清理模型目录查询的迟到响应。选择模型下的强度只调用 configure 更新项目/CLI 默认，不改变已存在 worker，不派发任务。
- 当前会话模型/强度与 CLI 实际模型明确展示；模型目录不会根据快照对象更新反复请求，仅在菜单打开或执行器改变时读取。
- 消息气泡采用 native xl 圆角、10px/16px 内边距、82% 最大宽度；时间固定中文 24 小时制，复制控件在下方。助手文本交给原生 MarkdownText，禁用原始 HTML 的宿主渲染器承担转义；复制仍使用原文。
- 搜索框高 38px，保持 border-l3 的半像素中性描边，聚焦不加蓝色光圈。卡片和搜索描边与新会话按钮使用同一语义色。底部信息行只显示可核查状态，缺失的 token/速度/上下文不补造。

## v0.3.3 配置与呈现修订

- `ModelChoice.variants` 保存各强度到真实 CLI ID 的映射；Antigravity 只依据 `agy models` 的 ID 后缀及名称括号共同识别变体，不凭模型名称猜测支持等级。存储与执行保留真实 ID，界面展示去重的家族 ID。
- `configureWorker(parentSessionId, workerId, selection)` 查询真实目录、校验归属与 CLI，最后同步检查空闲状态并持久化；运行中拒绝。配置修改不修改过往事件、结果或会话 ID，不修改项目默认值，不启动进程。续聊执行新配置。
- 原生 ModelSelect 内部绑定主 Agent 的模型服务，不可拿来改 CLI 会话；复用原生 Menu/Input 与其布局 token 实现“模型 / 思考强度”入口、模型检索和等级列表。
- 从完整事件序列计算每轮起止时间，在历史分页前附着到逻辑行；耗时为任务提交到终态，含队列与 CLI 启动。运行中按秒更新；终态固定。过程折叠位于回复之前，只展示 CLI 实际公开的工具/状态/诊断，不推断内部思考。
- Desktop 的本地链接更新必须完整重启宿主，不能以插件目录的版本号或刷新按钮代替 Host API 验收。验收必须实际加载目录、保存当前 worker 配置并观察恢复结果。

项目 Logo v4 按用户标注去掉内部三条横条和原圆点，保留 C 形对话框，在右侧紧贴加入小写 li 并加粗，形成 Cli 字形。见 [v4 设计稿](assets/project-icon/v4/README.md)，尚未接入插件。

项目 Logo v5 将 C 主体、l 与 i（含圆点）上下对齐，缩窄 C 并减少内部空白，保留小对话尾部。见 [紧凑等高版](assets/project-icon/v5/README.md)。

用户认可 v5 基本样式后，v6 沿用 Cli 构形，以柔和的曲线、尾部、笔画变化和浅蓝圆点增加人文感，并调整字母间隔。已查看明暗背景中的 24／32／48px 展示，页面标题建议 32px，见 [柔和人文版](assets/project-icon/v6/README.md)。仍为设计稿，尚未接入插件。

## v0.3.4 菜单导航一致性

两个子菜单都将共享返回项放在原生 Menu 的 items 第一项，避免 items 与 children 的渲染先后造成位置不一致。插件内按钮、Portal 菜单按钮及主会话 CLI 入口去除静态边框；hover 使用宿主主题色并以 180ms 缓出曲线过渡，不影响尺寸。禁用按钮不触发 hover；prefers-reduced-motion 下取消过渡，键盘 focus-visible 保留。CLI 分组标题与任务之间的分隔线继续独立绘制。

项目 Logo v7 按用户要求，以 v6 第二张为基础调整为近正方形构形。主体外接框为 1000 × 996px，宽高比约 1.004:1，保留双蓝色、人文曲线及透明背景，见 [v7 设计稿](assets/project-icon/v7/README.md)。

用户随后要求宽度大于高度、比例更舒展；v8 从 v7 继续调整，主体实测 1189 × 862px，约 1.379:1，保留双蓝色、圆角与透明背景。已查看亮暗背景和 24／32／48px 展示，见 [v8 推荐稿](assets/project-icon/v8/README.md)。

## v0.3.5 真实遥测与日期

- Host `TelemetryReader` 从已归属 worker/run 的私有 raw.jsonl 增量读取公开统计字段，内存缓存按文件大小/mtime 刷新；只投影数据，不重写历史记录。文件丢失、未完成行或坏 JSON 不阻塞对话。单文件读取上限 64MiB，缓存最多 128 个运行；超限显示不可用，不伪造不完整总量。
- Antigravity `step_update.usage` 按 step_index 覆盖而非累加，绑定对应回复；`result.usage` 是 CLI 会话累计，独立放在底栏。Codex `turn.completed.usage` 明确标记 CLI 报告值，不把恢复会话的计数跨轮相加；Claude result 包含独立缓存桶；MiMo step_finish 按 part.id 去重后在当前运行内求和。Kimi 未提供可核验计数时留空。
- 统计在历史分页前绑定，底栏取当前运行，不能跟随历史分页跳到旧运行。上下文要求独立的占用与容量；不从模型名字猜容量，不使用累计输入/输出代替占用。Antigravity 的流式输出无这两项数据，v0.3.6 增加以下可选的本地元数据适配。
- 回复栏用量与时间使用宿主次级字号，复用数据库图标。日期遵循 Harness 的本地日历切分：同日 HH:mm、同年 M月D日 HH:mm、跨年 YYYY年M月D日 HH:mm。底栏依次状态、Token、上下文圆环，窄栏截断及换行保护。
- 灰色按钮、可折叠 summary 和统计项提供 180ms 悬停变色；禁用按钮仅外观反馈，原生 disabled 语义保留；减少动态效果偏好关闭过渡。


## v0.3.6 原生交互与上下文元数据

- 替代 v0.3.5 通用 180ms hover：按 Harness 对应控件分别使用原生颜色和时间，WorkStatus 为 100ms 颜色过渡、复制/统计按钮为原生 hover；不统一叠加自定义高亮。复制提示复用 Tooltip，模型列表复用 Menu。分隔线使用 border-l2，复制操作区 28px，圆角及字体增量来自主题。
- 用量和上下文详情使用 useAnchoredPosition / useDismissOnOutsidePointer，顶部间距 8px、视口边距 12px、Esc 关闭；原生背景、阴影、圆角。上下文面板宽 264px。底栏状态改回彩色圆点。
- Host 的 AgyContextReader 仅接收插件 worker 的 UUID conversation_id，只读打开 ~/.gemini/antigravity-cli/conversations/<id>.db，先核对 trajectory_meta.cascade_id，再读取最新 gen_metadata 的 data。8 MiB 上限，文件与 WAL 修改戳缓存最多 128 会话。失败不影响主快照。
- 依据 CLI 1.2.16 嵌入的 protobuf 描述核验字段路径：chat_model(1) → chat_start_metadata(9) → context_window_metadata(10) → estimated_tokens_used(1)、max_context_tokens(4)。只传递数值与来源标识；不解码或展示该元数据中的提示词内容。非负安全整数占用、正安全整数容量才可显示，未知或损坏数据回退未知。
- 本地上下文是最近一次请求的 CLI 估算，详情标注来源与精确数值；与日志中的本轮/回复/累计 Token 用量独立，不将累计用量当成上下文。


## v0.3.7 暗色卡片与品牌入口

- 用户再次明确要求平滑悬停，按钮及 summary 的颜色/背景/透明度统一采用 180ms ease；保留原生圆角、尺寸和主题颜色，减少动态效果偏好关闭过渡。禁用控件允许指针反馈，保留 disabled 语义。
- 暗色卡片改用 interactive-bg-hover，与未选中筛选按钮完全相同；亮色卡片保留现有底色。
- 顶部入口从 header.actions 移至原生 header.utilities 的尾部，只显示 v8 Logo；保留 aria-label 和原生 Tooltip。项目图标复用 doc/assets/project-icon/v8/cliworker-now.png 原文件，object-fit:contain，不拉伸。侧栏标题 32px 图标槽，工具栏入口 28px 图标槽；各 CLI 品牌图不改变。


## v0.3.8 白天模式悬停

亮色 neutral resting fill 与 hover-solid 视觉近似，灰色筛选/返回按钮及禁用灰色控件的 hover 使用 interactive-bg-active。仅作用于 body:not([data-ds-dark-theme])；已选筛选按钮、发送按钮及暗色样式不变。实测未选中按钮默认 rgba(38,49,72,0.06)，真实 :hover 为 rgba(38,49,72,0.1)，180ms 过渡期间存在中间色。

项目 Logo v9 按用户反馈放大左下对话尾部，大幅收缩 C 内部留白，调整三字母重量和柔和轮廓，保留双蓝色与透明背景，见 [饱满对话版](assets/project-icon/v9/README.md)。

项目 Logo v10 在 v9 基础上适当收窄，重新协调 C、l、i 比例，保留大尾部与小留白，见 [收窄协调版](assets/project-icon/v10/README.md)。

用户已选定第二张收窄版 Logo（v10）。以此结合 B 方案制作[整体效果图](assets/overall-preview/logo-v10/overview.png)，展示父级总览／子级对话和亮暗主题。图中内容为设计示例，尚不代表已安装界面的变更。


## v0.4.0 原生设置弹窗与账号终端

- 入口使用 header.utilities 的 order=-20（原生 Finder=-10），24px 按钮、16px Logo；取消侧栏标题分隔线。Modal、Button、StateDot、主题 token 来自 Harness 0.2.0-rc.2；亮色灰按钮继续使用可见的 180ms 过渡。
- 设置按 CLI 切分；模型查询、账号状态、保存独立异步，取消与请求世代防止旧请求污染新选择。主 Panel 不再因模型目录加载而设置全局 busy；对话和停止操作不受模型查询锁定。
- Gateway 专用 accountStatus/start/watch/write/resize/stop；只供人操作，不注册账号管理模型工具。Host 校验父会话和项目，启动遵循规划及只读权限；账号终端与该 CLI 的活动 worker 双向互斥。
- 状态核验：Codex login status；Claude auth status --json；Kimi provider list（不使用含配置凭据的 JSON）；MiMo auth whoami。只投影固定白名单摘要，错误原文和凭据不返回。Antigravity 不提供独立认证状态命令，显示可在原生终端管理。
- 已核验启动参数：Codex login/logout；Claude auth login/logout；Kimi login；MiMo auth login/logout。Antigravity 和 Kimi 退出采用空 argv 启动 TUI，由用户手动输入 /login 或 /logout。manage 打开原生 TUI，插件不自动输入指令。
- 账号终端通过 subprocess.spawnTerminal 参数数组管理；xterm 6.0.0 / fit 0.11.0 渲染 ANSI，禁用自动链接导航，不加载剪贴板写入附加组件。不持久化账号终端输入或输出，CLI 自身按其原生流程保管凭据。
- 状态查询 10 秒/64KiB 上限，终端内存 256KiB/512帧、输入单包16KiB、最多30分钟，30秒未订阅自动清理；关闭/断流/卸载清理，确认进程组退出才释放 CLI 锁。清理失败保留锁并可重试，不报告成功。

用户提供新的手绘构形后，v11 按草图采用短上沿、左竖线与 li 下方长底边组成的开放对话框，保留尾部和自然笔画，使用蓝色及透明背景。见 [草图整理版](assets/project-icon/v11/README.md)，为新的设计方向，未覆盖此前版本或接入插件。

用户澄清草图仅用于示范结构，明确不要笔绘风。v12 采用平滑几何扁平样式，保留短上沿和 li 下长底边，收紧内部间距；见 [紧凑扁平版](assets/project-icon/v12/README.md)。


## v0.4.1 CLI 开关与设置布局

- 每个 CLI 的 enabled 保存到插件私有 cli-settings.json（目录0700、文件0600、原子替换），当前 Harness 运行配置共享，独立于项目模型偏好。旧安装缺少该文件时全开。Gateway cliSettings/setCliEnabled 校验父会话、CLI、布尔值及取消信号。
- 禁用在模型询问前、异步查询后及最终任务提交层检查；拒绝该 CLI 的新任务、续聊、配置变更和账号终端启动及账号探测。已有记录、任务状态与停止仍可用。有活动 worker 或账号终端时拒绝关闭，不隐式杀进程。
- 设置复用原生 Modal、Switch、Button、Menu、StateDot、Tooltip。Modal 固定700px并受原生可用窗口高度限制，内部 pane 独立滚动；操作Button md=36px，Switch 保持原生36×20px及动效，选择器300px。通用hover规则排除switch和主按钮，避免覆盖其原生颜色。
- 左侧导航根据打开弹窗时的 enabled 快照稳定排序；本次toggle保留顺序，下次打开或页面刷新再将关闭项移到末尾。关闭项名称和品牌图灰化，当前CLI顶部始终显示品牌、名称及开关。
- 账号连接检测按CLI独立取消和缓存，每个CLI最多一个在途请求，不阻塞导航。authenticated绿色，unauthenticated/unavailable/查询失败红色，configured/unknown灰色且不伪称已登录；仅Antigravity真实模型目录返回后可标绿色目录已连接。
- 首次加载与刷新均保留账号摘要、操作位、模型/强度、说明与保存区域；区域标题旁的固定槽显示spinner。切CLI和关闭弹窗取消旧请求；禁用时关闭菜单并停止该CLI的发现请求，恢复开启不会重弹旧菜单。


## v0.4.2 设置页层次与登录身份

- 保留原生 Modal/Menu/Button/Switch/Tooltip；弹窗宽800px、导航188px，固定高度700px且受宿主可用高度限制。CLI页首40px图标与24px/32px标题，副标题说明用途。设置行采用原生14px/22px标签、12px/18px说明、16px上下间距及0.5px border-l2分隔；240px以内的控件右对齐，md按钮仍为36px。
- 账号摘要固定预留52px。authenticated显示绿色点与绿色“已登录”，白名单邮箱跟随其后；api仅显示“API 登录”，即使响应携带账号字段也不展示。载入/错误/关闭状态不显示旧邮箱或旧绿色状态。来源及限制显示在次行。
- AccountStatus增添可选authMethod、accountLabel、verification；只传认证方式、邮箱及来源，不传token、API key、原始CLI输出，不持久化账号身份。
- Antigravity无独立状态命令：按已安装CLI格式有界读取其本地OAuth元数据，仅投影ID token中的邮箱。有效访问凭据或可刷新会话显示本地已登录，明确未远程验证；过期且不可刷新显示未登录，未知格式/读取失败显示待确认。读取上限64KiB，结束清空Buffer并关闭文件，不修改凭据。
- Codex先用login status；ChatGPT方式通过app-server的initialize/initialized/account/read(refreshToken:false)读取CLI有效账号源，支持其file/keyring/auto策略，不直接读取auth.json。explicitGatewayOauth:true阻止隐式Gateway登录，不发任务/登录请求；4秒/64KiB限制，完成或取消后等待进程范围清理。不支持查询时省略邮箱。
- Claude的auth status --json只投影已登录claude.ai邮箱；API与helper方式只显示API。MiMo auth whoami的API分支只显示API，不投影UID/密钥；Kimi配置不冒充已认证。以上覆盖此前仅显示状态摘要的行为。


## ZCode 实验性接入（2026-10-05）

- 探针阶段已完成；正式 Host/Client 集成及实际交付状态见下方“多 CLI 扩展”与 doc/tasks.md。
- 无头入口必须显式指定模式，避免默认 yolo。完整交互采用 Host 双向 stdio Bridge，处理 ZCode 自有 NDJSON 与反向 runtime preferences 请求；Client 仍只经 Harness Gateway。
- Provider、模型、强度及会话 ID 取自真实能力；用户已选 GLM-5.3-Flash，探针使用目录支持的 low。独立 CLI 授权与桌面授权不能混同，不伪造 identity 或套餐 entitlement。
- 规划模式须验证实际返回状态，不能仅凭请求参数判断。legacy snapshot 的 mode=build 不代表未规划：真实 headless 会话持久化 planEnabled=true；正式适配须读取独立 plan 状态，探针另以 macOS sandbox 限制工作区写入。
- 个人模型配置、会话库、日志与 socket 均隔离；原生登录写入独立测试 profile。事件与凭据留在忽略目录，停止需确认进程组退出。正式实现继续遵守宿主权限、项目锁和账号操作互斥。
- 入口、能力差异、官方源码构建与待验收项见 [ZCode 验证记录](zcode-probe.md)。
- 真实权限拒绝测试表明，permission.resolved(deny) 后仍可能输出最终 result 并退出 0。首版 headless 适配器必须将权限拒绝/工具失败投影为未完成任务，不能单凭 result 和退出状态报告成功。可交互批准需要后续双向 Bridge。


## v0.4.3 品牌标题与账号操作（2026-10-05）

- 侧栏、工具栏和空状态采用用户选定的 `doc/assets/project-icon/official-v1/cliworker-now.png` 原图；侧栏以 36px 标志、22px `cli worker` 字标和 `NOW` 标记构成标题，继续继承宿主字体和主题，不重绘原图。
- 账号摘要与操作合并为紧凑一行：绿色状态、账号、红色“退出”；右侧为原生 outline/md 的“切换账号”和“账号终端”按钮。两处刷新使用原生刷新图标与 Tooltip。登录来源说明放在状态 Tooltip，明确区分本地登录证据与远程核验；移除模型来源及默认值作用范围的静态正文，行为仍保持项目/CLI 配置继承。
- 账号操作使用独立 Harness Modal，立即展示加载状态与终端，避免终端挂载在设置页滚动区底部。关闭账号弹窗回到设置，关闭/切 CLI/断流清理对应进程。终端初始化异常与启动超过20秒显示重试；关闭清理超过12秒显示未完成反馈而不宣称已停止。
- Host 对 PTY 分配设置30秒上限；请求取消后仍保留迟到分配的所有权与互斥，取得迟到终端后清理，清理确认前不重复启动。渲染/订阅清理与进程停止独立进行，避免停止RPC阻塞订阅释放。成功创建的账号终端不受启动计时器误终止。
- AGY目前没有独立login子命令，登录入口进入其原生TUI并显示手动 `/login` 提示；插件不猜测参数、不自动输入、不保存终端记录。


## 多 CLI 扩展：ZCode、Grok、OMP、Pi、Harness、OpenCode（v0.5.0 历史）

新增六个独立适配器复用 WorkerRuntime 的项目写锁、会话互斥、Host 持久化和原生 Gateway。Pi/OMP RPC 通过长期 stdio bridge 转成插件内部事件；其余保留各自 JSONL 解析器，Harness/Grok 模型发现使用只创建空会话的 ACP bridge。禁止用 MiMo 或 ZCode 的相似字段替代其他 CLI 原生协议。

目录与账号事实分开：ZCode app-server 不会读取独立 CLI 账号模型目录，首版使用配套 builtin 的已验收 GLM-5.3-Flash 条目，并明确不是实时账号目录。Grok 未进行付费模型验收；OMP/Pi 首版仅支持已经核验的智谱路由。新增账号区不提供未经核验的 auth/login 命令，也不把凭据存在标为远端已登录。

新增执行状态在插件 stateDirectory/native/workerId 下隔离。目录0700、子进程umask077；确认进程范围退出后对原生拷贝资源再次收敛文件0600，软链不跟随、硬链接拒绝修改。目录查询每次使用独立 query 目录，避免并发配置互相覆盖。ZCode使用单独短路径临时目录以满足Unix socket限制，范围退出后清理。Pi/OMP保存原生返回的sessionFile映射，拒绝路径越界，不从会话ID猜路径。Host只在显式配置zaiCredentialRef时经原生credentials服务解析并注入对应子进程env，不将密钥保存到请求参数。

macOS外层沙箱限制项目/运行状态写入；Harness例外使用自身工具文件门禁和进程沙箱，禁止danger-full-access，因双层Seatbelt会让原生Bash沙箱失败。Pi/OMP首版工具限读取/搜索/文件编辑。所有解析器检查会话身份、完整终态和失败工具；退出0不足以证明完成。清理继续由Harness原生terminal descendant ownership负责，未达到进程范围静止不报告已停止。

ZCode 使用原生精确工具名 denylist 禁止子代理、Skill、工作流及跨会话调度和 node_repl，不硬编码个人 MCP 名单。该版本 CLI 没有独立 runtime 配置入口，仍会加载全局插件/MCP；原生允许的 MCP 可以执行（plan 甚至可能直接允许未标注破坏性的工具），无头 broker 仅拒绝 ask 分支。不能把外层文件沙箱描述为网络/MCP隔离，亦不修改用户配置来伪造隔离。


## v0.5.1 六个扩展 CLI 的账号来源与原生设置

账号管理按已安装 CLI 的真实能力分流。ZCode、Grok、OMP、Pi、OpenCode 可打开用户操作的原生终端；Harness 0.2.0-rc.2 未提供原生 TUI，空参数不是账号终端，因此不伪造该入口。Host 返回的账号动作可带 `target: models`；Client 对此关闭插件设置弹窗，再经适配 Harness 0.2.0-rc.2 的共享 Store 桥打开原生“模型”页，不调用 `accountStart`。桥组件通过框架在根作用域复用原生设置的同一 Store handle，由框架绑定 actions 和管理生命周期；不自行创建 Store 实例，不使用 DOM 点击或不可用的 shortcuts.invoke。此桥依赖该版本的 openSection 能力，能力不匹配时明确提示，不伪装为通用公开导航 API。`settings.section` 的唯一所有者是宿主原生设置组件，插件不能重新声明或跨所有者渲染该插槽；两种加载顺序都必须保持原生设置与插件入口正常。

当前 Pi/OMP/Harness 任务使用智谱 CN API 路由；有 `zaiCredentialRef` 的 OpenCode 同样使用该显式 Harness 引用。登录配置与切换账号在上述原生模型页面完成，同一引用对应的修改影响所有复用它的 CLI。Host 每次经 credentials 服务解析后，仅向选定子进程的环境注入密钥，不写入 argv、插件模型偏好或账号状态响应。这些路由不提供独立原生退出操作，避免删除某份原生账号后仍自动沿用引用造成误解。Pi/OMP 的管理终端不将原生 OAuth 当成当前 API 路由的替代来源；其临时运行目录与任务数据独立，结束后清理。

OpenCode 的两种来源严格区分：有引用时设置 `OPENCODE_AUTH_CONTENT={}`，屏蔽无关原生凭据回落；引用读取失败即失败。其管理终端的 `model` 与 `small_model` 为 `zhipuai-coding-plan/glm-5.3-flash`，`enabled_providers` 限定为 `zhipuai-coding-plan`，避免默认进入国际 Z.AI 路由。无引用时，登录、退出、管理终端、目录查询与 worker 共用 `<stateDirectory>/accounts/opencode/data` 作为 `XDG_DATA_HOME`，原生账号文件为其下的 `opencode/auth.json`；不复制或覆盖用户全局 OpenCode 账号。数据库、配置、缓存和临时目录仍按运行隔离。该模式允许原生内置 OAuth 钩子刷新账号，外部插件继续禁用；沙箱仅额外允许私有共享账号目录写入，不开放规划模式的项目写权限。

OpenCode 账号准备在分配临时运行目录前执行可取消的凭据解析；准备失败、启动取消或账号进程范围退出后，清理本次终端目录。清理验证目录身份，不跟随内部软链接，不删除共享账号目录或其他 worker 数据。共享 OAuth 状态可能由原生进程刷新，不在另一个会话运行时对共享树执行权限遍历。原生账号文件的读取有 64KiB 上限、拒绝软链接及硬链接文件，仅投影本地 API/OAuth 配置类型，不能据此声称远程认证成功。

ZCode 未显式配置 executable 时，优先采用已安装的完整入口 `~/.local/share/cliworker-now/runtimes/zcode/cli/zcode.cjs`，否则回落到桌面内置 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`。相同版本号不能证明能力一致，账号终端启动前读取实际 `--help` 检查 `login [zai|bigmodel]`；缺少该能力时返回固定中文安装提示。完整 CLI 的登录使用 `login bigmodel`、退出使用 `logout`、管理使用 `tui`，不向终端自动输入斜杠指令。默认授权目录为 `<stateDirectory>/accounts/zcode`，也可由 `zcodeAuthDirectory` 指定；设置与 worker/catalog 共用此来源，避免登录成功但任务读取另一份账号。Grok 沿用本机 `~/.grok` 账号，原生退出影响其他共享该账号的使用方。

六个 CLI 的状态查询只投影允许展示的摘要；本地文件存在、引用可解析或 `configured` / `verification=local` 不等于远程登录、订阅权益或额度有效。该说明通过状态来源提示呈现，不返回凭据内容、API key 前缀或原始异常。账号任务仍遵循 CLI 启用状态、宿主执行权限、取消、同 CLI worker/账号互斥和进程范围清理；本小节描述实现契约，实际验收记录单独写入 `doc/tasks.md`。


## v0.5.2 原生终端登录与账号身份

- OMP、Pi、OpenCode 的登录按钮统一为「登录设置」，直接打开 AccountTerminal，不依赖 Host API 凭据解析，也不导航到宿主模型设置。OMP 使用实际安装版本支持的 `setup`；Pi 固定 1.0.2，通过其导出的 runtime/InteractiveMode 打开原生认证菜单，无提示词或按键注入；OpenCode 使用 `auth login`。Pi UI 接口不匹配时明确失败，不退回模型任务。
- Pi/OMP 的 `accounts/<cli>/agent` 保留原生登录记录；临时 cwd/tmp 仍位于 account-runtime 并在退出后清理。任务选型和既有 API 路由保持显式，不把新登录的 OAuth 静默套用于旧会话。
- Harness 0.2.0-rc.2 没有内置终端登录页，禁用登录与终端操作并显示版本能力限制，不伪造登录界面或跳转设置。
- ZCode 读取其指定账号目录中经原生 AES-256-GCM 加密的活动提供商、登录凭据存在性及 user-info；Grok 识别 auth.x.ai OIDC 记录、过期与可刷新状态。文件读取限64KiB，拒绝软链接/硬链接/非普通文件；返回仅包含状态、允许的邮箱/显示名称与本地来源，异常不包含密钥或原始输出。
- 六个扩展 CLI 使用用户制作的 `doc/assets/cli-icons/v2-extended` 原始PNG和光学居中参数；ZCode/Harness/OpenCode/Grok 随原生暗色主题反色，OMP/Pi 保留原色。登录区域移除重复的宿主 API 设置备注，保留浅边框原生按钮。

OMP 原生登录向导的顶部标志与说明占用较多终端行；账号弹窗为其保留520px终端高度，小窗口通过弹窗正文滚动，避免CLI按行数裁切提供商列表。其他CLI保持原生紧凑弹窗。


## v0.6.0 Hermes Agent 与旧 Harness CLI 退役

活跃 CLI ID 用 `hermes` 代替外部 `harness`，接受自然语言 harmes 别名。宿主 DeepSeek Harness 的 SDK、原生主题、Gateway 和权限机制保持原状。用户 `doc/assets/cli-icons/v3-hermes/hermes.png` 原图进入运行时，按 manifest 缩放与光学居中，暗色反相。

共享协议将活跃 ID 与历史 ID 分离；Storage 兼容旧 Harness 开关、偏好和 worker 文件，但不向设置页暴露旧开关，不迁移到 Hermes。历史行标注已移除，仅支持查看；Host 在新建、续聊、改模型及开启操作前拒绝旧 ID。Hermes 首次独立选型。

Hermes 账号与模型使用原生 home，不注入共享智谱引用。账号终端分别打开 model/auth 原生菜单，状态仅返回安全本地摘要。目录只读取原生明确选择的 provider/model；能力缓存不明确则只提供 default。任务通过原生 stream-json，session_id 独立校验，最终结果结合退出码；工具错误可被后续成功恢复，真实 tokens 进入回复和底栏，不伪造 context。所有进程复用宿主管理与清理机制、macOS 外层写入沙箱。原生 launcher 需要安装锁与运行租约；任务和目录读取仅对白名单日志、会话、数据库、锁与租约授予写入，账号/config/.env/源码保持只读；首次初始化或凭据刷新需通过原生账号终端。详细协议与真实/模拟证据区分见 `doc/hermes-probe.md`。


## 智能体角色预设与稳定名称（2026-10-06）

- 角色库由 Host 存在当前 profile 的私有 `role-presets.json`（0600），供所有 CLI 共用。首次初始化从用户提供的七份小说技能装配；之后编辑与删除持久化，不在重启时重新覆盖。每项包含稳定 id、名称、概述和提示词，名称去重，提示词最多 30000 字符。来源调整见 `doc/role-presets.md`。
- `cliworker_start` 仍按项目＋CLI 取得真实模型和强度，之后每次新建都通过原生 userQuestions 询问角色。选择预设、无角色或 Other 自定义；取消、空答案或无效答案不发布任务。临时提示词仅保存到当前 worker，不自动加入库。问题展示时冻结选项，避免期间编辑模板改变用户实际选择的含义。
- Worker 新增可选 `agentName` 与 `role` 快照（presetId/name/summary/prompt）。首轮在发送给 CLI 的任务前附加角色，页面中的用户任务保持原文；原 CLI 会话续聊依靠原生历史保留角色，不重复添加整份提示词。模板变更不会改变既有快照。角色不能扩大宿主权限或开启孙智能体。
- 名称在同一父会话内唯一，默认由角色名或 CLI 助手名加序号生成。工具可接受用户指定的 `agent_name`；续聊、状态和停止可用 `worker_id` 或精确 `worker_name`，两个字段同时传入时必须指向同一 worker，跨父会话和模糊匹配均拒绝。旧记录使用确定的 `智能体-<id前6位>` 展示名，不批量改写历史。
- 新增 Gateway RPC：`rolePresets`、`saveRolePreset`、`deleteRolePreset`、`renameWorker`。调用先验证父会话；修改取消后不写入，写盘成功后才发布新状态。预设库 CRUD 与角色选择不启动 CLI 或查询模型。
- 设置导航增加“智能体预设”：两列名称＋概述卡片，窄屏单列；搜索、新增、编辑、确认删除使用宿主 Input/Button、主题色、圆角与悬停参数，角色正文以纯文本编辑。对话菜单可重命名。总览显示“名称｜模型 · 强度”，详情标题显示“名称｜主题”；标题改为 Cli Worker，NOW 居中并缩小标题区留白。
- 七份默认角色仅装配可复用提示词；未复制来源技能的工具、共享规范或原小说正文。依赖缺失时提示词要求说明缺口，不声称已完成不存在的脚本或独立审查。

Hermes 与角色功能共享同一 WorkerRuntime；名称、角色快照与原生 CLI 会话分别持久化，退役 Harness 的保护条件先于执行派遣，不影响现有角色编辑及名称查找。


## v0.6.1 字标与设置导航细节（2026-10-06）

- 标题使用宿主 `--dsw-font-family-brand`，回退到原生界面字体；移除紧缩负字距，使用 500 字重、0.005em 字距。Logo、NOW 与设置图标同轴居中。Worker 元信息中模型只占所需宽度，点分隔与强度紧随模型，长名称仍可截断。
- 设置页“智能体设置”与“CLI 连接”为同级导航，分别使用宿主联系人、链接图标；CLI 项缩进一层。点击连接组标题仅折叠导航，不重建当前配置或账号终端，不追加目录查询。展开/折叠使用 220ms 高度与箭头过渡；收起后子项 inert、不可键盘聚焦，兼容减少动态效果偏好。
- Harness rc.2 的原生 MD Button 高度为 36px；Input 无尺寸变体，插件仅将单行搜索、角色名称/概述与重命名输入框的 wrapper 对齐至此高度。开关、多行提示词和聊天工具按钮保持对应原生组件尺寸。
- 返回、取消和保留预设使用原生 outline；删除与确认删除使用宿主错误色及白字，沿用既有确认流程。取消广泛的按钮去描边规则，仅对菜单项维持去描边，保留现有亮暗悬停过渡。


### 2026-10-06：v0.6.2 默认字体与卡片收展

- 总览标题使用 Harness 默认界面字体 token `--dsw-font-family` 与自然字距，NOW 保持居中并降为 18px 高。仅标题 Logo 采用随主题变化的黑白显示，其他 CLI 图标和工具栏入口保留原图。
- 浅色 CLI 卡片以宿主背景和悬停底色混合得到淡灰底；深色继续使用未选中按钮的背景 token。
- CLI 分组保留内容节点，通过网格高度、透明度、分隔线与箭头实现收展，沿用宿主 200ms 时长和缓动。收起内容设置 inert、隐藏语义和不可聚焦状态；开启系统减弱动态效果时取消过渡。


### 2026-10-06：v0.6.3 悬浮卡片与紧凑字标

- 总览标题统一为 `CLI Worker`，Logo 与字标间距从 12px 收紧为 6px，保留宿主默认字体、18px NOW 与黑白图标。
- 分组卡片恢复宿主 `bg-base` 底面，浅色为白色、深色与页面同色。浅色直接使用 `elevation-soft` 柔和阴影和原生细轮廓，深色加强向下投影以形成悬浮层次；不再使用上一版灰底。
- 收展动效、箭头转动、悬停反馈及折叠内容的交互约束保持不变。


### 2026-10-06：v0.6.4 三色正式 Logo

- 用户提供的白色、蓝色与黑色透明 PNG 原样归档到 `doc/assets/project-icon/official-v2/`，同时进入运行时资源；manifest 记录来源文件名、用途与 SHA256。保留原始尺寸和透明度，不重绘、裁切、改色或使用图像滤镜。
- 总览标题用原生主题标记在黑色与白色图片之间切换；工具栏、空状态和新标签页引导使用蓝色版。移除旧标题 Logo 的黑白滤镜，其他 CLI 图标不变。
- 注册标签页与引导标题统一为 `CLI Worker`，沿用现有默认字体、6px 标题间距、18px NOW 和悬浮卡片。


### 2026-10-06：v0.6.5 指定定稿与同轮廓配色

- 用户选定 `exec-c36aab95-deae-46a1-a896-f650a5bed8f7.png` 为唯一造型源，原图归档 official-v3，并逐字节复制到运行资源。
- 所有项目 Logo 使用同一 PNG alpha 蒙版；标题随主题黑/白，入口蓝色并在右上胶囊范围叠加天蓝色。配色层始终被相同 alpha 裁切，形状、间距与圆角不会因不同生成稿变化。其他 CLI 图标保持原状。
- 两张 imagegen 换色探索有轮廓偏差，单独归档为未采用；移除旧运行时蓝/白 PNG，避免误用。


### 2026-10-07：v0.6.6 天蓝平切 Logo 定稿

- 用户最终选择 `exec-1f96a1dc-5099-4e6e-949c-6b37a295db1d.png`，归档 `official-v4` 并逐字节复制到运行资源；后续生成的精修稿不作为定稿。
- 彩色入口直接显示原图，浅色标题黑色、深色标题白色，共享原图 alpha 蒙版，三版轮廓、间隙、圆角和透明度完全相同。删除旧配色层的固定位置天蓝矩形，原图颜色直接保留。
- 保持标题、NOW、卡片与其他 CLI 图标现有布局，未调整插件业务行为。


## 2026-10-07：OpenSpec 开发流程接入

- 通过项目开发依赖固定 OpenSpec 1.14.1，使用官方 spec-driven schema 与 Codex core 项目技能。日常命令统一为 `pnpm spec`，项目约束写入 `openspec/config.yaml`；定制不写入官方生成技能。
- 新增能力、行为/协议/权限调整及跨模块重构通过 change 管理提案、增量规格、设计和任务。已落实规格存 `openspec/specs/`，完成并核对证据后归档；无行为变化的拼写排版修正可直接完成。
- 本文继续保存架构及版本演进；`doc/tasks.md` 继续记录实际验证结果。后续修改依据当前源码、测试与最新有效决策提取相关规格，不机械迁移旧版本未完成清单。
- 首次仅建立 development-workflow 规格，业务能力域在实际变更触及时逐步补充。命名角色及预设已实现，Grok/Hermes/Kimi 的真实验收边界继续以现有证据为准。
- 本次不改 Host/Client/共享协议，不更新 Desktop 或真实运行 CLI。使用方法、候选能力域与升级方式见 [OpenSpec 开发指南](openspec.md)。


## 2026-10-07：v0.6.7 明确调用、原生目录与状态证据

- 名称表统一驱动 Host 派遣工具和中文调用提示。规范 ID 与常用别名可直接解析，agy 对应 antigravity，glm／zhipu／智谱对应 zcode，harmes 对应 hermes。较长名称只接受唯一轻微拼写误差，短名称、歧义与 retired harness 不作模糊替换；省略 cli 的旧 Antigravity 工具调用保持兼容。
- 通过 Harness 原生 agent/pre-step 观察本步用户消息，在 systemPrompt 动态 section 增加明确调用的规范路由提示；不扫描旧会话来猜本轮请求，不注入原始用户文本，不直接启动任务。讨论、否定与引用不产生派遣提示。所有调用继续经过项目／CLI 偏好、首次选型、角色问题及宿主规划／只读／子 Agent 拒绝门槛；现有名称续聊仍使用 followup。
- ZCode 按原生规则合并 builtin 与 personal 服务商／模型配置，保留完整 ID、隐藏与禁用覆盖以及原生推理能力；不再把 PoC 的 GLM-5.3-Flash 作为唯一模型。私有副本保留原生个人规则，只覆盖本次选型。headless resume 原生忽略默认选型，因此续聊先通过受同一沙箱及进程组约束的 app-server metadata wrapper 改选并读回，close 完整退出后才启动 headless；取消、拒绝与观察不匹配不会继续任务。Pi／OMP 同会话改选使用原生 RPC 并核验；原生目录、账号读取与任务 bridge 使用相同来源，不给其他 provider 注入 CN 智谱引用。
- Pi／OMP 从全局原生配置和插件持久账号目录安全读取允许的认证／模型输入；同 provider 的有效插件账号优先，空插件配置不遮蔽全局账号。worker 的会话与运行状态继续隔离，原生全局配置保持只读；仅复制所需账号和模型数据，不复制历史会话。Host 智谱引用仅作为显式兼容来源。
- AccountState 增加 unconfigured 以区分未配置与已知失效。默认缺安装、无账号、空配置灰色；unauthenticated 表示明确失效，unavailable 表示读取／配置错误，二者红色。显式坏 executable 配置红色。未知信息保持灰色并说明原因；Client 导航与账号摘要共用投影，未配置优先于空目录失败。
- 原生目录和本地账号记录仅证明相应本地事实，不证明远端模型或订阅可用。此次变更通过 OpenSpec 的 worker-dispatch、cli-model-discovery 和 cli-connection-health 管理；自动回归、非模型本机查询、实际界面和未做真实任务的边界见 doc/tasks.md。


## 2026-10-07：v0.6.8 账号可用模型与精简名称（重开）

- 用户反馈后重新取出 `fix-cli-routing-model-catalog-health`。v0.6.7 的原生 available 只证明候选目录，不再作为账号权益验收；保留历史记录，当前任务单独追踪。
- Pi、OMP、OpenCode 先安全读取原生账号及配置，再将候选与当前账号模型范围相交。过期 OAuth、无账号、账号范围未知、仅公共目录存在的模型隐藏；Codex OAuth 还检查 API 支持和当前额度是否允许。多账号池仅保留各可能执行账号共同支持的模型，避免把另一账号的权限借给当前请求。
- 查询不发模型任务、不刷新 OAuth、不执行 shell 密钥解析命令。同一私有快照先在单层断网沙箱读取原生候选，再单独做有界只读 HTTP 账号查询，避免 macOS 不允许重复 sandbox_apply；账号阶段不启动原生 CLI。取消同时覆盖进程和请求，无法确认元数据进程退出时阻塞后续任务并保留状态。任务准备使用同样查询，再通过确认目录和原生 setModel／observed 核验；原生全局账号、配置与会话只读。发现和执行共用原生账号优先级与私有副本，Host CN 引用只绑定对应路由，不扩大模型清单。
- OpenRouter 使用账号模型端点，公共 `/models` 不充当账号清单。OpenCode 匿名公共免费目录不作为登录账号证据；官方 Zen 的公共零价格路由没有当前 Worker 兼容证据时隐藏，自定义端点按真实账号范围核对。404/405 不代表认证或模型权限成功；自定义配置和未绑定当前账号的旧 Host 成功记录均不能替代当前账号范围。缺少证据的候选隐藏，旧偏好和完整 ID 保留，不请求新模型输出来填补证明。
- 新共享展示层只用于清洗模型名称：去除首段 provider/account 前缀和括号附注，保留模型自身合法 ID；设置、首次询问、Worker 菜单和历史卡片统一使用。按确切原生型号去重，不合并不同版本或各路由的强度能力；保存与执行完整 ID 不变。有效旧选择固定其原路由，不可用时要求重选。
- `ModelChoice.cost` 为 free/paid/unknown。只有明确价格/免费额度且可用的模型在新选择中优先；缺省零成本、未知价格和付费订阅包含额度不当免费。多账号池全部可能身份均免费才标 free；附加费用和冲突价格不算免费。免费排序不自动选择、不覆盖偏好，失败不转付费路由。
- 本轮验证区分隔离账号夹具、真实本机只读元数据、实际 Desktop 呈现和模型生成；结果与无法确认的范围见 `doc/tasks.md`。接口公布的账号清单不能保证未来余额、服务可用性或每次模型任务成功。


## 2026-10-08：v0.6.9 六款 CLI 设置加载、身份与账号证据

- 设置统一先完成账号检查再加载对应模型。账号刷新、登录终端结束或关闭都会使旧目录失效；查询取消、失败、返回 CLI 不符时禁用旧模型与保存，不改已有偏好。导航与账号摘要共用状态：仅 `authenticated + verification=cli` 显示绿色，本地配置或登录文件保持待验证；Host 模型凭据不能证明原生 CLI 已登录。账号说明允许自然换行。
- ZCode、Grok、Hermes 的本地 access token 过期不再报登录成功，refresh token 单独存在不能证明任务凭据可用；Pi、OMP、OpenCode 先独立读取原生状态，再说明显式 Host 来源。每款 CLI 保留自己的登录/配置入口，不共享登录身份。
- Pi 采用已核验的原生 Pi Coding Agent 1.0.2/1.0.4 包与 SDK，目录、登录和 RPC 使用同一入口；OMP 必须核验 Oh My Pi 品牌及所需原生参数。入口混用或能力不符明确失败，工具说明同时说明二者独立；同一服务商和模型不构成同一 CLI。取消传到身份元数据进程，退出未确认时不清理仍被占用的状态目录。
- ZCode 安全读取当前 identity 精确绑定的 individual coding-plan key，与对应原生路由的账号模型范围相交。只对 ZCode Anthropic 兼容路由镜像其原生双认证头；官方 individual provider 在精确官方端点使用原生已定义的 GLM 别名表，将接口的小写 ID 投影到原生 canonical ID，执行 ID 保持不变，其他路由仍精确匹配；未知账号模式、旧 identity 或不能重建的自定义 headers 不放行。`ZCODE_CREDENTIAL_SECRET` 仅显式传给 ZCode 子进程，Host 解密与登录/执行使用同一来源，不进入 argv、文件或响应。
- Grok ACP 公共目录不能证明当前账号 Worker 权限，缺少该证据时隐藏候选并说明限制。Hermes 只对可忠实重建的原生 OpenRouter / Codex OAuth 路由验证账号范围，保留原生已选模型及其能力；账号池按所有可能凭据的共同支持范围筛选，禁用 provider、未知端点或外部 `codex_app_server` 账号不放行。损坏的 Hermes 固定 exec 入口在查询和启动前明确报错，不启动安装器。
- 模型列表的证据来自只读账号元数据和原生 Worker 能力，不能保证未来余额或每次生成成功。未进行计费生成试探、OAuth 刷新或自动登录；本机结果、模拟 UI 与残留限制分别见任务记录。


## 2026-10-08：v0.6.10 原生已登录状态与单行账号信息

- 修正 v0.6.9 把 `verification=local` 当成未登录的错误。该字段只描述读取来源；`authenticated` 的原生状态、可续用登录会话及当前账号精确绑定均可显示已登录。Antigravity consumer 会话有有效 access 或 refresh 时保持登录；ZCode 受支持 individual provider 的当前 identity、绑定 key 和原生用户记录一致时显示 OAuth 已登录。手填 API 身份、孤立/旧 key、普通配置及 Host 引用不因此提升为原生登录。
- 登录状态与模型范围分开：不要求发送模型请求才能显示已登录，模型筛选仍沿用当前账号和原生执行路由。原生文件保持只读，状态刷新不会提交登录或刷新 OAuth。
- 设置账号区统一为一行短状态及必要身份/原因，删除正常状态 detail、二次拼接和静态防御性文案；账号终端仅保留操作指导、进程状态和简短失败原因。不是把长说明用省略号藏起来；账号身份本身可保留完整 title。
- 刷新失效、CLI 身份检查、失败重试、权限和进程范围清理保持原有实现。网关形状和存储兼容，隔离验收后再更新 Desktop。


## v0.6.11：全部 CLI 自身账号与模型隔离

- 原生登录和该 CLI 独立配置的 API Key 属于自身来源；Harness 引用、跨 CLI 文件、通用密钥环境、匿名目录及旧快照不属于账号授权。旧 `zaiCredentialRef` 只兼容解析，不读取它引用的密钥。
- Host 以 CLI、受限来源、稳定 OAuth 主体或 API 摘要组成匿名账号绑定；正常 token 续期不改变主体。绑定只保存在私有 worker sidecar，不进入共享 Worker、模型目录、Gateway 或历史消息。保存、新建、队列出队及续聊重读当前来源和模型权限；准备完毕再次核对，原模型与强度不一致时拒绝，不隐式替换。
- Pi/OMP 按当前自身来源生成认证投影；可核验身份的 OAuth 使用来源绑定的共享存储与 Host 租约，API 投影按当前来源重建。移除历史合成 CN 提供商及 OMP broker；OpenCode 只展开自身目录内的环境和文件引用。Grok 每次替换派生认证链接；ZCode 复用当前 identity 与绑定 key 的原生合并。原生及插件登录账号不被迁移删除。
- OMP 原生会加载 HOME、config root、agent 和项目 dotenv。Pi/OMP 的模型查询、任务和账号终端均额外使用 macOS Seatbelt 禁读 `.env`／`.env.*`；自身私有 `.env` 已由 Host 限定目录解析并投影。OAuth 文件与会话继续可用，HOME 和项目 cwd 保持原生语义。
- Hermes 原生默认可导入其他 CLI 账号；只有自身配置 `auth.adopt_external_logins=false` 且未使用外部凭据池／Codex app-server 才可进入模型和执行路径。MiMo 禁止环境凭据和默认／外部 provider 插件自动导入，目录和任务使用相同参数。
- 所有模型都以原生能力和当前自身账号模型范围求交；前五 CLI 不再靠 Codex 旧缓存、Claude 固定别名、MiMo 公共缓存或 Kimi 配置候选直接放行。未知范围返回短原因与空列表。无生成探测，不能把历史成功或离线目录当成本轮真实生成验收。
- 查询清理失败保持错误优先于取消，阻止后续派遣。排队取消也等待已启动的账号读取结束，避免提前释放任务；设置页查询清理失败同样锁住派遣。

- Hermes 的交互 Codex 登录另有直接导入入口，不受 adoption 开关约束；账号终端、查询和任务统一拒读 Codex／Claude 的默认、环境覆盖及符号链接目标，阻止 Keychain security 导入。Hermes 自身 OAuth 文件保持可用。
- MiMo 在原生配置服务执行前检查全局、项目祖先、私有目录及托管来源，拒绝未核验的文件／环境插值、wellknown 和活跃远程组织配置；只读核查 SQLite/WAL，不读取组织令牌。屏蔽父配置覆盖，路径与原生公式不一致时拒绝。该配置检查覆盖目录和任务；账号状态只读自身 Auth，登录终端使用隔离配置上下文，界面只保留单行原因。
- 升级前无账号绑定的历史任务无法证明原会话身份，保留查看但要求新建任务；不能把当前登录自动绑定到旧会话。账号激活钩子在最后绑定核对后由 Host 获取租约，取消时等待激活返回后清理；Child 只能验证租约，不能写入或删除锁。
- OpenCode 1.18.21 的 OAuth 刷新为无 CAS 的整份认证文件写回，不能保证外部原生终端退出／换号后不恢复旧条目；该 OAuth 模式保留真实账号状态，但不提供模型和执行路径。自身 API 配置继续按账号范围开放。Pi／OMP 正常续期使用原生锁或 SQLite 条件更新，只保存当前来源仍匹配的账号条目。

- 实机反馈后的登录恢复：账号导航和摘要只采用账号证据，模型读取中或失败不覆盖已确认登录；刷新时保留账号身份，但立即使旧模型选项失效。查询失败仍在模型区独立显示短原因。
- Antigravity consumer 登录使用实时原生 `agy models`，按其明确返回的 ID/label 生成模型与强度变体；自定义提供商改选不沿用 consumer 账号绑定。登录身份先通过本地受限读取展示，模型元数据随后独立加载。
- MiMo 原生网页登录写入的是自身 ApiAuth，metadata 中的官方 base_url 参与原生模型路由解析。状态直接读自身 auth.json；账号终端使用隔离 HOME/config/DB/cwd，仅链接同一原生认证文件，避免项目模型配置阻塞登录。原生 verbose 模型头部的 window/budget/compacts 字段是合法元数据，解析后仍核验 provider/model 与 JSON 一致，再与账号模型范围求交。
- 只合并相同 CLI/项目正在进行的账号请求；每个调用独立取消，最后取消须等待进程清理，完成结果没有 TTL 缓存。Codex 优先一次原生 account/read，协议不支持才回退；OMP 仅缓存按可执行文件 canonical 路径、inode、大小和时间戳绑定的能力，账号/模型权限仍每次检查。


## 0.6.12 原生登录入口与 Grok 权限目录修复（2026-10-08）

- Kimi `provider list --json` 仅在 Host 内解析；按原生当前 `managed:kimi-code` OAuth 引用读取自己的令牌槽位，区分缺失、撤销墓碑、过期不可续期与有效／可续期。已有登录的 `login` 本来会直接复用账号，所以按钮改为“管理登录”，打开原生 TUI，由用户明确 `/logout` 后 `/login`；不自动退出或构造不存在的 force 参数。账号终端使用 0700 独立空目录和空 Git/MCP 边界，避免上溯到用户项目；原生未信任目录的 Trust 提示由用户选择，不自动写入信任记录；退出后按 inode 校验清理。
- OMP 的 `setup` 入口保持原生；其日志位于 `agent` 同级 `logs`，只为已规范化的自身私有日志子目录补写权限，不扩大到整个账号根目录。
- Hermes 在显式账号操作时建立插件内独立原生账号目录和目录外的来源标记；状态、目录、绑定、执行统一读取该来源。之后退出不回退到旧全局账号，原全局配置／凭据／会话保留。精确允许原生自身登录 source/provider 对，不开放 `manual:*` 通配；原生 last_status、reset/cooldown 仍是不可用证据。
- Hermes 安装与账号分离：复用已安装官方 launcher 绑定 checkout 的 committed facts 所选 venv，在原生安装锁内复核并持 generation lease，禁用懒安装。入口资产随正式包和 preview 打包；未知安装形态仍遵循原有核验。沙箱只允许自身 `.env`，阻断旧全局和安装源码的环境层及已知外部账号导入。
- Grok 登录状态与调用权限分离。固定官方 `/v1/settings` 的 `allow_access === true` 是 Build 门槛，随后读取 `/v1/models`；两个只读请求均绑定同一当前账号指纹。目录 200、是否订阅都不单独代替服务端门槛，不做自动续期或生成探测。门禁拒绝／未知、认证失败、超时和目录空响应分别诊断。
- Grok 当前精确安装版的动态模型 schema 已用禁外网、本地模拟目录验证能解析 `grok-4.7` 及 low／medium／high／xhigh。这个版本使用已验证动态能力与认证元数据求交，其他版本保留原生候选交集；匿名 fallback 的旧 `grok-4.5` 不再误删有证据的新模型。Worker 对源认证目录和派生 auth 链接禁止写入，不能借旧快照复活退出账号。
- 设置继续只有必要单行账号摘要。详细 Grok 诊断在聊天和验收记录中，原生操作说明仅在账号终端中。

## 2026-10-08：v0.6.13 服务商登录显示与 Hermes Nous 目录

- 本轮修复 Pi、OMP、OpenCode 与 Hermes 将自身有效认证固定显示为 configured 的问题。共享协议兼容新增 `logins`，只投影服务商名称、认证方式与安全的 OAuth 身份；Client 的账号行和导航状态使用同一格式。API 显示“服务商 API 登录”，OAuth 显示“服务商 账号登录”；混合认证保留多项且单行省略，API 身份字段不渲染。配置模板、未解析引用、禁用与失效凭据不升绿，目录失败不抹掉本地有效登录。
- Hermes 补齐 Nous 原生 flat OAuth/device-code pool 的状态、绑定、目录与执行上下文。按当前自身来源核对 agent key、身份、组织、scope、TTL、pool 与官方路由；空 pool 可识别登录，但不绕过原生初始化启动。拒绝跨账号 pool、匿名、额外 key/路由与外部来源，不修改原生账号文件。
- 模型采用官方认证 `/api/oauth/account` 与 `/v1/models` 元数据，结合原生聊天/tools/冷却和账号访问范围；无付费访问权只开放明确零费用项，未知或额外收费项不冒充免费。强度与原生 Nous chat wire 词表求交集，不将 CLI 解析器接受但传输层会钳制的 `ultra` 展示为独立能力。保持完整模型 ID，不变更公开模型和偏好结构。
- Nous 最小有效期由同一 helper 供读取、绑定、目录及子进程使用，默认与最低值 120 秒，自身更高值优先。不再因原生默认提前 1800 秒刷新而拒绝仍可使用的账号；仅投影官方进程参数，原 `.env` 不变，目录不自动续期。查询结束重新检查当前来源、TTL、身份、路由和冷却；能力缓存按来源与请求版本隔离，旧请求取消不得清除新结果。
- 不扩大 Pi/OMP/OpenCode 的模型权限，不解除 OpenCode 原有 OAuth 执行限制。真实验证限于本地状态与 Nous 已授权元数据；实际生成和续聊仍未验收。

## 2026-10-09：v0.6.14 账号摘要、身份与原生退出

- 有 OAuth 登录时，可见摘要只显示去重的订阅服务商，如“OpenAI账号登录”；其他自身 API 认证和安全身份保留在悬浮详情，模型范围不变。仅 API 登录继续显示服务商。Kimi 从当前原生 `kimi-auth` 令牌的稳定主体字段投影末六位账号 ID；不显示令牌片段、不编造邮箱或昵称、不刷新认证。
- OMP、Pi、Hermes 使用与其他 CLI 相同的退出按钮。新增有限来源 `native/plugin` 及 `accountStartForSource`，旧接口保持兼容；多个来源先由用户选择，取消不启动终端，Host 启动前重读真实来源。Pi 使用所选真实 auth 文件，OMP 仅将真实 SQLite 认证数据库链接进私有运行目录；退出不经过合并认证快照，不清空其他账号来源。
- 退出进程禁网并保留原有互斥、取消及进程范围清理。Pi/OMP 的原生菜单只删除其支持的已保存凭据，`.env` 或模型配置中的 API 需在原配置管理，保留有效来源时不伪称全部退出。Hermes 使用当前 effective home，不触发登录目录迁移；只给原生认证和环境文件及其锁/原子临时文件写权限，不扩大到配置、历史或整个账号目录。
- Hermes 原生 `suppressed_sources` 的当前来源标记同时约束账号投影、模型范围、查询结束重检及任务绑定；保留的配置值不能复活已退出账号，独立未停用来源继续核对。打开原生菜单可能规范化凭据池，取消不承诺源文件逐字节不变；本次真实账号验收未执行退出。

## 2026-10-09：v0.6.15 原生保护、Windows 与双语发布

- 用户明确改为采用各 CLI 原生保护，取消插件额外 OS 沙箱；任务、模型查询和账号终端均不再使用 sandbox-exec、SBPL 读写或网络策略。此前版本的 OS 禁读记录保留为历史，不再是当前保证。Host 继续准确识别本 CLI 自身登录/API 来源，过滤继承密钥，不注入 Harness 或其他 CLI 凭据；保存、启动、出队与续聊仍核对账号版本、模型和强度。
- 原生模式保留：Codex/Antigravity 使用其原生沙箱，Claude 等使用实际权限模式，Grok/Pi/OMP/OpenCode 保留自身工具限制；Kimi 与当前 Hermes 非交互模式没有可核验只读能力，明确拒绝只读派遣，不以普通执行冒充。宿主规划/整体只读边界和已有会话互斥不改变。
- Windows 统一解析真实官方 Node/Bun npm shim、原生 exe 和 Hermes 固定 Python launcher，以独立 argv 执行，未知 batch/运行时拒绝；不使用 cmd /c。任务经 Harness 普通 spawn 的 Win32 Job 管理后代，账号交互保留原生 ConPTY，并按实际范围确认退出。Windows 路径从盘符/UNC 根解析，私有目录复核不依赖 POSIX 目录 fd，POSIX mode 检查不误用于 Windows。
- MiMo Windows 登录直接关联当前自身原生认证目录，私有 cwd/DB 单独管理，不复制 auth 或要求 symlink 权限。OMP Windows 退出直接选中真实 agent/DB，配置代理时拒绝；非凭据配置根只在子进程重基，私有/原生账号路径仍明确。认证读取增加文件路径/描述符身份及读取中变更核对，避免取消外层后将链接目标误作自身登录。
- 默认中文 README 与完整英文页双向切换；首选安装代码块只一行固定 Release URL，macOS/Windows 共用 Desktop dsh 命令。Windows CI 验证真实运行层和临时账号数据，官方 CLI 只执行版本/帮助及 SDK 元数据，不将这类检查描述为真实推理验收。发布包含双语文档和所有动态辅助资产，远端下载与隔离 URL 安装另行核对。


## 2026-10-09：v0.6.16 派遣设定与主对话确认

模型、思考强度与角色作为完整设定保存。首次使用项目中的某个 CLI 时，先由原生问题卡选择模型，再选择实际支持的强度和角色；取消任何一步均不保存半套设定。同项目同 CLI 的新主对话只询问是否沿用；选择不沿用才重新选型。同一主对话的后续派遣使用其已确认快照，不重复问角色。

私有项目偏好扩展角色快照和账号绑定；公开 Preference 仍保持 cli/model/effort。null 表示用户明确选择无角色，旧版缺失角色字段时视为未完成选择。独立的主对话确认记录按父会话、规范项目路径和 CLI 隔离，Host 重启后继续使用；其他对话或设置页修改默认不会改写已确认对话。临时角色可随完整设定沿用，不加入角色库；预设库编辑仅在重新选型时生效。

选择队列限定同主对话、项目和 CLI；各等待者可以取消，当前询问取消后后续调用重新取得选择机会。保存前、启动前和原有队列/续聊授权仍核对当前自身账号、模型和强度。两类问题均省略项目路径、说明段落及灰色选项描述；工具指引将提问交由插件内部完成，Client 等待提示同时适用于选型和沿用。


## 2026-10-09：v0.6.17 当前派遣指引的时序修复

- 真实会话显示首次 `用agy和我说你好` 先触发主模型的普通角色提问，后一步才出现当前 Antigravity 派遣指引。Harness 0.2.0-rc.2 原生顺序是 `inbox.claim → systemPrompt.assemble → agent/pre-step`；原来的 pre-step 写 WeakMap / system section 读取使指引晚一个请求。
- 改为在 pre-step 的准入结果中追加具名 `cliworker-invocation` / `instructions` 上下文，直接进入同次模型请求；保留原用户消息与来源。只使用准入人类请求，取消、拒绝、子 Agent 或工具不可见时不追加。删除跨步 WeakMap / current-invocation section，释放时仅清理监听。
- `cliworker_start` 工具及派遣说明明确：调用本工具打开选型，模型、强度和角色由插件收集，用户确认后才启动；主模型不必预先收集这些参数。现有完整选型／沿用状态机保持。
- 没有过滤工具 schema、注册提问执行 guard 或修改 Harness 问题工具。最初的拦截草案已撤回，未交付；按实际原生顺序测试本次请求，普通提问工具仍可见可执行。
- 验收为真实 Harness 原生界面加模拟目录，不发起模型生成；修复的是已确认的指引时序及工具语义，未将模拟结果宣称为所有主模型的实调保证。


### v0.6.18：新派遣显式 CLI 契约（2026-10-09）

真实会话中，本次 Hermes 路由提示已及时进入请求，但主模型发出的 `cliworker_start` 仅含 prompt/title。工具将 cli 声明为可选，执行端又通过 `args.cli ?? 'antigravity'` 兼容早期单 CLI 调用，导致新请求错误读取同对话的 Antigravity 选型。根因是新派遣工具契约仍允许缺省 CLI，而非 Hermes 历史偏好跨 CLI 读取。

新建派遣将 cli 设为原生工具必填参数，处理器删除 Antigravity 默认回落；静态工具说明和同请求提示均要求每次显式传当前用户选择的 CLI。缺失参数由原生工具校验返回参数错误，在模型目录、选型和任务创建前结束。没有新增提问过滤器、文本推断回填或用户询问。旧记录的 cliOf 兼容读取及只读目录兼容行为保留，续聊仍绑定既有 Worker。

回归覆盖全部 11 个 CLI 显式选择，以及同对话已有 Antigravity、项目已有 Hermes 时的原始漏参复现和显式 Hermes 派遣。隔离原生界面模拟确认沿用卡和最终提交均绑定 Hermes 的模型、强度与角色。该模拟不证明真实主模型永不漏参；必填契约确保漏参不会再静默变成 Antigravity。


## v0.7.1：子对话原生交互对齐（2026-10-09）

- 原生核查绑定 Harness 0.2.0-rc.2。ui-chat 的返回按钮、ScrollFollow、MessageIconActions 与 ui-conversation 的 Lexical composer/keymap 均是私有实现；公开 InputHub 会发送主会话，不能用于 Worker。复用 primitives 公开向下图标、现有 Button/Tooltip 和宿主主题 token；私有规则在 Client 的局部适配器中注明源码来源，不修改 Harness 核心。
- 返回按钮使用原生 34×34、100px 圆角、14px 图标、浮层边距及 floating/elevation 主题；原生没有入出场或平滑动画，点击即时回底。跟随阈值为原生 25px，历史阅读遇新消息保留位置。历史功能条整体使用 opacity 80ms；用户整条消息、AI 回复尾部 hover/focus-within 显示，触屏常显。实时 timeline 决定真正最新消息，历史分页不产生假最新，进行中的流式尾部不提前常显 AI 功能条。
- Enter 与单独 Ctrl/Cmd+Enter 经原表单和所选 Worker 续聊入口提交，Shift+Enter 换行；保留 IME/isComposing/229、确认后 10ms、repeat 和修饰键规则。同步提交锁防止连续按键重复发送，失败保留草稿。原生 busyEnter 控制运行中 queue/steer，与本插件仅空闲续聊的规则不相同，本轮不新增运行中发送行为或设置桥。


## v0.7.2：智能体管理与历史新建入口（2026-10-09）

- 默认名称改为 CLI 短名及序号：`agy-1`、`codex-1` 等。加载时仅迁移缺名、严格旧 CLI「助手-正整数」格式或明确 `auto` 的名称；自定义与角色名称不推断。旧精确名称保留别名并继续占用，Worker ID、角色、会话和历史不变。
- `effortLabel` 在卡片、输入框、菜单、设置及原生选型问题统一首字母大写；选项按支持能力反向映射，实际协议仍为 `low`、`high` 等。
- 卡片使用独立打开、名称复制及原生 `Menu` 控件，右键/Shift+F10 提供标题编辑、名称编辑和删除。标题与名称分别原子保存。删除为持久可恢复隐藏，保留账号绑定/原生会话/事件；跨父会话、活动任务或未完成清理不能删除/恢复。名称悬停与聚焦使用主题、100ms 反馈，复制结果如实显示，按钮不触发打开，异步结果和定时器随组件清理。
- 缺账号绑定的旧 Worker 在输入前阻止原会话续聊，提供明确「新建对话」。新建保留原 CLI/模型/强度/角色，核对当前自身账号、权限和目录后使用全新 Worker，不复制旧 conversationId；失败保留草稿和原历史。旧 Antigravity raw/init、摘要库没有足够账号证据，不猜测补绑。
- rc.2 原生后台任务菜单内联在标题行，其 stacking context 与中央列裁剪导致侧栏遮挡。插件保留原组件与事件，仅在 CLI Worker 可见和原菜单展开时放开实际裁剪祖先并提升标题层级；关闭、隐藏及卸载恢复，observer/resize/rAF 完整清理；不改 Harness 核心。
- 所有明确进程清理未确认的源头写 Host 私有 `cleanup-blocked.json`（只有 policy/state，0600），重启仍阻止任务、账号及删除恢复。损坏或不安全记录继续阻塞，无可信退出证据不自动清除，不从旧错误文案推测隔离。磁盘完全不可写时当前 Host 仍阻塞并报告保存失败，不能声称跨重启已经持久保存。


## v0.7.3：总览与编辑布局（2026-10-09）

- 搜索、四个状态筛选与淡红垃圾桶按钮放在固定控件区，下方任务列表独立滚动；卡片区保留原滚动位置记忆。垃圾桶切换已删除/正常列表，不改变搜索或筛选。
- 名称及聊天标题编辑共用原生 Modal/Input/Button，通过局部 contentClassName 收紧正文间距，Input 外壳铺满内容宽度，与保存按钮右缘一致；空错误区不占高度。
- 名称复制只使用文字按钮，移除复制图标及其占位；成功后显示已复制，指针离开或键盘失焦约一秒后恢复。保持主题 hover/focus，核对异步请求代次并清理计时器，不因点击残留聚焦阻止指针恢复。
- 缺账号历史提示和明确新建操作合并在标题下的紧凑圆角横条，输入区不重复；原新建验证、草稿保留与旧会话禁用行为不变。初始空页参考原生文字层级，仅保留温和标题和一句主对话操作提示，不放图标或提供商列举。
- 本轮只改 Client，Host、公开协议、凭据、历史和权限不变；使用隔离原生 UI 的模拟账号/模型/执行接收方验收，不发起真实生成。

## v0.7.4：卡片与回收站回归修复（2026-10-09）

- 列表顶部及窄栏增加8px内边距，使首组elevation描边在滚动边界内；搜索与筛选仍固定。四筛选动作同时退出回收站，回收站时四aria-pressed均false；垃圾桶选中深红白图标，再次点击恢复原筛选与搜索。
- WorkerCard改成标题、元信息两行及跨行居中箭头；删除可见省略号。原生Menu的anchor包含真实开卡片按钮，右键、ContextMenu和Shift+F10管理及关闭后焦点恢复保留。名称内边距上下2px左右4px，复制计时保持。
- 模型显示去掉多层提供商/组织路径；nativeModelName分组键仍保留组织，执行ID与能力不改。不同原生身份同叶名称继续独立选择；default统一显示为默认，协议字符串仍default。
- 无凭据、历史、Worker迁移；不修改Harness核心。本次模型、菜单和视图验证采用隔离模拟来源，不发起真实模型请求。

## v0.7.5：状态条与名称字距（2026-10-09）

- 标题下状态条按Harness rc.2展开新会话按钮38px适配，border-box、上下5px内边距、内部操作28px；主题与单行布局保持。
- 删除无原生会话时输入区说明的JSX分支；canResume、输入和提交校验保持，不通过CSS隐藏文本。
- 名称按钮左右8px内边距与-4px外边距使按钮扩大8px且名称文字起点不变；flex保持长名省略宽度。以1px装饰线替换全角分隔字符，模型前4px补偿，使名称和模型到线的文字距离相等。普通字距11px、按钮到线3px；窄栏gap规则对应9px/1px。
- Host、账号、会话、模型ID及持久化不改；隔离原生UI验证几何与行为后正式更新。

## v0.7.6：简洁筛选区（2026-10-09）

- 从panel移除统一cwn-filter-info JSX及其CSS，不再生成匹配数量/没有匹配的任务和清除筛选。visibleWorkers过滤逻辑保持，清空搜索及选择全部仍可恢复列表。
- 初始无任务短文案、回收空页、固定控件和列表滚动保持；不改变Host、账号、模型、会话及持久化。

## v0.7.6：npm预构建分发（2026-10-10）

- scripts/package-release.mjs使用既有已验收lib生成独立dist/npm/dsh-cliworker-now，根private:true保留。公开manifest补registry/repository并移除scripts/devDependencies/packageManager，消费者不构建源码；保留SDK peers、exports和原生helper。
- 检查公开运行入口及14动态helper的可达模块、.d.ts相对声明、所有发行文件无链接/私有路径；非公开tsc附带JS保持原字节但不视作第二入口。公开tarball仅manifest/README不同，运行lib280文件与原包一致；同一tarball用于npm和GitHubRelease。
- 推荐明确profile和固定短包名dsh-cliworker-now@0.7.6，避免省略必填profile或引用无lib的Git源码；首页仍仅一行可执行推荐，备用Release与web放折叠段。


## 2026-10-10：开发用 Windows 远程验收

- 新增开发入口 `test:windows:remote`：Mac 隔离 preview 构建/打包，严格 SSH 密钥及主机记录，允许列表源码快照和原构建包传送，Windows 本机冻结依赖、定向回归及原包 Host 加载，回传阶段/哈希/测试证据。Host、Client、协议和 Desktop 链接不变。
- 本机连接配置及日志在 Git 忽略的 `.test-data/windows-remote/`；Windows 专用根有归属标记，tools 内准备固定 pnpm，各 run 使用空账号、npm、Git、Harness 和系统管理配置目录。根目录/父链及源码拒绝链接，Mac 与 Windows 分别持有运行锁；取消只处理本次进程并等待确认，失败报告与清理状态不覆盖为成功。
- Client 类型检查依赖生成的远程协议声明：解包并核验 Mac 包后将其 lib 复制到源码测试目录，不在 Windows 重建；Host 加载指向原 artifact/package/lib。源码与 preview、传送包与接收包、原始 Vitest JSON 与报告分别核验哈希及阶段。
- 真实 Windows x64 验收与中断清理通过；默认不做真实模型、官方 CLI 额外启动或 Desktop 界面。流程文档见 `doc/windows-remote-testing.md`，实际边界见 `doc/tasks.md`。

## 2026-10-10：Windows 登录修复与 MiMo 元数据复用

- Windows 官方 Pi/OpenCode 固定入口采用静态解析和安装身份验证；Pi 1.1.0 仅在原生 SDK/RPC 与登录菜单契约核验后加入支持。未知启动器不通过任意 shell 兜底。
- 账号终端统一主动关闭、外层关闭及切换清理，失败保留终端身份和重试入口。Windows 使用只管理生命周期的 Job 回收实际子进程/控制台，不增加权限、文件或网络限制；退出确认以进程范围为空为准。光标采用高对比块状，终端就绪后聚焦，显示焦点提示。
- Antigravity Windows 从当前交互式用户 Credential Manager 的固定原生目标读取状态；固定 helper 只返回状态、主体哈希与安全标签，不回传凭据。SSH 会话不可访问该存储不能代替 Desktop 的登录结论。
- Antigravity macOS（OpenSpec `fix-agy-macos-keychain-account`）：agy 1.1.x 起默认把登录存入系统钥匙串 `gemini`/`antigravity`（go-keyring），`/logout` 只删除该条目，遗留的 `jetski-standalone-oauth-token` 文件不变。状态与绑定改为以参数数组调用 `/usr/bin/security find-generic-password -s gemini -a antigravity -w`，在 Host 内解码（`go-keyring-base64:`/`go-keyring-encoded:`），凭据不写日志或事件。条目不存在即未登录，不回退文件；其他失败报无法读取。绑定主体与来源标识沿用原文件来源，同一账号绑定不变。Linux 仍读文件。
- Claude 在每个操作开始前选择来源：自身本地代理可连接时使用代理，代理离线时使用原生官方登录；代理 401/403 不触发换号。以私有临时设置固定该次来源，保留用户原配置；来源快照与授权绑定核对，拒绝配置 A→B→A 竞态，执行中不切换。官方目录需同时具有原生身份（`tokenSource: claude.ai`，或 2.1.287 无该字段但有 `subscriptionType`）与模型能力；`initialize` 的能力清单本身不证明已登录。剩余额度可确认时正常显示；`get_usage` 未返回原始 limits（含 2.1.287 的 `rate_limits: null` 与失败 fallback）时仍列出模型并提示“剩余额度暂无法确认，以实际调用为准”，只有确认已用尽的窗口才阻止。插件不缓存额度。同 ID 且解析模型相同的重复条目合并，冲突重复仍拒绝；保留 `[1m]` 等原生上下文后缀。（2026-10-20 调整，避免未知额度过度门禁。）
- Kimi managed OAuth 读取自身固定 provider/令牌，将原生别名与同源认证目录取交集，要求同源额度明确剩余。原生 CLI 负责续期；额度为空、未知或耗尽时准确提示，不能推断为空即无限额。
- MiMo 仅缓存已解析的非秘密本地能力，默认 30 秒、最多 16 项。键覆盖项目、环境、自身配置/账号摘要及真实启动计划中的入口、运行时与脚本身份；凭据逐次从当前自身配置读取，远端授权及执行前后绑定仍重新核对。失败不缓存，取消释放本次资源。性能报告区分首次冷读、重复元数据与完整模型请求时间。
- 明确派遣解析排除 CLI Worker 与工具参数说明；同一 CLI 的括号别名和重复指令归一，未知或不同目标继续拒绝猜测。只处理本步已接受的人类输入，不扫描历史或工具内容。
- Windows 账号终端由固定 PowerShell 控制台承载，等待 Electron helper，避免 GUI 程序提前返回；账号专属 helper 恢复该控制台的输入句柄，仅给自身 Electron 交互 CLI 预加载，不修改 Host 或任务进程标准输入。显式 `cleanupConfirmed` 只在进程范围、输出及私有资源均清理后发出，允许终态保留期之后正常关闭。


## 2026-10-11：共享终端交互与 Windows 原生入口修复

- macOS/Windows 共用 React、xterm、FitAddon、主题、剪贴板和 Gateway 输入/生命周期，不建立第二套 Windows 终端 UI。去掉粗黑焦点外框、粘贴按钮、单独的打开网页按钮及底部快捷键提示，保留块状光标和原生说明。
- 快捷键粘贴保留浏览器默认 paste 事件；共享捕获处理只调用一次 xterm paste，经原有 onData 有界队列写入当前终端。保留 Unicode、换行和括号粘贴；退出后异步读取不能写入旧会话。选择文字后 Ctrl/Cmd+C 沿用 xterm 原生 copy；右键有选区复制、无选区粘贴。无选区 Ctrl+C 保留 CLI 中断。
- ZCode 0.16.9 Windows 原生 cmd/start 会在 & 处截断授权网址。仅该平台且 CLI help 声明能力时使用 --no-browser，保留原生 init/poll/凭据流程；共享终端识别固定原生提示后完整白名单 HTTPS URL，自动打开一次，也允许点击原生网址重新打开或选择复制。软折行按 xterm cell 定位，点击时重验当前会话/缓冲区。未知链接和 OSC 链接不自动导航；授权参数仅当前内存使用。Mac 原生 opener 保持。
- Codex 默认 PATH 不可用时，验证当前用户官方 Store 包 family/publisher/signature/status、固定资源和 PE 入口；也识别身份核验过的官方 npm 安装。显式错误路径不静默兜底。Appx 元数据查询取消须等待真实进程清理，清理失败透传，不留下脱离查询。
- Hermes 识别 Windows 官方 LocalAppData/bin 入口，原生默认 home 使用 LocalAppData/hermes；显式配置与 HERMES_HOME 优先，Mac 保留 ~/.hermes。安装缺失与未登录分别显示。用户已明确批准补全原生安装，保留原目录，不安装 WSL 或可选浏览器/计算机控制依赖。


### Hermes Windows 原生依赖复用补正（2026-10-11）

Windows 官方源码安装的 distlib 入口在隔离 `HERMES_HOME` 下无法定位安装 facts，账号终端因而提前退出。现将 Mac 已采用的“已提交依赖环境 + 账号目录隔离”路径共用于 Windows：只静态读取官方 launcher 固定 checkout，核对安装标识、facts 与 venv，再通过共享 Python 入口持有官方 generation lease；Windows 使用官方标准库锁实现。不得 bootstrap、猜测依赖代次或导入其他账号目录；旧自包含原生安装保留自身启动契约。实际 Windows 登录菜单和后续原生网页登录提示已显示，未完成账号授权；与模型调用验收分开记录。


## 2026-10-11：Windows 模型目录、检测调度与能力复用

- macOS/Windows 共用设置页和 Host 契约。设置页账号状态请求（含当前项）最多两个并发，当前 CLI 优先；切换只重排尚未启动的请求，避免把 Client 取消返回当作 Host 进程已退出。关闭/禁用会取消，快速重新启用仍能排入新的检测，过时结果不能覆盖当前状态；模型目录请求独立管理。
- Pi/OMP 的 Windows 私有目录准备使用路径权限操作，并在前后验证目录、真实路径与文件身份；macOS 保留目录句柄路径，避免 Windows 对目录 fchmod 返回 EPERM。目录成功且所属进程范围确认退出后，删除本次独有 query 目录及原生解压缓存；失败/取消/清理未确认保留现场，不改原始账号、共享续期和其他查询。
- Codex 仍采用当前原生 model/list 能力与同源账号目录、额度交集；明确区分鉴权失败与额度耗尽，不把无额度改成可用。原生模型与思考强度能读到，不代表当前账号允许执行。
- private-launch 与 Windows 账号 launcher 的真实子进程显式 windowsHide，保留原有 stdio/ConPTY 输入输出和进程范围清理。OpenCode 登录终端继续显示在插件内。
- MiMo 既有能力缓存保留；Kimi 仅对已验证 managed OAuth 来源缓存非秘密原生模型能力，Claude 仅缓存 help 支持能力。各缓存 30 秒、最多 16 项，键包含原生入口/运行时/项目/相关配置与账号材料摘要/环境；每次重读当前凭据、过期状态及远端授权，失败不缓存。显示快照和本地能力均不能替代额度或身份核验。
- Windows Antigravity 单次模型目录内部复用安全身份投影，将原生身份读取从三次减为两次；最终授权绑定仍独立重读。作用域退出即失效，不跨请求、不同 backend/config/signal 或 Mac 共用。MiMo 冷启动命令保持串行，未确认 SQLite/原生初始化可安全并发前不并行。


## 2026-10-11：ZCode 国内/海外授权选择与 Windows 后台窗口

- 最新用户要求覆盖此前“官方默认不修改”：两平台共用登录来源选择，中国智谱 BigModel / 海外 Z.AI。选择前不启动账号进程；专用 Gateway 严格验证 CLI、action 和 provider，不把授权服务商混作凭据退出来源。关闭选择重置，旧 Host 不支持新接口时明确提示更新，不回落默认海外登录。
- 仅使用 ZCode 原生 `login bigmodel` / `login zai` 与 capability help；旧版本缺少国内能力时明确要求更新，不猜参数、不模拟 Desktop 授权、不填写应用密钥。两平台统一在显式配置之后优先核验完整 managed CLI；Windows Desktop 自带旧入口仅支持海外，不能因版本字符串相同就认定协议相同。
- Windows 完整 runtime 来自已验证官方源树 `29628c9acdb81b703bbd4080c207a0e7ce5e276e`，补充精确版本 Windows x64 原生包并核验 registry integrity、包身份、PE 与逐文件哈希；账号仍保存在 ZCode 自己的原生目录，不迁移或覆盖 Desktop 登录数据。
- Windows `--no-browser` 保留原生 deviceflow init/poll/保存；共享解析器按已选 provider 绑定精确 HTTPS 域名、路径和参数集合（BigModel `bigmodel.cn/login`，Z.AI `chat.z.ai/api/oauth/authorize`），原样 URL 只在当前内存使用。自动打开一次、原生网址可点和选择复制，未新增额外按钮。
- 普通 Windows Electron 后台进程经过固定 GUI bootstrap，原生程序由 Node `windowsHide` 启动；使用独立管道原样传递字节、EOF 和背压，防止继承 fd 导致 libuv 仅 SW_HIDE、没有 CREATE_NO_WINDOW。SDK Job 继续拥有完整进程范围；原生退出事实经有界私有控制通道返回，失败/取消不伪装成功。Mac 与嵌入式 ConPTY 登录保持原路径。参考 libuv 官方 `src/win/process.c` 的 Windows hide/stdin 继承规则。


### Hermes Nous 同账号自动续期（2026-10-11）

此前只读 Nous 投影会把短期 invoke JWT 临近过期或已过期视为需要重登，使模型和任务准入先于 Hermes 原生续期被拒绝。本节替代此前“目录路径不自动刷新 OAuth”的限制：目录请求之前允许一次有界的同账号原生续期，目录本身仍不能把 HTTP 失败变成自动登录、切换来源或循环刷新。Mac 与 Windows 使用同一 Host 与固定 Python helper。

- 账号状态、目录、任务绑定及直接任务准备共用同目录进行中续期；健康访问令牌保持本地读取，不启动进程。仅 Nous 已确认主体、组织、issuer、client、官方路由与自身池有效时，调用已核验原生依赖环境中的 `refresh_nous_oauth_from_state`。不调用完整 resolver、guest 修复、外部账号导入、登录网页或生成任务；固定子进程不接受任意 Python/CLI 指令，不输出凭据。
- 复用 Hermes 自身 `hermes_yaml` 及 auth→shared 原生锁；源文件、身份与池在锁内重核。同主体较新 shared 轮换可以合并，同到期时间但不同令牌对、异主体、异 client/路由和目录重定向均拒绝。轮换回调先保存新令牌，再进行原生后续有效性检查；只更新身份已核实的 pool 认证字段，保留 ID、标签、优先级、停用、额度和冷却。原生 shared 写入后再次核验。
- 关闭最后一个查询不会立即杀死正在兑换单次刷新凭据的进程：等待有限原生事务落盘和范围退出，后续查询与登录/退出操作也等待同一生命周期。后台进程沿用 Windows 隐藏启动及原生 SDK Job，Mac 沿用宿主进程管理，不修改 Harness 核心或添加操作系统沙箱。进程清理无法确认时阻止继续使用该目录。
- 暂时网络失败保留账号并提示刷新重试；明确终止或缺少续期凭据才要求重登。重新登录后仍有有效凭据的陈旧错误标记不再单独否定登录；令牌轮换不改变任务绑定的主体摘要，退出或切换账号不会由旧快照恢复。
- 原生网络超时 4 秒、两层锁各 1 秒、Host 子进程期限 8 秒。续期过程中断电或系统强制结束仍不能保证保存尚未写入的服务器轮换；取消回归验证的是正常 Host 生命周期。实际 OAuth 续期与目录验收不等于模型生成验收，细节见任务记录。

## 2026-10-11：v0.7.7 发布与个人远程测试资料边界

- 个人 Windows 连接信息、操作手册和实机验收资料保存在 Git 忽略目录；`doc/local/` 不提交，`.test-data/` 不进入发行包。公开的远程测试文档继续只提供通用占位示例。
- 开发清单保持 `private: true`；已验收构建通过发布暂存脚本生成公共清单，npm/GitHub 共用同一预构建 tgz，文件白名单为运行库、插件 patch、README 与许可证，不向安装者交付开发脚本或个人配置。
- 新版 Windows 的 ConPTY 消息窗口可归属于 bootstrap，不能直接把窗口归属 PID 当作 conhost。仅在该精确情形动态解析真正的窗口所属进程；非公开接口缺失或返回异常时拒绝启动。保留 Host 父 PID、创建时间、系统 conhost 路径和 Job 完整退出校验，详见活动 OpenSpec 的窗口归属设计与上游出处。


## 2026-10-12：v0.7.8 开发调整，Claude 与 CC Switch

- 官方登录/退出与路由准备分开：直接使用当前原生账号目录、官方端点及 `auth login --claudeai`。自身路由字段或长期桌面进程继承的旧变量不阻塞官方操作；managed 强制来源和账号目录重定向继续拒绝。CC Switch、账号及历史文件不被插件改写。
- 模型查询、账号状态和任务均以 Claude 当前自身 settings 为准，并对选定子进程清空继承认证/provider/model 覆盖。API/代理秘密与完整映射固定在 0600 私有临时 settings 文件，原生 argv 只携带路径；范围退出确认后才清理。binding 包含模型映射与顶层 model，切换后旧选型不可继续启动。
- 支持 Fable 及原生模型元数据，保留 `[1m]` 原始执行标识。自定义网关目录 404/405 时仅展示其明确配置的模型、费用未知，并说明远端可用性未核验；成功目录仍求交，401/403、无效响应、网络异常及取消不回退。官方 API 和其他 CLI 不采用此配置候选例外。
- 两平台沿用同一 argv/原生覆盖与既有进程管理；不改 Windows ConPTY 或 Harness 核心。具体最小验收及实机边界见 `doc/tasks.md`。
- 用户指定当前开发版本 v0.7.8，未经批准不再升号或上传 GitHub。日常仅执行关联最小验收，全量验收用于获准的版本发布；README 的公开安装链接仍指向已发布 v0.7.7。


## 2026-10-12：v0.7.8 Windows 桌面 CLI 自定义安装发现

- `windows-desktop-cli-installation.ts` 从 HKCU/HKLM 的 32/64 位卸载登记及 App Paths、用户/公共开始菜单与桌面快捷方式读取安装线索，并独立检查已知默认目录及精确产品名的运行中程序映像路径（不读命令参数）。InstallLocation 为空时可用 DisplayIcon（含 ICO、带图标索引的 EXE）和 shortcut 目标定位；不执行登记命令、快捷方式或 GUI，不扫描任意磁盘。DisplayIcon 来自注册表而非桌面可见图标；快捷方式只查桌面根目录及开始菜单有限层级，有数量、输出与超时上限。
- 统一 `resolveCliExecutable` 在 Windows ZCode/OpenCode 默认入口缺失后启用 metadata 后备查找。保留显式配置、已部署 ZCode、原有默认位置和正常 PATH 优先；已选入口损坏不静默换安装。首次成功解析后按下述本机路径机制保存；恢复自动识别或自动记录文件消失时重新发现。
- ZCode 采用同安装的 `resources/glm/zcode.cjs` 与 `resources/config/provider/zcode-builtin.json`；OpenCode 采用 `resources/opencode-cli.exe` 或根目录 `opencode-cli.exe` 并核验 PE。已识别 PATH 桌面 GUI 转向同安装 CLI，显式 GUI 报错；桌面未附独立 CLI、多个不同可用安装、查询异常分别给短提示。不同安装的残留缺文件不能遮挡唯一完整安装。
- metadata 作为不可信线索，拒绝相对/device/网络路径，核验真实文件位于安装内；同一真实入口去重，多入口要求用户明确配置。状态、模型、账号终端及任务统一走 resolver；发现文件不推定登录或模型权限。
- 查询复用现有 capture 的取消、超时及进程范围退出门禁；无 Windows 查询进入 macOS/其他 CLI。版本保留 v0.7.8，最小验收、实机证据和未验证范围见 `doc/tasks.md`。


## 2026-10-12：v0.7.8 本机 CLI 路径管理

- 全部 11 个 CLI 共用 Host 路径入口，账号、模型、登录和任务均使用同一选择。首次成功自动解析后保存绝对路径；手动指定高于部署显式配置，后者高于自动记录。自动文件消失时重新发现，手动失效保留并报错。恢复自动识别清除本机选择，保留部署配置。
- 路径存于私有状态目录 `cli-executable-paths/`，按平台和机器摘要分文件；POSIX 目录 0700、文件 0600，原子替换并拒绝不安全链接/损坏记录。路径只作为单一 argv 文件值；不解析 shell、环境变量、参数或外层引号。持久 revision 阻止旧发现覆盖新手动设置。
- 每个 CLI 页在“项目默认设置”之外新增同级“高级设置”，默认折叠；展开显示“CLI 路径管理”、识别/手动来源、路径输入、刷新和恢复自动识别。设置属于本机并跨项目共用；关闭的 CLI 也可配置路径。刷新应用后立即失效旧账号与模型展示，再获取状态。
- 活动/排队任务或账号终端期间拒绝更改该 CLI 路径；关闭/切换界面取消请求，迟到读取不能覆盖输入，清理未确认则阻塞。状态不可用不是登录失败的替代判断；本次不验证真实模型或账号授权。


## 2026-10-12：v0.7.8 设置自动保存与高级区域精简

- 项目默认模型/思考强度仅在用户明确选择后自动保存；初次读取及刷新目录不写偏好。组合按原生目录核验，连续选择串行采用最新值，关闭/切 CLI/账号变化取消旧请求与待保存值，旧响应不覆盖新页面；保存失败保留选择并提示，同值重选可重试。移除“保存默认值”按钮。
- 高级设置继续独立、默认折叠；大标题为静态文字，右侧小箭头才有按钮效果，展开/收起沿用 grid/opacity 过渡且支持减少动态效果。CLI 路径管理使用与模型/思考强度一致的普通标签样式，删除重复的可见“CLI 路径”和底部来源文字，保留可访问名称、说明及两个操作按钮。
- 不改 Host 配置与路径存储协议，版本仍为 v0.7.8；仅 Client 相关测试、类型检查、preview 和两平台必要界面核验，无真实登录/模型调用与全量验收。
- 后续截图细化：去掉思考强度末行底边，与高级设置之间只保留一条分区线；模型与思考强度菜单跟随选择框实际宽度，左右对齐。

- 设置页排版统一为公共变量：分区标题 14/22/500，普通标签 14/22/400，说明 12/18；内容行上下 16px、标题行后 8px、文字组内 4px。取消相邻分区与末行留白叠加，高级路径内容采用与模型行一致的留白。独立规范见 [设置页统一设计规范](settings-ui-design.md)，AGENTS 与 README 均加入入口，后续扩展必须复用并同步维护。

## 2026-10-12：v0.7.8 修复 Electron 中 Windows OpenCode 识别回归

- v0.7.7（`021441b`）正常 PATH/npm 解析不检查桌面归档；v0.7.8 的 `1b12366` 新增桌面身份检查后，Electron 对不存在的 `resources/app.asar` 抛无 code 的 `Invalid package`，导致正确 npm CLI 被误报不可用。真实 Host 已捕获此异常，不能归因于用户安装或账号。
- Windows 安装 helper 局部懒加载 Electron 内置 `original-fs`，普通 Node 沿用 `node:fs`；普通文件、权限、真实路径和 PE 检查使用相同物理 FS。不存在的可选归档正常视作不存在，真实归档按磁盘文件处理。保留显式 GUI 拒绝、损坏/权限失败、同安装独立 CLI 核验与路径优先级。
- 不改变全局 `process.noAsar`，不吞异常字符串、不回退另一 CLI，不新增依赖或存储迁移。最小专项及 Windows Desktop 自动路径验收见 `doc/tasks.md`；版本保持 v0.7.8。


## 2026-10-13：v0.7.8 Windows 设置后台终端弹窗修复

- 首次打开设置会查询全部启用 CLI 的账号，再读当前 CLI 目录；模型／思考强度自动保存经授权目录校验，包含前后账号绑定检查。这些必要查询保留，不以省略校验消除窗口。
- 实机确认 Codex npm 0.162.1 的 `codex.js` 内部使用 `spawn(binaryPath, argv, { stdio: "inherit", env })`，无隐藏选项。外层 Electron GUI 启动正确，但内部原生子进程仍触发 Windows Terminal。后台专用 `windows-codex-launch.ts` 对已核验脚本指纹生成同安装原生描述符，进入既有 GUI 引导器／管道／私有退出回执，保留完整 Job 范围清理。
- 核对主包声明、可选平台 npm 别名、版本／os／cpu、真实包根及原生 PE。平台依赖真正缺失时才按原脚本回退本包 vendor；已有损坏平台包不得换安装。沿用 npm/Bun/pnpm/Vite+ 管理器环境增量与删除标记，不回填 SDK 已清理的父环境、不猜旧版 PATH 注入。
- 已存储 JS/shim 路径、解析优先级、macOS 和显式账号终端不变；不修改第三方 CLI 安装或父进程全局模块。未核验源码指纹继续原有启动方式，不能宣称任意第三方脚本内部派生均已验证。本轮确认的是当前安装的 0.162.1 脚本；后续新脚本按其真实语义扩展。
- Antigravity 热读原生入口及账号 PowerShell 已进入隐藏层；随后冷开仍复现 AGY 自身派生两层与可见窗口。本机 `auto_updater.go` 日志记录的更新进程 PID 28472 与实际父链一致，确认后台自动更新为该窗口来源。官方 [自动更新说明](https://antigravity.google/docs/cli/troubleshooting/) 给出 15 分钟 TTL 与 `AGY_CLI_DISABLE_AUTO_UPDATE=true`。Windows 当前／旧模型读取和任务仅合并本次子进程禁自动更新变量；helper 独立于交互共用的 firstPartyEnvironment，不改用户更新标记、系统环境或账号终端。具体实机核对以 doc/tasks.md 为准。

## 2026-10-13：v0.7.8 发布收尾与模型目录生命周期

- 用户授权本次 v0.7.8 全量验收及 GitHub、npm、市场提交；没有增加后续版本号。隔离验证确认，无版本包名只在首次安装得到当前版本，已安装的固定或兼容范围依赖可能继续留在旧版；文档统一使用 `dsh plugin --profile desktop add dsh-cliworker-now@latest`。它在执行命令时跟随 npm latest 标签，宿主启动不会自动升级。
- Claude 的 CC Switch 本机代理可能成功返回原始空数组：辅助模型目录与角色映射是两种来源。仅在本机代理、明确原生配置和原始空目录同时成立时保留配置候选；不是把过滤后为空、认证拒绝、网络故障或普通远端空目录当作成功。角色 ID（含上下文后缀）保持原样，角色名称仅影响展示，远端可用性仍以实际调用为准。
- Codex 自身 OAuth 目录使用原生 app-server 初始化握手报告的 CLI 版本，替代旧的固定查询版本；当前账号远端目录可补充原生缓存遗漏的型号，但必须同时具有真实思考强度元数据。明确隐藏、禁用或无权限的记录不得加入；不从营销名称猜测执行 ID、参数或权限。
- Host 新增模型目录缓存，按机器、项目和 CLI 隔离，持久化目录为 `settings-catalogs/`。每次 Host 启动后首次打开某 CLI 页重新识别；同次运行在账号绑定一致时复用，手动刷新、账号或路径变更使缓存失效。重识别内容相同不重写，变化才原子更新；只保存可选模型和强度，仍有效的用户默认值保留，失效时提示重新选择，不自动改写默认偏好。
- 缓存只加速设置展示，派遣与保存仍经过新鲜的账号和目录授权。缓存无秘密，文件内容受 schema、大小、CLI 身份及一向账号摘要约束，拒绝目录别名、链接和读取竞态；失败、取消、身份改变及旧请求不能发布新缓存，也不能以旧磁盘目录掩盖失败。POSIX 目录 0700、文件 0600，Windows 沿用自身文件权限。
- 全量 Windows 验收额外发现隐藏启动控制管道保留了无读取用途的句柄，以及 Node SQLite 超长路径限制：前者只保留写入方向并继续由 SDK Job 管理进程范围，后者为 Windows 快照和请求目录使用扩展长度路径。Hermes、OpenCode、Pi 原生私有文件读取核对路径与已打开句柄身份，拒绝 Windows 下仅依赖 O_NOFOLLOW 时漏掉的链接。
- 具体自动测试、Desktop 观察、分发哈希及未验收账号/模型边界以本次任务记录为准。真实账号登录、路由模型生成不因目录可见或模拟回归通过而被表述为已完成。

## 2026-10-13 统一外部分发名称

GitHub 仓库、npm 包、Release 标题及外部目录统一使用 `dsh-cliworker-now`。用户明确要求 DSH 内的插件界面保持原名，因此页签、侧栏、设置弹窗、按钮提示及 Host 文案继续使用原有 CLI Worker / CLI Worker Now。准备中的界面改名已撤回，没有覆盖正式 Desktop。

Cordis patch id `cliworker-now`、Gateway `cliworker`、工具 `cliworker_*`、私有目录与既有会话/账号全部保持。GitHub 改名保留仓库 ID 和旧地址重定向；不重建旧名仓库。当前源码仍为 0.7.8，已提交 npm 的冻结包不覆盖；未来打包的 repository、bugs 与 homepage 改为新地址。dshfind 主键迁移与下载量探测须由有维护权限的一方执行，提交 PR 不等于公开页面已更新。


## 2026-10-13 GitHub 源码安装

新增 `github:SuperWheel/dsh-cliworker-now` 安装入口，开发清单以 `prepack` 复用完整构建；Git 源码没有 lib 时由原生安装器在获准后安装开发依赖并构建。普通 `pnpm install` 不因此重建 Desktop 链接；本地 `pnpm pack` 会触发构建，必须在隔离副本或确认无活动任务后执行。

源码安装需要 Node.js >=22.19，且 PATH 中可直接调用项目指定的 pnpm 11.25.0；Harness 内置安装器不保证为嵌套构建提供 pnpm 命令。安装器继续管理构建授权，按当次错误中完整来源标识向目标 profile 的 `allowBuilds` 追加规则；插件不修改用户规则、不放开所有脚本。不带引用解析默认分支，固定完整 commit 可复现来源，已有锁文件可能保留旧提交。Git 源安装与 npm/Release 冻结预构建包分开；公开打包清单仍删除 scripts，本次保持 0.7.8 和已发布资产不变。

## 2026-10-15：v0.7.9 AGY 本轮结果与空回复修复

- 对应 GitHub #1/#2。本轮开发版本定位 v0.7.9，正式提交 GitHub 前不再升号；日常只执行关联最小验收，全量验收在获准的正式 GitHub 提交之前执行。已发布 v0.7.8 的下载地址和历史记录不改为不存在的版本。
- AGY result 是上游汇总。parser 独立收集本次进程实际收到的回复与步骤状态；续聊会话一致、退出码为零、观察到的步骤均 DONE、至少有非空 DONE 回复、没有本轮错误/未知证据且清理确认后，ERROR 汇总进入 uncertain（结果待核实）。不能据此宣称成功或证明 EOF 来自历史；单独工具 DONE、部分文本、无正文、真实错误、异常退出、取消/超时和清理失败仍按实际失败/中断边界收尾。
- 本轮回复与错误独立保留和回传；错误汇总只作过程证据，不能覆盖本轮 streamed 正文。新轮清空旧 lastResult；历史记录只在读取时折叠，不重写原始日志或重跑任务。宿主 jobs 缺少 uncertain 枚举，因此外层保持 failed，但 detail 与 JSON 状态、response/error 和 guidance 明确要求先核查实际产物、不要自动重试。
- Client 将 uncertain 归入异常筛选，显示警示色与“结果待核实”；存储恢复、后续续聊和本轮时长支持新终态，保持原有账号、权限和进程生命周期边界。
- 已结束且正文为空/纯空白的 assistant 不再生成聊天 article，原步骤仍留在可展开过程内，保留独立用量、时间及报告耗时。活动流式、正文、工具与错误保持；末条可见回复功能条跳过隐藏空步骤，仍遵守历史页及后续 user/tool 边界。
- AGY 步骤耗时按 step_index 的最新有效报告覆盖，result 耗时标注为 CLI 会话累计；步骤与累计用量不相加，本轮时长继续来自本地 user/status 时间。缺少指标不猜测。最小验收和未执行边界见本日 doc/tasks.md；本轮不更新正式 Desktop、不调用真实模型、不上传 GitHub。

## 2026-10-15：v0.7.9 轮后自动续聊、缓存选型与公开过程

- 用户选择运行中提交后在当前轮结束时自动发送。Host 私有 outbox 按 Worker 保存，关闭侧栏不丢失；最多 20 条，提交 UUID 去重，按 FIFO 复用正常 launch/runtime。只有 completed 且进程范围退出确认后继续；失败、uncertain、停止、重启暂停，用户可取消或明确继续。真正取得任务进程 handle 前保留待发送项，模型/账号/权限验证失败仍能恢复文本。
- 同父会话、项目、原生会话和账号绑定边界不变。待发授权查询与 runtime 同目录锁等待期间均可停止；停止等查询或任务清理确认。任务启动前同步再核父会话权限、项目与账号终端，阻止等待期间切入规划/只读后自动启动。新持久文件使用私有权限和有界 FD 读取，拒绝链接及身份变化；旧 Worker 无队列不需迁移。
- 输入保持可编辑，已接受队列与草稿分开，晚到响应不清除后来输入。按用户最终要求，右下角只有一个动作按钮：运行中无正文为停止，有正文切换为发送；停止中按钮禁用。队列显示待发/准备/暂停状态，准备元数据阶段可取消，进入 runtime 后使用停止。
- 首次派遣保存账号已核验的目录，Worker 以本机、项目、CLI 和原账号绑定读取内存/磁盘展示；菜单挂载预取并复用，选择只校验保存目录并保存精确偏好。真实发送重新核验账号、路由、模型和强度，缓存不代表调用授权；设置页刷新仍按既有规则。换模型保留原生会话 ID，未发现主动清空上下文路径，不显示无证据的上下文丢失弹窗；原生后台跨模型语义未做真实调用验收。
- Codex、Claude Code、Pi、OMP、Grok 的明确公开摘要/思考以及 Grok 计划进入过程区；独立 reasoning 快照、白名单字段、实时节流、结束保留，最终正文与成功判定独立。其他 CLI 没有可据以实现的公开字段时维持现状，详见 [公开过程支持范围](public-process.md)。
- 本次保持 v0.7.9，只做关联最小验收、隔离预览与实际组件渲染；没有更新 Desktop、真实模型调用、Windows 实机验收、全量验收或 GitHub 提交。


## 2026-10-15：v0.7.9 运行中发送方式与待发送折叠

- 各 CLI 高级设置使用原生下拉「引导、插队、排队」，按项目与 CLI 独立保存到私有 `.running-message.json`。读取不启动 CLI；Pi/OMP 默认引导，其他 CLI 默认排队且引导禁用，不覆盖模型、账号或启用设置。
- 运行中发送由 Host 读取当前方式分流。引导通过 Pi/OMP 本轮私有控制邮箱交给原生 `steer`，只接受匹配成功回执，保持 runId/原生会话；成功回执先于后续停止判定。接收不等于模型执行。明确未接收可使用新 attempt 重试，超时或未知结果不自动重投，切换方式也不能重复发送同一请求。
- 插队先持久保留文本，再停止当前轮并等待进程范围清理，复用原授权与续聊入口优先发送；队列其他文本、相对顺序及原先暂停状态保留。停止代次、单 Worker 操作互斥、请求标识和取消信号防止停止/取消后重新派发；权限、账号变化或清理不确定拒绝执行。
- 待发送卡片同时提供插队和取消。标题下为主题分隔线，右侧原生箭头折叠列表，数量及继续发送保留。列表使用 220ms 高度、180ms 透明度，箭头 220ms；减少动态效果时禁用过渡，收起内容设置 inert。按 Worker 保留当前侧栏中的折叠状态，不影响 Host 队列。
- 输入框继续只保留一个动作按钮，运行中有草稿时发送、无草稿时停止。无明确原生能力的 CLI 不模拟引导。原生证据与真实验证边界见 `doc/running-message-protocol.md`。

## 2026-10-15：v0.7.9 正常停止、即时提交与待发送外观

- 正常用户停止及插队停止保留 `interrupted` 终态，以 `interruptionReason: user` 区分故障；只有进程清理确认后才记录正常停止，不将正常取消原因写入错误。超时、先发生的真实失败、账号异常及清理未确认仍按原限制处理。旧数据仅识别已知精确正常停止原因。
- 已有原生会话 ID 的 Worker 停止后沿原会话续聊；正常停止发生在会话建立前时允许同 Worker 重新建立原生会话，并明确提示，不猜测 ID、不声称延续不存在的上下文。其他历史账号或会话异常不因此放行。
- 发送使用按 Worker 隔离的本地待确认状态，点击即清空当次草稿、显示待确认用户消息或待发送卡片；确认后与 Host 记录一对一合并。失败保留文本，不覆盖用户后来输入；同一 Worker 准备阶段的后续发送保持串行，Host 按 Worker 登记准备控制器和清理完成信号，停止等待准备和已准入运行退出；准备期间禁止冲突派遣、改选及账号操作。界面仍只有一个发送/停止动作按钮。
- 待发送外框与输入框共用 `radius-panel`、`specific-input-major`、`elevation-soft` 和 `border-l2` 描边；外框无内边距，标题自带内边距及贯穿左右的下分隔线，条目列表左右内缩 10px，条目内操作垂直居中。沿用 220ms 高度、180ms 透明度及减少动效规则。
- 本次继续使用 v0.7.9，验收限于关联回归、类型检查、preview 和实际 macOS Desktop；全量验收、其他平台与 GitHub 发布不在本次执行范围。


### v0.7.9 补充：插队即时展示与待发送退场（2026-10-15）

- 队列卡片插队接入独立本地提交状态，点击即展示用户消息并移出卡片，不等待 Host 停止、选型或准入，不占用全局 busy。后台停止期间可继续编辑；后续同 Worker 提交等待前一条实际准入，仍保持单发送/停止按钮。
- 用户消息不显示例行“正在发送…”或“已提交，等待同步…”文字；明确失败和传输不确定保留真实说明。受理回执只表示队列已提升，不表示原生 CLI 已执行。
- Host 在队列准入的用户事件中写可选 queuedFollowupId，存储和时间线透传；插队 RPC 返回 queuedId 与 revision。Client 按精确 ID、事件水位及回执 revision 对账，停止阶段临时 paused 不使卡片闪回，同文连续消息不互相确认。实际准备失败恢复原卡片；丢回执后可由精确事件补确认水位，历史截断则保留核对/停止出口，不自动重发。
- 已确认消息的气泡与卡片隐藏状态分开管理，二次授权失败仍能恢复同 ID 卡片。关闭侧栏不取消持久插队；显式停止仍要求 Host 完成实际清理。
- 独立 FollowupQueuePresence 以稳定 ID 保留退场节点，行与最后整个区域使用 220ms 高度、180ms 透明度过渡，含区域间距同步归零；退出内容 inert。快速失败可取消退场并展开同一节点，切换 Worker 清理旧项，减少动态效果立即移除。继续沿用输入框的圆角、底色和阴影。


### v0.7.9 补充：连续插队以后一次为准（2026-10-15）

- 插队使用独立即时受理入口，以稳定消息 ID、当前侧栏实例 ID 和点击序号接收。点击后立即保留用户气泡、退出待发送卡片；本地排队尚未回执也可转为插队，其晚到回执不得恢复卡片或草稿。单发送/停止按钮和既有退场动效继续使用。
- Host 持久保存提交状态，再在后台串行停止、核验、准备及执行。同一 Worker 连续插队时，尚未发起原生进程的旧请求标记为已被后续插队取消；已经发起原生进程的旧请求正常停止，待进程范围清理确认后执行最新请求。同一侧栏按点击序号防止乱序请求覆盖新请求，不拼接已取消文本，其他普通排队消息保留相对顺序。
- 提交事件与原生用户事件通过精确消息 ID 合并；持久气泡展示取消或失败状态。受理不等于原生运行，任务准入与实际启动分别记录。取消、停止、准备失败及结果待核实均保留消息在对话中，本节取代此前对应消息恢复到待发送卡片的规则。
- 重开侧栏可读取持久提交状态；Host 重启保留历史且不自动重放未完成插队。关侧栏不撤销已受理消息；显式停止只取消该次停止之前已接收的请求；同一侧栏后点消息先展示，RPC 等该次停止回执后发出，晚到回执不能撤销后一次点击。权限、账号、模型和进程清理检查继续生效，未确认清理时不放行下一条。


### v0.7.10：全部 CLI 原生通信协议（2026-10-16）

- 新 Worker 持久保存明确 transport：Codex app-server、Claude/AGY 双向 stream-json、Kimi/Grok ACP、ZCode app-server、MiMo/OpenCode HTTP+SSE、Hermes Runs API；Pi/OMP 沿用原生 RPC。缺少 transport 的历史 Worker 保留旧执行器恢复；未知标记拒绝启动。Hermes API 不接管已有 CLI 会话。
- 原有账号准备、模型/强度、项目写锁及会话互斥继续由 Host 执行。native bridge 在 private launcher/宿主受管范围内分派独立 runner，Client 仍仅经 Harness Gateway。各协议独立处理公开事件、反向请求、选型回读与终态，额外权限无人处理时明确拒绝。
- 每轮独占原生进程或认证回环服务，私有描述文件 0600/目录 0700。session/event/native/result 帧按行与累计输入/输出限额校验，原生指标不直接当会话正文；本轮终态、工具状态与退出分别核实，保留部分回复及 AGY 汇总冲突的 uncertain 语义。
- Host 停止先通过本轮私有停止邮箱尝试原生 interrupt/cancel/abort/stop，再终止并确认整个执行范围，回执不能替代进程退出。Pi/OMP 的引导与停止命名空间隔离；新协议不因原生支持就自动开放尚未实现的引导或审批界面。
- Hermes 使用独立 API-only gateway home 保留自身 API session 数据，每轮认证材料和其他平台配置隔离，不导入用户定时任务和其他消息平台，不改原账号来源；原生空定时线程随 gateway 退出。MiMo 0.1.15 的 /doc 漏列子路由按实际安装版证据限定兼容，不套用 SDK/main 的假设。
- 新 Kimi ACP 可在实际模式目录包含 plan 且设置回执通过时执行只读任务；历史 Kimi 执行通路和 Hermes 继续拒绝只读派遣。
- 详见 doc/native-protocols.md；OpenSpec 为 migrate-native-cli-protocols。真实模型、两平台及 Desktop 证据分别记录，未验收不归档隐藏。


## 2026-10-16：v0.7.10 提交占用、队列代际与原生引导

- Client 点击时同步分配消息 ID 和序号、固定 direct/running 归属、发送方式与 bubble/queue 展示，并登记会话占用；Host 的 `submitMessage` 在查询父会话或准备模型前登记 reservation。`selectedBusy` 覆盖受理、准备、队首启动、运行、插队与清理，旧状态无法把第二条消息误分类为空闲续聊。
- 所有消息只按稳定 ID 对账，相同正文的两次点击保持两条。直发与队列启动写入对应用户事件标识；普通排队准备期间仍是卡片，只有原生进程开始启动才转换成用户消息。重连不盲目重发，RPC 重复调用查询同一回执，设置变化不改已提交模式。
- 存在待发送卡片（包括 paused）时禁止修改该 Worker 模型与强度，明确要求先发送或取消；不以重写 Worker.preference 改变已经排好的内容。发送方式仍可修改并只影响后续提交。
- 队列使用私有 generation 隔离停止边界。停止同步撤销此前未执行受理并暂停旧队列，清理确认后明确提交的新一轮和新增 pending 正常运行，旧 paused 条目保持暂停；迟到旧轮终态不能暂停新代际。连续插队用实例和序号选定最新未启动请求，已经尝试 spawn 的必须先确认进程范围退出。
- 引导按 CLI 与 Worker transport 双重核对。Codex `turn/steer`、Hermes Runs steer 与原 Pi/OMP RPC 接通当前运行；其他 CLI 的独立轮次/队列输入不包装为引导。私有控制请求绑定 run、单条 ID 和正文，明确接收、拒绝与未知分开，未知不自动重投或改为排队，停止控制与引导控制分开。详见 `running-message-protocol.md` 的官方依据矩阵。
- 经用户明确选择，旧项目 policy 1 发送偏好在启动时一次性按能力设为默认值；policy 2 的后续手动选项继续保存。只迁移经过路径/文件身份校验的对应设置，不更改模型、强度、账号、历史或 Worker transport。旧 Worker 未接通引导时明确投影为排队并给原因。
- 用户正文气泡独立 fit-content/max-width，时间、复制及实际失败恢复独立成行；取消、被取代和待发常规提示及其占位全部移除。一个输入动作按钮：有正文发送，无正文且可停止时停止，正在清理不重复停止；保留正文空格和换行、卡片退出与补位及 reduced-motion。

- 用户进一步明确引导与排队分开：新增独立 `steerMessage` Gateway / Client / Host 方法，直接面向 expectedRunId，不经过普通提交链、队首、paused/generation 或清理后自动续发。普通排队规则只适用于排队；未就绪/已结束的引导保留输入，已投递未知的引导核对原接收状态，不改成下一轮。

## 2026-10-16：开发版本归属调整

- 用户明确将上述原生协议迁移、排队与独立引导修改归入 v0.7.10；下一次正式提交前的修复和调整继续属于 v0.7.10，不自动增加版本号。
- 包清单、原生握手标识、README 和开发流程约束同步；已发布 v0.7.9 的链接与历史实际构建/验收证据保留。GitHub 提交、推送及发布继续需要用户明确授权。

## 2026-10-16：v0.7.10 原生消息归并、过程与上下文

- HTTP/SSE 以原生 messageID/partID 归并增量并核对快照，Hermes/ACP/ZCode 在明确的工具边界分段；结果帧标记 run/response 范围，防止最后一条回复误删重复前缀或原始空白。旧 HTTP 历史只在一个原生消息/文本 part 的完整证据下只读恢复，记录不改写。
- 原生工具身份、输入、输出、命令和明确父调用经 Host 白名单保存为 PublicToolCall，历史兼容同样限于已核验结构。没有原生调用 ID 不用步骤编号代替，没有父调用字段不从调度依赖推断树。Client 只通过 Gateway 收到该投影，公开工具文本按惰性 Markdown/JSON/终端结果展示。
- 过程薄适配复用 Harness 公开 primitives 和只读 ui-chat 工作详情配置，按真实事件顺序在思考、工具、正文之间切分；完整内部聊天组件不公开导出，不伪造 session 或借用父对话数据。ContextMeter 同样按原生布局和交互适配，未知分类保留未知。
- TelemetryReader 独立当前窗口、累计用量和绑定模型容量，安全透传来源、估算与分类。AGY 解码原生三类估算；Codex 用 last.totalTokens；HTTP 用最新 input+cache；ACP、ZCode 和 Pi/OMP 接原生窗口字段。Hermes 当前 Runs API 未提供窗口与分类；Claude 只接受原生可选 summary，不增加 full 计数或生成请求。逐 CLI 证据与边界见 native-inspection.md，实施和验收对应 OpenSpec fix-native-message-streaming-and-inspection。

## 2026-10-16：v0.8.1 原生子会话及受控工具桥

本节及其“完整原生输入修正”记录此前局部接入阶段；其中 content 嵌入、旧输入兼容和内部组件适配已由下方“接手纠偏”替代，不能作为当前完整侧栏界面交付依据。

- 用户明确迁移到 v0.8.1，迁移前 v0.7.10 的真实工作树与 lib 已独立备份，逐项校验与恢复说明见 `tasks.md`；不覆盖用户运行目录。旧协议、CLI conversation ID、账号与模型选型保持独立，不因 Harness 会话绑定而更换。
- 每个 Worker 对应真实的直接子 Agent：`origin: subagent`、明确 parentSessionId，使用官方 continuable Activation/Session 生命周期。普通会话列表沿用宿主排除子 Agent 的规则，CLI Worker 统一管理打开；后台保留父子目录关系，以便恢复与定位。
- Host 用虚拟 provider 与 `llm/stream` 接管该内部子会话，实际生成只走原有 Worker 准入和 CLI runner。创建和重开只投影既有运行；官方 RPC identity 与 Worker receipt 去重。公开工具声明和结果使用原生持久化事件，但不把 tool-call yield 给 DSH AgentLoop，避免显示时再执行工具。JSONL 冷恢复须通过真实宿主测试。
- Client 使用 SessionReference、SessionProvider 与 `conversation.content` factory；这是原生对话组件，不复制 Codingns4DSH 的页面。缺少公开细粒度接点时使用仅在插件容器内、限定 rc.2 的 DOM 能力 guard 和原生 Tooltip；不修改 Harness 核心或全局 CSS。
- 既有 queue、独立 steer 与等待清理的 Stop 保留原执行链。当前原生调度没有完全相同的暂停代际和回执契约，因此相应入口明确禁用，旧控制保留；未知能力不能因 UI 看起来可点击就放行。原生 ContextMeter 尚未映射 CLI 实测统计时显示未知并禁用，其余真实统计在 Worker 详情查看。
- run 级回环工具桥只向选定 CLI 子进程注入临时连接，令牌不进 argv、公开 DTO 或用户账号配置。工具 schema 与执行均来自真实子 Agent 的公开 tools 运行时，权限、规划与用户审批链继续有效。显式禁止桥内再次派遣 Worker 或 Agent；技能按需读取并限制资源目录。
- 主生成、恢复与被桥接工具的额外模型请求均受路由守卫；未适配的辅助生成明确拒绝，不调用 DSH 模型 API。该约束只用于 CLI Worker 子会话，不更改普通主对话的配置。CLI 的实际工具准入、订阅及平台证据逐项记录，详见 `native-conversation-ui.md` 与 `native-harness-tools.md`。
- 历史记录不批量改写：首次挂接投影当前运行，之后新轮连续进入原生对话。此前更早记录保留原 WorkerStorage 和独立只读入口；不为了补齐旧工具生命周期而伪造原生调用。
- 完整宿主核验确认 rc.2 原生子会话输入没有公开的发送前准入接点，detached 连发可在 Host 后置拒绝后丢稿，因此本次关闭普通原生发送。公开 `conversation.composer` chain 显示原因并保留原生待审批/提问；Worker 输入框作为唯一发送入口，继续原子预占、排队与独立引导规则，不猴补宿主提交方法。


### v0.8.1 完整原生输入修正

用户在正式 Desktop 指出仅替换消息区、保留旧 Worker form/queue 未达到完整嵌入要求。此前该局部预览不再作为完整界面交付；版本继续为 v0.8.1。当前通过公开 StoredEntry 复用实际 InputBar、QueueDock，并对内部 keyboard 合同做固定 rc.2 运行检查；递归 alias 保留 renderer 的子槽位授权及原有组件、CSS、store、locale、select，不修改全局提交服务或宿主源码。原生组件动作直接接既有 Worker 同步准入与清理屏障，原生 Session.prompt 旁路继续拒绝。原生模式移除旧 form、旧队列和例行说明。

原生 continuable 子 Agent 自带独立 Stop/Send，保留官方行为；不为沿用旧单按钮要求伪造根会话。旧暂停队列有明确恢复操作；队列编辑缺少接口时禁用说明，插队箭头准确说明停止旧轮。真实 CLI contextPressure/contextBreakdown 分项完整才映射原生菜单。普通 DSH 会话透传原组件；从其他 DSH 子 Agent 导航打开 CLI 子会话时输入只读，继续从 CLI Worker 管理。

正式验收还发现空结算 turn、主动停止被投影为失败以及未结束工具导致 V4 冷恢复失败。分别使用公开 runMaintenance 防空唤醒、清理完成后的 user cancel、ToolCallRecovery 未知结果结算修复。旧无效投影仅在下一次明确新发且无活动 Agent、明确 not-resumable 时 CAS 轮换内部显示绑定，留存退役引用；Worker/CLI 会话与日志不改写。验证与失败报告见 doc/tasks.md。


### v0.8.1 接手纠偏：右侧栏完整原生会话（2026-10-16）

本节是当前架构约定，替代此前局部 content、内部 keyboard/Inbox 代理和只读模型按钮方案。中途曾改用 `uiWorkspace.openSession` 打开完整主页面；该方案虽然复用了主 frame，但不符合用户要求的右侧 CLI Worker 栏位置，已撤回。相关历史过程与证据保留在实施记录，不能用于证明当前侧栏已验收。

点击 Worker 后，Client 先通过 Gateway 刷新 Host 绑定，再用真实 `SessionReference` 核对直接子会话身份与读取状态，在侧栏自己的 `SessionProvider` 下渲染。原生 `conversation.content` 使用公开 Factory 的 embedded 布局；消息、过程、工具详情、InputBar、QueueDock、菜单、统计及弹层继续使用原组件。映射保留原 store/inject/locale/select 和 renderer 所有权，不复制内部组件，不借其他注册项的 renderSlot 闭包，不代理 keyboard，也不创建假的 useSession/Inbox。公开数据合同只适配 CLI 设置与统计，其他原生投影原样传递。

按最新截图要求，顶部恢复原 CLI Worker 的返回、Worker 名称/标题与任务操作；删除先前添加的原生父面包屑、对话/轨迹页签、标准模式与页头按钮。原生正文使用独立公开视图 seat 固定为聊天，避免继承主页面轨迹选择；窗口和全局侧栏控制仍由外层宿主管理。打开子会话不切换主页面。切换 Worker、关闭栏或插件卸载释放读取引用，不停止已运行任务。子 Agent 始终绑定所属主对话并排除在普通会话列表外；旧历史和旧队列保留只读管理入口，不自动迁入新 Inbox 或执行。

模型/强度复用实际原生 ModelSelect，目录及选择回调接真实 CLI 选型；权限/规划复用 PermissionSelect、PlanChip，以当前 CLI 支持范围和 Host 保存结果为准；不支持规划的 CLI 子会话不渲染 PlanChip，原因只在“+”菜单的“计划”行说明。运行、准入、停止清理、任何原生 next-turn/next-step 待发消息及兼容队列（含 paused）均锁定模型与权限设置；不因切换 UI 绕过 Host 原有互斥、账号和能力检查。精确 parent/child/Worker 身份不匹配或数据未就绪时禁用，普通主对话保持原生控件及原数据。

ContextMeter 和 StatsPills 使用真实原生组件与菜单。InputBar 的公开注册结构仍保留实际 keyboard、注入和子槽，仅将 tokenUsage/contextPressure/contextBreakdown 映射为匹配 Worker 的可核查遥测；不拿显示投影估算冒充 CLI 上下文，不累加重复快照，不以累计用量代替窗口占用，缺失分类不补零。数据不足时遵循原生组件的隐藏规则，不另画统计区。附件/分支尚未接通时原位说明；附件限制不禁用仍可用的原生指令菜单。

Host 在原生 Inbox 领取消息后使用现有 launch、CLI Agent/模型与 runner；原生提交身份贯穿 Runtime 准备，防止该 run 被再次注入投影。每条请求的 RPC 身份、正文摘要、批次身份和接收状态持久保存在 nativeInputs；合批后单条重试在冷恢复后仍去重，重复项不阻断后续不同输入。状态不明时禁止自动重发，已领取消息按原 ID 放回真实队列供编辑或移除。停止等待工具和进程清理。

native next-step 按 CLI transport 的实际能力处理。当前运行原生 steer 已接通且就绪时面向同一 run 发送，以原生接收回执为准；接收不等于模型执行，拒绝或结果未知不自动降级为新一轮。未接通该通路时，当前完整 CLI run 视为执行步，消息在其结束和清理后沿同 CLI 会话接续，不停止重启，也不把显示行分段冒充实时注入。当前接通 Codex app-server、Hermes HTTP、Pi RPC 和 OMP RPC 的原生引导；已通过模拟协议与真实 DSH Inbox 回归，未将其视作所有 CLI 的真实账号或模型验收。

工具目录动态继承真实 child 作用域已配置的 MCP 与普通工具，新列表按当前目录生成，调用及旧回执重放重新核验；执行进入 tools.execute 原生权限与审批链。技能正文、资源及依赖撤销同样阻止缓存回执。递归派遣和未接通 DSH 模型辅助继续拒绝，公开文本顺序和错误标记保留；图像附件等没有忠实转换时明确 unsupported。原生 registry/MCP 模拟回归与真实 CLI 验收分别记录，旧协议和账号证据不替代本轮交互验收。

侧栏观察 ready 及后续 openState/openError，读取失败保留真实错误和显式“修复显示会话”入口，点击后才进行既有精确身份修复。错误或迟到回执不使父会话替代子会话，也不触发主页面导航或重跑任务。实际关联测试、preview、浏览器、Desktop、平台及真实模型边界见 doc/tasks.md 和活动 OpenSpec；最终侧栏和 steer 尚待的验收必须继续保留。

### v0.8.1 真实 AGY 统计与权限控件纠偏

PermissionSelect 的图标与窄栏布局由原生 preset 决定；CLI `plan/accept-edits` 仅在公开控件数据中映射为 `read-only/workspace-write`，保存时转回 CLI 模式。直接传 CLI 值会使原生组件按自定义 preset 处理，遗漏原生图标；修复不添加按钮、图标或全权限选项。

AGY 原生用量中的 input 是未缓存输入，reported total 为 input + output，不含 cacheRead。StatsPills 按互不重叠的输入、输出、缓存读取、缓存写入汇总，因此原生显示总量与 CLI reported total 可以不同；AGY 协议没有缓存写入类别，适配为协议确定的零，其余未知值不能补零。窗口占用仍来自该 CLI 会话最近请求的本地上下文估算及原生容量，不使用累计用量或父会话数据。

不同 JavaScript realm 的字节数组构造器可能不同，`instanceof Uint8Array` 会拒绝有效数据；读取使用 Node 公共 `util.types.isUint8Array` 并保留真实 SQLite 跨 realm 回归。实际 Desktop 诊断显示其当前字节数组判断成功，29704/256000 及分类已完整解码，随后读取前后文件戳变化导致结果被丢弃；这与跨 realm 健壮性缺陷分别记录。根因是只读 SQLite 连接更新 SHM 读锁时间戳。最终仅从 SHM 的一致性戳中排除 mtime，保留其身份/大小校验与 main/WAL 完整戳比较；真正的数据库或 WAL 变动仍拒绝。只读、精确会话归属、路径/链接、文件大小与数值校验保留，最终 Desktop 三项统计及详情已按实施记录核对。


### v0.8.1 用户确认：保留管理页，完整原生子对话及有限宿主扩展

当前实现直接注册官方 `sidebar.chat.conversation` 的同一完整组件，使用真实 SessionReference/SessionProvider；原 CLI Worker 管理页和顶栏继续保留。官方视图自身管理 phase、hero、聊天与 composer。此节取代上文局部 content 和逐组件遥测包装，以及默认子 Agent 独立 Stop/Send 的呈现约定。

用户于 2026-10-16 授权有限宿主扩展、安装前验收。官方 rc.2 隔离源码新增可选 `composerPresentation: main` 和 `commandSource` owner 参数，以及 `uiSession.provideProjections(reference, sources)` 会话来源接口；不修改真实子 Agent 身份、权限、Inbox、默认主会话行为。统计桥是无 React 的 Gateway 订阅与数值转换，绑定精确代际并清理；原生组件自己消费数据，不再逐组件包装。

Host 持久保存同一 CLI 会话已确认的累计快照，新 run 尚无数据时继续使用，换会话即失效；响应 usage 与累计分开。AGY 的真实响应边界、公开过程及单次 usage 经实际 AgentLoop 结算；工具回执只读投影，不重执行。缺少公开思考、精确响应边界或单次 usage 时保持未知，不补造。具体支持边界和验收见 native-conversation-ui.md、native-conversation-host-extension.md 与 tasks.md。


### v0.8.1 十一 CLI 数据范围与原生每轮用量补充

2026-10-17 按新建 Worker 保存的 transport 分派；旧 Worker 缺省/legacy 保留原协议，未知值拒绝，不隐式迁移会话。全 CLI 的每响应、整 run、持久会话累计和上下文分别归类；缓存与 reasoning 按各自协议归一化，缺数值或总数矛盾保留未知。只有精确身份且完整的整轮回执才能绑定原生 turn，普通响应账单与整 run 合计二选一，避免重复计费。

完整原生视图继续使用官方 sidebar.chat.conversation。用户已授权宿主扩展，本轮在隔离 ui-chat 增加可选 externalTurnUsage 来源及 StatsPills 的范围说明，由原生 TurnTailNodeView/TurnUsagePanel 和详情消费数据；不新增自绘用量/过程控件。每轮绑定持久保存；旧历史只按 accepted nativeInputs、批次/run 和原生 user.source.rpcId 的唯一闭合事件恢复内存映射，不重写 Session、不按文本或时间猜对应。

底部优先使用已确认的同会话累计。只有完整 run 账单时，下一轮期间保留最近已确认回执，并在原生详情说明范围；不将其提升为会话累计。Hermes 本地 canonical input 与 HTTP inclusive input 分别处理；历史会话累计按精确 CLI home/session/cwd 读取。存在 WAL 时仅查询私有 DB/WAL 快照并销毁，避免只读 SQLite 连接仍更新用户 SHM；无 WAL 使用 immutable 只读 URI。无公开过程/容量仍按原生未知行为处理。当前四包扩展仅隔离验收，正式 Desktop 未安装；逐 CLI 证据和边界见 cli-native-data-audit.md。

### v0.8.1 当前 CLI 补充数据接口与完整性（2026-10-17）

用户追加授权参考 codex-host、Codingns4DSH 及相关官方项目补齐数据接口。先按安装版证明来源，再接观察或只读查询，保持原 CLI Agent、transport、保存选型及权限。外部参考代码不执行；缺计数补零、累计差 clamp、空白 reasoning 占位及 DOM 统计补丁不采用。全十一 CLI 的具体版本、来源、作用与限制统一见 `cli-native-data-audit.md`；第 10 节旧报告保留历史证据，新入口按第 11 节核验。

Kimi 2.1.1 保持 ACP。发送前保存精确 session/main wire cursor，只读官方 durable usage.record、llm.request、step.end 与 turn.ended，核 session、项目、agent、模型、prompt/turn/step 身份及前缀连续性，不枚举其他用户会话。只有请求覆盖完整、终态成功且无辅助／重试／子 agent 缺口时发布 run 账单，其余仅 reported；CLI emptyUsage 四零不能证明 provider 已给完整零账单。独立响应回执不强绑到已丢失响应身份的 ACP 正文，当前上下文仍使用 ACP used/size。不得切换旧 Python Wire 或为统计启动 Web 服务。

Hermes 在同一受管 HTTP Python 进程经官方 PluginContext 注册 pre/post/error/session-end 观察，安全模式和插件发现隔离保持。观察仅向本轮私有通道写白名单身份／计数，nonce、连续序号和 session/native run/turn/request 配对后消费，结束清理。CLI canonical normalized 默认零不当成 provider 明确报告的缓存零，覆盖完整与分桶完整独立判定；不能以收齐请求数量自动证明 raw 账单完整。只有符合条件的请求 prompt 与 context_length 才补总占用／容量，MoA 等缺口不造分类。该观察不会为旧 stream-json 历史补造过程或每响应数据；旧精确 DB/WAL 会话累计仍单独读取。

OMP 16.4.4 保留 no-extensions/no-skills。原进程声明唯一 native builtin /context 后，生成结束串行执行有界元查询，仅在 agentInvoked:false 精确回执后使用原生五类估算与 buffer/free；不将命令输出写入对话，不由分类和或百分比反推 used，不采用 null→0 fallback。/usage 可能查账号，/stats 会启动 dashboard，不自动调用。get_session_stats 实际只遍历当前 state.messages，因此改标 native-active-context／reported，不持久成完整 session。message_end.usage.orchestration 的明确 input/output/cacheRead 保持独立，provider total 不等普通四桶时不按差额造桶、不删除差异、不冒充完整四桶 response。

Pi 1.0.4 的 get_session_stats 已遍历全部 entries，包含压缩、分支摘要、独立 usage 与 toolResult 计费；继续复用该原生全历史快照。ExtensionContext 只提供总上下文与只读 entries，没有分类 Token 方法；不为分类自行分词。OpenCode 1.19.0 增加同 ID／项目的 GET session.tokens 原生 counter 快照：step-finish 修改先减旧再加新、删除会下降，故覆盖替换而非累加／取最大值。其 output 不含 reasoning，由统一口径层加一次；不将此 session snapshot 当 run 或最后响应。MiMo 0.1.15 的 Session 没有相同 counter，plugin trajectory／assembled prompt／部分 metrics 不足证明完整辅助账单或原生分类，不套用 OpenCode 字段。

可选会话投影保留原生 partial categories、精确名称、来源、估算标签和 OMP extra/reporting 范围，不补零迎合三桶结构，不重新组合对话 UI。ContextMeter 弹层统一只展示占比、进度条及系统提示词／工具定义／对话消息三行；来源和额外分类仅在底层留存用于校验，不增加显示行，未知状态同样如此。估算、缺值说明和统计范围继续保留。普通会话未提供外部来源时沿原投影。当前这些新接口已在源码与离线夹具接通；整包原生视图复验、Desktop 备份安装与冷启动状态以本轮 `tasks.md` 后续记录为准，本节不预记安装通过。真实账号／模型、全部 CLI 工具链和 Windows 缺口继续单独保留。

### v0.8.1 首轮无响应与运行过程（2026-10-17）

截图的首轮尚无响应时，官方组件原有的“无数据则隐藏”分支会隐藏底部统计；此前完成态验收不覆盖这个状态。本节替代上文 CLI 子会话缺值直接隐藏的约定。插件仍把官方 `sidebar.chat.conversation` 的同一 component、inject、store、locale 和公开 options 交给真实子会话 Renderer，未组装 StatsPills、ContextMeter 或 ChatView。已授权宿主扩展增加会话来源 `telemetryAvailability`，由官方 StatsPills/ContextMeter 自己保留三个模块，未知值显示“—”并在原生详情说明等待数据、未报告或连接断开。已确认数值（包括真实零）优先；未提供该可选来源的普通 DSH 会话保持默认行为。

Hermes 官方 pre/post/error 观察沿同一 HTTP 子进程，通过 nonce、session/native run、turn/request 和连续 sequence 核对后发布请求状态。独立、有界、串行轮询不依赖 SSE 先返回内容；本地 Worker 的 runId 与 Hermes accepted run_id 分开绑定。`externalRequestState` 仅保留白名单 phase、HTTP 状态及错误类别，不泄露原请求或错误正文，不从 retry_count 猜测退避延迟或重试计划；下一次真实请求替换失败提示，终态或换 run 清除。状态进入原生 ChatView/RunningStatus，不能用空推理、假工具或虚构 step 补画过程。

Hermes HTTP 的公开 append-only reasoning 和已确认响应身份的 tool-start 按实际到达时间进入原生流；工具名称/身份可先显示 preparing，参数、回执和账单仍等待真实边界。其他可能撤回的快照保留结束边界保护。无公开思考/工具时没有可展开过程，这是上游数据边界；有公开过程则由原生过程组显示、折叠和展开。请求状态、过程及 Token 用量是独立来源，不以显示一项推定另一项完整。

Hermes HTTP 受管服务结束时使用官方计划停止 SIGINT，避免官方把未标记 SIGTERM 当作异常停止而 exit1，覆盖已返回的成功结果；自然崩溃、非零退出和无法确认退出仍是失败，其他 CLI 停止方式不变。Hermes 的 HTTP/legacy/observer/DB canonical 计数缺少原始缓存字段存在证据，零值不能证明提供方明确报告零；仅在读取副本中降为未知，保留总量及已知正数，并使用原生部分用量详情。旧持久快照同样冷读消歧，不改历史日志或失败结果。

本节候选已在隔离首轮场景和真实 Desktop 历史会话完成验收并安装；模拟输入、历史只读及真实模型验证严格分开。具体包hash、测试、备份、用户文件保留和未验证边界以 tasks.md 的第12节记录为准。

### v0.8.1 完成答案与原生过程顺序（2026-10-17）

同一未提供独立响应身份的 CLI 叙述段中，正文和晚到公开推理在同一原生请求保留独立 block；等待进程清理不创建空成功末 step。已形成的旧多 step 记录通过精确 Worker、父子会话、成功 run 和闭合 turn 证明既存答案位置，Host 只提供 seq/step/messageId/endSeq，原生 ChatView 再核对并恢复其显示。旧事件不改写、CLI 不重跑。

只恢复答案可见不足以通过原生交互验收。对通过验证的旧 turn，原生有效条目顺序将对应公开过程放在正文上方，沿用既存节点、分组和展开 store，不重新拼组件、不用 CSS 颠倒位置；同 step 晚到推理同样以真实 DOM 顺序验证。普通 DSH 无此来源时保持默认行为。

上下文核查必须追到同一请求的 used/limit。截图对应 Hermes 实测为 4046/1048576，原生整数百分比为 0%，详情保留真实数值。这与缺失上下文、累计账单和缓存字段是否已提供分别判断，不把未知缓存补成零、不把显示不足 1% 误判为没有接线。


## v0.8.1 上下文精度与原生分类完整性（2026-10-17）

用户后续 Hermes-2 截图对应请求为 4091/1048576，约 0.390148%。此前只验证真实分子、分母已接通，遗漏了共享原生组件将百分比取整为零后也绘制空图形的问题，以及外部来源挤掉原生分类行的问题。此节替代上文“不足 1% 显示 0%”的验收结论。

修复位于官方共享 ContextMeter/contextOccupancy。底部、详情标题与无障碍标签使用同一格式：真实零为 0%，0—1% 的正值最多两位小数，低于 0.01% 为 <0.01%；图形使用未取整比例。1% 及以上保留整数展示，超窗口的图形封顶但实际分子不改。非法值保持未知，普通 DSH 与外部 CLI 共用这项精度修复。

外部 CLI 在同一原生详情保留系统提示词、工具定义、对话消息三行，支持完整、部分与全未知；缺失为 — 并说明原因，完整分类仍用原生颜色分段。弹层不展示“分类来源／数据来源”或 CLI 额外分类行；来源及 OMP 的额外分类仅在底层保留用于校验，free/buffer 不作占用分类。精确总量与分类估算分别标记。现有三分类标准投影仍要求完整，部分数据由可选 externalContext.breakdown 传入同一个组件。

Hermes 通过原进程官方 pre_api_request hook 的实际 request_messages 与完整 tools，调用其原生估算原语采集数值分类，仅支持已核对的 chat_completions；同一 request/turn/session/model 成功响应后发布。系统提示不重复计算；未知、截断或脱敏的工具定义不计作零。原始提示和工具定义不写入观察文件，也不重新请求模型。已结束旧记录没有保存分类快照的无法精确补回，显示未知；分类估算不反向覆盖供应商 input 统计。

## v0.8.1 其余十 CLI 原生侧栏对齐（2026-10-17）

十 CLI 继续由同一个官方完整视图承载，协议修复位于各自适配及安全遥测层，不新增对话组件；最终新增 `context-clean` 四包宿主扩展候选，统一去掉上下文弹层的来源说明及额外分类行。Codex 保留实时 commandExecution 输出、MCP 进度和动态工具结果，缺省完成输出不擦掉已收到内容；Claude 按 parent_tool_use_id 隔离流，主响应结束前暂存子流公开事件，避免打断原生桥，异常时确认 peer 关闭后保留已公开内容，不制造成功或账单。

ACP/ZCode 的正文→公开思考→正文按真实边界分段；没有公开思考不构造替代。Pi/OMP 在确认模型后传递原生容量，并在 prompt 前及 response 间发起独立 ID、单个在途、750ms 超时的只读统计查询；终态迟到回执忽略，查询失败不重发用户任务。OpenCode/MiMo 的初始全零 assistant 为占位，不能清空已知上下文；明确完成的真零保留，完成回执缺少完整输入则清旧占用、保留已证实同模型容量。

逐响应 usage、run 合计、session 累计、最近请求上下文分别投影。缺少对应响应身份时不把总账挂到消息，缺分类不猜三桶；不同 CLI 的输入/缓存口径继续独立。完整逐项来源和限制见 `doc/ten-cli-native-parity.md`，实际离线、浏览器与 Desktop 范围见 `doc/tasks.md` 第15节。

## v0.8.1 七张真实截图回归（2026-10-17，第16阶段）

Pi 的请求组成观察必须与当前可执行文件所在的官方安装匹配。已核对版本通过 `context_with_system`、`getCurrentSystemMessage` 和 `estimateTokens` 统计真实 provider-facing 请求，仅以专用 fd3 输出 nonce 和数值；RPC stdout 不承载观察数据。仍禁止用户扩展自动加载，只显式加载本插件观察器。Host 验证 session/provider/model/连续序号和活动请求，限制帧与缓冲大小，终态迟到帧丢弃；同身份新请求无法分类时发送 unknown 并清旧分类，独立的已知上下文总量不被覆盖。

MiMo/OpenCode 先从自身原生 server 读取实际 provider SDK、模型和端点，再在 prompt 之前串行关闭元数据 server，以本轮随机 nonce 的 loopback relay 作为原生 provider baseURL 重启。只支持已核对的原生 SDK 请求；继承原 HOME、PURE、cwd、权限和数据目录，验证实际生效路由后才提交一次任务，准备失败回退原配置。relay 将请求和响应原字节透传到已核实的固定上游，不落盘请求、工具定义或凭据；仅对同 session header、精确当前用户内容、模型及主请求合同匹配的数据计算三类数值，使用对应 CLI 原生 chars/4 估算算法。标题/摘要请求不混入主请求；同请求超限、畸形或缺字段会清除旧分类。结束及取消关闭 server、relay、上游请求、socket 和 agent，不留下监听器。

这两条通路仅补充分类估算，不能按估算总和改写账单、真实 input 或上下文压力。共享遥测只接收白名单数值与请求身份，晚到 usage 不擦掉当前有效分类，旧历史无采集数据不追算。视图继续使用整个原生会话及已有共享宿主扩展，不新增统计或过程组件。

macOS ZCode 临时运行根使用短路径，避免官方 UUID Unix socket 超过长度限制；Grok 按已安装 ACP 版本发送标量配置值并核对实际模型/强度。只有协议终态有效且实际成功发出本插件收尾信号，才容许对应清理退出码；自然非零退出、错误、未确认退出或无终态仍失败。Antigravity 的 `user_input`/`checkpoint` 为元数据，未知中性事件记覆盖诊断，不制造 FAILED；非法结构和真实工具错误仍失败。公开过程缺失保持原生无展开行为，不从最终正文补造思考。

## v0.8.1 五图续聊与新版宿主兼容（2026-10-17，第17阶段）

同一 CLI/session 的上下文独立保存最近有效检查点，尚无新采样时保留；显式 unknown 清除，真实零正常生效。ZCode 启动的 `turnCount=0`、无 currentTurnId、全零 projection 是初始化占位，不能清空旧统计；其进程 projection 总量按本轮解释，不再冒充 session 累计。选择新模型会持久化旧 run 的上下文失效标记，清 observedModel 和上下文检查点；新 run 不继承旧模型窗口，历史账单保持本来口径。

Grok 通过官方 `_meta["x.ai/statusLine"]` 能力订阅、模型目录更新和同 session 状态读取原生上下文估算。旧记录只接受精确 session/model/prompt 的安全只读 durable 回执，不能从账单推算 context。ZCode 从本 Worker 的精确 main_turn model-io 完整请求读取 system/tools/messages，按已安装官方 `ceil((CJK*2+other)/3)` 原语估算各类；分类与压力、账单独立，不强制闭合。两者只向共享视图发布白名单数值与身份；新请求明确未知清旧分类，文件不完整或身份冲突拒绝读取，历史不改写。

当前 Desktop 为 0.2.1-rc.1。已授权四包扩展移植到该版本官方原生视图，保留新版 flow、统计和交互结构；原生注册依然可选，普通会话不受影响。插件用新 SDK 的 caller activation / drainChildren，旧版保留 continuable API，均保持父目录归属、真实 child 工具策略和精确清理。构建使用固定 rc.1 完整独立依赖，不覆盖本机 rc.2 链接或共享 store；当前宿主匹配的候选通过隔离验收后再安装。

## v0.8.1 当前 Desktop 的能力检测与可复现候选（2026-10-17，第18阶段）

用户手动更新应用后，先核实际安装包与官方release源码，再在独立目录重建已授权四包；不依据版本号猜测接口变化。本次应用构建标记 `332895e0f7c9d4dbfb29729f5eb367fa263ff986` 与官方源码tag提交 `687f282e8625c6b8d11ff58211a90524be2e4317` 分别保留。四个UI包的官方rc.1到rc.2仅package版本变化，已授权生产扩展与原生 `conversation.chat.flow` 保持；旧候选和历史证据不覆盖。

开发依赖为固定的40项SDK输入，安装于独立cache/store，根既有node_modules与共享store不改。发布插件的DSH peer使用 `*`，不把开发输入固定版本变成宿主加载白名单。真正的安全边界仍是运行时能力检测：子Agent生命周期方法、精确父子会话与绑定代际、原生Slot所有权、可选投影接口及清理合同缺一不可。缺能力明确拒绝，不伪造兼容。版本支持说明仅在Release中依据实际验收记录，放宽peer本身不是验收证据。

Client生成的Typert纯helper从选定SDK解析并按官方inline-safe规则内联；Host继续保留宿主SDK external，避免复制Remote类破坏共享身份。源码、构建器、依赖锁、应用、preview与四包manifest均参与最终候选核验。正式构建之前须验收隔离preview并备份原lib/profile，随后核对全部运行产物；本次第一次比较因81个源码路径注释差异中止并回滚，profile未改。仅经审明的构建根路径注释可进入窄规范化白名单，其他代码、声明、脚本、资源和文件集合仍严格比较。比较或构建失败不得应用profile。

本次类型检查、四包268项与构建11项定向回归以及10项完整原生侧栏隔离浏览器检查已完成；浏览器模型调用和真实CLI进程均为0，协议回放与模拟zero/unknown分开记录。它们不证明新的RuntimeTask、真实工具执行或AGY原生DB上下文。写入时正式安装重试正在执行，Desktop冷启动及旧历史只读验收仍待根任务完成；本节不将其记为成功。实际结果和未完成边界继续写入 `doc/tasks.md`，版本保持0.8.1。

## v0.8.1 Qoder CLI 原生 ACP 接入（2026-10-17）

Qoder 作为独立 CLI 进入已有选择、项目偏好、原生子会话及两层任务树，外部分发与已安装界面名称均沿用现有约定。依据官方 npm CLI 1.1.73 的实际包、帮助和 ACP 初始化，使用 `qoder --acp` / JSON-RPC 2.0 NDJSON，保存 `qoder-acp-v1`；不把 Claude 相似消息当兼容证据，也不引入 SDK 1.0.53 默认 worker transport 所指的另一版 CLI 1.1.71。包哈希、官方来源和逐项证据见 `qoder-protocol.md`。

模型目录由同一已安装 CLI 的 SDK stream-json initialize 返回完整 ID、启用状态与动态强度，等待 catalog-ready 后仅返回启用模型，不从 `--list-models` 表格推断。实际任务仍通过 ACP 设置当前模型、`reasoning_effort` 及 `mode` 并核对回执；失配、未宣告能力和账号变化在 prompt 前失败。账号只能取自 Qoder 自身登录或 PAT，经对应来源核验后绑定，不导入其他 CLI 或宿主凭据，不把认证密文刷新误认为稳定账号身份。单独账号查询通过 initialize → account_info 取得主键；授权目录使用同次 catalog-ready initialize 的账号投影。不另装 SDK 运行时，不由插件解密登录文件。认证读取、动态目录与实际任务是独立证据。

Desktop 复验发现原 ACP 临时会话 close→delete 失败，且原生目录初始化会刷新共享默认缓存，因此账号和目录元数据统一使用私有配置目录及官方 SDK 认证策略。浏览器登录保留原只读认证根且要求已有机器标识；PAT 使用私有认证根，按需复制已有机器标识。必要用户配置和 customs 安全复制，项目设置语义保留；会迁移写回的旧项目配置及尚未绑定的 `.env` 控制声明提前拒绝。end_session 回执、正常终止归属、完整流结算与进程范围退出全部确认后才返回目录并删除临时根。详细边界与实际验收见 `qoder-protocol.md` 第 9 节。

设置加载沿用其他 CLI 的操作内快照和目录缓存模式：Qoder 在同一次 catalog-ready 初始化中取得账号与完整模型，操作前后独立校验认证、配置、环境、自定义模型和可执行入口来源。冷目录和显式刷新省去重复账号进程；热目录仍重新核对账号绑定，真实任务仍独立进行运行前校验。快照只在本次操作内有效，不对登录身份增加 TTL。来源指纹表示本地来源一致，不冒充初始化后的再次远端认证；实际耗时与进程数以 `tasks.md` 实测为准。

本版 ACP 实际模式为 default/acceptEdits/auto/dontAsk/yolo，插件只开放现有“允许编辑”映射到 acceptEdits；额外审批拒绝，不使用绕过权限。没有宣告 plan，宿主或子任务要求规划时提前拒绝，不能以默认模式或提示词替代原生只读保护。运行期间配置变化继续核对，恢复必须沿用已确认的原生 sessionId，历史重放不进入本轮正文。停止先发 session/cancel，再由已有进程管理确认整个范围退出；协议回执不单独代表停止成功。

正文、公开思考及工具事件复用现有原生桥，工具名保留 `_meta.qoder.toolName`，参数和结果只取实际公开字段。prompt 返回的 input/output/total 是整轮查询账单，只投影为 run，不冒充每响应或当前上下文；缓存、分类、窗口和 Credits 缺失时保持未知。官方品牌图标作为本地资产随插件打包，沿用其他 CLI 的大小、主题与设置布局，来源另外记录。

本次先完成官方包检查、非模拟初始化及明确标注模拟的空会话配置；这些检查没有发送模型任务。真实账号模型、工具产物、同会话恢复、运行中取消和 Windows 的验证缺口单独保留。继续执行相关回归、类型检查与隔离 preview 验收，Desktop 安装及其实际结果仅按 `tasks.md` 记录；不在设计决定中提前宣布安装或真实执行成功。此次变更保持 v0.8.1，不自动全局安装 Qoder、不推送或发布。

## v0.8.1 三图原生会话回归（2026-10-17）

Worker 内部 `cliworker-native` 模型仅用于精确解析，不再公布到全局 `listModels`。宿主允许解析未广告的精确模型，因此父会话菜单不再出现 Worker 实例和重复 CLI 模型；侧栏仍使用当前 CLI 的独立目录，不修改父会话选型。

Qoder 1.1.73 官方路由可隐藏 token 计数并返回全零，这种回执不能证明真实零账单。用量、旧轮次和消息脚注均保留未知；非零输入仅标记为“CLI 报告输入”，不推断是否含缓存。原生 JSONL 若有 `context_usage_ratio`，Host 按精确项目、会话、模型和 ACP `userMessageId` 对应的 user UUID／parentUuid 链做有界只读核验。该比例作为独立元数据进入既有原生 ContextMeter，token 数、容量和分类保持未知，不以虚构分子分母制造百分比。旧记录不改写，重复读取不累加。ActivityPill 说明轮／步及耗时属于 Harness 调用 CLI 的记录，首 token 时间包含启动和准备，不冒充 CLI 内部请求指标。

Grok 截图轮次有思考 token 计数但未公开思考文本。官方 `conversation.chat.turnTail` 扩展点在精确 Host-issued Grok 子会话的已完成成功轮次增加“Grok 本轮未提供公开思考内容”。该判断读取真实原生 assistant blocks，已有公开 reasoning 时不显示说明；工具仍按原生过程展开。运行、加载、失败、身份不匹配或主会话不提前说明，不制造 reasoning 事件、不解读 signature。

比例和中性输入口径只扩展现有可复现的 0.2.1-rc.2 四包数据接口，不修改应用核心或共享配置。先完成隔离构建与完整原生视图验收，再在空闲退出后备份并更新 Desktop 所链接的构建及四包产物。实际证据、回滚和未执行的新模型／平台验证见 `tasks.md`。


## 2026-10-18：v0.8.1 用量缺失状态与公开过程纠偏

按四张 Desktop 截图核验原生来源。Qoder 1.1.73 的该轮全零账单与 transcript 计数是隐藏/不明确计数，只有精确会话上下文比例；Hermes 该轮公开 hook/HTTP/DB 只保留规范化统计，无法证明默认缓存零是明确未命中。保留真实数值与未知边界：外部轮次明确 null 时通过原生消息用量控件展示未知详情，缓存缺失显示“缓存命中 —”，不使用父会话、包装调用量、credits 或上下文比例推算账单。普通原生会话保持既有行为。 统计断连或无效回执清除数值，但仅为最近一次已接受快照中的精确轮次保留 null 未知标记，防止回退到 Harness 包装调用量；owner/generation 变化及释放清空旧绑定，错误帧不能引入新轮次。

用户要求移除 Grok 额外缺失说明，本节替代此前 turnTail 可见说明的设计。Grok 与 OMP 实际公开的思考/工具仍进入原生过程；没有可读内容时不增加正文说明或伪造展开内容。OMP 原生摘要已开启，只有 reasoning token 数、空片段或 opaque signature 不提供可读内容。原生过程、账单和上下文独立判断。

OMP 在已有受租约保护的插件账号运行目录执行官方 models refresh，然后按当前账号池、额度与原生能力筛选。任务沿同一 registry 解析精确模型，用户原始 models.db/models.yml 保持；正常 OAuth 轮换沿既有 CAS。当前本机 16.4.4 的自身账号回执为 free，可选为 GPT-5.6-Luna 与 GPT-5.6-Terra，未以其他 CLI 的登录或模型目录扩大范围。Desktop 更新与真实验收状态见 doc/tasks.md，目录可见不等于生成已验收。


## 2026-10-18：原生过程内的 CLI 思考记录（v0.8.1）

全部 12 种 CLI 沿现有 Host 公开 reasoning 白名单与原生 assistant-step 持久化路径显示思考记录。Client 委托原生节点渲染器，仅调整思考标题和展开正文的滚动区域；记录位于“已完成，用时…”的原生过程内，保留步骤分组、工具交错顺序和原生折叠状态。没有 turnTail 面板、伪工具或第二份文本存储。授权绑定同时校验 Worker、CLI、child/parent session；主会话不改标题。注册卸载保留原生子 slot 所有权。

Codex 新建与恢复后续轮次通过原生 `turn/start` 请求 `summary: auto`；只采集实际公开摘要，保留原选模型、强度与权限。旧历史无摘要、未知用量和上下文分类不补造。Host 的流式公开边界仍由各协议保证：可撤回快照在公开完成边界后展示，不能把暂存或私密字段视为可读思考。

2026-10-18 Codex 定向修复：实际安装版0.162.1与本机模拟服务已验证 `summary:auto` 到达 HTTP 请求；rollout 的 `turn_context.summary` 为兼容序列化字段，不能作为摘要是否启用的依据。`HarnessConversationStream` 仅对当前 run 的 Codex `codex-app-v1` 和既有 Hermes `hermes-http-v1` 开放公开增量实时投影，其他快照保持完成门槛。Codex 的摘要接收、最终去重、原生位置与停止后的持久化继续复用现有路径，不增加客户端组件或第二份历史。

隔离 rc.2 Harness 原生 UI 已验证 12 CLI 的原生过程归属、展开/收起、Codex 两段思考与工具交错、刷新重开、无公开内容、键盘和 980px 窗口窄栏；安全 Markdown 和 400px 内滚动通过。输入全部明确标注模拟，真实 CLI／模型及 Windows/Linux 未执行。本地 Desktop 更新与数据保留记录见 tasks.md。

## 2026-10-18：Windows Qoder 独立 CLI 自动发现（v0.8.1）

Windows 按已核验的官方原生位置 `~/.qoder/bin/qodercli/qodercli.exe` 和当前用户 npm 前缀发现 Qoder，原生入口校验 PE，npm 入口绑定 `@qoder-ai/qodercli` 及其实际声明的 `qodercli`/`qoder` bin 并静态解析 shim。无固定安装时 PATH 优先查询独立 `qodercli`，仅命令缺失时兼容旧 `qoder`；每个自动来源（含缓存）重新校验独立 PE 或官方 package bin，npm dispatcher 归一到实际 qodercli bin，IDE/未知入口拒绝，不扫描任意目录。手动路径与显式部署配置保持优先，存在但损坏、权限不足和无法确认的入口不静默切换。账号、模型、ACP 参数及历史存储协议不变；路径发现与登录/模型访问分别核验。

## 2026-10-18：Windows Qoder 账号收尾与 Desktop 终端来源（v0.8.1）

Qoder 元数据查询必须先取得原生成功回执并确认 `end_session`。官方 Windows SDK 使用 `TerminateJobObject(1)` 收尾，因此仅在该请求由插件正常主动终止、没有取消或协议错误、进程范围已确认退出时接纳对应的 `1/null` 退出；自然非零、提前退出和未确认清理仍拒绝。该分类不执行登录、续期或模型请求，不改变账号文件与派遣前授权核验。

正式 Desktop 的 ConPTY 二进制与清单可能分别在 `app.asar.unpacked` 和 `app.asar`。新增受当前 Host 安装位置、随机 nonce、归档只读锁与固定版本约束的清单证明；Electron 的逻辑读取和 `original-fs` 的物理无链接检查分离。继续按同一实际 helper 校验固定 exe/DLL 摘要、对应源码副本、父 PID、创建时间和控制台身份，并以 Job 范围为空及终端释放作为停止成功条件。普通 npm 物理清单路径保持。来源及完整边界见 `windows-conpty-source.md`；真实账号、模拟终端和实际 UI 的验收证据分别记入 `tasks.md`。


## 2026-10-18：Qoder 上下文与本轮积分（v0.8.1）

任务继续走 ACP。主计数与扩展 quota 各自校验，不将不同来源的桶混算；隐藏全零 token 仍未知。本轮积分与上下文共用精确 userMessageId/parent 链的原生记录补读，积分按原生请求 ID 去重，缺失请求不补零。只在同轮原生配置或有时间、会话及模型约束的日志确认容量后估算占用数量，否则独立显示原生比例。数字缓存不保留正文，历史与原始回执保持只读。原生用量组件增加可选积分元数据，积分不进入 token 统计；原生 ContextMeter 与兼容组件均支持只有比例的状态。

Windows 实机暴露 Qoder 默认原生文件由 Administrators 拥有，当前用户拥有完全控制、其他主体仅有继承只读权限。仅 Qoder 数字采集显式接受此布局，所有路径仍需要当前用户所有权，或 Administrators 所有权加当前用户完全控制，并拒绝任何不可信写权限；前后 ACL、稳定身份、无链接和取消校验保持。默认通用读取规则及 POSIX 私有权限不变，不修改用户 ACL。实际来源、预算、精度与本次 Windows 验证边界见 `qoder-protocol.md` 第 6.2 节及 `tasks.md`。

## 2026-10-18：积分计费文案与 Hermes Windows 网关就绪

Qoder 的可选遥测来源增加积分计费单位，原生与备用用量组件只显示积分，标题为“积分用量”；有效零、等待、缺失与断连各自保留实际语义。当前归属断连时保留单位并清空数字，释放或换代时清除单位。后台有效 token 桶继续校验，不作为积分模块的显示替代，也不影响独立上下文的 token 单位。

Windows Hermes 的 venv python.exe 派生实际 Python 解释器，原生状态 PID 与启动器不同；文件日志中已经就绪，但没有 stdout 监听行，旧门禁因此超时。本次仅向精确自有 Python 入口传入每次随机 nonce，经本次管道取得当前解释器 PID，再核对新鲜状态的 pid/writer_pid、精确本机地址和鉴权能力。该进程回执不含 API 秘密，进入原生 CLI 前移除 nonce；不从磁盘 PID 单独扩大信任。完整停止范围、原始账号及会话保留，实机网关能力检查不提交模型请求。来源与边界见 `hermes-probe.md` 和 `tasks.md`。

## 2026-10-18：逐轮积分、模型展示与简洁统计弹层（v0.8.1）

逐轮投影增加独立积分分支和已确认模型展示元数据。积分只汇总对应 turn 的已结算、去重 run；任一成员缺失时显示未知，明确零有效。Windows 异步补读复用已有只读采集与来源检查；当前轮和历史轮分开缓存。断连保留积分单位和已绑定轮次，清空数字。兼容时间线仅在对应 run 的最后回复显示已取得积分。

提供方／模型显示来自对应 run 的 observedModel 事件，Hermes 解析原生 provider/model 对，OMP 等保留原生 provider/model ID；未公开提供方显示“未公开”。没有完整外部账单时，展示元数据可覆盖名称，但原生精确回复用量保持原口径，不使用内部 cliworker-native/worker UUID 充当实际模型。原始事件和执行路由不改写。

所有 CLI 的活动、用量与上下文弹层去掉重复解释段落；缺失项用 —，估算标记和实际统计范围保留。上下文菜单不再附加缺少分类提示，缩减分段条与分项间距，统计弹层统一正常内边距。实际 Windows 检查及未验证边界见 tasks.md。

## 2026-10-18：统一设置预加载与展示缓存（v0.8.1）

Mac 已安装包和 Windows 原实现共用 OpenSettingsDialog：账号状态只在弹窗挂载期间保留，模型按选中页加载。现有 Host 模型持久缓存保留，但并不能省去重复打开时的账号查询。此次新增两端共用的 Client 内存展示池，按 API、Host 随机代际和项目隔离，最多保留八个项目；只保存完成的安全摘要和目录，没有凭据、授权或进程句柄。

cliSettings 的可选元数据包含宿主代际、项目摘要、CLI 来源版本、当前默认值及 Host 是否保留本次目录的账号绑定，读取不启动 CLI。账号/路径/开关操作更新相应版本，Host 重启换代；没有元数据的旧 Host 保持原读法。跨父会话复用同项目目录时，Host 仍为保存选型保留原账号绑定；证明缺失时清除对应有效目录并重新查询，不恢复磁盘上的旧账号身份。无有效项目时只返回原有全局开关状态，不阻止用户管理开关。

首次打开有界预加载全部已启用 CLI，一个任务按账号、目录顺序执行，并发上限两项、当前页优先。关闭只取消未完成任务，完成部分可供重开补读；跨 CLI、取消、来源换代及迟到结果不回填。显式账号刷新再强制刷新其模型，模型刷新不重复查询账号；错误结果保留供刷新，不以旧成功值掩盖失败。最新项目默认值来自轻量快照，只有人明确选择才保存，保存结果在切换及重开后保留。

该缓存是最后确认的展示结果；外部原生账号/权限变化通过手动刷新及保存、启动、出队、续聊的既有实时核验确认，展示缓存不替代授权。布局与主题不变，Windows 实际验收、Mac 静态核对及未执行范围见 tasks.md。

补充交互：模型和思考强度先本地更新，离开 CLI 页或关闭时由共用的 SettingsPreferenceSaves 后台提交最终组合，每 CLI 串行。导航不等待原生账号核验，关闭取消展示探测但让已提交写入完成；快速重开恢复草稿，旧回执不覆盖新草稿，新草稿未离页前不会因旧写入结束而提前提交。失败保留选择和错误，后续离页可重试；账号、目录、路径、开关来源失效会取消旧草稿和写入。成功后更新相同范围展示缓存，重开时轻量宿主快照拥有已完成的最新默认值；旧 Host 使用同 Gateway/父会话的临时队列，不扩大其账号展示缓存范围。

快速重开的响应顺序保护：设置读取在发送前捕获 Client 保存回执代次，晚到的旧快照不能覆盖随后成功的保存回执。完成保存后新发起的读取仍同步外部最新默认值；该代次只排序展示响应，不缓存授权或替代 Host 实时核验。


## 2026-10-18：CLI 原生附件和工具桥补齐（v0.8.1）

附件输入继续由真实子 Agent 的 Inbox 管理。私有运行配置接收当前消息中已准入的 image/file 引用，Host 使用 attachments 服务和子作用域 fs 路径映射解析，不接收消息自带的任意 path；回执去重包含附件身份，运行中附件不转为纯文本引导。共用转换模块按 CLI 的真实协议提供图片块、资源链接或文件路径，临时请求与进程范围沿现有清理链回收。

macOS / Windows Desktop 普通文件沿用原生本地引用语义，通过公开 SessionInput.insertReference/source codec 进入草稿；图片通过原生 File action 上传。随包四包扩展新增默认关闭的 childImageUploads，在精确 CLI 绑定且附件能力可用时开启，仍拒绝子会话普通文件回执。私有 CLI 生成路由声明图片输入表示其能转换附件，不代表下游模型拥有视觉；ACP initialize 未明确公布 image prompt 能力时使用经过校验的图片路径。Web 普通文件上传回执仍未接通，不能借根会话身份绕过。

Skill 与 MCP 复用既有 run 专属工具桥，从实际子 Agent 目录按需查询与调用。Kimi/Grok/Qoder 的 ACP 权限回调仅对结构化精确工具名、当前实时授权目录及 allow_once 准入，随后仍进入 Host tools.execute 与审批。当前四个未具备已验证安全临时入口的 CLI 保留限制，十二 CLI 状态与真实证据见 cli-harness-capabilities.md、tasks.md；不复制全局 Skill/MCP 配置或凭据。

## v0.8.1 元数据刷新故障按 CLI 隔离

账号、路径、模型与选型元数据在 Host 的已知 CLI 边界归属；清理未确认时，Runtime 与私有存储只封锁该 CLI 的进一步查询、账号变更、任务准入及尚未执行的队列。同 CLI 保护跨 Host 重启保留；损坏的按 CLI 记录同样只拒绝其 CLI。其他 CLI 的现有任务、查询、缓存和偏好不因该失败变化。

全局 `cleanup-blocked.json` 继续表示真实任务清理或无法归属的旧故障；新元数据标记使用固定 CLI 枚举文件名和原严格格式，不保存底层日志、账号、路径或凭据，不通过忽略 waitForExit 消除异常。旧全局记录不能自动猜为 Grok 或因关闭设置而清除。实机恢复先正常退出完整范围并留存原标记，实际查询、Grok 原生续期提示与未验证边界见 tasks.md。

## 2026-10-19：Qoder CN 独立接入与公共 Windows 路径发现（v0.8.1）

- 注册 qodercn / Qoder CN CLI，项目偏好、账号绑定、路径、缓存、清理保护和 qodercn-acp-v1 均独立。国际版 qoder 历史保持原协议。泛称 Qoder 按安装分流：单装进入该版、双装原生询问；显式品牌不回退。检测不读取账号或发送 prompt，安装错误不冒充缺失。
- 官方 CN 1.1.74 的品牌环境是 QODERCN_、用户根 .qoder-cn，默认项目目录仍是 .qoder。SDK 控制变量与 qodercli 认证载荷、ACP 的 _meta.qoder 工具字段及 qodercli.log 日志名保留共享原生定义，不作字符串猜测。账号/目录操作显式传递品牌，快照与来源包含品牌，子进程清除对侧品牌控制变量；当前未支持的认证或 VPC 路由明确拒绝。
- 会话前核对 agentInfo.name 为 qoder-cli-cn；配置、模型及权限仍由原生回执确认。中国版公开过程、附件和工具桥复用相同算法，但持久身份与统计事件/source 保留 qodercn；停止仍等待范围退出，未知用量不补零。
- 所有 CLI 复用有界 Windows 公共安装目录及最新用户/机器 PATH 发现。原生安装、npm 包身份、跨版拒绝和特殊桌面 CLI 验证继续保留，显式损坏路径不静默更换。此公共层减少新增 CLI 的发现代码，不声称任意便携位置都能自动定位。
- 仅在 Windows 做 Desktop 验收，Mac Desktop 供用户其他工作使用；本地只做源码、离线检查及隔离构建。实际证据与登录/真实模型边界见 doc/tasks.md、doc/qodercn-protocol.md。

## v0.8.1 目标、规划、反馈与分支桥接（2026-10-20）

OpenSpec：`openspec/changes/bridge-conversation-features/`。

- **能力单一来源**：`src/shared/conversation-features.ts` 的 `bridgedFeatureSupport(worker)` 由 Host 写入子会话绑定的 `capabilities`/`reasons`；Client 只消费绑定。旧绑定缺 `goal/feedback/forkEarlier` 时按不支持处理。不支持的入口保持可见并禁用，用共享 Tooltip 显示原因，触发为无操作。
- **目标**：不复用 Harness `ctx.goals`（会武装 goal-round-driver 自动续轮）。插件自有 `Worker.goal`（objective/status/revision），Remote `setWorkerGoal/setWorkerGoalStatus/clearWorkerGoal` 以 revision 比较防并发覆盖。`runtime` 受理新一轮时冻结目标，status=active 则把 `【当前目标】…【目标结束】` 前置到发给 CLI 的文本；steer 不注入，Harness 用户消息保持原文；不使用 Codex `thread/goal`、ZCode `session/goal`。GoalBar 以同 id 槽位替换。
- **规划**：沿用 `worker-permissions.ts` 映射；`/plan` 与各控件按 `capabilities.plan` 处理，不支持时给提示而非错误。
- **反馈**：“+”菜单调用 Harness `feedbackUi.openSession(childSessionId)`；赞踩保持原生；不发 CLI、不上传厂商、不进模型上下文。
- **分支**：Remote `forkWorker(parent, workerId, atMessageId)` 与 `/fork` 共用 `src/host/worker-fork.ts`。校验归属与空闲后，按已完成轮的助手消息映射原生截点，调用 CLI 原生分支得到新会话 ID，新建同父 Worker（复制偏好、模式、目标，revision 重置）与 Harness 子会话（复制截点前历史）；全部成功后才发布，失败回滚。只对原生会话 transport 开放。
- **逐 CLI 核实依据**（本机源码/协议/--help，未调用模型）：Codex 0.162.1 app-server `thread/fork` 含 `lastTurnId`（最新+较早）；Claude 2.1.287 `--resume --fork-session --resume-session-at`，新分支首轮延迟分叉，新 ID 取首轮事件；Kimi 2.1.1 ACP `unstable_forkSession`；MiMo 0.1.15 SDK `session.fork`；ZCode 0.16.9 `session/fork`（`forkedSessionId`）；Pi 1.0.4 RPC `clone`；OpenCode 1.19.0 HTTP fork 路由；Qoder 1.1.73 / Qoder CN 1.1.74 ACP `forkSession`。降级：Grok（ACP `x.ai/session/fork` 参数与回执未核实）、OMP（RPC 仅 `branch(entryId)`，无包含最新完成轮的 clone）、OpenCode/Pi/ZCode 较早截点（缺少可靠的原生截点映射）；Antigravity 无公开接口、Hermes 原生分支会结束原会话。
- 取舍：目标作为普通前置指令，遵循程度取决于模型，换取全部 CLI 一致且不自动续轮。

### 分支烟测修复（2026-10-20）

- OpenCode 真实烟测 `run-kcm8YW` 的源 Worker 数据库含源会话和新分支 `ses_ea75a221fffeNtq9sP4ZIrcadF`，新 Worker 数据库为空；缺失原生状态根引用导致分支首轮 GET 404。分支状态现对 Pi、OpenCode、ZCode 保存并继承 `nativeStateWorkerId`，使后续任务、再次分支及元数据回滚使用同一原生存储，仍保留各自会话 ID。ZCode 同样按 Worker 目录设置 `ZCODE_SESSION_DB_PATH`，一并修复其后续恢复路径。
- ZCode 0.16.9 本机 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` 的 `Usr/mGt` schema 支持 message 目标。`ZKo/vXa` 将其转为 `targetMessageId`，`mRo/lRo/oRo` 在没有后续检查点时走纯会话复制，`P6e/R6e` 包含目标助手及同轮响应。旧默认 latestCheckpoint 会在纯对话抛出 `No workspace checkpoint is available yet.`，且存在旧检查点时可能遗漏后续对话。现改为 resume 后从 `session/messages` 活动链取得最新助手 ID，以 message 目标分支；不伪造检查点、不调用 `session/send`，较早截点仍禁用。
- 本次仅核对既有真实失败证据、本机源码并做模拟回归；修复后的真实模型与 Desktop 验收由主会话继续执行。

### MiMo / Qoder CN 续聊烟测修复（2026-10-20）

- MiMo 0.1.15 按消息 ID 排序识别旧回复；插件原随机十六进制用户 ID 排在原生 `msg_g` 助手 ID 前，导致第二轮直接结束，缺少助手终态。保留上一代理已落下的 MiMo 专属原生格式消息 ID 修复，目标块和终态校验不变。本轮只审阅和测试该共享文件，不编辑另一代理负责的 `native-session-http.mjs`。
- Qoder / Qoder CN 绑定仍包含稳定账号主体、PAT 和真实路由。原生启动新建 `.models` 但没有 `customs` 时，不再新增一项虚假的“customs 不存在”路由；实际 customs 文件新增、改写、删除仍改变绑定，真实账号切换仍拒绝。该修复恢复既有同账号续聊行为，不改账号权限策略。
- 既有 raw、原生数据库与安装源码共同定位根因；模拟覆盖含目标/无目标续聊、缺少助手仍失败、缓存初始化不变与真实账号变化拒绝。修复后的真实模型复验由主会话执行，未据此宣称远端验收通过。

### 分支终态与原生视图命令源复核（2026-10-20）

- `HarnessWorkerFork.turns()` 原先把任何有 `end` 和 closing 助手消息的轮次当成完成轮。现与 Host `selectForkHistory` 一致，要求 `turn/end.data.reason.kind === 'completed'` 且有助手消息。失败或中断轮不会映射为最新轮空串截点，DOM guard 保持其按钮禁用。
- 安装包 `dsh-client-ui-workspace/lib/client.js` 的 `openSession` 调用 `replaceMain`，以 `mainView` retain 子会话并 reveal 原生 Conversation；`Panel.openWorker` 只修改面板内部选择，`activeHarnessSessionId` 只是同步选中状态，不会替换原生主视图。原生 Conversation 默认“+”菜单使用 `command`，并未取得插件面板传入的 `cliworker-settings`。
- 复用随包 runtime 已有的 `commandSource` owner 属性，通过公开 `conversation.composer.bar` 槽位为已绑定 Worker 的 CLI 子会话设置桥接源。主视图、原生侧栏及插件面板共用该槽位；保留原组件、inject、子槽和菜单 controller，普通/无会话保留原始 props。绑定晚到会更新，卸载释放替换。保持现有分支打开方式，不修改 Harness 核心、node_modules 或 runtime-host。


## v0.8.3（未发布）：市场行归属与原生设置投影

四个 vendored UI 的 Loader id 使用 `cliworker-ui-*`，浏览器包身份仍为 `@deepseek-ai/dsh-client-ui-*`。bundle 顶层仅禁用四个 stock id；市场按 insert ids 推导归属时不再把 stock 行算作插件所有。市场将该补丁识别为 disable-carrier，切换时移除或恢复整个 bundle；带 inject 的界面不承诺纯热启用，按提示重启。

stock 行保留其官方 name 与 canonical config，作为原生设置的唯一持久化目标。启动预检验证 runtime 摘要、每包唯一来源、独立 id 和 disabled stock 来源，拒绝私有 id 上的第二份设置、跳过的 name 断言以及丢失的 isolate/intercept/inject。chat/conversation 的既存 config 通过下述视图读取，不复制、不迁移；session/subagent 仍保留原先的配置丢失检查。

两个浏览器 UI 的 Host apply 仅注册设置展示策略；客户端偏好实际来自 SettingsForms。因此预检成功后安装可释放的 ConfigEditor.entries 适配，只为 `ui-chat` 和 `ui-conversation` 的 disabled stock 行提供内置 schema 的配置视图，并从该配置编辑清单中隐藏对应私有行。视图的 options/name/id 保持 stock，fiber 的 schema/uid/state 来自活跃 vendored 模块，config 则由宿主 resolveConfig/interpolate 从 stock raw config 解析。实际 Loader fiber、模块注册表、模块包身份与用户文件不被改写。

SettingsForms 本身不修改：describe、update、replace、mutate、revision 和原生事件继续使用 canonical namespace。原 ConfigEditor.edit 继续负责文件锁、层次优先级、验证、原子写入、HMR 与失败回滚；新增设置行使用 stock name，移除插件后不会留下指向 vendored 路径的断言。启动适配不写盘，仅用户原生设置编辑触发宿主写盘。

缓存按 stock entry 与 vendored fiber 身份更新；旧视图的 settings.configure 注册及时释放。预检卸载时恢复原 entries 属性描述符并清理全部展示策略；若后来的扩展已经包装该方法，不覆盖其包装，同时将本适配置为停用并清空缓存。此兼容层限定于随包固定基线的两个纯 UI schema，不能泛化到有 Host 配置副作用的插件。


## v0.8.3（未发布）：Harness rc.3 四包升级

开发 SDK 的 39 个固定版本统一升级至 0.2.1-rc.3，插件包版本保持 0.8.2。四包从公开 tag `dsh-v0.2.1-rc.3` 的真实 checkout `1f81c047fc48fa190a683e469daa699857e9afe8` 重编；源码、依赖及元数据摘要冻结于 `host-extensions/dsh-0.2.1-rc.3`，runtime-host manifest 记录相同来源。旧 rc.2 扩展目录保持用于历史复核。

保留 rc.3 的 `conversation.session.header.views.actions`、view-pins、`whenDraftExists` 的 append/replace/keep 优先语义及 `newSession`/`agentPreset` 提交快照。48 文件补丁仅手工合并 skeleton 测试的新 header hooks；另修正历史测试仍期待已移除统计说明的断言，产品显示继续遵循既有简洁统计设计。React/React DOM 18.3.1 与 Zustand/use-sync-external-store 在同一隔离依赖图中固定，避免源码测试跨根目录产生重复 React。

继续使用独立 `cliworker-ui-*` Loader 行、官方浏览器包身份及现有 canonical 原生设置适配；不增加版本白名单。rc.3 随包 UI 在隔离 0.2.1-rc.2 与 0.2.1-rc.3 Host 均通过启用/禁用、页面及设置读写验证，因此保留两者兼容。该结论限于本次 UI 与安装验证，不扩大真实 CLI、模型或平台验收。

官方 app 的 client-modules build identity 为 `be72761`；公开 GitHub commit API 无此对象，单独记录为未解析，不与 tag commit 混同。官方 app 只通过已链接插件目录和两个 profile 文件恢复；不改 app.asar、DSH Desktop、凭据、既有会话或 CLI Worker 数据。实际操作、备份及回退证据见 tasks.md。


## 2026-10-24：市场热切换白屏调查结论（无运行代码变更）

此前的启用/禁用兼容性记录不能推导为连续热切换安全。本次实际市场 toggle 路由在隔离 rc.2 Desktop Host 与 rc.3 原生 Host 均触发 `session-maybe` adapter 缺失和 React 白屏；stock 模块随后恢复也不能恢复已经崩溃的页面。scratch guard 在 dispose 中停 vendor、等待旧 fiber、恢复 stock 的候选同样失败，未合入。rc.3 还复现失败启用重新加入 bundle、却保留 owned rows disabled 的分裂状态，最终 stock/vendor 同时关闭；rc.2 Desktop 的市场停用列表过滤使该方向表现不同。

保持现有 fail-closed、settings alias 释放及唯一来源契约；不在插件销毁时引入未经保证的跨模块交换，不重新插入 stock id。建议上游在 live mutation 前识别需重启 bundle，延迟完整切换，并修复失败启用的 bundle/patch 一致性。详细源码行号、候选、实测和未验证范围见 [调查报告](blank-toggle-investigation.md)。


## 2026-10-25：界面中英双语（add-client-i18n，未发布）

`GeneralSettings.language` 为 `follow | zh | en`，默认 `follow`，与总并发上限同存 `general-settings.json`（0600），`null` 恢复默认，其他值被补丁 schema 拒绝。Host 在 Worker 快照中仅在非 `follow` 时附带 `language`，所有已打开面板据此同步；Remote 签名不变，旧记录缺省视为 `follow`。

Client 以中文原文为键（`src/client/i18n-messages.ts` 的 `en` 字典，`MessageKey = keyof typeof en`），中文字典是键的恒等映射。`src/client/i18n.ts` 维护模块级语言状态与 `useSyncExternalStore` 订阅：`t()` 供普通函数使用，组件经 `useT()` 订阅并在语言变化时重绘。`index.tsx` 在挂载后调用 `installClientLocale(ctx)`，于可选 `locale` 作用域内用 `scope.effect` 注册 `cliworker` 命名空间并订阅 Harness 语言变化，插件卸载时注销并回到中文。`follow` 时经 `locale.bind('cliworker')` 取词（Harness 语言以 `zh` 开头为中文，其余为英文，外部语言包可覆盖）；显式选择则用插件词典。日期与数字格式随有效语言使用 `zh-CN` / `en-US`。

Host 与共享模块仍只输出中文，不导入 Client 词典。Client 的 `hostText()` 对词典中收录的 Host 原文（约 90 条：常见错误、能力原因、权限选项、暂停原因等）及两条带变量的模板做精确映射，英文时剥离 `Error:` 前缀；未收录内容原样显示，不机器猜译。仍为中文的范围：未收录的 Host/CLI 错误、Host 生成的标题与摘要、内置角色预设内容、默认名称 `智能体-xxx`、发给 CLI 的附件说明，以及给主 Agent 的工具描述与提示词。Client 内与 Host 原文比较的字符串（如状态、暂停原因）保持中文键比较，不比较译文。

## 未发布：同目录写任务隔离副本并行

OpenSpec 变更 `add-isolated-parallel-writes`，设计细节见该变更的 `design.md`。

- 「CLI Worker 设置」→「任务调度」新增「同目录写任务并行」开关，默认关闭；关闭时调度与此前完全一致。
- 打开后，`drain()` 判定新写任务与主目录中运行中或排在前面的任务冲突，且该 Worker 尚无原生会话时，在 `<状态目录>/isolated/<Worker ID>/copy/<项目名>` 建副本并立即放行；不冲突的任务、只读任务和已在主目录建立会话的续聊照旧。
- 副本不含 `.git` 与依赖/缓存目录；符号链接不跟随，只复制相对且留在项目内的链接；先扫描后复制，超过 20 000 个文件或 1 GiB 时回退排队并在任务卡写明原因。APFS 等支持时用 `COPYFILE_FICLONE` 写时复制。清单记录每个文件的哈希，可合并文本（≤2 MiB、无 NUL）另存基线。
- `projectDirectory()` 不放宽；副本路径另用 `assertIsolatedCopy()` 只接受调度器为该 Worker 生成的确切真实目录。
- CLI 的 cwd、原生目录参数、账号核验与遥测读取使用副本路径；Worker 的项目身份、偏好、父会话与权限模式不变。本轮提示说明副本与原项目路径；隔离运行不接 DSH 工具桥；隔离对话暂不支持分支。
- 合并只由主 Agent 调用 `cliworker_merge`（2026-10-25 起任务卡不再显示副本状态与合并/丢弃按钮；完成通知提示主 Agent 改动待合并、不要在原目录重做）。逐文件三方合并：只有副本改动的直接写回，两边都改的文本 diff3；仍需整合的文件不称冲突，返回 `needs_integration` 与基线、项目、副本三个版本，由主 Agent 按任务目标整合后带 `resolutions`（content / copy / project）再调用，目标矛盾时主 Agent 用 `ask_user_question` 问用户；结构性改动只能保留项目版本；决定齐全前主目录一个文件都不写，副本保留。写回为未提交改动，绝不提交。丢弃（`cliworker_discard` 原生询问）只在副本目录确认删除后报告成功。
- 原生会话与工作目录绑定，故合并/丢弃后对话仍绑定同一路径（`released`），续聊时在原路径重建副本。
- 重启时 `preparing` 删除、`merging` 恢复为可再次合并；停止只结束进程不删副本；归档保留副本。

## 2026-10-25 额外授权被拒绝后标为结果待核实（未发布）

OpenSpec 变更 `report-denied-permission-as-unverified`。

> 2026-10-28 起由 `close-approval-relay-gaps` 取代：授权被拒后 CLI 正常结束的轮次改为「已完成」，不再标结果待核实。下文为当时的决定。

- 插件仍拒绝全部额外权限/授权请求。拒绝后 CLI 本轮自身正常结束、无其他失败时，结果为结果待核实（`uncertain`），提示核查实际产物、不要自动重试；不报告成功。
- 被拒绝工具因拒绝报告的失败不单独判失败：ZCode 按请求与 `permission.resolved` 的 `toolCallId`（批次 `errorCount` 只扣除批内被拒工具），ACP 按 `toolCall.toolCallId`，Codex 按审批 `itemId`（`declined` 完成）。Hermes 与原生 HTTP 会话系审批不带工具身份，有拒绝时整体为结果待核实。
- Claude Code 拒绝即中断本轮，仍为失败；需要额外交互输入的请求仍为失败。
- 起因：实测 ZCode shell 被拒后改用编辑工具完成，任务却显示失败。

## 2026-10-25 Hermes 原生环境 Copilot 记录不再阻断自身账号（未发布）

OpenSpec 变更 `fix-hermes-ambient-copilot-source`。

- 原生 Hermes 在 `gh` 已登录时，会把无令牌的 `copilot`/`gh_cli`/`api_key` 记录写进任何 HERMES_HOME（不受 `auth.adopt_external_logins` 约束），未选择 Copilot 时不路由模型。插件守卫此前把它当成外部账号，导致账号终端误报「检查 CLI 安装」、Nous 续期误报「稍后刷新」。
- 现在只放行该形态且未被 `auth.active_provider` 或 `config.yaml` 任何位置选择的记录；选择 Copilot 后仍拒绝。守卫拒绝改为固定文案的 `HermesAccountSourceError`，在账号终端、状态、续期与绑定中显示真实原因。

## 2026-10-26 换号后旧任务自动续接（未发布）

OpenSpec 变更 `continue-tasks-across-account-changes`（用户 2026-10-26 决定：不打扰用户）。

- 改绑点在轮次准备阶段（`runtime.ts` `execute`）：已有任务（有绑定或原生会话 ID）以当前账号授权原模型与强度，通过后更新绑定；排队续聊以旧账号受理而授权报账号已变更时，重读一次当前账号。（同日调整为静默续接：不再记换号说明，新任务同样按当前账号授权，见下方「静默续接」。）Host `launch` 续聊不再传入旧绑定；子对话目录与改选在保存目录未命中时读取当前账号，查看不写绑定。旧记录、`queueFollowup`、插队与分支的缺绑定拦截移除，快照不再给出旧记录拦截原因。
- 静默续接（用户 2026-10-26 要求：不要「账号已变更」类提示，全部 CLI 都要静默续接）：移除改绑诊断；时间线读取旧记录时隐藏旧换号说明、旧改接说明改为不提账号的文案（`legacyAccountNotes`）；新任务受理后换号与续聊相同，按当前账号重新授权用户已选的模型与强度；启动准备期间换号且未启动 CLI 时静默放回队列重新授权一次；选型卡答完后与模型目录读取期间换号静默改读当前账号一次；对话与项目已保存设定不再因绑定变化失效，只要当前账号目录仍提供其模型与强度。仍会出现的提示只有“未登录”与“模型或强度不可用”，以及同一次启动内账号连续变化两次的竞态拒绝。
- 运行中换号：引导请求在核对时发现绑定变化，改由 `queueFollowup` 排队，Host 回执带 `queued`，Client 移除引导气泡，以排队消息显示。
- 续接方式表 `cross-account-resume.ts` 目前全部为 `try`；本地预检只在 Hermes oneshot 的 `HERMES_HOME/state.db` 不存在时判定原会话不可达，直接改接。
- 改接：改绑的续接轮次已启动进程、未产生任何回复/思考/工具事件即非成功结束，且非用户停止或清理失败时，最多改接一次：清空会话 ID、以 `carryover-context.ts` 的确定性摘录（首轮需求 + 最近完整轮次，24k 字符预算，单条 4000 字符，不含工具输出，中和起止标记）加角色提示和本次消息在新原生会话发送；新会话 ID 到达时原 ID 记入 `previousConversationIds`，改接也失败则恢复原 ID。排队消息在首次启动时已投递，改接不重复写入或校验。
- 用量：改接后 Token 用量累计此前各会话与新会话（缺失分项保持未知，轮次级用量不合并）；上下文占用只显示新会话自身数值；改接未建立新会话时恢复原累计。
- 审查修复：成功的最终结果算已执行、已提交引导的轮次不改接；改绑待确认状态持久化（`reboundConversationId`），改接失败后下一轮仍可改接；摘录只收录已送达的插队消息；改接前的运行拒绝原生分支（`carryoverRunId`）；引导转排队对重试幂等；改接准备遇 Pi/OMP 账号占用时排队等待，等待中停止恢复原会话。
- 未做：分支的原生分支操作失败不改接；第 0 节真实账号实验未执行。

## 2026-10-26 Antigravity 账号终端引导与自动退出（未发布）

OpenSpec 变更 `guide-agy-account-terminal`（用户 2026-10-26 要求：退出时由插件直接输入 `/logout`；登录要提示如何粘贴授权码，粘贴后醒目提示按回车）。

- 原约束「账号终端不发送 prompt 或斜杠命令」调整为：仅 Antigravity 退出动作在识别到已登录主界面后发送一次 `/logout` 与回车；未登录、信任询问、管理动作及其他 CLI 不写入。
- 引导由 Host 依据终端输出标记生成固定文案（`AccountFrame.guide`），Client 只显示，不转发 CLI 输出；授权码只走原有终端写入通路，不进入引导、事件或日志。
- 登录与退出结果以原生账号状态（macOS 钥匙串、Windows Credential Manager）确认，不依据终端文字；确认超时只提示，不重试写入。
- agy 改版导致标记失配时，引导停留或不出现，自动退出不触发，退回用户手动操作。

- 修订（同日，用户实测反馈）：Antigravity 登录/退出改为插件自绘的分步窗口，原生终端以 200×60 隐藏运行、可显示作后备；窗口只在用户点击时写入回车或括号粘贴的授权码；登录地址取自 OSC 8 且仅限 `accounts.google.com`；退出前以画面静止加原生账号状态判断已登录，不再只依赖猜测的主界面文字；登录确认后结束原生终端。

## 2026-10-27 可复用登录模板与「账号」窗口（未发布）

OpenSpec 变更 `add-cli-login-templates`（用户 2026-10-26 要求：其他 CLI 的登录界面也按 Antigravity 的方式适配，多来源时加下拉框，做可复用模板；多账号 CLI 合并成「账号」窗口、同服务商由用户选添加或替换、单账号 CLI 提供切换账号）。

- Host `account-guide/engine.ts` 抽出通用引导引擎 `FlowGuide`，每个 CLI 只写一份流程定义（`single-account.ts`、`multi-account.ts`）：按屏幕标记只前进的步骤、白名单登录链接与设备码提取、括号粘贴开关、自动退出命令。`AgyAccountGuide` 实现同一驱动接口。
- Client 不再拼按键：用户回应经 `accountRespond` 只有 option / code / secret / confirm 四种，Host 校验属于当前步骤后译成该 CLI 自己的按键。授权码和 API Key 不进入事件、日志、引导帧或 Client 持久状态。
- 登录、退出成功只以原生账号状态确认；多账号时以目标凭据的 `cli:provider[:entry]` 句柄为准（OpenCode 服务商键、Hermes 凭据池 6 位 id），其他条目变化不算数。启动单条退出前 Host 重新读取原生状态，目标已不存在则拒绝。
- 「登录到」服务商表是固定表，逐项对照已安装版本：OpenCode 1.19.0 的 models.dev 目录 id，Hermes `auth add` 的 Known providers。表外服务商和其他 OAuth 仍走原生菜单；Hermes 的 Nous 在表内，以 `auth add nous --type oauth` 启动并在原生终端完成设备码授权（2026-10-29）。
- Hermes「替换」由 Client 串联：先添加并确认新凭据，再按旧句柄单独退出；退出未确认则保留结果页。单账号「切换账号」同样串联：先退出并确认，再登录。
- 画面静止 8 秒仍未命中任何步骤时显示原生终端后备，此后不再自动写入。2026-10-29 起退出流程不自动展开终端，后备只提示用户点「显示原生终端」；结果页不显示终端状态，启动之后的连接中断也不再套用「账号终端暂不可用」的启动失败提示。Host 账号 watch 先发完收尾时追加的结束帧再结束，避免窗口错过关闭帧。OpenCode 首次读取服务商目录约 15 秒，为它单设等待步骤，避免误入后备。
- 未做：Qoder 已登录 TUI 的 `/logout` 画面未实测，依赖静止后的原生状态判断。真实账号验收尚未执行。
- 2026-10-27 Windows 首次运行设置（变更 D14）：配色页由插件按回车采用默认配色；服务条款由用户在插件窗口点击「同意并继续」后，Host 才按勾选状态切换并选中 `[Done]`；数据收集选项默认不勾。无法跟随的向导画面转原生终端，不读取账号状态，也不输入 `/logout`。

Kimi、Pi、OMP 接入（同日，用户要求「继续做 Kimi、Pi、OMP 的「登录到」下拉框和逐条退出」）：

- 登录句柄：`pi:<服务商>:native|plugin`、`omp:<服务商>:<native|plugin>.<auth_credentials rowid>`、`kimi:<服务商键>`（`kimi:kimi-code` 为托管 OAuth 登录）。服务商表项可带 `stores`，表示实际写入的服务商（OMP `openai-codex-device` → `openai-codex`，Kimi 两个区域 → `kimi-code`），确认按它核对。
- Pi 没有单服务商退出命令，插件自带的 `pi-login.mjs` 调用 Pi 运行时的 `modelRuntime.logout(provider)`；登录以 `login <服务商>` 进入 Pi 自身的流程。
- 引擎新增 `pick`：用于只能在原生列表里选的退出（OMP `/logout`、Kimi Code）。每次按一次 ↓ 读高亮行，只有能核对为目标的行才按回车；重复或超过 40 行转原生终端。新增 `watches: 'login'`：Pi、OMP 授权后不退出，Host 每 3 秒核对、最长 15 分钟。
- Pi/OMP 账号行只列任务实际使用的凭据，并带 `source` 分组；OMP 自身退出写入 `disabled_cause='deleted by user'` 保留行，此类行不覆盖其他位置、不显示失效，其他禁用原因仍显示失效。

## 2026-10-28 整轮结果按原生终态判定（未发布）

OpenSpec 变更 `judge-run-outcome-by-native-terminal`（起因：用户反馈 Windows 上 28 个 Worker 有 12 个显示失败，多数是单个工具失败后 CLI 已自行完成，主 Agent 据此重做，浪费额度）。

- 单个工具失败不再写入本轮 `failure`。共用模块 `src/host/native-tool-outcomes.mjs` 按原生工具身份去重计数，并记录最近的证据是失败还是成功；之后的成功工具或非空回复都算 CLI 已继续。
- 终态顺序：本轮失败（协议/身份不一致、原生轮次失败或中断、缺少终态、仍有未完成工具、非零退出、需要额外交互输入）→ 失败；有授权拒绝 → 结果待核实（既有规则）；最后一步工具失败后直接结束 → 结果待核实，提示核查产物、不要自动重试；否则成功，有失败步骤时附说明「本轮有 N 个工具步骤失败，CLI 已自行处理」。
- 成功帧新增可选 `notice`（仅 SUCCESS，≤2000 字符）：`native-transport.mjs` → `bridge-protocol.ts` → `Worker.resultNotice`（每轮重置）→ 时间线诊断「本轮结果说明」与主 Agent 结果的 `notice`/guidance。runtime 待核实与说明分支改按 `BridgeProtocol` 判断，Pi/OMP 同样生效。
- 各 CLI 的工具失败信号沿用原识别：Codex 条目 `failed`（`inProgress` 收尾改为未完成工具）、Claude `is_error`、ACP `status==='failed'`、ZCode 单工具 error 与批次 `errorCount`（扣除已知失败和被拒工具）、OpenCode/MiMo `state.status==='error'`、Hermes `tool.failed`、Antigravity `tool_info.error`、Pi/OMP `isError`。
- Antigravity：真实 agy 的工具失败为步骤状态 `ERROR` 加 `tool_info.error`（2026-10-28 实测，`TOOL_ERROR`），按工具失败计、不算未完成工具；没有 `tool_info.error` 的 `ERROR` 状态仍判本轮失败。`tool_info.error` 仍阻止续聊汇总冲突转为结果待核实。Pi/OMP 未新增未完成工具检查。
- 真实验收（2026-10-28）：Codex、Claude Code、Qoder、ZCode、OpenCode、Antigravity 读取不存在的文件失败后自行写出产物，均为完成并附失败步骤数。
- 持久化无迁移，历史 failed 记录不重算。

## 2026-10-28 原生工具输出预算（未发布）

OpenSpec 变更 `bound-native-tool-output`（起因：Windows 用户反馈 Codex 读大文件时运行被插件以 `Native bridge output exceeds run limit` 终止，浪费额度）。

- 根因：各原生 runner 在每个输出增量里重发累计全文（`detail`、`toolCall.output` 与原始帧各一份），传输量随输出长度平方增长；超出 `maxRunBytes` 即终止进程。无模型复现：单条命令 400KB 输出在传输约 16.7MB 后被终止。
- 事件形状：运行中的工具输出与公开思考只带 `delta`（本次新增）；工具完成时完整（或截断后）输出只在 `toolCall.output` 出现一次，`detail` 只留元数据；思考完成时发一次 `detail` 快照。事件新增可选 `truncated`、`outputBytes`。`io.native` 记录中超过 64 KiB 的字符串只保留 `{ cliworkerOmitted: true, bytes }`；Codex `outputDelta` 原始帧只记录字节数。
- 预算分层（`native-transport.mjs` `createEventBudget`，Pi/OMP 桥共用）：单步展示 `maxToolPreviewBytes`（默认 256 KiB，且不超过出站单帧的 1/4）；整轮展示 `maxRunBytes`（原生通路下即整轮展示预算，默认 16 MiB）。超出只截断展示、标注 `truncated`，整轮超限时发一次诊断「本轮展示内容已达上限……」，不抛错、不改终态。出站单帧仍受 `maxLineBytes` 保护，超限的事件先降为摘要。只对工具和思考事件降级；回复、状态与诊断不截断。
- 入站：CLI 单个协议帧上限独立为 `maxNativeLineBytes`（默认 32 MiB，暂定值：Codex 0.162.1 协议未给出 `aggregatedOutput`/`outputDelta` 上限，无模型 `command/exec` 实测合法单帧达 18,000,057 字节），超出时停止并报告「原生 CLI 单个入站协议帧超过上限（N 字节）」。入站累计字节不再终止运行；Host `runtime.ts` 对原生桥输出的累计字节同样只统计不终止，非原生通路保持原检查。
- Host 与界面：`bridge-protocol.ts` 透传 `delta`/`truncated`/`outputBytes`，`storage.ts` 事件 schema 新增三字段；`foldEvents` 把 `delta` 追加到工具行 `toolCall.output`（字符串）或思考行 `detail`，之后的快照或完成输出覆盖它。旧记录（累计 `detail`/`output`）无迁移、照常渲染。Client `worker-process.tsx` 在工具与思考展开区显示「输出已截断（共 N KB），完整内容见 CLI 原生会话或实际产物」；`harness-conversation-stream.ts` 与 `harness-observed-tools.ts` 转给主 Agent 的工具回执附同样说明。
- 各 runner：Codex、Claude、ACP 系（Kimi、Qoder、Grok）、ZCode、OpenCode/MiMo、Hermes、Antigravity 均改为运行中发增量、完成时一份输出、`detail` 只留元数据；CLI 只给累计快照时，新快照以前一份为前缀则发差量，否则作为替换输出（仍受展示预算约束）。OpenCode/MiMo 公开思考仍保留「快照冲突即报错、取较长快照」的原规则。各 response tracker 完成回执不再重放最后一个 `delta` 或工具输出。
- Pi/OMP 桥：从 Host 请求读取 `maxLineBytes`/`maxRunBytes`/`maxNativeLineBytes`/`maxToolPreviewBytes`（`extended-adapters.ts` 透传），复用 `createEventBudget` 与原始记录摘要；去掉写死的 16 MiB 累计、1 MiB 单行和 2 MiB stderr 终止，单帧按 `maxNativeLineBytes` 保护。工具完成只发一份输出。
- HTTP/SSE（OpenCode、MiMo、Hermes）：`httpLimits` 累计字节只统计；单个 SSE 帧按 `maxNativeLineBytes` 保护并报告上限。单次 JSON 响应仍以 `maxRunBytes` 为上限。
- 工具桥：Host 响应按 UTF-8 字节判断，并为下一层 JSON-RPC 包装预留 4096 字节，两层判定一致；超限返回明确错误，工具桥仍可继续使用。
- 不做：不映射 Codex `max_output_tokens`/`tool_output_token_limit`。模型可见输出由 CLI 决定；插件启动的 Codex 读取 `$CODEX_HOME/config.toml`（默认 `~/.codex/config.toml`），插件只传 `model_reasoning_effort`、`sandbox_mode`、`approval_policy` 三个 `-c`。

## 2026-10-28 CLI 原生工具优先，DSH 工具作为备选（未发布）

OpenSpec 变更 `scope-harness-bridge-tools`（起因：Windows 用户反馈插件内 Codex 不太会用工具；DSH 工具桥交给 CLI 的工具与原生工具大量重复。用户决定原生优先、DSH 工具只作备选）。

- 新增 `src/host/cli-native-capabilities.mjs`：按 CLI 与任务模式给出启动参数下实际启用的原生能力类别，Pi `--tools` 与 Grok 网页开关读取同一模块。Host 准备工具桥时把能力表与 CLI 原生 MCP 名称（只读名称）交给 `createNativeHarnessTools`；目录与调用都排除已覆盖的 DSH 工具，交出的描述加「备选」前缀。规划模式的写入属刻意关闭，不作备选。能力表为空即恢复全部交出。
- 技能 `requiredTools` 改按获准目录判断，被原生覆盖的工具仍算满足。
- 原生优先说明只走已核实的追加入口：Codex `developerInstructions`（用户已配置 `developer_instructions` 时不发）、Claude `--append-system-prompt`、Pi `--append-system-prompt`、OpenCode/MiMo `prompt_async.system`、Grok 新会话 `_meta.rules`；Kimi、Qoder、Antigravity 无已核实入口，不加。说明列出运行开始时实际交出的工具（`NativeHarnessConnection.tools` 快照）。
- ZCode 不再注入目录并记录原因；Codex MCP 设 `tool_timeout_sec` 为任务时限；支持 MCP 图片的 CLI（Claude、OpenCode、MiMo、Kimi）透传图片结果，其余保持错误投影。
- 逐 CLI 表与核实依据见 `doc/native-harness-tools.md`「原生工具优先」。真实模型验收待合并后执行。

## 2026-10-28 CLI 权限跟随 DSH 预设，额外授权交给 DSH（未发布）

OpenSpec 变更 `relay-native-approvals-to-host`（用户 2026-10-28 决定）。替代上文「宿主处于规划或只读模式时拒绝派遣」与「插件仍拒绝全部额外权限/授权请求」：

- 每轮启动时按父会话 `sandboxPolicy` 快照档位（`runAccess`），状态行记「本轮权限：…」。仅可查看以 CLI 原生规划/只读模式启动（runtime `launchMode=plan`）；Antigravity、Qoder、Qoder CN、Hermes 无可确认的整进程只读模式，派遣前拒绝。父会话规划模式仍拒绝派遣写任务。
- 完全权限的原生模式：Codex `danger-full-access`+`never`、Claude `bypassPermissions`、Qoder CLI `bypass_permissions`/ACP `yolo`、ZCode `yolo`、Grok `agent --always-approve stdio`、OpenCode/MiMo `"*": "allow"`+`bash: allow`（task/skill/question 仍 deny）。Kimi（`--yolo`/`--auto` 与 ACP 描述矛盾）、Hermes（`--yolo` 对 HTTP 通路未核实）、Antigravity（去掉免确认后无已知审批事件）保持原参数。
- 授权通路：runner `io.approval` → 桥帧 `{type:'approval',id,request}` → Host `relayApproval` → 父会话当前状态判定（规划 → 拒；`never`+完全权限 → 放行；`never` 其他 → 拒；`ask` → 弹窗）→ 私有邮箱 `approval` 命令回写 → runner 回复 CLI 原生值。来源在 `launch` 入口确定：主 Agent 工具调用 → 父会话 `userQuestions.ask` 问题卡；用户在子会话发起 → 子 Agent `approval.request`（子会话审批策略每轮同步为父会话策略，客户端在 CLI Worker 面板挂载期间持有运行中 Worker 的子会话）。
- 原生回复：Codex `accept/acceptForSession/decline`（permissions 请求回显授予子集与 `scope`）；Claude `--permission-prompts host`，`behavior:allow`+`updatedInput`，会话级把 CLI 自己的 `permission_suggestions` 改为 `destination:'session'` 放入 `updatedPermissions`，拒绝仍 `interrupt:true` 失败；ACP 选原生 `optionId`，会话级仅 Kimi `approve_always`、Qoder `proceed_always`（不选 `proceed_always_and_save`，Grok 的 always 会持久到项目，不提供）；ZCode `{decision:'allow'|'deny'}`，不发 `permissionUpdates`（会写项目规则）；Hermes `choice` 为 `once/session/deny`（仅事件 `choices` 含 `session` 时提供会话级，不发 `always`）；OpenCode/MiMo `reply:'once'|'reject'`（`always` 超出会话，不提供）。
- runner 等待期间不阻塞读循环（Codex、Claude、ACP、ZCode）；Hermes 与 HTTP 会话系在事件循环内顺序等待。停止、桥关闭或无答复时回复拒绝；拒绝后正常结束仍为结果待核实（Claude 除外）。
- 等待审批期间暂停空闲时限（合并时接入：`startRunTimers().hold()`，经 `createNativeIO` 的 `onApprovalWait` 持有至决定、停止或关闭；总时限照常）。未做：子会话持有仅在 CLI Worker 面板挂载时有效；所有 CLI 的真实审批往返未实测。
- 真实验收修正（2026-10-28）：Claude Code 2.1.287 只带 `--permission-prompts host` 时不发 `can_use_tool`、需确认的操作被自动拒绝；有审批通道时追加 `--permission-prompt-tool stdio`。传输层在运行器已报 ERROR 时保留其原因，不再以非零退出码的笼统信息覆盖（Claude 拒绝后退出码为 1）。真实往返已覆盖 Codex、Claude、Qoder、Grok、OMP，记录见各变更 tasks.md。

## 2026-10-28 重新启用 CLI 原生功能（未发布）

OpenSpec 变更 `reenable-native-cli-features`（用户「先做 reenable」）。原则：原生功能默认保留，只因两层任务树、账号隔离或无法遵循 DSH 预设而关闭，README 列出关闭项与类别。

- Grok：`GROK_NATIVE_WEB` 打开网页搜索与抓取（去掉 `--disable-web-search`，`GROK_WEB_FETCH=1`、`features.web_fetch = true`）；规划 `--tools` 加 `web_search,web_fetch`；仅可查看的 `[permission] allow` 加 `WebSearch`、`WebFetch`（grok 1.0.62：搜索不询问，抓取非白名单域名会经 ACP 询问，按授权通路处理）。
- Pi：`piOmpNativeTools(cli, mode, access)`，Pi 只在写任务且完全权限时加 `bash`，能力表随之加 `shell`，DSH 命令备选退出目录。
- OMP（16.4.4 核实）：`approvalMode` 为 `always-ask/write/yolo`；`write` 下写入与 bash 经 RPC `extension_ui_request`（`select`，标题 `Allow tool: X…`，选项 `Approve/Deny`）询问，无超时（2026-10-29 更正：按安装包设置说明，`write` 自动批准读与写类工具，只有 bash 等执行类工具询问；`always-ask` 才对写入询问，见下文「Worker 权限三档」）。OMP 写任务在工作区内修改与完全权限下加 `bash`；`--approval-mode` 与 `tools.approvalMode` 按档位取 `write`/`yolo`。桥把审批询问转为 `approval` 帧（bash→command、write/edit→file），Host 经 `BridgeProtocol` 中继并经私有邮箱 `approval` 命令回写，桥回 `extension_ui_response`。拒绝后正常结束为结果待核实；停止或桥关闭时回 Deny。其他交互请求仍取消并判失败。Host 对 OMP 也按审批等待暂停空闲时限。
- OpenCode/MiMo：skill 权限改为 `allow`（替代上节「task/skill/question 仍 deny」中的 skill；各档位，skill 只读取用户指令）；`nativeSkillPaths` 把用户自己的 skill 根目录（`<配置目录>/{skill,skills}`、`~/.opencode|.mimocode/{skill,skills}`、项目 `.opencode|.mimocode/{skill,skills}`，仅现存目录）写入 `skills.paths`。OpenCode 由 Host 写入启动配置；MiMo 由运行器按自身环境计算。外部兼容目录与 Claude 配置导入、项目配置、外部插件保持关闭。
- ZCode：`Skill` 只加载指令、可单独开启，但按设计随子 Agent 决定处理；浏览器 REPL 可执行任意代码，保持关闭。
- 已知隔离缺口（未改）：OpenCode/MiMo 仍会读取 `~/.opencode`、`~/.mimocode` 下的配置；MiMo Worker 环境只经 `firstPartyEnvironment('mimo')`，使用真实配置目录。下节处理。

## 2026-10-28 OpenCode/MiMo 配置隔离（未发布）

OpenSpec 变更 `isolate-opencode-mimo-config`，处理上节记录的缺口。按 opencode 1.19.0、mimocode 0.1.15 内嵌源码核实，并用模拟主目录对真实二进制做前后对比（`debug config`/`debug skill`/`debug paths`，不调用模型）。

- OpenCode：配置目录列表含 `<Global.Path.home>/.opencode`，home 取 `OPENCODE_TEST_HOME ?? os.homedir()`。其中 `opencode.json(c)` 在插件写入的 provider 之后深度合并（可覆盖所选 provider 的地址与密钥、追加 MCP），`command/agent/mode` 被加载，CLI 还在该目录写 `.gitignore` 并安装依赖。`openCodeEnvironment` 在状态目录建私有空目录 `home`（0700）并设 `OPENCODE_TEST_HOME`，Worker、模型发现、登录三处共用。不改 `HOME`，shell 命令仍用真实主目录。`~/.opencode/skill(s)` 仍由 Host 用真实主目录算出，经 `skills.paths` 提供。外部插件此前已由 `OPENCODE_PURE` 在服务端跳过。
- MiMo：每次启动的中间件运行 `claude-import`，把 `~/.claude/projects/*/*.jsonl` 写进 MiMo 数据库（Worker 与模型发现用的是真实数据库）。`firstPartyEnvironment('mimo')` 加 `MIMOCODE_DISABLE_CLAUDE_IMPORT=1`，覆盖模型发现、Worker、分支元数据与登录。已导入的会话不删除。Codex/OpenCode 会话导入只经服务端接口触发，插件不调用。
- 不改：MiMo 项目配置、`~/.mimocode`、真实 HOME/XDG 是 MiMo 自身的账号与模型来源（模型发现认项目级 `provider.apiKey`，`MIMOCODE_DISABLE_PROJECT_CONFIG` 还会去掉项目 AGENTS.md）；MiMo 读取 CLAUDE.md、默认扫描 `.agents` skill 不涉及账号，是否与 OpenCode 统一另行决定。
- 风险：`OPENCODE_TEST_HOME` 名称带 TEST，后续版本若改名，隔离会失效；升级 OpenCode 时按该变更 tasks.md 记录的对比步骤重新核对。

## 2026-10-28 DSH 备选工具审批按轮次来源询问（未发布）

OpenSpec 变更 `relay-harness-tool-approvals`，处理 `relay-native-approvals-to-host` 验收中的发现：Worker 经工具桥调用的 DSH 工具（如 Pi 的备选 bash）自行发起 `approval.request`，经 `dsh-api-remotes` 转给持有子会话的客户端，插件不参与，主 Agent 派出的任务主页面没有提问卡，任务卡也不显示「等待审批」。

- 工具桥 `execute` 把 `cliworker:<callId>` 登记到 `bridgeCalls`（Worker、runId、子 Agent、工具名、参数），结束时删除。Host 以 `ctx.on('approval/request', …, true)` 注册在 Remote 转发者之前，只认领 callId 在 `bridgeCalls` 中且请求方为登记子 Agent 的请求，其他一律 `next()`。
- 认领后经运行时 `harnessApproval` → `trackApproval`（与 CLI 原生请求共用：时间线、`approvalWaiting`、停止撤回）。主 Agent 发起的轮次走 `decideNativeApproval`（父页面 `userQuestions.ask`）；其他轮次先按规划与预设执行 `decideApproval`，需要询问时才 `next()` 交给子会话原生面板，并与停止信号赛跑。摘要为「执行命令（DSH 备选工具 bash）：<命令>」，详情取 DSH 的 `displayReason.zh`，不提供会话级授权。结果映射回 DSH：允许 → `allowed-once`，停止 → `cancelled`，无应答者 → `unavailable`，其余 → `rejected`。
- 未改：工具桥审批等待期间不暂停空闲时限（计时在原生运行器中）；DSH 工具被拒后本轮为「已完成」加诊断，与原生拒绝的「结果待核实」不一致。

## 2026-10-28 授权中继收尾：提问卡分段、命令工具标题、DSH 工具拒绝与空闲时限（未发布）

OpenSpec 变更 `close-approval-relay-gaps`，处理此前 Desktop 验收留下的四个问题。

- 提问卡：DSH 通用提问流程把 `question` 放进标题（换行折叠），`detail` 用 `MarkdownText` 渲染。`approvalQuestion` 的标题改为「<Worker>（<CLI>）请求授权」，摘要、原因、工作目录放进 `detail` 各成一段；CLI 文字经 `literalMarkdown` 转义全部 ASCII 标点、按行硬换行，不会变成链接、格式或 HTML。Worker 会话审批面板仍用 `approvalPrompt` 纯文本。
- 工具块：DSH 工具块参数为空串时以 callId 作摘要。`observedToolInput` 在条目只有字符串 `command`（Codex `commandExecution`）时以 `{ command }` 作参数，实时声明与回放共用。
- 授权被拒的结果（用户 2026-10-28 决定，取代 2026-10-25「额外授权被拒绝后标为结果待核实」）：授权被拒是用户的决定，CLI 自行正常结束的轮次为「已完成」，不显示待核实与横幅，也不附「本轮有 N 个工具步骤失败」；拒绝记录仍在时间线。
  - 原生运行器：`settle(io, response, scope, denied)` 为真时直接 SUCCESS、不带说明；Codex、Hermes、OpenCode/MiMo、ZCode、ACP 的拒绝分支改为传入该标记，Pi/OMP 运行器直接输出 SUCCESS。ACP 无正文仍为待核实（检查在拒绝之前）。Claude Code 拒绝即中断本轮，仍为失败。
  - DSH 备选工具：Host 记录 `task.harnessDeniedRunId`（拒绝且来源不是任务停止）。运行器报 SUCCESS 时不写「本轮结果说明」；报 UNCERTAIN 且为 `LAST_TOOL_FAILED` 时视为被拒工具即最后的失败步骤，按已完成处理；其他 UNCERTAIN、失败、停止按原规则。
  - 其他待核实情况（最后一步工具失败后直接结束、AGY 汇总冲突、ACP 无正文）不变。
- 空闲时限：`task.holdIdle()` 在 DSH 备选工具等待授权时暂停空闲计时。Host 计时的 Pi、OMP 与 CLI 原生审批共用 `holdHostIdle`；运行器计时的 CLI 只在启用空闲时限时经该轮审批邮箱发送 `idle-<n>:hold` / `idle-<n>:release`（邮箱同 id 只收一种内容），`release` 等 `hold` 回执后再发；`native-bridge.mjs` 交给 `createIdleHolds`，先到的 `release` 作废该键。审批邮箱每轮 200 次提交上限由授权回复与此共享。
- 工具桥等待上限（验收中发现）：载体客户端原用 Node `fetch`，300 秒收不到响应头即放弃，Host 等工具结束才回复，所以等待授权超过 5 分钟的调用会失败，提问卡却仍留着，之后允许仍会执行。客户端改用 `node:http`（无响应等待上限）；Host 账本按等待中的请求计数，响应未写完即关闭且计数归零时中止该调用，授权提问随之撤回。

## 2026-10-29 Worker 权限三档（未发布）

OpenSpec 变更 `worker-permission-levels`（用户 2026-10-28/29 决定）。替代上文「CLI 权限跟随 DSH 预设」中按主对话档位直接选原生模式、仅可查看一律以规划启动的做法。

- 档位模型：`Worker.level`（`ask | auto | full`，可选，缺省视为 `full` 即跟随主对话）。实际档位 = min(选择, 主对话上限)，上限为仅可查看 → ask、工作区内修改 → auto、完全权限 → full。适配器与运行器仍收 `(mode, access)`，`access` 改为实际档位（ask → read-only、auto → workspace-write、full → danger-full-access），新组合 `accept-edits + read-only` 表示第一项。`worker.mode` 只作规划开关，存储无迁移。
- 菜单与 RPC：`permissionForWorker` 返回 `{ currentValue, options, plan: { supported, active }, writable }`，选项只含不高于上限的档位，受限时说明追加「主对话为…，最高可选…」。Client 把档位映射为 DSH 预设值（ask → read-only、auto → workspace-write、full → danger-full-access）以复用原生图标与完全权限确认；`configureWorkerPermission` 接受档位或规划开关，超上限拒绝保存。`/plan` 只开关规划，`/permission` 列档位。
- 名称（`src/shared/worker-permissions.ts`）：第一项一般为「询问」（OpenCode/MiMo 命令一律先问）；Kimi「仅工作区编辑」（原生 default 自动批准 Git 仓库内 Write/Edit，`git-cwd-write-approve` 无注入入口）、Antigravity「仅规划」、Pi「只读」，Hermes 无第一项。中档一般为「自动审批」；ZCode、OpenCode「仅工作区编辑」，OMP、Pi「自动批准编辑」。仅可查看下 Kimi、Antigravity、Hermes 不列档位并拒绝派遣（`runsUnderViewOnly`）。
- 审批判定：规划 → 拒；实际档位 full 且主对话 `never` → 放行；非 ask 且 `never` → 拒；其余询问（按轮次来源）。子会话 DSH 沙箱跟随实际档位，审批策略仅在 full 时跟随主对话，否则为 `ask`。
- 原生映射（安装版本核实，详见变更 design.md 第 6 节）：Codex `read-only/workspace-write/danger-full-access` + `approvals_reviewer` user/`auto_review`；Claude `manual/auto/bypassPermissions`，拒绝改为 `interrupt:false` 不中断本轮；Kimi ACP `default/yolo/auto`；Qoder/CN `default/auto/bypass_permissions`（ACP `yolo`）；Grok 私有配置 `ui.permission_mode` ask（加 `ask=[Bash, Edit, Write]`）/ auto，完全权限 `--always-approve`；ZCode `build/edit/yolo`；Hermes `approvals.mode` smart/off（YOLO 0/1）；Antigravity `--mode plan/auto`，完全权限 `accept-edits` + 跳过确认 + 关闭终端沙箱；OpenCode `edit/bash/external_directory` ask 或 allow；MiMo 同 OpenCode 询问规则 + HTTP `skip-all`/`auto-approve-delete` 开关；Pi 读工具 / +write,edit / +bash；OMP `--approval-mode always-ask/write/yolo` 并开放 bash。
- 降级：目标模式缺失或回读不符时按更严一档运行并写诊断，第一项不可确认则拒绝启动。Antigravity、OMP 每轮先跑 `--help` 确认模式目录。降级不回传 Host，审批仍按实际档位判定，只会更严。
- 时间线「本轮权限：<CLI 档位名>」，受主对话限制时附「（受主对话限制）」。删除了 Kimi/Hermes/Antigravity「没有已确认的原生完全权限模式」提示（三者现均有原生完全权限）。
- 同日修订（取消上限与 Pi 询问）：用户看到工作区内修改下 Pi 菜单只剩两项后决定菜单一直列出三项，用户选的档位按所选运行（含主 Agent 派遣与续聊），主 Agent 不另询问；Pi 第一项改为「询问」。上文的上限、超上限拒绝保存与「（受主对话限制）」均已删除：
  - 实际档位 = `level ?? 跟随值`（仅可查看 → ask、工作区内修改 → auto、完全权限 → full）；Worker 有档位时跳过仅可查看下的派遣拒绝。
  - `workerApproval`：Worker 为 full 时，主对话也为 full 则沿用其审批策略，否则为 `never`（残余请求与子会话 DSH 备选工具自动放行）；非 full 为 `ask`。
  - Pi：新增 `src/host/pi-permission-gate.mjs`，询问与自动批准编辑以 `--extension` 加载（`--no-extensions` 下显式路径仍加载）。扩展用 Pi 1.0.4 文档化的 `tool_call` 返回 `{ block, reason }`，不在放行清单（询问：`read/grep/find/ls`；自动批准编辑另加 `write/edit`；DSH 备选工具自行审批）的调用经 RPC `confirm` 交桥转 Host 审批，未批准或出错即阻止。确认只带工具名、命令、路径、编辑处数与字节数，标题带每轮 nonce。扩展经 fd 3 报告就绪，桥在就绪前不发提示，5 秒未就绪报错。安装版缺少接口时询问档以只读工具运行、自动批准编辑不开 bash 并在时间线说明。三档都开放原生 `write/edit/bash`，由扩展拦截；完全权限不加载扩展。Pi 因此改走 `BridgeProtocol` 审批转发。
- 运行时降级（变更 `fix-runtime-permission-fallback`，2026-10-29 Mac 实测后）：Claude 在发送任务前只在本地记下会话 ID，任务发出后才向 Host 绑定，初始化回读后改用询问模式重启时不再撞会话身份，续聊也不会恢复从未收到任务的会话。Antigravity 的 `--help` 总列出 `auto`，账号不支持时 agy 约 1.2 秒内在 stderr 警告并回到会自动拒绝工具的无头默认模式；插件在发送任务前最多观察 5 秒，识别到即结束原进程、按 help 缺 `auto` 的同一降级参数重启；任务发出后才出现警告则停止本轮，不重发。不保存跨运行的账号能力缓存。

## 2026-10-29 CLI 内部子 Agent 与记忆（未发布）

OpenSpec 变更 `reenable-native-cli-features` 任务 5.1/5.2（用户 2026-10-29 决定：「内部子agent不启用，然后记忆要启用」，随后补充「记忆要看原生cli默认有没有开启，如果用户在之前的cli里开启了记忆那就启用记忆，如果用户之前没管理过，那就不开启」；记忆位置选「与直接使用共用」，OMP 选「保持关闭并记理由」，ZCode 选「一起核实并启用」）。

- 子 Agent：Grok `--no-subagents`/`[subagents] enabled = false`/`GROK_SUBAGENTS=0`、ZCode Agent/Task/SendMessage/工作流保持关闭（两层任务树）。ZCode `Skill` 按原设计随子 Agent 决定一起保留关闭。Claude Task、Codex 多 Agent 不在本次调整。
- 判定规则：Worker 的记忆开关等于用户原生 CLI 当前生效的设置；用户设置优先，未设置时取该 CLI 的默认值。插件只读开关字段，不读凭据文件。
  - Grok（1.0.62 内置文档）：`~/.grok/requirements.toml` → `GROK_MEMORY`（Host 进程环境）→ `~/.grok/config.toml`，各文件中 `[memory_v2] enabled` 优先于 `[memory] enabled`；默认关闭。远端托管设置不可见，按未设置。`grokTomlMemory` 只认表头与点分键下的布尔值，其余写法按未设置（即关闭）。
  - Hermes：所选账号 `HERMES_HOME/config.yaml` 的 `memory.memory_enabled`、`memory.user_profile_enabled`，缺省为开（hermes-agent `get_builtin_memory_store_flags`），并带上 `memory_char_limit`、`user_char_limit`、`nudge_interval`。外部记忆服务需要插件，仍关闭。
  - ZCode：桌面端 `~/.zcode/v2/setting.json` 的 `memoryEnabled`（schema 默认 false）。ZCode CLI 自身默认 `features.memory = true`，但桌面客户端通过 `session/requestRuntimePreferences` 回复用户开关；Worker 桥同样回复，值由 adapter 经私有环境变量 `CLIWORKER_ZCODE_NATIVE_MEMORY` 交给桥，桥在启动 CLI 前删除。分支与元数据操作不发模型任务，仍回复关闭。
- 共用方式：Worker 各自的私有目录（`native/<Worker>`）不复制记忆，而是把私有记忆路径换成指向原生目录的链接（Windows 用 junction）：Grok `<GROK_HOME>/memory-v2` → `~/.grok/memory-v2`；Hermes `hermes-http-home/memories` → `<账号 HERMES_HOME>/memories`，并给 `api_server` 工具集加 `memory`；ZCode `<ZCODE_STORAGE_DIR>/cli/memories` → `<原生存储目录>/cli/memories`（`ZCODE_STORAGE_DIR` 或 `~/.zcode`）。链接先建临时名再改名发布；原有空目录直接替换，含文件的目录改名保留；关闭时只删除链接。旧通路 Hermes 直接使用账号目录，不受影响；旧通路 ZCode 只建链接，不传开关。
- 后台整理：Grok 每轮后后台捕获并定期整理（Dream），所用模型文档未写明；Hermes 按 `nudge_interval` 用同一模型复盘；ZCode 用本轮模型提取。均为 CLI 原生行为，可能额外消耗额度。
- OMP：保持 `memory.backend: off`。本地记忆按 `agent.db`（Worker 私有，含账号）里的会话整理，第二阶段把记忆目录整份重写为本库结果，与原生或其他 Worker 共用会互相覆盖；只在单个 Worker 内打开又基本不会触发（只整理闲置足够久的旧会话）。整理模型取 `smol` 角色。

## 2026-10-30 Windows 登录窗口桥接与系统代理（未发布）

OpenSpec 变更 `fix-windows-account-login-bridge`（用户 2026-10-29 报告 ZCode/Grok/OMP/Pi/OpenCode 登录与终端启动问题，2026-10-30 报告 Codex 无可用模型；代理处理方式由用户选择「插件自动处理」）。

- 系统代理：Windows 代理软件通常只打开「Internet 选项」开关（WinINET），不导出 `HTTP(S)_PROXY`；macOS 由 launchd 导出，DSH 与 CLI 直接继承。`WindowsSystemProxySource` 用 `reg.exe query` 读 `HKCU\…\Internet Settings`（5 秒超时、64 KB 上限、15 秒 TTL；读取失败即视为无代理，不沿用旧值），只接受单一 `host:port` 或 `https=`/`http=` 项。`nativeProcessBackend` 的 `systemProxy` 选项只在 Host 入口于 win32 注入：环境与 spec 都没有决定代理时，给任务进程（用 `current()`，不阻塞启动）和账号终端（用 `fresh()`）补 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`。`NO_PROXY` 合并继承值、回环地址与 `ProxyOverride` 中主机/前导通配项，统一一种拼写；`<local>`、`10.*` 无法表达，不转换。
- Host 查询：`host-fetch.mjs` 的 `hostFetch` 按同一规则判断 HTTPS 目标是否走代理，走代理时用 Node `https.Agent({ proxyEnv })` 以 CONNECT 建隧道（TLS 仍终止在目标；DSH Electron 内置 Node 24 与本机 Node 22.23 均已实测支持），只承载无请求体的 GET；否则调用全局 `fetch`。账号模型目录（`probeAccountModels`：Codex、Pi、OpenCode、Hermes、ZCode、Kimi 等）、Grok、Hermes Nous、Kimi OAuth 的默认 fetcher 改为 `hostFetch`；测试注入的 fetcher 不变。Pi/OMP 桥是子进程，拿不到 Host 的查询函数，Windows 上改读 Host 注入给它的 `HTTPS_PROXY`/`NO_PROXY`（仅 http/https 代理，`*` 全部直连）；用户自己导出代理变量时 Host 查询也按这组变量。macOS 仍直接用 `fetch`。Codex 子任务曾把目录改为只读本地缓存，与「远端账号目录确认模型」的规格冲突，已撤回。
- 登录引导：`FlowGuide` 改用有界 VT 屏幕（`GuideScreen`，最多 500×200），处理 CUP/CUF/擦除/折行/备用屏幕；`has()` 只看当前屏幕，链接取当前屏幕文本与 OSC 8 目标（只保留白名单域名），设备码须整段在屏。启动结果带 Host 终端尺寸，隐藏的 xterm 按此初始化，避免光标坐标错位。CLI 尚未画出文字时不判定为改用原生终端。
- 终端启动：基线（模拟 CLI，3 次）启动到首屏中位数 7.58 秒，其中 ConPTY 等待首个设备属性查询的回应约 4.3 秒、`Get-CimInstance` 校验父进程约 1.3 秒。现由 Host 以 xterm 身份回应首个 `CSI c` 并从回放中去掉该查询，父进程改用 Toolhelp 快照（持有进程句柄防 PID 复用）；优化后中位数 1.50 秒，进程与临时目录均清理。
- 登录域名：OpenCode（`auth.openai.com`）与 Hermes Nous（`portal.nousresearch.com`）此前只写在流程内，客户端按共享 `ACCOUNT_LOGIN_HOSTS` 再查一次会把链接过滤掉；现统一登记。
- MiMo 模型缓存（同日用户追加）：插件读取 MiMo 元数据与运行任务时都设 `MIMOCODE_DISABLE_MODELS_FETCH=1`（2026-10-08 账号隔离改造引入），MiMo 只用自己的 models.dev 缓存；缓存一旦存在就优先于程序内置列表。Windows 上该缓存停在 2026-06-19（只有 v2.5），账号目录已只给 v2.6，交集为空。`discoverMimoModels` 在账号目录可读且交集为空时运行一次 MiMo 自带的 `models --refresh`（显式刷新不受该环境变量限制，同一可执行文件 10 分钟内最多一次），清空 `mimoMetadataCache` 后重读；仍对不上时报不一致，不按账号目录猜模型或强度。刷新写的是 MiMo 自己的缓存，与原生 MiMo 正常启动时的行为相同；不改用户配置与凭据。
- 未确认：ZCode 登录后仍显示「已配置」的根因（最可能是 OAuth 结果未写入插件私有凭据目录而回落到原生 API 配置），文案已改为「账号绑定未确认，请重新登录」，待新包复测。
