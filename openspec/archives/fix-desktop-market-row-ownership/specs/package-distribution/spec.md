## ADDED Requirements

### Requirement: 市场禁用不得占用宿主原生界面行
插件的 bundle 归属 SHALL 与宿主 stock UI 行分离。市场重放插件禁用状态或从 profile 移除本 bundle 后，宿主原生 UI MUST 保持可用；启用时每个官方客户端包身份 SHALL 只有一个活跃来源。

#### Scenario: 禁用记录重放
- **WHEN** 插件已安装且市场持久化禁用列表包含本插件，宿主重新启动
- **THEN** stock 会话、对话、子 Agent、聊天 UI 保持启用，插件客户端不出现在活跃清单中

#### Scenario: 启用插件
- **WHEN** 用户启用插件并完成所需重启
- **THEN** 经预检的内置界面成为唯一来源，仍发布为原有官方客户端包身份，插件客户端正常注册

### Requirement: 界面来源切换保持原生设置契约
替换原生界面来源 MUST 保留原有设置命名空间和持久化行为。既存按 stock id 写入的配置 SHALL 生效；界面修改、重置、重启及禁用插件后 SHALL 使用一致的设置值，不得静默丢弃配置或以仅模块加载成功代替设置验收。

#### Scenario: 既存原生配置
- **WHEN** profile 或 home patch 对 `ui-chat` 或 `ui-conversation` 配置了值
- **THEN** 启用插件后的原生界面读取相同的有效值，冲突来源仍有明确错误

#### Scenario: 原生设置编辑与恢复
- **WHEN** 用户在启用插件时通过原生设置修改聊天展示或忙时 Enter 行为，随后重启或禁用插件
- **THEN** 设置 API 可读写原命名空间，修改持久化且 stock 界面恢复后仍读取同一值
