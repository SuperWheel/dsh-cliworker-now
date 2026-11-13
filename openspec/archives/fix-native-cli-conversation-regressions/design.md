# Design

## Context

当前通过完整官方侧栏会话、内部 LLM adapter 与 CLI 原生桥呈现 Worker。`harness-conversation.ts` 的内部模型目录会进入宿主全局目录；Qoder 新接入 ACP，而截图用量为默认零；Grok 是否公开思考须以实际响应判断。

## Goals / Non-Goals

目标是修复三张截图的具体体验和数据归属，保持父子隔离及原生控件。范围不包括宿主核心改动、模型任务自动重跑、未知字段估算补齐、账号配置修改或全 CLI 新一轮真实验收。

## Decisions

1. 内部模型保持精确 `resolveModel` 能力，公开目录不广告 Worker 实例模型；侧栏继续使用既有 `NativeCliModelDirectory`。
2. Qoder 1.1.73 的本次原生 assistant 记录明确隐藏 token 计数，但提供 `context_usage_ratio`。通过精确 session、project、model 及 prompt 的 `userMessageId` / `parentUuid` 链做有界只读读取；以独立 `contextRatio` 映射既有可复现宿主扩展的可选比例元数据，token 数和容量保持未知。全零脱敏回执不再进入真实账单。
3. Grok 截图对应轮次有 21 reasoning token，但没有 `agent_thought_chunk` 或可读思考，只含不应提取的 signature。利用官方 `conversation.chat.turnTail` 扩展点显示准确说明，按 Host-issued 精确绑定和已结束轮次判定；有公开思考时保留原生展开，不制造 reasoning 事件或空工具。
4. 所有补充读取沿用 Host 生命周期和现有 Gateway；Client 复用官方组件，不引入独立统计界面，不改既有用户事件。

## Risks / Trade-offs

隐藏公开模型目录可能影响内部恢复，必须测试 `resolveModel` 与真实子 Agent 运行配置仍有效。Qoder 版本间字段变化须保守接受明确协议数据并保留未知。Grok 没有公开思考时只能解释能力边界，不能保证任意任务都出现思考文本。

## Migration Plan

不修改旧会话、密钥或偏好；先定向测试和 preview，再核对原生渲染及已有真实历史。Desktop 更新只在无活动任务时进行，更新前备份当前构建并核对持久数据。回退使用原构建，原生记录保持可读。未完成的模型、平台或 Desktop 验收明确记录。

## Evidence Boundaries

已存真实运行只读核查能确认截图数据来源，不能证明修复后新任务真实调用通过。Windows/Linux、新模型生成、工具和运行中取消沿整体迁移既有待验收记录保留。
