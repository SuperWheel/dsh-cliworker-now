# Tasks

## 1. 核心（Host / Client / 共享）

- [x] 1.1 `types.ts` 新增 `WorkerLevel`，Worker 增加可选 `level`；`storage.ts` 校验该字段。
- [x] 1.2 `worker-permissions.ts`：按 CLI 的三档名称与说明、上限计算、选项列表、`workerPlanSupported`。
- [x] 1.3 `native-approval-policy.ts`：实际档位计算、`runAccess`、`decideApproval` 加入档位。
- [x] 1.4 `index.ts`：权限快照与启动模式、仅可查看派遣检查、`permissionForWorker`/`configureWorkerPermission`（档位与规划开关）、子会话沙箱与审批策略、原生审批与 DSH 备选工具审批判定。
- [x] 1.5 `runtime.ts`：启动模式不再因只读改为规划（规划类 CLI 除外）；「本轮权限」写实际档位名称与上限说明。
- [x] 1.6 Client：`harness-control-guards.tsx`（档位 ↔ DSH 预设值、规划标记、退出规划）、`harness-native-commands.ts`（`/plan`、`/permissions`）、`conversation-features.ts`（规划支持）。
- [x] 1.7 `cli-native-capabilities.mjs`：Pi 第一项只读工具集；第一项下不因只读撤下原生写入能力表（规划类 CLI 除外）。

## 2. 各 CLI 映射（按 design.md 第 6 节）

- [x] 2.1 Codex、Claude Code（含拒绝后不中断）。
- [x] 2.2 Kimi、Qoder、Qoder CN、Grok。
- [x] 2.3 OpenCode、MiMo。
- [x] 2.4 ZCode、Hermes、Antigravity。
- [x] 2.5 Pi、OMP。

## 3. 原生能力核实（不调用模型）

- [x] 3.1 逐个核对安装版本的模式参数、ACP 模式目录或 HTTP 接口；记录版本、命令与结果。不可用的按 design.md 第 7 节降级，并同步调整菜单名称。

## 4. 自动检查

- [x] 4.1 单元测试：上限与实际档位、旧 Worker 跟随主对话、菜单选项与说明、保存超上限被拒、规划开关与档位独立、审批判定矩阵（规划 / 完全权限 never / 中档 never / 询问）、各 CLI 三档参数与降级。
- [x] 4.2 `pnpm typecheck`、关联测试、`pnpm spec:check`、`pnpm build:preview`。

## 5. Desktop 验收（Codex 子 agent + Computer Use；真实模型仅用已授权的最低选型）

- [x] 5.1 菜单：主对话三种档位下 Worker 菜单的选项、名称与悬停说明；选择完全权限出现 DSH 确认。
- [x] 5.2 Codex 询问档：写工作区文件前出现询问，拒绝后文件未生成、任务为已完成。
- [x] 5.3 主对话降档：Worker 选完全权限后主对话改为工作区内修改，菜单显示自动审批、时间线有上限说明；改回后恢复。
- [x] 5.4 规划开关：开启规划后退出，档位不变。

## 6. 文档与归档

- [x] 6.1 README（中、英）权限说明；`doc/design.md` 本变更小节。
- [x] 6.2 归档顺序：`relay-native-approvals-to-host`、`reenable-native-cli-features` 归档之后再归档本变更（MODIFIED 需求来自两者）。
  - 2026-10-29：`relay-native-approvals-to-host` 已归档（`2026-10-29-relay-native-approvals-to-host`），`reenable-native-cli-features` 在完成 7.4 真实验收后归档（`2026-10-29-reenable-native-cli-features`），随后归档本变更。
  - 2026-10-29：`relay-native-approvals-to-host` 已归档；归档后主规格的两条需求多出旧场景名，本变更增量中的场景「中档」「仅可查看下派遣」「不能询问的 CLI」改用原名「工作区内修改」「仅可查看下的只读派遣」「无整进程只读模式的 CLI」（内容为新行为），严格校验通过。仍待 `reenable-native-cli-features`（5.1、5.2 待用户决定）归档。

