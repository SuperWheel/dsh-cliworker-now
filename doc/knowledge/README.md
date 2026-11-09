# CLI Worker 实现知识库

本库按“一篇解决一个问题”整理插件的接入方法、性能优化和实现原理，供新增 CLI、排查问题及维护代码时复用。当前共 **38 篇原子笔记**，分为四类。

核对基线：**2026-10-18，当前工作区 v0.8.1 源码与有效规格**。这表示文档的源码核对时间，不表示全部 CLI、账号和平台已完成实机验收。具体结果查看[实际验证记录](../tasks.md)。

## 1. 分类索引

| 分类 | 内容 | 建议读者 |
| --- | --- | --- |
| [CLI 接入 · 11 篇](cli-integration/README.md) | 图标、注册、协议、原生数据、账号模型、地址发现及跨平台启动 | 新增或升级一个 CLI 的维护者 |
| [性能优化 · 10 篇](performance/README.md) | 目录与展示缓存、预热调度、失效、离页保存及竞态处理 | 处理加载慢、切换卡顿和偏好回退的维护者 |
| [架构原理 · 11 篇](architecture/README.md) | Host／Client、原生会话与工具桥、过程、遥测、调度及存储 | 需要理解整条执行链路的维护者 |
| [验证与交付 · 6 篇](verification/README.md) | 证据层级、最小验收、平台边界、隔离构建和文档分工 | 实施验收、安装或准备发布的维护者 |

## 2. 按问题查找

| 问题 | 入口 |
| --- | --- |
| 接入新 CLI 从哪里开始、哪些环节容易漏 | [新 CLI 接入流程](cli-integration/new-cli-onboarding.md)与[接入索引与核对矩阵](cli-integration/README.md) |
| 国内版与国际版是两个 CLI 还是同一个 CLI | [形态判定](cli-integration/new-cli-onboarding.md#12-国内版与国际版的四种形态) |
| CLI 图标、颜色和品牌资源放在哪里 | [品牌图标接入](cli-integration/brand-icons.md) |
| 应选 ACP、RPC、app-server 还是 HTTP／SSE | [按原生能力适配通信](cli-integration/native-transports.md) |
| 从哪里接登录、模型、用量和上下文 | [原生数据接口](cli-integration/native-data-interfaces.md) |
| 终端能找到 CLI，Desktop 却显示未安装 | [可执行地址发现](cli-integration/executable-discovery.md)与[跨平台启动](cli-integration/cross-platform-launch.md) |
| 模型目录如何避免每次重新查询 | [Host 已验证目录缓存](performance/host-catalog-cache.md) |
| 首次打开设置如何预热全部已启用 CLI | [有界预热队列](performance/bounded-prewarm.md) |
| 关闭后重开设置为什么能直接显示 | [Client 完成结果缓存](performance/settings-display-cache.md) |
| 哪些变化必须使缓存失效 | [缓存失效与来源隔离](performance/cache-invalidation.md) |
| 选择模型／强度时如何减少保存卡顿 | [设置页草稿与离页保存](performance/settings-draft-on-leave.md) |
| 保存慢、快速重开或旧回执晚到怎么办 | [写入顺序](performance/preference-write-order.md)与[读取回执水位](performance/preference-read-receipt.md) |
| 对话窗口究竟何时保存模型与强度 | [会话选择与发送前校验](performance/conversation-selection.md) |
| 积分、token、上下文或未公开数据如何展示 | [遥测口径](architecture/telemetry-semantics.md)与[逐轮归属](architecture/turn-usage-attribution.md) |
| 如何复用原生对话和工具 | [原生会话投影](architecture/native-session-projection.md)与[工具桥](architecture/authorized-tool-bridge.md) |
| 怎样保证任务互斥、停止与恢复 | [调度锁](architecture/scheduling-locks.md)与[停止恢复](architecture/stop-and-recovery.md) |
| 为什么主对话不能混入 Worker 模型 | [模型目录隔离](architecture/model-catalog-isolation.md) |
| 改完以后做到什么程度才算通过 | [证据层级](verification/evidence-levels.md)与[最小验收](verification/minimal-acceptance.md) |
| Mac 构建能否代表 Windows Desktop 通过 | [跨平台验证边界](verification/cross-platform-evidence.md) |
| 如何安全更新已安装的 Desktop 插件 | [隔离构建与更新](verification/isolated-build-and-desktop.md) |

## 3. 三种选择与保存时机

| 场景 | 选择时 | 后续触发点 |
| --- | --- | --- |
| 设置页的项目默认模型／强度 | 只更新本地完整草稿 | 离开当前 CLI 页或触发设置页关闭时后台保存；包含点叉、点击外侧、Esc 及卸载路径 |
| 已有 Worker 对话的模型／强度 | 按原账号绑定的已验证目录检查，立即保存该 Worker 的偏好 | 实际发送前再实时校验账号、模型、强度与执行路由 |
| 打开、刷新或重开目录 | 读取和展示目录／偏好，不因展示自动选型 | 只有用户明确选择才产生偏好修改 |

**“对话选择后不保存、发送才保存”尚不是当前实现。** 当前优化减少的是选型时的原生查询；项目默认值的离页保存与 Worker 偏好是不同路径。详见[会话选择](performance/conversation-selection.md)，不要将其写成已上线的延后落盘机制。

## 4. 阅读与维护

- 每篇保留核心结论、实现机制、边界及源码／测试入口；通过文末关联笔记继续阅读。
- 新增主题先放入对应分类，在分类索引登记；常见问题同步到本页。
- 行为发生变化时同步有效规格、用户说明和相关笔记；实际命令及结果记录在 `doc/tasks.md`。
- 本库解释当前方法，完整协议、历史调查和逐次验收留在[原文档](../README.md)，避免重复维护报告数字。
- 文内源码与测试链接是定位入口，不能单凭链接存在认定测试已运行；尚未公开、估算、模拟和实机分别标注。

[返回文档索引](../README.md) · [返回项目 README](../../README.md)
