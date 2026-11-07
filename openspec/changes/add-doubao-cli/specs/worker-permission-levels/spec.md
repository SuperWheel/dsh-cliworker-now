## ADDED Requirements

### Requirement: 豆包的档位
豆包 CLI 的 Worker 权限菜单 SHALL 只列「自动审批」与「完全权限」，MUST NOT 显示第一项：其非交互模式会自动拒绝审批请求，无法经 DSH 询问。「自动审批」的悬停说明 SHALL 写明需要审批的操作全部自动放行、保留豆包原生沙箱、豆包要求回答问题时本轮结束。主对话为仅可查看且豆包 Worker 没有保存档位时，派遣 MUST 被拒绝，并提示先在 Worker 菜单选择档位。

#### Scenario: 豆包菜单
- **WHEN** 用户打开豆包 Worker 的权限菜单
- **THEN** 菜单依次为「自动审批」「完全权限」，没有第一项和规划

#### Scenario: 仅可查看下未选档位
- **WHEN** 主对话为仅可查看，豆包 Worker 没有保存档位，主 Agent 派遣它
- **THEN** 拒绝派遣并提示先选择档位，不以自动审批运行