## 7. 取消主对话上限与 Pi 询问（用户 2026-10-29 追加决定）

用户原话：「一直都保持三项，如果是用户自己切换权限的话，主agent不用询问」；Pi 第一项「改成询问（推荐）」；主 Agent 派遣已选档位的 Worker「也按你选的档位」。第 1–5 节中关于上限的实现与验收记录为当时状态，已被本节取代。

- [x] 7.1 取消上限：`effectiveLevel = level ?? 跟随值`，菜单列全部档位，删除超上限保存拒绝、上限说明与「（受主对话限制）」；有档位时跳过仅可查看派遣拒绝；新增 `workerApproval`（完全权限高于主对话时为 `never`）。
- [x] 7.2 Pi 询问：新增 `src/host/pi-permission-gate.mjs`（`tool_call` 拦截 + RPC `confirm`，nonce、就绪握手、出错阻止）；桥在就绪前不发提示，转发确认到 Host 审批；安装版缺接口时降级；Pi 改走 `BridgeProtocol`；加入 `scripts/build.mjs` 文件清单。
- [x] 7.3 单元测试与全量测试；OpenSpec、README（中、英）、`doc/design.md` 同步。
- [x] 7.4 `pnpm build:preview` 与正式 `pnpm build`。
- [x] 7.5 Desktop 验收：主对话工作区内修改与仅可查看时 Pi 菜单均为三项；Pi 询问档真实一轮（`zai-coding-cn/glm-5.3-flash` low）读取不问、写文件出现询问、拒绝后文件未生成；主对话仅可查看时 Worker 选自动批准编辑按所选运行。完全权限高于主对话的真实运行未测（需再次勾选 DSH 完全权限确认框），由单元测试覆盖。

## 实施与验证记录（2026-10-29）

### 实施分工

- 核心（1.x）由主会话完成；各 CLI 映射（2.x）由 5 个并行 Codex 子 agent（gpt-6-astra high）完成，主会话逐个核对 diff 后补齐跨文件配合：
  - `extended-adapters.ts` 给 `prepareZCode`、`prepareGrok` 传入 `access`（两组报告指出调用处漏传）。
  - `runtime.ts` 删除「该 CLI 没有已确认的原生完全权限模式」提示：Kimi（ACP `auto`）、Hermes（`approvals.mode=off` + YOLO）、Antigravity（跳过确认并关闭终端沙箱）现均有原生完全权限。
  - Grok 中档：子 agent 因 `_meta.autoMode` 无回读而一律降为询问；主会话按安装文档 `26-config-reference.md`（`ui.permission_mode`：`default / ask / auto / always-approve`）与 `22-permissions-and-safety.md`（Auto-review 模式）改为私有配置写 `permission_mode = "auto"`。该键被忽略时 Grok 回到默认询问，只会更严。
  - Kimi 第一项：按 design.md 第 6 节规则改名「仅工作区编辑」，仅可查看下拒绝派遣并不列档位（`runsUnderViewOnly`，同时覆盖 Antigravity、Hermes）；去掉运行器每轮的 default 模式诊断。
  - OpenCode/MiMo 第一项说明改为「改文件、执行命令和工作区外的操作先问你」（`bash=ask` 不区分只读命令）。

### 原生核实（3.1，只读：`--version`、`--help`、安装包源码/字符串；未调用模型）

