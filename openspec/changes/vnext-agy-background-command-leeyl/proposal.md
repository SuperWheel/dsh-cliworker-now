# Proposal

## Why

2026-11-20 Mac Desktop（DSH 0.2.2-rc.5）v0.9.2 名称同步验收时，Antigravity Worker `b665400a` 的续聊一轮（run `5d6e130e`）被判失败「CLI ERROR: CLI 工具缺少终态」。用户要求「前台循环 12 次、每 5 秒写一行」，agy（ACP 传输）发起 `run_command`（`WaitMsBeforeAsync: 10000`），10 秒后把命令转入后台，回复「已启动后台计时循环任务……请稍候」并以 `end_turn` 结束本轮。

raw 记录核对（`~/.dsh/cliworker-now/b665400a-….5d6e130e-….raw.jsonl`，只读）：

- 该命令只有一条 `tool_call`（`status: in_progress`），本轮结束前没有任何 `tool_call_update`，agy 不发「已转后台」的状态值或输出文本。
- 可识别的结构信号是工具入参：agy 的 `run_command` 带必填参数 `WaitMsBeforeAsync`，agy 程序内 schema 说明为「命令完成前等待的毫秒数，超时即转入后台（500 到 10000）」（`strings ~/.local/bin/agy`）。
- 去向：插件每轮结束即关闭 agy 进程，后台命令随之中止。`agy-ticks.txt` 只有 14:38:23、14:38:28 两行（转后台前的 10 秒），之后不再写入；下一轮 `session/load` 回放中 agy 自己把这条命令记为 `failed`、输出为空。
- 同一现象此前也出现过：Worker `e15ebd2f` run `56a468f1`（`sleep 120`，`WaitMsBeforeAsync: 500`）同样被判「CLI 工具缺少终态」。

`src/host/native-acp.mjs` 自 v0.8.1 起对所有仍未终态的工具一律判失败。这把「CLI 自己选择后台运行、本轮正常结束」与「协议丢失终态」混为一谈：主 Agent 只看到笼统的 CLI 错误，看不到命令其实没有完成、已经中止。

本变更与 `vnext-plan-exit-agy-background-leeyl` 无关：那边处理 `invoke_subagent` 派出的原生后台子 Agent 的等待与误报，这里处理 `run_command` 转入后台的终端命令。

## What Changes

- ACP 运行器新增可选的「可转后台命令」识别（默认关闭）。Antigravity ACP 启用：`run_command` 且入参带数值 `WaitMsBeforeAsync` 的工具算作 agy 可转入后台的命令。
- 本轮以 `end_turn` 结束、未被停止、没有其他失败时，仍未终态的工具如果全部是可转后台命令：整轮判为待核实（UNCERTAIN），保留本轮正文；结果说明写明命令已被转入后台、本轮结束时仍未完成、随 Worker 关闭会话中止、没有结果，并列出命令（截断）。对应工具行收尾为失败，输出写同样的说明，不再停在运行中。
- 其他仍未终态的工具（没有该参数、不是 `run_command`、其他 CLI）以及非 `end_turn` 结束，保持「CLI 工具缺少终态」或原有失败判定。不伪造成功，不改变任何 CLI 的其他终态规则。
- 后台命令在同一轮内补发完成更新的，按原有规则正常判定。

## Capabilities

### Modified Capabilities

- `worker-run-outcomes`：新增「Antigravity 转入后台的命令在本轮结束时判待核实」。

## Impact

- Host：`src/host/native-acp.mjs`、`src/host/native-agy-acp.mjs`。
- Client、协议、存储、安装入口不变；结果帧沿用 `UNCERTAIN` + `error` 说明。
- 测试：`tests/native-agy-acp.test.ts` 新增模拟用例（按 2026-11-20 raw 记录的更新形状回放）。
- 文档：`doc/design.md` 终态顺序补一句。
- 未做真实验收：真实 agy 转后台需用户另行授权模型调用；Antigravity stream 后备（非 ACP）不在本变更范围。
