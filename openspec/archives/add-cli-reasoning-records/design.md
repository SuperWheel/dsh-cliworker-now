# Design

## Context

动机见 proposal.md。现有 Host `harness-conversation-stream.ts` 将各 CLI 的白名单 reasoning 事件转成原生 assistant blocks，并与本轮消息一同持久化。Harness 0.2.1-rc.2 的公开 keyed 节点入口包含 assistant-step；原生 AssistantNodeView / ReasoningRow 已负责块顺序、过程归属、预览与持久折叠。用户要求记录继续位于这个原生思考过程内。

参考 CodexHost 固定提交 `a8adb78b519a81795fc05b787811f20a9738d7f0` 将部分外部 reasoning 投影为 `thinking` 哨兵工具以获得持久展开；本插件已有真实 reasoning 存储，无需该兼容手段。Codex 原生 TurnStartParams 支持 `summary: auto`，当前桥未指定，实查旧轮为 none。

## Goals / Non-Goals

**Goals:** 为当前 Worker 每轮提供稳定可查的公开思考记录，不引入第二份正文或额外远端订阅。

**Non-Goals:** 不新增答复尾部面板，不替换原生流式行、工具树和最终答复；不增加上下文分类估算、私有思考提取或历史重跑。

## Decisions

1. 委托当前原生 assistant-step 渲染器，把 `message.think` 标题映射为“思考记录”，并在 `conversation.chat.reasoning.body` 的原生输出外包裹局部滚动区域。原生过程分组负责“已完成，用时…”的外层展开/收起，原生 ReasoningRow 负责内层折叠、预览和重置；不复制聚合全文，不重排工具步骤，不新增 turnTail 注册。
2. 复用 Host-issued HarnessBindingRegistry，加上当前 Session 的 child/parent 地址复核。只对活跃 CLI 的已绑定直接子会话调整标题和正文包装，主会话及身份不匹配直接委托原始 props。保留原生 entry 的注入、locale、store 及子 slot 渲染信息；卸载只清理本插件注册和订阅。
3. 原生 DisclosureRow、图标、安全 Markdown、键盘操作及主题保持完整；正文使用局部滚动高度限制。内容与折叠状态均沿用原生机制，空块、签名等不会生成空面板；完成、停止和失败保存的公开文本可在历史中重新展开。
4. Codex `turn/start` 增加 `summary: 'auto'`；不改变 model/effort，不请求 raw reasoning。全部 CLI 沿既有原生公开数据通路进入同一渲染器，不声称未公开内容也能获得。

## Risks / Trade-offs

- [原生扩展点在未来版本变化] → 只使用当前已核对的公共节点入口和原生组件合同，异常形状拒绝展示，并以真实 native UI 夹具验证。
- [内容很多或含不可信 HTML] → 使用原生安全 Markdown、局部滚动和折叠，不执行 HTML。
- [旧轮没有摘要] → 保持缺失；只改变后续 Codex 请求。
- [不同 CLI 实际可公开程度不同] → 12 CLI 统一投影验收与协议回归分开记录，模拟不等于真实账号验证。

## Migration Plan

无需数据迁移或依赖升级。运行定向回归、类型检查、隔离 preview 与 native UI 验收；确认 Desktop 无活动任务后更新本地链接包，保留历史、配置及 Web 进程。若部署检查不满足，保留隔离构建并如实记录。回退使用更新前包备份，不改写用户记录。