- Codex 0.162.1：`--help` 有 `on-request`/`never`；`app-server generate-json-schema` 确认 `approvalsReviewer` 支持 `user`、`auto_review`，thread 启动/恢复回执返回实际 reviewer。
- Claude Code 2.1.287：`--help` 列出 `manual`、`auto`、`plan`、`bypassPermissions`；初始化载荷有 `current_permission_mode`，可回读。
- Kimi 2.3.3（设 `KIMI_CODE_NO_AUTO_UPDATE=1`）：`acpModeToToggles` 映射 default/plan/yolo/auto；策略链 `AgentPermissionPolicyService` 顺序为 …`UserConfiguredAsk`…`YoloModeApprove`、`DefaultToolApprove`、`GitCwdWriteApprove`、`FallbackAsk`；`git-cwd-write-approve` 对工作目录（Git 工作树内）的 Write/Edit 直接批准，其余（含命令）落到 fallback-ask。ACP 创建参数不接收权限规则。
- Qoder 1.1.73 / Qoder CN 1.1.74：模式目录含 `Auto`，`configId="mode"` 切换后回执更新 `configOptions`；两版分别核实。
- Grok 1.0.62：`agent --help` 有 `--always-approve`；安装文档见上。
- ZCode 0.16.9：模式 `build/edit/plan/yolo`；`auto` 保留未实现。
- Hermes（install-stamp `baseVersion=0.21.7`，`hermes --version` 因安装锁无写权限未能执行）：Runs API 注册审批上下文，`approvals.mode` 支持 `smart`/`off`，YOLO 环境变量生效。
- Antigravity 1.4.9：`--help` 列出 `accept-edits`、`auto`、`plan`；`--sandbox=false` 被接受；二进制含 headless soft-deny。
- OpenCode 1.19.0：权限值 `ask/allow/deny` 与 `external_directory`；`serve` 无 `--auto`。MiMo 0.1.15：`/permission/skip-all`、`/permission/auto-approve-delete` 的 GET/POST 路由，deny 优先于 skip-all。
- Pi 1.0.4：`--tools`，只读示例 `read,grep,find,ls`。OMP 16.4.4：`--approval-mode always-ask|write|yolo`；设置说明：「Always ask」只自动批准只读工具，「Write」自动批准读与写类工具、bash/eval/browser/task/ssh 等执行类询问，「Yolo」全部自动批准。

### 自动检查（4.x）

- `pnpm typecheck` 通过（Host/Client against DSH 0.2.1-rc.3）。
- 关联测试：客户端控件与命令 35 项、共享层与审批 77 项、Grok/ACP 65 项等均通过；各子 agent 本组测试（Codex/Claude 198+、Kimi/Qoder/Grok 293、OpenCode/MiMo 165、ZCode/Hermes/AGY 192、Pi/OMP 134）通过。
- 全量 `pnpm test` 第一次：244 个文件，5082 项通过、12 项失败、13 项跳过。失败均为旧断言或模拟 CLI 不响应新加的 `--help` 探测（OMP 两份 RPC 夹具、AGY 时限夹具），以及旧的 Antigravity `accept-edits` 参数、旧拒绝提示、`setAccessSnapshot` 新返回形状、Qoder 无快照时为 `auto`。修正后这 6 个文件 83 项通过。
- `pnpm spec validate worker-permission-levels --strict` 通过（INFO：归档须在两个来源变更之后，见 6.2）；`pnpm spec:check` 47 项通过。
- `pnpm build:preview` 成功；确认无运行中的 Worker 与桥接进程后正式 `pnpm build`，Desktop 已重启加载。

### 已知限制与未验证

- 降级只在运行器内发生，不回传 Host；Host 审批仍按实际档位判定，只会更严（见 design.md 第 8 节）。
- 真实模型下未验证：Codex `auto_review` 是否仍把请求转给用户、Claude `auto` 对当前账号可用性、Grok 自动审核、Kimi/Qoder 各档、Hermes smart/off、Antigravity 规划去掉跳过确认后的表现、OMP always-ask/write 审批往返、MiMo skip-all 开关、ZCode 降级路径。
- Windows/Linux 未验证。

### Desktop 验收（5.x，2026-10-29）

