# Proposal

## Why

本机 DeepSeek Harness Desktop 已更新到 0.2.2-rc.5，插件的开发 SDK、随包原生界面和默认构建目标仍为 0.2.2-rc.3。需要将三者对齐到 rc.5，并核实插件在该宿主上的加载、派遣、续聊与停止。范围对应 PRD 需求明细第 1–5 条及第 11 条。[需求 PRD](../../../doc/prd/2026-11-19-v0.9.2-dsh-rc5-names-omp-PRD.md) · [REQ-0138 快照](../../../doc/prd/2026-11-19-v0.9.2-REQ-0138.md)

## What Changes

- 固定 rc.4、rc.5 的 npm 发布来源和官方 tag，核对 rc.3 → rc.5 的源码及已安装 npm 包差异，按结论处理实际影响插件的兼容性变化。
- 将 39 个 `@deepseek-ai/dsh*` 开发依赖精确锁定到 0.2.2-rc.5，同步锁文件和 workspace 发布期限例外。新增 rc.5 构建目标并设为默认 vendor 目标，保留旧目标的校验路径。
- 在固定的 rc.5 源码上迁移现有 48 文件补丁，冻结独立构建依赖，重建 `ui-session`、`ui-conversation`、`ui-subagent`、`ui-chat` 并更新 `runtime-host/`。
- 复核构建、回归、隔离 Web 宿主和 Desktop 的加载与核心流程。同步中英文 README、设计文档、原生会话宿主扩展协议文档及 `runtime-host/README.md` 中的当前适配版本。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `package-distribution`：随包原生界面及默认构建目标对齐 0.2.2-rc.5，按实际证据声明宿主兼容范围。

## Impact

涉及 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、宿主目标及构建和 vendor 脚本、`host-extensions/`、`runtime-host/`、相关测试及文档。Host 与 Client 继续通过原生 Gateway、Remote 和 Cordis 扩展点接入；业务代码仅在查出与插件有关的破坏性变化时做必要的兼容适配。预构建包沿用既有的官方 profile 安装入口。

## 成功指标（基线、目标）

| 指标 | 基线 | 目标与核对方式 |
| --- | --- | --- |
| SDK 与随包资源 | 39 个开发依赖、默认 vendor 目标、四个随包界面均为 0.2.2-rc.3 | 全部对齐 0.2.2-rc.5。冻结安装通过，非 DSH 锁文件包集合与基线一致，构建和 vendor 校验通过 |
| 回归 | 升级前同一基线提交的 macOS 通过、跳过及失败数待采集 | 升级后全量 Vitest 零失败，通过数不少于基线。类型检查、lint、格式检查和四包补丁前后对照验证符合 PRD |
| 宿主运行 | rc.5 的插件加载及核心流程待验证 | 隔离 Web 和 Mac Desktop 加载通过，真实派遣完成并沿用同一会话续聊，停止后核实 Worker 进程退出 |

## 范围外

Agent 名称同步与页头名称覆盖、「调用 DSH」原生子 Agent 派遣及分组标题、OMP 其他服务商表单分别由同版本的其他变更负责。rc.4/rc.5 新增的联网搜索路由、内容安全拒答和 liveshare 功能接入，以及 0.2.2 正式版适配，均另行处理。Windows 实机仅按用户安排做基础加载与派遣检查。GitHub 推送、npm 或 Release 发布按 v0.9.2 发布授权另行执行。
