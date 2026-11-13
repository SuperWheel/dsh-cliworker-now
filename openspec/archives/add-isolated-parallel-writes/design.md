# Design: 同目录写任务隔离副本并行

## 背景与约束

- 现状：`WorkerRuntime.drain()` 以 `worker.project` 判定冲突，同项目只要一方是 `accept-edits` 即串行。
- 用户决定：并行写通过插件自管的“隔离副本”实现；不依赖 Git、不在用户项目 `git init`、不替用户提交；合并最初由任务卡按钮或主 Agent 触发；2026-10-25 用户改为只由主 Agent 合并，不确定的冲突用原生询问交给用户决定，任务卡不再显示副本状态与按钮。
- 各 CLI 的原生会话与工作目录绑定（Claude 按 cwd 存会话、Codex app-server 校验线程 cwd、ZCode 校验 workspace），因此不能把已有会话换目录恢复。

## 模块边界

| 模块 | 职责 |
| --- | --- |
| `src/host/diff3.ts` | 纯函数：Myers 行差异与 diff3 合并，无 I/O |
| `src/host/isolated-workspace.ts` | 副本路径与校验、扫描、复制、清单（哈希/基线）、合并写回、删除 |
| `src/host/runtime.ts` | 调度决策、副本准备阶段、执行目录、合并/丢弃互斥、重启恢复 |
| `src/host/storage.ts` | `isolatedParallelWrites` 设置字段；`Worker.isolation` / `isolationNotice` 校验 |
| `src/host/index.ts` | 主 Agent 工具 `cliworker_merge`（含冲突询问）/ `cliworker_discard`；完成通知与状态中的副本提示；隔离运行不接工具桥 |
| `src/host/isolated-merge-decisions.ts` | 纯函数：副本提示、冲突问题、把回答换成逐文件决定 |
| Client | 设置开关（一行说明）；不显示副本状态或合并入口 |

## 存储布局

```
<state>/isolated/                 0700
  <workerId>/                     0700
    workspace.json                0600  清单：版本、项目、副本路径、条目（类型/哈希/大小/可执行位/stat 缓存/是否存基线）、跳过的链接
    base/<相对路径>                0600  可三方合并文本（≤2 MiB、无 NUL）的基线内容
    copy/<项目目录名>/             CLI 实际工作目录；保留项目目录名，便于 CLI 与模型理解
```

`Worker.isolation = { state, path, createdAt?, conflicts?, skippedLinks?, message? }` 写在 Worker 记录里，与状态原子保存；状态：`preparing`、`ready`、`merging`、`conflict`、`released`。`released` 表示副本已合并或丢弃、目录已删除，但该对话仍绑定此路径。`Worker.isolationNotice` 记录“未建副本、回退排队”的原因，下次提交时清除。

## 路径校验

`projectDirectory()` 仍拒绝 `~/.dsh` 等凭据与配置目录，**不放宽**。副本路径从不作为项目身份传入 `projectDirectory()`；另设 `assertIsolatedCopy(root, workerId, project)`：对插件根目录取 realpath，计算期望路径，要求副本 `lstat` 为真实目录（非符号链接）、realpath 与期望完全一致。只有调度器为本 Worker 生成的路径能通过。

## 调度

`drain()` 对未绑定副本的任务沿用原冲突判定（只计入同项目、在主目录运行的任务，以及正在写回该项目的合并）。冲突时若满足以下全部条件则标记 `task.isolate` 并放行：开关打开；任务为 `accept-edits`；Worker 没有原生会话 ID、没有待完成的分支源会话、未绑定副本；本任务未因超限被拒过。已绑定副本的任务不参与主目录冲突判定。准备副本占用一个并发名额。

## 运行

`run()` 先处理副本：

1. 首次隔离：写入 `isolation.state = preparing`，异步扫描与复制（可被停止信号中断）。超限或复制失败：删除部分副本、清除绑定、记录 `isolationNotice` 与诊断事件，把任务按原入队顺序放回队列，并标记不再尝试隔离。
2. 已绑定且 `released`：在同一路径重建副本；失败则任务如实失败（会话已绑定该路径，不能回主目录）。
3. 已绑定且 `ready`/`conflict`：校验副本存在后直接使用。

随后 `execute()` 用 `executionDirectory`（副本路径）构建 argv、`cwd`、原生桥 `project` 及账号核验；首次隔离的准入账号绑定在复制后改为针对副本重新读取，保证 CLI 实际读取的项目配置与核验对象一致。提示前加入隔离说明（副本路径、原项目路径不可写、无 `.git` 与依赖目录、不要提交）。工具桥准备收到 `isolated: true` 时只记录不可用原因，不创建桥。

## 扫描与复制

- 排除（任意层级，按名称）：`.git`、`node_modules`、`.venv`、`__pycache__`、`.pytest_cache`、`.mypy_cache`、`.ruff_cache`、`.next`、`.nuxt`、`.turbo`、`.parcel-cache`、`.gradle`。排除项既不复制，也不参与合并。
- `.git` 取舍：Git 工作树或子模块的 `.git` 文件指向主仓库，复制后 CLI 在副本里 `git add/commit` 会改到主仓库索引；复制完整 `.git` 又会让副本里的提交在合并时丢失并造成困惑。故一律不复制，提示 CLI 不要提交。代价：副本中无法 `git diff`。
- 依赖目录取舍：体积和文件数大、可重建；复制会让大多数前端项目超限。代价：副本中运行测试需自行安装依赖，安装结果不会合并。
- 上限：文件与链接合计 20 000 个，文件总大小 1 GiB；先扫描后复制，超限不写任何内容。
- 文件用 `fs.copyFile(src, dst, COPYFILE_FICLONE)`：APFS/Btrfs 等支持时写时复制，否则自动普通复制。套接字、管道、设备文件跳过。
- 符号链接：`lstat`，不跟随。仅相对且按字面解析仍在项目内的链接原样重建，其余跳过并计数。
- 清单哈希取自副本中的实际字节（复制过程中主目录被其他任务改写时，基线仍与副本一致，三方合并依然正确）。

