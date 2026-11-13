# Design

## Context

问题和源码证据见 proposal.md。AGY result 是上游汇总，不能独立证明本轮失败来自旧错误。当前 Worker 没有冲突终态；宿主 jobs 仅支持 completed/failed/killed。遥测已分 response/session，时间线已有本轮 user/status 计时。

## Goals / Non-Goals

**Goals:** 保留本轮输出，谨慎暴露汇总冲突，去掉完成空块且保留统计；版本固定 0.7.9。

**Non-Goals:** 不修补上游 CLI、不根据文字/文件存在推断完整成功、不自动重试、不改原生参数或权限、不写用户历史日志、不做真实模型调用和发布。

## Decisions

- AGY parser 跟踪本轮已观察步骤和错误证据，输出本轮文本及冲突资格；runtime 只在续聊、退出成功和完整清理后采用 uncertain。明确错误、未知/未终止步骤及缺少非空 DONE 回复排除资格。仅比较历史 error 字符串不能证明污染，故不作成功判据。
- 为 Worker 增加 uncertain 终态，持久化 schema、时间线、Client 标签/异常筛选同步。job 外层保守 failed，结果内提供 uncertain、response、error 和核查/不要自动重试说明；不借宿主 completed 掩盖不确定。
- 先保留本轮回复再检查失败；ERROR 汇总不覆盖已有 streamed 文本。新轮清空旧 lastResult；其他 CLI 原有成功规则保持。
- 空回复仅 Client 抑制 article，原数据继续供过程区展示短统计行；活动空回复不滤掉。latestReply 复用可见性规则，保留 user/tool 和分页边界。
- 遥测按 step_index 更新步骤用量与报告耗时；上游累计耗时显式独立展示，本轮时长仍用本地 user/status。无新的累加行为。

## Risks / Trade-offs

- [未知 AGY 协议] → 保守失败/待核实，不猜错误出处；合成协议证据不等于 Windows 真实调用验收。
- [宿主 job 不支持 uncertain] → 外层保留 failed，结构化结果和详情明确冲突与禁止自动重试，Client 使用独立准确状态。
- [新终态与旧版回退] → 只增新枚举，无批量历史迁移；旧版不识别 uncertain，回退前需保留新版本私有数据，不删除会话。
- [隐藏统计] → 在过程区保留每条空回复统计，回归重复回执、累计值及历史分页。

## Migration Plan

先最小回归、类型检查、隔离 preview 和实际渲染；本轮不覆盖正式 Desktop 链接。正式 GitHub 提交获准后以 0.7.9 做全量验收，再进行安装/分发流程，保留未验证边界。
