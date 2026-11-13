# Design

## Context

见 proposal.md。当前四包基于 rc.2，source.patch 48 文件在 rc.3 仅 skeleton 测试上下文冲突。官方应用显示 be72761，公开 tag 为 1f81c047fc48fa190a683e469daa699857e9afe8。

## Goals / Non-Goals

**Goals:** 完整重编 rc.3 四包并保留已授权扩展；验证 rc.2 兼容，恢复官方客户端。

**Non-Goals:** 不更改业务派遣协议、用户数据、其他插件、版本号，不提交或发布，不进行模型请求。

## Decisions

- 固定 Git checkout 在 .cache，保留 rc.2 历史目录，新增 rc.3 目录；由 builder 导出真实 diff，不采用重新标版本的旧 bundle。
- 39 个 SDK dev pin 同步更新，冻结独立构建依赖与 package.json 摘要；官方 npm Host 与声明保持原始字节，浏览器由源码重编。
- 手工合并 skeleton 测试时保留 rc.3 header hooks 和 commandSource/childImageUploads 断言。
- 独立 cliworker-ui-* 和现有 ConfigEditor.entries 适配继续使用，避免重复注册和设置分叉。宿主仍按接口能力检测；若 rc.2 实测不兼容则明确范围与错误，不能只凭包版本拒绝。
- 应用 build identity 单独调查，不能证明对应关系时如实记录未解析；不伪造 commit。

## Risks / Trade-offs

- rc.3 新 UI 与 rc.2 Host 可能存在能力差异 → 双版本隔离启用/禁用与设置写回检查。
- 正式客户端启动失败 → 预先备份两个 profile 文件，失败恢复并重启。
- 模型及 Windows/Linux 未授权或不在本次环境 → 保留未验证说明，不影响此次仅 UI 升级的验收定义。

## Migration Plan

先依赖及扩展重建、类型检查、回归、preview 与隔离启动，再确认官方插件未加载/无任务，生产构建。仅备份并编辑官方 desktop profile 的 package.json 与 cordis.patch.yml，保留另一不兼容插件注释状态，正常退出并重启官方客户端，核查日志与界面。
