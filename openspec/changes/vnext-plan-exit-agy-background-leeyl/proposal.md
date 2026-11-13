# Proposal

## Why

B 站用户在 v0.8.9 上报告两个缺陷（npm 上的 0.8.9 与其本地文件逐字节一致，升级不能解决）：

1. **Claude Code 规划模式 Worker 收尾即判失败。** Worker `43ef5f29`（2026-11-11 18:26）在规划模式下完成方案后调用 `ExitPlanMode`，完整方案在 `tool_input.plan`。该请求带 `requires_user_interaction: true`，`src/host/native-claude.mjs` 只转交不需要用户交互的授权请求（原第 155 行），其余请求一律记 `CLI 请求额外交互授权，插件未批准` 并回复 `deny + interrupt`（原第 174–180 行），result 帧再按 `is_error` 判失败（原第 296 行）。CLI 随即中止，result 帧为 `error_during_execution`／`aborted_tools`，最终为 ERROR，结果正文为空：`{"kind":"result","text":"","state":"ERROR"}`。方案只留在工具入参和 `~/.claude/plans/*.md`，主 Agent 拿不到。
2. **Antigravity 生图后误报「后台子 Agent 未在限定时间内汇报结果」，文件实际已生成。** 提示由 `src/host/native-acp.mjs` 的后台等待产生（原第 356 行）。找到两处会造成误报的原因：第一处已用模拟进程复现；第二处有 agy 程序证据。用户那一次具体属于哪一种，需要其事件日志（`~/.dsh/cliworker-now/<worker>.events.jsonl` 中跟进诊断的时间与次数）才能确认：
   - 等待上限从主回合开始时起算（原第 316 行 `started + min(budgetMs, timeoutMs)`）。主回合本身的耗时，包括思考和等待 DSH 审批（Windows 上 agy 无终端沙箱时逐条审批），都会占用 10 分钟的后台等待；主回合超过上限时一次跟进都不发就判超时，期间进程被关闭，后台子 Agent 的结果送不回 Worker。
   - 跟进提示（`src/host/native-agy-acp.mjs` 原第 14 行）让 agy「必要时用 manage_subagents 查看状态，仍有子 Agent 未完成就只回复待完成标记」。本机 agy 程序中子 Agent 状态只有 `SUBAGENT_STATE_ALIVE`／`SUBAGENT_STATE_KILLED`（`strings ~/.local/bin/agy`），没有「已完成」：已汇报结果的生图子 Agent 仍显示 ALIVE。模型按状态判断时会一直回复标记，直到检查次数用尽，即使图片已经生成。

用户猜测「Worker 派出的结果没有回到 Worker，而是直接到了主对话」：agy 原生子 Agent 只向 agy 父会话汇报，插件没有把它路由到 DSH 主对话的通道。用户看到的是 Worker 先判了待核实，主 Agent 再自行去磁盘核对文件。

## What Changes

- Claude Code 在原生规划模式（`--permission-mode plan`，即 DSH 规划或 Worker 规划开关）下发出 `ExitPlanMode` 且方案非空时，插件把方案作为本轮结果正文，终态 SUCCESS 并附说明「已提交方案，未退出规划、未执行」。插件仍回复拒绝并中断，不批准退出规划，也不转交 DSH 审批。CLI 因该中断给出的 `error_during_execution` 终态不再计为失败，`ExitPlanMode` 工具行记为完成。派遣、续聊、原生会话恢复与分支走同一 Runner。
- 其他需要用户交互的请求、非规划模式下的 `ExitPlanMode`、方案为空的 `ExitPlanMode` 保持原有失败判定。
- Antigravity 后台等待上限改为只计跟进前的等待间隔，从主回合结束时起算；整轮（含跟进轮）仍受任务总时限约束，跟进轮的请求超时改用任务剩余时间。
- 跟进提示改为以「子 Agent 已送达结果消息或要求的产物已存在」为完成依据，并明确 ALIVE 不代表仍在工作。

## Capabilities

### Modified Capabilities

- `worker-run-outcomes`：新增「Claude Code 规划模式提交方案即完成本轮」。
- `cli-native-features`：修改「后台原生子 Agent 完成后才结束 Worker 轮次」的等待上限与完成依据。

## Impact

- Host：`src/host/native-claude.mjs`、`src/host/native-acp.mjs`、`src/host/native-agy-acp.mjs`。
- Client、协议、存储与安装入口不变；结果帧沿用已有 `notice` 字段。
- 测试：`tests/native-primary-runners.test.ts`、`tests/native-agy-acp.test.ts` 新增模拟用例。
- 文档：README 中英文、`doc/design.md`。
- 未做真实验收：真实 Claude Code 规划收尾与真实 agy 生图需用户另行授权模型调用。
