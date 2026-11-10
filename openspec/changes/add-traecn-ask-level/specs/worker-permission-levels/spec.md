## MODIFIED Requirements

### Requirement: Worker 三档权限菜单
Worker 子会话的权限菜单 SHALL 提供第一项、中档、完全权限三档，名称按 CLI 实际能力确定：第一项在能逐次询问改动的 CLI 上叫「询问」（TRAE CLI CN 由原生只读沙箱加按需审批实现），Kimi 叫「仅工作区编辑」（原生默认模式自动批准 Git 仓库内的编辑），Antigravity 叫「仅规划」，Hermes MUST NOT 显示第一项；中档在有原生自动审批的 CLI 上叫「自动审批」，ZCode、OpenCode、TRAE CLI CN 叫「仅工作区编辑」，OMP、Pi 叫「自动批准编辑」；第三项叫「完全权限」。菜单 SHALL 始终列出该 CLI 的全部档位，不因主对话档位减少。每项 SHALL 带悬停说明，自动审批 SHALL 说明由 CLI 自行判断放行。菜单 MUST NOT 包含规划模式。

#### Scenario: Codex 的菜单
- **WHEN** 主对话为任一档位，用户打开 Codex Worker 的权限菜单
- **THEN** 菜单依次为「询问」「自动审批」「完全权限」，没有「规划（只读）」

#### Scenario: 做不出询问的 CLI
- **WHEN** 用户打开 Kimi、Antigravity、Hermes Worker 的权限菜单
- **THEN** 第一项分别为「仅工作区编辑」「仅规划」和不显示

#### Scenario: TRAE CLI CN 的菜单
- **WHEN** 主对话为任一档位，用户打开 TRAE CLI CN Worker 的权限菜单
- **THEN** 菜单依次为「询问」「仅工作区编辑」「完全权限」；「询问」的悬停说明写明改文件和有副作用的命令先问你，「仅工作区编辑」写明工作区内的改动与命令自动批准、工作区外的改动先问你

#### Scenario: Pi 的菜单
- **WHEN** 主对话为工作区内修改，用户打开 Pi Worker 的权限菜单
- **THEN** 菜单依次为「询问」「自动批准编辑」「完全权限」

#### Scenario: 选择完全权限
- **WHEN** 用户在菜单选择「完全权限」
- **THEN** 先出现 DSH 原生的完全权限确认，确认后才保存
