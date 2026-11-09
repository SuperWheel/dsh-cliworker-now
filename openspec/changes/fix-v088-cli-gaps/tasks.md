## 1. 用量与积分（CodeBuddy、WorkBuddy CN、WorkBuddy）

- [x] 1.1 新增 `src/host/codebuddy-durable-usage.mjs`：按会话、用户消息、请求 ID、cwd 与模型定位本轮，按 `messageId` 去重汇总 token 与积分；有子 Agent 或缺积分时积分为未知。
- [x] 1.2 `native-codebuddy.mjs` 与 `native-workbuddy.mjs` 用 `codebuddyUsageOnResult` 在 `end_turn` 后读取并发出 `cliworker.codebuddy_usage` 回执；WorkBuddy 用安装探测得到的配置根。
- [x] 1.3 `telemetry.ts` 白名单与提取：回执的 CLI、来源、会话、模型须与本 Worker 一致；token 不当积分。`CREDIT_BILLED_CLIS` 统一显示积分的 CLI；TRAE CN 继续显示 token。
- [x] 1.4 WorkBuddy 两版补 `usage_update` 上下文统计。
- [x] 1.5 `scripts/build.mjs` 打包新资源与类型声明。

## 1b. 上下文分类（2026-11-09 用户反馈：新 CLI 的系统提示词、工具定义、对话消息无法显示）

- [x] 1b.1 现状核对（Desktop，Codex Computer Use 读取无障碍树）：CodeBuddy「~53.8K / 960K」、TRAE CN「13.1K / 190K」、WorkBuddy CN「~27.3K / 300K」三行均为 `—`；Claude Code 参照有值。原因：三者 ACP 只给总量；插件此前只解析 Claude、OMP、Pi 等的分类。
- [x] 1b.2 来源核查：CodeBuddy 2.181 与 WorkBuddy CLI 2.165 的本地命令 `/context` 不调用模型，输出含 System prompt / System tools / MCP tools / Memory files / Skills / Messages 与头部「模型 · 已用/容量」，数值按 0.1K 取整。在 Worker 自身会话里执行会把命令与输出作为用户消息写进会话（实测 Messages 302→584），所以不能在主进程执行。`--no-session-persistence` 副进程载入同一会话执行 `/context`，会话文件 sha 与文件数不变。TRAE CN（traecli 0.213.1）可用命令为 review/init/compact/logout 与技能，没有 `/context`，ACP 只给 used/size，没有分类来源。
  - 2026-11-09 对照：Codingns4DSH（`487241d`）对外部 CLI 默认隐藏三行，只有经 Magpie 本地网关的会话才读网关拆分的六类；codex-host（`b0fa4c9`）只上报已用与容量，没有分项。两者都没有 TRAE 适配器。TRAE CN 请求直连字节服务，截获需改服务地址或解密流量，不采用。用户决定 TRAE CN 三行保持 `—`。
- [x] 1b.3 实现：新增 `src/host/codebuddy-context-inspection.mjs`（解析与副进程读取）；`native-acp.mjs` 增加 `afterClose`，仅在本轮已结算、未停止且 Worker 进程退出后调用；`native-transport.mjs` 的 `auxiliary` 子进程随运行一起停止，但其退出状态不影响本轮结果，stderr 不进 Worker 诊断；`native-codebuddy.mjs` 与 `native-workbuddy.mjs`（WorkBuddy 副进程走同样的引导与凭据投递，argv 追加 `--no-session-persistence`）接入；`telemetry.ts` 采信 `codebuddy.native-context`，总量与分类取同一份报告，下一次 `usage_update` 会清掉旧分类；`scripts/build.mjs` 打包新模块。
  - CodeBuddy 输出带 `_meta['codebuddy.ai/commandKind']='local'`；WorkBuddy 2.165 不带该标记。两者都接受没有模型请求 ID 的输出；本次提示期间出现思考、工具或模型请求 ID 时不采纳。
  - 一轮真实 CodeBuddy 运行没有发 `usage_update`，所以总量改为同取 `/context` 头部，而不是依赖 `usage_update`。
