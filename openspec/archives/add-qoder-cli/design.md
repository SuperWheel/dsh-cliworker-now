# Design

## Context

参见 proposal.md。当前版本使用 `native-worker.ts` 的逐 CLI transport、`native-bridge.mjs` 以及独立 runner；Kimi/Grok 已有 ACP，其他 CLI 按各自协议运行。账号及模型选择在任务准入、启动、出队和续聊重检。设置由 CLI_IDS 驱动，图标由本地资产映射驱动。

## Goals / Non-Goals

复用原生侧栏、Host 生命周期、账号绑定与项目偏好。Qoder 的模型、权限、恢复、思考强度均以实际协议为依据。此次不绕过登录或订阅、不猜测模型/强度、不自动全局安装或发起未选型的真实请求、不迁移其他 CLI 会话。

## Decisions

- 采用已核对的官方 1.1.73 `qoder --acp`（stdio JSON-RPC 2.0），transport 为 `qoder-acp-v1`。SDK 1.0.53 自带较旧 1.1.71，不额外引入该运行时。模型/强度/mode 使用实际 configOptions 的字符串设置与回执；CLI flag 的 `accept_edits` 对应 ACP `acceptEdits`。该版未公开 ACP plan，界面和运行前均拒绝规划，不以提示词代替保护。证据见 `doc/qoder-protocol.md`。
- 复用现有 native IO 与桥接边界，Qoder 特有控制、模型及权限确认置于独立 runner。无法确认的恢复、权限或强度在发送前失败，不以无检查的一次性执行兜底。
- 使用同一安装 CLI 的官方 stream-json `initialize → account_info → end_session` 查询网页登录的稳定 userId/organization，通过原生 `qodercli` 只读认证策略读取当前登录，不解析加密凭据或引入 SDK 依赖。私有临时认证描述文件为 0600，内容仅为 `{"type":"qodercli"}`；停止及范围退出确认后删除。PAT 来源按本 CLI 显式变量的摘要绑定，原生 provider 配置及 BYOK 变化进入来源版本；敏感值不返回 Client、不入日志。
- 模型与强度在独立 ACP 元数据进程的新会话读取，逐模型确认公开配置；不发送 prompt。仅关闭并删除本次新建的空目录查询会话，结束后确认进程退出。`--list-models` 是显示名表格，不能据此猜模型 ID。账号与模型查询失败均不回退其他来源。
- 复用 DSH 原生工具桥（仅有明确临时注入能力时启用），额外权限默认拒绝，遵循父会话权限。保留原生保护，不添加操作系统沙箱。
- 图标下载官方站实际使用的透明 PNG，原样本地打包，通过现有单色主题样式处理明暗，不重新绘制品牌。

## Risks / Trade-offs

- [官方文档与发行包能力有差异] → 以官方包探测和测试支持的明确接口为实施依据，记录版本、文档差异及保守限制。
- [缺少登录/模型授权] → 完成离线与模拟验证，真实调用保留未验证，不把目录或退出码当成功证据。
- [已有大量未提交原生迁移工作] → 仅叠加本次 Qoder 接线，保留当前工作树，不回退其他改动；验证用隔离包。
- [平台差异] → argv 数组及现有原生启动器复用，Windows 实机未执行时明确记录。

## Migration Plan

保持 v0.8.1，新增 Qoder ID 与独立 transport，现有 Worker 不变。定向测试、类型检查、隔离构建通过后才考虑无活动任务时更新 Desktop；回退可移除本次 Qoder 接入，保留账号、会话和历史数据。
