## MODIFIED Requirements

### Requirement: 选型和宿主权限保持
派遣 SHALL 以项目和 CLI 隔离模型、思考强度和角色的完整设定，并按主对话确认是否沿用。子 Agent 与宿主规划状态 MUST 拒绝外部执行。主对话为仅可查看（整体只读）时 SHALL 允许派遣：已保存档位的 Worker 按所选档位运行；没有保存档位的 Worker 按其第一项运行，能询问的 CLI 以原生询问模式运行、改动前询问用户，第一项不能保证改动先问的 CLI（Antigravity、Hermes、Kimi）MUST 拒绝派遣。未完成选择和取消选择后 MUST 不启动进程，且不得保存部分设定。复用设定 MUST 仍核验当前账号、模型与强度。

#### Scenario: 首次使用与取消
- **WHEN** 用户首次调用一个未保存完整设定的 CLI，随后取消选型
- **THEN** 不产生 Worker 进程，不自动选择模型，不保存半套设定

#### Scenario: 宿主拒绝执行
- **WHEN** 主会话处于规划模式，或调用来自子 Agent
- **THEN** 返回原有权限拒绝，名称别名不得绕过边界

#### Scenario: 仅可查看下派遣
- **WHEN** 主会话为仅可查看，用户要求 Codex 修改代码
- **THEN** 任务以 Codex 原生询问模式运行（`read-only` 沙箱、按需申请），每次改动前询问用户

#### Scenario: 不能询问的 CLI
- **WHEN** 主会话为仅可查看，用户派遣没有保存档位的 Antigravity、Hermes 或 Kimi
- **THEN** 拒绝派遣并说明需切换权限预设、为该 Worker 选定档位或改用其他 CLI

#### Scenario: 旧版偏好
- **WHEN** 项目只有旧版模型和强度偏好，尚未确认角色
- **THEN** 首次派遣询问完整设定，不从历史任务猜测角色
