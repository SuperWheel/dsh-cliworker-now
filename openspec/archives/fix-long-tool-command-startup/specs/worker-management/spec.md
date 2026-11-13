## ADDED Requirements

### Requirement: 超长工具命令不阻止加载历史
Host SHALL 把工具事件的 `toolCall.command` 截到 32768 个 UTF-16 码元以内再写入事件日志，且 MUST NOT 拆开代理对；读取事件日志时，已有的超长 `toolCall.command` SHALL 同样截断后加载，MUST NOT 因此让历史读取或插件启动失败。

#### Scenario: 写入超长命令
- **WHEN** CLI 报告一个命令长度超过 32768 字符的工具调用
- **THEN** 事件日志中该事件的 `toolCall.command` 只保留前 32768 个字符，下次启动可正常读取

#### Scenario: 旧版本写入的超长记录
- **WHEN** 旧版本已在事件日志中写入超过 32768 字符的 `toolCall.command`
- **THEN** 启动时该事件截断后加载，插件正常激活，其余字段不变
