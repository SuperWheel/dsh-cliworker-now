# Proposal

## Why

上一轮插队在 `message-submissions.ts` 的暂停、失败及停止对账中会恢复待发送卡片；Panel、Client 和 Host 又在已有插队或准备期间拒绝下一次插队，与用户要求的即时提交和连续插队不符。

## What Changes

- 每次有效插队点击立即移入对话并移出卡片，包括本地排队尚未收到回执的消息；后台回执不得令卡片重新出现。
- 连续插队采用后一次优先：取消此前尚未实际执行的插队请求，取消的消息持久保留在对话，明确标记已被后续插队取消。
- 已开始的前轮仍按正常停止清理后执行最新请求；普通未选队列保留，权限、账号及清理限制保持。
- 插队失败、停止及不确定状态保留在对话内，不再恢复成待发送卡片；关闭重开或 Host 重启不丢历史，也不重发已取消内容。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `worker-conversation-interaction`：即时插队的归属转移、连续替换及取消历史。

## Impact

Host 插队调度与私有持久化、共享事件和时间线、Gateway 接口、Client 提交与卡片操作，以及相关回归。保留现有退场动效和单按钮，不新增设置或原生 CLI 能力，不修改 Harness 核心。版本保持 v0.7.9，仅关联最小验收及 Desktop 检查，不推送 GitHub。