- [x] 1b.4 模拟测试：`tests/native-codebuddy.test.ts` 新增 2 组（副进程参数与只发 `/context`、主进程不收 `/context`、拒绝审批结束也读取、停止/失败不启动、卡住/残缺/模型活动/思考均不发且不改结果、无标记输出可用；文本解析与 8 种拒收；遥测三行、同一快照总量、会话/模型/CLI/基准不符拒收、下一次 `usage_update` 清除），`tests/native-workbuddy.test.ts` 的成功用例核对第二个引导进程、`--no-session-persistence`、无 `session/new` 与分类内容。两文件 88/88；关联回归 10 个文件 358/358；`pnpm typecheck`、`build:preview`、`pnpm build` 通过。
- [x] 1b.5 真实 Host 运行（2026-11-09，scratchpad 脚本直接调用插件 runner，hy4free，“只回复 OK”）：
  - CodeBuddy 2.181 续聊会话 `01a1c0a1…8a41`：SUCCESS；发出分类 System prompt 4.5K、System tools 17.5K、Skills 24、Messages 940，头部 24.6K / 960K；遥测得到三行 4,500 / 17,500 / 940。会话文件 36→43 行，新增 7 行均为本轮（用户消息、推理、回复与元数据），`local-command-stdout` 计数不变（2，为此前探测遗留），目录文件数不变。
  - WorkBuddy CN 2.165 续聊会话 `01a1c0bb…1c40`：首次运行因输出缺 `commandKind` 未采纳，修正后 SUCCESS；三行 3.9K / 15.3K / 187，头部 24.7K / 300K。会话文件 6→12 行，无 `Context Usage` 内容。单独调试：副进程在设置模型后头部为 `hy4free · 25.9k/300k`（未设置时显示会话默认 `auto · …/256k`），会话文件 sha 不变；副进程从打开到结果约 1.2 秒。
- [x] 1b.6 Desktop 目视（2026-11-09，正式 `pnpm build` 后 Desktop 退出重启；Codex Computer Use 操作，工作区 `cw-acc-088`、对话「CLI Worker 派遣 CodeBuddy 复制文件」，hy4free，续聊“只回复 OK 两个字母，不要调用工具。”，无审批卡、无白屏）：
  - CodeBuddy Code：33 秒完成，回复 `OK`；弹层「上下文已用 3%，~25.7K / 960K」，系统提示词 ~4.4K、工具定义 ~17.5K、对话消息 ~971。
  - WorkBuddy CN：25 秒完成，回复 `OK`；弹层「上下文已用 10%，~28.7K / 300K」，系统提示词 ~3.8K、工具定义 ~15.3K、对话消息 ~1.1K。
  - TRAE CN：未发送；弹层「7%，13.1K / 190K」，三行仍为 `—`（符合预期）。
  - 三行之和小于总量（CodeBuddy 约 22.9K 对 25.7K，WorkBuddy 约 20.2K 对 28.7K）：总量是原生头部的当前占用，三行是原生分类估算，Skills、Memory files 等不计入三行；与 Claude Code 的呈现方式相同，不做补齐。
  - Windows 实机（2026-11-09 22:53 包 `preview-088-20261109-225314.tgz`，sha256 前缀 `5caa8326339feb26`；空闲预检 activeWorkers=0，安装退出 0，逐文件 1039 个 0 不一致 0 缺失，DSH 带无障碍参数重启；Codex Computer Use（gpt-6.1-sol）操作，工作区 `C:\Users\admin\cw081f1\live-codex`，hy4free，同样的续聊，无审批卡、无白屏、无卡在运行中）：
    - `v088-codebuddy-win`：19 秒完成，回复 `OK`；「3%，~27K / 960K」，系统提示词 ~4.5K、工具定义 ~19K、对话消息 ~906。
    - `workbuddycn-1`：18 秒完成，回复 `OK`；「9%，~25.6K / 300K」，系统提示词 ~3.9K、工具定义 ~16.9K、对话消息 ~413。
    - `v088-traecn-win`：未发送；「6%，10.9K / 190K」，三行 `—`。
  - 未核对：各行悬停提示（Computer Use 无悬停动作）；WorkBuddy 国际版未安装。

## 2. 分支

