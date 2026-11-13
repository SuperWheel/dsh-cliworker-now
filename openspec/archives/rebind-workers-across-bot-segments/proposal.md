# Proposal

## Why

[Issue #10](https://github.com/SuperWheel/dsh-cliworker-now/issues/10)（2026-11-10，外部用户）：DS Bot 在上下文接近上限时把对话换到新的 root Session，并以 `archiveSession(sid, { stopActivity: true })` 归档旧段。插件把父会话 ID 当作 Worker 的身份键，换段后旧段的 Worker 全部失联：

- `cliworker_status({ worker_id })`、续聊报「Worker does not belong to this conversation」；
- 无参快照看不到这些 Worker；
- 面板「打开会话」报「不能跨父会话绑定 CLI 会话」，已有显示记录时报「原生会话父身份不匹配」。

报告者本机 51 个 Worker 中绑定到当前段的为 0。对照 main：`src/host/runtime.ts` 的 `get`、`resolveWorker`、`snapshot`、`restoreWorker`、`checkAgentName`，以及 `src/host/harness-conversation.ts` 的 `ensure`、`harness-conversation-store.ts` 的 `replace`，都要求父会话 ID 严格相等，与报告一致。见 [v0.8.9 PRD](../../../doc/prd/2026-11-10-v0.8.9-PRD.md) 需求 5.4–5.7。

## DS Bot 段链（2026-11-10 读 Fei2411/DS-Bot main，Apache-2.0，只参考事实）

| 项目 | 结论 | 来源 |
| --- | --- | --- |
| 状态文件 | `<DSH_HOME 或 ~/.dsh>/bot/state.json`，整份 JSON、`version: 1`；插件配置 `home` 可改位置 | `ds-bot/index.js`、`src/host/folders.js`（`dshHomeOf`） |
| 自己的对话 | `bots[id].id` 是第一段会话 ID 且不变；`bots[id].sessionId` 是当前段；`bots[id].segments[]` 是更早的段（`{ sessionId, endedAt, ... }`） | `src/host/store.js` 注释与 `indexSessions` |
| 群聊 | 成员在群里的当前会话 `rooms[id].sessions[botId]`，更早的段 `rooms[id].segments[botId][]`；群自身 `rooms[id].sessionId`（缺省为 `rooms[id].id`）与 `rooms[id].parts[]` | 同上 |
| 换段 | 建新会话，把旧段压入 `segments`（或 `parts`），改写 `sessionId`，再归档旧段 | `src/host/parts.js` |
| 回到旧段 | 用户可把旧段重新设为当前段：旧段移出 `segments`，原当前段压入 `segments` | `src/host/parts.js` `switchPart` |
| 公开接口 | 没有对其他插件公开段链的服务或事件 | 仓库检索；Issue 报告者同样结论 |

本机未安装 DS Bot，未在真实 DS Bot 中复现；报告者的派生包（0.8.3-tzl.9）按“段链识别 + 重绑 + 清理陈旧记录”修改后自测通过（报告者自测，本项目未复核）。

## What Changes

- 新增只读的段链读取器：按 mtime 与大小缓存 DS Bot `state.json`，只取段链字段；读不到、过大、格式不符或会话 ID 出现在多条链里时，视为没有段链。
- 父会话 P 调用插件（状态、快照、续聊、打开会话、改名、删除与恢复等入口）时，若 P 是某条段链的当前段，把同链旧段上的空闲 Worker 改到 P，并在 Worker 上记录原父会话（`formerParentSessionIds`）。运行、排队、停止中的 Worker 不改，结束后的下一次调用再改。
- 显示桥：Worker 已改到 P、旧显示记录的父会话在 `formerParentSessionIds` 里时，`ensure` 以旧记录为前身重建显示子会话（沿用 `retiredSessionIds` 链），并从内存记录中删除旧记录；绑定存储允许这一种受控的换父替换。不属于同一段链的跨会话访问仍按原文案拒绝。
- CLI 侧会话 ID 不变，续聊照常走原生恢复。

## Capabilities

### New Capabilities

- `worker-parent-lineage`：父会话换段后 Worker 的归属、重绑与边界。

## Impact

- Host：新文件 `src/host/parent-lineage.ts`；`runtime.ts`（归属入口）、`harness-conversation.ts`（`ensure` 换父分支）、`harness-conversation-store.ts`（换父替换校验）、`index.ts`（注入读取器、`replaceBinding` 按新父会话取 Worker 并更新 `harnessConversation.parentSessionId`）、`storage.ts`（新字段）。
- 共享类型：`Worker.formerParentSessionIds?`。
- Client：无改动（快照自然包含重绑后的 Worker）。
- 持久化：Worker 记录新增可选字段，旧数据兼容；不写 DS Bot 文件。
- 安装入口：无变化。

## 范围外

- 不修改 DS Bot 或 Harness 核心；宿主若将来提供段链接口，再替换读取器。
- 不支持 DS Bot 配置项 `home` 指向的非默认位置（无公开途径得知）。
- 不在换段瞬间迁移运行中的 CLI 进程。
- 重绑后与当前段已有 Worker 同名时不自动改名；按名称引用会提示不唯一，可改用 worker_id。
