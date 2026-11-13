# Spec Delta

## ADDED Requirements

### Requirement: 随包界面升级保留目标宿主原生行为
随包原生 UI SHALL 基于可核验的目标官方源码与补丁构建，并保留目标版本的原生视图动作、草稿初始化和提交快照语义。发布源码身份 MUST 与实际应用构建标记分别记录；兼容声明须区分隔离验证、正式客户端和真实模型验证。

#### Scenario: rc.3 原生行为
- **WHEN** 在 Harness 0.2.1-rc.3 启用插件
- **THEN** 保留 header views.actions、视图 pin、whenDraftExists 的 append/replace/keep 优先语义，以及 newSession/agentPreset 提交快照字段

#### Scenario: 宿主兼容与重复来源
- **WHEN** 在声明支持的宿主启用或禁用插件
- **THEN** 页面可启动，每个四包身份只有一个活跃来源，启用后原生设置仍可写回 canonical stock 行；不符合接口或来源约束时保留预检错误

#### Scenario: 来源可复核
- **WHEN** 重建或核对随包资源
- **THEN** 固定 tag、真实 Git commit、源码补丁、依赖清单和文件摘要可对应，不把应用短构建标记冒充 tag commit
