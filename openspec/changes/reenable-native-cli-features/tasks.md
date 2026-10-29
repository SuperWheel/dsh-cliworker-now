# Tasks

## 1. 核实

- [x] 1.1 Grok：核实 ACP 模式下网页搜索与抓取是否产生权限请求，以及在 Windows/macOS 上的行为。
  - 2026-10-28（grok 1.0.62，macOS，源码与文档核实，未发起真实网页调用）：工具 ID `web_search`/`web_fetch`，权限规则名 `WebSearch`/`WebFetch`。搜索不询问；抓取对非白名单域名询问，ACP 下作为权限请求转交（`--always-approve` 自动放行）。抓取默认关闭（`features.web_fetch` 默认 false，或 `GROK_WEB_FETCH`）。ACP 会忽略 `--tools`。真实 grok 1.0.62 用写入与只读两份配置完成 ACP `initialize`。
  - 未验证：Windows 行为；真实网页搜索/抓取往返（并入 4.1）。
- [x] 1.2 OpenCode/MiMo：按实际安装版本核实原生 skill 发现路径与 `OPENCODE_DISABLE_EXTERNAL_SKILLS` 的作用范围，确定只读提供用户 skill 的方式，确认不会读取 provider 配置或其他 CLI 凭据。
  - 2026-10-28（opencode 1.19.0、mimocode 0.1.15 源码核实，子 Agent 只读调查）：两者支持配置 `skills: { paths, urls }`，按 `**/SKILL.md` 扫描。OpenCode 自身目录：`${XDG_CONFIG_HOME}/opencode/{skill,skills}`、`~/.opencode/{skill,skills}`、项目 `.opencode/{skill,skills}`（受 `DISABLE_PROJECT_CONFIG` 控制）；`.agents/skills` 受 `DISABLE_EXTERNAL_SKILLS` 控制；`.claude/skills` 需外部与 Claude 两个开关同时打开。MiMo 对应 `mimocode` 目录与 `MIMOCODE_*` 开关。
  - 结论：保留全部隔离开关，把用户自己的 skill 根目录（仅现存目录）写入 `skills.paths`，skill 权限改为 allow。`skills.paths` 只是发现路径，不是安全边界。
  - 发现的隔离缺口（本变更未改，另行处理）：两者仍会读取 `~/.opencode`、`~/.mimocode` 下的配置；MiMo Worker 环境只经 `firstPartyEnvironment('mimo')`，使用真实配置目录。
- [x] 1.3 OMP：核实 `approvalMode` 取值及其审批事件能否接入 DSH 审批。
  - 2026-10-28（@oh-my-pi/pi-coding-agent 16.4.4 源码核实；另有全局 17.0.1 未核实）：`approvalMode` 为 `always-ask`/`write`/`yolo`。RPC 模式下询问为 `extension_ui_request`（`method:'select'`，标题 `Allow tool: bash\nCommand: …`，选项 `["Approve","Deny"]`），回复 `{type:'extension_ui_response', id, value:'Approve'|'Deny'}` 或 `cancelled:true`；无超时，事件不带工具调用 ID。原桥一律取消。结论：可接入 DSH 审批。
- [x] 1.4 ZCode：核实 `Skill` 工具是否涉及委派，浏览器 REPL 的用途与风险（供后续决定）。
  - 2026-10-28（源码核实）：`Skill` 只加载指令，不含 Agent/Task，可单独开启（需 `features.skill` 与 `skills.enabled`）；按设计随 5.1 子 Agent 决定一起处理，本次不改。浏览器 REPL（`node_repl` 的 `js`）是通用代码执行（fs/net/child_process），保持关闭。

## 2. 实施

- [x] 2.1 Grok：去掉 `--disable-web-search` 与 `GROK_WEB_FETCH=0`。
  - `GROK_NATIVE_WEB` 常量：不再传 `--disable-web-search`，`GROK_WEB_FETCH=1`，配置 `features.web_fetch = true`；规划 `--tools` 加 `web_search,web_fetch`；仅可查看配置 `[permission] allow` 加 `WebSearch`、`WebFetch`。能力表 Grok 加 `web`，DSH 网页备选退出目录。
- [x] 2.2 OpenCode/MiMo：按 1.2 结论启用用户原生 skill，保留账号隔离项。
  - `nativeSkillPaths`（`cli-native-capabilities.mjs`）；OpenCode 在 `prepareOpenCode` 写入启动配置，MiMo 在 `serverConfiguration` 按运行环境计算；两处 `skill: 'allow'`；能力表加 `skills`。
- [x] 2.3 Pi：完全权限时 `--tools` 追加 bash（依赖 `relay-native-approvals-to-host` 2.1 的预设读取）。
  - `piOmpNativeTools(cli, mode, access)`；档位快照提前到工具桥准备之前，与启动共用一份（runtime `accessSnapshot`）；能力表按实际 `--tools` 给出 `shell`。
