# Spec Delta

## MODIFIED Requirements

### Requirement: OMP 与 Pi 独立身份
工具指引、账号、模型和执行入口 SHALL 将 OMP（Oh My Pi）与 Pi Coding Agent 标为独立 CLI；相同模型或共享桥接实现 MUST 不改变用户选择。执行入口 SHALL 校验所选 CLI 身份和所需原生能力，错误入口在登录、发现或派遣前拒绝。

#### Scenario: 相同模型独立派遣
- **WHEN** 用户分别指定 OMP 和 Pi 使用同名模型
- **THEN** 选择、账号、偏好及会话保持对应 CLI 身份，不推断为同一 CLI

#### Scenario: 错误的程序路径
- **WHEN** OMP 设置指向 Pi 或 Pi 设置指向 OMP
- **THEN** 显示身份不匹配并拒绝启动，不静默替换程序

#### Scenario: 原生安装版本
- **WHEN** 当前原生 Pi 安装满足已核验的桥接能力
- **THEN** 发现、登录和执行使用同一安装；不暗中优先另一旧版本的私有安装

#### Scenario: 明确支持版本
- **WHEN** Pi 安装身份、所需接口及版本均有效，版本为 1.0.2、1.0.4、1.1.0 或 1.5.2
- **THEN** 安装、登录、发现、运行和更新兼容检查 SHALL 使用同一支持名单；保留旧版 RPC 与权限门行为

#### Scenario: 未核验版本
- **WHEN** Pi 版本不在明确支持名单中，或 managed launcher 身份无法核实
- **THEN** 插件 MUST 拒绝启动并列出支持版本，不猜测相邻版本或回退旧安装

## ADDED Requirements

### Requirement: Pi 中止终态不报成功
Pi Worker SHALL 将原生 `agent_settled.aborted=true` 视为失败或中止，即使未收到助手错误消息；旧版本省略该字段时 SHALL 继续依据既有助手消息、终态、状态回读及退出码判断。插件 MUST 在进程范围退出后才确认停止。

#### Scenario: 新版显式中止
- **WHEN** Pi 1.1.0 或 1.5.2 返回 aborted=true，随后回读空闲且进程退出 0
- **THEN** Worker 不报告成功，保留原生中止结果

#### Scenario: 旧版正常结束
- **WHEN** Pi 1.0.4 的终态省略 aborted，且助手消息、状态回读与退出码均正常
- **THEN** Worker 保持成功结束并可用原生会话 ID 续聊

### Requirement: 正常完成先等待原生进程及范围退出
Worker 和原生分支元数据操作在正常协议管道结束后 SHALL 有界等待直接进程自然退出；进程完成后 SHALL 有界等待范围退出，只有仍未退出才终止并再次确认范围清理。直接进程回执 MUST NOT 代替范围退出证明。

#### Scenario: Windows 原生回执先于 runner 结束
- **WHEN** 桥已正常完成，隐藏窗口回执先于 Windows Job runner 结束
- **THEN** 插件等待范围自然退出，不重复发送终止破坏正在关闭的 IPC；范围确认后保留本轮结果且不暂停后续派遣

#### Scenario: 已完成但进程仍停留
- **WHEN** 正常管道结束后直接进程或其范围在对应 3000ms 宽限内仍未退出
- **THEN** 插件发出终止并继续等待范围退出，不以协议 SUCCESS 直接释放任务资源

#### Scenario: 停止或超时取消
- **WHEN** 用户停止、超时或 abort 已发生，或在宽限等待中发生
- **THEN** 不再等待自然退出宽限，立即沿现有终止流程处理，范围退出前不报告停止成功

#### Scenario: 真实清理错误
- **WHEN** waitForExit 拒绝或无法证明范围已清理，包括 EPIPE
- **THEN** 插件保留 failed、资源和全局派遣隔离，不按错误文本忽略失败

### Requirement: Pi 与 OMP 保留 Windows 原生安装目录发现
Pi/OMP 的桥、权限能力探测及账号终端环境 SHALL 保留已存在的 ProgramFiles、ProgramFiles(x86)、ProgramW6432，用于原生 Git Bash 查找；MUST NOT 修改 Host 环境或扩大无关环境白名单。

#### Scenario: PATH 仅包含 Git cmd
- **WHEN** Windows 已安装 Git/bin/bash.exe 且 PATH 只包含 Git/cmd，父环境提供 ProgramFiles
- **THEN** Pi 原生 bash 查找仍能通过传入安装目录找到 Git Bash

#### Scenario: 父环境未定义安装目录
- **WHEN** 父环境没有这些 Windows 变量
- **THEN** 不猜测目录或创建新的值，其他平台保持原行为
