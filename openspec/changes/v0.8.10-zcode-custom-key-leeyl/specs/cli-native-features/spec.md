# Spec Delta

## ADDED Requirements

### Requirement: ZCode 运行偏好答复跟随已安装版本
插件答复 ZCode `session/requestRuntimePreferences` 时 SHALL 只发送已安装 CLI 结果 schema 接受的字段。Host SHALL 在启动前静态读取 ZCode 入口脚本判定动态工作流字段的位置：答复 schema 列出 `dynamicWorkflowMode` 时（旧版本）在答复中发送；答复 schema 不接受而 `session/create`、`session/resume` 接受时（0.17.1）改在会话创建与恢复参数中发送；两者都无法证明时（0.16.9、原生二进制或无法读取）两处都不发送。判定 MUST NOT 运行 CLI 或读取凭据，结果按文件身份缓存，更新或重装后重新判定；传给桥接的判定环境变量 MUST 在启动 CLI 前移除。

#### Scenario: ZCode 0.17.1
- **WHEN** 已安装 ZCode 的严格答复 schema 不含工作流字段
- **THEN** 答复只含该 schema 字段，用户的工作流设置随 session/create 与 session/resume 发送，派遣不再因未知字段失败

#### Scenario: 旧版本
- **WHEN** 已安装 ZCode 的答复 schema 包含 `dynamicWorkflowMode`
- **THEN** 继续在答复中发送工作流设置，行为与此前一致

#### Scenario: 无法判定
- **WHEN** 入口不是可读的脚本文件或 schema 形状未知
- **THEN** 两处都不发送工作流字段，ZCode 使用自身默认值，派遣不因字段被拒绝而失败
