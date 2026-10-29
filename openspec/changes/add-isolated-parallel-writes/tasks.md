# Tasks

## 1. 实施

- [x] 1.1 设置：GeneralSettings 新增 `isolatedParallelWrites`（缺省关闭），「CLI Worker 设置 → 任务调度」开关及说明；关闭时调度与此前一致。
- [x] 1.2 副本：私有状态目录 `isolated/<workerId>/`（0700/0600），APFS `COPYFILE_FICLONE`，条目/大小上限，跳过符号链接与排除目录，记录逐文件哈希及文本基线；`assertIsolatedCopy` 专用校验，`projectDirectory()` 保持不变。
- [x] 1.3 调度：仅开关开启且 `drain()` 检测到同目录写冲突时隔离；无冲突仍在主目录；超限或复制失败回落排队并在任务卡显示原因；同会话互斥不变。
- [x] 1.4 运行：Worker 项目身份保持原项目，CLI cwd/原生目录参数改为副本；首轮在副本路径重新核对账号绑定；追问/恢复回到同一副本；隔离运行不接通 DSH 工具桥、拒绝 fork。
- [x] 1.5 合并：自实现 diff3 三方合并（单侧直写、双侧文本 diff3、二进制/类型变化/大小写重命名为冲突，不写冲突标记），有冲突项目零写入并保留副本；成功后清理副本，结果为未提交改动。
- [x] 1.6 丢弃：任务卡确认弹窗及 `cliworker_discard` 用户确认；目录确认删除后才报告成功。
- [x] 1.7 生命周期：复制中停止删除部分副本且不启动 CLI；复制完成后才收到的停止同样删除副本；Host 重启恢复 `preparing`/`merging` 状态，目录缺失提示只能丢弃；`close()` 等待合并/丢弃结束。
- [x] 1.8 Client：任务卡隔离状态行与「合并」「丢弃」按钮、`IsolationDialog`；Host Remote `mergeIsolation`/`discardIsolation` 与主 Agent 工具 `cliworker_merge`/`cliworker_discard`。

## 2. 自动检查

- [x] 2.1 `tests/diff3.test.ts`：单侧、双侧不重叠、重叠/相邻冲突、相同改动、超过编辑距离上限。
- [x] 2.2 `tests/isolated-workspace.test.ts`：复制/上限/排除/符号链接与路径逃逸、合并（单侧、双侧干净与冲突、二进制、新增/删除/重命名、可执行位、类型变化）、取消清理、Windows 分隔符路径判断。
- [x] 2.3 `tests/isolated-runtime.test.ts`：开关关闭不隔离、冲突才隔离、超限回落排队、复制中停止、追问回到同一副本、重启恢复、合并/丢弃后释放。重复运行 10 次均通过。
- [x] 2.4 `tests/isolation-ui.test.tsx`、`tests/settings-dialog.test.tsx`、`tests/general-settings.test.ts`：按钮仅空闲时显示、显式确认后才调用、冲突列表与副本位置、开关保存。
- [x] 2.5 `node scripts/build-preview.mjs`（Host/Client 类型检查与隔离构建）。
- [x] 2.6 `pnpm spec validate add-isolated-parallel-writes --strict`。

## 3. 文档

- [x] 3.1 同步 AGENTS.md、`openspec/config.yaml` 同目录写规则例外，`doc/design.md` 新增章节，README 中英文功能条目，`doc/tasks.md` 验证记录。

## 3b. 主 Agent 合并（2026-10-25 用户调整）

