# Tasks

## 1. 可复核构建输入

- [x] 1.1 核实 39 个 rc.3 registry 包、固定 tag 与应用 build identity，更新 SDK 和锁文件，记录来源及未解析差异。
- [x] 1.2 移植 48 文件补丁、冻结独立依赖和链接清单，四包源码类型检查与关联回归通过，记录 README。
- [x] 1.3 构建并 verify rc.3 四包，重新 vendor；摘要校验及 host-runtime/market 回归通过，保留独立行及设置适配。

## 2. 集成验证

- [x] 2.1 完成插件 typecheck、相关回归及可行的全量测试、build:preview、严格规格与 diff 检查；记录实际结果。
- [x] 2.2 在隔离 rc.3 与 rc.2 宿主验证启用/禁用、页面启动、四包唯一及 ui-chat 设置写回；同步 README/design/tasks 的兼容范围与验证边界。

## 3. 官方客户端恢复

- [x] 3.1 确认官方插件未加载且无活动任务，再生产构建；备份两个 profile 文件并仅恢复 CLI Worker bundle/config。
- [x] 3.2 正常退出及重启官方 app，核查新增日志、窗口及 CLI Worker 面板；失败恢复备份并记录，保留真实模型与其他平台未验边界。

## Workflow follow-up

- 全部必要任务与证据齐备后严格校验、同步规格并归档；否则保留活动 change。主会话审查提交，本次不 commit/push/publish。
