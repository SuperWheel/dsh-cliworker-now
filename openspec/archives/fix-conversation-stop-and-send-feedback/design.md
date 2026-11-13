# Design

## Context

见 proposal.md。现有 Host 区分 interrupted/failed，但普通 Abort 原因进入 error；Client 以 conversationId 和全局 busy 控制续聊。Gateway 原有信号可以请求中止 metadata 准备，但客户端 RPC 拒绝不证明 Host 清理已完成；队列已有 requestId 幂等与状态持久化。

## Goals / Non-Goals

**Goals:** 正常停止可恢复，异步提交即时可见，保持同会话互斥与所有鉴权，待发送复用输入框视觉。

**Non-Goals:** 不增加原生引导能力、不展示隐藏推理、不替换会话上下文、不升级版本、不做全量验收。

## Decisions

1. Host 仅在显式用户停止且清理确认后记录 interruptionReason:user，并将普通中断原因作为正常 status。真实错误先发生、超时、清理失败继续保留错误。旧数据仅兼容已知精确正常停止错误，避免把所有 interrupted 当正常。
2. 正常停止无 ID 的 Worker 可以重新建立原生会话，继续重新校验账号和权限，界面明确提示；有 ID 保持原生 resume。暂停的旧队列不随普通新输入偷偷恢复。
3. Client 使用按 Worker 隔离的待提交状态，提交立即清草稿并显示待确认内容，异步接收后用原有队列请求 ID、runId 和 timeline 水位一对一对账。普通 followup 准备期间后续提交本地串行等待，Host 为每个 Worker 注册短暂准备控制器与完成信号；Stop 中止准备并等待 Host 真实清理完成，再停止已准入任务，准备期间阻止重复准入和冲突管理。保留单按钮及失败文本；不扩大为新的持久化离线发件箱。
4. 样式共用 composer 的 radius-panel/specific-input-major/elevation-soft 和描边，外框无内边距，标题自带内边距和全宽下线，条目列表内缩，actions 随条目居中。保留220ms折叠与减少动效行为。

## Risks / Trade-offs

- 回执和事件先后竞态 → 以身份和新增事件水位一对一确认，不只比较文本；明确Host拒绝可重试；普通续聊运输未知只保留待确认消息，不把已可能发送的文本放回草稿，Host停止确认仍原run后才允许恢复和重试。
- 未建立会话时重新启动无原生上下文 → 明确文案并保留插件历史，不伪造resumeId。
- 取消准备后迟到准入 → 串行取消等待及后续stop；未确认清理不开放新轮。
- 本地待确认状态未持久化 → 不声称已入Host队列；可靠队列仍以Host持久化为准。

## Migration Plan

兼容可选正常停止标记，不改已有账号和会话。关联回归、typecheck及preview通过后，在无活动任务时退出Desktop、正式构建并重开验证。回退使用上一构建，不回滚用户运行数据。保留v0.7.9，不推送GitHub。
