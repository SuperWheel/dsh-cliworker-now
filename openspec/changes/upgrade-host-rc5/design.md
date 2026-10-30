# Design

## Context

见 proposal.md。官方 tag `dsh-v0.2.1-rc.5` 指向 `b830ec950faba0a46dda564be3e2d854afed94f1`。rc.3 → rc.5 共 388 个文件变化，绝大多数只是版本号；四包中实际源码变化为：

- `ui-chat`：新增 `reasoning-text.ts`；`ReasoningRow` 用显示文本做摘要与正文、全为签名时不渲染，并向 `conversation.chat.reasoning.body` 传 `{ rawText, text, running }`；`contract/slots.ts` 的 `ReasoningBodyOwnerProps` 增加 `rawText`，`ReasoningContentInput` 不再继承它；`process-activity` 的实时推理摘要同样使用显示文本。
- `ui-conversation`：`ConversationSession` 的视图标签只在文字预计溢出时显示提示，「更多会话视图」不再拼接当前名称（对应词条删除）。
- `ui-session`、`ui-subagent`：仅版本号。

Host 端插件引用的 SDK 包在 rc.3 → rc.5 之间同样只有版本号变化。

## Goals / Non-Goals

**Goals:** 四包与官方 rc.5 行为一致并保留既有扩展；开发 SDK、构建脚本与测试指向 rc.5；Mac/Windows rc.5 上可安装使用。

**Non-Goals:** 不改业务派遣协议、用户数据、版本号；不调用模型；不在本次重新做 rc.3 那样的多宿主隔离矩阵。

## Decisions

- 沿用 rc.3 的可复核流程：固定 tag checkout 位于 `.cache/dsh-host-source-021rc5`，补丁由真实 checkout 导出，独立构建依赖 `.cache/dsh-host-build-deps-021rc5`，构建产物 `artifacts/dsh-host-extension-021rc5-data`，再 vendor。
- 构建依赖以 rc.3 的冻结三文件为起点，只把 DSH 包 pin 换成 rc.5，让第三方依赖尽量不漂移。
- 仓库没有生成 `dependency-links.json` 的脚本；按 rc.3 清单逐项映射到 rc.5 安装位置并重新计算 package.json 摘要，记录生成方式。
- rc.5 发布不足 pnpm 默认发布期限，按 rc.3 做法在 workspace 加精确版本例外，不关闭全局保护。

## Risks / Trade-offs

- 补丁与 rc.5 改动重叠（`ReasoningRow`、`slots.ts`、`ConversationSession`）→ 用 3-way 应用后逐处人工核对，保留官方新行为。
- 第三方依赖漂移 → 以旧锁文件为起点安装并核对差异。
- 未重复 rc.3 的隔离多宿主矩阵 → 以 Mac/Windows rc.5 实装界面检查作为本次验收，并如实记录未覆盖范围。