- [x] 3b.1 任务卡去掉副本状态行、「合并」「丢弃」按钮与 `IsolationDialog`；移除对应 Remote 与字典条目。
- [x] 3b.2 设置说明缩为一行；开关保存成功不再显示确认文字。
- [x] 3b.3 完成通知与 `cliworker_status` 加入副本待合并提示。
- [x] 3b.4 `resolutions` 逐文件决定（content / copy / project）；`cliworker_merge` 对两边都改过的文件返回 `needs_integration` 与三个版本路径，由主 Agent 整合，目标矛盾时由主 Agent 用 `ask_user_question` 问用户；插件不弹问题卡、不称为冲突。（第一版插件问题卡已按用户反馈撤下。）
- [x] 3b.5 测试：`tests/isolated-merge-decisions.test.ts`（提示、整合报告、resolutions 校验）、`tests/isolated-workspace.test.ts`（整合内容写回、三个版本、决定写回、副本删除、结构性改动）、`tests/isolation-ui.test.tsx`（任务卡无副本状态与按钮）、`tests/settings-dialog.test.tsx`。
- [x] 3b.6 Desktop 真实主 Agent 整合复验。
  - 2026-10-25 12:49 新 Host：主 Agent 两次调用 `cliworker_merge`（needs_integration → use=content），merge.txt 为原 5 行 + `A done` + `B done`，副本 released，界面无冲突字样、问题卡与合并按钮（见 doc/tasks.md）。
  - 2026-10-25 第一版（插件问题卡）实测：ZCode 默认模型 GLM-5.3-Flash·Low，A 在主目录、B 在副本，主 Agent 按提示调用 `cliworker_merge`，问题卡出现并选副本版本后写回 merge.txt、b-extra.txt；用户随后否定问题卡方案，改为主 Agent 整合。

## 4. 未执行

- [x] 4.1 真实 CLI 多任务在副本中运行、追问与合并（未调用真实模型）。
  - 2026-10-29 核对：2026-10-25 已真实执行（`doc/tasks.md` 10-25 相关小节；ZCode GLM-5.3-Flash·Low，用户授权）。同项目两个 ZCode 写任务，一个在主目录、一个在隔离副本：Desktop 中合并写回 1 个文件、丢弃后副本清理；主 Agent 经 `cliworker_merge` 整合同一文件的相邻改动（首次 `needs_integration`，随后写回），落盘内容核对一致。同一 Worker 的 `cliworker_followup` 续聊也在副本中运行，该轮暴露了 4.3 的绕过。
- [ ] 4.2 DSH Desktop 实机查看开关与任务卡（明暗主题、窄屏）。
  - 2026-10-25 Mac 浅色默认窗口：开关、任务卡状态、合并/丢弃弹窗通过；暗色、窄屏未查。之后按用户要求移除任务卡状态与弹窗。
- [ ] 4.3 隔离被绕过：CLI 按提示词写入原项目绝对路径（ZCode Edit 实测成功），主 Agent 未被告知改动待合并而要求在真实目录重做。已加完成通知提示（3b.3）；CLI 原生权限仍允许绝对路径写出副本，未做强制隔离，需复验提示是否足够。
- [x] 4.4 Windows 实机（仅以平台条件单元测试覆盖路径分隔符；复制回退到普通复制未在 Windows 验证）。
  - 2026-10-29 Windows 实机（真实 Pi `zai-coding-cn/glm-5.3-flash`·low，经安装包 Electron SDK 与独立 WorkerRuntime，非 Desktop 网关）：非 Git 目录中两个同目录写任务，一个在主目录写 a.txt，一个在隔离副本写 b.txt。基线复制、Windows 路径分隔符、丢弃后副本消失且主目录不出现 b.txt 均通过（`real-extra.json` 的 parallel）。Windows 上 `COPYFILE_FICLONE` 由 libuv 直接走 CopyFileW 普通复制，即本次覆盖的路径。Windows 上的任务卡界面未查（见 4.2）。证据在 `.test-data/windows-remote/full-20261029/`（不入 Git）。
- [ ] 4.5 Linux reflink / 非 APFS 文件系统上的复制性能与回退。

## Workflow follow-up

- 4.x 未完成前保留活动 change，不归档；界面文字仅中文，待 i18n 分支接入 `language` 后统一处理。
