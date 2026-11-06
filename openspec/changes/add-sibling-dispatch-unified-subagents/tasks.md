# Tasks

## 1. 同级派遣（Host）

- [x] 1.1 `cliworker_start`／`cliworker_status` 接受主对话直接子 Agent 的调用：解析主对话 Agent，以主对话为派遣主体；第三层或主对话不可解析时拒绝；规划模式与仅可查看规则以主对话为准。
  - 2026-11-05：`corepack pnpm test tests/sibling-dispatch.test.ts tests/dispatch-flow.test.ts tests/routing.test.ts tests/qoder-routing.test.ts tests/worker-permissions.test.ts` 纳入下述最终 19 文件 / 548 项通过的集合；覆盖 Worker/DSH 直接子会话主体、第三层/父会话不可用、主对话规划与仅可查看、只读非阻塞状态查询。模拟会话与工具注册器，不是 Desktop 验收。
  - 主会话复核（2026-11-05）：`dispatchSubject` 原先只查已常驻的 Agent，后台 Worker 在主对话 Agent 未常驻时会被误拒。现改为先按原生 Remote Agent 的解析方式（`typert.lookups.get('agent').resolve`）加载再判断。`role-dispatch` 测试原本依赖单次微任务时序，改为等待条件成立。复跑 typecheck 0 错误；sibling-dispatch、role-dispatch、dispatch-flow、routing、core 共 145 项通过。未覆盖：「主对话 Agent 未常驻」的专门测试。
- [x] 1.2 Worker 记录新增可选 `initiator`，持久化并随快照下发；旧记录兼容。
  - `corepack pnpm test tests/core.test.ts tests/dispatch-storage.test.ts` 纳入最终通过集合；新增 initiator 落盘后重载、旧记录无字段兼容、快照透传，以及停止/删除发起者不连带同级 Worker 的模拟进程回归。面板标注留给 3.2。
- [x] 1.3 选型与原生审批询问按发起者当前轮的位置显示；发起者提供的模型、强度、角色、会话 ID 字段不生效；新 Worker 按自身档位规则。
  - `corepack pnpm test tests/sibling-dispatch.test.ts tests/role-dispatch.test.ts tests/dispatch-flow.test.ts tests/native-approval-relay.test.ts` 纳入最终通过集合；覆盖选型取消、用户选型字段不可由调用参数覆盖、不继承发起者完全权限、选型写入主对话、主页面/发起者子会话审批位置。位置按 runId 保存，结束时清理；未做真实 CLI 审批往返。
- [x] 1.4 子 Agent 发起且未结束的 Worker 每个主对话最多 6 个，超出返回明确错误；计入全局并发排队。
  - `corepack pnpm test tests/core.test.ts tests/sibling-dispatch.test.ts` 纳入最终通过集合；运行时同步受理核验 6 个上限，超额不创建 Worker；全局并发排队、按主对话隔离、结束释放名额、旧同级 Worker 续聊重新计数通过。停止清理尚未完成的 stopping 状态仍按未结束计数。
- [x] 1.5 工具桥精确放行 `cliworker_start`、`cliworker_status`，其余派遣与多 Agent 工具仍拒绝；入口指引对子 Agent 给出同级派遣说明。
  - `corepack pnpm test tests/native-harness-tools.test.ts tests/cli-native-capabilities.test.ts tests/native-harness-executor.test.ts tests/native-harness-extended.test.ts tests/sibling-dispatch.test.ts tests/routing.test.ts` 纳入最终通过集合；精确放行、前后缀/别名拒绝和真实 DSH 0.2.2-rc.1 scoped schemas 检查通过。原生子 scope 默认已可见两个全局插件工具，不增加覆盖用户/preset 显式工具限制的注册。首次沙箱运行 native-harness-tools 的 31 个 HTTP 用例受 `listen EPERM 127.0.0.1` 阻塞；获准沙箱外重跑 4 个工具桥关联文件 115/115，通过后的最终合并运行亦通过。新增 `harness-model-guard.test.ts` 验证已授权同级 job 发布时退出旧工具的 AsyncLocalStorage 标记，避免新 Worker 原生会话被额外模型守卫误拦截；调用方与新 Worker 的工具守卫仍有效。

## 2. CLI 原生子 Agent

- [x] 2.1 Grok：移除固定的 `--no-subagents`、`[subagents] enabled = false`、`GROK_SUBAGENTS=0`，改为跟随用户原生生效设置（须有默认值证据）。
  - `corepack pnpm test tests/grok-adapter.test.ts tests/cli-native-capabilities.test.ts` 纳入最终通过集合；默认启用、原生关闭、requirements > env > config 优先级、首轮/恢复参数通过。静态读取已安装 `/Users/leeyl/.grok/downloads/grok-1.0.62-macos-aarch64` 的内嵌配置参考，明确 `subagents.enabled` 默认 true；SHA-256 `ec434e831afdcfce87780f2815fd732b1df8a4a8de96a491716ad75d13605a4e`。没有运行 Grok 或模型，远端托管设置不可读取，按未设置处理。
