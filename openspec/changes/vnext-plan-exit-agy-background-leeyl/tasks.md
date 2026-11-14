# Tasks

## 1. 定位根因 〔后端｜2h〕
- [x] 1.1 Claude Code 规划收尾判错：对照用户截图与 `src/host/native-claude.mjs`
  - 原第 155 行只转交 `requires_user_interaction !== true` 的授权请求；第 174–180 行把 `ExitPlanMode` 记为「CLI 请求额外交互授权，插件未批准」并回复 `deny + interrupt`；第 296 行再按 result 的 `is_error`／`error_during_execution` 判失败；结果正文只取 `value.result`，方案丢失
  - Claude Code 只走原生 Runner（`native-bridge.mjs` 映射 `runNativeClaude`），派遣、续聊、恢复与分支共用 `runClaudeSession`
- [x] 1.2 Antigravity 后台子 Agent 误报：读 `native-acp.mjs` 的 `awaitBackground` 与 `native-agy-acp.mjs` 的 `AGY_BACKGROUND`
  - 原第 316 行等待上限从主回合开始时起算；主回合超过上限时第一次循环 `wait <= 0` 直接判待核实，一次跟进也不发（模拟复现见 3.2）
  - `strings ~/.local/bin/agy`：子 Agent 状态只有 `SUBAGENT_STATE_ALIVE`／`KILLED`／`UNSPECIFIED`；旧跟进提示让模型按 `manage_subagents` 状态判断是否回复待完成标记
  - 本机 `~/.dsh/cliworker-now` 没有出现过该提示，无法核对用户那一次属于哪种原因；用户猜测的「结果回到主对话」没有对应代码通道
- [x] 1.3 依据规格决定 `ExitPlanMode` 的处理方式
  - `worker-permission-levels`「规划模式独立于档位」：规划开启时授权请求直接拒绝；`decideApproval` 规划模式固定 `deny/plan`。离开规划由用户决定，不转交 DSH，直接认作规划完成；理由写入 `design.md` 决策 1

## 2. 实现修复 〔后端｜3h｜前置 1〕
- [x] 2.1 `native-claude.mjs`：规划模式下带非空 `input.plan` 的 `ExitPlanMode` 记为规划完成，方案作结果正文，回复 `deny + interrupt`，不转交审批；中断造成的 `error_during_execution` 与对 `ExitPlanMode` 的拒绝不计失败；工具行补记完成；结果附说明 `PLAN_NOTICE`
  - 证据：测试见 3.1
  - 空方案、非规划模式、其他交互请求保持原失败判定
- [x] 2.2 `native-acp.mjs`：后台等待上限改为累计等待间隔、从主回合结束起算；整轮受任务总时限约束，跟进轮请求超时取任务剩余时间
  - 证据：`awaitBackground` 用 `waited` 累计等待、`taskDeadline = started + timeoutMs`；测试见 3.2
- [x] 2.3 `native-agy-acp.mjs`：跟进提示以「子 Agent 已送达结果消息或产物已存在」为完成依据，说明 ALIVE 不代表仍在工作
  - 证据：`AGY_BACKGROUND.checkPrompt` 新文本；提示效果依赖模型，只做了内容断言（3.2），真实效果见 5.2
- [x] 2.4 实测发现：Claude Code 2.1.311 对插件 `deny + interrupt` 以退出码 1 结束，原实现仍判「Claude 原生进程非零退出」；改为仅在规划收尾（已认作规划完成且终态为 `success`/`error_during_execution`）时接受退出码 1
  - 证据：`native-claude.mjs` 记 `planEnded`，退出码 1 时调用 `peer.acceptExitCode(1)`；`native-transport.mjs` 增加运行器确认的 `acceptedExitCode`，健康检查不再把这一个退出码记为失败，其他退出码与信号照旧
  - 证据：2.1.311 的 `ExitPlanMode` 工具入参为空 `{}`，方案由 CLI 从规划文件注入到授权请求的 `input.plan`（二进制 schema 注释「injected by normalizeToolInput from disk」）；现实现读取的正是授权请求的 `input.plan`，无需改动

