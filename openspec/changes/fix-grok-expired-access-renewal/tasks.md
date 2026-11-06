## 0. 现状证据（已完成，只读）

- [x] 0.1 Windows 只读排查与实机复现（2026-11-06）
  - 连接：SSH Windows 测试机（admin）；Grok 为 `C:\Users\admin\.grok\bin\grok.exe`，版本 `grok 1.0.50 (c58f321264ba)`。
  - 凭据元数据（未输出令牌值）：单一官方 OIDC 槽位，含 key 与 refresh_token；create 2026-11-05T15:39:38Z，expires_at 2026-11-05T21:39:38Z，JWT 有效期 360 分钟；2026-11-06 19:11–19:20（北京时间）期间已过期 812→821 分钟，没有被续期。
  - 安装预览包 `preview-087c-20261106-190113.tgz`（SHA256 7bc9176a…0922，当前工作区构建）：原生安装器退出码 0，lib 744 个文件，index.js 哈希与 Mac 一致。
  - 界面（Codex Computer Use，gpt-6-astra high）：
    - 设置 → Grok Build 显示绿色「已登录」，同时提示「登录需要续期，请打开 Grok」，模型与强度禁用；点「刷新模型」后不变。
    - 主对话派遣 Grok「只回复 OK」，工具状态为失败，报同样的错误。没有新增 Worker，grok.exe 没有运行，真实模型任务 0 次。
  - 目录探测日志 `C:\Users\admin\.dsh\cliworker-now\catalog\grok\query-*\grok\catalog\home\logs\unified.jsonl` 显示探测使用无凭据的私有路径，属设计如此。
  - Windows Grok 日志（`C:\Users\admin\.grok\logs\unified.jsonl`，只投影白名单字段）：10-18、10-29、10-30、11-05 都是先出现 is_expired=true，接着 `auth: logout`，再 `auth update disk written`，即用户重新登录后恢复。
  - Mac Grok 1.0.62 日志（`~/.grok/logs/unified.jsonl` 第 101–151 行，2026-10-31T07:10:31Z）：is_expired=true → `oidc refresh attempting idp`（reason PreRequest）→ `try_refresh_pure succeeded` → `auth update disk written`。这证明 Grok 本体会自行续期，但对应的命令入口未知。
  - 共享笔记：`side-session-notes/local_d3b4e8e8-…/windows-grok-not-logged-in.md`。

## 1. 原生续期入口核实（实施前置；需用户授权）

- [x] 1.1 （A 已核实，B 未做）Mac Grok 1.0.62：等本机 access 自然过期后，分别用 D1 的 A（`grok models`）和 B（ACP initialize，使用真实凭据路径）运行一次。用元数据确认 expires_at 是否更新、原文件是否被就地写回（inode 与链接数不变）、退出码、是否连接或启动 leader、是否残留子进程。不输出凭据，不发起生成。
  - 2026-11-06 经正式构建后的 Desktop 界面触发（见 4.4）：access 于 12:41:39Z 自然过期，12:42:12Z 元数据确认未续期（剩余 −0.6 分钟，指纹 7222b3d0…）。12:43:16Z 前后打开设置 → Grok Build，12:43:22Z DSH Host 子进程 `~/.grok/bin/grok models` 写回：expires_at 18:43:22Z（360 分钟），身份摘要不变，access 指纹改变，inode 86256051→86571706（原子替换，nlink=1，非链接，权限 0600）；随后无 grok 进程残留。续期私有日志位于本次目录查询的临时 `query-*` 目录，查询结束随目录删除，未能留存 outcome 行。B 未运行。
- [x] 1.2 Windows Grok 1.0.50：对当前已过期的凭据做同样核实。这会让 Grok 改写 Windows 上的凭据文件，须用户另行明确授权后才执行。
  - 用户 2026-11-06「授权核实并实施」后执行 A（`grok models`，私有 GROK_HOME，`GROK_AUTH_PATH` 指向 `C:\Users\admin\.grok\auth.json`）：已过期 854 分钟，3.3 秒退出码 0；expires_at 更新为 2026-11-06T17:54Z 前后（有效期 360 分钟），身份摘要不变，access 指纹改变；文件被原子替换（inode 改变、nlink=1，不是就地改写），未启动 leader，退出后无 grok 进程残留。私有日志：`auth.json.lock` → `oidc refresh enter`（PreRequest）→ `try_refresh_pure succeeded` → `auth update disk written` → `auth: silent refresh` outcome=`Renewed`。只输出元数据，未输出令牌；未运行 B。
