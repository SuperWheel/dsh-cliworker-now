## MODIFIED Requirements

### Requirement: TRAE 权限映射与规划模式
TRAE CLI CN SHALL 提供「询问」「仅工作区编辑」「完全权限」三档。「询问」档（`read-only` 且非规划）SHALL 以 `traecli -c sandbox_mode="read-only" -c approval_policy="on-request" -c approvals_reviewer="user" acp serve` 启动，MUST NOT 同时传 `--permission-mode`，且 MUST NOT 设置或回读 ACP 模式；TRAE 发出的每个 `session/request_permission` SHALL 按本轮来源转交 DSH 审批，拒绝后该操作 MUST NOT 执行。中档 SHALL 名为「仅工作区编辑」并映射原生 `default`：工作区内读写与命令由 TRAE 自动批准，工作区外的授权请求转交 DSH 审批。完全权限 SHALL 映射 `bypass_permissions`。插件 MUST NOT 使用 TRAE 的 `auto` 档或 `approvals_reviewer` 的 `auto_review`、`guardian_subagent`。规划模式 SHALL 以 `default` 启动并通过 ACP `mode` 配置项切到 `plan`，确认会话当前模式为 `plan` 后才发送 prompt，授权请求直接拒绝。Worker 没有保存档位且主对话为仅可查看时，TRAE SHALL 按「询问」档运行。每轮新起 TRAE 进程，换档或切换规划 SHALL 从下一轮生效。原生回读与所选模式不一致时 MUST 停止本轮。

#### Scenario: 询问档写文件被拒绝
- **WHEN** Worker 档位为询问，TRAE 要在工作区内新建文件，用户在 DSH 审批中拒绝
- **THEN** 文件未生成，本轮显示“因拒绝审批而结束”，可以续聊

#### Scenario: 询问档写文件被允许
- **WHEN** Worker 档位为询问，TRAE 要在工作区内新建文件，用户允许
- **THEN** 文件按要求写入

#### Scenario: 询问档只读命令
- **WHEN** Worker 档位为询问，TRAE 只执行 `ls` 等只读命令
- **THEN** 不出现审批，命令正常返回

#### Scenario: 询问档启动参数
- **WHEN** 插件以询问档启动 TRAE
- **THEN** argv 含三项 `-c` 设置与 `acp serve`，不含 `--permission-mode`；会话建立后不发送 `mode` 配置

#### Scenario: 仅可查看下派遣
- **WHEN** 主对话为仅可查看，用户派遣没有保存档位的 TRAE Worker
- **THEN** 派遣不被拒绝，TRAE 按「询问」档运行，改动前先出现 DSH 审批

#### Scenario: 仅工作区编辑下写用户目录
- **WHEN** Worker 档位为仅工作区编辑，TRAE 要写工作区外的用户目录文件
- **THEN** 按本轮来源出现 DSH 审批；允许后文件写入，拒绝后文件未生成

#### Scenario: 规划模式
- **WHEN** 主对话要求以规划模式派遣 TRAE
- **THEN** 会话当前模式确认为 `plan` 后才发送任务，不以只读沙箱冒充规划

#### Scenario: 原生模式回读不符
- **WHEN** 运行中收到的 `current_mode_update` 与所选模式不同
- **THEN** 停止本轮并说明实际权限与所选模式不匹配
