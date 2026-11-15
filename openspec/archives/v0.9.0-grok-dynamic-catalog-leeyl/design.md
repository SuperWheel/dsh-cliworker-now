## Context

`discoverGrok` 先查询隔离、无账号的 ACP initialize，再请求当前账号目录。离线原生 fallback 不代表其动态模型上限。旧实现只对 1.0.0 (3cd0d0cbcebe) 启用既有 `grokDynamicNativeModels`，导致新版 1.0.77 的账号新模型被排除。

## Goals / Non-Goals

- 目标：恢复已验证 1.0.77 对账号动态目录的支持，并保留旧版与未知版边界。
- 非目标：按版本号大小猜测所有未来版本能力；改变续期、账号源或模型强度；发模型 prompt。

## Decisions

1. 继续用精确构建证据，仅加入 1.0.77 (50ca579fa996) 及其 `[stable]` 输出，不宽泛放行全部新版。安装版在隔离 loopback 模拟 `/models` 服务下，通过 `grok-catalog.mjs` 的 ACP initialize 返回全新模拟 ID 与 xhigh/low；请求仅 GET /models。
2. 复用现有 camelCase/snake_case 动态字段解析，继续按允许账号范围过滤 hidden 等拒绝项，拒绝远端 BYOK 路由/认证字段，不硬编码实际账号模型 ID。
3. 无持久化、进程或协议新增；回退可移除新增精确构建条目。未来版本未经验证仍采用原生交集，可能需继续补证。

## Risks / Trade-offs

精确构建范围有维护成本，但避免把未经核实的未来 CLI schema 当作既知事实。只读目录成功不证明真实模型派遣可用；Desktop 构建与复验由主会话统一执行。