- [x] 2.4 OMP：按 1.3 结论处理 bash。
  - 写任务在工作区内修改与完全权限下加 bash；`--approval-mode`/`tools.approvalMode` 取 `write`/`yolo`。桥把审批询问转为 `approval` 帧，Host 经 `BridgeProtocol` 中继、私有邮箱回写，桥回 `extension_ui_response`；拒绝后正常结束为结果待核实；停止/关闭时回 Deny；非审批交互请求仍判失败。Host 对 OMP 同样在审批等待期间暂停空闲时限。

## 3. 自动检查

- [x] 3.1 adapter 参数测试：Grok 无网页禁用参数；OpenCode/MiMo skill 可见且隔离项仍在；Pi 三档预设下 bash 有无正确；能力表随之变化。
  - `tests/grok-adapter.test.ts`（参数、环境、两份配置）；`tests/cli-native-capabilities.test.ts`（Pi/OMP bash、skill 根目录只取同 CLI 现存目录、能力表）；`tests/native-http.test.ts`（各档位 skill allow、`skills.paths` 合并）；`tests/harness-opencode-accounts.test.ts`（Worker 配置含 `skills.paths`，外部 skill 与 Claude 开关仍为 1）；`tests/pi-omp-adapter.test.ts`（Pi/OMP 各档位 `--tools`、OMP 审批允许→SUCCESS/拒绝→UNCERTAIN 且回写原生值、非审批交互仍失败、`--approval-mode` 按档位）；`tests/native-runtime.test.ts`（工具桥准备与启动共用一份档位快照）。夹具均为模拟 CLI。
- [x] 3.2 `pnpm typecheck`、关联测试、`pnpm build:preview`。
  - 2026-10-28：`pnpm typecheck` 通过；关联测试通过（pi-omp-adapter + cli-native-capabilities 110 项，native-http 等 5 个文件 132 项）；全量 `pnpm test` 239 个文件通过、3 个跳过（4917 项通过、13 项跳过）；`pnpm build:preview` 成功，隔离包中 `native-session-http.mjs`、`pi-omp-bridge.mjs` 可加载，`cli-native-capabilities.mjs` 含 `nativeSkillPaths`。未正式构建、未更新 Desktop 链接。

## 4. 真实验收（需已有选型授权）

- [x] 4.1 Grok 网页搜索、OpenCode 使用用户 skill、Pi 完全权限下执行命令与工作区内修改下走 DSH 备选；未验证项在本任务下列出。
  - 2026-10-28 合并后真实验收（macOS，`.test-data/accept-merged.ts` 用隔离预览包快照的 `WorkerRuntime` 跑真实 CLI 与模型；DSH 审批弹窗由脚本按预设决定并记录，CLI 端、进程退出与产物均为真实；证据在 `.test-data/accept-merged/<场景>-<cli>-*/report.json`，不入 Git），快照与提交 17b0763 的 `src` 逐文件一致。
  - Grok `grok-4.5`/low，仅可查看（规划）：原生 Web search 完成，回复含标记。
  - OpenCode `zhipuai-coding-plan/glm-5.3-flash`/low 与 MiMo `xiaomi/mimo-v2.6-flash`/low，仅可查看（规划）：项目 `.opencode|.mimocode/skills/<随机名>/SKILL.md` 中的标记只写在 skill 文件里，CLI 经 `skill` 工具加载后回复该标记。
  - Pi `zai-coding-cn/glm-5.3-flash`/low：完全权限下原生 bash 执行并写出正确文件；工作区内修改下没有 bash，CLI 改用原生 write 完成。
  - OMP `zhipu-coding-plan/glm-5.3-flash`/default，工作区内修改：bash 前弹出「Allow tool: bash」（command）。允许（延迟 30 秒）→ 完成、文件正确；拒绝 → 结果待核实「CLI 额外权限请求已拒绝，但 CLI 报告本轮已完成…」，文件未创建。
  - 未验证：Pi 在工作区内修改下经 DSH 备选命令工具执行（脚本不接 Harness 工具桥，需 Desktop）；OMP 完全权限 `yolo` 的真实运行；Desktop 弹窗；Windows 上的 Grok 网页与 skill 目录；Grok 网页抓取（fetch）的授权往返。

## 5. 待用户决定

- [x] 5.1 CLI 内部子 Agent（Grok、ZCode）是否启用；统一 Claude Task、Codex 多 Agent 的标准。
  - 2026-10-29 用户决定「内部子agent不启用」：Grok `--no-subagents`/`[subagents] enabled = false`/`GROK_SUBAGENTS=0`、ZCode Agent/Task/SendMessage/工作流保持关闭，ZCode `Skill` 按设计随之保留（1.4 核实它本身不委派）。Claude Task、Codex 多 Agent 维持现状，本变更不调整；如需统一另立变更。
- [x] 5.2 CLI 记忆（Grok、Hermes、OMP）是否启用。
  - 2026-10-29 用户决定「记忆要启用」，并补充「记忆要看原生cli默认有没有开启，如果用户在之前的cli里开启了记忆那就启用记忆，如果用户之前没管理过，那就不开启」；记忆位置选「与直接使用共用」，OMP 选「保持关闭并记理由」，ZCode（原清单漏列）选「一起核实并启用」。实施见第 7 节。

## 6. 文档

