## Why

2026-11-15 Mac RC 验收中，Grok 1.0.77 (50ca579fa996) 已登录但派遣前报「当前 CLI 未支持账号模型」。只读复现显示离线 ACP 候选为 grok-4.6/4.5，当前账号 /settings 与 /models 均 HTTP 200，账号仅返回 grok-4.7；动态目录分支却只认可旧版 1.0.0 的精确构建号。

## What Changes

- 在已有精确构建验证表中加入本机已验证的 1.0.77，包括原生输出的 stable 标记形状。
- 保持当前账号权限检查、动态 schema 校验、原生强度限制及未知构建的交集路径。
- 补充明确标记「模拟」的新旧构建和字段形状回归；记录只读探测与 Desktop 待复验边界。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cli-model-discovery`: 明确已验证 Grok 新版构建的动态目录兼容行为。

## Impact

仅 Grok Host 目录选择、相关测试和本变更文档。不改变 Client、权限、安装、账号续期或真实任务协议。不触及并行修改中的 ZCode/MiMo/Hermes；不构建、不提交。
