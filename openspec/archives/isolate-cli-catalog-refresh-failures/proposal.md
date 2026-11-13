# Proposal

## Why

Windows 用户先遇到 Grok 模型目录失败，随后十二 CLI 全部显示进程清理错误。`CliWorkerService` 将目录查询的 `ProcessCleanupUnconfirmedError` 交给全局 `WorkerRuntime.blockOnCleanup`，使一次只读元数据查询永久封锁不相关 CLI。现场已受控恢复；首次异常未保留底层原因，当前 Grok 独立复核为登录需要续期。

## What Changes

- 将可归属 CLI 的账号、安装路径和模型目录查询清理保护持久限定到对应 CLI，拒绝该 CLI 的进一步查询、任务准入和账号变更，其他 CLI 可继续使用。
- 普通认证、目录、超时及已确认清理的取消只影响本次查询；不新增全局封锁。
- 保留真实任务进程范围清理失败及旧无归属保护记录的全局拒绝语义，不自动清除未知保护。
- 逐一覆盖十二 CLI 的普通失败、取消、清理未确认、冷恢复及其他 CLI 查询/准入；在 Windows 实际逐项刷新验证。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `cli-model-discovery`：元数据刷新失败按 CLI 隔离，持久保留清理保护与真实任务保护的边界。

## Impact

影响 Host 查询入口、Runtime 准入、私有保护记录及回归；Client、附件协议和原生 CLI 参数不变。依据 `src/host/index.ts`、`src/host/runtime.ts`、`src/host/storage.ts` 及 `tests/cleanup-persistence.test.ts`。保持 v0.8.1，不更换模型或账号，不增加自动 OAuth 续期、不发送模型请求、不发布或推送；记录 Grok 实际续期提示，不把目录或模拟检查作为模型调用证明。
