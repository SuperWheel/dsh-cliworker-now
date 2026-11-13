# Design

## Context

现有 Client 依据 Worker 上一轮状态与临时 RPC 路径决定展示；Host 准备集合已存在但没有完整投影，队列一条 paused 会影响新增条目。原生协议 Worker 持久绑定 transport，本轮继续沿用原会话、账号/项目校验和受管进程清理。动机见 proposal.md。

## Goals / Non-Goals

**Goals:** 在点击、Host 受理和原生启动三个边界保持稳定消息身份；让停止只影响之前提交并保持旧队列暂停；以实际原生回执确认当前运行引导。

**Non-Goals:** 不把普通追加会话或下一轮执行当引导，不新增 Harness 核心能力或 OS 沙箱，不替换用户模型/账号，不改写正文空白，不发布新版本。

## Decisions

1. Client 使用 Worker 局部的同步引用登记占用及消息 ID，冻结 mode/intent/presentation；Host 的 selectedBusy 投影包含 reservation、prepare、task、priority 和清理。只靠异步 running 状态无法覆盖连续点击窗口。
2. 新增兼容 Gateway submitMessage JSON 入口，携稳定 ID、来源顺序、固定模式及 direct/running 意图。第一处 await 前登记可取消 reservation，后续 parent/项目/账号/权限重新校验。直接续聊也按 ID 对账；保留旧 Remote 作为兼容入口。
3. Host 私有提交代际在主动停止时切换，旧 reservation/prepare/dispatch/finish 只能作用其所属代；Client 的 stop barrier 取消此前未执行操作，之后新操作可立即显示但等待清理。普通队列按条目保留暂停，调度最早可运行 pending，旧 paused 不阻断新一轮也不自动恢复。
4. 普通队首准备仍是卡片，只有原生 spawn 准入才写精确 ID 的用户事件并移出队列。插队在点击时移到消息，Host 持久接受最新请求；以 spawnAttempted 区分未执行取消和必须停止的原轮。
5. 引导由独立 Client 方法、`steerMessage` Gateway 与 Host 当前轮方法接入，不经过普通提交的 predecessor/stopBarrier 或队列调度；旧 paused 或等待排队回执不阻止当前轮原生引导，目标结束明确拒绝而不迁移新轮。复用私有控制邮箱，为已确认支持的 native runner 实现 steer 方法；绑定 run/session/turn 和 requestId，缓存原生明确 receipt，拒绝和未知不混同。原生没有幂等键时桥端先登记一次投递，未知不自动重发。只有当前协议确证支持才启用，历史 transport 独立判定。
6. 发送设置持久格式增加本次能力迁移版本；Host 启动在私有目录一次性将旧项目发送设置按能力重置，后续手动设置写新版本并保留。打开设置仍只读，不启动 CLI；模型、强度与账号不参与迁移。
7. 模型与强度在仍有待发送项（包括暂停项）时禁止更改，先要求发送或取消旧卡片，避免改变已有消息选型；发送方式仍可独立更改且冻结于新点击。当前不拆分每条消息与 Worker 的模型偏好。
8. 用户消息容器占布局行，正文独立 fit-content；时间/复制与异常反馈不决定正文宽度。正常发送/替换/停止无尾部提示或空占位。沿用原生主题、队列退场/补位及 reduced-motion。

## Risks / Trade-offs

- [RPC/快照乱序] → 消息 ID、水位及准入身份对账，未知不重投，展示去向不因回执改变。
- [迟到停止取消新轮] → Host 代际和 Client stop barrier；回归覆盖准备、spawn 及清理交叉。
- [CLI 双向输入被误判引导] → 官方与安装版证据、逐 CLI 原生 fixture、同 run 回执与最小真实验收分开记录。
- [已有设置被反复覆盖] → 用户已授权的一次性格式迁移，之后人工选择保持优先；异常文件拒绝，不覆盖账号和历史。
- [真实账号或 Windows 缺口] → 原样记录阻塞，不将模拟 fixture/目录/ACK当模型已经执行。

## Migration Plan

先用隔离状态回归新队列/设置与协议控制，再完成类型检查和 preview 渲染；确认正式 Desktop 无活动任务后构建并冷启动，核对历史保留与实际消息。保持 v0.7.10，不推送发布。回退保留历史 transport、消息 ID 与暂停记录，新 schema 可读取旧队列，旧客户端入口继续兼容；不以回退触发自动重投。

版本归属补充（2026-10-16）：用户明确将本次原生协议迁移、排队与独立引导改动及下一次正式提交前的调整归入 v0.7.10；此前验收时实际构建的 v0.7.9 及原始哈希证据保留，不表示已发布 v0.7.10。
