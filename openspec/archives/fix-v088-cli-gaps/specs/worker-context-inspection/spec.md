## ADDED Requirements

### Requirement: CodeBuddy 系上下文分类经只读副进程读取
CodeBuddy Code、WorkBuddy CN 与 WorkBuddy 的 ACP 只给上下文总量，分类只在原生本地命令 `/context` 中提供，而该命令的输出会作为用户消息写入会话并进入下一次模型请求。Host SHALL 只在本轮已结算（`end_turn`，或因拒绝审批而结束）、未被停止且 Worker 自身进程已退出后，另起一个带 `--no-session-persistence` 的同版本 CLI 进程，载入同一会话、切到本 Worker 已确认的模型后发送 `/context`，解析系统提示词、系统工具、MCP 工具、消息等原生分类与头部总量和容量，以原生估算（按 0.1K 取整）发出。MUST NOT 在 Worker 自身进程里执行 `/context`，MUST NOT 写回会话；副进程在有限时间内结束，失败、超时、模型不符、报告残缺或出现模型活动时什么都不发，也不改变本轮结果。

#### Scenario: 读取成功
- **WHEN** CodeBuddy 或 WorkBuddy CN 的 Worker 正常完成一轮
- **THEN** 上下文弹层的系统提示词、工具定义（系统工具与 MCP 工具之和）、对话消息三行显示 CLI 原生 `/context` 的估算值，总量与容量取同一份报告，并标记为估算

#### Scenario: 不写回会话
- **WHEN** 副进程读取分类
- **THEN** 原生会话文件不新增 `/context` 命令或其输出，Worker 下一轮的模型请求不包含这些内容

#### Scenario: 读取失败或被停止
- **WHEN** 本轮被用户停止或失败，或副进程超时、退出异常、报告残缺、头部模型与本 Worker 模型不符
- **THEN** 不发出分类，本轮结果与状态不变；用户停止时不启动副进程

#### Scenario: TRAE CN 没有分类来源
- **WHEN** TRAE CN（traecli 0.213.1）完成一轮
- **THEN** 只显示回执 `contextWindow` 的总量与容量，三行分类保持 `—`；该版本 ACP 只发 `usage_update` 的 used/size，可用命令中没有 `/context`，插件不借用 CodeBuddy 的协议，也不按总量倒推分类
