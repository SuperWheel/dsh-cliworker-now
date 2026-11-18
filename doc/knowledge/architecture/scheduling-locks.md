# 调度同时保护 Worker 和项目目录

结论：执行需要同时满足全局并发、单 Worker 互斥和项目目录冲突约束；某一层空闲不代表任务可以启动。

## 机制

- `WorkerRuntime` 在 Gateway 首个异步等待前预留消息提交身份，随后用准备占用保护账号、模型等异步准入，避免两个请求都观察到空闲后同时启动。
- `drain` 按 `maxConcurrent` 限制正在运行任务。相同规范化项目目录中，只要任一任务为 `accept-edits`，两者就冲突；检查既有运行，也检查队列中更早的冲突任务。
- 同 Worker 的运行、准备、停止和消息提交各有所有权。普通待发项交由原生 Inbox；历史兼容队列仍有独立代际，旧停止或迟到回执不能误作用于新轮。
- 模型、强度和权限修改同样检查 busy 状态及待发消息，防止已排队任务在提交后被悄悄换配置。

## 易错边界

“最多两个并发”不是固定的跨项目保证，实际以配置和冲突判断为准。同目录规则也不意味着插件提供新的操作系统沙箱；CLI 与宿主权限仍独立生效。界面按钮禁用只是反馈，互斥必须在 Host 再次校验。

## 源码与验证入口

- [运行调度](../../../src/host/runtime.ts)：`reserveSubmission`、`prepareFollowup`、`busyReason`、`drain`。
- [运行回归](../../../tests/runtime.test.ts) · [原生运行回归](../../../tests/native-runtime.test.ts) · [权限回归](../../../tests/worker-permissions.test.ts)。
- [运行中发送的协议边界](../../protocols/running-message-protocol.md)。

关联：[职责边界](host-client-gateway.md) · [停止与恢复](stop-and-recovery.md) · [返回分类索引](README.md)
