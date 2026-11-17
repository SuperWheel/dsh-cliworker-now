# Tasks

## 1. 定位根因 〔后端｜2h〕
- [x] 1.1 对照 issue #13 截图与设置页状态来源
  - 设置页「未登录」= Host 账号状态 `unconfigured`（`settings-dialog.tsx` `connectionStatus`）；Windows 状态来自 `windows-agy-account.ps1`，`CredRead("gemini:antigravity")` 返回 1168 时投影为 `unconfigured`
  - 「Antigravity 无法确认当前自身账号」来自 `cli-account-binding.ts` 绑定失败；账号窗口「当前已登录」来自 agy 画面识别，说明 agy 自己有有效登录
- [x] 1.2 核对 agy 1.5.9 的存储行为（Mac `~/.local/bin/agy` 与 Windows 测试机同为 1.5.9）
  - 符号 `codeassistclient.(*compositeTokenStorage)`（`LoadStoredToken`、`peekKeyringStoredToken`、`fallbackSaveTokenToFile`）
  - 文本：`Failed to load token from keyring, falling back to file`、`Using file-based token storage because a keyring timeout was recorded within the last %v`、`Keyring %s failed (%v); using file-based token storage for writes for the rest of this process`、`Failed to clear stale keyring credential after file fallback`、`failed to remove token from both keyring (%v) and file (%v)`
  - 本机钥匙串条目字段为 `token`、`auth_method`、`id_token_email`、`writer_id`（只读键名，未输出值）
  - Windows 测试机经 SSH 看不到凭据管理器（非交互登录），`%USERPROFILE%\.gemini` 下没有令牌文件；交互桌面计划任务本次未能运行，未取得凭据管理器结果

## 2. 实现修复 〔后端｜2h｜前置 1〕
- [x] 2.1 `account-identity.ts`：抽出 `readAgyTokenFile`（有界、不跟随链接、读后比对）与 `agyTokenFile`，`localAccountIdentity` 改用它，行为不变
  - 证据：`src/host/account-identity.ts` 的 `readAgyTokenFile`；`tests/account-identity.test.ts` 原有项通过
- [x] 2.2 `agy-windows-account.ts`：凭据管理器投影为 `unconfigured`／`unavailable` 时读令牌文件；新增 `projectAgyCredential`，主体摘要与帮助脚本同算法；无项且文件损坏时为 `unavailable`
  - 证据：`src/host/agy-windows-account.ts` 的 `readNativeWindowsAgyAccount`、`windowsAgyAccountFromFile`、`projectAgyCredential`；测试见 3.1
- [x] 2.3 `agy-macos-account.ts`：新增 `readMacAgyLogin`，钥匙串无项或 `MacAgyKeychainError` 时读令牌文件；进程清理失败照常抛出；状态与绑定都改用它
  - 证据：`src/host/agy-macos-account.ts` 的 `readMacAgyLogin`；测试见 3.2
- [x] 2.4 `cli-account-binding.ts`：macOS 改用 `readMacAgyLogin`；Windows 来源标识保持 `windows-credential:gemini:antigravity`
  - 证据：`src/host/cli-account-binding.ts` Antigravity 分支；测试见 3.2 的绑定一致项
- [x] 2.5 Windows 测试清单（`scripts/windows-remote-common.mjs`、`.github/workflows/windows.yml`）加入 `tests/agy-windows-account.test.ts`
  - 证据：两处清单各出现 1 次；`tests/windows-remote.test.ts` 28 项通过

## 3. 模拟回归测试 〔测试｜1h｜前置 2〕
- [x] 3.1 `tests/agy-windows-account.test.ts` 新增 6 项（合成凭据与临时 home）
  - 凭据管理器 `unconfigured`／`unavailable` 时读文件得已登录与邮箱、不含令牌；凭据管理器有登录或已过期时不看文件；两处皆无为未登录、文件损坏为 `unavailable`；文件主体摘要与帮助脚本一致、非 Google 签发不出摘要；仅文件登录时模型目录可用
  - 该文件改为模拟 `homedir`，不再读开发者真实 `~/.gemini`
- [x] 3.2 `tests/agy-macos-account.test.ts`：旧断言「无项不读旧文件」改为新行为；新增无项／钥匙串不可读时读文件、钥匙串优先、同一登录在钥匙串与文件间绑定不变、文件损坏仍报钥匙串不可读
  - 证据：同 3.4 的相关测试运行
- [x] 3.3 `tests/cli-account-binding.test.ts` 的 macOS mock 改为 `readMacAgyLogin`
  - 证据：同 3.4；`cli-account-binding.test.ts` 全部通过
- [x] 3.4 Mac 验证
  - 证据：`corepack pnpm exec vitest run` 相关 7 个文件 170 项通过；账号与 agy 原生回归 5 个文件 226 项通过；`tests/windows-remote.test.ts` 28 项通过
  - 证据：`corepack pnpm typecheck` 通过（against DSH 0.2.2-rc.3）
- [x] 3.5 Windows 隔离测试 `node scripts/windows-remote.mjs`
  - 证据：运行 `46628922-269b-4367-bdfa-24caae7e02a4`（win32，Node v24.15.0）：install、typecheck、windows-tests、mac-package-host-load 等 9 个阶段退出码均为 0；Windows 测试 480 项（476 通过、4 跳过、0 失败）；`tests/agy-windows-account.test.ts` 24 项全部通过
  - 首次运行因测试机残留 11-15 的 `run.lock`（记录的 PID 48844 已不存在）失败，确认无进程后删除该锁重跑

## 4. 实机验证 〔测试｜1h｜前置 3〕
- [ ] 4.1 Windows 上凭据管理器无项、仅令牌文件的真实 agy 登录：设置页显示已登录、模型可选（需要能复现 agy 回退到文件的环境，或报告者确认）
- [ ] 4.2 「凭据库无项时 agy 自己也读文件」的真实确认（目前由程序文本推断，见 design 决策 1）

## 跟进

- issue 截图 3：关闭账号终端时停在「正在关闭终端…」，设置页提示「此 CLI 已有账号终端，请先关闭后重试」，未复现，未处理。
