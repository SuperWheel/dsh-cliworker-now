# Host、Client 与 Gateway 的职责边界

结论：Host 决定执行与持久化，Client 决定展示和交互；两者通过 Harness 原生 Gateway 交换受校验的数据。

## 机制

- Host 服务注册 `cliworker` Remote API，负责目录查询、账号绑定、配置、调度、进程与 WorkerStorage。Client 请求操作，不直接读取账号文件或启动 CLI。
- Client 的会话、设置和管理视图使用 Gateway 返回的权威绑定与快照。原生会话统计通过会话作用域的 projection 接入；界面不自行从父对话推算 Worker 数据。
- 各 CLI 的传输协议和参数适配留在 Host。任务使用明确参数数组，不能把用户任务文本拼进 shell 命令。

## 易错边界

“前端已经选中”只代表交互状态，不能替代 Host 对账号、模型、目录与运行条件的校验。反过来，为加快界面而复用缓存，也不应把执行准入交给展示缓存。`doc/design.md` 按版本保留历史，早期单 CLI 与旧界面方案不能当作当前全量能力说明。

## 源码与验证入口

- [Host 服务](../../../src/host/index.ts)：`CliWorkerService`、Remote API 注册；[调度](../../../src/host/runtime.ts)：`WorkerRuntime`；[存储](../../../src/host/storage.ts)：`WorkerStorage`。
- [Client 会话接入](../../../src/client/harness-conversation.tsx)：`HarnessConversation`；[服务集成回归](../../../tests/harness-service-integration.test.ts)。
- [现行原生界面说明](../../protocols/native-conversation-ui.md)。上述入口不是本次执行测试的声明。

关联：[三类身份](session-identities.md) · [模型目录隔离](model-catalog-isolation.md) · [返回分类索引](README.md)
