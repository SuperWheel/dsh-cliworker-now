# Proposal

## Why

`claude-own-route.ts` 将桌面进程继承的 Claude 路由环境一律拒绝，登录入口又先执行同一检查，导致 CC Switch 切换后官方登录和路由任务都可能不可用。模型字段仅覆盖三个旧家族，模型目录依赖 `/v1/models`，也不兼容原生 `[1m]` 上下文后缀及不提供目录的网关。

## What Changes

- Claude 官方登录与退出始终使用当前原生账号目录和本次进程的官方覆盖，不依赖代理存活或路由凭据检查，不改 CC Switch 配置。
- Claude 路由以当前自身 settings 为来源；进程继承的旧凭据及模型变量在查询和执行时被明确清除或覆盖，不成为登录证据。
- 支持当前原生模型映射字段及上下文后缀。网关不提供模型目录时仅开放其自身明确配置的模型并标注证据边界；明确认证拒绝仍失败。
- macOS 与 Windows 共用 argv 和私有 settings 覆盖，保留原生账号存储及既有会话。
- 当前开发版本按用户指定记为 v0.7.8，未批准不再升号、不上传 GitHub。日常调整只做关联最小验收，全量验收用于获准的版本发布。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cli-account-isolation`: Claude 自身路由的来源、官方登录与进程覆盖。
- `cli-model-discovery`: Claude 网关配置模型、目录错误与原生上下文后缀。
- `development-workflow`: 开发版本冻结和最小验收/发布全量验收边界。

## Impact

Host 的 Claude 路由、账号操作、模型发现、账号绑定及相关测试；README、设计与验证日志及项目规则。Gateway 协议、Harness 核心、其他 CLI、原生配置和账号不变。无新增依赖；不发起真实模型任务，不将最小合成验收描述为真实登录或生成成功。
