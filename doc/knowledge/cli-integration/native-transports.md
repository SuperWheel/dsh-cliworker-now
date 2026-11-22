# 选择并固定原生通信协议

每个 Worker 固定创建时的原生 transport；升级插件不自动改换已有会话协议。

## 1、当前协议映射

| 协议族 | CLI 与 transport |
| --- | --- |
| 双向 stream-json | Antigravity `agy-stream-v1`；Claude `claude-stream-v1` |
| app-server | Codex `codex-app-v1`；ZCode `zcode-app-v1`，二者协议不同 |
| stdio ACP | Kimi `kimi-acp-v1`；Grok `grok-acp-v1`；Qoder `qoder-acp-v1` |
| 原生 RPC | Pi `pi-rpc-v1`；OMP `omp-rpc-v1` |
| HTTP + SSE | MiMo `mimo-http-v1`；Hermes `hermes-http-v1`；OpenCode `opencode-http-v1` |

## 2、机制与实施要点

从安装版实际握手、配置回执和事件确定能力，分别实现初始化、发送、恢复、取消、错误和终态。Host 用 `transportFor` 固定标记，运行时用 `usesNativeBridge` 分派；Pi/OMP 保持自身 RPC 路径。桥输出统一 session、公开 event、native 指标和 result，原协议解析仍彼此独立。

缺省或 `legacy` 标记进入历史执行路径；未知 transport 直接拒绝。恢复必须使用已确认原生 session ID，不能在恢复失败后偷偷新建会话或换 CLI。

## 3、易错边界

同叫 ACP、app-server 或 SSE 不代表配置、权限和事件格式通用；目录接口和任务协议也可能不同。官方最新类型声明不能替代用户安装版验证。

## 4、源码与验证入口

- [transport 与桥入口](../../../src/host/native-worker.ts)：`NATIVE_TRANSPORTS`、`usesNativeBridge`。
- [通用桥分派](../../../src/host/native-bridge.mjs)、[ACP runner](../../../src/host/native-acp.mjs)。
- [协议设计与历史兼容](../../protocols/native-protocols.md)、[transport 回归](../../../tests/native-transport.test.ts)。

## 5、关联笔记

[数据接口](native-data-interfaces.md) · [原生会话](native-conversation-integration.md) · [权限与清理](permissions-and-cleanup.md)
