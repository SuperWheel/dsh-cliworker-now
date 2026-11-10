## 0. 调研

- [x] 0.1 对照 main 确认严格比较位置
  - `runtime.ts` `get`、`resolveWorker`、`snapshot`、`restoreWorker`、`checkAgentName`；`harness-conversation.ts` `ensure`（「不能跨父会话绑定 CLI 会话」「原生会话父身份不匹配」）；`harness-conversation-store.ts` `replace`；`index.ts` `replaceBinding`。
- [x] 0.2 读 DS Bot 段链结构
  - Fei2411/DS-Bot main（2026-11-10）：`ds-bot/index.js`、`src/host/store.js`、`src/host/parts.js`、`src/host/folders.js`。结论见 proposal。本机未安装 DS Bot。

## 1. 实施

- [x] 1.1 `parent-lineage.ts`：DS Bot 段链读取器与缓存
  - `DsBotLineage`（mtime+大小缓存、64 MiB 上限、`version: 1`、ID 1–256 字符、重复 ID 丢链）与 `dsBotChains`；由 `index.ts` 以 `ctx.effect` 注入，卸载时解除。
- [x] 1.2 `Worker.formerParentSessionIds` 类型与存储 schema
  - `src/shared/types.ts`；`storage.ts` 中 `.max(64).optional().catch(undefined)`。
- [x] 1.3 `runtime.ts`：注入读取器，入口处重绑空闲 Worker
  - `setParentLineage`、`adoptSegments`；在 `get`、`resolveWorker`、`checkAgentName`、`restoreWorker`、`snapshot` 开头调用；跳过 `stagedForks` 与 `busyReason` 非空的 Worker；保存失败回滚内存字段。
- [x] 1.4 显示桥 `ensure` 换父替换、绑定存储 `reparent`、`replaceBinding` 更新归属
  - `harness-conversation.ts` `ensure`：记录父会话在 `formerParentSessionIds` 中时走 `create(..., existing)`；`harness-conversation-store.ts` `replace(..., { reparent })`；`index.ts` `replaceBinding` 按 Worker 当前父会话取 Worker、校验另一父会话为原父会话，并更新 `harnessConversation.parentSessionId`，回滚同样带 `reparent`。

## 2. 自动检查

- [x] 2.1 读取器：自己对话、群聊成员、群自身三类链；文件缺失、损坏、超限、重复 ID；缓存随 mtime 刷新
  - `tests/parent-lineage.test.ts`「DS Bot segment chains」3 条通过（2026-11-10）。超 64 MiB 分支只有代码路径，未构造大文件测试。
- [x] 2.2 Runtime：同链重绑、非同链拒绝、旧段身份拒绝、运行中不改、回到旧段、重启后保持
  - `tests/parent-lineage.test.ts`「rebinding Workers…」5 条通过；“重启后保持”以读取持久化的 `<id>.worker.json` 验证，未重建 Runtime。
- [x] 2.3 显示桥与存储：换父替换成功、两次打开不报错、非同链旧记录仍拒绝、同父替换校验不变
  - `tests/harness-conversation.test.ts`「rebinding across DS Bot segments (Issue #10)」2 条、`tests/parent-lineage.test.ts`「display binding reparenting」1 条通过；原有 `tests/harness-conversation-store.test.ts` 同父替换校验通过。`index.ts` `replaceBinding` 的换父分支没有宿主层单测，仅由类型检查覆盖。
  - 关联回归（runtime、harness-conversation*、native-runtime、worker-fork-runtime-native、runtime-account-isolation、runtime-metadata-cleanup、parent-lineage）12 个文件 193 通过、1 跳过。
- [x] 2.4 `pnpm typecheck`、关联 vitest、`pnpm spec:check`
  - 2026-11-10：`pnpm typecheck` 通过；全量 `pnpm test` 280 文件通过、4 跳过，6208 条通过、14 跳过；`pnpm build:preview` 通过；`pnpm spec:check` 63 项通过。

## 3. 真实验收

- [ ] 3.1 安装 DS Bot（或按其状态格式构造换段）后在 Desktop 复现并验证 status、无参快照、续聊一轮、打开会话
- [ ] 3.2 在 Issue #10 回复修复版本与行为（回复内容经用户确认后发出）

## 4. 文档

- [x] 4.1 README 与 `doc/design.md` 记录 DS Bot 换段兼容
  - README「DS Bot 换段」段落；`doc/design.md` v0.8.9 小节。
