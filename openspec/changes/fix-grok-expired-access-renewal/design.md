## Context

Grok 官方 OIDC 的 access 有效期约 6 小时。Grok 本体在启动或发请求前发现 access 过期时，会用 refresh_token 自行续期并写回 `auth.json`（文档 `~/.grok/docs/user-guide/02-authentication.md` 第 15 行；Mac 日志 2026-10-31T07:10:31Z 的 `oidc refresh enter` → `auth update disk written`）。插件这边存在三个问题：

1. 账号状态把「有 refresh」算作已登录（`zcode-grok-accounts.ts:180`）。
2. 账号模型发现要求 access 有效，且明确不续期（`grok-models.ts:246-260`）。
3. 派遣先查目录（`index.ts:1151`）；而目录探测用的是没有凭据的私有目录（`grok-adapter.ts:191`、`grok-catalog.mjs`）。

结果是只要 access 过期，插件就再也不会启动 Grok 本体，过期状态无法自动解除。项目里已有同类做法：Hermes Nous 的自动续期（`hermes-renewal.ts`），包括在途合并、账号终端互斥、清理确认和失败分类。

## Goals / Non-Goals

**Goals：**
- access 过期但 refresh 仍可用时，由 Grok 本体完成续期，设置页和派遣都能自动恢复。
- 续期不读、不复制、不记录凭据，不发起模型生成，进程有完整的生命周期。
- 账号状态、模型区域提示与续期结果一致；读取失败按原因分类。

**Non-Goals：**
- 插件自己实现 OAuth 刷新，或解析 refresh_token。
- 修改其他 CLI 的续期行为。
- 清理目录探测残留的 `query-*` 目录。
- 升级 Windows 上的 Grok。
- 修复 macOS Worker 的符号链接写回隐患（只在任务 1 中核实）。

## Decisions

### D1 续期入口：用 Grok 本体，已选 A（`grok models`）

**实测结论（2026-11-06，Windows Grok 1.0.50）**：已选定 A。`grok models` 在 access 已过期 854 分钟时 3.3 秒退出（退出码 0）。凭据有效期变为 360 分钟，身份摘要不变，access 指纹改变；原文件被原子替换（inode 改变，nlink=1），未残留 grok 进程，也未启动 leader。私有 home 中的 Grok 日志依次记录：获取 `auth.json.lock` → `oidc refresh enter`（reason PreRequest）→ `try_refresh_pure succeeded` → `auth update disk written` → `auth: silent refresh` outcome=`Renewed`。历史日志中，无法续期时的同一事件为 outcome=`Failed(ManualLogin)`，因此用它判定「需要重新登录」。B 未单独测试。Mac 1.0.62 的 `grok models` 续期见任务 1.1。

以下为原候选说明：

候选入口有两个，都必须指向用户真实的原生凭据，环境按任务运行时的方式准备：私有 `GROK_HOME`，`GROK_AUTH_PATH` 指向 `~/.grok/auth.json`，`XAI_API_KEY` 等置空，遥测关闭。

- **A. `grok models`**：列出模型后退出，不创建会话，不生成内容。它需要已认证的请求，预计会触发 PreRequest 续期。
- **B. ACP `agent --no-leader stdio`**：沿用 `grok-catalog.mjs` 的流程，只发送 `initialize`，但使用真实凭据路径，等待 `auth update disk written` 后关闭。不调用 `authenticate`，不创建会话。

实施前由任务 1 分别在 Mac Grok 1.0.62 和 Windows Grok 1.0.50 上核实：

- 哪个入口能续期并就地写回原文件；
- 成功和「需要手动登录」两种情况下的退出码与可观察信号；
- 是否会连接或启动 leader；
- 是否残留子进程。

优先选 A（不创建会话、退出语义清楚）；只有 A 不续期或会产生会话时才选 B。两个都不满足就停止实施，回到提案阶段。

不采用的方案：
- 插件直接调用 `auth.x.ai` 的 token 端点：违反「不发明原生能力、不自拼 OAuth 协议」，还可能与 Grok 的 refresh_token 轮换冲突。
- 让派遣跳过目录检查直接启动 Worker：违反「模型与强度必须有原生证据」，而且设置页依然坏着。

### D2 模块边界

