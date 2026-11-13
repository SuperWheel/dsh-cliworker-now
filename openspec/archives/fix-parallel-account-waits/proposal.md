## Why

2026-10-25：用户要求核查全部 CLI 是否都按「同时对话数」控制并行。核查结论：任务只在运行时 `drain()` 一处按同一全局上限放行，没有 CLI 绕过或另设上限；但有两个 CLI 实际无法并行。

本机证据（只读探针，不调用模型）：

- 每个 CLI 同时做 5 次派遣前的账号/目录授权：Antigravity、Codex、Claude、MiMo、ZCode、Grok、Pi、Hermes、OpenCode、Qoder、Qoder CN 全部成功；Kimi 登录过期未测；**OMP 5 次中 4 次失败「账号正被使用，请稍后刷新」**。OMP（及使用 OAuth 的 Pi）按设计以来源绑定的共享 OAuth 存储和 Host 租约保证同一账号只有一个进程续期令牌；目录读取短暂持有、任务运行全程持有。冲突时目前直接报错：并行派遣的检查失败，另一个任务运行期间第二个 OMP 派遣也失败。账号绑定读取不需要租约（3 次并行各 53ms）。
- Grok：同一项目的任务共用派生状态目录，每次启动先删除再重建指向自身登录的链接。5 个同时准备重复 20 轮，100 次中 65 次 `EEXIST` 失败。

## What Changes

- Grok：派生状态中的配置文件与登录链接先以临时名创建，再原子改名替换；同项目并行启动不再相互破坏。仍不复制凭据，原生登出后不复活旧引用。
- Pi/OMP 独占账号改为按账号排队，不再失败：
  - 运行：本轮进程启动前遇到账号被占用，任务退回原队列位置，不占并发名额；本 Host 持有同一账号的任务结束后再试，持有者在外部（如目录读取）时每 2 秒重试。每次重试重新完成完整授权。停止排队任务立即生效。
  - 派遣：账号被占用时，使用同一账号最近一次已验证的目录完成选型与入队检查，不等待长时间运行；没有该账号的目录时等待短暂的目录读取（最长 30 秒）。同一账号的新鲜目录读取结果写入该账号的显示目录，供并行派遣复用。执行授权仍在运行前重新完成，账号变化或其他错误照常失败。
- 不提高单个 OAuth 账号的实际并行数（避免令牌轮换冲突）；不改变并发上限、同目录写任务及隔离副本规则。

## Capabilities

### Modified Capabilities

- `cli-account-isolation`：新增“独占账号按账号排队”。
- `platform-runtime`：新增“同项目并行启动的派生状态”。

## Impact

- Host：`src/host/runtime.ts`、`src/host/index.ts`、`src/host/authorized-catalog.ts`、`src/host/grok-adapter.ts`。
- 测试：`tests/account-busy-queue.test.ts`、`tests/busy-account-catalog.test.ts`、`tests/grok-adapter.test.ts`。
