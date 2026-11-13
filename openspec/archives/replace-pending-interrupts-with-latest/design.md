# Design

## Context

参见 proposal.md。当前插队把消息继续留在 FollowupQueue，停止和准备会将其改为 paused；Client 依赖临时隐藏且仅允许一个插队。普通队列准入的 user 事件直到 runtime.submit 才生成，无法保存更早被取消的插队历史。

## Goals / Non-Goals

**Goals:** 每次点击立即转移展示和请求所有权；Host 保证连续插队后一次优先，并保留未执行取消消息；停止清理、权限及同会话互斥持续有效。

**Non-Goals:** 不取消普通未选队列，不伪造已执行或原生接收，不将已取消文本拼入最新 prompt，不改设置或原生 CLI 协议。

## Decisions

1. 新增 interruptMessage(parentSessionId, workerId, prompt, requestId, clientId, sequence, signal)，立即持久受理并返回 JSON {messageId, revision, state}，停止和准备由 Host 后台协调。稳定 requestId 复用原 queue ID，本地排队未回执也可以调用；卡片与运行中输入框插队使用同一入口，旧入口兼容包装同一协调器。
2. 当前 Panel 产生 clientId 与点击递增 sequence，Host 按 Worker 和来源保存已见最大顺序。旧请求晚到时保存 superseded 历史但不能取代更新请求，跨来源按 Host 接收顺序。重复 requestId 幂等且核对正文，迟到 queue 请求不能重建已转移消息。
3. 新增持久 submission 事件表达本地提交意图，区别于原生 user；fold 为稳定用户气泡。可见字段 queuedFollowupId、deliveryState（pending/admitted/running/superseded/cancelled/failed/completed）、deliveryError、admittedRunId。原生 user 事件按 requestId 去重，取消/失败不伪造原生运行。关闭重开和重启能恢复记录；重启不自动重发未完成意图。
4. 每 Worker 仅一个执行协调器，新请求取消前一个尚未 spawn 的准备或等待任务，并等待真实清理。已经 spawn 的旧轮按正常停止处理；只允许当前最新有效请求进入下一次 spawn。旧任务迟到 catch/finally 只结束自身，不得暂停最新请求或复活旧请求。
5. Client 每次点击即建立或转移 priority 记录，不依赖旧 run 快照或等上一个插队完成。原本地 queue 请求作为独立记录退役，迟到回执不能改变新记录或草稿。前一条未执行 priority 显示已被后续插队取消；错误和不确定状态留在聊天，不再恢复卡片。
6. 复用现有稳定 ID 退场组件、主题与单按钮；正常消息无发送中文字。停止、拒绝和网络未知仍提供真实状态与操作出口。

## Risks / Trade-offs

- 连续点击及异步授权乱序 → 来源顺序号、稳定请求身份、Host 最新指针联合校验，回归覆盖 A/B/C 乱序。
- 停止与新请求竞争 → 显式停止取消其时已受理的请求；同一侧栏后续点击立即展示，RPC 等该次停止回执后发出，避免停止请求晚到误取消新消息；跨来源按 Host 接收顺序，均等待清理。
- 原生准入早于真正执行 → 区分 admitted 与 running，spawn 前取消不描述为已经执行。
- 提交事件与原生 user 双重展示 → fold 按稳定请求 ID 合并，历史与分页覆盖真实回归。
- 关闭窗口或重启 → durable 记录保留；未完成请求转可核对终态，不能后台自动重发。

## Migration Plan

新增可选事件字段及 submission 类型，兼容既有事件和普通队列；无用户配置迁移。先关联测试与 preview，再确认无活动任务/账号终端后更新 Desktop。保持 v0.7.9，无 GitHub 提交；回退不得删除新增的用户历史。