## 3. 模拟回归测试 〔测试｜2h｜前置 2〕
- [x] 3.1 `tests/native-primary-runners.test.ts` 新增「模拟 Claude Code 规划模式以 ExitPlanMode 收尾」7 项
  - 派遣（新会话）、续聊与原生会话恢复（`--resume`）、原生不回工具结果、请求未带 `tool_use_id`：终态 SUCCESS、正文为方案、无审批帧、回复 `deny + interrupt`、方案后无执行输出、工具行 COMPLETED
  - 空方案、非规划模式 `ExitPlanMode`、规划模式下其他交互请求：仍为 ERROR「CLI 请求额外交互授权，插件未批准」
  - 回退到原实现时，前 4 项失败、后 3 项与原有「still interrupts an unsupported Claude interactive callback」通过
- [x] 3.2 `tests/native-agy-acp.test.ts` 新增 3 项
  - 主回合 400 ms、上限 200 ms：照常跟进 2 次、SUCCESS、不含误报；回退原实现时失败（只发 1 次 prompt）
  - 等待上限只计等待间隔，用尽后 UNCERTAIN；跟进提示包含 ALIVE 说明、产物依据、不得重新派发与待完成标记
  - `corepack pnpm vitest run tests/native-agy-acp.test.ts`：45 项通过

- [x] 3.3 `tests/native-primary-runners.test.ts` 新增 2.1.311 真实帧模拟 2 项
  - 「工具入参为空、方案由规划文件注入、中断后进程退出码 1」：SUCCESS、正文为方案；「退出码 7」仍为 ERROR「Claude 原生进程非零退出」
  - `corepack pnpm vitest run tests/native-primary-runners.test.ts`：165 项通过；连同 `native-transport*` 共 188 项通过（加退出码 7 用例前）

## 4. 自动检查 〔测试｜1h｜前置 3〕
- [x] 4.1 `corepack pnpm typecheck`
  - 新工作树缺少生成的 `lib/typert.remote-client.d.ts`，首次运行 Client 检查报 `Cannot find module 'dsh-cliworker-now/remote'`（与改动无关）；用 `node scripts/build.mjs --host-only` 只在本工作树 `lib/`（已忽略）生成契约后重跑，输出「Host/Client typecheck passed against DSH 0.2.2-rc.2」
- [x] 4.2 沙箱外全量 `corepack pnpm vitest run`
  - 证据：305 个文件（300 通过、1 失败、4 跳过），6769 项（6754 通过、1 失败、14 跳过），用时 191.56 秒
  - 唯一失败为 `tests/workbuddy-bootstrap.test.ts`「模拟 ENOENT 与 ECONNREFUSED 重试后 timeout」（30 ms 时限内重试次数断言 `expected 1 to be greater than 1`），与本次改动无关；沙箱外单独重跑 3 次均为 34/34 通过，属全量负载下的时序抖动
  - 本次相关的 `native-primary-runners`、`native-agy-acp`、`native-approval-relay`、`native-fork`、`harness-conversation-stream` 在全量中全部通过
- [x] 4.3 `corepack pnpm build:preview`
  - 退出码 0，输出「Isolated package ready: .cache/preview-package」；包内 `lib/native-claude.mjs` 含 `PLAN_NOTICE`，`lib/native-acp.mjs` 含新的等待上限，`lib/native-agy-acp.mjs` 含新跟进提示
  - 未运行 `pnpm build`，未更新 Desktop 链接（另一会话正在 Desktop 实机验收）
- [x] 4.4 OpenSpec 严格校验
  - 证据：`corepack pnpm spec validate vnext-plan-exit-agy-background-leeyl --strict` 输出 valid；`corepack pnpm spec validate --all --strict --no-interactive` 共 33 项通过、0 失败
  - `corepack pnpm spec:check` 脚本内部调用裸 `pnpm`，本机 PATH 没有 pnpm 而直接报错，所以改为直接运行同一命令

