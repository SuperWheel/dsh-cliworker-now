## ADDED Requirements

### Requirement: 插件界面语言偏好
CLI Worker SHALL 提供插件级界面语言偏好 `follow`、`zh`、`en`，默认 `follow`。偏好 MUST 保存在 Host 私有 `general-settings.json`（0600）并在重启后保留；补丁中 `language: null` MUST 恢复默认；非 `follow`/`zh`/`en` 的值 MUST 被拒绝且不改变已保存值。

#### Scenario: 保存并重启后保留
- **WHEN** 用户把语言保存为 `en` 后重启插件
- **THEN** 通用设置返回 `language: 'en'`

#### Scenario: 非法语言值
- **WHEN** 补丁中的 `language` 为 `fr`、空字符串或数字
- **THEN** 保存失败，原值保持不变

#### Scenario: 旧记录
- **WHEN** `general-settings.json` 不存在或没有 `language` 字段
- **THEN** 有效语言偏好为 `follow`

### Requirement: 语言解析与实时切换
Client SHALL 按以下规则确定界面语言：偏好为 `zh` 或 `en` 时使用该语言；偏好为 `follow` 时使用 Harness locale 当前语言（Harness 为 `zh` 时中文，其余为英文或语言包按其回退链取词）。Harness locale 服务不可用时 MUST 使用中文。偏好或 Harness 语言变化时，已渲染的插件界面 MUST 立即更新，不需要重载或重新打开。

#### Scenario: 跟随 Harness
- **WHEN** 偏好为 `follow`，用户在 Harness 设置中把语言从中文切到英文
- **THEN** CLI Worker 面板与设置页文案立即变为英文

#### Scenario: 显式选择覆盖 Harness
- **WHEN** 偏好为 `zh`，Harness 当前语言为英文
- **THEN** CLI Worker 界面显示中文，Harness 自身界面不受影响

#### Scenario: 设置页切换
- **WHEN** 用户在「CLI Worker 设置」的「语言」分区选择 English 并保存成功
- **THEN** 当前设置页与其他已打开的 CLI Worker 面板立即显示英文；保存失败时语言不变并显示失败原因

#### Scenario: 其他窗口同步
- **WHEN** 另一个窗口保存了新的语言偏好
- **THEN** 本窗口经 Worker 快照流收到新偏好并更新界面

### Requirement: 插件词典
Client SHALL 以 `cliworker` 命名空间向 Harness locale 注册中英文词典，注册与订阅 MUST 随插件作用域释放。每个词条 MUST 同时具有非空中文与英文，英文中的 `{name}` 占位 MUST 与中文一致。品牌名、CLI 名、模型名、CLI 输出与用户内容 MUST NOT 被翻译；DSH 内插件名 `CLI Worker / CLI Worker Now` MUST 保持不变。

#### Scenario: 卸载插件
- **WHEN** 插件作用域被释放
- **THEN** `cliworker` 命名空间注销，Harness 语言变化订阅解除

#### Scenario: 词典缺项
- **WHEN** 词典新增一个只有中文的词条
- **THEN** 类型检查或词典完整性测试失败

### Requirement: Host 错误的英文显示
Client SHALL 对列入映射表的常见 Host 中文错误在英文界面显示对应英文；未列入映射表的 Host 或 CLI 错误 MUST 原样显示，不得猜测译文或丢弃原文。

#### Scenario: 已映射错误
- **WHEN** 英文界面收到 Host 错误「请先关闭账号终端」
- **THEN** 界面显示 “Close the account terminal first”

#### Scenario: 未映射错误
- **WHEN** 英文界面收到映射表之外的 Host 或 CLI 错误
- **THEN** 界面显示原始错误文本
