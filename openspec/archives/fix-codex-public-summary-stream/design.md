# Design

## Context

见 proposal.md。codex-host 的 `app-server-host.ts` 转发原生通知，没有从 `turn_context.summary` 判断是否有正文。安装中 Codex 0.162.1 与本机模拟服务的三项验证确认：实际请求包含 `summary:auto`，流式及最终摘要进入当前适配器，空摘要不生成事件；三项 rollout 均记录 `summary:none`，该字段不能用于否定请求。

## Goals / Non-Goals

**Goals:** 当前原生 Codex 的公开增量及时进入现有原生 reasoning block，完成去重，停止或失败保留前缀。

**Non-Goals:** 不增加摘要请求重试、不更换模型或强度、不读取 raw reasoning、不移动面板、不补写旧历史；不修改网络代理和账号配置。代理调整仅用于私有隔离模拟服务。

## Decisions

- 扩充 Host 已验证公开增量生产者白名单：同时检查当前 run、CLI 为 Codex 和 transport 为 `codex-app-v1`。其他协议继续完成后展示；不能对所有 reasoning 快照开放。
- 延续 native-codex 的公开字段过滤与按段累计，不变更请求参数。原生流的单调性检查、结束保存和生命周期继续复用。
- 用实际安装 CLI + 无凭据、本机模拟服务验证请求与接收，再用真实 Harness AgentLoop 的定向合成事件测试检查生成时和终态行为。模拟不等于真实订阅模型会输出摘要。

## Risks / Trade-offs

- [模型不输出摘要] → 继续无入口、不补造，真实问好轮次仍无公开内容。
- [其他来源可撤回快照] → 保留 CLI、transport、run 白名单及相关反向测试。
- [摘要后异常结束] → 保存实际公开前缀，不声明整轮成功。

## Migration Plan

关联测试和隔离 preview 后，只有 Desktop 无活动任务时才更新本地链接产物；不改用户历史或独立 Web 进程。回退仅恢复上版构建产物，无数据迁移。真实模型和跨平台未验证边界保留在验收记录。
