## ADDED Requirements

### Requirement: 授权提问卡分段显示 CLI 内容
主 Agent 页面的授权提问卡 SHALL 以「<Worker>（<CLI>）请求授权」为标题，请求摘要、原因和工作目录 SHALL 作为提问卡正文分段显示，原文中的换行 SHALL 保留。正文中来自 CLI 或工具参数的文字 MUST 按字面显示，MUST NOT 被渲染为链接、格式或 HTML。

#### Scenario: 多行原因分段显示
- **WHEN** Codex 申请执行命令，原因含多行，主 Agent 页面弹出提问卡
- **THEN** 标题为「<Worker>（Codex）请求授权」，正文依次为请求摘要、原因和「工作目录：…」，各自成段，原因内的换行保留

#### Scenario: 命令含 Markdown 符号
- **WHEN** 请求摘要中的命令含 `*`、`_`、反引号、`[...](...)` 或 `<b>`
- **THEN** 提问卡正文按原文显示这些字符，不出现粗体、链接或 HTML 元素

### Requirement: 等待 DSH 备选工具授权时暂停空闲时限
启用空闲时限时，Worker 经工具桥调用的 DSH 备选工具等待用户授权期间，该轮的空闲时限 SHALL 暂停，决定（允许、拒绝、撤回或任务停止）后 SHALL 重新开始计时；总时限 MUST 照常计算。Host 计时与运行器计时的 CLI SHALL 行为一致。

#### Scenario: Codex 等待 DSH 工具授权
- **WHEN** 空闲时限为 2 分钟，Codex 经工具桥调用的 DSH 命令工具申请提权，用户 3 分钟后才允许
- **THEN** 任务不因空闲超时结束，允许后命令执行，空闲时限从决定时重新计时

#### Scenario: Pi 等待 DSH 工具授权
- **WHEN** 空闲时限启用，Pi 的 DSH 备选命令工具等待授权超过空闲时限
- **THEN** 任务不因空闲超时结束

#### Scenario: 总时限仍生效
- **WHEN** 等待授权期间到达总时限
- **THEN** 任务按总时限结束，提问卡撤回，该工具调用不获授权
