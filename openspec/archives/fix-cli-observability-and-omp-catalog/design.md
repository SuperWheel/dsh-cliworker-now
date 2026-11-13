# Design

## Context

见 proposal.md。当前目标 SDK 由 package.json 锁定为 0.2.1-rc.2，根 node_modules 仍可能为旧 SDK，继续使用现有隔离依赖选择机制。Grok turnTail 说明是插件注入；用量通过 nativeTelemetryProjections 与 externalTurnUsage 接入原生扩展。OMP 原生 model_cache 陈旧时，候选求交会丢掉新的账号模型。

## Goals / Non-Goals

Goals：保留原生会话体验，真实数据可见，缺失状态可检查，当前账号模型目录和执行能力一致。
Non-Goals：补造思考/token/cache、按上下文比例反推消耗、重写历史、自动换模型、改变账号权限、升级发布及真实模型批量验证。

## Decisions

1. 删除 Grok 额外说明的注册；保留原生公开过程和历史安全映射。有公开内容才展开，空片段与签名不构造过程。
2. 采集端先验证 Qoder 与 Hermes 精确会话证据。无法恢复的数值保持未知，补全原生功能条/缓存未知交互，不能仅为了显示数字使用包装调用统计。未知态独立于账单对象，避免破坏已有报告校验。
3. OMP 在已有受租约保护的插件账号运行目录中调用官方 models refresh，再按当前账号和额度求交；模型任务复用同一原生 registry。仅刷新插件受管 models.db，用户 ~/.omp 与原账号来源目录保持不变；OAuth 正常轮换仍经现有 CAS 保存。保留账号池交集、取消及原生保护，不硬编码型号或能力。
4. 使用既有独立宿主扩展源码补丁及可复现构建改善原生组件，不直接修改上游源码 checkout 或用户安装中的散文件。每次正式更新先验证隔离包并保护已有会话。

## Risks / Trade-offs

- [上游不给数据] → 明示真实缺口，不能以模拟验收证明真实数据存在。
- [新模型只有名称没有能力] → 拒绝扩大目录，要求原生能力和实际注册证据。
- [历史账单误绑] → 精确轮次/run/session 匹配，保留 null 与无映射的区别。
- [大量既有改动] → 只改本范围，保留独立 before/after 与定向验证。

## Migration Plan

先关联测试和隔离 typecheck/preview，再原生渲染验证。确认无活动 Worker/账号终端后备份并更新 Desktop 已有链接；安装失败按本轮备份回退，不能覆盖运行数据或原账号。记录真实模型、Windows/Linux 与数据上游缺失边界；主规格只合并本次已落实行为。