## 5. 真实验收 〔测试｜2h｜前置 4〕
- [x] 5.1 真实 Claude Code 规划模式派遣、续聊各一次，核对事件、终态与结果正文为方案
  - 2026-11-14 用户授权；正式 Mac Desktop 0.2.2-rc.3，Claude Code 2.1.311（用户已按 7.5 重新登录），主对话 DeepSeek-V4.1-Flash，`/plan` 开启规划
  - 修复前（main `a9b4a86` 构建）Worker `9896f603` 续聊：Claude 未写规划文件时 `ExitPlanMode` 入参与注入方案均为空，按空方案判失败；写规划文件后插件已认作规划完成（诊断「已提交规划方案」、正文为方案），但进程退出码 1 致 ERROR「Claude 原生进程非零退出」→ 修复见 2.4
  - 修复后正式构建并重启 Desktop：续聊（同一 Worker `9896f603`，原生会话恢复）01:32:24 诊断「已提交规划方案」、01:32:25 result SUCCESS、notice 为 `PLAN_NOTICE`、正文为压缩方案；新派遣 Worker `d08a4b24`（Sonnet／Low）01:41:20 同样 SUCCESS、正文为 greet.sh 方案；两次工作区均无 hello.py、test_hello.py、greet.sh，无审批帧
  - 另见跟进：选 Haiku 时规划轮被判「原生回复模型与明确选型不一致」
- [ ] 5.2 真实 agy 生图：主回合较长（含审批）与正常两种情形，核对跟进次数、终态与实际文件
  - 2026-11-14 正常情形已通过（用户授权真实调用；正式 Mac Desktop 0.2.2-rc.3，main `930de2e` 正式构建）：Worker `caa8273b`，Antigravity 1.5.8，Gemini 3.8 Flash／Low，自动审批（agy 报告有终端沙箱）
  - 首轮派遣 agy 自行用 Pillow 绘制 `cat.png`，未用子 Agent，不覆盖本修复；终态 completed，文件 1024×1024 RGBA PNG、18,854 字节
  - 续聊要求用自带生图：01:08:38 `invoke_subagent`（image-generator），01:08:41 诊断「15 秒后第 1 次跟进」，01:08:56 自动跟进 1 次，01:09:22 result SUCCESS、终态 completed；事件中无待核实（UNCERTAIN）。`dog.png` 实际存在：1024×1024 RGB PNG、1,515,167 字节，由子 Agent 产物 `blue_watercolor_dog_*.jpg`（782,443 字节）经 Pillow 转码保存
  - 未执行：主回合较长（含审批）情形，本次 agy 档位为自动审批，未改用户档位；Windows 无沙箱路径未测（2026-11-14 Windows 已升级 rc.3 并部署 e03db09，但主对话仅有 GLM 且返回 429 余额不足，未能派遣；见 v0.8.10-dsh-rc3-adapt 4.3）
- [ ] 5.3 向报告用户索取 Worker 的 `events.jsonl`，确认其误报属于哪种原因（未执行：需用户联系报告者）

## 6. 文档同步 〔产品｜1h｜前置 2〕
- [x] 6.1 README 中英文：规划模式说明补充 `ExitPlanMode` 收尾行为；后台子 Agent 段落改写等待上限与完成依据
  - 证据：`README.md`「规划模式与档位分开」与「CLI 原生子 Agent 跟随原生设置」两条；`README.en.md` 对应两条
- [x] 6.2 `doc/design.md` 追加「2026-11-14 Claude 规划收尾、Claude 官方登录确认与 Antigravity 后台子 Agent 误报修复（未发布）」
  - 证据：`doc/design.md` 末尾新增章节

## 7. Claude 官方登录确认 〔后端｜3h〕
- [x] 7.1 只读核对本机 Claude Code 2.1.311 的状态输出与凭据位置（不读取、不输出凭据内容，不发起登录或退出）
  - 证据：`claude --version` 为 `2.1.311 (Claude Code)`；`claude auth status --help` 显示 `--json`（默认）与 `--text`
  - 证据：`security dump-keychain` 只取属性，存在 `Claude Code-credentials` 与 `Claude Code-credentials-6b949a0d`；`6b949a0d` 等于 `~/.claude` 绝对路径 SHA-256 前 8 位；带后缀条目 cdat 为 2026-11-13 16:08:47Z（用户本次登录）
  - 证据：脱敏的状态比较。不设置为 `loggedIn:false`，退出码 1；只在 `--settings` 的 env 中设置（插件现行）同样为 `loggedIn:false`，退出码 1；进程环境设置为 `loggedIn:true`、`authMethod:claude.ai`、`subscriptionType:max`，退出码 0，但 `email` 为 null
  - 证据：`~/.claude.json` 有 `oauthAccount` 键；`~/.claude/.claude.json` 没有（只检查键是否存在）
