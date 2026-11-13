# Spec Delta

## MODIFIED Requirements

### Requirement: 日常最小验收与版本冻结
日常修复和调整 SHALL 仅执行与影响范围对应的最小验收；全量验收 SHALL 在用户批准的正式 GitHub 提交之前执行。当前开发版本 MUST 保持 v0.7.9，正式提交 GitHub 前不额外增加版本号；GitHub 提交及发布仍需明确授权。最小验收 SHALL 明确已执行检查和未验证边界。

#### Scenario: 当前版本内修复
- **WHEN** 用户要求修复 bug 但未批准正式提交 GitHub
- **THEN** 保持开发版本 v0.7.9，执行关联检查、隔离构建及必要最小平台验证，不执行全量 CLI 验收、不推送或发布

#### Scenario: 版本发布
- **WHEN** 用户明确批准正式提交 GitHub 或发布
- **THEN** 提交前执行全量验收并核对安装及分发证据，未验证项继续保留，提交前不额外升号
