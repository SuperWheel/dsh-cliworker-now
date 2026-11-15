# Proposal

## Why

用户于 2026-11-14 报告 Hermes 连接显示「登录暂时无法续期」，阻断模型与强度加载。本机 Hermes 0.23.1 源码的共享状态写入新增必需关键字 `renewal`，插件固定 helper 仍调用旧签名；需恢复同源续期并提前拒绝不兼容接口，避免兑换后才发现持久化契约错误。

## What Changes

- 续期前检测原生共享写入签名，当前接口显式传 `renewal=True`，保留已核验旧单参数接口。
- 未知签名在任何轮换或写入前返回 `unsupported`；运行期间异常不重试写入、不重复兑换。
- 补充明确标记模拟的回归，记录一次真实续期及状态读回。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cli-account-isolation`：Hermes 同源 OAuth 自动续期须在兑换前确认共享持久化接口，保留新版续期语义与旧版兼容。

## Impact

仅 Host 的 Hermes Python 续期 helper、关联测试、README、设计文档与 OpenSpec。Host 回执协议、Client、cli-management、凭据格式、超时和进程管理保持原契约。

## 成功指标（基线、目标）

基线：本机签名只读探测确认旧调用缺少 `renewal`；账号状态 configured、访问令牌已到期且刷新材料存在。目标：新版与旧版模拟续期通过，未知契约不消耗刷新凭据；本机经插件同一路径执行一次续期并脱敏读回，明确记录真实结果。

## 范围外

不调用模型、不改用户账号来源、不重新登录或绕过失效凭据、不更新 Desktop、不改版本号、不推送发布、不调整其他 CLI。
