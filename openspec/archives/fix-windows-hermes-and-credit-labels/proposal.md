# Proposal

## Why

用户要求按积分计费的 Qoder 用量模块只显示积分，将“Token 用量”改为“积分用量”。现有 `StatsPills.tsx` 仍把积分和未公开 Token 并列，标题仍使用 Token。

Windows 两个 Hermes 任务均在提交模型请求前因“API 网关启动已中止”失败；原生 `gateway_state.json` 和日志却证明 API 已经监听。本次核对并修复启动器、实际网关进程与就绪证明之间的兼容问题，不靠延长超时掩盖。

## What Changes

- 用明确的积分计费来源决定用量标题和单位；积分存在、为零或尚不可用时均不在该模块插入 Token 字样，其他 CLI 的 token 统计保留。
- 修复 Hermes Windows 原生网关就绪确认，保持本次进程、监听地址、鉴权和取消清理边界；未知启动器或无证据时明确失败。
- 在 Windows 做关联回归、必要类型检查、无模型调用的真实网关检查及 Desktop 最小显示验收。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `qoder-cli`：按积分计费的用量入口和弹层使用积分文案。
- `platform-runtime`：Hermes 原生网关的跨平台就绪与启动失败边界。

## Impact

Client 用量投影、原生四包可选扩展及备用组件；Host Hermes 网关与自有 Python 入口；相关 Windows 检查、协议与实际验收记录。不升级依赖、CLI 或版本，不修改账号与原生历史，不推送发布。