- 方式：Codex 子 agent 的 Computer Use 无法绑定 DeepSeek Harness 窗口（`cua.getApp` 连续 5 次超时；`/Applications` 下另有隐藏的 `.DeepSeek-Harness-auth-candidate-….app`，bundle id 有歧义，未改动）。改为后台启动 Desktop，用内置浏览器直连 Host Web UI 操作；状态以 DOM 与 `~/.dsh/cliworker-now/<worker>.worker.json`、`.events.jsonl` 为准。验收后 Desktop 已正常退出并重新打开，含令牌的启动日志已删除。
- 测试 Worker：codex-2「工作区外写入-拒绝」（Codex `gpt-6-luna` Low，已授权最低选型）。
- 5.1：
  - 主对话工作区内修改：菜单为「询问」「自动审批」，悬停为「使用此 CLI 原生的自动审批…它仍要确认的请求会问你。主对话为工作区内修改，最高可选自动审批。」
  - 主对话仅可查看：菜单只有「询问」，悬停末尾为「主对话为仅可查看，最高可选询问。」
  - 主对话完全权限（第二次验收，用户在对话中授权代为勾选 DSH 确认框）：菜单为「询问」「自动审批」「完全权限」三项，悬停无上限说明。Worker 选「完全权限」弹出 DSH「确认启用完全权限？」并需勾选「我已了解风险，并愿意继续」；确认前存储仍为 `level: auto`，确认后为 `level: full`，悬停为「使用此 CLI 原生的完全权限，不再询问。」
  - 第一次验收时，自动模式的安全分类器拒绝了勾选该确认框，未绕过；用户随后授权，第二次验收完成。
- 5.2：主对话仅可查看、Worker 未选档（跟随主对话），运行 `73fbcb0d`。时间线「本轮权限：询问」；子会话原生审批面板出现「执行命令：/bin/zsh -lc 'printf ASK-DENY > ask-deny-20261029.txt'」及拒绝/允许一次；点拒绝后事件「授权决定：拒绝（DSH 用户）」「Codex 原生交互请求已拒绝」，本轮「已完成，用时 2 分 6 秒」，回复说明文件未创建且未改用其他方法。文件不存在；Worker `status=completed`，`error`、`resultNotice` 为空。
- 5.3：主对话工作区内修改时 Worker 依次选「询问」「自动审批」，存储为 `level: auto`（再次选当前项不保存）。主对话改为仅可查看后，存储仍为 `level: auto`，菜单显示「询问」并带上限说明；在 Worker 发「只回复 OK…」（运行 `c5bbcf73`），事件为「本轮权限：询问（受主对话限制）」，回复 OK、completed。主对话改回工作区内修改后，Worker 菜单恢复「自动审批」。本轮另有一条 CLI 诊断，是用户 Codex 配置中 consensus MCP 未登录（`AuthRequired`），与本变更无关。
  - 完全权限 → 工作区内修改（第二次验收）：Worker `level: full` 时主对话改为工作区内修改，存储仍为 `level: full`，菜单显示「自动审批」，悬停末尾「主对话为工作区内修改，最高可选自动审批。」；运行 `253fed9f` 事件为「本轮权限：自动审批（受主对话限制）」，回复 OK、completed。主对话改回完全权限（再次经 DSH 确认）后 Worker 恢复「完全权限」；运行 `13563376` 事件为「本轮权限：完全权限」（无上限说明），回复 OK、completed，`error`、`resultNotice` 为空。原始记录不含 Codex 回执里的审批设置，本轮以时间线为准。
- 5.4：Worker 输入 `/plan` →「开启规划」：存储 `mode: plan`、`level: auto`，输入框旁出现「计划」标识（提示 `/plan off`），档位控件仍为「自动审批」。点标识关闭后 `mode: accept-edits`、`level: auto`，标识消失。
- 结束状态（两次验收后）：Worker 改回「自动审批」（降档不弹确认），主对话改回工作区内修改，codex-2 `level: auto`；退出前确认主对话已结束对 Worker 完成通知的处理、无运行中 Worker。

### 取消上限与 Pi 询问（第 7 节）

