# Proposal

## Why

用户已授权在 macOS 和 Windows 全量验收通过后，将当前 v0.7.9 发布至 GitHub、npm 和 dshmarket。此前已实现的功能和最小验收不能替代本次冻结安装包的跨平台交付核验。

## What Changes

- 执行两个平台的完整自动测试、类型检查、隔离构建与原生安装/Host 生命周期核验。
- 按用户补充要求，在确认无活动任务后更新 Windows 正式 Desktop 并补可见交互验收；核对 macOS 最新实装行为证据，分开说明自动化全量与正式桌面验收。
- 将旧测试对续聊准备状态的预期与已落实的忙碌协议对齐，保留外部禁用竞态覆盖；POSIX 权限数值只在对应平台断言，两个平台均核验拒绝链接且外部目标不变。
- 冻结一份预构建包，核验公开边界和 SHA256，更新双语下载链接及发布记录。
- 仅在验收合格后提交 GitHub、发布 npm 并更新既有 dshmarket PR。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

无。沿用已归档的 v0.7.9 行为规格；本变更仅管理验收、测试维护和交付，不引入产品行为。

## Impact

影响 tests/cli-settings.test.ts、tests/followup-queue.test.ts、README、发布记录与公开发布渠道。Host/Client/共享协议不计划修改；若验收发现真实缺陷，按其实际影响补充规格与复验。不改 Harness 核心、现有账号、会话或无关素材。真实订阅/模型全覆盖不由合成测试替代，结果逐项记录。
