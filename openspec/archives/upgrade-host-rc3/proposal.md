# Proposal

## Why

官方客户端已升级 Harness 0.2.1-rc.3，而当前 runtime-host 仍基于 rc.2。旧 conversation 缺少 rc.3 的视图动作与草稿初始化语义；需完整重编四包并恢复官方客户端加载。

## What Changes

- 从固定官方 rc.3 tag 重建四包、冻结补丁及依赖，升级 39 个开发 SDK pin，插件版本保持 0.8.2。
- 保留独立 cliworker-ui-* 行与原生设置适配；保留 rc.3 的 header views.actions、草稿 append/replace/keep 和提交快照字段。
- 在隔离 rc.2/rc.3 宿主核验启用、禁用、唯一模块与设置编辑后，构建并恢复官方客户端；失败则回退 profile。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `package-distribution`: 随包原生 UI 升级保持目标宿主原生行为与可复核来源。

## Impact

涉及 package.json/锁文件、构建与 vendor 脚本、host-extensions、runtime-host、回归测试及说明文档。Host/Client 业务协议不新增；不调用模型、不派遣任务、不触碰 DSH Desktop、凭据或既有会话。不提交、推送或发布。
