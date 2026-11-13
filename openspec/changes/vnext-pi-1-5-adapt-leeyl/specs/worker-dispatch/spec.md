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