- [x] 2.1 CodeBuddy、WorkBuddy 两版仍不支持分支，理由改为实测结论（CodeBuddy ACP `session/fork` 返回 Method not found；WorkBuddy 内置 CLI 未实现）。TRAE CN 已支持，未改。

## 3. Desktop 验收问题

- [x] 3.1 拒绝审批结束的结果说明作为“本轮结果说明”行投影到 Worker 窗口。
- [x] 3.2 设置页左栏 WorkBuddy CN 与 WorkBuddy 名称下加“试验性”，同步 `doc/settings-ui-design.md`。
- [x] 3.3 WorkBuddy 桌面管理复开：`start()` 等上一会话停止与该 CLI 的状态查询结束；Client 显示已知 Host 原因。页脚按钮不折行、说明可换行。
- [x] 3.4 派遣与续聊结果写明本轮实际权限档位及来源（受理时确定），档位规则不变。

## 3b. Windows 实机反馈（2026-11-08 用户报告，同日修复）

- [x] 3b.1 TRAE CN 自动识别：官方 `install_v2.ps1` 装到 `%LOCALAPPDATA%\Programs\TraeCLI\bin`，`traecli.cmd` 内容为 `"%~dp0traex.exe" %*`。旧解析只接受 npm `node_modules` 下的原生程序，判为“CLI 启动入口无法确认”。现接受同目录、纯文件名、经 PE 校验的原生程序并直接启动该 exe（不执行批处理）；Windows 固定候选加入该 bin（Desktop 早于安装启动时 PATH 仍是旧的）。
- [x] 3b.2 WorkBuddy 自动识别：安装器允许自选目录（实机 `D:\Software\workbuddy`），不在默认候选内。未配置路径且默认位置失败时，只读查询卸载注册表中 DisplayName 为 WorkBuddy、发布者为 Tencent 的 InstallLocation/DisplayIcon，作为普通候选再走 product.json 站点校验；结果缓存 60 秒；显式路径不回退。
- [x] 3b.3 CodeBuddy 登录窗口露出原生终端：Windows ConPTY 下，输入 `/login` 后的建议列表帧、选站后菜单清屏帧都不是已录制画面，兜底步骤立即显示“无法识别当前步骤”并自动展开原生终端。兜底步骤（`afterRecognized`）改为只在屏幕静止后判定；中间帧保持上一步提示。
- [x] 3b.4 授权时弹出的窗口：实机观察为 CodeBuddy CLI 自行打开系统默认浏览器（Tabbit）的授权页，插件不自动打开（窗口按钮为“重新打开登录页面”）。属 CLI 原生行为，未改。
- [x] 3b.5 Worker 卡片去掉“试验性：依赖 WorkBuddy 桌面端非公开接口”小字（用户要求），连接页仍保留；同步 `doc/design.md`、`doc/settings-ui-design.md`、`doc/workbuddy-protocol.md`。
- [x] 3b.6 Windows 实机：CodeBuddy“切换账号”先退出成功（状态变为尚未登录），站点菜单识别正确；选中国站后旧版出现上述误判，随后浏览器等待步骤恢复识别。
- [x] 3b.7 CodeBuddy 授权后仍露出终端（用户 11-08 晚再次报告）：Windows 日志显示浏览器授权 5 分钟后 TimeoutError，CLI 回到未录制的失败画面，静止后转交原生并自动展开终端。macOS 隔离采集（无浏览器打开器）得到同一失败行 `Failed to login. Press esc to return to login`，Esc 回到站点菜单、再 Esc 回到输入界面。新增 CodeBuddy `failed` 步骤（警告 + 「重新登录」→ Esc）与输入界面回访引导（引擎 `again`：自动输入过 `/login` 后从其他画面回到同一步骤，显示「重新登录」，同一画面重绘不算）；企业域、iOA 改为已录制的原生步骤。
- [x] 3b.8 所有 CLI：客户端只为需要在终端作答的原生步骤（非警告色）自动展开终端；“无法识别当前步骤”等警告兜底只提示并提供「显示原生终端」。审查结果：保留自动展开的只有 Antigravity 首次设置、TRAE 企业流程、OpenCode 未建模服务商的登录方式、CodeBuddy 企业域/iOA。同步 `cli-connection-health` 规格“原生终端回退”。
- [x] 3b.9 TRAE 登录方式卡片标题改为“个人账号”（用户要求），开发中特性提示只保留在上方说明行；同步 `doc/settings-ui-design.md`。
- [x] 3b.10 设置页「CLI 连接」列表去掉 WorkBuddy CN / WorkBuddy 名称下的“试验性”小字（用户要求），试验性说明保留为悬停提示与连接页副标题；删除对应两行样式；同步 `doc/settings-ui-design.md`。`settings-dialog`、`client-i18n`、`panel` 测试 413 项通过，`pnpm typecheck` 通过。
- [x] 3b.11 Windows 实机复测（2026-11-08 22:37–22:50，c24d373 与 c833531 两次隔离包安装，空闲预检 activeWorkers=0，逐文件哈希 1036/1036 一致，DSH 重启）：TRAE CN 登录方式卡片显示“个人账号”，选择后进入浏览器授权/回调步骤，未露出终端；CodeBuddy 中国站→浏览器等待→用户在浏览器授权后窗口直接显示“已登录 CodeBuddy Code”，全程未露出终端，凭据文件 22:43 写入、无退出标记，设置页变为已登录；「CLI 连接」列表 WorkBuddy 两项只显示名称。未在实机触发 5 分钟授权超时（用户在超时前完成授权），超时画面只经 macOS 隔离采集与回放测试验证。
- [x] 3b.12 WorkBuddy 桌面管理窗口“已登录还在转圈”（用户 11-08 报告）：观察期间每次读取完成仍用 waiting 模板，把当前状态画成转圈。读取完成后与开始观察时的说明都改用文字显示（确认变化时仍为结果页），只有读取进行中转圈，观察中由底栏“正在观察桌面端登录状态”说明。Windows 实机（3c55b6b 安装后）：继续观察后第二步显示“已登录（www.workbuddy.cn）”无转圈，底栏按钮为 md；bfdd2a7 安装后（23:2x，预检 activeWorkers=0，哈希 1036/1036）点击继续观察 1.5 秒内第二步即显示文字“登录、退出或切换请在桌面端完成。”，无转圈，约 13 秒后读取完成显示“已登录（www.workbuddy.cn）”。实机另见：窗口打开期间设置页仍显示后台旧状态“请在桌面端检查登录状态”，关闭窗口后刷新为已登录并读出模型，未改。
- [x] 3b.13 登录窗口按钮尺寸统一（用户 11-08 报告新 CLI 与旧 CLI 不一致）：逐个核对 `login-window`、`accounts-window`、`login-method-picker`、`account-terminal` 与 `workbuddy-desktop-window` 的按钮。CodeBuddy / TRAE 复用既有组件，尺寸一致；WorkBuddy 桌面管理底栏的关闭 / 刷新状态 / 继续观察 / 打开桌面端误用 sm，改为 md（ghost / outline / outline / primary）。`doc/settings-ui-design.md` 新增「登录窗口按钮规范」表（md 用于窗口级与步骤决定操作及 choice 选项，sm 只用于打开/复制类辅助链接和底栏文字开关），并改正 `native` 模板“登录时展开终端”的旧描述；组件测试断言 WorkBuddy 按钮尺寸与样式。
- 验证（macOS）：`new-cli-account-flows`、`account-terminal`、`client-i18n`、`login-method-picker`、`traecn-accounts` 及全部登录引导测试通过；`pnpm typecheck` 通过。`tests/followup-queue.test.ts` 30 项失败（`planMode` 夹具 `agent.ctx.get(...)?.get is not a function` 等），与本次改动无关、改动前已存在，未处理。

