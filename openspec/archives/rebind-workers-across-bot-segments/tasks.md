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
  - `tests/harness-conversation.test.ts`「rebinding across DS Bot segments (Issue #10)」2 条、`tests/parent-lineage.test.ts`「display binding reparenting」1 条通过；原有 `tests/harness-conversation-store.test.ts` 同父替换校验通过。宿主层 `replaceBinding` 已抽为 `src/host/worker-binding-replacement.ts` `replaceWorkerBinding`（行为不变），`tests/parent-lineage.test.ts`「host binding replacement across segments」4 条覆盖：换到当前段、回滚回原段、非原父段与 Worker 身份不符时拒绝且两处存储不变、Worker 保存失败时回滚。parent-lineage 共 13 条通过；关联 5 个文件 71 条通过、typecheck 通过（2026-11-10 22:48）。
  - 关联回归（runtime、harness-conversation*、native-runtime、worker-fork-runtime-native、runtime-account-isolation、runtime-metadata-cleanup、parent-lineage）12 个文件 193 通过、1 跳过。
- [x] 2.4 `pnpm typecheck`、关联 vitest、`pnpm spec:check`
  - 2026-11-10：`pnpm typecheck` 通过；全量 `pnpm test` 280 文件通过、4 跳过，6208 条通过、14 跳过；`pnpm build:preview` 通过；`pnpm spec:check` 63 项通过。

## 3. 真实验收

- [x] 3.1 安装 DS Bot（或按其状态格式构造换段）后在 Desktop 复现并验证 status、无参快照、续聊一轮、打开会话
  - 2026-11-10 22:49–22:52，macOS DSH Desktop（`pnpm build` 后重启，内置浏览器连 Host Web UI）。未安装 DS Bot，按其格式临时写 `~/.dsh/bot/state.json`（0600）：旧段为前一次 TRAE 测试对话 `session-4f7c9311…`（Worker traecn-1 原属此段，原生显示子会话 `a528e285…`），当前段为新建对话 `session-493016da…`；测完已删除该文件与 `~/.dsh/bot/`。
  - 新对话中主 Agent：无参 `cliworker_status` 列出 traecn-1；带 `worker_id` 查询返回 `parentSessionId: session-493016da…`、`formerParentSessionIds` 含 `session-4f7c9311…`，`conversationId` 不变。
  - `cliworker_followup` 续聊一轮（运行 `ec6664c6`）completed，TRAE 回报文件内容 `hello-desktop-worker` 并说出上一轮创建的是 `ask-desktop-worker.txt`（原生会话上下文保留）。
  - 点开 Worker 窗口无「不能跨父会话绑定 CLI 会话」「原生会话父身份不匹配」；`harness-conversations.json` 记录改为父 `session-493016da…`、新子会话 `fcbdb1fa…`、`retiredSessionIds: [a528e285…]`；`<id>.worker.json` 的 `harnessConversation` 同步。
  - 未覆盖：真实 DS Bot 自动换段（含 `archiveSession(stopActivity)`）与群聊段链；Windows 未测。
- [x] 3.2 在 Issue #10 回复修复版本与行为（回复内容经用户确认后发出）
  - 2026-11-10 用户确认后发出：https://github.com/SuperWheel/dsh-cliworker-now/issues/10#issuecomment-6770717142 。Issue 保持打开，待 v0.8.9 发布后关闭。

## 4. 文档

- [x] 4.1 README 与 `doc/design.md` 记录 DS Bot 换段兼容
  - README「DS Bot 换段」段落；`doc/design.md` v0.8.9 小节。

## 5. 发布验收（v0.8.9，2026-11-11）

- [x] 5.1 macOS Desktop（正式构建 9ba35f1；Codex Computer Use gpt-6.1-sol high）：TRAE Worker traecn-1 原属对话 `session-0a42370f…`，新建对话 `session-2f1955e3…` 后临时写 `~/.dsh/bot/state.json` 把前者标为后者的旧段（测完删除）。新对话中无参与按名称 `cliworker_status` 均返回 `parentSessionId: session-2f1955e3…`、`formerParentSessionIds: [session-0a42370f…]`，CLI 会话 ID 不变；面板列出 traecn-1；`cliworker_followup` 一轮 completed，读回 `hello-rc089-worker` 并说出上一轮文件；打开 Worker 窗口无报错；`harness-conversations.json` 与 Worker 的 `harnessConversation` 均改到新段，`retiredSessionIds` 保留旧子会话。
- [x] 5.2 Windows Desktop（候选包 `preview-089-20261111-185643.tgz`，原生安装器装入；Codex Computer Use gpt-6.1-sol high；工作区 live-codex）：rc089-trae 原属 `session-e026e876…`，新对话 `session-dd24ff5a…`，临时写 `%USERPROFILE%\.dsh\bot\state.json`（测完删除）。新对话中状态查询无「Worker does not belong to this conversation」，`parentSessionId` 为新段、`formerParentSessionIds` 含旧段；续聊一轮 completed（凭原生会话记忆答出上一轮文件与内容）；打开 Worker 窗口无「不能跨父会话绑定 CLI 会话」「原生会话父身份不匹配」；磁盘上 Worker `harnessConversation.parentSessionId` 已为新段。
- [x] 5.3 推送、GitHub CI、GitHub Release 与 npm 发布（用户 2026-11-11 批准）：
  - `main` 推送 9cf0d9d..538cf16；tag `v0.8.9` 指向 538cf16。
  - GitHub CI run 43011147053（Windows native runtime）通过：21 个文件，437 通过、4 跳过。
  - GitHub Release「dsh-cliworker-now v0.8.9」附 tgz 与 SHA256SUMS；下载回读 SHA256 `358c2630…aef0` 与本地包一致。
  - npm `dsh-cliworker-now@0.8.9`（2026-11-11T12:40:57Z）由同一 tgz 发布，registry 元数据 `latest`=0.8.9、1045 个文件；用户要求不做 `npm pack` 下载哈希回读（未执行）。Release 正文 npm 一行仍为「待发布后回读」。
  - Issue #10 已留言说明发布并关闭（2026-11-11T12:42:54Z，https://github.com/SuperWheel/dsh-cliworker-now/issues/10#issuecomment-6796123740）。
- 观察：跟随主对话的 Worker（未选过档位）换段后按新对话的权限预设运行（两端均由「询问」变为「仅工作区编辑」，因测试新对话为默认「工作区内修改」），符合「未选档位跟随主对话」规则。
- 仍未验证：真实 DS Bot 自动换段与群聊段链。