- [x] 1.3 记录「需要手动登录」的可观察信号（退出码、stderr 关键字，只在本地匹配）；能在隔离环境安全构造时再核实，否则在 D3 中保持保守判定。
  - 采用 Grok 日志 `auth: silent refresh` 事件的 `ctx.outcome`：成功为 `Renewed`；Windows 历史日志中不能续期时为 `Failed(ManualLogin)`。stdout/stderr 不解析。未在真实账号上构造「需要手动登录」场景，只有模拟测试覆盖。
- [ ] 1.4 （未核实）核实 macOS Worker 的 `auth.json` 符号链接：Grok 续期时是否会用 rename 把链接替换成私有文件。只记录结论，修复另立变更。
  - 未执行。本变更的续期进程直接指向原生文件，不经 Worker 链接；Worker 运行期间 Grok 自行续期时链接可能被替换的风险仍在，见 design.md。
- [x] 1.5 根据结果确定 D1，同步更新 design.md；两个入口都不满足就停止，回到提案阶段。
  - 选 A，design.md D1 已更新。

## 2. 实施

- [x] 2.1 新增 `src/host/grok-renewal.ts`：在途合并、读者取消、账号终端互斥（`reserveGrokAccount`）、超时、进程范围清理与 poisoned、续期前后身份核对、D3 结果分类。
- [x] 2.2 `grok-models.ts`：`readGrokOwnAccount` 按原因码分类；`discoverGrokAccountModels` 增加可选 `renew` 回调，触发阈值 5 分钟。
- [x] 2.3 `grok-adapter.ts`：`discoverGrok` 注入续期，提供续期进程的 argv 与 env（私有 `GROK_HOME`，`GROK_AUTH_PATH` 指向原生文件，清空 API key，关闭遥测）。
  - env 复用目录探测的私有状态 `state(join(stateDirectory, 'renewal'))`；`extended-adapters.ts` 把 `catalogFor` 已有的 `{ backend, signal, graceMs }` 传入。
- [x] 2.4 `zcode-grok-accounts.ts` / `accounts.ts`：账号终端与续期互斥；内存中的「续期被拒」记录按凭据指纹参与账号状态判断。
- [x] 2.5 `src/client/i18n-messages.ts`：新增和调整提示文案，指向「账号终端」。

## 3. 自动检查

- [x] 3.1 新增 `tests/grok-renewal.test.ts`，用模拟进程覆盖：续期成功后列出模型；access 有效时不续期；仍过期判为需要重新登录；身份变化；账号终端占用；并发合并与单个调用取消；超时与清理未确认；网络失败不降级账号状态。
- [x] 3.2 更新 `tests/grok-models.test.ts`、`tests/zcode-grok-accounts.test.ts`、`tests/grok-adapter.test.ts`：读取原因码，续期被拒后的状态，以及凭据变化后恢复。
- [x] 3.3 运行 `corepack pnpm typecheck` 与关联 vitest，记录通过和失败数量。
  - 2026-11-06：typecheck 通过；关联 vitest 17 个文件 388 项通过，另一组 8 个文件 324 项通过；Grok 四个测试文件复跑 96 项通过（20:07）。变异检查：去掉 `renew` 调用后 3 项失败，恢复后通过。
- [x] 3.4 运行 `corepack pnpm spec validate fix-grok-expired-access-renewal --strict` 与 `corepack pnpm spec:check`。
  - 2026-11-06：本变更严格校验 valid；全部严格校验 54 项通过（`spec:check` 脚本内调用的 pnpm 不在 PATH，改用 `corepack pnpm spec validate --all --strict --no-interactive` 直接运行）。

## 4. 真实验收（需授权）

- [x] 4.1 `build:preview` 打包，经 SSH 原生安装器装到 Windows，核对哈希；DSH 以无障碍参数启动。
  - `preview-087d-20261106-200257.tgz`（当前工作区构建，含本变更）：`dsh.cmd plugin --profile desktop add --save-exact` 退出码 0，profile 指向该包；lib 747 个文件，index.js SHA256 `7b47025c…a565` 与 Mac 包一致。DSH 以 `--force-renderer-accessibility` 等参数经计划任务启动。