## 4. 自动检查（2026-11-08，macOS）

- [x] 4.1 新增或修改的回归测试（均为模拟数据）：
  - `tests/codebuddy-usage.test.ts`：25 项，覆盖汇总去重、免费积分为 0、缺积分与子 Agent、7 类拒收、项目键（含超长路径）、私有文件读取与等待落盘、runner 钩子、积分/token 呈现划分、来源交叉拒收、WorkBuddy 版本隔离与上下文、白名单脱敏、分支理由。
  - `harness-conversation-stream`（结果说明行）、`settings-dialog`（试验性标记）、`workbuddy-desktop`（停止中复开、等待状态查询）、`workbuddy-desktop-window`（已知原因中英文、页脚样式）、`worker-permissions`（权限回执）、`sibling-dispatch`（派遣结果附档位）。
  - 分支理由文字同步更新于 `codebuddy-integration`、`workbuddy-registration`。
- [x] 4.2 关联回归 47 个文件：1382 项通过、1 项跳过、0 失败（codebuddy/workbuddy/traecn/qoder 全部、telemetry 系、harness-conversation 系、harness-turn-usage、native-acp、settings-dialog、client-i18n、sibling-dispatch、worker-permissions 等）。
- [x] 4.3 `corepack pnpm build:preview` 通过，产物 `.cache/preview-package`。
- [x] 4.4 类型检查：本 worktree 无 `lib/`，直接 `corepack pnpm typecheck` 时 Client 报 11 条错误，均源于自引用包 `dsh-cliworker-now/remote` 无法解析（环境问题）；在隔离包内 `node scripts/build.mjs --typecheck-only` 退出 0（Host 与 Client 均通过）。
- [x] 4.5 `corepack pnpm spec validate --all --strict --no-interactive`：62 项通过、0 失败；`git diff --check` 通过。
- [x] 4.6 未运行全量 vitest 与 `pnpm build`（Desktop 链接主仓库，按要求不跑）。

