# Proposal

## Why

桌面实际使用发现：正常停止和插队被显示为错误，原生会话尚未建立就停止后无法再次输入；发送等待 Host 准备才清空草稿，使界面看起来卡住。待发送卡片的外观和对齐也与下方原生输入框不一致。

## What Changes

- 正常用户停止与真正故障区分；停止确认后允许继续对话。未建立原生会话时允许重新开始并明确提示，绝不猜测会话 ID。
- 点击发送立即展示待确认消息或待发送卡片、清空当次草稿；后台确认后对账，失败保留文本；同一 Worker 的准备阶段仍串行并可停止。
- 待发送卡片共用输入框圆角、底色、阴影，标题分隔线贯穿两边，条目分隔线内缩，操作垂直居中。
- 保留单发送按钮、引导/插队/排队、折叠动效及权限和进程清理边界。版本保持 v0.7.9，不涉及 GitHub 发布及全量验收。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `worker-conversation-interaction`：正常停止后的可用性、即时提交反馈、待发送外观。

## Impact

涉及 `src/host/runtime.ts` 的终态及恢复、共享 Worker 持久化字段、Gateway 准入、`src/client/panel.tsx` 提交状态及 `styles.ts`。当前源码把取消原因写入 worker.error、依赖 conversationId 启用输入，并通过全局 busy 等待发送；本次在这些已有入口修复。只做关联测试、类型检查、隔离构建与实际 Desktop 验证；不修改 Harness 核心、不新增依赖、不迁移真实账号或历史会话。
