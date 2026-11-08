## 背景与实测

- CodeBuddy 2.181 的 ACP `session/prompt` 结果只有 `stopReason`、`userMessageId` 与 `_meta['codebuddy.ai/conversationRequestId']`，没有 token 或积分（上下文占用另由 `usage_update` 提供）。CLI 把每次模型请求写进 `<CODEBUDDY_CONFIG_DIR 或 ~/.codebuddy>/projects/<项目键>/<sessionId>.jsonl`。项目键取 cwd 真实路径，把 `/ \ :` 换成 `-`，去掉首尾 `-` 并合并重复；超过 255 字节时截到 180 字节，再接 `-` 与 djb2 的 36 进制值。每行 `providerData` 带 `conversationRequestId`、`messageId`、`requestModelId`、`usage`（input/output/total、cached、reasoning）与 `rawUsage.credit`。同一请求的并行工具调用会重复写同一 `messageId`。子 Agent 的记录在 `<sessionId>/subagents/`。
- WorkBuddy 内置 CLI 派生自 CodeBuddy，行格式相同，配置根由安装探测得到（`install.configDir`）。
- 2026-11-08 用 `hy4free` 实测一轮：文件写有 token 与 `credit: 0`。探测会话文件只含探测元数据，已删除。
- CodeBuddy ACP 调 `session/fork` 返回 Method not found；`initialize` 不公开 `sessionCapabilities.fork`。WorkBuddy 内置 CLI 同样不公开。

## 决定

1. 用量读取（`codebuddy-durable-usage.mjs`）：只在 `stopReason === 'end_turn'` 时，按会话、用户消息 ID、`conversationRequestId`、cwd 与模型精确定位本轮。逐行校验：会话一致；同一 `messageId` 重复时内容必须相同，并按 `messageId` 去重；`requestModelId` 等于所选模型；total = input + output；cached、reasoning 不超界；最后一行为 `status: completed` 的 assistant 消息。任一不满足即不产出。读取不跟随符号链接，拒绝其他用户可写的文件，上限 32 MiB，最多重试 6 次、每次间隔 250 ms，等待最后一行落盘。
2. 积分：所有请求都有数值 `credit` 时才汇总为 `providerCredits`；免费模型的 0 是真实值。子 Agent 文件在本轮开始后有修改时，主文件不含其积分，标 `creditsIncomplete: 'subagents'`，积分显示为未知。token 照常汇总，不当积分显示。
3. 呈现：`CREDIT_BILLED_CLIS = qoder、qodercn、codebuddy、workbuddycn、workbuddy` 统一决定显示积分还是 token；TRAE CN 回执带 token，仍显示 token。遥测白名单只保留回执的计数字段；回执的 CLI、来源、会话与模型必须与本 Worker 一致，WorkBuddy CN 与 WorkBuddy 互不归属。
4. 结果说明：`runtime.ts` 写入的诊断行带固定标题 `RESULT_NOTICE_TITLE`；会话流把它投影为 `cliworker_result_notice` 工具行，文本为“本轮结果说明：<说明>”。其他 notice 仍为自动续聊行。DSH 工具桥的拒绝（`harnessDenied`）按原规则不附说明；原生审批拒绝不受影响。
5. 桌面管理复开：关闭窗口会触发设置页重新读取 WorkBuddy 账号（启动 CLI 需数秒到 25 秒），上一个桌面会话也可能仍在停止中。`reserve()` 因此拒绝第二次打开，Client 把拒绝原因统一显示为“暂不可用”。修复后，`start()` 先等同 CLI 的停止中会话，再通过 `settle` 等待该 CLI 未结束的状态查询（可被取消、不中止查询），然后再检查授权与关闭状态。Client 只显示翻译表中已有的 Host 原因，其他错误仍显示通用文案，不泄露原始错误文本。
6. 页脚：桌面管理页脚允许整体换行；按钮组靠右且按钮内文字不折行，说明文字可断行。
7. 权限回执：受理时用 `workerPermissionReceipt(cli, mode, level, parent)` 计算一次，返回结果与完成结果都使用这次的值，避免完成时主对话预设已变而写错。档位判定仍用既有的 `effectiveLevel`。
