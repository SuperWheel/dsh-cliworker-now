# Proposal

## Why

用户三张真实 Desktop 截图暴露原生会话回归：内部 CLI 模型进入主对话选择菜单、Qoder 底部统计缺失且显示零、Grok 完成过程没有可展开内容。现有通用验收不能代替这三个实际场景的核查。

## What Changes

- 隔离 Worker 内部模型解析与普通主会话公开模型目录，保留原生侧栏自己的动态 CLI 模型菜单。
- 核对 Qoder 官方协议和本机会话记录，接入有身份凭证的轮次、用量与上下文；无来源的数据明确未知，避免默认零。
- 核对 Grok 公开思考的协议、持久化和投影链路；已有公开内容恢复原生展开，没有公开内容时如实解释。
- 定向回归、类型检查、隔离构建及原生界面验收，保留未运行的真实模型和平台边界。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `worker-conversation-interaction`：模型目录作用域隔离和公开过程的缺失说明。
- `qoder-cli`：原生三项统计的来源与未知状态。

## Impact

涉及插件 Host 内部模型 adapter、Qoder/Grok 原生桥及必要 Client 投影和对应测试。沿用现有 Gateway、真实子会话和官方组件，不修改 Harness 核心、账号、模型选型或既有用户记录。版本保持 v0.8.1，不推送或发布；不自动发送真实模型任务。