- [ ] 4.2 （部分）Windows 界面：access 过期时打开设置 → Grok Build，确认能自动续期并列出模型；元数据显示 expires_at 已更新、身份不变；整个过程不输出凭据。
  - 已做：Codex Computer Use 打开 CLI Worker 设置 → Grok Build，显示「已登录」、模型 Grok 4.5、思考强度 Low，原先的「登录需要续期」提示消失（access 有效路径回归通过）。
  - 未做：Windows access 过期时由界面触发自动续期。1.2 的实测已把 Windows 凭据续到约 17:54Z，此路径在 Windows 上未复测；同一代码路径已在 Mac Desktop 上实测通过（见 1.1、4.4）。
- [x] 4.3 Windows 派遣：用用户授权的模型与强度执行一次「只回复 OK」，核对事件、退出状态、Worker 记录。
  - 2026-11-06 用户要求实操验收后执行（Codex Computer Use，gpt-6-astra high）：新会话发送「只回复 OK」，问题卡「是否沿用 Grok 4.5 · Low · 不使用角色预设？」选沿用；无权限审批。SSH 核对 Worker `grok-1`：status=completed，preference grok-4.5/low，observedModel=grok-4.5，transport grok-acp-v1，lastResult「OK」；events 8 条：user → queued → 本轮权限：自动审批 → CLI 已连接 → Grok 原生模型已确认 → assistant OK → result OK → completed（12:30:25–12:30:37Z）。结束后 grok 进程 0；凭据 expires_at 仍为 17:54:10Z、mtime 未变（access 有效，未触发续期）。设置页刷新模型一次正常。
- [x] 4.4 Mac 回归：access 有效与过期两种情况下，设置页与派遣都能正常工作。
  - 确认无活动 Worker 后 `corepack pnpm build`（lib 含续期代码），退出并以无障碍与防节流参数重启 Desktop。
  - 过期设置页：Codex Computer Use 于 20:43:16（本地）打开 Grok Build，显示「已登录」与「正在读取 Grok Build 模型…」；20:43:34 加载完成，模型 Grok 4.6、强度 Xhigh、下拉框可用，无续期或登录警告。凭据在 20:43:22 由插件续期（见 1.1）。即原问题场景在 Mac 界面上已自动恢复。
  - 派遣：新会话（工作区 CLI Worker Demo）发送「只回复 OK」后出现「Grok Build 模型 / 选择模型 Grok 4.6 / Grok 4.5」问题卡，无「沿用」项（该项目尚无已确认的完整 Grok 选型，符合首次选择规则）。按不代选模型的规则先停在此卡；用户选定 Grok 4.5 · Low 后，依次选 Grok 4.5、Low、不使用角色预设。Worker `grok-1`：status=completed，preference grok-4.5/low，observedModel=grok-4.5，transport grok-acp-v1，lastResult「OK」；events 8 条 user → queued → 本轮权限：自动审批 → CLI 已连接 → Grok 原生模型已确认 → assistant OK → result OK → completed（12:55:20–12:55:30Z）；raw 中无 tool_call；结束后无 grok 进程。界面上「已编辑 tasks.md」是本变更 tasks.md 在 20:45:50 的手动更新（工作区位于仓库 `.test-data` 下，故显示仓库内改动），早于本次派遣，并非 Worker 改动。
- [x] 4.5 明确记录未执行的验证（例如无法构造「需要手动登录」的真实场景）。
  - v0.8.7 发布候选（Windows）：清理 Desktop cookie 后重启，设置 → Grok Build 显示「已登录」、Grok 4.5 / Low，无警告；记录见 `add-sibling-dispatch-unified-subagents/tasks.md` 第 6 节。
  - 未执行：真实「需要手动登录」场景；Windows 过期状态下的界面自动续期（4.2 后半，Mac 已覆盖同一路径）；macOS Worker 链接写回（1.4）；方案 B；续期私有日志 outcome 的真实留存（随查询临时目录删除）。

## 5. 文档

- [x] 5.1 README / README.en.md：说明 Grok 过期后会自动由 Grok 本体续期，以及续期会写回 `~/.grok/auth.json`；更新失败提示的含义。
- [x] 5.2 `doc/design.md`：在 Grok 账号章节补充续期设计与取舍。
