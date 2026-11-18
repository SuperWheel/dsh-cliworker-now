# 工具桥按真实子 Agent 权限执行

结论：工具桥把 CLI 请求送入真实子 Agent 的 Harness 工具链；发现工具目录、允许连接与允许执行是三个不同条件。

## 机制

Host 为每个 run 创建仅监听回环地址的临时端点，以随机令牌和 parent/child/Worker/run/CLI 五元身份校验请求。连接信息经本轮私有环境或临时 MCP 会话配置传递，不进入任务命令参数、公开事件或账号快照。

可见目录来自真实 child 的 `tools.schemas(child)`；调用通过 `tools.execute({ agent: child, ... })` 保留宿主权限、审批和取消。每次调用及缓存回执返回前重新核对目录；同请求 ID、同参数共享结果，同 ID 改参数拒绝。取消或连接状态不明不会自动重试。

技能按 `modelInvocable` 与 `requiredTools` 按需读取，资源访问限制在公共 `resourceBase` 内。递归 Worker 派遣等入口被排除；`withinCliTool` 与模型守卫阻止工具偷偷回退到 DSH 模型生成。

## 易错边界

12 种任务 CLI 并不等于 12 种工具桥都可执行。`executionReady` 及临时注入能力必须逐 CLI 核验；目录、模拟桥与真实模型调用也属于不同证据。非文本结果不能忠实投影时保留文本并明确错误，不能泄露内部附件引用。

## 源码与验证入口

- [工具桥](../../../src/host/native-harness-tools.ts)：`createNativeHarnessTools`；[模型守卫](../../../src/host/harness-model-guard.ts)：`withinCliTool`、`installHarnessModelGuard`。
- [临时注入](../../../src/host/native-harness-injection.mjs)与[ACP 会话配置](../../../src/host/native-acp.mjs)：连接材料的私有传递路径。
- [工具桥回归](../../../tests/native-harness-tools.test.ts) · [扩展回归](../../../tests/native-harness-extended.test.ts)。
- [逐 CLI 能力矩阵与历史真实证据](../../protocols/native-harness-tools.md)。

关联：[三类身份](session-identities.md) · [账号与存储](account-storage-isolation.md) · [返回分类索引](README.md)
