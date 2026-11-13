# Design

## Context

动机见 proposal。现有 Host 持久队列有防重复 requestId、runId 校验、进程清理及发送前再次授权；输入框已有单按钮。高级设置由 `CliExecutableSettings` 统一折叠。Pi/OMP RPC 原生支持 `{id,type:'steer',message}` 并返回匹配 id 的 success 回执；当前 Host 与 terminal bridge 均封闭 stdin，不能直接写入运行进程。

## Goals / Non-Goals

**Goals:** 三种方式行为明确，按项目与 CLI 保存；引导通过可确认原生控制通路；插队复用现有停止、续聊和队列保护。

**Non-Goals:** 不猜测其他 CLI 的实时能力，不暴露任意终端输入，不改变原生权限，不声称引导立刻被模型执行，不改版本及安装。

## Decisions

- 共享能力表限定 Pi/OMP；项目与 CLI 的发送方式单独保存，避免模型偏好与全局启用开关互相覆盖。设置使用现有 md Button/Menu 和统一行布局；待发送标题下使用主题分隔线，列表复用高级设置的 220ms 高度与 180ms 透明度动效、inert 和减少动态效果处理。
- `sendRunningMessage` 在 Host 读取当前偏好后分流，Client 不提供可信模式；snapshot 返回显示所需模式。队列卡片通过独立的插队入口，不受默认方式影响。
- Pi/OMP launch 暴露 `steer(message,requestId,signal)`，私有请求目录中的受限控制通路只接受 steer，绑定本次运行和随机凭证，匹配原生回执。保留现有进程树管理，不采用模拟终端键盘。回执拒绝只影响该条消息。
- 插队先持久保留消息，阻止自动派发竞争，等待现有 stop 完整清理，再将目标置首并明确激活；保留其他消息原先暂停状态。逐 Worker 锁和停止代次阻止显式停止后重新启动。正常下一轮仍走现有 Host launch，再检查账号、模型及权限。
- 原生引导成功追加 user 事件，保持 runId 和 conversationId；请求重试去重。断线或超时不自动换模式，避免重复执行。

## Risks / Trade-offs

- [原生回执与结束竞争] → 控制通路随运行关闭；只以匹配回执确认接收，测试拒绝、重复、退出和清理。
- [取消等待期间权限或账号变化] → 新轮复用 launch 授权及最终运行前守卫；引导绑定当前活动任务并复核权限。
- [停止会改变部分原生任务进展] → 设置说明明确插队先停止本轮；未收到原生会话 ID 时拒绝插队并保留文本。
- [仅模拟验证] → 记录实际验收边界，不将回执模拟当真实模型执行。

## Migration Plan

缺少新设置时按 CLI 能力默认；原队列格式兼容。回退旧构建可继续读取既有 Worker 与队列，新设置文件可忽略。版本保持 v0.7.9。
