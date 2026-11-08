## 1. 用量与积分（CodeBuddy、WorkBuddy CN、WorkBuddy）

- [x] 1.1 新增 `src/host/codebuddy-durable-usage.mjs`：按会话、用户消息、请求 ID、cwd 与模型定位本轮，按 `messageId` 去重汇总 token 与积分；有子 Agent 或缺积分时积分为未知。
- [x] 1.2 `native-codebuddy.mjs` 与 `native-workbuddy.mjs` 用 `codebuddyUsageOnResult` 在 `end_turn` 后读取并发出 `cliworker.codebuddy_usage` 回执；WorkBuddy 用安装探测得到的配置根。
- [x] 1.3 `telemetry.ts` 白名单与提取：回执的 CLI、来源、会话、模型须与本 Worker 一致；token 不当积分。`CREDIT_BILLED_CLIS` 统一显示积分的 CLI；TRAE CN 继续显示 token。
- [x] 1.4 WorkBuddy 两版补 `usage_update` 上下文统计。
- [x] 1.5 `scripts/build.mjs` 打包新资源与类型声明。

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
- [x] 3b.12 WorkBuddy 桌面管理窗口“已登录还在转圈”（用户 11-08 报告）：观察期间每次读取完成仍用 waiting 模板，把当前状态画成转圈。读取完成后改用文字显示结果（确认变化时仍为结果页），观察中只由底栏“正在观察桌面端登录状态”说明。实机另见：窗口打开期间设置页仍显示后台旧状态“请在桌面端检查登录状态”，关闭窗口后刷新为已登录并读出模型，未改。
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

- [ ] 5.1 改动后的真实端到端运行：未用 `hy4free` 跑 CodeBuddy/WorkBuddy 新版插件确认积分行显示（只在改动前做过一次 CLI 直接探测）。
- [ ] 5.2 付费模型的积分数值：实测仅有 `hy4free`（credit 为 0），非零积分的汇总只由模拟用例覆盖。
- [ ] 5.3 拒绝审批结束的轮次不读取用量（只在 `end_turn` 读取），这类轮次的积分显示为未知。
- [ ] 5.4 Desktop 复看：试验性标记、桌面管理复开与英文页脚、结果说明行、派遣结果档位均未在运行中的 Desktop 复看（按要求不动运行中的 DSH Desktop）。
- [ ] 5.5 桌面管理复开失败的根因为代码推断（状态读取或上一会话停止未完成导致 `reserve()` 拒绝），未在 Desktop 上复现确认。
- [ ] 5.6 Windows、WorkBuddy 国际版、CodeBuddy 国际站均未验证。
- [x] 5.7 Windows 新包复测（2026-11-08 22:00，包 `preview-088-20261108-215815.tgz`，sha256 `43aa474b…c2ec`；空闲预检 activeWorkers=0；原生安装器退出 0；逐文件校验 1036 个、0 不一致；Desktop 正常关闭后带无障碍参数重启）：TRAE CN 由“CLI 启动入口无法确认”变为“未登录”且可点“登录账号”；WorkBuddy CN 自动识别为 `D:\Software\workbuddy`（配置中无手动路径），状态“请在桌面端检查登录状态”；WorkBuddy 国际版显示暂不可用（未安装，符合预期）；CodeBuddy 登录：启动→站点菜单→选中国站→浏览器等待，逐次读取无障碍树未出现“无法识别当前步骤”，原生终端未展开。连接页左栏显示“试验性”。
- [ ] 5.8 Windows 上 CodeBuddy 授权超时画面的实机触发、TRAE CN 登录完成（停在浏览器授权，需用户手机验证）、其他已登录 CLI 的重新登录（需先退出、用户重新授权）、WorkBuddy CN 桌面端管理与真实派遣（hy4free / glm-5.3-flash）尚未执行；Mac Desktop 已正式构建但未目视复看本轮改动。
