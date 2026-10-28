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

- [ ] 5.1 菜单：主对话三种档位下 Worker 菜单的选项、名称与悬停说明；选择完全权限出现 DSH 确认。（部分：工作区内修改、仅可查看两档已验；完全权限档未验，见下方记录）
- [x] 5.2 Codex 询问档：写工作区文件前出现询问，拒绝后文件未生成、任务为已完成。
- [x] 5.3 主对话降档：Worker 选完全权限后主对话改为工作区内修改，菜单显示自动审批、时间线有上限说明；改回后恢复。（以「自动审批 → 主对话仅可查看」代替，见下方记录）
- [x] 5.4 规划开关：开启规划后退出，档位不变。

## 6. 文档与归档

- [x] 6.1 README（中、英）权限说明；`doc/design.md` 本变更小节。
- [ ] 6.2 归档顺序：`relay-native-approvals-to-host`、`reenable-native-cli-features` 归档之后再归档本变更（MODIFIED 需求来自两者）。

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
- 5.1（部分）：
  - 主对话工作区内修改：菜单为「询问」「自动审批」，悬停为「使用此 CLI 原生的自动审批…它仍要确认的请求会问你。主对话为工作区内修改，最高可选自动审批。」
  - 主对话仅可查看：菜单只有「询问」，悬停末尾为「主对话为仅可查看，最高可选询问。」
  - 未验：主对话完全权限时的三项菜单，以及 Worker 选完全权限时的 DSH 确认。把主对话切到完全权限需在 DSH 确认框勾选「我已了解风险」，自动模式的安全分类器拒绝了这次点击，未绕过，留给用户自行验证或授权。
- 5.2：主对话仅可查看、Worker 未选档（跟随主对话），运行 `73fbcb0d`。时间线「本轮权限：询问」；子会话原生审批面板出现「执行命令：/bin/zsh -lc 'printf ASK-DENY > ask-deny-20261029.txt'」及拒绝/允许一次；点拒绝后事件「授权决定：拒绝（DSH 用户）」「Codex 原生交互请求已拒绝」，本轮「已完成，用时 2 分 6 秒」，回复说明文件未创建且未改用其他方法。文件不存在；Worker `status=completed`，`error`、`resultNotice` 为空。
- 5.3：主对话工作区内修改时 Worker 依次选「询问」「自动审批」，存储为 `level: auto`（再次选当前项不保存）。主对话改为仅可查看后，存储仍为 `level: auto`，菜单显示「询问」并带上限说明；在 Worker 发「只回复 OK…」（运行 `c5bbcf73`），事件为「本轮权限：询问（受主对话限制）」，回复 OK、completed。主对话改回工作区内修改后，Worker 菜单恢复「自动审批」。本轮另有一条 CLI 诊断，是用户 Codex 配置中 consensus MCP 未登录（`AuthRequired`），与本变更无关。完全权限 → 工作区内修改这一组合因上述分类器拦截未跑，机制相同（取较低者、不改写保存值）。
- 5.4：Worker 输入 `/plan` →「开启规划」：存储 `mode: plan`、`level: auto`，输入框旁出现「计划」标识（提示 `/plan off`），档位控件仍为「自动审批」。点标识关闭后 `mode: accept-edits`、`level: auto`，标识消失。
- 结束状态：主对话工作区内修改，codex-2 `level: auto`；验收期间无其他运行中任务。
