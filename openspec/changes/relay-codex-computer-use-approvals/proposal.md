# Proposal

## Why

`src/host/native-codex.mjs` 将未列入 `APPROVAL_METHODS` 的服务端请求统一回 `-32601` 并标记失败，导致 Computer Use 应用授权被当成不支持的交互输入。按用户 2026-10-30 的决定，此类授权应转交现有 DSH 审批策略，拒绝后正常结束仍为 completed。

## What Changes

- 单独识别当前线程、当前轮次（或空 turnId）的 `cua_repl` Computer Use 空表单应用授权，转为 `kind: permission`。
- 使用原生 elicitation 的 accept/decline/cancel 回复；仅明确支持 session 时提供会话允许，不发送 always、不缓存授权。
- 沿用 Worker 档位与规划模式决定，拒绝写入时间线但不单独判失败；防止重复、停止及迟到回复放行。
- 非空表单、URL 登录、未知或跨线程请求保留失败处理；补充模拟回归、README 与设计说明。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `native-permission-relay`: 区分已核实的授权型 elicitation 与输入型 elicitation，复用档位策略及原生会话授权。
- `worker-run-outcomes`: 明确 Computer Use 授权被拒后正常结束为 completed，真实失败仍失败。

## Impact

仅涉及 Codex Host runner、关联测试与文档；不改 Client、安装流程、依赖、版本号或公共协议。依据用户提供的 Codex 0.162.1/0.166.0 schema 与 @oai/sky 0.7.13 静态重建形状；静态重建与模拟不代表真实 Windows 抓包或 DSH 往返已验证。本次不调用真实模型、不读取凭据、不扩大到通用 MCP 表单输入。