- [x] 6.1 README（中英）支持范围列出各 CLI 已关闭的原生功能及类别；验证记录写在本文件对应任务下。
  - README「权限与数据」新增「关闭的原生功能」并更新 OMP/Pi 权限说明；`doc/design.md` 新增 2026-10-28 本变更小节。

## 7. 按用户决定实施（2026-10-29）

- [x] 7.1 记忆跟随原生设置并共用原生目录；子 Agent 保持关闭；OMP 记忆保持关闭并记理由。
  - 核实（源码/安装包，未调用模型）：grok 1.0.62 内置文档的记忆优先级与 `~/.grok/memory-v2`；hermes-agent `get_builtin_memory_store_flags`（缺省开）、记忆工具集 `memory`、`HERMES_HOME/memories`、写入带文件锁；ZCode 桌面 `setting.json` `memoryEnabled` 默认 false、CLI `features.memory` 默认 true、记忆根 `<ZCODE_STORAGE_DIR 或 ~/.zcode>/cli/memories/projects/…`、提取用本轮模型；OMP 17.0.1 本地记忆依赖 `agent.db` 并整份重写记忆目录，整理模型取 `smol` 角色。
  - 本机原生现状（只读开关字段）：Grok 配置无记忆设置 → Worker 关；Hermes `memory_enabled: true`、`user_profile_enabled: true` → 开；ZCode 桌面 `memoryEnabled: true` → 开；OMP 原生 `backend: local`，Worker 仍关。现有 Worker 私有目录中的 `memories` 均为空目录，改为链接时直接替换。
  - 实现：`cli-native-capabilities.mjs` 新增 `shareNativeMemory`/`unshareNativeMemory`/`grokTomlMemory`/`grokNativeMemory`/`hermesNativeMemory`；`grok-adapter.ts`、`native-hermes-home.mjs`、`zcode-adapter.ts`、`native-zcode.mjs` 按开关链接或去链接、调整参数与偏好回复；`pi-omp-bridge.mjs` 注明 OMP 关闭理由。
- [x] 7.2 自动检查：类型检查、关联测试、隔离构建。
  - 新增测试（夹具均为模拟）：`tests/cli-native-capabilities.test.ts`（TOML 读取、Grok 优先级、Hermes 开关与数值、链接建立/幂等/空目录替换/含文件目录改名保留/旧链接重指/普通文件拒绝/去链接不动原生文件）；`tests/grok-adapter.test.ts`（文件级模拟 HOME；默认关、开启后链接与 `GROK_MEMORY=1`、关闭后只删链接；`--no-subagents` 始终存在）；`tests/native-hermes-permission-levels.test.ts`（缺省开、工具集、链接与清理后保留；关闭时无工具集、无链接、不带 `provider`）；`tests/zcode-adapter.test.ts`（未设置为关且不建目录、开启后链接、旧通路不传变量、非布尔值按关）；`tests/native-zcode.test.ts`（桥按变量回复 `memoryEnabled`，CLI 收不到该变量）。Grok/Hermes/共用函数测试由 Codex 子 agent（gpt-6.1-sol high）编写，已逐项审阅并复跑。
  - 2026-10-29：`pnpm typecheck` 通过；关联测试 `cli-native-capabilities`、`grok-adapter`、`native-hermes-permission-levels` 98 项通过，`zcode-adapter`、`native-zcode`、`zcode-resume` 97 项通过；`native-http` 中 Hermes 私有目录断言按新默认（源配置无记忆段 → 开启，工具集含 `memory`）更新后通过。全量 `pnpm test` 首轮 3 项失败：上述 `native-http` 1 项（已更新），`native-bridge-time-limit` 2 项为全量负载下的计时竞争（pid 文件未写出、总时限先于空闲时限），与本改动无关，单独连跑 3 次通过。更新后第二轮全量：241 个文件通过、3 个跳过，5169 项通过、13 项跳过，仍有 1 项失败：同一文件的「pauses the idle window while the Host holds it for a DSH tool approval」在 30 秒内超时。该文件只经 `prepareNativeWorker`/`workerArguments` 起真实子进程，不经过本次改动的 Grok/Hermes/ZCode 启动代码；单独再跑 3 次，4 项全部通过。`pnpm build:preview` 成功，隔离包中 `cli-native-capabilities.mjs` 的新导出、`native-hermes-home.mjs`、`native-zcode.mjs` 可加载。未正式构建，未更新 Desktop 链接。
  - 未验证：真实 CLI 的记忆读写（Grok 开启路径、Hermes、ZCode 都会往用户原生记忆写入测试内容，未获授权，未执行）；Grok 记忆目录是否随 `GROK_HOME` 迁移（文档只写 `~/.grok/memory-v2`；若不随迁移，记忆仍直接写原生目录，结果一致）；ZCode 是否接受符号链接形式的记忆根；Windows junction；CLI 后台整理的额度消耗。
- [x] 7.3 文档：README（中英）「关闭的原生功能」与新增「CLI 记忆跟随你自己的设置」；`doc/design.md` 新增 2026-10-29 小节；本变更 proposal/design/spec 已同步。
