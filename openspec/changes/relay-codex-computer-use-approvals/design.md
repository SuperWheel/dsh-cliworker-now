# Design

## Context

见 proposal.md。现有 `io.approval` 负责长度限制（summary 500、detail 4000）、等待期间暂停空闲时限、Host 邮箱回复以及停止/关闭后的拒绝；`decideApproval` 已实现用户指定的档位语义。Codex 普通 item 审批返回 decision，elicitation 返回 action/content，不能混入 APPROVAL_METHODS。

## Goals / Non-Goals

**Goals:** 在 Codex runner 内识别已核实的应用授权，复用 Host 的权限策略和字面文本呈现，保留 denied 结果语义及真实错误。

**Non-Goals:** 不实现通用表单、URL 登录、永久授权，不缓存应用许可，不变更 Host/Client 公共协议与审批策略，不启动真实账号或模型。

## Decisions

- 在通用失败分支前独立处理 elicitation。严格核对 method、serverName、mode、空对象 schema、元数据、应用和线程/轮次。schema 的非空 required、未知输入约束不视为无输入授权。优先使用 tool_params_display 中 name=app 的非空 value，否则用 tool_params.app；不以 connector_name 冒充应用名。
- 映射为 permission，摘要说明应用，detail 仅包含 message 与 MCP 名称。保留字面文本，交给现有纯文本/Markdown 转义层；不向 Host 或 Codex 回传整份元数据。
- 使用 action/content 原生回复，只在 persist 数组包含 session 且决定为 allow-session 时发 session。非原生能力的会话决定按拒绝处理；不发送 always。
- 同一 elicitation ID 只处理一次。等待审批不阻塞读取；停止、结束、关闭后的回答不回复，既有 abort 仍中断本轮。已启动的发送在结果结算前等待，发送失败标记原生授权回复未送达；不等待已过期的用户回答。finally 标记关闭，使迟到答复不能写已关闭传输。
- 拒绝设置既有 denied 并写诊断，不 markFailure。原生轮次错误、未完成工具、非零退出等仍优先于 denied；输入型 elicitation 保留 -32601 与失败。

## Risks / Trade-offs

- [已知请求来自静态重建而非 Windows 现场帧] → 测试明确标记模拟，Windows 抓帧及 DSH 审批验证保留未完成。
- [CLI 将来扩展输入形状] → 未识别形状继续失败，不推测或放宽授权；真实证据确认后另行支持。
- [停止与回答竞态] → 在发送前再次核对 signal、completed 与关闭状态；重复 ID 不再创建审批。

## Migration Plan

无数据迁移、存储新增或 Desktop 更新。本次不修改版本号。回退仅撤销本次 Codex 授权分支及对应文档，恢复未知 elicitation 的旧失败行为；不改用户会话和凭据。
