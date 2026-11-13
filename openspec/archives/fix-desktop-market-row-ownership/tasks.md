# Tasks

## 1. 调查与候选验证

- [x] 1.1 核对两个宿主的 Loader id、原生设置、包注册及市场归属路径，在 design.md 记录源码与限制。
- [x] 1.2 在指定 scratchpad 验证独立 id 候选的 Desktop 禁用/启用及官方 npm 宿主，检查 HTTP 引导清单并记录设置失败。
- [x] 1.3 增加真实 Loader/SettingsForms 的设置 namespace 回归，运行相关测试并记录结果。

## 2. 设置兼容与产品实现

- [x] 2.1 完成保持 canonical namespace、profile 持久化、实时更新/revision、重置与卸载恢复的适配设计，并用原生设置往返验证；不得只改 namespace 或复制启动配置。
- [x] 2.2 实施完整归属修复并同步 patch、guard 与构建，覆盖无 stock-id inserts、预检接受/拒绝、禁用不影响 stock 的测试。
- [x] 2.3 同步 README/doc/design.md 的实际安装行为；重新运行 typecheck、相关测试和 preview，核验最终产品而非候选副本。

## 3. 最终集成

- [x] 3.1 对最终实现重跑 Desktop A/B 与 npm 官方客户端，检查 native 设置等价、模块来源、页面引导及进程退出。

## Workflow follow-up

- 真实 Desktop GUI、市场热切换往返和 Windows 均未验证，不作为本次隔离验收已通过的范围。已核对隔离验收、同步主规格并归档。
- 版本保持 0.8.2，不提交、不推送、不发布。
