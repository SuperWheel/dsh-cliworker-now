## ADDED Requirements

### Requirement: 超大工具事件出站帧逐级降级
共享原生传输层 SHALL 对超过 `maxLineBytes` 的非 assistant 公开事件逐级生成带 `truncated: true` 的摘要。第一层 SHALL 移除 detail、delta、toolCall.input/output，并按 UTF-8 字节截断 text 以及 toolCall 的其他字符串字段，包括 command、name、callId 和 parentCallId。若仍超限，系统 MUST 丢弃工具负载及额外元数据，优先保留 kind、step、state、text 和截断标记，继续缩短文本；必要时移除可选步骤与状态。只有连包含 kind、空 text、截断标记及包装的最小摘要也无法容纳时才 SHALL 报出帧超限错误。检查 MUST 包含 JSON 转义、包装和换行的实际字节数。

#### Scenario: 命令超过出站帧上限
- **WHEN** 原生运行器发送 command 超过 maxLineBytes 的工具事件
- **THEN** 插件发出不超过上限的截断摘要，command 为原命令的有界前缀，CLI 继续运行并自行处理工具结果

#### Scenario: 工具身份字段也超大
- **WHEN** toolCall 的 name、callId 或 parentCallId 也超过帧预算
- **THEN** 这些字段同样被截断，不能绕过摘要保护导致整轮失败

#### Scenario: 第一次摘要仍超限
- **WHEN** 小帧预算、JSON 转义或额外元数据使第一次降级仍超限
- **THEN** 插件移除工具负载并继续缩小摘要，最终发出的完整 JSON 行不超过配置上限且带截断标记

#### Scenario: 最小摘要也无法容纳
- **WHEN** maxLineBytes 小于最小摘要完整 JSON 行的字节数
- **THEN** 插件报告帧超限且不发送超限行

#### Scenario: 回复帧保持现有保护
- **WHEN** assistant 事件超过出站帧上限
- **THEN** 仍沿用原有帧超限错误，不静默截断回复正文