- [x] 7.2 回答四个问题并写入 proposal 第 3 条与 design 决策 4
  - 证据：登录完成依据为原生状态查询 `claude --settings … auth status --json`（`accounts.ts` 的 `confirmAccount`→`readEvidence`），不看终端画面、不读凭据文件；2.1.311 输出新增字段但与解析兼容，登录命令未变；改变的是凭据与全局配置随 `CLAUDE_CONFIG_DIR` 换位置；设置页账号行走同一状态查询，模型目录走同一 settings 下的 initialize，所以都读成未登录
- [x] 7.3 `claude-own-route.ts`：`claudeNativeSettingsArguments` 不再写 `CLAUDE_CONFIG_DIR`，签名改为只收 `suppressedEnvironment`；API／代理私有 settings 同样去掉；`accounts.ts`、`adapters.ts` 调用点同步
  - 证据：`grep CLAUDE_CONFIG_DIR src/host/claude-own-route.ts` 只剩注释与禁止项正则
- [x] 7.4 模拟回归测试
  - 证据：`tests/claude-own-route.test.ts` 新增「模拟 Claude 2.1.311：插件官方登录后，同一插件的状态查询能确认已登录」2 项（Host 未设置／已设置 `CLAUDE_CONFIG_DIR`）。夹具按核对结果模拟带哈希后缀的条目、2.1.311 状态 JSON 新字段与 null 的 `orgId`。同一用例用旧参数对照：登录后状态为「Claude 官方账号未登录」，复现了用户现象
  - 证据：更新 `tests/claude-own-route.test.ts` 3 处、`tests/accounts.test.ts` 2 处旧断言，改为断言 settings 与启动环境中都不含 `CLAUDE_CONFIG_DIR`；`corepack pnpm vitest run tests/claude-own-route.test.ts tests/accounts.test.ts` 共 185 项通过
- [ ] 7.5 真实登录验收：用户在 Mac Desktop 插件中重新执行「官方登录 / 切换账号」，确认登录窗口显示已登录、设置页显示官方账号并加载模型与强度（未执行：真实登录须用户亲自操作；用户当前凭据在旧版写入的带后缀条目中，修复后需再登录一次）
- [ ] 7.6 Windows 与凭据文件（`.credentials.json`）存放方式下的同类核对（未执行：本机为 macOS 钥匙串，Windows 未测）
- [x] 7.7 文档：`doc/usage-details.md` 与英文版在「Claude Code 与 CC Switch」中说明默认存放位置及升级后可能需要重新登录；`doc/design.md` 本次章节补充
  - 证据：见两文件对应段落
- [x] 7.8 加入第 3 项修复后的自动检查
  - 证据：`corepack pnpm typecheck` 通过（Host/Client typecheck passed against DSH 0.2.2-rc.2）
  - 证据：沙箱外全量 `corepack pnpm vitest run`：305 个文件（301 通过、4 跳过），6771 项（6757 通过、14 跳过），0 失败，用时 87.87 秒，退出码 0
  - 证据：`corepack pnpm build:preview` 退出码 0；包内 `lib/index.js` 中 `CLAUDE_CONFIG_DIR` 只出现在默认目录读取、禁止项正则与注释，settings 构造不再写入；未运行 `pnpm build`

## 跟进

- 非规划模式下 Claude Code 自行进入规划后的 `ExitPlanMode`，仍按不支持的交互判失败；是否改为转交 DSH 审批（批准即开始执行），待用户决定。
- agy stream 后备路径（规划模式、旧版）是否同样会截断后台子 Agent，仍未覆盖。
- 2026-11-14 实测：Claude Code 选 Haiku 时规划模式回合实际用 `claude-sonnet-5-5`（官方说明「haiku in plan mode」时 API 模型与设定不同，类似 opusplan），插件判「Claude stream-json: 原生回复模型与明确选型不一致」并中止（Worker `4a976b54` 两轮复现，均在 `ExitPlanMode` 之前）。需要把 Haiku＋规划模式的这一替换列为可接受映射，待用户确认后另行修复。
