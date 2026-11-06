# Spec Delta

## MODIFIED Requirements

### Requirement: 选型和宿主权限保持
派遣 SHALL 以项目和 CLI 隔离模型、思考强度和角色的完整设定，并按主对话确认是否沿用。宿主规划状态 MUST 拒绝外部执行；主对话的直接子 Agent 发起的派遣按「子 Agent 同级派遣」处理，判断以其所属主对话的状态为准。主对话为仅可查看（整体只读）时 SHALL 允许派遣：已保存档位的 Worker 按所选档位运行；没有保存档位的 Worker 按其第一项运行，能询问的 CLI 以原生询问模式运行、改动前询问用户，第一项不能保证改动先问的 CLI（Antigravity、Hermes、Kimi）MUST 拒绝派遣。未完成选择和取消选择后 MUST 不启动进程，且不得保存部分设定。复用设定 MUST 仍核验当前账号、模型与强度。

#### Scenario: 首次使用与取消
- **WHEN** 用户首次调用一个未保存完整设定的 CLI，随后取消选型
- **THEN** 不产生 Worker 进程，不自动选择模型，不保存半套设定

#### Scenario: 宿主拒绝执行
- **WHEN** 主会话处于规划模式，主对话或其子 Agent 发起派遣
- **THEN** 返回原有规划模式拒绝，名称别名不得绕过边界

#### Scenario: 仅可查看下的只读派遣
- **WHEN** 主会话为仅可查看，用户要求 Codex 修改代码
- **THEN** 任务以 Codex 原生询问模式运行（`read-only` 沙箱、按需申请），每次改动前询问用户

#### Scenario: 无整进程只读模式的 CLI
- **WHEN** 主会话为仅可查看，用户派遣没有保存档位的 Antigravity、Hermes 或 Kimi
- **THEN** 拒绝派遣并说明需切换权限预设、为该 Worker 选定档位或改用其他 CLI

#### Scenario: 旧版偏好
- **WHEN** 项目只有旧版模型和强度偏好，尚未确认角色
- **THEN** 首次派遣询问完整设定，不从历史任务猜测角色

## ADDED Requirements

### Requirement: 子 Agent 同级派遣
主对话的直接子 Agent（CLI Worker 或 DSH 原生子 Agent）调用 `cliworker_start` 时，插件 SHALL 把新 Worker 登记在该子 Agent 所属的主对话下，与发起者同级，并保存发起者（Worker ID 或子会话 ID 与显示名）。任务树 MUST 始终只有「主对话 → 子 Agent」两层：新 Worker 不得作为任何子 Agent 的下级运行或显示。发起者 SHALL 立即收到后台 job、worker ID 与 agentName；新 Worker 的结束通知照常送到主对话。发起者可以用只读的 `cliworker_status` 查询同一主对话的 Worker；派遣与查询都 MUST NOT 阻塞等待其他 Worker 结束。

#### Scenario: Worker 派遣另一 CLI
- **WHEN** 主 Agent 派遣的 Codex Worker 调用 `cliworker_start`，要求 Claude Code 处理子问题
- **THEN** 同一主对话下新增 Claude Code Worker，与 Codex Worker 同级，记录「由 Codex-1 发起」；Codex 收到新 Worker 的 ID 与 agentName

#### Scenario: 同级 Worker 再次派遣
- **WHEN** 由 Worker 发起的 Worker 再次调用 `cliworker_start`
- **THEN** 新 Worker 仍挂在主对话下，与前两者同级，不出现下级节点

#### Scenario: 发起者结束
- **WHEN** 发起者 Worker 被停止或删除
- **THEN** 它发起的 Worker 不被连带停止或删除，按自身状态继续或结束

#### Scenario: 主对话不可用
- **WHEN** 发起者所属的主对话已删除或无法解析
- **THEN** 派遣被拒绝并说明原因，不创建 Worker 进程

### Requirement: 同级派遣的选型、档位与审批位置
子 Agent 发起的派遣 SHALL 使用与主对话派遣相同的项目设定与选型规则：有有效完整设定且用户关闭「调用前询问模型」时直接使用，否则询问用户。发起者 MUST NOT 提供或覆盖模型、思考强度、角色与会话 ID。选型和原生审批的询问 SHALL 显示在发起者当前轮的审批位置：主 Agent 发起的轮次显示在主对话页面，Worker 窗口续聊的轮次显示在该 Worker 子会话。新 Worker SHALL 按自身档位规则运行：用户为该 CLI 选过档位的按所选档位，没选过的跟随主对话权限预设，不继承发起者的档位。

#### Scenario: 目标 CLI 首次使用
- **WHEN** Worker 为一个在该项目尚无完整设定的 CLI 发起派遣，用户在选型卡片中取消
- **THEN** 不启动进程、不保存半套设定，发起者收到「用户取消」的明确错误

#### Scenario: 不继承高档位
- **WHEN** 发起者以「完全访问」运行，目标 CLI 未选过档位，主对话为「工作区内修改」
- **THEN** 新 Worker 以「工作区内修改」运行

#### Scenario: 发起者试图指定模型
- **WHEN** 发起者在派遣参数中附带模型或强度
- **THEN** 插件忽略或拒绝这些字段，模型和强度仍来自用户设定或用户选择

### Requirement: 子 Agent 发起派遣的上限
子 Agent 发起的 Worker SHALL 计入「最高同时对话数」，超出部分排队。同一主对话中由子 Agent 发起、尚未结束（运行中或排队中）的 Worker MUST 最多 6 个；超出时 `cliworker_start` SHALL 返回明确错误，不创建任务。主对话本身的派遣不计入此上限。

#### Scenario: 达到同时运行上限
- **WHEN** 同时运行的 Worker 已达「最高同时对话数」，又有 Worker 发起派遣
- **THEN** 新任务排队并显示排队状态，不中断已在运行的任务

#### Scenario: 超出发起上限
- **WHEN** 同一主对话已有 6 个由子 Agent 发起且未结束的 Worker，又有 Worker 发起派遣
- **THEN** 返回「子 Agent 发起的任务已达上限」错误，不创建 Worker
