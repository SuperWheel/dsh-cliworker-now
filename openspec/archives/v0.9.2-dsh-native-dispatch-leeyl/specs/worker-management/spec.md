# Spec Delta

## MODIFIED Requirements

### Requirement: DSH 子 Agent 在 CLI Worker 窗口统一显示

开关开启时，CLI Worker 窗口 SHALL 列出当前主对话中 DSH 原生调用的直接子 Agent，作为「Deepseek Harness」分组与各 CLI 分组同级。中英文界面的分组标题和无障碍名称中的产品名 SHALL 均为 `Deepseek Harness`，并保留 DSH 官方单色标志和原有计数。窄栏中标题、图标和计数 MUST 保持可读且不重叠、不溢出。CLI Worker 自身对应的子会话 MUST NOT 重复列出。条目 SHALL 采用与 CLI Worker 卡片相同的版式：标题与状态一行，下方为插件名称、模型（有公开信息时），右侧箭头，「打开对话 / 删除」放在右键菜单。状态由 DSH 原生事件得出，并参与搜索与「全部 / 进行中 / 已完成 / 异常」筛选。状态 MUST 来自 DSH 原生公开数据，不伪造进度。

#### Scenario: 主 Agent 调用 DSH 子 Agent

- **WHEN** 主 Agent 在当前主对话启动一个 DSH 原生子 Agent
- **THEN** 在显示开关开启时，CLI Worker 窗口出现「Deepseek Harness」分组和对应条目，运行结束后状态随原生事件更新

#### Scenario: CLI Worker 不重复

- **WHEN** 当前主对话同时有 CLI Worker 与 DSH 原生子 Agent
- **THEN** 每个 CLI Worker 只出现在其 CLI 分组，「Deepseek Harness」分组只含 DSH 原生子 Agent

#### Scenario: 中英文及窄栏显示

- **WHEN** 有可见 DSH 原生子 Agent，用户在中文或英文界面打开 CLI Worker 面板，并将侧栏缩到受支持的窄宽度
- **THEN** 可见标题保持完整的 `Deepseek Harness`，分组无障碍名称中的产品名与标题一致，原有图标和本地化计数依然可见，标题不造成重叠、裁切或横向溢出

### Requirement: DSH 子 Agent 显示开关

「CLI Worker 设置 → CLI Worker 设置」SHALL 提供「在 CLI Worker 窗口显示 DSH 子 Agent」开关，默认开启。关闭后 CLI Worker 窗口 MUST 不再列出 DSH 子 Agent，但 DSH 子 Agent 的运行与 DSH 原生入口不受影响。重新开启后立即恢复。「CLI 连接」列表 MUST NOT 为 DSH 新增连接或设置页。

#### Scenario: 默认值

- **WHEN** 用户升级后首次打开设置
- **THEN** 开关为开启

#### Scenario: 关闭开关

- **WHEN** 用户关闭开关
- **THEN** 「Deepseek Harness」分组立即从 CLI Worker 窗口消失，DSH 子 Agent 照常运行
