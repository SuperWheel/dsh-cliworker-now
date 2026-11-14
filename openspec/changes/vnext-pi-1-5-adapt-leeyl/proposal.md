# Proposal

## Why
本机 Pi 已升级为 1.5.2，但安装检查与更新兼容名单只允许 1.0.2、1.0.4、1.1.0（`src/host/pi-installation.mjs`、`src/host/cli-management/versions.ts`）。需要核对本机两个版本的原生接口后支持新版本，不能仅放宽版本范围。

## What Changes
- 安装、发现、登录和更新检查共用显式支持版本数据，新增 1.5.2，保留旧版本。
- 核对 RPC、扩展权限、模型、登录、会话、统计和 managed 安装；处理实际影响插件的差异。
- 补标明模拟的双版本回归，并提供隔离环境下无 prompt、无模型调用的真实探测。

## Capabilities
### New Capabilities
无。
### Modified Capabilities
- `worker-dispatch`：Pi 原生安装版本准入与身份一致性。

## Impact
Host 安装识别、更新兼容检查和 Pi RPC 桥，以及相关模拟测试、README、设计文档。共享协议及 Client 无计划改动，不改依赖或插件版本。

## 成功指标（基线、目标）
基线：1.5.2 被身份检查拒绝。目标：四个明确支持的版本通过同一准入表；未知版本拒绝；1.0.4 与 1.5.2 模拟回归通过；本机 1.5.2 无模型 RPC、扩展、目录和会话列表探测退出可核查。

## 范围外
不提交、不推送、不更新 Desktop，不修改主 worktree、真实账号或会话。不登录、不调用模型，不访问外部服务。真实模型与 Windows 原生执行保留验收边界。
