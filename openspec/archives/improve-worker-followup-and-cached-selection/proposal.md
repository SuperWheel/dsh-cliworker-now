# Proposal

## Why

子对话运行中锁住输入框，用户无法提前提交下一轮引导；模型菜单每次打开和改选都会等待原生查询。过程区还漏掉部分 CLI 已公开的摘要，笼统提示不足以解释实际内容。

## What Changes

- 按用户选择，运行中可编辑、提交待发送消息，当前轮正常结束后自动沿原会话发送；显示队列，允许取消，失败或停止保留内容而不自动执行。
- Worker 模型与强度优先读首次派遣保存的目录，选择只保存偏好，真正发送时重新验证账号、路由和选型。设置页原有刷新规则保持。
- 保留同一原生会话 ID。未发现插件换模型清空会话的路径，不显示无依据的“必然丢失上下文”弹窗；原生后台语义完整性不冒充已验收。
- 过程区展示协议明确公开的思考摘要、计划和工具记录，不提取隐藏思考、解密字段或生成替代内容。
- 开发版本保持 v0.7.9，只做关联最小验收。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `worker-conversation-interaction`：运行中输入、结束后自动发送和公开过程展示。
- `cli-model-discovery`：Worker 保存目录展示与发送时实际验证。

## Impact

涉及 Host 队列生命周期、Gateway 续聊接口、目录缓存、共享快照、Client 输入和模型菜单及公开事件解析。依据 `src/client/panel.tsx` 的 active 禁用、`src/host/runtime.ts` 的同会话互斥、`src/host/index.ts` 的 configureWorker 查询链和 `src/host/cli-protocol.ts` 的摘要丢弃行为。使用现有依赖，不修改 Harness 核心、原生账号或会话文件，不迁移 Codex app-server，不增加计费调用，不自动更新 Desktop 或提交 GitHub。
