# 接入 Harness 原生会话

新增 CLI 要接入已有原生子会话契约，使输入、模型选择、过程、正文和续聊共用 Harness 会话界面。

## 1、机制与实施要点

Worker 保留 CLI 原生 `conversationId`，另有 Harness 子会话绑定；两者身份独立，不能混用。Host 的 conversation adapter 把发送、模型目录、选型、权限、停止等操作连接到 WorkerRuntime。

运行事件转换成原生消息与块：正文、公开思考和工具分开；工具只传实际公开 ID、父 ID、输入输出等字段；用量从本轮原生回执进入对应消息。若没有公开 reasoning，不合成内部推理。

能力矩阵按实际实现声明。运行中 `steer` 只有已接通原生通道且满足当前能力时可用；不支持的 CLI 通过原生 Inbox 在轮次清理后消费后续消息，不能把排队接收显示为模型已执行。

## 2、易错边界

原生 UI 显示成功不证明真实 CLI 执行完成。历史重放不应重复进入当前轮正文；终态聚合与最后响应要区分，避免重复回复。新增 CLI 时还需核对原生会话注册、重开恢复和 Host 注销清理。

## 3、源码与验证入口

- [会话 adapter](../../../src/host/harness-conversation.ts)、[会话契约](../../../src/host/harness-conversation-types.ts)。
- [Client 原生会话扩展](../../../src/client/harness-conversation.tsx)、[子会话模型目录](../../../src/client/native-cli-model-directory.ts)。
- [事件流投影](../../../src/host/harness-conversation-stream.ts)、[运行中消息能力](../../../src/shared/running-message.ts)。
- [原生会话设计](../../protocols/native-conversation-ui.md)、[公开过程设计](../../protocols/public-process.md)。
- [原生内容回归](../../../tests/harness-native-content.test.tsx)、[原生控件回归](../../../tests/harness-native-controls.test.tsx)。

## 4、关联笔记

[注册与能力声明](cli-registration.md) · [通信协议](native-transports.md) · [权限与清理](permissions-and-cleanup.md)