- 自动检查：
  - `tests/worker-permissions.test.ts` 改为新语义：菜单在三种主对话档位下都列三项、工作区内修改下保存完全权限成功、仅可查看下保存自动审批后子会话沙箱为 `workspace-write`、Hermes 在仅可查看下可选档位、`effectiveLevel('full','read-only') = 'full'`、Pi 名称「询问 / 自动批准编辑 / 完全权限」。
  - `tests/native-approval-relay.test.ts`：完全权限高于主对话时残余请求 `allow-once`（完全权限自动放行）；`workerApproval` 矩阵。
  - `tests/pi-omp-adapter.test.ts`（模拟 Pi，加载真实确认扩展）：询问档写文件转为 Host 审批 `{kind:'file', summary:'写入文件：fixture.txt', detail:'3 字节'}`，允许 / 拒绝分别回复 `confirmed: true/false`；自动批准编辑写文件不问、bash 问；完全权限不加载扩展；扩展不报就绪时报错「Pi 权限确认扩展未加载，本轮未开始」；安装版无接口时按只读运行并说明。
  - 新增 `tests/pi-permission-gate.test.ts` 6 项：放行清单、确认只带有界事实（不含内容）、只认本轮 nonce 的确认、未批准 / 出错即阻止、配置无效不注册不报就绪。
  - `pnpm typecheck` 通过；全量 `pnpm test`：242 个文件通过、3 个跳过，5108 项通过、13 项跳过。
- 构建：`pnpm build:preview` 成功，预览包含 `lib/pi-permission-gate.mjs` 且可独立导入；确认 `~/.dsh/cliworker-now` 无运行中 Worker 后正式 `pnpm build`，Desktop 退出后重新启动加载。
- Desktop 验收（内置浏览器直连 Host Web UI；测试 Worker pi-2「Pi 备选命令-工作区外」，`06a086fa`，Pi `zai-coding-cn/glm-5.3-flash` Low，项目 `cliworker-isolation-test`）：
  - 菜单：主对话工作区内修改时，Pi Worker 菜单为「询问」「自动批准编辑」「完全权限」，当前项悬停为「文件编辑自动批准（Pi 不限制编辑目录）；命令先问你。」；主对话改为仅可查看后仍为三项，无上限说明。（内置浏览器的坐标点击打不开 DSH 菜单，改用页面内 `click()` 打开；菜单项选择用坐标点击与 `click()` 均生效。）
  - Pi 询问：菜单选「询问」后存储 `level: ask`。运行 `0063c039` 发「先用 read 读 a.txt，再用 write 创建 pi-ask-gate-20261029.txt」：事件「本轮权限：询问」，三次 `read` 无授权请求；`write` 时子会话审批面板出现「pi-2（Pi）请求授权：写入文件：pi-ask-gate-20261029.txt 12 字节 工作目录：…」，点拒绝后事件「CLI 请求授权：写入文件：pi-ask-gate-20261029.txt」「授权决定：拒绝（DSH 用户）」，Pi 回复「write 工具被拒绝（user denied write），未执行」且未改用 bash；文件不存在；Worker `completed`，`error`、`resultNotice` 为空。
  - 所选档位高于主对话：主对话改为仅可查看，Pi Worker 选「自动批准编辑」保存成功（`level: auto`，旧版会以「高于主对话」拒绝）。运行 `aa8a6fa6` 写 pi-auto-readonly-20261029.txt：事件「本轮权限：自动批准编辑」（无「受主对话限制」），无授权请求，文件内容 `PI-AUTO`，`completed`。
  - 结束状态：主对话改回工作区内修改；pi-2 保留 `level: auto`（原为未设置，在工作区内修改下行为相同）；测试文件 pi-auto-readonly-20261029.txt 留在测试项目中。
- 未验证：完全权限高于主对话的真实运行（需再次勾选 DSH 完全权限确认框）、主 Agent 派遣已选档位 Worker 的真实一轮、Pi 安装版缺接口时的降级路径（仅模拟夹具）、Windows/Linux。

