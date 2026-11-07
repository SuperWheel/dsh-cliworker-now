## ADDED Requirements

### Requirement: 授权请求缺少标题时取同一工具调用的事件
ACP 授权请求的 `toolCall` 没有 `title`、`kind` 或 `locations`，而同一 `toolCallId` 此前已有 `tool_call` 事件时，声明了该行为的 runner SHALL 用事件中的标题、类型与路径补全提问卡；请求中已有的字段优先。补全 MUST 只按相同 `toolCallId` 匹配，MUST NOT 按顺序或相邻位置猜测；找不到对应事件时保持“工具调用”的通用标题，不影响审批本身。

#### Scenario: CodeBuddy 命令审批
- **WHEN** CodeBuddy 先发出 `tool_call`（标题 `` `echo probe-cmd > cmd.txt` ``，类型 execute），随后对同一 `toolCallId` 发出只带 `rawInput` 的授权请求
- **THEN** 提问卡标题显示该命令、类型为命令，命令内容不重复显示

#### Scenario: 找不到对应事件
- **WHEN** 授权请求的 `toolCallId` 之前没有任何工具事件
- **THEN** 提问卡显示通用标题“工具调用”，并按 `rawInput` 显示命令或路径
