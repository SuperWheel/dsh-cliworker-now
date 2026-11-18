# 原生会话投影与界面复用

结论：Worker 在右侧 CLI Worker 栏绑定真实 Harness 子 Agent，由官方会话组件承载正文与输入；显示既有执行不会再次调用模型。

## 机制

- Client 通过 `ensureHarnessConversation` 获取或建立绑定，保留官方 `SessionReference`，由侧栏 `SessionProvider` 接入 `sidebar.chat.conversation` 的 `ConversationSlotPanel`。顶部仍保留 Worker 导航和操作。
- 发送沿 `Session.prompt → subagents.prompt → Agent inbox` 进入 Host 原有 Worker 准入。输入、排队、审批及快捷键由原生会话管理，不维护第二套原生模式队列。
- Host 的内部 provider 与 `llm/stream` 路由把获准请求交给 CLI runner，公开块投影到 AgentLoop。展示工具回执时不再执行 CLI 已完成的工具。
- 切换 Worker、关闭侧栏与卸载取消读取等待、解绑投影并释放引用；关闭视图不等于停止任务。迟到回执不能切换当前 Worker。

## 易错边界

早期只嵌入 `conversation.content`、自组输入栏或打开主页面的方案属于历史记录。旧 Worker 首次挂接也不宣称完整导入原有历史；更早内容从只读旧历史入口查看。缺失路由明确失败，不能回退到宿主模型补答。

## 源码与验证入口

- [Client 原生会话](../../../src/client/harness-conversation.tsx)：`HarnessConversation`；[Host 桥](../../../src/host/harness-conversation.ts)：`HarnessConversationBridge.route`；[流投影](../../../src/host/harness-conversation-stream.ts)。
- [官方会话回归](../../../tests/harness-conversation-official.test.ts) · [界面回归](../../../tests/harness-conversation.test.tsx)。
- [现行界面与历史边界](../../native-conversation-ui.md) · [有限宿主扩展](../../protocols/native-conversation-host-extension.md)。

关联：[职责边界](host-client-gateway.md) · [三类身份](session-identities.md) · [返回分类索引](README.md)
