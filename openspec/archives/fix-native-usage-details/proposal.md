# Proposal

## Why

Windows Desktop 的回复功能条仍把 Qoder 积分账单显示成未知 Token；上下文弹层附带冗余说明，模型行暴露内部 Worker 路由。用户要求统一积分展示、精简统计弹层并显示实际 CLI／提供方／模型。

## What Changes

- 将逐轮积分按已结算 run 与 Harness turn 精确绑定，未知积分保留积分单位。
- 将该轮已确认的模型身份作为独立展示元数据，不改变内部模型路由和原始事件。
- 全部 CLI 的统计弹层删除重复缺失说明，保留未知破折号和估算标记，收紧留白。
- 仅在 Windows 执行关联测试、类型检查和现有历史的 Desktop 最小验收，不新增真实模型调用。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `worker-conversation-interaction`：逐轮积分及模型身份展示。
- `worker-context-inspection`：简洁的上下文统计菜单。

## Impact

影响 Host 的精确逐轮投影、共享统计契约、插件回退 UI、随包原生 UI 扩展及文档；复用既有 Gateway、只读采集和部署方式，无新依赖，无账号或事件迁移，版本保持 v0.8.1。