## 5. 未验证

- [x] 5.1 改动后的真实端到端运行：2026-11-09 Windows 实机（DSH Desktop，Codex Computer Use 操作，工作区 `C:\Users\admin\cw081f1\live-codex`），用 `hy4free` 派遣 CodeBuddy 与 WorkBuddy CN，回复行显示「积分用量 0 积分」。
  - 初次在 Windows 上显示「积分用量 — 积分」，查明两个根因并在 04e9580 修复：原生记录里的 cwd 盘符为小写（`c:\...`），与项目路径逐字比较不相等；Windows 用户目录属主为 Administrators 组，文件隐私核验拒绝读取。修复后：Windows 下 cwd 按 `win32.normalize` 后不分大小写比较（macOS 仍逐字比较）；CodeBuddy 系读取允许 Administrators 属主，但仍要求当前用户 ACE、且不允许其他 SID 完全控制。新增模拟用例 `tests/codebuddy-usage.test.ts`（26/26）。修复包安装后新一轮回复显示「积分用量 0 积分」。
- [x] 5.2 付费模型的积分数值：实测仅有 `hy4free`（credit 为 0），非零积分的汇总只由模拟用例覆盖。
  - 2026-11-09 付费实测（用户授权“只跑一轮”）：scratchpad `accept/run.mjs` 调用插件 `runNativeCodebuddy`，CodeBuddy 2.181，模型 GLM-5.3-Flash（目录标 paid），强度 low，询问档，提示“只回复两个字母：OK”，回复 `OK`，SUCCESS。插件读到 `cliworker.codebuddy_usage`：1 次请求，输入 22,744 / 输出 15 / 合计 22,759 tok（推理 12），`providerCredits: 0.34`。原生会话文件同一 messageId 的 `rawUsage.credit` 为 0.34、模型 glm-5.3-flash，两者一致。只跑了 Host 读取，没有在 Desktop 回复行目视非零积分；回复行格式化由模拟用例覆盖。
  - 2026-11-09 验收结论（用户规则：每个 CLI 只要一个账号真实登录成功，其他账号、站点与企业方式默认也能登录）：仍只有 hy4free（0 积分）真实数据；付费模型需要用户授权真实付费调用，本项保持未勾选。
