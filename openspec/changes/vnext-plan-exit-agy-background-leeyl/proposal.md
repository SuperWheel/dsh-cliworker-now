# Proposal

## Why

B 站用户在 v0.8.9 上报告前两个缺陷（npm 上的 0.8.9 与其本地文件逐字节一致，升级不能解决），第三个由用户 2026-11-14 在 Mac Desktop 实机发现：

1. **Claude Code 规划模式 Worker 收尾即判失败。** Worker `43ef5f29`（2026-11-11 18:26）在规划模式下完成方案后调用 `ExitPlanMode`，完整方案在 `tool_input.plan`。该请求带 `requires_user_interaction: true`，`src/host/native-claude.mjs` 只转交不需要用户交互的授权请求（原第 155 行），其余请求一律记 `CLI 请求额外交互授权，插件未批准` 并回复 `deny + interrupt`（原第 174–180 行），result 帧再按 `is_error` 判失败（原第 296 行）。CLI 随即中止，result 帧为 `error_during_execution`／`aborted_tools`，最终为 ERROR，结果正文为空：`{"kind":"result","text":"","state":"ERROR"}`。方案只留在工具入参和 `~/.claude/plans/*.md`，主 Agent 拿不到。
2. **Antigravity 生图后误报「后台子 Agent 未在限定时间内汇报结果」，文件实际已生成。** 提示由 `src/host/native-acp.mjs` 的后台等待产生（原第 356 行）。找到两处会造成误报的原因：第一处已用模拟进程复现；第二处有 agy 程序证据。用户那一次具体属于哪一种，需要其事件日志（`~/.dsh/cliworker-now/<worker>.events.jsonl` 中跟进诊断的时间与次数）才能确认：
   - 等待上限从主回合开始时起算（原第 316 行 `started + min(budgetMs, timeoutMs)`）。主回合本身的耗时，包括思考和等待 DSH 审批（Windows 上 agy 无终端沙箱时逐条审批），都会占用 10 分钟的后台等待；主回合超过上限时一次跟进都不发就判超时，期间进程被关闭，后台子 Agent 的结果送不回 Worker。
   - 跟进提示（`src/host/native-agy-acp.mjs` 原第 14 行）让 agy「必要时用 manage_subagents 查看状态，仍有子 Agent 未完成就只回复待完成标记」。本机 agy 程序中子 Agent 状态只有 `SUBAGENT_STATE_ALIVE`／`SUBAGENT_STATE_KILLED`（`strings ~/.local/bin/agy`），没有「已完成」：已汇报结果的生图子 Agent 仍显示 ALIVE。模型按状态判断时会一直回复标记，直到检查次数用尽，即使图片已经生成。
3. **Claude Code 官方登录完成后插件不认。** 本机 Claude Code 2.1.311（Homebrew）。插件对所有 Claude 子进程（登录终端、`auth status`、模型目录、Worker 任务）都在 `--settings` 的 `env` 中设置 `CLAUDE_CONFIG_DIR=~/.claude`（`src/host/claude-own-route.ts` 原第 165 行，由 `accounts.ts` 原第 954 行、`adapters.ts` 第 248 行和第 335、405 行调用；API／代理路由的私有 settings 原第 427 行同样设置）。只读核对结果：
   - 钥匙串里有 `Claude Code-credentials` 与 `Claude Code-credentials-6b949a0d` 两个条目；后缀正是 `~/.claude` 绝对路径 SHA-256 的前 8 位，带后缀的条目创建于 2026-11-13 16:08:47Z，与用户这次登录同时。
   - 进程环境设置 `CLAUDE_CONFIG_DIR=~/.claude` 时，`claude auth status --json` 返回已登录（`claude.ai`，退出码 0）；不设置，或只在 `--settings` 的 `env` 中设置（插件现行做法）时返回未登录（退出码 1）。
   - 设置该变量后，Claude 读取 `~/.claude/.claude.json`（没有 `oauthAccount`）而不是 `~/.claude.json`（有），所以连已登录时 `email` 也为空。
   - 结论：设置 `CLAUDE_CONFIG_DIR` 会让 Claude 改用另一个钥匙串条目和另一份全局配置，哪怕值就是默认目录。`--settings` 里的值作用到了插件发起的登录（写入带后缀条目），没有作用到状态查询（读不带后缀条目）。账号终端结束后，`accounts.ts` 的 `confirmAccount` 按状态查询判定，于是显示「未能确认登录」。设置页的账号行（同一状态查询）、`cli-account-binding.ts` 与模型目录（initialize 中的账号信息）也都读成未登录，模型和强度为空。
   - 2.1.311 的 `auth status` 默认输出 JSON，新增 `analyticsDisabled`、`projectsDirectory`，`orgId`／`orgName` 可为 null；现有解析只看 `loggedIn`、`authMethod`、`apiProvider`、`configDirectory`、`email`，与新格式兼容。登录命令（`auth login --claudeai`）未变。