- [x] 2.2 ZCode：Agent、Task、SendMessage、工作流与 Skill 跟随原生设置；续聊参数校验接受相同列表。
  - `corepack pnpm test tests/zcode-adapter.test.ts tests/native-zcode.test.ts tests/zcode-resume.test.ts` 纳入最终通过集合；原生用户开关、Task 单独关闭、工作流三种模式、首轮/恢复同列表、非法列表拒绝通过。静态读取 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`：默认配置 features.subagent/skill 为 true、permission.disallowedTools 为空；resolveDynamicWorkflowClientConfig 默认 disabled，用户 dynamicWorkflowMode 覆盖环境提供值。SHA-256 `9afd565a104d660259e6bdeeaa5cb8abc74a908559e21aa3c5f6a06f2a9da6c6`。保留浏览器 REPL 的 DSH 权限关闭项；未读取到远端托管模式，不猜测。没有运行已安装 ZCode、真实账号或模型。
- [x] 2.3 README（中英）关闭项列表与 `doc/design.md` 同步；删除「两层任务树」关闭类别。
  - README.md、README.en.md 的关闭项和同级派遣/原生子 Agent 规则、doc/design.md 的简短设计条目已同步。`corepack pnpm typecheck` 通过（DSH 0.2.2-rc.1）；`corepack pnpm build:preview` 通过，产物 `.cache/preview-package`，未运行正式构建、未更新 Desktop 链接。最终测试命令见下；未做 Desktop、Windows、真实 CLI/模型验收。`corepack pnpm spec validate add-sibling-dispatch-unified-subagents --strict --no-interactive` 与 `git diff --check` 通过；apply 状态为 8/17，未勾选 3–5 节。

  - 最终关联测试（本地模拟，HTTP 工具桥获准在沙箱外监听）：`corepack pnpm test tests/sibling-dispatch.test.ts tests/role-dispatch.test.ts tests/dispatch-flow.test.ts tests/dispatch-storage.test.ts tests/core.test.ts tests/routing.test.ts tests/qoder-routing.test.ts tests/grok-adapter.test.ts tests/zcode-adapter.test.ts tests/native-zcode.test.ts tests/zcode-resume.test.ts tests/native-approval-relay.test.ts tests/worker-permissions.test.ts tests/native-harness-tools.test.ts tests/cli-native-capabilities.test.ts tests/native-harness-executor.test.ts tests/native-harness-extended.test.ts tests/harness-model-guard.test.ts tests/harness-service-integration.test.ts` → 19 文件、548 项通过。输出 `/tmp/cwn-final-tests.log`；类型检查 `/tmp/cwn-typecheck.log`；隔离构建 `/tmp/cwn-preview.log`。

## 3. DSH 子 Agent 汇入

- [x] 3.1 Host：DSH 子 Agent 列表、状态、续聊、停止的 Gateway 接口；排除 CLI Worker 子会话；隐藏集合私有存储。
  - 新增 `DshSubagents` 与 5 个 Gateway 方法；公开 `listChildren` + `sessionQuery.observeSession` 投影读取，排除全部 Worker/原生绑定 ID；`dsh-hidden.json` 按主会话隔离，0700/0600，不调用 DSH 删除接口。目录服务/父投影不可用返回空组并记录去重日志；单个子投影不可读保留未知状态。
  - 状态使用 `subagentTiming.active/lastTurnCompleted`，模型仅取 `modelSelection.next/lastUsed`。false 只证明非正常结束，不能区分错误与中断；仅插件中断已受理且公开投影已结束时显示「已停止」，绑定同一游标。30 秒未确认、查询失败或原生中断失败均报错。列表依原生 `session/event` 刷新；无事件源的适配器仅在可见面板所持流内轮询，流/插件释放时清理订阅与计时器。
  - 最终关联命令（明确标注模拟，未运行真实 CLI/模型）：`corepack pnpm test tests/dsh-subagents.test.ts tests/dsh-subagents-client.test.tsx tests/general-settings.test.ts tests/panel.test.tsx tests/settings-dialog.test.tsx tests/harness-native-controls.test.tsx tests/harness-native-commands.test.ts tests/client-conversation-features.test.tsx tests/harness-conversation.test.tsx tests/harness-conversation.test.ts tests/harness-conversation-stream.test.ts tests/harness-conversation-official.test.ts tests/panel-native-composer.test.tsx tests/sibling-dispatch.test.ts tests/core.test.ts tests/harness-service-integration.test.ts` → 16 文件，612 项通过、1 项跳过；日志 `/tmp/cwn-section3-tests.log`。包括列表排除、隐藏重载/权限、未知状态、模式限制、续聊错误、停止等待/失败/超时与卸载清理。此轮所选回归没有 localhost 监听失败或沙箱外执行。
  - 跳过项：`harness-conversation-stream.test.ts` 的可选官方 turn-process 源码回归，因 `.cache/dsh-host-source-rc2/.../turn-process.ts` 不存在且未指定 `CWN_TEST_HARNESS_SOURCE`；不补取、不修改宿主源码。未做真实 DSH 子 Agent/账号/模型、Desktop 与 Windows 验收。
- [x] 3.2 Client：CLI Worker 窗口「DSH」分组、搜索与筛选；Worker 卡片「由 X 发起」标注。
  - 上述最终关联回归中的 `panel.test.tsx` 验证 DSH 与 CLI 同级、搜索名称/模型、全部/进行中/已完成/异常筛选、未知状态、插件隐藏与服务失败不阻断 Worker；发起者名称保留原文并以普通文字显示，不嵌套。修正卡片网格，发起者文字使用独立第三行，避免覆盖原有模型行。
  - `useDshSubagents` 独立消费 Gateway 流，依据宿主 `tab.visible`、文档可见性及设置持有/释放；已保存开关由初始 Worker 快照确定后再读取 DSH。模拟测试验证隐藏/重新显示、卸载、轮询清理和过期响应隔离。未做浏览器/桌面视觉验收。
- [x] 3.3 Client：点开 DSH 子 Agent 复用子会话窗口；按模式开放续聊与停止。
  - 同一 `cliworker.native.sidebar`、SessionProvider、原生 InputBar 与统计；不发布 Worker 绑定或替换 DSH 统计投影。原生 Session.prompt 已走 `subagents.prompt`，保留其输入/队列行为；停止公开 action 转到等待确认的 Gateway。只对当前 DSH 窗口隐藏模型/权限/规划与 Worker 任务选项，普通会话不变；返回列表释放原生引用和观察器。
  - 上述最终关联回归中的 `dsh-subagents-client.test.tsx`、原生控件/会话与面板文件验证精确子 ID、原生组件复用、一次性/未知模式只读、停止失败反馈、其他会话控件不受影响及释放；fixture 明确为模拟。`external` 目录项没有本地 Session，保持未知、只可隐藏，打开按钮给出原因并禁用。原生父 Agent 离线或容量拒绝仍可能阻止续聊；未验证真实 DSH 发送、停止和统计。
- [x] 3.4 设置：「在 CLI Worker 窗口显示 DSH 子 Agent」开关，默认开启；同步 `doc/settings-ui-design.md`（如有新参数）。
  - `showDshSubagents` 通过现有通用设置 schema/Host 持久化/Worker 快照保存同步，缺省 true，关闭立即撤下 DSH 分组及已打开子窗口，开启恢复；没有新增 CLI 连接。沿用原生 Switch 与既有行样式，没有新增设计参数；中英 i18n、README.md、README.en.md、doc/design.md、doc/settings-ui-design.md 已同步。
  - 上述最终关联回归中的 `general-settings.test.ts`、`settings-dialog.test.tsx`、`panel.test.tsx` 验证升级缺省、双向保存、落盘重载及快照同步。`corepack pnpm typecheck` → Host/Client 对 DSH 0.2.2-rc.1 通过，日志 `/tmp/cwn-section3-typecheck.log`；`corepack pnpm build:preview` → `.cache/preview-package` 构建成功，含新 Gateway 声明，日志 `/tmp/cwn-section3-preview.log`；`corepack pnpm spec validate add-sibling-dispatch-unified-subagents --strict --no-interactive` 与 `git diff --check` 通过，规格日志 `/tmp/cwn-section3-spec.log`。
  - 未正式 build、未启动/退出 Desktop、未触碰用户 `~/.dsh`，未提交或推送；第 4–5 节保持未勾选。

## 4. 自动检查

- [x] 4.1 测试：同级派遣（主体解析、第三层拒绝、规划模式、仅可查看、选型取消、档位不继承、上限、发起者停止不连带）、工具桥放行与别名拒绝、Grok/ZCode 参数与续聊、DSH 列表排除与隐藏、开关、打开与停止。
  - 新增 `tests/sibling-dispatch.test.ts`、`tests/dsh-subagents.test.ts`、`tests/dsh-subagents-client.test.tsx`（模拟夹具）；调整 core、dispatch-flow、grok-adapter、harness-model-guard、native-approval-relay、native-harness-tools、native-zcode、qoder-routing、role-dispatch、routing、zcode-adapter、zcode-resume、general-settings、panel、settings-dialog 等测试。结果见 4.2 的全量运行。未覆盖：主对话 Agent 未常驻时的专门测试。
- [x] 4.2 `pnpm typecheck`、关联 vitest、`pnpm spec:check`、`pnpm build:preview`。
  - 主会话复跑（2026-11-05 21:58，两部分合并后）：`corepack pnpm typecheck` 0 错误。全量 `vitest run --maxWorkers=2`（沙箱外运行，HTTP 桥测试需监听 127.0.0.1）：260 个文件中 256 通过、4 跳过，5502 项通过、14 项跳过、0 失败。`build:preview` 成功（`.cache/preview-package`）。`spec validate --all --strict` 51 项全部通过；`git diff --check` 无问题。
  - 主会话审查 `src/host/dsh-subagents.ts`：列表排除插件登记的 CLI Worker 子会话与隐藏集合；状态只取 `subagentTiming`，缺失时显示 unknown；停止须经中断确认并观察到子会话结束（30 秒上限，超时报错）；无事件来源时才每 2 秒刷新一次，退出时清理定时器。

## 5. Desktop 与真实验收

- [x] 5.1 Mac Desktop：无活动任务时退出 Desktop，再正式构建并重启；核对 DSH 分组、开关、发起者标注与设置页。
  - 2026-11-05：Host 空闲、无子进程、3 分钟内无会话写入。正常退出（0 进程）后执行 `pnpm build`，带 `--force-renderer-accessibility` 重启：5 个进程，没有新的崩溃日志，profile 插件列表完整。
  - Codex gpt-6-astra high 界面核对（只操作 DSH 窗口，每张截图前先把窗口提到最前）：主界面无冲突；新开关「在 CLI Worker 窗口显示 DSH 子 Agent」存在且默认开启，样式与相邻开关一致（主会话已看截图 `v087-03-settings-style.png`）；「CLI 连接」没有 DSH 条目；关闭再开启并重开设置后仍为开启；现有 Worker 卡片、四个筛选与搜索正常。截图 `.test-data/mac-desktop-20261105/v087-*.png`。
  - 未覆盖：抽查的 5 个主对话都没有 DSH 原生子 Agent，所以 DSH 分组、打开、续聊、停止与开关的显隐效果都没有实机核对；也没有「由 X 发起」的实例。这两项都需要真实模型调用才能产生。
- [x] 5.2 真实模型（需用户授权）：Codex 发起 Claude Code 同级派遣；Antigravity 生图子 Agent；Grok 原生子 Agent；DSH 子 Agent 打开、续聊与停止。检查事件、退出状态与实际产物。
  - 2026-11-05 Mac（用户授权真实调用；Codex gpt-6-astra high 用 Computer Use 只操作 DSH 窗口；工作区 `cliworker-isolation-test`，新对话「用DSH原生子Agent统计cwn-开头文件数量」，主模型 GLM-5.3 默认）：
    - A DSH 子 Agent：通过。CLI Worker 窗口出现 DSH 分组，含 1 个条目「统计 cwn- 开头文件数量」（已完成，27 秒）。打开后是与 CLI 子会话相同的右侧子会话布局，有真实对话与统计（1 轮/3 步，68.7K tok）。开关关闭后分组消失，显示空状态；打开后恢复，最后保持开启。续聊只确认了输入框可编辑，没有实际发送；停止未测。
    - B 同级派遣（Codex → Claude Code）：受阻。codex-1（gpt-6-luna low，completed）调用了 `cliworker_start`，Host 返回「Claude 官方账号未登录，请使用原生登录」，所以没有生成 Claude Worker，也没有「由 X 发起」实例；磁盘上没有 sibling-087.txt。由此只证明 Worker 能看到并调用工具，请求能到达 Host 派遣路径。
    - C Antigravity：通过但未覆盖生图路径。agy-1（gemini-3.8-flash-low，completed）没有调用生图工具或子 Agent，而是用两次 `python3 -c` 写出 PNG（第一次沙箱 PermissionError，第二次 agy 自行 `BypassSandbox: true` 后退出码 0）。磁盘核对：`agy-image-087.png` 为 16×16 RGBA PNG，在起始标记之后生成；没有出现额外的 Worker。
    - D Grok 原生子 Agent：通过。grok-1（grok-4.6 low，completed）对话中有两个 Task（读 a.txt、b.txt）和一个 TaskOutput，结果为 a.txt=`alpha/one`、b.txt=`beta/two`，与文件一致。Grok 内部子 Agent 没有在窗口里新增条目；窗口最终为 DSH、Antigravity、Codex、Grok Build 四组，各 1 条。
    - B 重测（Codex → Grok，22:53）：通过。新对话「通过Codex调用Grok创建sibling文件」。codex-1（gpt-6-luna low）和 grok-1（grok-4.6 low）都是 completed，在窗口中以两个同级分组显示，Grok 没有嵌套在 Codex 下；grok-1 标注为「由 codex-1 发起」，codex-1 没有标注。两张选型卡都出现在主对话的问题卡片里（选「沿用」）；等待期间 Worker 面板显示「等待确认设定。请在主对话的问题卡片中选择。」。Codex 当时仍在项目目录运行，而 Mac 上开启了「同目录写任务并行」，所以 Grok 写进了插件隔离副本；主 Agent 等 Codex 结束后用 cliworker_merge 合并。磁盘核对：`sibling-087.txt` 内容为 `sibling-ok\n`（11 字节）。grok-1 记录有 `initiator: {kind: worker, name: codex-1}`，与 codex-1 的 `parentSessionId` 相同，隔离状态为 released。截图 `real-087-B2-*.png`。
    - A2 续聊 DSH 子 Agent：通过。在 CLI Worker 窗口打开「统计 cwn- 开头文件数量」，输入框可用、没有只读提示。发送「请再告诉我 a.txt 文件的第一行是什么。」后，状态从「深度求索中」变为「已完成，用时 16秒」，子会话新增一轮，回复为 a.txt 第一行是 alpha，与文件一致。主对话收到「收到任务消息／子任务状态更新」，属于 DSH 原生的子会话回传。截图 `real-087-A2-continue-*.png`。
    - A3 停止 DSH 子 Agent：通过。主 Agent 用 DSH 子 Agent 执行 `sleep 180`，DSH 分组显示「运行中」（glm-5.3）。在子会话输入区点「停止生成」后，约 0.9 秒显示「正在停止」，15.8 秒内显示「已停止」（实际切换时刻没有捕获，15.8 秒是上限）。列表与重开后的子会话都显示已停止，发送按钮禁用。主对话报告该子 Agent 在完成前被停止。23:05 核对本机没有残留的 `sleep 180` 进程。截图 `real-087-A3-stop-*.png`。
    - Worker 记录（`~/.dsh/cliworker-now/*.worker.json`，起始标记之后共 3 份）的 status、observedModel、lastResult 与界面一致。截图 `.test-data/mac-desktop-20261105/real-087-*.png`（13 张）。
  - 2026-11-05 Windows（DSH 0.2.2-rc.1）：
    - 安装：用 `dsh.cmd` 原生安装器装入同一隔离包 `preview-087-20261105-222248.tgz`（sha256 `b88c3a14…7228d23`）。安装前 0 个活动 Worker，安装后 957 个包文件哈希一致，带 `--force-renderer-accessibility` 在交互会话 25 启动，没有插件报错。证据 `.test-data/windows-remote/desktop-audit/install-087-20261105-222248.json`。
    - 测试方式：Codex gpt-6-astra high 用 Windows Computer Use 操作；新对话「DSH 子 Agent 读取 grok-a-087.txt」，主模型 GLM-5.3-Flash 默认；工作区 `C:\Users\admin\cw081f1\live-codex`。截图在 `.test-data/windows-remote/desktop-audit/real-087-screens/`（17 张）。
    - A DSH 子 Agent：通过。DSH 分组出现条目「读取 grok-a-087.txt 内容」（glm-5.3-flash，已完成），打开后是同样的子会话区域，显示真实提示与回复 alpha/one。开关关闭后条目消失，打开后恢复。
    - B 同级派遣：没有执行。主 Agent（GLM-5.3-Flash）认为「CLI Worker 的派遣只能由主对话发起…嵌套派遣会被拒绝」，没有调用 `cliworker_start`。提示文本里已写明「主对话的直接子 Agent 可以调用 cliworker_start 同级派遣」，Mac 上的 GLM-5.3 也照此执行了，所以这里是较弱模型对「第三层调用拒绝」的误读；措辞需要明确 CLI Worker 本身就是可以同级派遣的直接子 Agent。
    - C Antigravity：失败，发现缺陷。agy-1 调用了原生 `invoke_subagent`（TypeName `image-generator`）。该工具异步执行，立即标为 completed，agy 主回合随即以 `end_turn` 结束，回复「已派发给生图代理，生成后通知你」。`native-acp.mjs` 在回合结束后关闭 stdio（`peer.close()`），后台的生图子 Agent 随之丢失；原始协议流在 `end_turn` 后再无更新，工作区没有生成 `agy-image-087.png`。主 Agent 自动续聊后，agy 改为请求 `python -c "import PIL"`，测试规则拒绝了该请求，最终状态为「结果待核实（CLI 未返回可核查的本轮正文）」。事件日志已拷回 `.test-data/windows-remote/desktop-audit/agy-087/`。
    - D Grok：受阻。`cliworker_start` 返回「登录需要续期，请打开 Grok」，没有创建 Worker；需要用户在 Windows 上续期 Grok 登录。
  - 当前缺口：Antigravity 异步原生子 Agent 被回合结束提前截断（两个平台都适用，Mac 只是这次没有走到这条路径）；Windows 的 B、D 待重测；Antigravity 原生生图路径还没有成功产出。
- [x] 5.3 记录未覆盖项（Windows、未授权的真实 CLI 等）。
  - 未覆盖（如实保留）：真实模型下的同级派遣、Antigravity 生图子 Agent、Grok／ZCode 原生子 Agent 运行、DSH 分组实机效果（5.2，待授权）；Windows 安装与界面；主对话 Agent 未常驻时的专门测试；Grok／ZCode 原生默认值只有已安装程序的静态证据，没有实际运行验证；远端托管的原生设置插件读不到。

## 6. 实测后修正（2026-11-05 用户追加）

- [x] 6.1 DSH 分组标题补图标：内联 DSH 官方 favicon 单色路径（`src/client/dsh-mark.ts`、`DshIcon`），深色主题反色。
  - 测试：`tests/panel.test.tsx` 断言两个分组标题各有一个品牌图标，DSH 为内联 SVG。
- [x] 6.2 DSH 子 Agent 命名 `dsh-<n>` 并可按名续聊；卡片与 CLI Worker 卡片同版式（名称｜模型、箭头、右键「打开对话／删除」，删除前有「仅在此窗口隐藏…」说明行）；`cliworker_status` 列出 DSH 名称；CLI Worker 不能使用 `dsh-<n>`。
  - 测试：`tests/dsh-subagents.test.ts`（编号、私有持久化、隐藏后不复用、跨主对话独立、按名续聊、只读/隐藏/未知不发送）；`tests/sibling-dispatch.test.ts`（followup/status 回退顺序、开关关闭不解析、status 列出名称）；`tests/roles.test.ts`（保留名称）；`tests/panel.test.tsx`（名称显示、按名称搜索、右键删除只隐藏）。
- [x] 6.6 「由 X 发起」移到标题行：标题｜由 X 发起，状态之前，过长省略；测试 `tests/panel.test.tsx` 断言标题行子元素顺序。
- [x] 6.3 同级派遣提示措辞：明确 CLI Worker 也是直接子 Agent，按用户要求照常派遣；只拒绝父会话本身是子 Agent 的调用者。
- [x] 6.4 Antigravity 异步原生子 Agent（`invoke_subagent`）：回合结束后不得立即关闭 ACP，否则后台子 Agent 会丢失。
  - 协议实测（Mac，agy 1.5.1，gemini-3.8-flash-low，用户授权的真实调用；证据 `/private/tmp/claude-501/agy-async-probe/run2.jsonl`、`REPORT.md`）：`invoke_subagent` 派发 76 ms 即 completed，本轮随即 end_turn；约 17 秒后 agy 把图片写进自身 brain 目录，子 Agent 用 `send_message` 回报，父会话在内部自动续上一轮，但 ACP 在 3 分钟内没有推送任何消息。直到下一次 `session/prompt`，积压的 read_file 与完成正文才一次吐出。生图工具只写 brain 目录，不能直接写到指定路径。
  - 实现：`native-acp.mjs` 记录后台工具调用。end_turn 后保持进程、审批与事件，按 15/20/30/45/60/60/90/90/120 秒自动发送同会话跟进（总计不超过 10 分钟与任务超时）；回复 `CLIWORKER_SUBAGENTS_PENDING` 时继续，回复正文时结束；用尽后报告 UNCERTAIN。每次跟进都显示「CLI Worker 自动跟进（非用户消息）」。修复了等待前已中止时错过中止事件的竞态。
  - 测试：`tests/native-agy-acp.test.ts` 新增 4 个模拟用例（自动跟进到汇报、无后台工具只发一次、用尽报待核实、等待中停止不再跟进）。
  - 未覆盖：stream 后备路径（`agy --print`，旧版或规划模式）是否同样截断后台子 Agent；多个子 Agent 并发；Windows 上的 agy 版本行为。
- [x] 6.7 跟进提示改为 diagnostic 事件（过程视图可见），跟进轮的流式正文过滤待完成标记（含跨分片），测试覆盖分片标记。起因：Mac v2 实测时界面看不到 status 类跟进提示，正文却露出一次标记。
- [x] 6.8 跟进说明在 Worker 子会话窗口可见：diagnostic 事件新增 `notice` 标记（仅插件自身动作使用），经原生传输、桥接解析、存储、时间线传到原生会话流，投影为已完成的被动工具行 `cliworker_auto_followup`（不派发、不执行）；其他诊断仍不进入子会话。起因：Mac v3 事件日志证实两次跟进都已发生、标记已过滤，但 CU 在子会话窗口看不到，因为原生会话流只投影 user／assistant／reasoning／tool。第一版投影成 notice 形态的 user/message（已写入会话，Mac v4 核对有 4 条），但 DSH `ui-chat/src/client/contract/chat-visibility.ts` 规定普通 Context 不显示为聊天行，Mac v4 在界面上仍看不到，所以改用工具行。
  - 测试：`tests/harness-conversation-stream.test.ts` 用例（工具行位于两次回复之间、名称和参数正确、普通诊断不出现、两段回复顺序正确）；`tests/public-process.test.ts` 桥接只对 diagnostic 保留 `notice` 并经存储往返；`tests/native-agy-acp.test.ts` 断言跟进诊断带 `notice`。
- [x] 6.9 跟进轮判断：只有标记是本轮最后的内容（之后没有正文和工具调用）才继续等待。起因：Mac v4 中 agy 第 1 次跟进先回标记，再在同一轮送达 `cp` 与汇报；旧规则只看“是否含标记”，于是多跟进一次，产生了重复汇报。测试：`subagent-late` 场景只发 2 次 prompt，结果 SUCCESS，且不含标记。
- [x] 6.10 agy 关闭缺陷：Mac v4 的 agy 1.5.1 在本轮 end_turn 完成后关闭时崩溃。`acp-server-20261106_002054-14514.log` 依次记录 `Language server shutdown timed out`、写入已关闭日志文件、fatal/SIGABRT，退出码 2；插件因此判失败（CLI_RUN_FAILED），而文件实际已经生成。近期 18 份 acp-server 日志中有 16 份关闭超时，只有这一份崩溃。修正：传输层新增显式开启的 `io.exitAfterSuccess(note)`，只在 agy ACP 会话就绪后开启。开启后，Runner 已判本轮成功、且所有子进程问题都只是普通退出码（没有信号、协议错误或 Runner 失败）时，结果改为 UNCERTAIN 并注明退出码；其他 CLI 与 stream 后备路径不变（`native-hermes-planned-stop` 的既有规则保留）。agy 原有的 `nonzero` 场景期望从 ERROR 改为 UNCERTAIN（仍不判成功、不重试）。测试：`subagent-late-exit`、`nonzero`；传输相关 7 个文件 304 项通过。
- [x] 6.5 Mac／Windows 重新构建安装，重测 Antigravity 生图、Windows 同级派遣、DSH 图标与按名续聊；Windows Grok 需用户先续期登录。
  - 2026-11-05 Mac v2（23:41 构建；Codex gpt-6-astra high 用 Computer Use 操作；截图 `real-087-v2-*.png`）：
    - 卡片与图标：通过。DSH 分组有图标；DSH 卡片为「dsh-1 | glm-5.3」加箭头，没有行内删除；右键菜单为「打开对话／仅在此窗口隐藏…（说明行）／删除」，按 Escape 关闭未删除。grok-1 标题行为「创建 sibling-087.txt｜由 codex-1 发起 · 已完成」，没有单独的发起者行。
    - 按名续聊：通过。主 Agent（GLM-5.3）调用 `cliworker_followup {worker_name: "dsh-1"}`，返回 `kind: dsh-subagent`；该 DSH 子会话新增一轮，回复 done（12 秒），卡片变为已完成。
    - Antigravity 原生生图：通过。agy-1（gemini-3.8-flash low）调用 `invoke_subagent`（image-generator）。事件日志显示：15 秒后第 1 次自动跟进，agy 回复待完成标记；20 秒后第 2 次跟进，积压的 `cp`（从 agy brain 目录复制到工作区）与 `stat` 一并送达，随后 agy 汇报完成，状态 completed，用时 1 分 20 秒。磁盘核对：`agy-cat-087.png` 744,423 字节，实际是 1024×1024 JPEG（agy 生图只产出 jpg，复制时沿用了要求的 .png 文件名，属于 agy 行为）。
    - 发现：跟进提示是 status 事件，界面没有显示；待完成标记出现在正文里一次。已在 6.7 修正，待复测。
    - 另见：重启 Desktop 后，此前停止的 DSH 子 Agent 显示为「失败」，因为「已停止」标记只保存在内存里（续聊后变为已完成）。属于已知限制，未改。

  - 2026-11-05 Windows 第二轮（安装 087b 预览包，**不含 6.7 修正**；Codex gpt-6-astra high 用 Windows Computer Use 操作；截图与 Codex 记录在 Mac `/private/tmp/dsh-087b-evidence/`）：
    - A 卡片与按名续聊：通过。DSH 分组有图标；卡片为「dsh-1 | glm-5.3-flash」加箭头，没有行内删除；右键菜单三项，按 Escape 关闭未删除。发送「请继续 dsh-1…直接回复 done」，主 Agent 调用 `cliworker_followup {worker_name: "dsh-1"}`，dsh-1 子会话新增一轮回复 done（2 秒），没有重新选型或审批。
    - B 同级派遣：通过。主 Agent 派 Codex（GPT-5.6-Luna low，名为 `codex-sibling-087`），Codex 调用 `cliworker_start` 派出 claude-1（deepseek-flash 默认）。两张卡同级显示；Claude 卡标题行为「Create sibling-087.txt｜由 codex-sibling-087 发起」；Claude 先排队，等 Codex 结束后才运行；两者都已完成。SSH 核对：`sibling-087.txt` 共 10 字节，内容为 `sibling-ok`。
    - C Antigravity 生图（旧构建，作为修正前对照）：产物通过，跟进显示未通过（符合预期）。agy-cat-087（Gemini 3.8 Flash low）调用 `invoke_subagent`；过程视图看不到跟进提示，正文露出 `CLIWORKER_SUBAGENTS_PENDING`，与 Mac v2 修正前的现象一致。完成，用时 4 分 43 秒。SSH 核对：`agy-cat-087.png` 2,388,139 字节，文件头为 PNG（主 Agent 自行把 JPEG 转成了 PNG）。两次原生审批都是「允许一次」。第二次（`Get-Item`）Codex 提交时遇到窗口激活失败，又检测到用户输入，无法确认是谁提交的。
    - 仍待验证：在 Windows 安装含 6.7 的构建后，复测跟进提示可见、正文无标记；Windows Grok 仍需用户续期登录。
  - 2026-11-06 Mac v3（6.7 构建；00:06 正常重启 Desktop 后用 Codex gpt-6-astra high Computer Use 操作；此前两次重试截图停在旧画面，重启后恢复）：
    - agy-1（Gemini 3.8 Flash low）生成蓝色小鸟，状态已完成，用时 1 分 4 秒。磁盘核对：`agy-bird-087.jpg` 749,323 字节，文件头 FFD8（JPEG）。
    - 事件日志 `~/.dsh/cliworker-now/b29e9150-….events.jsonl`：15 秒后第 1 次跟进，agy 调用 `manage_subagents` 后回复待完成标记；20 秒后第 2 次跟进，送达 `cp` 后汇报完成。两次跟进诊断都已记录；事件里出现标记 0 次，原生原始流 raw 里 2 次，说明过滤生效。CU 在 Worker 正文与主对话中都没看到标记。
    - 未通过：CU 在 Worker 子会话窗口看不到跟进说明，原因是原生会话流不投影 diagnostic。已在 6.8 修正，待复测。
  - 2026-11-06 Mac v4（6.8 第一版，notice 投影；Codex CU 操作；截图在 `/private/tmp/agy-frog-087-acceptance/`）：
    - agy-1 生成青蛙。事件日志 `047b2509-….events.jsonl` 中两次跟进诊断都带 `notice`；子会话 `04a8307d-…` 写入了 4 条 `cliworker-notice` 消息，但界面不显示（原因见 6.8）。
    - 第 1 次跟进时 agy 先回标记，再在同一轮送达 `cp` 与汇报，插件又跟进了一次，产生「结果汇报」「最终结果汇报」两段重复内容（见 6.9）。
    - agy 关闭时崩溃（退出码 2），Worker 判失败，而 `agy-frog-087.jpg` 实际已生成（718,841 字节，见 6.10）。主 Agent 自行核验了文件。
  - 2026-11-06 Mac v5（6.8 工具行、6.9、6.10 构建）：**界面复核受阻，未验证**。
    - Codex CU 三次运行（共 11 次绑定，其间正常重启 Desktop 两次）都报 `cua.getApp("/Applications/DeepSeek Harness.app")` 超时（js execution timed out; kernel reset），没有发出任务，也没有调用模型。
    - 改用内置浏览器直连 Host Web UI 需要读取 Desktop Web 令牌，被自动模式按凭据外露拦截。没有绕过；已删除含令牌的临时日志，并正常重启 Desktop。
    - 已执行的验证：完整 vitest（256 个文件，5515 项通过，14 项跳过）、`corepack pnpm typecheck`、`build:preview` 与正式构建、OpenSpec 严格校验。工具行在 DSH 子会话中的实际显示、6.9 和 6.10 的真实 agy 行为都还没有实机验证。
  - 2026-11-06 Mac v6（6.8 工具行、6.9、6.10 构建；14:00 正常重启 Desktop 后由 Codex gpt-6.1-sol high 用 Computer Use 操作；截图与 AX 文本在 `/private/tmp/agy-ladybug-087-acceptance/`）：**通过**。
    - agy-1（Gemini 3.8 Flash low）生成红色瓢虫，状态已完成，用时 1 分 41 秒，没有审批卡，也没有白屏。
    - Worker 子会话中共 4 条 `cliworker_auto_followup` 工具行，位于第二个「已调用工具」组，在最终回复之前：等待 15 秒、第 1 次跟进、`manage_subagents`、等待 20 秒、第 2 次跟进，之后是 `cp` 和汇报。折叠时显示「工具调用 cliworker_auto_followup · 说明」，展开后输入为 `{"说明": …}`，输出为同一段文字。
    - 回复只有一段汇报，不重复；界面与 AX 文本中都没有 CLIWORKER 或 SUBAGENTS_PENDING。
    - 核对：事件日志 `15ca55d5-….events.jsonl` 中有 4 条 `notice` 事件，没有事件含标记；结果为 SUCCESS，状态为 completed。磁盘上的 `agy-ladybug-087.jpg` 共 743,311 字节，文件头为 FFD8（JPEG）。
    - 未覆盖：本轮 agy 正常退出，6.10 的关闭崩溃路径没有在实机上出现，只有测试覆盖；本轮也没有出现「先回标记、同轮送达结果」的情形，6.9 仍只有测试覆盖与 Mac v4 的问题现场。截图间歇滞后，最终状态以 AX 文本为准。Windows 尚未安装此构建。
  - 2026-11-06 Windows v0.8.7 发布候选（Desktop 一项，父会话转达用户发布授权后执行）：**安装通过；首次启动受 Desktop cookie 缺陷阻塞，经授权清理后界面只读核对通过**。
    - 包：`artifacts/release-v0.8.7/dsh-cliworker-now-0.8.7.tgz`（未重新构建或打包），scp 到 Windows 后 SHA256 `b270308a…646ae` 与 Mac 一致，18,932,823 字节。
    - 门禁：DSH 主进程 21788 无 CLI 子进程，活动 Worker 0（4 个 codex 进程不是 DSH 子进程，未动）；C: 剩余 4.03 GB。经 `quit-harness.ps1`（应用菜单）正常退出，复查无 DSH 进程。
    - 安装：`dsh.cmd plugin --profile desktop add <tgz>` 退出码 0（0.8.6 → 0.8.7），profile 指向该 tgz，已安装 package.json 版本 0.8.7；按包内清单逐文件 SHA256 比对 966/966 一致（lib 747/747），安装目录 lib 共 747 个文件；安装后 C: 剩余约 4 GB。
    - 启动：`ui-hidden.py` 带 `--force-renderer-accessibility` 等参数启动（PID 11748）。Codex gpt-6.1-sol high Windows Computer Use 只读观察：唯一窗口为「DeepSeek Harness 无法使用」，文本「应用无法启动或已意外停止。desktop welcome: Web authentication failed」，诊断报告 `crash-2026-11-06T13-37-41-686Z-host.log`（错误同上，无渲染端错误）。与 Desktop 自身的 dsh-auth cookie 积满致 431 的已知现象一致；Cookies 文件被运行中的 DSH 独占锁定，cookie 数量未能读取，原因未独立确认。
    - 首次核对：上述界面项未能观察；点击弹窗「退出」被自动模式拦截，DSH 停在崩溃弹窗。
    - 用户授权「清理并重启」后：经 Computer Use 点击弹窗「退出」，确认无 DSH 进程；备份 `%APPDATA%\@deepseek-ai\dsh-desktop\Network\Cookies`（53,248 字节，journal 0 字节）到 `Network\Cookies.backup-20261106b-dshauth`，用 DSH 自带 Electron 的 `node:sqlite` 只删除 `host_key='127.0.0.1' AND name LIKE 'dsh-auth-%'`：删除前 71 条、name+value+encrypted_value 共 15,873 字节（文件中共 71 条，127.0.0.1 无其他 cookie），删除后 0 条。原因确认为 Desktop 的 dsh-auth cookie 积满致 431，与插件无关。未选「禁用第三方插件」，profile 未改。
    - 重启（PID 33364）后主窗口「CLI Worker 派遣 Grok Build 测试 — DeepSeek Harness」正常出现。Codex gpt-6.1-sol high 只读核对（13:47–13:49Z，以 AX 文本为准）：
      - 主界面：无启动失败或白屏，侧栏工作区 live-codex / 默认工作区 / 未分组，主对话保留此前「已完成，用时 1分24秒 … OK」回复。
      - CLI Worker 面板：标题「CLI Worker」带 NOW（AX「CLI Worker Now」），筛选「全部 / 进行中 / 已完成 / 异常」（AX 另有「已删除」）；当前主对话下 1 组「Grok Build 1 个 Agent」，卡片「测试工作区只回复 OK · 已完成 · grok-1 · grok-4.5 · Low」。磁盘上共 47 个 Worker 记录（12 种 CLI、多个主对话），面板按当前主对话显示，其他主对话的列表未逐一打开。
      - 已完成子会话「grok-1｜测试工作区只回复 OK」：请求「只回复 OK，不要修改任何文件。」、回复「OK」、「已完成，用时 8秒」，统计「1 轮 1 步」「12.6K tok · 缓存命中 5%」「上下文已用 5%」。
      - 设置 → 通用：「在 CLI Worker 窗口显示 DSH 子 Agent」开（按截图滑块判断，未切换），说明「只影响此窗口的显示，不影响 DSH 子 Agent 的运行与原生入口」。
      - 设置 → Grok Build：「已登录 <账号邮箱>」，模型 Grok 4.5，思考强度 Low，无警告或卡住。
      - 结束时 DSH 停在主视图，此后无新崩溃日志。
    - 未验证：界面内的插件版本号（磁盘已核对 0.8.7）；本轮未派遣、未发消息，DSH 子 Agent 分组在 Windows 上的实际显示未覆盖（当前主对话无 DSH 子 Agent）。
  - 2026-11-06 Windows 发布候选实操（父会话转达用户「补一下实操验收」）：由 Codex gpt-6-astra high 用 Windows Computer Use 操作，只用粘贴输入，工作区 `C:\Users\admin\cw081f1\live-codex`。**A、B、C、D 均通过**（C 的跟进行经补查确认在展开后可见）。
    - 包：A 与 B 的首次尝试在 v0.8.7 发布包（`b270308a…`）上进行。之后经用户授权，为测试 OMP 退出改装了 `fix-pi-omp-logout-and-login-options` 预览包（`50338926…`，同为 0.8.7，相对发布包只改账号登录与退出代码），B 的重试和 C、D 都在预览包上完成，不能当作发布包本身的实测。
    - A（DSH 原生子 Agent，发布包）：通过。
      - 主对话 `session-60e8f797…`。dsh-1 读取 `dsh-read-087r.txt` 得到「蓝鲸-4172」，子会话 turn/end completed。
      - `cliworker_followup {worker_name: "dsh-1"}` 按名续聊得到「续聊成功-087r」。输入框出现过一次粘贴重复，续聊结果不受影响。
      - dsh-2 执行 `pwsh Start-Sleep 600`，在子会话点「停止生成」后 8.7 秒显示「已停止」，turn/end 为 aborted|user，没有遗留 sleep 进程。
      - 设置中关闭「在 CLI Worker 窗口显示 DSH 子 Agent」后 DSH 分组消失，重新打开后恢复，最后保持开启。
    - B（同级派遣 Codex → Grok）：
      - 首次（22:09，发布包）失败，原文「Codex 当前账号暂无可确认模型，请刷新」，未建 Worker。后来在交互会话里用同一 lib 复查，Codex 目录返回 8 个模型，失败没有复现，原因未定。
      - 重试（预览包，15:44Z）：Codex 设置为已登录、GPT-5.6-Luna / Low。codex-2 直接启动；Grok 弹出选型卡「是否沿用 Grok 4.5 · Low · 不使用角色预设？」，选「沿用」。
      - 面板：「Codex 2 个 Agent」与「Grok Build 1 个 Agent」两组同级、不嵌套。grok-1 标题「创建 sibling-087r.txt｜由 codex-2 发起」。
      - Worker 记录：grok-1 `initiator={kind:worker, name:codex-2}`，completed，observedModel grok-4.5；codex-2 completed，observedModel gpt-5.6-luna。
      - 磁盘：`sibling-087r.txt` 为 23 字节 UTF-8，内容「同级派遣-087r-Grok」加 LF，写入于 15:48:46Z。本轮只新增这一个文件和下面 C 的图片。
      - 观察：grok-1 在 codex-2 运行期间一直「排队中」（同目录写任务串行），等 codex-2 结束（15:48:35Z）后才运行（15:48:53Z 完成）。所以 codex-2 的回复是「Worker 仍处于 queued……无法确认文件创建成功」，最终核验由主 Agent 收到 Grok 完成通知后完成。主 Agent 中途曾说「通知机制看不到它的完成事件」，随后又收到了，这句说法与实际不符。这是现有串行规则下的行为，不是派遣失败；是否需要提示发起方「被派者需等待本 Worker 结束」，留作后续评估。
    - C（Antigravity 原生生图，预览包）：通过。
      - 选型卡「是否沿用 Gemini 3.8 Flash · Low · 不使用角色预设？」，选「沿用」。agy-1 调用 `invoke_subagent`（image-generator）。
      - 两次 CLI 授权都是「允许一次」：一次 Copy-Item 到工作区，一次 Get-Item 只读。
      - 结果：completed，observedModel gemini-3.8-flash-low，「已完成，用时 3分2秒」，最终汇报只有一份。
      - 磁盘：`agy-087r.jpg` 274,861 字节，文件头 `FF D8 FF E0`，文件尾 `FF D9`；主 Agent 报告 1024×1024。修改时间沿用原生生成文件的时间。
      - 事件日志：15:52:20Z「子 Agent 仍在后台运行，15 秒后…自动发送第 1 次跟进检查」，15:52:35Z「CLI Worker 自动跟进（非用户消息）：请 Antigravity ACP 汇报后台子 Agent 结果，不重新派发」（notice）。随后 agy 调用 manage_subagents 并完成复制。
      - 子会话文件 `3619fd88…`：有 2 条 `cliworker_auto_followup` 工具行（event 13 与 14）。正文里 `CLIWORKER_SUBAGENTS_PENDING` 出现 0 次，只在原生 raw 记录的跟进提示里出现 1 次。
      - 界面：首轮 CU 在默认折叠状态下没有找到跟进行。16:07–16:12Z 由 Codex gpt-6.1-sol high 只读补查：
        - 默认状态和只展开外层「已完成，用时 3分2秒」时，各关键词都是 0 处。
        - 展开第二个「已调用工具」组后，依次显示「工具调用 cliworker_auto_followup · Antigravity ACP 子 Agent 仍在后台运行，15 秒后由 CLI Worker 自动发送第 1 次跟进检查」「工具调用 cliworker_auto_followup · CLI Worker 自动跟进（非用户消息）：请 Antigravity ACP 汇报后台子 Agent 结果，不重新派发」，之后是 manage_subagents · list 和两条 run_command。位置在第一段英文正文之后、复制命令之前。两行展开后的输入、输出与存储一致。
        - 逐个展开所有工具详情后，`CLIWORKER_SUBAGENTS_PENDING` 在 AX 中始终为 0 处。
        - 跟进行按 6.8 的设计投影为工具行，默认收在折叠的工具组里，展开后可见。
    - D（Grok 原生子 Agent，预览包）：通过。
      - 选型卡「是否沿用 Grok 4.5 · Low · 不使用角色预设？」，选「沿用」。grok-1 用两个 `variant: Task` 后台子 Agent 分别读取 A、B 两个文件（15:58:19Z 开始，15:58:23/24Z 结束），再用 TaskOutput 取回，结果为 `2/2 tasks completed (wait_all)`，两者 exit_code 0。
      - 汇报内容「Grok 子 Agent 文件 A：苹果-3301」「Grok 子 Agent 文件 B：香蕉-8826」，与两个文件一致，未改文件。Worker completed，observedModel grok-4.5，「已完成，用时 29秒」。
    - 未覆盖：B 首次失败的原因；6.9 与 6.10 的实机路径。本轮批准的授权卡片都只涉及测试目录内的操作。
  - 2026-11-07 勾选 5.2 与 6.5（主会话）：5.2 的四项真实调用在两个平台都有通过记录：A DSH 子 Agent（Mac 11-05、Windows 发布包 11-06）；B 同级派遣（Mac Codex→Grok、Windows Codex→Claude Code 与 Codex→Grok）；C Antigravity 生图（Mac v6、Windows 11-06）；D Grok 原生子 Agent（Mac、Windows）。6.5 列出的重测项均已在上方记录中通过；Windows Grok 续期由 `fix-grok-expired-access-renewal` 解决。仍未覆盖的只有上方「未覆盖」所列各项，不因勾选而视为已验证。
- [x] 6.11 热启用白屏：复现、修复与验证记录移到独立变更 `openspec/changes/fix-hot-enable-blank-screen/`。
