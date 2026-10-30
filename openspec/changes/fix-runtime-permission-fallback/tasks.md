## 1. 实现

- [x] 1.1 Claude：发送任务前只在本地记录会话 ID，任务发出后才向 Host 绑定；初始化回读未确认 `auto` 的询问模式重启不再触发会话身份错误。
- [x] 1.2 Antigravity：「自动审批」启动后在发送任务前观察 stderr 中的账号不支持警告（最多 5 秒且不超过时限的四分之一，收到 `init` 后再等 50 毫秒）；识别到即确认原进程退出，再按 help 缺少 `auto` 时的同一降级参数重启，旧进程事件与会话全部丢弃。
- [x] 1.3 Antigravity：任务发出后才出现警告时停止本轮并报错，不重发、不重试。
- [x] 1.4 不保存跨运行的账号能力缓存。子 agent 初版写了按账号绑定哈希命名的持久标记，主控审查后移除：标记永不过期、由原生桥写入 Host 存储且无清理时机；实证警告在约 1.2 秒出现，输入前的观察窗口已足够。
- [x] 1.5 Claude：`manual` 的回读 `default` 视为询问已确认。2026-10-29 Mac Desktop 复验（`.test-data/mac-desktop-20261029b/`）中，1.1 修复让降级重启越过了钩子会话，随即报「原生初始化未确认所选权限；询问模式不可确认时拒绝启动」。零模型探测（Claude 2.1.287，空临时目录，只发 `initialize`，不发用户输入）：`--permission-mode manual` 与 `auto` 的 `current_permission_mode` 均为 `default`，`acceptEdits` 为 `acceptEdits`。此前询问模式只有模拟测试，真实回读从未核对。

## 2. 自动检查

- [x] 2.1 模拟回归：Claude 钩子先带出会话后降级重启（`level-fallback-hook`、`level-rejected-hook`），只绑定收到任务的会话、只发送一次任务；修复前两项复现 `Native session identity changed`。
  - `tests/native-primary-runners.test.ts` 118 项通过；Claude 关联的 `native-approval-relay`、`harness-conversation-stream`、`native-fork`、`primary-response-audit`、`native-http` 共 267 项通过、1 项跳过。
- [x] 2.2 模拟回归：agy 输入前分块警告（有无 `init`）、输入后警告（含汇总成功）、旧版输入后才发 `init`、取消、规划与仅询问档不受影响。
  - `tests/native-agy-account-permissions.test.ts` 与 `native-agy-permission-levels`、`agy-run-outcome`、`native-primary-runners`、`native-agy-harness` 共 179 项通过。
- [x] 2.3 零模型实证（agy 1.4.x，`agy models` 只读确认已登录；空临时目录以插件同款 stream-json 参数启动，stdin 0 字节，观察后结束进程）：约 1.184 秒 stderr 出现账号不支持 `auto` 的警告，约 8.008 秒 stdout 才出现 `init`（`permission_mode` 为 `request-review`）。未发送任何模型请求。
  - 2026-10-29 合并四处修复后：全量 `pnpm test` 243 个文件通过、3 个跳过，5212 项通过、13 项跳过；`pnpm typecheck` 通过；`pnpm build:preview` 隔离包构建成功。未执行 `pnpm build`，Desktop 链接未更新。

- [x] 2.4 模拟回归：`level-default`、`level-default-hook`（自动审批与询问都回读 `default`）降级为询问后成功，只发送一次任务、只绑定收到任务的会话；仅可查看直接以询问运行成功。修复前三项失败。
  - `tests/native-primary-runners.test.ts` 121 项通过；`native-approval-relay`、`harness-conversation-stream`、`native-fork`、`primary-response-audit`、`native-http` 共 267 项通过、1 项跳过；`pnpm typecheck` 通过。

## 3. 待决与真实验收

- [x] 3.1 Antigravity 的降级目标：用户 2026-10-29 决定「保留仅工作区编辑」（accept-edits + `--dangerously-skip-permissions` + `--sandbox`，能写文件），不改为「仅规划」。规格增量把它写成「不得以更宽模式代替」的唯一例外，代码未变。
- [ ] 3.2 真实验收：用户重新登录 Antigravity 后，按最便宜选型派遣一次写文件任务，核对时间线降级说明、只有一个会话、文件实际写出；Claude 在当前账号下派遣并续聊一次，核对会话一致。
  - 2026-10-29 Mac Desktop（正式构建；证据 `.test-data/mac-desktop-20261029b/`，主模型 GLM-5.3-Flash / Max、工作区内修改，Worker 档位默认）：
    - Antigravity（Gemini 3.8 Flash / Low）通过：首轮与续聊两次运行均 completed，时间线各一条「Antigravity 原生自动审批不可用，本轮按仅工作区编辑运行」，`write_file` 均为 DONE，Worker 只绑定一个会话；`od -c` 核对文件为 `MAC-TOOL-agy-OK`、空行、`FOLLOWUP-agy-OK`（空行由 CLI 追加时写入）。
    - Claude Code（Haiku / 默认）首次失败：「原生初始化未确认所选权限；询问模式不可确认时拒绝启动」，即 1.5 的回读问题。修复、正式构建并重启 Desktop 后重测通过：首轮 Write、续聊 Edit 各一次审批卡（均为工作区内目标文件，选允许一次），两次运行均 completed，时间线各一条「Claude Code 原生自动审批不可用，本轮按询问运行」，Worker 只绑定会话 `5e203744…`，未出现会话身份、找不到会话或 RPC 断开错误；文件为 `MAC-TOOL-claude-OK`、`FOLLOWUP-claude-OK` 两行。
    - Windows 尚未复验（Windows 安装包冻结于 1.5 修复之前）。
    - 2026-10-30 Windows 补充：Antigravity 见 4.5。Claude Code 只在 Windows 首轮派遣过一次并成功（`upgrade-host-rc5` 5.3），续聊和会话一致性没有在 Windows 复测，本项仍保持未勾选。

