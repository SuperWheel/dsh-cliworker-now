# Proposal

## Why

用户报告 v0.8.7 的 Pi/OMP 账号退出失败，以及智谱等原生登录方式缺失。`account-guide/providers.ts` 维护不完整的固定表，`omp-flow.ts` 的退出行解析只覆盖 16.x 无边框画面；Pi 退出通过完整会话与 InteractiveMode 执行，Windows 失败原因仍需用安装代码与隔离复现核对。

## What Changes

- Pi/OMP 登录列表从当前安装的原生接口读取，保留原生 ID、别名和平台差异；明确国内智谱 BigModel 与国际 Z.AI。
- 修复逐条退出与结果核对，OMP 仅删除指定来源、provider、凭据 ID；Pi 使用原生 SDK 退出及回读，不依赖无关交互会话初始化。
- 保留添加/替换语义：新凭据原生保存确认后才退出指定旧凭据；退出失败必须可见。
- 对照其余 CLI 登录入口，记录遗漏与能力边界；同步中英文、README 和设计。

## Capabilities

### Modified Capabilities

- `cli-connection-health`：补充安装驱动的登录选项与 Pi/OMP 精确退出契约。

## Impact

Host 账号桥、流程识别、登录选项发现，Client 服务商显示及 i18n，相关测试和文档。新增辅助文件须纳入 preview/release 构建。无新增依赖或账号迁移。

## Out of Scope

不改模型目录认证错误展示或多凭据交集规则；不读取密钥值、不改真实凭据、不安装软件、不重启 Desktop、不推送。Windows 此阶段只读诊断；主会话之后可安装预览包并只退出 OMP plugin `zhipu-coding-plan / id=1 / created_at=0`，保留 id=2 和其他账号。本阶段不执行该验收。