- [x] 5.3 拒绝审批结束的轮次不读取用量（只在 `end_turn` 读取），这类轮次的积分显示为未知。
  - 022bbb9 修复：被拒工具调用是该轮最后一次计费请求，原生记录里它没有结果行，原规则判为“未结束”。ACP 运行器把被拒的 toolCallId 交给 `onResult`；只有 `stopReason=cancelled`、`codebuddy.ai/outcome=PERMISSION_DENIED`、未被用户停止，且该轮所有没拿到结果的调用都是被拒调用时才读取。依据为本机 CodeBuddy 2.181 的真实被拒轮次（ACP toolCallId 与原生 `callId` 相同）。模拟用例见 `tests/codebuddy-usage.test.ts`。
  - 2026-11-09 Mac Desktop 实机（正式 `pnpm build`，`feat/general-settings` 0bb2158；Desktop 退出后重启，内置浏览器直连 Host Web UI，视口 1280×860）：CodeBuddy Worker（询问档，hy4free）续聊要求 `touch denied-mac-1109.txt`，在审批卡点「拒绝」。原生记录读到 1 次请求、25,633 tok、`providerCredits: 0`；文件不存在。该轮 CLI 没有正文，所以没有回复行可挂用量；Worker 底部合计显示「0 积分」。
  - 2026-11-09 21:08 Windows 复测（包 `preview-088-20261109-210826.tgz`，含 022bbb9 与 8ba2551；activeWorkers=0，安装退出 0，逐文件 1036 个 0 不一致，DSH 带无障碍参数重启；界面由 Codex Computer Use（gpt-6.1-sol）操作）：`v088-codebuddy-win` 临时改为询问档（测完改回自动审批，Host 记录 level=auto），续聊要求 `touch denied-win-1109.txt`，审批卡「v088-codebuddy-win（CodeBuddy Code）请求授权：`touch denied-win-1109.txt` 工作目录：C:\Users\admin\cw081f1\live-codex」点「拒绝」。原生记录读到 1 次请求、26,790 tok、`providerCredits: 0`；展开过程区可见「已拒绝」与「本轮结果说明：因拒绝审批而结束：被拒操作未执行，可续聊继续」；底部「0 积分」；文件不存在。
- [x] 5.4 Desktop 复看：试验性标记、桌面管理复开与英文页脚、结果说明行、派遣结果档位均未在运行中的 Desktop 复看（按要求不动运行中的 DSH Desktop）。
  - 2026-11-09 Mac Desktop 实机（正式 `pnpm build`，`feat/general-settings` 0bb2158；Desktop 退出后重启，内置浏览器直连 Host Web UI，视口 1280×860）：
    - 「CLI 连接」左栏 WorkBuddy 两项只有名称，没有“试验性”小字；WorkBuddy CN 连接页副标题保留“试验性：依赖 WorkBuddy 桌面端非公开接口”。Worker 列表卡片无试验性说明。
    - 结果说明行：拒绝审批后展开该轮过程区，可见「已拒绝」的失败工具行和「本轮结果说明：因拒绝审批而结束：被拒操作未执行，可续聊继续」。默认折叠在「已完成，用时 33秒」之下。
    - 派遣结果档位：主 Agent 的汇报写明“CodeBuddy Worker（codebuddy-worker，权限‘询问’）”。
    - 英文页脚：临时把界面语言切到 English（看完已改回「跟随 DSH」）。桌面管理窗口 4 个按钮的文字都不折行，但 480px 宽放不下一行，「Open desktop app」换到第二行右对齐；中文时 4 个按钮在一行。
    - 按用户要求调成一行：英文词条改为 Refresh / Resume observing / Open app（暂停提示同步为 “Observation paused. Refresh or resume observing.”），`doc/settings-ui-design.md` 已同步。重新正式构建后在 Desktop 英文界面复看，Close / Refresh / Resume observing / Open app 同排右对齐；看完语言已改回「跟随 DSH」。Windows 同样复看通过（见 5.3 下的 Windows 复测）：Close / Refresh / Resume observing / Open app 同排，语言已改回。`tests/workbuddy-desktop-window.test.tsx` 等 3 个文件 294/294 通过。