## 4. Windows 主机没有终端沙箱（2026-10-30）

- [x] 4.1 定位（Windows 实机，证据 `.test-data/windows-desktop-20261030/cu-run-A.json` 与 Worker 原始记录，不入 Git）：agy 1.4.7 在 Windows 上 stderr 为 `warning: --mode auto is not available because the terminal sandbox is not available on this host; continuing in the default mode.`，`init` 回读 `permission_mode: request-review`。原匹配只认账号那句，降级未触发，`write_file` 被无头默认模式拒绝；同一轮模型把文件写到了插件私有 `native-request-*/agy-tools`，不是 `init.cwd` 的 live-codex。
- [x] 4.2 实现：`native-agy.mjs` 识别两种 auto 不可用警告；主机没有终端沙箱时降级为 `accept-edits` + `--sandbox`，不加 `--dangerously-skip-permissions`，时间线写「Antigravity 原生自动审批在此主机不可用（没有终端沙箱），本轮按仅工作区编辑运行，不执行命令」；输入后才出现时的报错写明主机原因。账号那句的降级不变。`native-agy-harness.mjs` 的 PreToolUse Hook 拒绝参数中出现私有 `agy-tools` 目录的原生工具调用，并给出项目目录。
- [x] 4.3 依据：agy 1.4.11 程序文本说明 `accept-edits` 为「auto-approve file edits, prompt for commands」，`auto` 需要终端沙箱。Mac 实测（最便宜的 Gemini 3.8 Flash Low，一轮，空临时目录）：无头 `--sandbox --mode accept-edits`、不跳过确认时 `write_file` 为 DONE、文件写出、结果 SUCCESS；零模型探测 `init` 回读为 `request-review`（权限预设与执行模式是两个维度）。Windows 的 agy 1.4.7 是否同样生效待 5 项实机确认。
- [x] 4.4 模拟回归：主机警告输入前出现时以 accept-edits 重启且不跳过确认、输入后出现时停止并说明主机原因；Hook 拒绝私有目录的路径、`file://`、命令与 JSON 文本，Windows 路径不区分大小写和分隔符，项目目录与同名前缀目录放行。撤掉修复时 3 个新用例失败，还原后 `native-agy-account-permissions`、`native-agy-harness`、`native-agy-permission-levels`、`agy-run-outcome` 共 64 项通过。
- [x] 4.5 Windows 实机：用户重新登录 Antigravity 后，装入含本修复的预览包，在「自动审批」档派遣一次写文件任务，核对时间线降级说明、文件写入 live-codex、没有执行命令、`agy-tools` 无任务文件。
  - 2026-10-30 23:22（预览包 `preview-20261030-230544`，在 `2a2d8a7` 后构建）：Codex Computer Use 在新会话中派遣 Gemini 3.8 Flash / Low，Worker 档位为默认（自动审批）。证据见 `.test-data/windows-desktop-20261030/cu-run-final.json`，以及 Windows 上 Worker 的 `events.jsonl` 和 stderr。
  - stderr 出现主机没有终端沙箱的警告。时间线第 4 条为「Antigravity 原生自动审批在此主机不可用（没有终端沙箱），本轮按仅工作区编辑运行，不执行命令」，Worker 记录 `mode: accept-edits`。
  - `write_file` 与 `read_file` 都是 DONE，路径为 `C:/Users/admin/cw081f1/live-codex/cwn-win-20261030c-agy.txt`。经 SSH 回读，文件 15 字节，内容为 `WIN-TOOL-agy-OK`。用户目录下没有其他同名文件，事件里也没有工具参数指向 `agy-tools`。
  - 模型为列目录调用 `run_command`，被无头 agy 拒绝：`user denied permission to run command`。没有执行命令，与设计一致。
  - 随后 agy stderr 报 `no output produced — a tool required the "command" permission that headless mode cannot prompt for`，本轮结束，没有最终回复。插件按 `agy-run-outcome` 判为「本轮最后的工具步骤失败后 CLI 直接结束；结果待核实」。主 Agent 用 glob 核验文件一致。
  - 结论：降级本身符合规格。但在 Windows 上，只要任务需要命令，Worker 就拿不到最终回复。是否放行只读命令或调整提示属于产品决定，未改动。
