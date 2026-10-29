## ADDED Requirements

### Requirement: 只有命令的 CLI 工具条目以命令作工具参数
CLI 工具条目没有结构化输入、只有字符串命令时（例如 Codex 的 `commandExecution`），Worker 原生会话中该工具调用的参数 SHALL 为 `{ "command": <命令> }`，使工具块标题显示命令。实时声明与回放 MUST 使用同一参数。有结构化输入的条目 MUST 保持原有参数。

#### Scenario: Codex 命令工具块
- **WHEN** Codex 执行 `printf ok > a.txt`，Worker 原生会话显示该工具块
- **THEN** 标题显示「commandExecution · printf ok > a.txt」，不显示 callId

#### Scenario: 有结构化输入的工具
- **WHEN** CLI 工具条目带 `input`
- **THEN** 工具调用参数仍为该 `input`
