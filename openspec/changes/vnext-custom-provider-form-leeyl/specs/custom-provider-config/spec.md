## ADDED Requirements

### Requirement: 其他服务商图形化配置
对 Host 已核实原生自定义服务商格式的 CLI，账号窗口「其他服务商」SHALL 打开由 Host 表单描述驱动的图形化配置；字段、选项与写入位置 MUST 来自该 CLI 的原生能力，MUST NOT 套用其他 CLI 的格式或猜测字段。未核实的 CLI SHALL 继续只提供原生终端。

#### Scenario: 支持的 CLI 选择其他服务商
- **WHEN** 用户在 Pi 等已核实 CLI 的「添加账号」中选择「其他服务商」并继续
- **THEN** 界面 SHALL 显示与登录窗口一致的服务商表单，并保留「在原生终端中配置」备选入口

#### Scenario: 不支持的 CLI
- **WHEN** Host 对该 CLI 不返回表单描述
- **THEN** 「其他服务商」SHALL 保持现有原生终端行为

### Requirement: 自定义服务商写入与凭据保护
Host SHALL 在写入前校验名称唯一性、URL 协议与必填字段，并按原生格式写入；API Key MUST 只写入该 CLI 原生凭据位置，MUST NOT 回显、记录日志或进入设置缓存快照。写入失败 SHALL 保持原配置不变。写入成功后 SHALL 作废该 CLI 的账号与模型目录缓存。

#### Scenario: 写入成功
- **WHEN** 用户提交有效表单
- **THEN** Host SHALL 原子写入原生配置，返回不含密钥的结果，并让设置页重新读取账号与模型目录

#### Scenario: 名称冲突或校验失败
- **WHEN** 名称与已有服务商冲突，或 URL、必填项无效
- **THEN** Host SHALL 拒绝写入并给出逐字段原因，原配置 MUST 保持不变

### Requirement: 通用服务商表单模板
Client SHALL 以单一表单模板渲染 Host 表单描述，样式、间距与控件遵循 doc/settings-ui-design.md 和现有登录窗口；同类菜单 SHALL 复用该模板而不是各自实现。

#### Scenario: 复用模板
- **WHEN** 另一 CLI 提供表单描述
- **THEN** 界面 SHALL 使用同一模板渲染，不需要该 CLI 专用组件
