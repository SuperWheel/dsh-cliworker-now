## MODIFIED Requirements

### Requirement: 日常最小验收与版本冻结
日常修复和调整 SHALL 仅执行与影响范围对应的最小验收；发布验收 SHALL 在用户批准的正式 GitHub 提交之前执行。开发期间 MUST NOT 自行增加版本号，正式提交时使用用户确认的版本号。GitHub 提交及发布仍需明确授权。最小验收 SHALL 明确已执行检查和未验证边界。

#### Scenario: 当前版本内修复
- **WHEN** 用户要求修复 bug 但未批准正式提交 GitHub
- **THEN** 保持当前版本号，执行关联检查、隔离构建及必要最小平台验证，不执行发布验收、不推送或发布

#### Scenario: 版本发布
- **WHEN** 用户明确批准正式提交 GitHub 或发布，并确认版本号
- **THEN** 提交前执行上述发布验收并核对安装及分发证据，未验证项继续保留

## ADDED Requirements

### Requirement: 发布验收范围
发布验收 SHALL 包含：macOS 类型检查、全量 vitest、`spec:check` 与相对远端主分支的 `git diff --check`；Windows 远程隔离 preview、冻结依赖安装、类型检查、Windows CI 定向测试文件与 Host 加载；正式构建、公开清单、打包内容扫描与官方 dsh 隔离 profile 安装；macOS 与 Windows Desktop 用原生安装器安装发布候选包后的只读界面核对；发布后 npm 固定版本元数据与 Release 安装包哈希回读。真实 CLI 验收 SHALL 只覆盖自该平台上次真实验收以来派遣、登录或退出代码有变化的 CLI，并在发布候选包上执行；其余 CLI 引用已有验收记录。Windows 隔离环境全量 vitest SHALL NOT 作为发布门槛；Windows 平台代码的测试 SHALL 并入 Windows CI 定向文件。

#### Scenario: 真实 CLI 验收范围
- **WHEN** 准备发布且某 CLI 自该平台上次真实验收以来派遣、登录或退出代码没有变化
- **THEN** 不重跑该 CLI 的真实调用，在发布记录中引用上次验收；有变化的 CLI 在发布候选包上实测并核对事件、退出状态与实际产物