用户猜测「Worker 派出的结果没有回到 Worker，而是直接到了主对话」：agy 原生子 Agent 只向 agy 父会话汇报，插件没有把它路由到 DSH 主对话的通道。用户看到的是 Worker 先判了待核实，主 Agent 再自行去磁盘核对文件。

## What Changes

- Claude Code 在原生规划模式（`--permission-mode plan`，即 DSH 规划或 Worker 规划开关）下发出 `ExitPlanMode` 且方案非空时，插件把方案作为本轮结果正文，终态 SUCCESS 并附说明「已提交方案，未退出规划、未执行」。插件仍回复拒绝并中断，不批准退出规划，也不转交 DSH 审批。CLI 因该中断给出的 `error_during_execution` 终态不再计为失败，`ExitPlanMode` 工具行记为完成。派遣、续聊、原生会话恢复与分支走同一 Runner。
- 其他需要用户交互的请求、非规划模式下的 `ExitPlanMode`、方案为空的 `ExitPlanMode` 保持原有失败判定。
- Antigravity 后台等待上限改为只计跟进前的等待间隔，从主回合结束时起算；整轮（含跟进轮）仍受任务总时限约束，跟进轮的请求超时改用任务剩余时间。
- 跟进提示改为以「子 Agent 已送达结果消息或要求的产物已存在」为完成依据，并明确 ALIVE 不代表仍在工作。
- Claude 子进程不再在 `--settings` 中设置 `CLAUDE_CONFIG_DIR`。登录、退出、状态、模型目录与任务都使用 Claude 的默认存放位置；Host 环境设置了该变量时，由子进程在启动时继承。用户此前经旧版插件登录写入带后缀条目的，需要重新登录一次；插件不读取、不迁移钥匙串。

## Capabilities

### Modified Capabilities

- `worker-run-outcomes`：新增「Claude Code 规划模式提交方案即完成本轮」。
- `cli-native-features`：修改「后台原生子 Agent 完成后才结束 Worker 轮次」的等待上限与完成依据。
- `cli-account-isolation`：新增「Claude 官方账号各操作使用同一原生存放位置」。

## Impact

- Host：`src/host/native-claude.mjs`、`src/host/native-acp.mjs`、`src/host/native-agy-acp.mjs`、`src/host/claude-own-route.ts`、`src/host/accounts.ts`、`src/host/adapters.ts`。
- Client、协议、存储与安装入口不变；结果帧沿用已有 `notice` 字段。
- 测试：`tests/native-primary-runners.test.ts`、`tests/native-agy-acp.test.ts`、`tests/claude-own-route.test.ts` 新增模拟用例，`tests/accounts.test.ts` 更新断言。
- 文档：README 中英文、`doc/usage-details.md`（中英文）、`doc/design.md`。
- 未做真实验收：真实 Claude Code 规划收尾与真实 agy 生图需用户另行授权模型调用；Claude 官方真实登录需用户亲自操作。