## 合并

1. 扫描副本，与清单比较（size + mtimeNs + ctimeNs 一致视为未改，否则重新哈希），得到副本改动集合（新增、修改、删除、类型变化、可执行位变化）。
2. 对每个改动路径读取主目录当前条目（`lstat`，校验路径上每一级都是真实目录、名字大小写精确匹配）。规则：主目录等于基线 → 采用副本；主目录等于副本 → 跳过；否则两边都是文本且有基线 → diff3（行按 latin1 字节切分，保证字节无损）；其余为冲突。仅大小写不同的新增与删除成对出现时一律视为冲突，避免在大小写不敏感的文件系统上误删。
3. 任一冲突：不写主目录，状态 `conflict`，返回冲突列表与副本路径。
4. 无冲突：先把所有待写内容写成同目录临时文件，再执行删除，再逐个 `rename` 覆盖，最后创建空目录、清理副本中已删除且为空的目录。写入为普通未提交改动。
5. 成功后删除整个副本目录并核实不存在，状态改为 `released`（Worker 从未产生原生会话时直接解除绑定）。

diff3：Myers O(ND)（仅保留每步 V 数组，D 上限 2000，超出视为无法自动合并），按基线区间分组，相邻或重叠的两边改动为一个区域；两边结果相同则采用，否则冲突。


### 主 Agent 合并与整合（2026-10-25 调整）

- 任务完成通知的 `guidance` 与 `cliworker_status` 对 `ready`/`conflict` 的 Worker 写明副本路径、主目录未改动、核查后调用 `cliworker_merge`、两边都改过的文件由主 Agent 整合、不要让 CLI 改到原目录重做。起因：实测主 Agent 不知道改动待合并，让 ZCode 用绝对路径直接改了原项目。
- `mergeIsolatedWorkspace` 接受 `resolutions: Record<路径, 'copy' | 'project' | { content }>`。每个两边都改过的文件带 `choices` 与 `versions`（基线、项目、副本文件路径）：内容类可取副本版本或写入主 Agent 整合的内容（仅当两边都是普通文件或不存在；写入仍带 `expected` 校验）；结构性情况只能保留项目版本。未决定的文件存在时整体不写。持久化状态名 `conflict` 保持兼容，但不向用户或主 Agent 显示“冲突”。
- `cliworker_merge` 不再弹问题卡：返回 `needs_integration`，说明这是并行写入的正常情况，主 Agent 读取三个版本、按各任务目标整合后带 `resolutions` 再调用；只有两边目标相互矛盾时才用 Harness 原生 `ask_user_question` 问用户。第一版（插件逐文件问题卡）实测后被用户否定：用户不希望并行改动被显示成冲突，而是由主 Agent 理解合并逻辑。
- 移除 Remote `mergeIsolation` / `discardIsolation`、`IsolationDialog` 与任务卡隔离状态行；Host 端诊断仍写入时间线。

## 互斥与生命周期

- 合并/丢弃要求 Worker 无 `busyReason`；进行中登记在 `isolationOperations`，期间 `submit`、删除等管理操作被拒绝。合并另需同项目主目录没有写任务运行，并登记项目写回锁，`drain()` 期间不放行该项目主目录任务。
- 停止：准备阶段中止复制并删除部分副本；运行阶段只结束进程，副本保留供合并。
- 删除（归档）：副本保留，恢复后可继续合并。
- Host 卸载：`close()` 停止全部任务（准备中的副本被清理）；合并为异步 I/O，卸载等待其结束。
- 重启：`preparing` → 删除目录，未产生会话则解除绑定，否则 `released`；`merging` → 回到 `ready` 并注明上次合并中断（重新合并对已写回文件是幂等的：主目录等于副本即跳过）；`ready`/`conflict` 目录缺失 → 注明副本缺失，只允许丢弃。

## 兼容性

- 开关默认关闭；旧记录没有新字段，行为不变。
- 新 Remote 与工具为新增；`cliworker_status` 输出自然包含 `isolation` 字段，主 Agent 可据此读取副本中的冲突文件。
- 隔离对话暂不支持分支：`forkWorker` 对绑定副本的 Worker 拒绝。

## 风险与回退

- CLI 读取上级目录配置（如上级 `.codex/config.toml`、`AGENTS.md`、`CLAUDE.md`）时，副本的上级是插件状态目录而非原项目上级；项目自身文件随副本复制。账号核验针对副本执行，配置差异导致账号不一致时会如实拒绝。
- 用户提示中的绝对路径指向原项目；依靠本轮隔离说明与 CLI 原生写入权限限制在副本内，个别 CLI 的原生权限若允许写出工作目录，仍可能写到原项目（不附加插件沙箱，遵循现有原则）。
- 未在 Windows 实机验证：路径长度、大小写不敏感、`copyFile` 回退与可执行位（Windows 下忽略）。
- 回退：关闭开关即恢复串行；已有副本可逐个丢弃。
