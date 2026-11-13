# Proposal: 同目录写任务隔离副本并行

## Why

用户反映同一项目里同时只能有一个写任务在跑（例如 ZCode 一次只跑一个对话，其余都显示排队）。原因有两条：

1. 全局并发上限（默认 2）。已由 `add-general-settings-page` 改为可在「CLI Worker 设置」调整。
2. `src/host/runtime.ts` 的 `drain()` 实行“同目录写任务串行”：只要同一项目有一个 `accept-edits` 任务在运行或排在前面，其他任务都排队。

很多用户不懂 Git，因此并行写不能依赖 Git worktree，也不能在用户项目里执行 `git init` 或替用户提交。

## What Changes

- 「CLI Worker 设置」→「任务调度」新增开关「同目录写任务并行（隔离副本）」，默认关闭。关闭时调度与现在完全一致。
- 开关打开后，`drain()` 判定某个新写任务会与运行中或排在前面的同项目任务冲突时，为它在插件私有状态目录建立“隔离副本”：复制项目（macOS/APFS 优先写时复制），记录每个文件的哈希和三方合并需要的基线内容，CLI 的实际工作目录和原生目录参数改用副本路径。不冲突的任务照旧在主目录运行；同会话互斥不变。
- 复制超出文件数或体积上限、或复制失败时，回退为原有排队，并在任务卡上如实写明原因。
- 任务空闲后由主 Agent 合并：完成通知告诉它改动在副本中、主目录未改动，它核查后调用 `cliworker_merge`；任务卡不显示副本状态和合并按钮（2026-10-25 用户调整）。合并逐文件三方合并，以未提交改动写回主目录，绝不提交；两边都改过的文件不视为冲突：工具返回基线、项目、副本三个版本，由主 Agent 按任务目标整合（只有目标矛盾才问用户），决定齐全前主目录一个文件都不写。`cliworker_discard` 须经用户确认，副本确认删除后才报告成功。
- 合并或丢弃之前，该对话的续聊、恢复都回到同一副本；之后续聊时在同一路径重新建立副本（CLI 原生会话与工作目录绑定，不能换目录恢复）。
- Host 重启后可从 Worker 记录与副本元数据恢复；停止、删除（归档）、Host 卸载、创建中取消均有清理或可恢复状态。
- 同步 `AGENTS.md`、`openspec/config.yaml`、`doc/design.md`、README 中“同目录写任务串行”的表述（仅在开关打开时例外）。

## 范围外

- 不使用、不创建 Git 仓库，不执行 commit/stash；副本不包含 `.git`。
- 不写冲突标记，不默认“以副本为准强制覆盖”；两边都改过的文件由主 Agent 读取三个版本后整合，目标矛盾时再问用户。
- 只读（规划）任务不建副本；已在主目录建立原生会话的旧对话不迁入副本。
- 隔离副本中的对话暂不支持分支（fork），也不接通 DSH 工具桥（避免经由主会话工具写入主目录）。
- 不附加插件自有操作系统沙箱；写入边界仍由各 CLI 的原生权限模式负责。
- 不修改 Harness 核心、版本号或 Desktop 安装。

## 能力域

- `worker-dispatch`：同目录写任务调度（新增要求，覆盖默认串行与开关打开后的隔离并行）。
- `isolated-workspace`（新能力）：副本创建、运行、合并、丢弃、生命周期与设置开关。

## 影响

- Host：新增 `src/host/isolated-workspace.ts`（复制、基线、扫描、三方合并、清理）与 `src/host/diff3.ts`；修改 `runtime.ts`（调度、执行目录、合并/丢弃、恢复）、`storage.ts`（设置字段与 Worker 字段）、`index.ts`（Remote、主 Agent 工具、工具桥）。
- 共享：`GeneralSettings.isolatedParallelWrites`；`Worker.isolation`、`Worker.isolationNotice`。
- Client：`general-settings.tsx` 开关；`worker-card.tsx` 状态与按钮；新增 `isolation-dialog.tsx`；`panel.tsx` 接线。
- 协议：新增 Remote `mergeIsolation`、`discardIsolation`；新增主 Agent 工具两个。无破坏性变更，旧记录无新字段时行为不变。
- 依赖：不新增依赖，diff3 与 Myers 差异算法自行实现。
