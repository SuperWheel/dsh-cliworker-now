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
