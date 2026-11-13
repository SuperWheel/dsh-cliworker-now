# Proposal

## Why

用户的四张 Desktop 截图显示 Qoder 用量入口缺少可用数据、Grok 与 OMP 完成行无法展开、Hermes 缓存命中缺失，并指出 OMP 的 OpenAI 订阅模型目录未跟进。现有 `harness-grok-process-note.tsx` 的额外正文说明不符合本次要求；原生能力和缺失数据必须分别核查，不能补造统计或思考。

## What Changes

- 删除 Grok 未公开思考的正文提示；核对 Grok/OMP 原生公开过程的实时与历史映射，修复有证据的丢失并保留原生展开体验。
- 追踪 Qoder 用量与 Hermes 缓存的原始来源；修复能证实的采集/显示缺口，未知数据保留明确状态与可查看入口。
- 修复 OMP 的旧模型候选过滤新账号目录问题，按当前账号及原生执行器能力补全真实模型元数据，保留偏好与账号隔离。
- 关联回归、类型检查、隔离构建与渲染验收后，在空闲时更新 Desktop；版本维持 v0.8.1。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `worker-conversation-interaction`：公开过程边界与缺失用量/缓存入口。
- `cli-model-discovery`：OMP 订阅目录的新鲜度、当前账号范围和执行能力一致。

## Impact

涉及原生 Client 集成、Host 原生数据归一化及 OMP 模型发现。按现有独立宿主扩展机制改善原生组件，不修改 Harness 上游核心或现有用户 skill。会话、模型偏好、账号和原始历史保持；不推送、发布或增加版本，不以本次目录/模拟验收冒充真实模型生成与 Windows 验证。
