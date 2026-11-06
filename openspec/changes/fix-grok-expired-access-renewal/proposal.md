## Why

2026-11-06 在 Windows 测试机上实机复现：用户已登录 Grok，插件设置页却同时显示绿色「已登录」和「登录需要续期，请打开 Grok」，模型与强度不可选；主 Agent 派遣 Grok 也报同样的错误，Worker 没有创建，`grok.exe` 没有启动。

证据（复现记录与只读排查见本 change 的 tasks.md 第 0 节）：

- Grok 官方 OIDC 的 access JWT 有效期为 360 分钟；`auth.json` 中保存有 refresh_token。插件安装 087c 预览包后实测，凭据已过期 812→821 分钟，期间没有被续期。
- 账号状态在「access 有效或存在 refresh」时就判为已登录（`src/host/zcode-grok-accounts.ts:180-187`）。模型发现则要求 access 有效且剩余超过 30 秒，否则直接报错，且明确不做续期（`src/host/grok-models.ts:246-260`）。
- 派遣会先查模型目录（`src/host/index.ts:1151`），目录失败就停止，Grok 本体不会运行。而根据 Grok 文档与日志，只有 Grok 本体运行时才会用 refresh_token 自动续期：Mac 上的 Grok 1.0.62 在 2026-10-31 07:10Z 启动时记录了 `oidc refresh attempting idp` → `try_refresh_pure succeeded` → `auth update disk written`。两者因此形成死锁。
- 目录探测故意使用无凭据的私有目录（`src/host/grok-catalog.mjs`，`grok-adapter.ts:191`），不会替用户续期。
- Windows 的 Grok 日志显示，10-18、10-29、10-30、11-05 用户每次都是「登出 → 重新登录」才恢复，约 6 小时后再次失效。
- `readGrokOwnAccount` 把文件缺失、格式不支持、安全检查失败等异常一律报「请先登录 Grok」（`grok-models.ts:116-118`），用户无法分辨原因。

## What Changes

- **新增 Grok 原生续期**：查询 Grok 账号模型目录前，如果 access 已过期或即将过期，而原生凭据里有 refresh_token，Host 就在受控进程中运行 Grok 本体，让它用自身机制续期。完成后重新读取账号并核对身份，确认是同一账号且 access 有效后，再查询模型目录。插件不发 OAuth 请求，不复制、不读出 refresh_token。设置页刷新与派遣共用这条路径。
- **续期互斥与生命周期**：同一原生 Grok 账号的续期合并为一次在途操作。续期与账号终端（登录、登出）互斥。续期过程有超时、取消和进程范围清理，无法确认清理时按现有规则只封锁 Grok。
- **续期结果分类**：区分续期成功、需要重新登录、网络或服务暂不可用、账号已变化、账号终端正在运行、当前 Grok 版本不支持这几种结果，提示指向实际入口「账号终端」。
- **账号状态与续期结果一致**：续期被 Grok 明确拒绝、需要重新登录时，账号状态显示「登录已失效」，直到原生凭据文件发生变化，不再一边显示绿色「已登录」一边无法使用。
- **读取失败分类**：把凭据文件缺失、格式不受支持、安全检查失败、读取失败分开，并给出脱敏后的简短原因，不再统一显示「请先登录 Grok」。
- **同步文档**：更新 README 与 `doc/design.md` 的 Grok 账号说明。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `cli-model-discovery`：新增「Grok 访问凭据过期时的原生续期」要求。
- `cli-connection-health`：新增「Grok 续期失败与读取失败的账号状态」要求。

## Impact

- **Host**：
  - 新增 `src/host/grok-renewal.ts`（结构参照 `hermes-renewal.ts`）。
  - 修改 `src/host/grok-models.ts`（读取错误分类、续期接入点）、`src/host/grok-adapter.ts`（续期进程的环境与参数）、`src/host/zcode-grok-accounts.ts`（续期失败后的账号状态），以及 `src/host/accounts.ts` 中 Grok 账号终端与续期的互斥。
- **Client**：只调整提示文案与 `src/client/i18n-messages.ts` 的映射，不改界面结构。
- **协议、存储、安装**：不改协议和安装方式。续期失败记录只存在 Host 内存中，以凭据指纹为键，不落盘、不含秘密。续期由 Grok 本体写回用户自己的 `~/.grok/auth.json`，与用户在终端运行 grok 时一致。
- **测试**：`tests/grok-models.test.ts`、`tests/zcode-grok-accounts.test.ts`、`tests/grok-adapter.test.ts`，并新增 `tests/grok-renewal.test.ts`。
- **范围外**：
  - Kimi 等其他 CLI 的同类「需打开账号终端续期」问题。
  - 目录探测失败后残留 `catalog/grok/query-*` 目录的问题。
  - Windows 上 Grok 1.0.50 的升级。
  - macOS Worker 把 `auth.json` 符号链接放进私有目录，Grok 若以 rename 写回会落在私有目录里，这一隐患只在验证任务中核实，不在本次修改。
- **未验证前提**：哪个原生命令在 Windows 的 Grok 1.0.50 和 Mac 的 Grok 1.0.62 上都会续期并写回原文件，需要在实施前用任务 1 核实。这一步会让 Grok 改写 Windows 上的凭据文件，须用户另行授权。
