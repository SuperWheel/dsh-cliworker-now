# Spec Delta

## ADDED Requirements

### Requirement: 桌面存在与 CLI 未找到的诊断
ZCode/OpenCode 的默认入口发现失败 SHALL 区分未找到 CLI、桌面已存在但无可用 CLI、多个可用安装及安装信息探测失败。MUST 保留简短操作指引及对应 executable 配置字段，不将桌面或账号痕迹描述为已安装可执行 CLI 或已登录。

#### Scenario: 桌面存在但 CLI 缺失
- **WHEN** 相应桌面安装存在，但该版本未附独立 CLI 或其必要文件损坏
- **THEN** 显示桌面存在、CLI 不可用及配置独立 CLI 的短原因，不返回笼统的尚未安装，也不启动桌面 GUI

#### Scenario: 入口恢复
- **WHEN** 用户补齐相应 CLI 或明确配置路径后刷新
- **THEN** 重新解析当前入口再执行既有账号检查，不修改旧账号、会话或项目选型

#### Scenario: 未找到 CLI
- **WHEN** 默认位置、PATH 及登记/快捷方式均不能定位有效 CLI
- **THEN** 显示未找到 CLI 和对应 executable 配置指引，不声称整个桌面软件未安装
