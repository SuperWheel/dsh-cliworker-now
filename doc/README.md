# 项目文档索引

按目的查阅文档。需要理解一个方法时先读原子笔记，需要协议细节或实际验收结果时再进入专项文档。

## 1. 方法与实现原理

| 入口 | 内容 |
| --- | --- |
| [原子笔记知识库](knowledge/README.md) | 新 CLI 接入、性能优化、架构原理、验证交付的总索引 |
| [CLI 接入](knowledge/cli-integration/README.md) | 图标、协议、原生数据、账号、模型、地址发现与平台适配 |
| [新 CLI 接入流程](knowledge/cli-integration/new-cli-onboarding.md) | 接入一个新 CLI 的完整步骤、改动文件、国内版与国际版形态判定及验收清单 |
| [产品需求文档](prd/) | 各版本 PRD，如 [v0.8.8 新 CLI 接入](prd/2026-11-07-v0.8.8-PRD.md) |
| [性能优化](knowledge/performance/README.md) | 目录缓存、预热、失效、延后保存与回执排序 |
| [架构原理](knowledge/architecture/README.md) | 原生会话、工具桥、公开过程、遥测及生命周期 |
| [验证与交付](knowledge/verification/README.md) | 最小验收、平台证据、隔离构建与规格维护 |

## 2. 当前约束与历史记录

| 文档 | 职责 |
| --- | --- |
| [项目规则](../AGENTS.md) | 开发边界、权限与交付要求 |
| [OpenSpec 开发指南](openspec.md)及[主规格](../openspec/specs/) | 变更流程与已管理的行为契约 |
| [设计与版本演进](design.md) | 完整架构和历史决策，按版本核对 |
| [实施与实际验证](tasks.md) | 本次命令、失败、最终结果及未验证范围 |
| [历史版本与详细配置](version-notes.md) | 历史用户行为与配置说明 |

长文档可能同时保留早期方案、候选和后续修复。当前机制以源码和有效规格为依据；实际通过范围以对应日期的最终验收记录为依据。

## 3. 专项设计与接口

| 主题 | 文档 |
| --- | --- |
| 通信 | [原生协议总览](native-protocols.md)、[运行中发送](running-message-protocol.md) |
| 原生会话与工具 | [完整会话界面](native-conversation-ui.md)、[宿主接口扩展](native-conversation-host-extension.md)、[Harness 工具桥](native-harness-tools.md)、[附件与 Skill/MCP 矩阵](cli-harness-capabilities.md) |
| 设置与角色 | [设置设计规范](settings-ui-design.md)、[角色预设](role-presets.md) |
| 过程与遥测 | [公开过程](public-process.md)、[原生回复与上下文](native-inspection.md)、[逐轮用量](native-turn-usage.md) |
| 数据接口核查 | [全 CLI 数据审计](cli-native-data-audit.md)、[ACP 数据接线](cli-usage-audit-acp.md)、[HTTP／RPC 接线](native-http-rpc-audit.md)、[原生接口补充](native-http-rpc-data-interfaces.md)、[Kimi 计费用量](kimi-durable-usage-audit.md) |
| 原生视图对齐 | [十 CLI 对齐记录](ten-cli-native-parity.md)；标题保留当时范围，不代表当前 CLI 总数 |
| 外部经验 | [Codingns4DSH 核查](codingns-reference-audit.md) |
| Windows | [远程测试](windows-remote-testing.md)、[ConPTY 来源核验](windows-conpty-source.md) |
| 发布 | [Release 模板](release-template.md)、[dshfind 同步](dshfind-sync.md) |

## 4. CLI 专项调查

[Qoder](qoder-protocol.md) · [Hermes](hermes-probe.md) · [Pi／OMP](pi-omp-probe.md) · [OpenCode](opencode-probe.md) · [ZCode](zcode-probe.md) · [Grok](grok-probe.md)

[旧 Harness CLI 记录](harness-probe.md)属于历史执行器；不要与 DeepSeek Harness 宿主或当前 Hermes Agent 混用。

[返回项目 README](../README.md) · [进入原子笔记](knowledge/README.md)