- **新增 `src/host/grok-renewal.ts`**：
  - 导出 `ensureGrokAccessFresh({ home, executable, backend, signal })` 与 `reserveGrokAccount`，结构参照 `hermes-renewal.ts`。
  - 以规范化后的原生 home 为键做在途合并：读者集合、全部读者取消才中止、`ProcessCleanupUnconfirmedError` 设为 poisoned。
  - 续期前后各读一次 `readGrokOwnAccount`，比较槽位、`userId`、`clientId`。
  - 成功条件：`expires` 大于当前时间加阈值。阈值沿用 30 秒，续期触发阈值取 5 分钟，避免刚续完又过期。
  - 取消语义参照 Hermes：调用方取消只结束等待，续期进程只受固定 30 秒时限约束，避免续期令牌已在 IdP 轮换、却还没写回文件时被杀掉。
  - 结果判定只读续期私有 home 日志里 `auth: silent refresh` 事件的 `ctx.outcome` 字段，最多读 4 MiB；stdout 和 stderr 只计字节数，丢弃内容。
- **`grok-models.ts`**：
  - `discoverGrokAccountModels` 增加可选的 `renew` 回调，在过期判断处调用；没有回调时保持现有行为（测试和旧调用不受影响）。
  - `readGrokOwnAccount` 改为抛出带原因码的 `GrokModelsError`，原因码为 `missing`、`format`、`unsafe`、`read`、`expired-no-refresh`。
- **`grok-adapter.ts`**：`discoverGrok` 注入续期回调，并提供续期进程的 argv 和 env（复用 `state()` 的私有目录与 `GROK_AUTH_PATH` 规则）。
- **`zcode-grok-accounts.ts` / `accounts.ts`**：
  - Grok 账号终端启动前调用 `reserveGrokAccount`，与续期互斥。
  - 账号状态查询读取 Host 内存中的「续期被拒」记录（键为凭据指纹），命中时返回 `unauthenticated` 和「登录已失效，请在账号终端重新登录」。
- **Client**：只更新 `i18n-messages.ts` 的文案映射；设置页结构不变。

### D3 结果分类

| 结果 | 依据 | 提示 | 账号状态 |
| --- | --- | --- | --- |
| 成功 | 重读后 access 有效，身份一致 | 无 | 已登录 |
| 需要重新登录 | 进程正常结束但 access 仍过期，或出现任务 1 核实的手动登录信号 | 「Grok 登录已失效，请在账号终端重新登录」 | 登录已失效（内存记录） |
| 暂时失败 | 超时、网络或代理错误、非零退出且无手动登录信号 | 「Grok 登录续期暂时失败，请检查网络后刷新」 | 不变 |
| 账号变化 | 前后身份不一致，或凭据消失 | 「Grok 账号已变化，请刷新」 | 按新证据显示 |
| 账号终端运行中 | 续期时 `reserveGrokAccount` 被占用 | 「Grok 账号终端正在运行，请关闭后刷新」 | 不变 |
| 版本不支持 | 版本不在已核实列表，或入口行为不符 | 「当前 Grok 版本暂不支持自动续期，请更新 Grok 或重新登录」 | 不变 |

「需要重新登录」以 Grok 日志中 outcome 以 `Failed(ManualLogin` 开头为准；「版本不支持」以退出码 2 且没有续期日志为准（clap 对未知子命令的退出码）。stdout 和 stderr 不做解析。

### D4 网络与代理

续期进程通过 `native-process.ts` 启动，继承现有的 Windows 系统代理注入。Host 本身不发 HTTP 请求，因此不涉及 `hostFetch` 的 User-Agent 问题。

## Risks / Trade-offs

- **refresh_token 轮换冲突**：续期和 Worker 可能同时触发续期。Grok 自身有 `auth.json.lock` 和「adopted disk token」恢复逻辑；插件这边只把自己的续期合并为一次，并与账号终端互斥，不额外持锁阻塞 Worker。任务 1 需观察并发时是否出现失效。
- **会改写用户凭据文件**：写入由 Grok 本体完成，效果等同于用户自己运行 grok。这与现在「只读」的目录查询不同，README 需要写明。
- **Windows 1.0.50 行为未知**：如果它不支持续期，则按「版本不支持」处理并提示更新，不做兼容回退。
- **误判需要重新登录**：在任务 1 核实信号前，只把「正常结束且仍过期」判为需要重新登录，其他都算暂时失败，宁可多重试也不误报失效。

## Migration Plan

不涉及持久化数据或协议迁移。要回滚，只需撤掉对 `renew` 回调的注入，即恢复为现有的「登录需要续期」提示；内存中的失败记录随 Host 重启消失。

## Open Questions

- D1 选 A 还是 B，以及两个 Grok 版本的退出与信号，由任务 1 决定。
- 续期成功后，是否立刻刷新设置页的模型缓存，还是等下一次刷新（倾向立刻刷新）。
