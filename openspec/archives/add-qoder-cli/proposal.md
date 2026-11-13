# Proposal

## Why

现有插件的 `CLI_IDS`、账号目录和原生通信桥尚无 Qoder。用户要求研究当前官方协议并接入同一侧栏，包含官方图标、模型选型、过程、停止与续聊。

## What Changes

- 新增明确选择的 Qoder CLI，沿用项目和 CLI 独立偏好及原生 DSH 子会话。
- 依据当前官方文档与发行包探测选择双向通信协议；确认模型和权限后才发送 prompt，缺失原生能力时明确拒绝。
- 接入自身账号、动态模型目录、生命周期清理和原生事件，不继承其他 CLI 的认证或权限参数。
- 下载官方 Qoder 图标并复用既有图标与主题规则，记录来源。
- 补充定向模拟回归、隔离构建和研究/验收文档，真实模型与 Windows 运行验收分开说明。

## Capabilities

### New Capabilities

- `qoder-cli`: Qoder 的原生选型、会话、权限、公开事件与图标接入。

### Modified Capabilities

无；沿用已有 `cli-account-isolation`、`cli-model-discovery`、`worker-dispatch` 等跨 CLI 约束。

## Impact

涉及 shared CLI 标识、Host 配置/路由/账号/目录/原生桥、Client 图标、构建资产、README 与设计/实际验证记录。保持 v0.8.1；不修改宿主核心、历史会话或其他 CLI 的行为，不自动安装全局 Qoder、不推送发布。不将无模型调用的离线探测描述为真实任务成功。
