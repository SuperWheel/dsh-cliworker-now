# Tasks

## 1. 准备

- [x] 1.1 阅读 `doc/settings-ui-design.md` 与通用设置页现有分组，确认新增分组位置与文案；与仍在进行的 `add-general-settings-page` 核对字段，避免冲突。
  - 2026-10-28：本分支基于已含通用设置页的 `0e46cbd`。新分组放在「语言」「任务调度」之后，复用 `cwn-setting-row`、`NativeChoice` 与逐字段保存反馈；新字段 `taskTimeLimitMs`、`idleTimeLimitMs`、`defaultTaskTimeLimitMs` 与现有 `maxConcurrent`、`language`、`isolatedParallelWrites`、`askBeforeDispatch` 不重名。空闲关闭选项用「不启用」，因「关闭」词条已表示关闭按钮。

## 2. 实施

- [x] 2.1 设置存储新增总时限与空闲时限，旧 Cordis `timeoutMs` 迁为初始值。
  - `storage.ts` 新增两个毫秒字段（总时限 1,000–86,400,000；空闲 0 或 60,000–86,400,000），补丁 `null` 恢复默认。未保存选择时有效总时限即 Cordis `timeoutMs`（`runtime.generalSettings()` 同时返回 `defaultTaskTimeLimitMs`），不写入迁移值，与「最高同时对话数」相同。
- [x] 2.2 Host 计算统一 `deadlineAt` 并写入桥请求；`runtime.ts`、`native-bridge.mjs`、各 runner、agy `--print-timeout` 改用剩余时间。
  - 任务首次 `execute()` 时生成 `{ deadlineAt, totalMs, idleMs }` 并保存在任务上（换号续接沿用，账号占用退回队列时清除）。Host 计时器、`native-worker.ts` 写入的请求（`deadlineAt`、`idleTimeoutMs`，`timeoutMs` 保留为总时限兼容旧桥）、agy `--print-timeout`（剩余秒数，至少 1 秒）共用该截止时间。
  - 桥启动时把 `config.timeoutMs` 改为剩余时间，runner 的 `waitFor`/`turn/start` 超时因此按剩余时间计，未逐个修改 runner；ZCode 私有账号材料有效期改按 `deadlineAt` 判断。
- [x] 2.3 桥实现空闲计时器，任何原生事件续期；超时说明区分总时限与空闲。
  - 新增 `native-time-limit.mjs`（已加入 `scripts/build.mjs` 清单）：桥的每条输出帧与 CLI 子进程的任何原始输出续期（`createNativeIO` 新增只通知不带内容的 `onNativeOutput`，覆盖被 runner 丢弃的 Claude `keep_alive`；该缺口由 Codex 审查发现后修复）。不经该桥的 Pi/OMP 与旧协议由 Host 按子进程输出续期。
  - 桥超时结果（有或没有会话）由 Host 映射为 `interrupted`：「任务超时：已达到总时限 2 小时」/「任务超时：连续 10 分钟没有收到 CLI 事件（空闲时限）」，Client 有对应英文。
- [x] 2.4 Client 通用设置页新增「任务时限」分组。
  - 总时限：30 分钟、1/2/4/8 小时、不限制（最长 24 小时），另列部署默认值（标「（默认）」）与当前值；空闲时限：不启用、5/10/30 分钟。旧 Host 缺字段时按 30 分钟与不启用显示。

## 3. 自动检查

- [x] 3.1 计时夹具：长于 30 分钟（假时钟）不超时、空闲超时、运行中改设置不影响当前任务、旧 `timeoutMs` 继承、超时后进程范围退出才报告。
  - `tests/task-time-limit.test.ts`（模拟进程与假时钟，11 项通过）：桥计时器 2 小时截止下 45 分钟不触发、空闲续期与超时、关闭后不再触发、旧请求按 `timeoutMs` 计；Host 侧 2 小时总时限下 45 分钟仍运行，运行中缩短为 30 分钟后当前任务仍按 2 小时结束、下一任务按 30 分钟；Cordis `timeoutMs` 45 分钟作为初始值且不写入存储；Host 空闲计时；桥请求写入同一 `deadlineAt`，桥总时限/空闲超时（含无会话）映射为中断说明。各用例在 `terminate` 后、模拟进程范围退出前确认任务未结束。
  - `tests/native-bridge-time-limit.test.ts`（真实 `native-bridge.mjs` 进程 + 合成 CLI，3 项通过）：静默 CLI 以 `Native task idle timed out` 结束，桥退出时合成 CLI 进程已不存在；stderr 输出、或只发 Claude `keep_alive`（不转发给 Host）时续期，最终以总时限结束。变异检查：去掉原始输出续期或 Host 无会话映射后，对应用例失败。
  - 修复心跳续期后重跑：原生相关 41 个测试文件 628 项通过（3 项跳过），预览构建与预览包内 Host/Client 类型检查再次通过。
- [x] 3.2 设置页渲染与持久化测试；`pnpm typecheck`、关联测试、`pnpm build:preview`。
  - `tests/general-settings.test.ts`：时限字段私有持久化（0600）、`null` 恢复配置默认、非法补丁拒绝。`tests/settings-dialog.test.tsx`、`tests/client-i18n.test.tsx`：分组渲染、45 分钟/90 秒部署默认标注、选择后保存载荷、Host 未应用时显示未保存并可重试、旧 Host 默认、非法值拒绝、英文超时说明。
  - `corepack pnpm build:preview` 通过，预览包含 `lib/native-time-limit.mjs`；在预览包内执行 `scripts/build.mjs --typecheck-only`：Host/Client 类型检查通过（DSH 0.2.1-rc.3）。worktree 内直接 `corepack pnpm typecheck` 的 Host 部分通过，Client 部分因 worktree 没有生成的 `lib/typert.remote-client.d.ts` 失败（需 `pnpm build` 生成，本会话不运行）。
  - `corepack pnpm test` 全量：4765 通过、13 跳过；`tests/build-dependencies.test.ts` 的 2 项因 worktree 没有构建产物 `lib/` 失败（与本变更无关，需正式构建后复核）；另 1 项失败为全量运行与变异检查重叠所致，恢复代码后单独重跑相关 8 个文件 356 项全部通过。

## 4. 验收

- [ ] 4.1 Desktop 实机核对设置页布局与保存（遵循 Desktop 测试授权）。
  - 待合并后由主会话执行。
- [ ] 4.2 真实长任务验收需已有选型授权；未执行时在本任务下注明。
  - 待合并后由主会话执行；本分支未发起真实 CLI 或模型请求。

## 5. 文档

- [x] 5.1 README（中英）与 `doc/settings-ui-design.md`（若新增设计参数）同步；验证记录写在本文件对应任务下。
  - README / README.en「权限与数据」新增任务时限说明；`doc/settings-ui-design.md` 新增「通用页「任务时限」分区」小节（未新增字号或间距参数）；`design.md` 按实际实现更新（毫秒字段、Host 对非桥通路计空闲、桥超时映射、ZCode 有效期）。
