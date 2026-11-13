# Proposal

## Why

当前 CLI 已将公开思考写入原生 assistant reasoning 块；用户明确要求记录放在原生思考过程里面，不在答复功能条前新增独立入口。用户要求参考 CodexHost 的实时预览和持久思考记录，为全部 CLI 提供一致的查看方式；Codex 当前没有主动请求公开摘要。

## What Changes

- 保留原生流式思考预览，将过程分组中的原生思考行统一为可展开的“思考记录”，从同一轮原生消息读取，关闭重开仍能查看。
- 统一适配 Antigravity、Codex、Claude Code、Kimi、MiMo、ZCode、Grok、OMP、Pi、Hermes、OpenCode、Qoder 的既有公开 reasoning 投影。
- Codex 后续 `turn/start` 显式请求 `summary: auto`，只显示实际返回的公开摘要。
- 空白、未公开、签名和加密内容不生成面板；旧记录缺失不能补造。
- 补齐 CodexHost 的用量、缓存、Codex 摘要及上下文分类来源调查和验证记录。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `worker-conversation-interaction`：新增每轮持久思考记录入口及 Codex 公开摘要请求要求。

## Impact

Client 通过公开 `conversation.chat.node` 的 assistant-step 入口委托原生渲染器，只调整思考行标题与展开正文的滚动区域；过程分组、折叠状态、正文、工具树和 Markdown 仍由原生组件管理，不新增 turnTail 面板或伪工具调用。Host 仅调整 Codex 原生请求摘要选项；不新增 Gateway、存储或统计协议。保持 v0.8.1，先隔离构建和 UI 验收，再按空闲条件更新 Desktop。

不实现未公开内部推理提取、不重新执行历史任务、不根据比例反算 token，不新增计费估算；12 CLI 的真实模型调用和 Windows/Linux 实机验证不属于本次已授权验收。
