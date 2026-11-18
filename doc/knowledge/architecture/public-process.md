# 公开过程只投影已公开内容

结论：思考和工具展示必须来自 CLI 实际公开事件；reasoning token 数、最终答案、签名和空片段都不能补造思考文本。

## 机制

Host 按协议白名单提取公开 `reasoning` 与 `PublicToolCall`，分别保留可读摘要和真实调用 ID、父调用、输入、输出、命令及退出码。缺字段保留缺失，不把任意原始对象直接序列化为过程。

原生会话沿 `assistant-step` 持久化，由原生过程和 ReasoningRow 展示；Client 的“思考记录”适配仅改变该 Worker 的显示入口，不新增第二份文本历史。公开思考与工具按实际顺序交错，最终回答独立保留。当前只有明确支持的公开增量通路实时发布，可撤回快照仍遵循其公开完成边界。

## 易错边界

没有可读思考或工具的轮次不制造可展开内容。真实父调用 ID 才能建立工具层级，时间、名字或路径相近不能证明调用树。Markdown 走宿主安全渲染；工具参数中的 HTML、脚本与命令保持数据。旧兼容视图的历史提示文案不代表当前原生界面行为。

## 源码与验证入口

- [Host 流投影](../../../src/host/harness-conversation-stream.ts)：`HarnessConversationStream`；[公开数据类型](../../../src/shared/types.ts)：`PublicToolCall`；[思考记录适配](../../../src/client/harness-reasoning-records.tsx)。
- [公开过程回归](../../../tests/public-process.test.ts) · [工具投影回归](../../../tests/public-tool-projection.test.ts) · [思考记录回归](../../../tests/harness-reasoning-records.test.tsx)。
- [逐 CLI 字段及展示边界](../../protocols/public-process.md)。

关联：[原生会话投影](native-session-projection.md) · [遥测口径](telemetry-semantics.md) · [返回分类索引](README.md)
