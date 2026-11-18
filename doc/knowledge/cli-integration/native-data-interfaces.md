# 原生数据接口与任务通道分开接入

任务协议、账号接口、目录接口与统计接口分别核实，不能因为任务能回复就假定全部原生数据已经接入。

## 1、机制与实施要点

建立逐字段来源表：真实字段、CLI/版本、精确会话或请求身份、统计范围、是否估算、缺失时处理。可用来源包括同进程 RPC、原生 HTTP、官方元数据接口和精确绑定会话的持久记录。

当前实现中，Qoder 执行走 ACP，账号与目录走官方元数据路径；OMP 在确认 builtin 和非 Agent 回执后读取 `/context`；OpenCode 读取同 session 原生 counter；Kimi 的账单另有持久记录观察。这些方式各有身份、完整性和副作用约束，不能跨 CLI 复制。

采集后经白名单投影到共享结构：每响应、本轮、会话累计、当前上下文分别保存；积分单独标记单位。模型展示使用实际观察的 `CLI/提供方/模型`，提供方缺失则标“未公开”。

## 2、易错边界

累计账单不是上下文占用；压缩后的活动消息统计不一定是历史总账；默认零不是已报告零。元数据查询可能写原生缓存、联网或启动界面，接入前要核实；查询失败也不应伪造指标或改变已完成生成结果。

## 3、源码与验证入口

- [数据来源总审计](../../cli-native-data-audit.md)、[HTTP/RPC 数据接口](../../audits/native-http-rpc-data-interfaces.md)。
- [Qoder 元数据查询](../../../src/host/qoder-accounts.ts)。
- [原生本轮用量契约](../../../src/shared/native-turn-usage.ts)、[模型显示归一化](../../../src/shared/native-model-display.ts)。
- [Qoder 计量回归](../../../tests/qoder-native-metering.test.ts)、[原生用量详情回归](../../../tests/native-usage-details.test.ts)。

## 4、关联笔记

[通信协议](native-transports.md) · [账号绑定](account-binding.md) · [最小验收](integration-acceptance.md)
