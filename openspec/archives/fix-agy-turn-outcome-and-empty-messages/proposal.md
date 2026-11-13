# Proposal

## Why

GitHub #1 报告 AGY 续聊的本轮 DONE 回复和工具结果被跨轮 ERROR/EOF 汇总掩盖；`runtime.ts` 在保存回复前抛错，`foldEvents` 还可能用汇总正文覆盖流式正文。#2 报告已完成但无正文的 assistant 步骤仍生成完整聊天块，悬停仅有用量和时间。

## What Changes

- 保存本轮实际回复与独立错误证据，保守区分本轮失败、取消、进程退出失败与 AGY 续聊的汇总状态冲突；冲突显示结果待核实，不推断任务成功，也不自动重试。
- 完成的空回复移入可展开过程，保留 Token、时间及公开工具事件；活动输出与有正文回复保持可见，末条回复功能条跳过隐藏空步骤。
- 保留本轮本地计时，明确上游累计指标，不将累计与步骤统计相加。
- 开发版本定位 v0.7.9，GitHub 正式提交前不再升号；日常只做最小验收，全量验收留到获准的正式 GitHub 提交之前。

## Capabilities

### New Capabilities
- `worker-run-outcomes`: 本轮结果、失败与上游汇总冲突的证据和终态契约。

### Modified Capabilities
- `worker-conversation-interaction`: 已完成空消息展示、过程统计及末条消息功能条。
- `development-workflow`: v0.7.9 开发版本冻结及正式 GitHub 提交前全量验收。

## Impact

Host AGY 协议、运行收尾、存储及 job 输出，共享状态/时间线/遥测和 Client 状态及对话渲染。增加终态需兼容存储恢复、筛选和过程计时，不改变 CLI 参数、账号、权限或进程清理。用户现有历史只读展示，不重跑任务、不迁移原始会话日志。仅模拟协议回归、必要类型检查、隔离 preview 与实际渲染核对；Windows 实机、真实模型、Desktop 安装和发布保持未验证/未执行，不上传个人日志。