- [x] 5.5 桌面管理复开失败的根因为代码推断（状态读取或上一会话停止未完成导致 `reserve()` 拒绝），未在 Desktop 上复现确认。
  - 2026-11-09 Mac Desktop 实机（正式 `pnpm build`，`feat/general-settings` 0bb2158；Desktop 退出后重启，内置浏览器直连 Host Web UI，视口 1280×860）：WorkBuddy CN「在桌面端管理」用真实鼠标点击连续开关多次，关闭后再点都能在约 0.1 秒内打开，没有再出现“暂不可用”。只有在关闭动作尚未结束（Host 仍在停止上一会话、遮罩还在）时立刻点，这一下被遮罩吸收、没有任何提示；再点一次即可打开。修复前的“暂不可用”无法在修复后复现，原根因仍为代码推断。
- [x] 5.6 WorkBuddy 国际版、CodeBuddy 国际站未验证。Windows 部分已完成（见 5.8 下的派遣记录）。
  - 2026-11-09 验收结论（用户规则：每个 CLI 只要一个账号真实登录成功，其他账号、站点与企业方式默认也能登录）：CodeBuddy 国际站按规则视为可登录；WorkBuddy 国际版未安装，只在 add-workbuddy-cli 7.3 跟踪。
- [x] 5.7 Windows 新包复测（2026-11-08 22:00，包 `preview-088-20261108-215815.tgz`，sha256 `43aa474b…c2ec`；空闲预检 activeWorkers=0；原生安装器退出 0；逐文件校验 1036 个、0 不一致；Desktop 正常关闭后带无障碍参数重启）：TRAE CN 由“CLI 启动入口无法确认”变为“未登录”且可点“登录账号”；WorkBuddy CN 自动识别为 `D:\Software\workbuddy`（配置中无手动路径），状态“请在桌面端检查登录状态”；WorkBuddy 国际版显示暂不可用（未安装，符合预期）；CodeBuddy 登录：启动→站点菜单→选中国站→浏览器等待，逐次读取无障碍树未出现“无法识别当前步骤”，原生终端未展开。连接页左栏显示“试验性”。
- [x] 5.8 Windows 上 CodeBuddy 授权超时画面的实机触发、TRAE CN 登录完成（停在浏览器授权，需用户手机验证）、其他已登录 CLI 的重新登录（需先退出、用户重新授权）、WorkBuddy CN 桌面端管理与真实派遣（hy4free / glm-5.3-flash）尚未执行；Mac Desktop 已正式构建但未目视复看本轮改动。
  - 2026-11-09 用户本人测试账号退出与重新登录，报告“全部通过”，据此勾选。证据为用户报告，本会话没有取得截图、原生状态输出或进程记录。
  - 2026-11-09 用户决定退出与重新登录由本人自行测试，本会话未执行。
  - 2026-11-09 验收结论（用户规则：每个 CLI 只要一个账号真实登录成功，其他账号、站点与企业方式默认也能登录）：TRAE CN 登录已由用户完成并真实派遣；其他 CLI 重新登录按规则视为通过；WorkBuddy CN 桌面管理与派遣已完成。只剩 CodeBuddy 授权超时画面的实机触发：需先退出当前账号，用户未授权，保持未勾选。
  - 2026-11-09 Windows 实机（DSH Desktop，Codex Computer Use 操作，工作区 `C:\Users\admin\cw081f1\live-codex`），各一次真实派遣，均 SUCCESS，产物经 PowerShell 读回核对：
    - CodeBuddy（`v088-codebuddy-win`，hy4free，自动审批档）：首轮建文件，两次续聊各追加一行，`v088-codebuddy-win.txt` 实际三行 `hello-codebuddy-win` / `second-line-win` / `third-line-win`；事件含「CodeBuddy 原生模型已确认」。
    - WorkBuddy CN（`workbuddycn-1`，hy4free）：`v088-workbuddycn-win.txt` 实际内容 `hello-workbuddycn-win`；事件含「WorkBuddy CN 原生模型已确认」。
    - TRAE CN（`v088-traecn-win`，glm-5.3-flash，仅工作区编辑）：在工作区内建文件也弹出审批，经 DSH 审批卡「允许一次」后继续，`v088-traecn-win.txt` 实际内容 `hello-traecn-win`。
    - 仍未执行：CodeBuddy 授权超时画面的实机触发；其他已登录 CLI 退出后重新登录（用户 11-09 决定先不测）。Mac Desktop 目视复看已于 2026-11-09 完成（见 5.4）。
