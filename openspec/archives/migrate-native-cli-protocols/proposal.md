# Proposal

## Why

当前多数 Worker 通过单轮 headless 输出工作，只有 Pi/OMP 已使用双向 RPC；Codex、Claude、Grok 和 ZCode 的原生控制协议只用于部分准备查询。用户已要求将全部活跃 CLI 迁往当前原生通信协议，以获得明确的轮次、会话及取消语义。

## What Changes

- 新任务分别采用 Codex app-server、Claude/Antigravity 双向 stream-json、Kimi/Grok ACP、ZCode app-server、OpenCode/MiMo HTTP+SSE、Hermes Runs HTTP API；Pi/OMP 保持原生 RPC 并完善取消。
- 持久绑定 Worker 的通信协议；缺少绑定的历史 Worker 沿旧通路续聊，不自动把 Hermes CLI 会话交给 HTTP API。
- 共享受管桥负责消息边界、超时、退出和私有请求文件，各 CLI 独立映射模型、强度、权限与公开事件。HTTP 服务仅使用受管回环实例。
- 不升级用户全局 CLI、不修改 Harness 核心/登录配置、不切换账号或模型、不发布 GitHub；版本保持 v0.7.10。

## Capabilities

### New Capabilities

- `native-cli-transports`: 原生通信协议、兼容会话绑定、受管通信生命周期及逐 CLI 错误判定。

### Modified Capabilities

无。既有派遣权限、账号隔离、结果判定及直接子 Agent 边界继续适用。

## Impact

影响 Host 启动准备、运行器、私有存储、原始事件/遥测、协议桥及构建资产；Client 继续仅通过 Harness Gateway。参考当前 `src/host/runtime.ts`、`adapters.ts`、`extended-adapters.ts`、`pi-omp-bridge.mjs` 和各 CLI 官方协议。验证采用模拟协议进程/HTTP 服务及最小关联回归；真实模型、Windows 与 Desktop 证据分别记录，不把离线结果表述为真实验收。

版本归属补充（2026-10-16）：用户明确将本次原生协议迁移、排队与独立引导改动及下一次正式提交前的调整归入 v0.7.10；此前验收时实际构建的 v0.7.9 及原始哈希证据保留，不表示已发布 v0.7.10。
