## ADDED Requirements

### Requirement: 调用次数不是 CLI 名称
路由识别明确调用时 SHALL 忽略紧跟调用动词的次数或数量词（如「1 次」「两个」），MUST NOT 将其作为 CLI 名称解析，也 MUST NOT 因此产生未知或歧义 CLI 的提示。

#### Scenario: 调用 N 次插件派遣工具
- **WHEN** 用户消息为「请调用 1 次 CLI Worker 派遣工具」
- **THEN** 该句视为插件自身调用，不产生 CLI 路由提示

#### Scenario: 次数后接插件调用与 CLI 名
- **WHEN** 用户消息为「请调用一次 CLI Worker 派遣工具，使用 Grok」
- **THEN** 路由解析为 grok

#### Scenario: 次数后接 CLI 名
- **WHEN** 用户消息为「调用 2 次 codex cli 检查代码」
- **THEN** 路由解析为 codex
